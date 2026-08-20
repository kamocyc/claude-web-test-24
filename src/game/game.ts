import * as THREE from 'three';
import { boxIntersectsWorld } from '../core/aabb';
import { mulberry32 } from '../core/rng';
import { ChunkRenderer } from '../render/chunkRenderer';
import { Effects } from '../render/effects';
import { EntityRenderer } from '../render/entityRenderer';
import { createChunkMaterials, type ChunkMaterials } from '../render/materials';
import { Sky } from '../render/sky';
import { buildAtlas, type Atlas } from '../render/textures';
import { Block, type BlockId, blockDef, isFarmland, isReplaceable, supportsPlant } from '../world/blocks';
import {
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  CHUNK_VOLUME,
  Chunk,
  SEA_LEVEL,
  chunkKey,
  toChunkCoord,
} from '../world/chunk';
import { TerrainGenerator } from '../world/generation/terrain';
import { LightEngine } from '../world/lighting';
import { WATER_FULL } from '../world/water';
import { WaterSimulator } from '../world/waterSim';
import { raycastVoxels, type RaycastHit } from '../world/raycast';
import { TICK_INTERVAL, randomTickChunk } from '../world/ticks';
import { World } from '../world/world';
import { ChunkWorkerPool } from '../workers/pool';
import type { ChunkReadyMessage } from '../workers/chunkMessages';
import { Hud, type NavigationInfo } from '../ui/hud';
import type { CompassMarker } from '../ui/compass';
import type { Input } from '../ui/input';
import type { Menus } from '../ui/menus';
import { ScreenManager } from '../ui/screens';
import { createChest, createFurnace, isChest, isFurnace } from './blockEntities';
import { applyDamage, applyKnockback } from './combat';
import { DayCycle } from './daycycle';
import { DropManager } from './drops';
import { EXHAUSTION } from './hunger';
import { HOTBAR_SIZE, Inventory, type ItemStack } from './inventory';
import { itemDef, itemLabel } from './items';
import { fillVillageChest } from './loot';
import { bestToolSlot, blockDrops, heldTool, miningTime } from './mining';
import { Mob } from './mobs/ai';
import { MobManager, type MobUpdateContext } from './mobs/spawner';
import type { MobKind } from './mobs/types';
import { NO_INPUT, Player, type PlayerInput } from './player';
import {
  type SaveData,
  SAVE_VERSION,
  decodeEdits,
  decodeWater,
  encodeEdits,
  encodeWater,
  writeSave,
} from './save';
import { findSpawn } from './seeds';
import type { Settings } from './settings';
import { tickFurnace } from './smelting';
import { tradesFromJSON, tradesToJSON } from './trading';
import { biomeDef } from '../world/generation/biome';
import { riverCovers } from '../world/generation/rivers';
import { RiverFlow } from '../world/riverFlow';
import {
  SEASON_LENGTH_SECONDS,
  type Forecast,
  type Season,
  forecastAt,
  localWetness,
  seasonAt,
  travelDelay,
} from '../world/weather';

const UNLOAD_MARGIN = 2;
const REACH = 5;
const ATTACK_REACH = 3.6;
const AUTOSAVE_SECONDS = 30;
/** Chunk meshes rebuilt per frame; higher values load faster but stutter more. */
const MESH_BUDGET = 3;
/** Water-only rebuilds are much cheaper, so more of them fit in a frame. */
const WATER_MESH_BUDGET = 6;

export interface GameOptions {
  canvas: HTMLCanvasElement;
  input: Input;
  menus: Menus;
  seed: number;
  save: SaveData | null;
  settings: Settings;
  onQuit(): void;
}

export class Game {
  readonly world: World;
  readonly player = new Player();
  readonly day = new DayCycle();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly atlas: Atlas;
  private readonly materials: ChunkMaterials;
  private readonly chunkRenderer: ChunkRenderer;
  private readonly entityRenderer: EntityRenderer;
  private readonly effects: Effects;
  private readonly sky: Sky;
  private readonly light: LightEngine;
  private readonly water: WaterSimulator;
  private readonly riverFlow: RiverFlow;
  /** Seconds of world time, which is what the weather upstream runs on. */
  private weatherSeconds = 0;
  private readonly generator: TerrainGenerator;
  private readonly pool: ChunkWorkerPool;
  private readonly mobs: MobManager;
  private readonly drops: DropManager;
  private readonly hud: Hud;
  private readonly screens: ScreenManager;
  private readonly tickRng = mulberry32(0x71c4);

  private readonly populatedChunks = new Set<string>();
  private running = false;
  private paused = false;
  private ready = false;
  private lastFrame = 0;
  private tickTimer = 0;
  private autosaveTimer = 0;
  private fps = 60;
  /** Block being mined and how far along it is. */
  private miningTarget: { x: number; y: number; z: number } | null = null;
  private miningProgress = 0;
  private openContainerPos: { x: number; y: number; z: number } | null = null;
  private renderDistance: number;
  private keyHandler: ((event: KeyboardEvent) => void) | null = null;
  private lockHandler: (() => void) | null = null;
  /** Where the player started, so the compass can always point home. */
  private spawnPoint = { x: 0, z: 0 };
  /** Where the player last died, so their dropped items can be found again. */
  private deathPoint: { x: number; z: number } | null = null;
  private nearestVillage: { x: number; z: number } | null = null;
  private villageSearchTimer = 0;

  constructor(private readonly options: GameOptions) {
    this.world = new World(options.seed);
    this.generator = new TerrainGenerator(options.seed);
    this.light = new LightEngine(this.world);
    this.water = new WaterSimulator(this.world);
    this.riverFlow = new RiverFlow(this.world);
    this.world.onBlockChange((x, y, z, previous, next) => {
      this.light.onBlockChanged(x, y, z, previous, next);
      this.water.onBlockChanged(x, y, z, previous, next);
      this.onBlockChanged(x, y, z, previous, next);
    });

    this.renderer = new THREE.WebGLRenderer({ canvas: options.canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderDistance = options.settings.renderDistance;
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, this.renderDistance * CHUNK_SIZE * 1.4);

    this.atlas = buildAtlas();
    this.materials = createChunkMaterials(this.atlas.texture);
    this.chunkRenderer = new ChunkRenderer(this.world, this.atlas, this.materials);
    this.entityRenderer = new EntityRenderer(this.atlas);
    this.effects = new Effects(this.atlas);
    this.sky = new Sky(this.scene, this.renderDistance * CHUNK_SIZE);
    this.scene.add(this.chunkRenderer.group, this.entityRenderer.group, this.effects.group);

    this.mobs = new MobManager(this.world, options.seed);
    this.drops = new DropManager(this.world);
    this.hud = new Hud(this.atlas);
    this.screens = new ScreenManager(
      this.player,
      this.atlas,
      (stack) => this.dropAtPlayer(stack),
      (recipe, made) => this.hud.toast(`${itemLabel(recipe.result.id)} を ${made * recipe.result.count} 個作った`),
    );

    document.body.append(this.hud.root, this.screens.layer);

    this.pool = new ChunkWorkerPool(options.seed);
    this.pool.setHandler((message) => this.onChunkReady(message));

    if (options.save) this.applySave(options.save);
    else this.placeAtSpawn();

    this.bindInput();
    window.addEventListener('resize', this.onResize);
    this.onResize();
  }

  // --- lifecycle -------------------------------------------------------------

  start(): void {
    this.running = true;
    this.lastFrame = performance.now();
    this.options.menus.showLoading(true, 'ワールドを生成しています...');
    requestAnimationFrame(this.loop);
  }

  dispose(): void {
    this.running = false;
    window.removeEventListener('resize', this.onResize);
    if (this.keyHandler) this.options.input.offKey(this.keyHandler);
    if (this.lockHandler) document.removeEventListener('pointerlockchange', this.lockHandler);
    this.pool.dispose();
    this.chunkRenderer.dispose();
    this.hud.root.remove();
    this.screens.close();
    this.screens.layer.remove();
    this.renderer.dispose();
  }

  private readonly onResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };

  private readonly loop = (now: number): void => {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.fps = this.fps * 0.9 + (1 / Math.max(dt, 1e-4)) * 0.1;
    this.update(dt);
    this.render();
    this.options.input.endFrame();
  };

  private update(dt: number): void {
    this.streamChunks();
    this.light.update(20000);
    this.chunkRenderer.processDirty(MESH_BUDGET, this.player.x, this.player.z);
    this.chunkRenderer.processWaterDirty(WATER_MESH_BUDGET);

    if (!this.ready) {
      // Wait until the ground under the player exists before handing over control.
      const loaded = this.world.hasChunk(toChunkCoord(this.player.x), toChunkCoord(this.player.z));
      this.options.menus.showLoading(true, `地形を生成しています... 残り ${this.pool.pending} チャンク`);
      if (loaded && this.pool.pending < 40) {
        this.ready = true;
        this.options.menus.showLoading(false);
        this.options.menus.hideAll();
        // A loaded save already knows where the player stood; only a brand new world
        // needs to be dropped onto the freshly generated surface.
        if (!this.options.save) this.settlePlayerOnGround();
        // Pointer lock can only be requested from a real user gesture, so the player
        // clicks once to start looking around.
        this.hud.setClickPrompt(true);
      }
      return;
    }

    if (this.paused || this.player.isDead) {
      if (this.player.isDead) this.options.menus.showDeath(true);
      this.hud.update(dt, this.player, this.debugInfo(), this.navigationInfo());
      return;
    }

    this.player.autoStep = this.options.settings.autoStep;
    this.advanceWeather(this.weatherSeconds + dt);
    this.water.setCenter(this.player.x, this.player.z);
    this.water.update(dt);
    this.riverFlow.update(dt);
    this.day.update(dt);
    this.materials.setSun(Math.max(0.06, this.day.sunLight));

    // Only mouse look needs pointer lock; keyboard and clicks keep working without it
    // so the game stays playable if the browser refuses to lock the cursor.
    const screenOpen = this.screens.isOpen;
    if (!screenOpen && this.options.input.locked) this.updateLook();
    const input = screenOpen ? NO_INPUT : this.readMovement();

    const current = this.water.flowAt(
      Math.floor(this.player.x),
      Math.floor(this.player.y + 0.4),
      Math.floor(this.player.z),
    );
    const events = this.player.update(dt, this.world, input, current);
    this.unstick();
    if (events.tookDamage > 0) this.hud.flashDamage();

    if (!screenOpen) this.updateInteraction(dt);
    else this.resetMining();

    this.updateMobs(dt);
    this.updateDrops(dt);
    this.updateTicks(dt);
    this.updateFurnaces(dt);
    this.checkOpenContainer();

    this.hud.setUnderwater(
      this.world.getBlock(Math.floor(this.player.x), Math.floor(this.player.eyeY), Math.floor(this.player.z)) ===
        Block.WATER,
    );
    this.effects.update(dt);
    this.entityRenderer.sync(this.mobs.mobs, this.drops.drops, this.mobs.arrows, performance.now() / 1000);
    this.screens.refresh();
    this.hud.update(dt, this.player, this.debugInfo(), this.navigationInfo());

    this.villageSearchTimer -= dt;
    if (this.villageSearchTimer <= 0) {
      this.villageSearchTimer = 2;
      this.nearestVillage = this.generator.findNearestVillage(this.player.x, this.player.z, 2);
    }

    this.autosaveTimer += dt;
    if (this.autosaveTimer >= AUTOSAVE_SECONDS) {
      this.autosaveTimer = 0;
      this.save(false);
    }
  }

  /** Moves the world clock the weather runs on. Everything that reads it is updated
   *  here, so a jump — loading a save, or the debug controls — lands every loaded river
   *  at the right level in one step instead of creeping there. */
  private advanceWeather(seconds: number): void {
    const jumped = Math.abs(seconds - this.weatherSeconds) > 5;
    this.weatherSeconds = seconds;
    this.generator.weatherSeconds = seconds;
    this.pool.weatherSeconds = seconds;
    this.riverFlow.seconds = seconds;
    this.water.flowFactor = (x, z) =>
      springRate(localWetness(this.options.seed, seconds, this.generator.inlandAt(x, z)));
    if (jumped) this.riverFlow.sweepAll();
  }

  /** What the weather is doing where the player is standing. */
  private forecast(): Forecast {
    return forecastAt(
      this.options.seed,
      this.weatherSeconds,
      this.generator.inlandAt(this.player.x, this.player.z),
    );
  }

  /** Safety net: if the player ends up inside terrain, lift them out. */
  private unstick(): void {
    for (let i = 0; i < 8; i++) {
      if (!boxIntersectsWorld(this.world, this.player.box())) return;
      this.player.y += 1;
      this.player.vy = 0;
    }
  }

  private render(): void {
    this.camera.position.set(this.player.x, this.player.eyeY, this.player.z);
    this.camera.rotation.set(this.player.pitch, this.player.yaw, 0, 'YXZ');
    this.sky.update(this.day, this.camera, this.renderer);
    this.renderer.render(this.scene, this.camera);
  }

  /** Places worth walking back to, refreshed at most once a second because finding
   *  the nearest village walks the village grid. */
  private navigationInfo(): NavigationInfo {
    const markers: CompassMarker[] = [{ kind: 'spawn', x: this.spawnPoint.x, z: this.spawnPoint.z }];
    if (this.deathPoint) markers.push({ kind: 'death', x: this.deathPoint.x, z: this.deathPoint.z });
    if (this.nearestVillage) {
      markers.push({ kind: 'village', x: this.nearestVillage.x, z: this.nearestVillage.z });
    }
    return {
      world: this.world,
      markers,
      showCompass: this.options.settings.compass,
      showMinimap: this.options.settings.minimap,
    };
  }

  private debugInfo() {
    return {
      seed: this.world.seed,
      fps: this.fps,
      chunks: this.chunkRenderer.meshCount,
      pending: this.pool.pending,
      biome: biomeDef(this.generator.biomeAt(Math.floor(this.player.x), Math.floor(this.player.z))).label,
      clock: this.day.clock,
      mobs: this.mobs.mobs.length,
      waterDepth: this.water.depthAt(
        Math.floor(this.player.x),
        Math.floor(this.player.y + 0.4),
        Math.floor(this.player.z),
      ),
    };
  }

  // --- chunk streaming -------------------------------------------------------

  private streamChunks(): void {
    const pcx = toChunkCoord(this.player.x);
    const pcz = toChunkCoord(this.player.z);
    const radius = this.renderDistance;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const distance = dx * dx + dz * dz;
        if (distance > radius * radius) continue;
        const cx = pcx + dx;
        const cz = pcz + dz;
        if (this.world.hasChunk(cx, cz) || this.pool.isBusyWith(cx, cz)) continue;
        this.pool.request(cx, cz, distance);
      }
    }

    const limit = (radius + UNLOAD_MARGIN) * (radius + UNLOAD_MARGIN);
    this.pool.cancelFarther((cx, cz) => (cx - pcx) ** 2 + (cz - pcz) ** 2 <= limit);
    for (const chunk of [...this.world.chunks.values()]) {
      const distance = (chunk.cx - pcx) ** 2 + (chunk.cz - pcz) ** 2;
      if (distance <= limit) continue;
      this.chunkRenderer.remove(chunk.key);
      this.riverFlow.forgetChunk(chunk.key);
      this.world.removeChunk(chunk.cx, chunk.cz);
    }
  }

  private onChunkReady(message: ChunkReadyMessage): void {
    const chunk = new Chunk(message.cx, message.cz, message.blocks, message.water);
    chunk.generated = true;
    if (message.riverSurface) chunk.riverSurface = message.riverSurface;
    this.world.addChunk(chunk);
    this.light.seedChunk(chunk);
    this.water.registerChunk(chunk, message.springs ?? []);
    this.riverFlow.registerChunk(chunk, message.weatherSeconds ?? 0);

    const key = chunkKey(message.cx, message.cz);
    if (!this.populatedChunks.has(key)) {
      this.populatedChunks.add(key);
      for (const villager of message.villagers) {
        this.mobs.addVillager(villager.x + 0.5, villager.y, villager.z + 0.5, villager.profession);
      }
      for (const chest of message.chests) {
        if (this.world.getBlockEntity(chest.x, chest.y, chest.z)) continue;
        this.world.setBlockEntity(
          chest.x,
          chest.y,
          chest.z,
          createChest(fillVillageChest(this.options.seed, chest.x, chest.y, chest.z, chest.loot)),
        );
      }
    }
  }

  // --- player input ----------------------------------------------------------

  private bindInput(): void {
    const input = this.options.input;
    this.keyHandler = (event) => {
      if (!this.ready) return;
      switch (event.code) {
        case 'Escape':
          if (this.screens.isOpen) {
            this.closeScreen();
          } else {
            this.togglePause();
          }
          break;
        case 'KeyE':
          if (this.paused || this.player.isDead) break;
          if (this.screens.isOpen) this.closeScreen();
          else this.openScreen(() => this.screens.openInventory());
          break;
        case 'F3':
          event.preventDefault();
          this.hud.toggleDebug();
          break;
        default:
          break;
      }
      const hotbar = /^Digit([1-9])$/.exec(event.code);
      if (hotbar && !this.screens.isOpen) {
        this.player.inventory.selected = Number(hotbar[1]) - 1;
        this.hud.showHeldItem(this.player.inventory.held?.id ?? null);
      }
    };
    input.onKey(this.keyHandler);

    this.options.canvas.addEventListener('mousedown', () => {
      if (this.ready && !this.paused && !this.screens.isOpen && !this.player.isDead && !this.options.input.locked) {
        this.options.input.requestLock();
      }
    });
    this.lockHandler = () => {
      // A click that opens a container also asks for pointer lock, and the request can
      // land after the screen opened. Undo it, or the cursor stays trapped and the UI
      // becomes unclickable.
      if (this.options.input.locked && (this.screens.isOpen || this.paused || this.player.isDead)) {
        this.options.input.releaseLock();
        return;
      }
      this.hud.setClickPrompt(!this.options.input.locked && this.ready && !this.paused && !this.screens.isOpen);
    };
    document.addEventListener('pointerlockchange', this.lockHandler);
  }

  private readMovement(): PlayerInput {
    const input = this.options.input;
    const wheel = input.takeWheel();
    if (wheel !== 0) {
      const size = 9;
      this.player.inventory.selected = (this.player.inventory.selected + wheel + size) % size;
      this.hud.showHeldItem(this.player.inventory.held?.id ?? null);
    }
    return {
      forward: input.isDown('KeyW'),
      back: input.isDown('KeyS'),
      left: input.isDown('KeyA'),
      right: input.isDown('KeyD'),
      jump: input.isDown('Space'),
      sprint: input.isDown('ControlLeft') || input.isDown('ControlRight'),
      sneak: input.isDown('ShiftLeft') || input.isDown('ShiftRight'),
    };
  }

  private updateLook(): void {
    const delta = this.options.input.takeMouseDelta();
    this.player.yaw -= delta.x;
    this.player.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.player.pitch - delta.y));
  }

  // --- interaction -----------------------------------------------------------

  private updateInteraction(dt: number): void {
    const eye = { x: this.player.x, y: this.player.eyeY, z: this.player.z };
    const look = this.player.lookVector();
    const hit = raycastVoxels(this.world, eye, look, { maxDistance: REACH });
    this.effects.setSelection(hit);

    const input = this.options.input;
    if (input.buttonJustPressed(0)) {
      const mob = this.mobUnderCrosshair(eye, look);
      if (mob) {
        this.attack(mob);
        this.resetMining();
        return;
      }
    }
    if (input.buttonJustPressed(2)) {
      const mob = this.mobUnderCrosshair(eye, look);
      if (mob && mob.kind === 'villager') {
        this.openScreen(() => this.screens.openTrade(mob, () => this.hud.toast('取引が成立した')));
        return;
      }
      this.useItem(hit);
      return;
    }

    if (input.buttons[0] && hit) {
      this.updateMining(dt, hit);
    } else {
      this.resetMining();
    }
  }

  private updateMining(dt: number, hit: RaycastHit): void {
    if (
      !this.miningTarget ||
      this.miningTarget.x !== hit.x ||
      this.miningTarget.y !== hit.y ||
      this.miningTarget.z !== hit.z
    ) {
      this.miningTarget = { x: hit.x, y: hit.y, z: hit.z };
      this.miningProgress = 0;
      this.selectBestTool(hit.block);
    }
    const tool = heldTool(this.player.inventory.held);
    const seconds = miningTime(hit.block, tool);
    if (!Number.isFinite(seconds)) {
      this.effects.setBreakProgress(null, 0);
      return;
    }
    this.miningProgress += dt / seconds;
    this.effects.setBreakProgress(this.miningTarget, this.miningProgress);
    if (this.miningProgress >= 1) {
      this.breakBlock(hit.x, hit.y, hit.z, hit.block);
      this.resetMining();
    }
  }

  /** Puts the right tool in hand for whatever the crosshair just landed on. */
  private selectBestTool(block: BlockId): void {
    if (!this.options.settings.autoTool) return;
    const inventory = this.player.inventory;
    const slot = bestToolSlot(inventory.slots.slice(0, HOTBAR_SIZE), block, inventory.selected);
    if (slot === inventory.selected) return;
    inventory.selected = slot;
    this.hud.showHeldItem(inventory.held?.id ?? null);
  }

  private resetMining(): void {
    this.miningTarget = null;
    this.miningProgress = 0;
    this.effects.setBreakProgress(null, 0);
  }

  private breakBlock(x: number, y: number, z: number, block: number): void {
    const tool = heldTool(this.player.inventory.held);
    const drops = blockDrops(block, tool, { random: () => Math.random() });
    this.effects.spawnBlockParticles(x, y, z, block);

    const entity = this.world.getBlockEntity(x, y, z);
    if (isChest(entity)) {
      for (const slot of entity.slots.slots) if (slot) this.drops.spawn(x + 0.5, y + 0.5, z + 0.5, slot);
    } else if (isFurnace(entity)) {
      for (const slot of entity.slots.slots) if (slot) this.drops.spawn(x + 0.5, y + 0.5, z + 0.5, slot);
    }
    if (entity) this.world.removeBlockEntity(x, y, z);

    this.world.setBlock(x, y, z, Block.AIR);
    for (const drop of drops) this.drops.spawn(x + 0.5, y + 0.5, z + 0.5, drop);
    this.player.hunger.addExhaustion(EXHAUSTION.mineBlock);
  }

  /** Right click: place, plant, till, eat or open a container. */
  private useItem(hit: RaycastHit | null): void {
    const held = this.player.inventory.held;
    const def = held ? itemDef(held.id) : undefined;
    const sneaking = this.options.input.isDown('ShiftLeft') || this.options.input.isDown('ShiftRight');

    if (hit && !sneaking) {
      const target = this.world.getBlock(hit.x, hit.y, hit.z);
      if (target === Block.CRAFTING_TABLE) {
        this.openScreen(() => this.screens.openCraftingTable());
        return;
      }
      if (target === Block.CHEST) {
        let entity = this.world.getBlockEntity(hit.x, hit.y, hit.z);
        if (!isChest(entity)) {
          entity = createChest();
          this.world.setBlockEntity(hit.x, hit.y, hit.z, entity);
        }
        this.openContainerPos = { x: hit.x, y: hit.y, z: hit.z };
        const chest = entity as ReturnType<typeof createChest>;
        this.openScreen(() => this.screens.openChest(chest.slots));
        return;
      }
      if (target === Block.FLOODGATE_CLOSED || target === Block.FLOODGATE_OPEN) {
        const opened = target === Block.FLOODGATE_CLOSED;
        this.world.setBlock(hit.x, hit.y, hit.z, opened ? Block.FLOODGATE_OPEN : Block.FLOODGATE_CLOSED);
        this.hud.toast(opened ? '水門を開いた' : '水門を閉じた');
        return;
      }
      if (target === Block.FURNACE) {
        let entity = this.world.getBlockEntity(hit.x, hit.y, hit.z);
        if (!isFurnace(entity)) {
          entity = createFurnace();
          this.world.setBlockEntity(hit.x, hit.y, hit.z, entity);
        }
        this.openContainerPos = { x: hit.x, y: hit.y, z: hit.z };
        const furnace = entity as ReturnType<typeof createFurnace>;
        this.openScreen(() => this.screens.openFurnace(furnace));
        return;
      }
    }

    if (!held || !def) return;

    // Buckets look through water rather than at it, so they get their own trace.
    if (held.id === 'bucket' || held.id === 'water_bucket') {
      this.useBucket(held.id === 'bucket');
      return;
    }

    // Eating.
    if (def.food && this.player.hunger.canEat()) {
      this.player.hunger.eat(def.food.hunger, def.food.saturation);
      this.player.inventory.consumeHeld();
      this.hud.toast(`${def.label}を食べた`);
      return;
    }

    if (!hit) return;

    // Tilling soil with a hoe.
    if (def.tool?.kind === 'hoe') {
      const target = this.world.getBlock(hit.x, hit.y, hit.z);
      if ((target === Block.GRASS || target === Block.DIRT) && this.world.getBlock(hit.x, hit.y + 1, hit.z) === Block.AIR) {
        this.world.setBlock(hit.x, hit.y, hit.z, Block.FARMLAND);
        return;
      }
    }

    // Planting crops on farmland.
    if (def.plantsCrop !== undefined) {
      const soil = this.world.getBlock(hit.x, hit.y, hit.z);
      const above = { x: hit.x, y: hit.y + 1, z: hit.z };
      if (isFarmland(soil) && this.world.getBlock(above.x, above.y, above.z) === Block.AIR) {
        this.world.setBlock(above.x, above.y, above.z, def.plantsCrop);
        this.player.inventory.consumeHeld();
        return;
      }
    }

    if (def.placesBlock === undefined) return;
    this.placeBlock(hit, def.placesBlock);
  }

  /** Scoops a full cell of water into an empty bucket, or pours one back out. */
  private useBucket(empty: boolean): void {
    const eye = { x: this.player.x, y: this.player.eyeY, z: this.player.z };
    const look = this.player.lookVector();
    const hit = raycastVoxels(this.world, eye, look, { maxDistance: REACH, hitLiquids: true });
    if (!hit) return;

    if (empty) {
      if (hit.block !== Block.WATER) return;
      if (this.world.getWater(hit.x, hit.y, hit.z) < WATER_FULL * 0.75) {
        this.hud.toast('水が浅すぎる');
        return;
      }
      this.world.setBlock(hit.x, hit.y, hit.z, Block.AIR);
      this.player.inventory.consumeHeld();
      const leftover = this.player.inventory.add({ id: 'water_bucket', count: 1 });
      if (leftover > 0) this.dropAtPlayer({ id: 'water_bucket', count: leftover });
      return;
    }

    // Pouring: into the cell that was hit if it can hold water, otherwise the face.
    const x = hit.block === Block.WATER || isReplaceable(hit.block) ? hit.x : hit.x + hit.nx;
    const y = hit.block === Block.WATER || isReplaceable(hit.block) ? hit.y : hit.y + hit.ny;
    const z = hit.block === Block.WATER || isReplaceable(hit.block) ? hit.z : hit.z + hit.nz;
    if (!isReplaceable(this.world.getBlock(x, y, z))) return;
    this.world.setBlock(x, y, z, Block.WATER);
    this.player.inventory.consumeHeld();
    const leftover = this.player.inventory.add({ id: 'bucket', count: 1 });
    if (leftover > 0) this.dropAtPlayer({ id: 'bucket', count: leftover });
  }

  private placeBlock(hit: RaycastHit, block: number): void {
    let x = hit.x + hit.nx;
    let y = hit.y + hit.ny;
    let z = hit.z + hit.nz;
    // Replaceable blocks (grass, water) are overwritten in place.
    if (isReplaceable(this.world.getBlock(hit.x, hit.y, hit.z))) {
      x = hit.x;
      y = hit.y;
      z = hit.z;
    } else if (!isReplaceable(this.world.getBlock(x, y, z))) {
      return;
    }
    if (y < 0 || y >= CHUNK_HEIGHT) return;

    const def = blockDef(block);
    if (def.render === 'cross' && block !== Block.TORCH) {
      if (!supportsPlant(this.world.getBlock(x, y - 1, z))) return;
    }
    if (block === Block.TORCH && !blockDef(this.world.getBlock(x, y - 1, z)).solid) {
      // Torches need something to stand on, otherwise they would float.
      const sideSupport = [[-1, 0], [1, 0], [0, -1], [0, 1]].some(
        ([dx, dz]) => blockDef(this.world.getBlock(x + dx, y, z + dz)).solid,
      );
      if (!sideSupport) return;
    }

    if (def.solid) {
      const playerBox = this.player.box();
      const blocked = boxIntersectsWorld({ isSolidAt: (bx, by, bz) => bx === x && by === y && bz === z }, playerBox);
      if (blocked) return;
      for (const mob of this.mobs.mobs) {
        if (boxIntersectsWorld({ isSolidAt: (bx, by, bz) => bx === x && by === y && bz === z }, mob.box())) return;
      }
    }

    if (!this.world.setBlock(x, y, z, block)) return;
    this.player.inventory.consumeHeld();
    if (block === Block.CHEST) this.world.setBlockEntity(x, y, z, createChest());
    if (block === Block.FURNACE) this.world.setBlockEntity(x, y, z, createFurnace());
  }

  /** Nearest mob whose bounding box the crosshair ray enters. */
  private mobUnderCrosshair(
    eye: { x: number; y: number; z: number },
    look: { x: number; y: number; z: number },
  ): Mob | null {
    let best: Mob | null = null;
    let bestDistance = ATTACK_REACH;
    for (const mob of this.mobs.mobs) {
      // A small margin makes mobs easier to hit than their exact hitbox.
      const margin = 0.15;
      const half = mob.def.width / 2 + margin;
      const distance = rayBoxDistance(
        eye,
        look,
        mob.x - half,
        mob.y - margin,
        mob.z - half,
        mob.x + half,
        mob.y + mob.def.height + margin,
        mob.z + half,
      );
      if (distance === null || distance > bestDistance) continue;
      best = mob;
      bestDistance = distance;
    }
    return best;
  }

  private attack(mob: Mob): void {
    const held = this.player.inventory.held;
    const damage = (held ? itemDef(held.id)?.attack : undefined) ?? 1;
    this.player.hunger.addExhaustion(EXHAUSTION.attack);
    this.mobs.hurt(mob, damage, this.player.x, this.player.z, this.mobContext());
  }

  // --- world simulation ------------------------------------------------------

  private mobContext(): MobUpdateContext {
    return {
      player: this.player,
      day: this.day,
      currentAt: (x, y, z) => this.water.flowAt(x, y, z),
      onPlayerHit: (damage, fromX, fromZ) => {
        const result = applyDamage(this.player, damage, this.player.inventory.defense);
        if (!result.applied) return;
        applyKnockback(this.player, fromX, fromZ, this.player.x, this.player.z, 4);
        this.player.hunger.addExhaustion(EXHAUSTION.damageTaken);
        this.hud.flashDamage();
      },
      onDrop: (x, y, z, stack) => {
        this.drops.spawn(x, y, z, stack);
      },
    };
  }

  private updateMobs(dt: number): void {
    this.mobs.update(dt, this.mobContext());
  }

  private updateDrops(dt: number): void {
    const collected = this.drops.update(dt, {
      x: this.player.x,
      y: this.player.y,
      z: this.player.z,
      collect: (stack) => this.player.inventory.add(stack),
    });
    for (const stack of collected) {
      this.hud.toast(`${itemDef(stack.id)?.label ?? stack.id} x${stack.count}`);
    }
  }

  private updateTicks(dt: number): void {
    this.tickTimer += dt;
    if (this.tickTimer < TICK_INTERVAL) return;
    this.tickTimer = 0;
    const pcx = toChunkCoord(this.player.x);
    const pcz = toChunkCoord(this.player.z);
    // Only simulate chunks close to the player, which is where changes are visible.
    for (let dz = -3; dz <= 3; dz++) {
      for (let dx = -3; dx <= 3; dx++) {
        const chunk = this.world.getChunk(pcx + dx, pcz + dz);
        if (chunk) randomTickChunk(this.world, chunk, this.tickRng);
      }
    }
  }

  private updateFurnaces(dt: number): void {
    for (const entity of this.world.blockEntities.values()) {
      if (isFurnace(entity)) tickFurnace(entity, dt);
    }
  }

  /** Closes a container screen once the player walks away from the block. */
  private checkOpenContainer(): void {
    if (!this.openContainerPos || !this.screens.isOpen) return;
    const distance = Math.hypot(
      this.player.x - this.openContainerPos.x,
      this.player.y - this.openContainerPos.y,
      this.player.z - this.openContainerPos.z,
    );
    if (distance > 7) this.closeScreen();
  }

  /** Sand and gravel fall when the block under them disappears. */
  private onBlockChanged(x: number, y: number, z: number, _previous: number, next: number): void {
    if (next !== Block.AIR) return;
    let above = y + 1;
    while (above < CHUNK_HEIGHT && blockDef(this.world.getBlock(x, above, z)).gravity) {
      const id = this.world.getBlock(x, above, z);
      this.world.setBlock(x, above, z, Block.AIR);
      this.world.setBlock(x, above - 1, z, id);
      above++;
    }
    // A crop or plant loses its support and pops off.
    const supported = this.world.getBlock(x, y + 1, z);
    const def = blockDef(supported);
    if (def.render === 'cross' && supported !== Block.AIR) {
      const drops = blockDrops(supported, undefined, { random: () => Math.random() });
      this.world.setBlock(x, y + 1, z, Block.AIR);
      for (const drop of drops) this.drops.spawn(x + 0.5, y + 1.5, z + 0.5, drop);
    }
  }

  private dropAtPlayer(stack: ItemStack): void {
    this.drops.spawn(this.player.x, this.player.y + 1, this.player.z, stack);
  }

  // --- screens and pausing ---------------------------------------------------

  private openScreen(open: () => void): void {
    open();
    this.options.input.releaseLock();
    document.body.classList.add('screen-open');
  }

  private closeScreen(): void {
    this.screens.close();
    this.openContainerPos = null;
    document.body.classList.remove('screen-open');
    if (!this.paused && !this.player.isDead) this.hud.setClickPrompt(!this.options.input.locked);
  }

  /** Changing the view distance takes effect on the next streaming pass. */
  setRenderDistance(chunks: number): void {
    this.renderDistance = chunks;
    this.camera.far = chunks * CHUNK_SIZE * 1.4;
    this.camera.updateProjectionMatrix();
    this.sky.setRenderDistance(chunks * CHUNK_SIZE);
  }

  togglePause(): void {
    this.paused = !this.paused;
    this.options.menus.showPause(this.paused);
    if (this.paused) {
      this.options.input.releaseLock();
      this.options.menus.showTitle(false);
    } else {
      this.options.menus.hideAll();
      this.hud.setClickPrompt(!this.options.input.locked);
    }
  }

  respawn(): void {
    this.options.menus.showDeath(false);
    // Everything the player was carrying stays where they died.
    const { x, y, z } = this.player;
    this.deathPoint = { x: Math.round(x), z: Math.round(z) };
    for (const inventory of [this.player.inventory, this.player.inventory.armor]) {
      for (const slot of inventory.slots) {
        if (slot) this.drops.spawn(x, y + 0.5, z, { ...slot });
      }
      inventory.clear();
    }
    this.hud.toast('持ち物は死んだ場所に落ちた');
    this.placeAtSpawn();
    this.player.respawn(this.player.x, this.player.y, this.player.z);
    this.settlePlayerOnGround();
    this.hud.setClickPrompt(!this.options.input.locked);
  }

  // --- spawn placement -------------------------------------------------------

  private placeAtSpawn(): void {
    const spawn = findSpawn(this.generator);
    this.spawnPoint = { x: spawn.x, z: spawn.z };
    this.player.teleportTo(spawn.x + 0.5, spawn.y, spawn.z + 0.5);
  }



  /** After the spawn chunk loads, drop the player onto the real surface. */
  private settlePlayerOnGround(): void {
    const x = Math.floor(this.player.x);
    const z = Math.floor(this.player.z);
    const top = this.world.heightAt(x, z);
    if (top >= 0) this.player.teleportTo(this.player.x, top + 1, this.player.z);
  }

  // --- persistence -----------------------------------------------------------

  save(announce = true): boolean {
    const edits: Record<string, string> = {};
    const water: Record<string, string> = {};
    for (const [key, map] of this.world.edits) {
      if (map.size === 0) continue;
      edits[key] = encodeEdits(map);
      // Water in edited chunks was shaped by the player, so it cannot be regenerated.
      const levels = this.world.waterOf(key);
      if (levels) water[key] = encodeWater(levels);
    }
    const chests: SaveData['chests'] = [];
    const furnaces: SaveData['furnaces'] = [];
    for (const [key, entity] of this.world.blockEntities) {
      const [x, y, z] = key.split(',').map(Number);
      if (isChest(entity)) chests.push({ pos: [x, y, z], slots: entity.slots.toJSON() });
      else if (isFurnace(entity)) {
        furnaces.push({
          pos: [x, y, z],
          slots: entity.slots.toJSON(),
          burnLeft: entity.burnLeft,
          burnTotal: entity.burnTotal,
          cookProgress: entity.cookProgress,
        });
      }
    }
    const data: SaveData = {
      version: SAVE_VERSION,
      seed: this.options.seed,
      time: this.day.time,
      weatherSeconds: this.weatherSeconds,
      savedAt: Date.now(),
      player: {
        x: this.player.x,
        y: this.player.y,
        z: this.player.z,
        yaw: this.player.yaw,
        pitch: this.player.pitch,
        health: this.player.health,
        food: this.player.hunger.food,
        saturation: this.player.hunger.saturation,
        selected: this.player.inventory.selected,
        inventory: this.player.inventory.toJSON(),
        armor: this.player.inventory.armor.toJSON(),
      },
      edits,
      water,
      chests,
      furnaces,
      villagers: this.mobs.mobs
        .filter((mob) => mob.kind === 'villager')
        .map((mob) => ({
          x: mob.x,
          y: mob.y,
          z: mob.z,
          profession: mob.profession ?? 'farmer',
          trades: tradesToJSON(mob.trades),
        })),
      populatedChunks: [...this.populatedChunks],
    };
    const ok = writeSave(data);
    if (announce) this.hud.toast(ok ? 'セーブしました' : 'セーブに失敗しました');
    return ok;
  }

  // --- debug helpers ---------------------------------------------------------

  /** Exposed on `window.voxelcraft` so the world can be poked from the console. */
  get debug() {
    return {
      game: this,
      player: this.player,
      isReady: (): boolean => this.ready,
      waterAt: (x: number, y: number, z: number): number => this.world.getWater(x, y, z),
      waterDepth: (x: number, y: number, z: number): number => this.water.depthAt(x, y, z),
      activeWaterCells: (): number => this.water.activeCount,
      pourWater: (x: number, y: number, z: number, blocks = 1): void => {
        for (let i = 0; i < blocks; i++) this.water.pour(x, y + i, z);
      },
      heal: (): void => {
        this.player.health = this.player.maxHealth;
        this.player.hunger.reset();
      },
      pending: (): number => this.pool.pending,
      world: this.world,
      give: (id: string, count = 1): number => this.player.inventory.add({ id, count }),
      setTime: (time: number): void => {
        this.day.time = ((time % 1) + 1) % 1;
      },
      toggleDayCycle: (): boolean => (this.day.running = !this.day.running),
      toggleFly: (): boolean => (this.player.flying = !this.player.flying),
      teleport: (x: number, z: number): void => {
        // Land just above the terrain; unstick() lifts the player out of any building.
        this.player.teleportTo(x + 0.5, this.generator.height(Math.floor(x), Math.floor(z)) + 2, z + 0.5);
      },
      /** Jumps to the nearest generated village, which is otherwise a long walk. */
      gotoVillage: (): { x: number; z: number } | null => {
        const village = this.generator.findNearestVillage(this.player.x, this.player.z, 4);
        if (village) this.debug.teleport(village.x, village.z);
        return village;
      },
      /** Opens a container screen without having to place and click the block. */
      openScreen: (kind: 'inventory' | 'crafting' | 'furnace' | 'chest'): void => {
        this.openScreen(() => {
          if (kind === 'crafting') this.screens.openCraftingTable();
          else if (kind === 'furnace') this.screens.openFurnace(createFurnace());
          else if (kind === 'chest') this.screens.openChest(createChest().slots);
          else this.screens.openInventory();
        });
      },
      biome: (): string =>
        biomeDef(this.generator.biomeAt(Math.floor(this.player.x), Math.floor(this.player.z))).label,
      mobs: () => this.mobs.mobs,
      /** The mob the crosshair is currently on, if any. */
      pick: (): Mob | null =>
        this.mobUnderCrosshair({ x: this.player.x, y: this.player.eyeY, z: this.player.z }, this.player.lookVector()),
      /** Spawns a mob straight ahead of the camera so it is easy to look at. */
      spawnMob: (kind: MobKind, distance = 4): Mob => {
        const look = this.player.lookVector();
        const length = Math.hypot(look.x, look.z) || 1;
        const x = this.player.x + (look.x / length) * distance;
        const z = this.player.z + (look.z / length) * distance;
        // Spawn at the player's own level so the mob lands on whatever they stand on.
        const y = this.player.y + 0.1;
        if (kind === 'villager') {
          const professions = ['farmer', 'blacksmith', 'librarian', 'butcher'];
          return this.mobs.addVillager(x, y, z, professions[Math.floor(Math.random() * professions.length)]);
        }
        return this.mobs.add(new Mob(kind, x, y, z));
      },
      /** Jumps to the bank of the nearest generated river. */
      gotoRiver: (): { x: number; z: number; surface: number } | null => {
        const startX = Math.floor(this.player.x);
        const startZ = Math.floor(this.player.z);
        for (let radius = 0; radius < 700; radius += 5) {
          for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 16) {
            const x = startX + Math.round(Math.cos(angle) * radius);
            const z = startZ + Math.round(Math.sin(angle) * radius);
            const river = this.generator.riverAt(x, z);
            if (river.strength < 0.85) continue;
            // Inland enough to be a proper channel rather than the tidal mouth, and
            // actually cut below its own water line.
            if (river.surface <= SEA_LEVEL + 4) continue;
            if (!riverCovers(river, this.generator.height(x, z))) continue;
            // Land on the nearest dry bank rather than in the water.
            for (let offset = 4; offset < 14; offset++) {
              for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                const bx = x + dx * offset;
                const bz = z + dz * offset;
                if (this.generator.height(bx, bz) + 1 >= river.surface) {
                  this.debug.teleport(bx, bz);
                  return { x, z, surface: river.surface };
                }
              }
            }
            this.debug.teleport(x, z);
            return { x, z, surface: river.surface };
          }
        }
        return null;
      },
      /** River channel data at a column, for tests and debugging. */
      riverAt: (x: number, z: number) => this.generator.riverAt(x, z),
      /** The weather where the player is standing. */
      weather: () => {
        const forecast = this.forecast();
        return {
          here: forecast.here.kind,
          endsIn: Math.round(forecast.here.endsIn),
          next: forecast.next,
          upstream: forecast.upstream,
          delay: Math.round(forecast.delay),
          wetness: Number(forecast.wetness.toFixed(3)),
          seconds: Math.round(this.weatherSeconds),
        };
      },
      /** Jumps the clock to the middle of the next season of a kind, allowing for how
       *  long the water takes to reach the player. Used by the browser tests, which
       *  cannot wait ten minutes for a drought. */
      setWeather: (kind: Season): number => {
        const delay = travelDelay(this.generator.inlandAt(this.player.x, this.player.z));
        const from = Math.floor(Math.max(0, this.weatherSeconds - delay) / SEASON_LENGTH_SECONDS);
        for (let step = 0; step < 8; step++) {
          const index = from + step;
          if (seasonAt(this.options.seed, (index + 0.5) * SEASON_LENGTH_SECONDS).kind !== kind) {
            continue;
          }
          this.advanceWeather((index + 0.5) * SEASON_LENGTH_SECONDS + delay);
          break;
        }
        return this.weatherSeconds;
      },
      /** Height of the water's top face in a column, or null when it is dry. */
      waterSurface: (x: number, z: number): number | null => {
        for (let y = CHUNK_HEIGHT - 1; y > 0; y--) {
          const level = this.world.getWater(x, y, z);
          if (level > 0) return Number((y + Math.min(1, level / WATER_FULL)).toFixed(3));
        }
        return null;
      },
      /** Drops the player into the nearest cave below, for testing underground light. */
      findCave: (): { x: number; y: number; z: number } | null => {
        const x = Math.floor(this.player.x);
        const z = Math.floor(this.player.z);
        for (let radius = 0; radius < 48; radius += 4) {
          for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
            const cx = x + Math.round(Math.cos(angle) * radius);
            const cz = z + Math.round(Math.sin(angle) * radius);
            if (!this.world.isLoadedAt(cx, cz)) continue;
            for (let y = 40; y > 6; y--) {
              const open =
                this.world.getBlock(cx, y, cz) === Block.AIR &&
                this.world.getBlock(cx, y + 1, cz) === Block.AIR &&
                blockDef(this.world.getBlock(cx, y - 1, cz)).solid;
              if (!open) continue;
              this.player.teleportTo(cx + 0.5, y, cz + 0.5);
              return { x: cx, y, z: cz };
            }
          }
        }
        return null;
      },
    };
  }

  private applySave(data: SaveData): void {
    this.day.time = data.time;
    // Saves made before the weather existed simply start the cycle over.
    this.advanceWeather(data.weatherSeconds ?? 0);
    const player = data.player;
    this.player.x = player.x;
    this.player.y = player.y;
    this.player.z = player.z;
    this.player.yaw = player.yaw;
    this.player.pitch = player.pitch;
    this.player.health = player.health;
    this.player.hunger.loadJSON({ food: player.food, saturation: player.saturation });
    this.player.inventory.loadJSON(player.inventory);
    this.player.inventory.armor.loadJSON(player.armor);
    this.player.inventory.selected = player.selected;

    for (const [key, encoded] of Object.entries(data.edits)) {
      this.world.edits.set(key, decodeEdits(encoded));
    }
    for (const [key, encoded] of Object.entries(data.water ?? {})) {
      this.world.waterSnapshots.set(key, decodeWater(encoded, CHUNK_VOLUME));
    }
    for (const chest of data.chests) {
      const slots = new Inventory(27);
      slots.loadJSON(chest.slots);
      this.world.setBlockEntity(chest.pos[0], chest.pos[1], chest.pos[2], createChest(slots));
    }
    for (const furnace of data.furnaces) {
      const entity = createFurnace();
      entity.slots.loadJSON(furnace.slots);
      entity.burnLeft = furnace.burnLeft;
      entity.burnTotal = furnace.burnTotal;
      entity.cookProgress = furnace.cookProgress;
      this.world.setBlockEntity(furnace.pos[0], furnace.pos[1], furnace.pos[2], entity);
    }
    for (const key of data.populatedChunks) this.populatedChunks.add(key);
    for (const villager of data.villagers) {
      const mob = this.mobs.addVillager(villager.x, villager.y, villager.z, villager.profession);
      const trades = tradesFromJSON(villager.trades);
      if (trades.length > 0) mob.trades = trades;
    }
  }
}

/** Slab method: distance along the ray at which it enters the box, or null. */
function rayBoxDistance(
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): number | null {
  let near = 0;
  let far = Infinity;
  const axes: [number, number, number, number][] = [
    [origin.x, direction.x, minX, maxX],
    [origin.y, direction.y, minY, maxY],
    [origin.z, direction.z, minZ, maxZ],
  ];
  for (const [start, delta, low, high] of axes) {
    if (Math.abs(delta) < 1e-8) {
      if (start < low || start > high) return null;
      continue;
    }
    const t1 = (low - start) / delta;
    const t2 = (high - start) / delta;
    near = Math.max(near, Math.min(t1, t2));
    far = Math.min(far, Math.max(t1, t2));
    if (near > far) return null;
  }
  return far < 0 ? null : near;
}

/** How hard a spring runs for a given wetness. It never stops altogether: a drought
 *  makes the water worth saving, not impossible to get. */
function springRate(wetness: number): number {
  return Math.max(0.25, Math.min(1.75, 1 + wetness * 0.75));
}
