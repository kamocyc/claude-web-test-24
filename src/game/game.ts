import * as THREE from 'three';
import { boxIntersectsWorld } from '../core/aabb';
import { mulberry32 } from '../core/rng';
import { ChunkRenderer } from '../render/chunkRenderer';
import { Effects } from '../render/effects';
import { EntityRenderer } from '../render/entityRenderer';
import { RouteGuide, type GuideBeam, type GuideLine, type GuidePoint, type GuideView } from '../render/routeGuide';
import {
  SAMPLE_STEP,
  SLEEPER_THICK,
  TrackRenderer,
  type TrackEdgeView,
  type TrackGhostView,
  type TrackMarkerView,
  type TrackPierView,
  type TrackView,
} from '../render/trackRenderer';
import { createChunkMaterials, type ChunkMaterials } from '../render/materials';
import { Sky } from '../render/sky';
import { Rain } from '../render/rain';
import { buildAtlas, type Atlas } from '../render/textures';
import { Block, type BlockId, blockDef, isFarmland, isReplaceable, supportsPlant } from '../world/blocks';
import {
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  CHUNK_VOLUME,
  Chunk,
  SEA_LEVEL,
  blockIndex,
  chunkKey,
  toChunkCoord,
  toLocalCoord,
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
import { WarpDialog } from '../ui/warpDialog';
import { clampWarpY, type WarpTarget } from './warp';
import { createChest, createFurnace, isChest, isFurnace } from './blockEntities';
import { applyDamage, applyKnockback } from './combat';
import { DIFFICULTIES, type Difficulty, difficultyRules } from './difficulty';
import { DayCycle } from './daycycle';
import { DropManager } from './drops';
import { EXHAUSTION } from './hunger';
import { HOTBAR_SIZE, Inventory, type ItemStack } from './inventory';
import { allItems, itemDef, itemLabel } from './items';
import { fillVillageChest } from './loot';
import { bestToolSlot, blockDrops, heldTool, miningTime } from './mining';
import { Mob } from './mobs/ai';
import { MobManager, type MobUpdateContext } from './mobs/spawner';
import { HAULING_KINDS, type MobKind } from './mobs/types';
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
import { SPEEDS, nearestSpeed, type Settings } from './settings';
import { tickFurnace } from './smelting';
import { generateTrades, restockTrades, tradesFromJSON, tradesToJSON } from './trading';
import { VILLAGE_RADIUS, type Footprint, type HouseRecord } from '../world/generation/village';
import {
  HEADROOM,
  MAX_STEP,
  ROAD_SPEED,
  RoadNetwork,
  faultText,
  type RoadFault,
  type RoadPoint,
} from './roads';
import {
  MAX_GRADE,
  MAX_SPAN,
  MIN_RADIUS,
  MIN_SPAN,
  SNAP_RADIUS,
  TrackNetwork,
  pointAt,
  railsFor,
  sampleTrack,
  solveTrack,
  straightSamples,
  summarise,
  tangentAt,
  type TrackAnchor,
  type TrackFault,
  type TrackNode,
  type TrackPoint,
  type TrackSummary,
  type TrackSample,
} from './tracks';
import { runRoad, treadBrush, treadLine, TREAD_DIRT, type PaveMaterial, type PaveTarget } from './paving';
import {
  CATCH_UP,
  PORTER_LEASH,
  PORTER_LOST,
  TransportNetwork,
  type Arrival,
  type PorterView,
  type Route,
  type Vehicle,
} from './transport';
import {
  STAGE_POINTS,
  VillageRegistry,
  displayName,
  kindLabel,
  radiusOf,
  rankLabel,
  villageId,
  type VillageId,
  type VillageRecord,
} from './villages';
import type { LedgerView } from '../ui/ledger';
import type { RouteIdle } from '../ui/routePanel';
import { helpView, type HelpView } from '../ui/help';
import { applyGrowth, growthChunks, growthFor, growthVillagers, outpostBuildings, ownPaving, roadCrosses } from './villageGrowth';
import {
  buildingAt,
  buildingsOf,
  depotOf,
  describeBuilding,
  type VillageBuilding,
} from './buildings';
import { outpostRecord, outpostSite } from './outpost';
import { MILESTONES, Questline, gapText, type NetworkState, type QuestInteraction } from './questline';
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

/** Villages further apart than this are not worth a porter walking between them, so the
 *  network never watches a pair it would never run. */
const AUTO_ROUTE_RANGE = 900;
/** A ceiling on watched pairs, so a very well explored world cannot make surveying the
 *  network expensive. */
const MAX_ROUTES = 24;
const ATTACK_REACH = 3.6;
const AUTOSAVE_SECONDS = 30;
/** Half the span the minimap covers, so only nearby roads are handed to it. */
const MINIMAP_REACH = 130;
/** How far away a building can be named. Longer than the player's reach, because naming
 *  a building is about looking at it, not about touching it. */
const BUILDING_REACH = 28;
/** How far the road tiles of the in-world guide reach. Small on purpose: it is there to
 *  answer "does the game count *this* as road", which is a question about the ground the
 *  player is standing on. */
const GUIDE_TILE_REACH = 40;
/** Line colours, matching the minimap and the panel so the three read as one thing. */
const GUIDE_ROAD = 0x5cff92;
const GUIDE_GAP = 0xffa04d;
const GUIDE_PORTER = 0x8ef0b8;
/** Road the index refuses, and road too narrow for a cart. Both are "you built this and
 *  it does not count", which is the one thing the world itself has to say out loud. */
const GUIDE_FAULT = 0xff5a5a;
const GUIDE_NARROW = 0xffc457;
/** Where the rails run out. Violet, because amber already means "too narrow" and red
 *  already means "does not count" — three different jobs need three different colours. */
const GUIDE_RAILGAP = 0xb08cff;
/** The doorway a route loads and unloads at. */
const GUIDE_DEPOT = 0xffd479;
/** Blocks of height a laid road may gain or lose per column — deliberately gentler than
 *  the step the index will walk.
 *
 *  Matching the index exactly is not enough once a road is wide. An angled road is a
 *  staircase, so the band either side of the line is made of cells that belong to columns
 *  several steps apart, and a line climbing a block at every one of them leaves that band
 *  two blocks out of level with what it is widening — a road three columns across
 *  everywhere and passable nowhere. Half a block per column keeps the whole ribbon within
 *  the one step the rule allows. */
const ROAD_GRADE = MAX_STEP / 2;
/** How far ahead `[R]` will run a road back to the player's feet. A road is continuous
 *  now, so this is the one place the player says "and the twenty blocks in between". */
const ROAD_REACH = 20;

/** How far the free-form track tool reaches.
 *
 *  Far further than the hand's REACH, and further again than `R`: one gesture lays a
 *  whole curve, so what the tool can touch has to be the length of one. */
const TRACK_REACH = 48;
/** Clear of the face the click landed on, so the deck cannot z-fight with the ground. */
const TRACK_LIFT = 0.06;
/** How near the crosshair has to pass a laid curve to pick it up for removal. */
const TRACK_PICK = 1.2;
/** Track beyond this is not built into the mesh. */
const TRACK_DRAW = 128;
/** Spacing of the legs under floating track, and the drop one has to bridge to appear. */
const PIER_STEP = 4;
const PIER_MIN_GAP = 0.4;
/** How often the track's geometry is worked out again even though nothing about the track
 *  changed. Piers are the reason: the ground under a run streams in after the run does,
 *  and a leg that only appeared when the player next laid something would never appear. */
const TRACK_VIEW_INTERVAL = 1;
/** The pending start of a curve, and every end a new curve could be joined to. The
 *  second one is how a player finds out that snapping exists at all. */
const TRACK_START_MARK = 0xffbb33;
const TRACK_END_MARK = 0x66ccff;
/** The length of road the sample world starts with, in blocks. Villages sit on a 320
 *  block grid, so this picks a neighbour rather than the village next door. */
const SAMPLE_ROAD = 400;
/** Seconds between two passes of a held shovel, so paving happens at a walking pace
 *  rather than at the frame rate. */
const PAVE_INTERVAL = 0.06;
/** How far behind a jumped cursor the sweep will fill in. A crosshair skips several
 *  blocks whenever the player turns, and a road with a hole in it is two roads. */
const PAVE_BRIDGE = 12;
/** Width of the road the sample world is built with. Three columns is what a cart needs,
 *  and a sample road nobody can run a cart down teaches the wrong half of the lesson. */
const SAMPLE_WIDTH = 3;
/** Columns of the sample road left unrailed, at the end the player starts on.
 *
 *  A railway handed over finished shows the train and nothing else: not the tools, not
 *  the violet beacon over the break, not what a line looks like while it is half done.
 *  Leaving the near end bare puts all three in front of the player at once, and the walk
 *  to close it is three presses of `[R]` rather than an afternoon. */
const SAMPLE_RAIL_GAP = 60;
/** Rails the sample world hands over: enough for the gap, and enough over it that a
 *  wandering line or a second thought does not strand the player halfway. */
const SAMPLE_RAIL_SPARE = 24;
/** Seconds between two complaints about a road that will not take. Often enough to catch
 *  the branch the player is standing under, rarely enough to stay out of the way. */
const FAULT_TOAST_INTERVAL = 4;
/** How far around the player the world looks for faults to draw. */
const FAULT_REACH = 40;
/** Milliseconds a frame will spend running the world forward before it gives up on the
 *  rest of the requested speed. Roughly half a 30fps frame. */
const WORLD_BUDGET_MS = 12;
/** What a brand new world hands the player, and how much of each. */
const STARTING_KIT: readonly string[] = ['oak_planks', 'dirt'];
const STARTING_COUNT = 32;

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
  /** Start with a road already built between two villages, and the player standing on
   *  one end of it. See `buildSampleRoad`. */
  sample?: boolean;
  onQuit(): void;
}

export class Game {
  readonly world: World;
  readonly player = new Player();
  /** Which difficulty the player has already been told about; null until the first frame
   *  settles it, so loading a world on 平和 does not announce itself. */
  private difficultyAnnounced: Difficulty | null = null;
  /** A respawn is waiting for its chunk before it can put the player on the ground. */
  private settlePending = false;
  readonly day = new DayCycle();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly atlas: Atlas;
  private readonly materials: ChunkMaterials;
  private readonly chunkRenderer: ChunkRenderer;
  private readonly entityRenderer: EntityRenderer;
  private readonly routeGuide = new RouteGuide();
  private readonly trackRenderer = new TrackRenderer();
  /** The free-form railway. Not readonly: a save replaces it wholesale. */
  private trackNet = new TrackNetwork();
  /** The start of a curve that has been clicked but not yet finished. */
  private trackDraft: { anchor: TrackAnchor; node: number | null } | null = null;
  private trackGhost: TrackGhostView | null = null;
  /** Why the shape under the crosshair will not be built, for the console and the toast. */
  private trackGhostFault: TrackFault | null = null;
  /** What the shape under the crosshair is, for the readout under the crosshair. */
  private trackReadout: { lines: string[]; fault: string | null } | null = null;
  private trackViewCache: TrackView | null = null;
  private trackViewKey = '';
  private trackViewTimer = 0;
  /** Draped guide lines by route, so a road is only walked over again when it moves. */
  private readonly guideLines = new Map<string, { key: string; points: GuidePoint[] }>();
  /** Buildings by village, rebuilt only when the village grows a new one. */
  private readonly villageBuildings = new Map<string, { stage: number; roads: number; list: VillageBuilding[] }>();
  /** The building the player is looking at, refreshed with the rest of the interaction. */
  private lookedAt: { building: VillageBuilding; village: VillageRecord } | null = null;
  private focusCache: { at: number; route: Route | undefined } = { at: -1e9, route: undefined };
  private readonly effects: Effects;
  private readonly sky: Sky;
  private readonly rain: Rain;
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
  /** Debug jump box, opened with G. */
  private readonly warpDialog = new WarpDialog();
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
  /** Where the shovel last trod, so a sweep can fill in the blocks the crosshair skipped
   *  over rather than leaving a dotted line behind. */
  private paveFrom: { x: number; y: number; z: number } | null = null;
  private paveTimer = 0;
  private faultToastTimer = 0;
  /** Held until the world is ready, because a toast raised during construction would be
   *  shown to a screen that is still saying "generating terrain". */
  private sampleToast: string | null = null;
  /** The same, for the sample world's half-built railway. Two toasts rather than one
   *  sentence: what is there and what is missing are two different things to read. */
  private railToast: string | null = null;
  /** World steps the last frame actually managed, which is what the HUD reports. */
  private effectiveSpeed = 1;
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
  /** The village economy: who makes what, which roads link them, and what the tutorial
   *  is currently asking for. */
  private readonly villages: VillageRegistry;
  private readonly roads: RoadNetwork;
  private readonly transport: TransportNetwork;
  private readonly questline = new Questline();
  /** Villagers a village earned by growing whose chunk was not loaded at the time. */
  private readonly pendingVillagers: { x: number; y: number; z: number; profession: string }[] = [];
  /** Porter mobs by the id transport knows them under. */
  private readonly porterMobs = new Map<number, Mob>();
  /** Freight the network has paid the player, and anything it could not hand over
   *  because the inventory was full — that is owed, not lost. */
  private freightEarned = 0;
  private freightOwed = 0;

  constructor(private readonly options: GameOptions) {
    this.world = new World(options.seed);
    this.generator = new TerrainGenerator(options.seed);
    this.light = new LightEngine(this.world);
    this.water = new WaterSimulator(this.world);
    this.riverFlow = new RiverFlow(this.world);
    this.villages = new VillageRegistry(options.seed, this.generator);
    this.roads = new RoadNetwork(this.world);
    this.world.onBlockChange((x, y, z, previous, next) => {
      this.light.onBlockChanged(x, y, z, previous, next);
      this.water.onBlockChanged(x, y, z, previous, next);
      this.roads.onBlockChanged(x, y, z, previous, next);
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
    this.rain = new Rain(this.scene);
    this.scene.add(
      this.chunkRenderer.group, this.entityRenderer.group, this.effects.group,
      this.routeGuide.group, this.trackRenderer.group,
    );

    this.mobs = new MobManager(this.world, options.seed);
    this.drops = new DropManager(this.world);
    this.transport = new TransportNetwork(
      this.roads,
      this.villages,
      {
        onConnected: (route) => this.onRouteConnected(route),
        onDisconnected: (route) => this.announceRoute(route, 'とぎれた'),
        onArrival: (arrival) => this.onShipmentArrived(arrival),
        onStageUp: (id, stage) => this.onVillageGrew(id, stage),
      },
      {
        spawnPorter: (point, vehicle) => this.spawnPorter(point, vehicle),
        porterPosition: (id) => {
          const mob = this.livePorter(id);
          return mob ? { x: mob.x, z: mob.z } : null;
        },
        movePorter: (id, point, speed) => this.movePorter(id, point, speed),
        removePorter: (id) => this.removePorter(id),
      },
      {
        doorOf: (id) => this.depotDoor(id),
        plotsOf: (id) => {
          const village = this.villages.get(id);
          return village ? this.buildingsFor(village) : [];
        },
      },
    );
    this.hud = new Hud(this.atlas);
    this.screens = new ScreenManager(
      this.player,
      this.atlas,
      (stack) => this.dropAtPlayer(stack),
      (recipe, made) => this.hud.toast(`${itemLabel(recipe.result.id)} を ${made * recipe.result.count} 個作った`),
    );

    document.body.append(this.hud.root, this.screens.layer, this.warpDialog.root);
    this.warpDialog.bind(
      (target) => this.warpTo(target),
      () => this.closeWarpDialog(),
    );

    this.pool = new ChunkWorkerPool(options.seed);
    this.pool.setHandler((message) => this.onChunkReady(message));

    if (options.save) {
      this.applySave(options.save);
    } else {
      if (options.sample) this.buildSampleRoad();
      else this.placeAtSpawn();
      this.stockStartingKit();
    }

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
    this.rain.dispose();
    this.pool.dispose();
    this.chunkRenderer.dispose();
    this.trackRenderer.dispose();
    this.hud.root.remove();
    this.screens.close();
    this.screens.layer.remove();
    this.warpDialog.root.remove();
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
    this.render(dt);
    this.options.input.endFrame();
  };

  private update(dt: number): void {
    // Read rather than pushed: the setting can be flipped from the pause menu, from the
    // console, or by a preferences file loaded at boot, and one assignment a frame is
    // cheaper than three places remembering to call a setter.
    this.player.inventory.unlimited = this.options.settings.creative;
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
        if (this.sampleToast) {
          this.hud.toast(this.sampleToast);
          this.sampleToast = null;
        }
        if (this.railToast) {
          this.hud.toast(this.railToast);
          this.railToast = null;
        }
        // Pointer lock can only be requested from a real user gesture, so the player
        // clicks once to start looking around.
        this.hud.setClickPrompt(true);
      }
      return;
    }

    if (this.paused || this.player.isDead) {
      if (this.player.isDead) {
        this.options.menus.showDeath(true);
        // However the pointer came to be locked, the cursor has to come back or the
        // respawn button cannot be clicked.
        this.options.input.releaseLock();
      }
      this.hud.update(dt, this.player, this.debugInfo(), this.navigationInfo());
      return;
    }

    this.player.autoStep = this.options.settings.autoStep;
    // Assigned every frame rather than once, because loading a save replaces the network
    // wholesale. Mobs and dropped items are deliberately not given it: nothing else has a
    // reason to be up on a viaduct, and a porter that wandered onto one could not get off.
    this.player.surface = this.trackNet;
    this.applyDifficulty();
    if (this.settlePending && this.settlePlayerOnGround()) this.settlePending = false;
    this.water.setCenter(this.player.x, this.player.z);
    this.runWorld(dt);
    this.materials.setSun(Math.max(0.06, this.day.sunLight));

    // Only mouse look needs pointer lock; keyboard and clicks keep working without it
    // so the game stays playable if the browser refuses to lock the cursor.
    const screenOpen = this.uiOpen;
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
      // Registering is what makes a village *knowable*; walking into it is what makes it
      // discovered. Both ride the same timer because both walk the same village grid.
      this.villages.ensureNear(this.player.x, this.player.z, 2);
      this.nearestVillage = this.generator.findNearestVillage(this.player.x, this.player.z, 2);
      this.linkNeighbours();
      this.claimMilestones();
    }

    this.autosaveTimer += dt;
    if (this.autosaveTimer >= AUTOSAVE_SECONDS) {
      this.autosaveTimer = 0;
      this.save(false);
    }
  }

  /** Runs the world's own clock, as many times as the game speed asks for.
   *
   *  Fast forward multiplies *steps*, never `dt`. A frame of `dt * 16` would hand the
   *  collision sweep, the water simulation and every other fixed-step assumption a number
   *  they were never written for; sixteen ordinary steps hand them exactly what they
   *  already handle. And only the world is stepped — the player's own update, their
   *  input, their mining and their hunger stay outside, so the clock racing does not take
   *  the controls with it. Their damage cooldown is out here too, which is why sixteen
   *  times the world is not sixteen times the danger.
   *
   *  The budget is the honest part. A slow machine cannot do sixteen steps in a frame, so
   *  it does what it can and the HUD says how many that was rather than pretending. */
  private runWorld(dt: number): void {
    const wanted = Math.max(1, Math.round(this.options.settings.speed));
    const deadline = performance.now() + WORLD_BUDGET_MS;
    let steps = 0;
    while (steps < wanted) {
      this.stepWorld(dt);
      steps++;
      // The first step always runs; after that, stop rather than drop the frame rate.
      if (steps < wanted && performance.now() > deadline) break;
    }
    this.effectiveSpeed = steps;
  }

  /** One step of everything that is not the player. */
  private stepWorld(dt: number): void {
    this.advanceWeather(this.weatherSeconds + dt);
    this.water.update(dt);
    this.riverFlow.update(dt);
    this.day.update(dt);
    this.updateMobs(dt);
    this.updateDrops(dt);
    this.updateTicks(dt);
    this.updateFurnaces(dt);
    this.updateVillages(dt);
  }

  /** Sets the world's clock speed, and says so. */
  setSpeed(speed: number): number {
    const next = nearestSpeed(speed);
    this.options.settings.speed = next;
    this.hud.toast(next === 1 ? 'ゲーム速度 ×1（等速）' : `ゲーム速度 ×${next}`);
    return next;
  }

  /** Steps up or down the offered speeds. */
  private nudgeSpeed(by: 1 | -1): void {
    const at = SPEEDS.indexOf(nearestSpeed(this.options.settings.speed));
    const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, at + by))];
    if (next !== this.options.settings.speed) this.setSpeed(next);
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

  private render(dt: number): void {
    this.routeGuide.setVisible(this.options.settings.guide);
    if (this.options.settings.guide) this.routeGuide.update(this.guideView(), dt);
    // Not behind the guide setting: laid track is something the player built, not a
    // hint drawn over the world. What the setting would switch off is the ghost, and
    // that is already gated on holding the tool.
    this.trackRenderer.update(this.trackView(dt));
    this.camera.position.set(this.player.x, this.player.eyeY, this.player.z);
    this.camera.rotation.set(this.player.pitch, this.player.yaw, 0, 'YXZ');
    const wetness = this.forecast().wetness;
    this.sky.update(this.day, this.camera, this.renderer, wetness);
    this.rain.update(dt, this.camera, wetness, this.day.sunLight);
    this.renderer.render(this.scene, this.camera);
  }

  /** Places worth walking back to, refreshed at most once a second because finding
   *  the nearest village walks the village grid. */
  private navigationInfo(): NavigationInfo {
    const markers: CompassMarker[] = [{ kind: 'spawn', x: this.spawnPoint.x, z: this.spawnPoint.z }];
    if (this.deathPoint) markers.push({ kind: 'death', x: this.deathPoint.x, z: this.deathPoint.z });
    const found = this.villages.discovered();
    for (const village of found) markers.push({ kind: 'village', x: village.x, z: village.z });
    // A village the player has not walked into yet still gets the old single marker, so
    // there is always something to head towards.
    if (found.length === 0 && this.nearestVillage) {
      markers.push({ kind: 'village', x: this.nearestVillage.x, z: this.nearestVillage.z });
    }
    const questRoute = this.focusRoute();
    const objective = this.questline.objective(this.villages, questRoute, this.networkState());
    // Whatever the objective is pointing at gets its own marker. The village being
    // carried to has not been walked into yet, so it is not in `found` — without this the
    // player is told to take the wool to 朝の炭 and given no idea which way that is. A
    // gap marker points at where the road stops rather than at the destination: there,
    // the thing to walk to is the stretch that needs fixing.
    const aim = objective?.marker ?? null;
    if (aim) markers.push({ kind: aim.kind === 'gap' ? 'gap' : 'target', x: aim.x, z: aim.z });
    // Where the goods actually are. "The road is joined up but nothing is being carried"
    // is nearly always "the porter is two hundred blocks away, behind you", so the
    // shipments get markers of their own rather than only a count on the panel.
    const shipments = this.transport.porterViews();
    for (const porter of shipments) markers.push({ kind: 'porter', x: porter.x, z: porter.z });
    const forecast = this.forecast();
    return {
      world: this.world,
      markers,
      showCompass: this.options.settings.compass,
      showMinimap: this.options.settings.minimap,
      showForecast: this.options.settings.forecast,
      showRoutes: this.options.settings.routes,
      showCoords: this.options.settings.coords,
      building: this.buildingPrompt(),
      track: this.heldTrackTool() ? this.trackReadout : null,
      overlay: {
        markers,
        // Only the roads that could be on screen: the index holds every column the player
        // ever laid, and the map covers a couple of hundred blocks.
        roads: this.roads.columnsIn(
          this.player.x - MINIMAP_REACH,
          this.player.z - MINIMAP_REACH,
          this.player.x + MINIMAP_REACH,
          this.player.z + MINIMAP_REACH,
        ),
        gap:
          questRoute?.gapFrom && questRoute.gapTo
            ? { from: questRoute.gapFrom, to: questRoute.gapTo }
            : null,
        faults: this.roadFaults(MINIMAP_REACH),
      },
      routes: {
        quest: objective,
        // How far, and which way. The compass carries the same marker, but the panel is
        // where the player looks to know whether it is a walk or an expedition.
        aim: aim
          ? {
              distance: Math.hypot(aim.x - this.player.x, aim.z - this.player.z),
              bearing: (Math.atan2(aim.x - this.player.x, -(aim.z - this.player.z)) * 180) / Math.PI,
            }
          : null,
        // Only the lines worth a row: the ones that work, the one the tutorial is asking
        // for, and any that used to work and have been dug up. Every other watched pair
        // would just be a wall of "not connected".
        routes: this.transport.routes
          .filter((route) => route.connected || route.everConnected || route === questRoute)
          .map((route) => ({
            from: this.villages.get(route.from)?.name ?? '?',
            to: this.villages.get(route.to)?.name ?? '?',
            surveyed: route.surveyed,
            connected: route.connected,
            length: route.length,
            missing: route.missing,
            porters: route.porters.length,
            fromDepot: this.depotLabel(route.from),
            toDepot: this.depotLabel(route.to),
            nearest: this.nearestPorter(shipments, route),
            stock: this.stockOn(route),
            idle: this.idleReason(route),
            grade: route.grade,
            load: this.transport.loadOf(route),
            wanted: this.villages.get(route.to)?.needs.includes(route.good) ?? false,
            vehicle: route.vehicle,
            cartPinch: route.cartPinch ? this.bearingTo(route.cartPinch) : null,
            railPinch: route.railPinch ? this.bearingTo(route.railPinch) : null,
            climb: route.climb,
            detour: route.detour,
            doorGap: route.doorGap,
            // Only the faults near the break the player is being pointed at. Everything
            // the index refuses everywhere would be a list, and a list is not a place.
            faults: route.gapFrom ? this.roads.faults(route.gapFrom.x, route.gapFrom.z, 12) : [],
            nearMiss: route.nearMiss !== null,
          })),
      },
      forecast: {
        here: forecast.here.kind,
        endsIn: forecast.here.endsIn,
        next: forecast.next,
        upstream: forecast.upstream,
        wetness: forecast.wetness,
      },
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
      speed: this.options.settings.speed,
      effectiveSpeed: this.effectiveSpeed,
      creative: this.options.settings.creative,
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
    // Before lighting is seeded, so a village that grew while this chunk was away has its
    // new walls in place when the light is baked against them.
    for (const village of this.villages.byId.values()) {
      if (village.stage <= 0 && !village.outpost) continue;
      if (Math.abs(village.x - chunk.originX) > VILLAGE_RADIUS + CHUNK_SIZE) continue;
      if (Math.abs(village.z - chunk.originZ) > VILLAGE_RADIUS + CHUNK_SIZE) continue;
      this.buildGrowth(village, chunk);
    }
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
          if (this.screens.isOpen) this.closeScreen();
          else if (this.warpDialog.isOpen) this.closeWarpDialog();
          else this.togglePause();
          break;
        case 'KeyE':
          if (this.paused || this.player.isDead) break;
          if (this.warpDialog.isOpen) this.closeWarpDialog();
          else if (this.screens.isOpen) this.closeScreen();
          else this.openScreen(() => this.screens.openInventory());
          break;
        case 'BracketLeft':
          if (this.paused || this.player.isDead || this.uiOpen) break;
          this.nudgeSpeed(-1);
          break;
        case 'BracketRight':
          if (this.paused || this.player.isDead || this.uiOpen) break;
          this.nudgeSpeed(1);
          break;
        case 'KeyH':
          if (this.player.isDead) break;
          this.openHelp();
          break;
        case 'F3':
          event.preventDefault();
          this.hud.toggleDebug();
          break;
        case 'KeyC':
          if (this.paused || this.player.isDead) break;
          if (this.screens.kind === 'creative') this.closeScreen();
          else if (!this.options.settings.creative) {
            this.hud.toast('デバッグモードが切になっている（Esc のポーズ画面で入れる）');
          } else this.openScreen(() => this.screens.openCreative());
          break;
        case 'KeyL':
          if (this.paused || this.player.isDead) break;
          if (this.screens.kind === 'ledger') this.closeScreen();
          else this.openScreen(() => this.screens.openLedger(() => this.ledgerView()));
          break;
        case 'KeyF':
          if (this.paused || this.player.isDead || this.uiOpen) break;
          this.chooseDepot();
          break;
        case 'KeyR':
          if (this.paused || this.player.isDead || this.uiOpen) break;
          this.paveToHere();
          break;
        case 'KeyG':
          if (this.paused || this.player.isDead) break;
          // Without this the same keypress types a "g" into the field that just took
          // focus, wiping the coordinates it was prefilled with.
          event.preventDefault();
          this.toggleWarpDialog();
          break;
        default:
          break;
      }
      const hotbar = /^Digit([1-9])$/.exec(event.code);
      if (hotbar && !this.uiOpen) {
        this.player.inventory.selected = Number(hotbar[1]) - 1;
        this.hud.showHeldItem(this.player.inventory.held?.id ?? null);
      }
    };
    input.onKey(this.keyHandler);

    this.options.canvas.addEventListener('mousedown', () => {
      if (this.ready && !this.paused && !this.uiOpen && !this.player.isDead && !this.options.input.locked) {
        this.options.input.requestLock();
      }
    });
    this.lockHandler = () => {
      // A click that opens a container also asks for pointer lock, and the request can
      // land after the screen opened. Undo it, or the cursor stays trapped and the UI
      // becomes unclickable.
      if (this.options.input.locked && (this.uiOpen || this.paused || this.player.isDead)) {
        this.options.input.releaseLock();
        return;
      }
      this.hud.setClickPrompt(!this.options.input.locked && this.ready && !this.paused && !this.uiOpen);
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

  /** Finds the building in the middle of the screen, so it can be named and chosen.
   *
   *  A longer ray than the player's reach: standing back to see a whole house is the
   *  natural way to look at one, and it would be strange to have to press your nose
   *  against a wall to find out whose it is. */
  private updateLookedAtBuilding(
    eye: { x: number; y: number; z: number },
    look: { x: number; y: number; z: number },
  ): void {
    this.lookedAt = null;
    const hit = raycastVoxels(this.world, eye, look, { maxDistance: BUILDING_REACH });
    if (!hit) return;
    const village = this.villages.at(hit.x, hit.z);
    if (!village || !village.discovered) return;
    const building = buildingAt(this.buildingsFor(village), hit.x, hit.z);
    if (building) this.lookedAt = { building, village };
  }

  /** What the HUD says about the building under the crosshair. */
  private buildingPrompt(): { title: string; hint: string } | null {
    if (!this.lookedAt || this.uiOpen) return null;
    const { building, village } = this.lookedAt;
    const depot = this.depotFor(village);
    const isDepot = depot?.id === building.id;
    return {
      title: describeBuilding(building, village, isDepot),
      hint: isDepot ? 'ここから荷が出入りする' : '[F] この村の集荷所にする',
    };
  }

  /** Moves a village's loading and unloading to the building being looked at. */
  private chooseDepot(): void {
    if (!this.lookedAt) {
      this.hud.toast('建物を見ながら F を押すと、その建物を集荷所にできる');
      return;
    }
    const { building, village } = this.lookedAt;
    if (this.depotFor(village)?.id === building.id) {
      this.hud.toast(`${building.label}はすでに${village.name}の集荷所`);
      return;
    }
    village.depot = building.id;
    // Where a route ends has moved, and only a survey knows what that does to its length.
    this.transport.invalidate();
    this.hud.toast(`${village.name}の集荷所を${building.label}にした`);
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
    this.updateLookedAtBuilding(eye, look);

    const input = this.options.input;
    // Holding the track tool takes over the mouse entirely. An early return rather than
    // another branch inside `useItem`: it is the cheapest possible guarantee that the
    // new railway cannot disturb attacking, mining, the shovel's sweep or the rail
    // item's, all of which are already on these two buttons.
    if (this.heldTrackTool()) {
      this.effects.setSelection(null);
      this.resetMining();
      this.updateTrackLaying(dt);
      return;
    }
    if (this.trackDraft) this.cancelTrackDraft(false);
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
        const village = this.ensureVillageTrades(mob);
        const quest = this.questInteractionFor(mob);
        const note = village ? this.villageNote(village) : undefined;
        this.openScreen(() =>
          this.screens.openTrade(mob, () => this.hud.toast('取引が成立した'), quest ?? undefined, note),
        );
        return;
      }
      this.useItem(hit);
      return;
    }

    this.updatePaving(dt, hit);

    if (input.buttons[0] && hit) {
      this.updateMining(dt, hit);
    } else {
      this.resetMining();
    }
  }

  // --- paving ----------------------------------------------------------------

  /** A shovel held down while the player walks.
   *
   *  One click, one block was the whole reason roads were allowed to be dashed: nobody
   *  was ever going to click four hundred times. So the shovel sweeps — it treads the
   *  cell under the crosshair and the eight around it, and it fills in behind a crosshair
   *  that jumped, which happens every time the player turns their head. What comes out is
   *  a road wide enough to see and continuous enough to carry. */
  private updatePaving(dt: number, hit: RaycastHit | null): void {
    const material = this.heldPaving();
    if (!material || !this.options.input.buttons[2] || !hit || this.uiOpen) {
      this.paveFrom = null;
      return;
    }
    this.paveTimer -= dt;
    if (this.paveTimer > 0) return;
    this.paveTimer = PAVE_INTERVAL;

    const from = this.paveFrom;
    const span = from ? Math.max(Math.abs(hit.x - from.x), Math.abs(hit.z - from.z)) : 0;
    const laid =
      from && span > 1 && span <= PAVE_BRIDGE
        ? treadLine(this.paveTarget, from, hit, from.y, material).laid
        : treadBrush(this.paveTarget, hit.x, hit.z, hit.y, material).laid;
    this.paveFrom = { x: hit.x, y: hit.y, z: hit.z };
    if (laid === 0 && material.supply && !this.player.inventory.has('rail')) {
      this.warn('レールが尽きた');
      return;
    }
    this.reportPavingFaults(PAVE_INTERVAL, hit.x, hit.z);
  }

  /** What the held item lays while the right button is down, and what it costs.
   *
   *  This is the whole of "rail laying is a build mode": there is no mode, only what is
   *  in the player's hand, exactly as the shovel has always worked. Dirt is free and
   *  sweeps three columns across because a wide road is what buys a cart; rails go down
   *  single file out of the pack, because a train needs one column and every one of them
   *  was smelted. */
  private heldPaving(): PaveMaterial | null {
    const held = this.player.inventory.held;
    if (held?.id === 'rail') {
      return {
        block: Block.RAIL,
        width: 1,
        supply: { take: () => this.player.inventory.remove('rail', 1) > 0 },
      };
    }
    return heldTool(held)?.tool?.kind === 'shovel' ? TREAD_DIRT : null;
  }

  /** A toast that cannot repeat itself into a wall. Shares the fault timer, because both
   *  are the same sentence — "the thing you are doing right now is not working". */
  private warn(message: string): void {
    if (this.faultToastTimer > 0) return;
    this.faultToastTimer = FAULT_TOAST_INTERVAL;
    this.hud.toast(message);
  }

  /** Says why the road that was just laid does not count, where it does not.
   *
   *  The panel and the lights on the ground are for finding a fault later; this is for
   *  not making one. A player sweeping under a tree lays a perfectly good looking line of
   *  path blocks that the index throws away, and without a word at the moment it happens
   *  they find out four hundred blocks later, from a route that will not join. */
  private reportPavingFaults(dt: number, x: number, z: number): void {
    this.faultToastTimer -= dt;
    if (this.faultToastTimer > 0) return;
    const faults = this.roads.faults(x, z, 3);
    if (faults.length === 0) return;
    this.faultToastTimer = FAULT_TOAST_INTERVAL;
    this.hud.toast(faultText(faults[0]));
  }

  /** The world as something to tread a path into. */
  private get paveTarget(): PaveTarget {
    return {
      getBlock: (x, y, z) => this.world.getBlock(x, y, z),
      setBlock: (x, y, z, id) => this.world.setBlock(x, y, z, id),
      roadLevel: (x, z) => this.roads.columns.get(`${x},${z}`),
    };
  }

  /** Runs a road from wherever the player is aiming back to where they stand.
   *
   *  The sweep paves what the crosshair can reach, which is five blocks. This is the
   *  other half: point at something twenty blocks off, press `[R]`, and the ground in
   *  between becomes road — cut into a rise and carried over a dip, so the result is a
   *  road the index will walk rather than a line of blocks draped down a cliff. */
  private paveToHere(): void {
    const eye = { x: this.player.x, y: this.player.eyeY, z: this.player.z };
    const hit = raycastVoxels(this.world, eye, this.player.lookVector(), {
      maxDistance: ROAD_REACH,
    });
    if (!hit) {
      this.hud.toast(`${ROAD_REACH} マス以内の地面に狙いをつけて [R]`);
      return;
    }
    // Whatever is in hand decides what the line is made of, the same as the sweep.
    const material = this.heldPaving() ?? TREAD_DIRT;
    const rails = material.block === Block.RAIL;
    const held = rails ? this.player.inventory.count('rail') : 0;
    const spine = this.runRoad(
      { x: hit.x, z: hit.z },
      { x: Math.floor(this.player.x), z: Math.floor(this.player.z) },
      material.block,
      hit.y,
      undefined,
      1,
      material.supply,
    );
    // What the pile paid for is the honest length of a rail run: the spine is how far the
    // line was planned, and the two part company exactly when the rails ran out.
    const laid = rails ? held - this.player.inventory.count('rail') : spine;
    const what = rails ? 'レール' : '道';
    if (laid === 0) this.hud.toast(`${what}をのばせる地面がない`);
    else if (rails && laid < spine) this.hud.toast(`レールが ${laid} マスで尽きた`);
    else this.hud.toast(`${what}を ${laid} マスのばした`);
    this.faultToastTimer = 0;
    this.reportPavingFaults(0, hit.x, hit.z);
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

    // Paving a road with a shovel. Same gesture as tilling soil, and it is what makes a
    // road between two villages something a player will actually finish. Holding the
    // button down keeps it going: see `updatePaving`.
    // Rails lay the same way, which is why this asks the material rather than the tool.
    // Falling through when nothing was laid is deliberate: a rail aimed at a wall is a
    // block being placed, and only a rail aimed at the ground is track being laid.
    const material = this.heldPaving();
    if (material) {
      if (treadBrush(this.paveTarget, hit.x, hit.z, hit.y, material).laid > 0) {
        this.paveFrom = { x: hit.x, y: hit.y, z: hit.z };
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

  /** Called when the pause menu changes the setting, so it takes hold on the click rather
   *  than on the first frame after the player resumes. */
  setDifficulty(id: Difficulty): void {
    this.options.settings.difficulty = difficultyRules(id).id;
    this.applyDifficulty();
  }

  /** Keeps the player's rules in step with the setting. Changing it mid-game is allowed —
   *  the pause menu is where a player decides they have had enough of the nights — so the
   *  change is announced rather than applied in silence. */
  private applyDifficulty(): void {
    const rules = difficultyRules(this.options.settings.difficulty);
    // Whether this is the first look has to be settled before the early return, or a
    // world that starts on ふつう never counts as announced and the first real change
    // reads as the opening one.
    const first = this.difficultyAnnounced === null;
    this.difficultyAnnounced = rules.id;
    if (rules.id === this.player.rules.id) return;
    this.player.rules = rules;
    if (!first) this.toast(`難易度: ${rules.label} — ${rules.note}`);
  }

  private mobContext(): MobUpdateContext {
    return {
      player: this.player,
      day: this.day,
      difficulty: this.player.rules,
      currentAt: (x, y, z) => this.water.flowAt(x, y, z),
      onPlayerHit: (damage, fromX, fromZ) => {
        // Every blow a mob lands passes through here, arrows included, so the difficulty
        // only has to be applied in one place.
        const scaled = damage * this.player.rules.damage;
        if (scaled <= 0) return;
        const result = applyDamage(this.player, scaled, this.player.inventory.defense);
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



  // --- the free-form railway --------------------------------------------------

  private heldTrackTool(): boolean {
    return this.player.inventory.held?.id === 'track_tool';
  }

  /** Where the tool is pointing, as a point in the world rather than as a block.
   *
   *  The voxel walk gives back the distance at which it entered the block it hit, and that
   *  distance is measured along a unit direction, so `eye + look * distance` is the exact
   *  place the line of sight crossed the face. That exactness is the whole point: this
   *  railway is not on the grid, and a click rounded to a block corner would put it back. */
  private trackAim(): { point: TrackPoint; node: TrackNode | null } {
    const eye = { x: this.player.x, y: this.player.eyeY, z: this.player.z };
    const look = this.player.lookVector();
    // An end the line of sight passes wins outright, before the ground is consulted at
    // all: track hanging in the air is not in the block grid, so the ray goes through it
    // and lands somewhere behind. Without this the one end most worth building on - the
    // far end of a viaduct - is the one that cannot be pointed at.
    const onRay = this.trackNet.nodeAlongRay(eye, look, TRACK_REACH);
    if (onRay) return { point: { x: onRay.x, y: onRay.y, z: onRay.z }, node: onRay };
    const hit = raycastVoxels(this.world, eye, look, { maxDistance: TRACK_REACH });
    // A hit at zero distance means the eye is inside a block; there is no face there.
    const point = hit && hit.distance >= 0.5
      ? {
        x: eye.x + look.x * hit.distance + hit.nx * TRACK_LIFT,
        y: eye.y + look.y * hit.distance + hit.ny * TRACK_LIFT,
        z: eye.z + look.z * hit.distance + hit.nz * TRACK_LIFT,
      }
      : this.trackAimInAir(eye, look);
    return { point, node: this.trackNet.nodeAt(point, SNAP_RADIUS) };
  }

  /** Aiming at nothing at all is not a mistake here, it is how a gorge gets crossed.
   *
   *  The point is put where the line of sight crosses the height the track is being laid
   *  at, which over a drop is the place the player means. Looking up there is no crossing,
   *  so the track simply runs out level as far as the tool reaches. Either way the ghost
   *  is already drawing where it will go, so nothing lands somewhere unseen. */
  private trackAimInAir(eye: TrackPoint, look: TrackPoint): TrackPoint {
    const deck = this.trackDraft ? this.trackDraft.anchor.y : this.player.y;
    const flat = Math.hypot(look.x, look.z);
    if (flat < 1e-3) return { x: eye.x, y: deck, z: eye.z };
    const cross = Math.abs(look.y) > 1e-3 ? (deck - eye.y) / look.y : -1;
    if (cross > 0.5 && cross <= TRACK_REACH) {
      return { x: eye.x + look.x * cross, y: deck, z: eye.z + look.z * cross };
    }
    return {
      x: eye.x + (look.x / flat) * TRACK_REACH,
      y: deck,
      z: eye.z + (look.z / flat) * TRACK_REACH,
    };
  }

  /** A click, as one end of a curve.
   *
   *  The heading is the player's yaw and nothing else - deliberately not their whole look
   *  vector. Aiming at the ground means looking thirty to sixty degrees down, and track
   *  that left at the angle the player was looking would ramp into the sky every time.
   *
   *  An end that is already there overrules the yaw completely: position, heading and
   *  slope all come from the node. That is what "match the angle of the track that is
   *  already there" means, and it is why the joint comes out exactly continuous rather
   *  than nearly. `continuationAt` answers in the direction a curve *leaves* in, so an end
   *  a curve *arrives* at is the same direction turned round. */
  private trackAnchorAt(
    aim: { point: TrackPoint; node: TrackNode | null },
    arriving: boolean,
  ): TrackAnchor {
    if (!aim.node) {
      const yaw = this.player.yaw;
      return {
        x: aim.point.x,
        y: aim.point.y,
        z: aim.point.z,
        hx: -Math.sin(yaw),
        hz: -Math.cos(yaw),
        grade: 0,
      };
    }
    const snap = this.trackNet.continuationAt(aim.node);
    const sign = arriving ? -1 : 1;
    return {
      x: aim.node.x,
      y: aim.node.y,
      z: aim.node.z,
      hx: snap.hx * sign,
      hz: snap.hz * sign,
      grade: snap.grade * sign,
    };
  }

  private updateTrackLaying(dt: number): void {
    // `warn` shares the paving fault timer, and while the tool is out nothing else is
    // winding it down.
    this.faultToastTimer -= dt;
    const input = this.options.input;
    const aim = this.trackAim();
    if (input.buttonJustPressed(2)) {
      if (this.trackDraft) this.commitTrack(aim);
      else this.beginTrack(aim);
    }
    if (input.buttonJustPressed(0)) {
      if (this.trackDraft) this.cancelTrackDraft(true);
      else this.removeTrackLookedAt();
    }
    this.updateTrackGhost(aim);
  }

  private beginTrack(aim: { point: TrackPoint; node: TrackNode | null }): void {
    if (aim.node && aim.node.edges.length >= 2) {
      this.warn(trackFaultText('occupied', 0));
      return;
    }
    this.trackDraft = { anchor: this.trackAnchorAt(aim, false), node: aim.node?.id ?? null };
    this.hud.toast(aim.node
      ? '既存の線路の端につないだ。もう一度右クリックで終点'
      : '始点を置いた。もう一度右クリックで終点');
  }

  private cancelTrackDraft(announce: boolean): void {
    this.trackDraft = null;
    this.trackGhost = null;
    this.trackGhostFault = null;
    this.trackReadout = null;
    if (announce) this.hud.toast('敷設をやめた');
  }

  private commitTrack(aim: { point: TrackPoint; node: TrackNode | null }): void {
    const draft = this.trackDraft;
    if (!draft) return;
    const laid = this.trackNet.lay(draft.anchor, this.trackAnchorAt(aim, true), {
      ...(draft.node !== null ? { fromNode: draft.node } : {}),
      ...(aim.node ? { toNode: aim.node.id } : {}),
    });
    if (!laid.ok) {
      // The start stays where it was put. The fix for almost every refusal is to turn a
      // little and click again, and making the player set the start down a second time
      // would charge them for the game's opinion.
      this.warn(trackFaultText(laid.fault, laid.value, laid.curve ? summarise(laid.curve).turn : null));
      return;
    }
    const cost = railsFor(laid.edge.curve.length);
    if (!this.player.inventory.has('rail', cost)) {
      const short = cost - this.player.inventory.count('rail');
      this.trackNet.remove(laid.edge.id);
      this.warn(`レールが足りない（あと ${short} 本）`);
      return;
    }
    const spent = this.player.inventory.remove('rail', cost);
    this.trackDraft = null;
    this.trackGhost = null;
    this.trackGhostFault = null;
    this.trackReadout = null;
    const built = summarise(laid.edge.curve);
    // Everything the run turned out to be, in one bracket: what it does, and what it cost
    // when it cost anything. In the debug mode nothing was spent, and a toast that said
    // otherwise would be the one line on screen quietly lying about what just happened.
    const parts = [
      Math.abs(built.steepest) < LEVEL
        ? null
        : `${slopeWord(built.steepest)} ${Math.round(Math.abs(built.steepest) * 100)}%`,
      built.bend === 'straight'
        ? null
        : built.bend === 's'
          ? `S字 半径 ${built.radius.toFixed(0)} マス`
          : `${bendWord(built.bend)} 半径 ${built.radius.toFixed(0)} マス`,
      this.player.inventory.unlimited ? null : `レール ${spent} 本`,
    ].filter((part) => part !== null);
    this.hud.toast(
      `線路を ${Math.round(built.length)} マスのばした${parts.length > 0 ? `（${parts.join(' / ')}）` : ''}`,
    );
  }

  /** Takes out the run under the crosshair. Picked against the curve rather than against
   *  the block the ray stops at, for the same reason `trackAim` is. */
  private removeTrackLookedAt(): void {
    const eye = { x: this.player.x, y: this.player.eyeY, z: this.player.z };
    const edge = this.trackNet.edgeAlongRay(eye, this.player.lookVector(), TRACK_REACH, TRACK_PICK);
    if (!edge) return;
    // Half back, the way a pickaxe gives back less than a furnace cost.
    const refund = Math.floor(railsFor(edge.curve.length) / 2);
    this.trackNet.remove(edge.id);
    const paid = this.player.inventory.unlimited ? 0 : refund;
    if (paid > 0) {
      const left = this.player.inventory.add({ id: 'rail', count: paid });
      if (left > 0) this.dropAtPlayer({ id: 'rail', count: left });
    }
    this.hud.toast(paid > 0 ? `線路を撤去した（レール ${paid} 本）` : '線路を撤去した');
  }

  /** The curve as it would be if the player clicked now.
   *
   *  Because the shape is a pure function of the aim and the yaw, the end of the ghost
   *  follows the player's head with no extra machinery at all - turning on the spot is how
   *  the curve gets chosen. A shape the solver refuses still draws, as a thin line, so the
   *  reason is visible while they are still turning rather than only after they click. */
  private updateTrackGhost(aim: { point: TrackPoint; node: TrackNode | null }): void {
    const draft = this.trackDraft;
    if (!draft) {
      this.trackGhost = null;
      this.trackReadout = null;
      return;
    }
    const to = this.trackAnchorAt(aim, true);
    const solved = solveTrack(draft.anchor, to);
    // Quantised, so that the small movements of a head that is really still do not rebuild
    // a few thousand vertices every frame.
    const key = [
      Math.round(to.x * 8), Math.round(to.y * 8), Math.round(to.z * 8),
      Math.round(this.player.yaw * 64), aim.node?.id ?? 0,
      this.trackNet.revision, solved.ok ? 1 : 0,
    ].join(',');
    this.trackGhostFault = solved.ok ? null : solved.fault;
    // Described whether or not it will be built. "Too steep" is not an answer a player can
    // act on until they know it was 45% and going up.
    const summary = solved.ok ? summarise(solved.curve) : solved.curve ? summarise(solved.curve) : null;
    this.trackReadout = {
      lines: summary ? trackLines(summary) : [],
      fault: solved.ok
        ? null
        : trackFaultText(solved.fault, solved.value, summary?.turn ?? null),
    };
    this.trackGhost = solved.ok
      ? { samples: sampleTrack(solved.curve, SAMPLE_STEP), valid: true, key }
      : { samples: straightSamples(draft.anchor, to), valid: false, key };
  }

  /** What the renderer draws.
   *
   *  Sampling every curve in range is far too much to do sixty times a second for track
   *  that has not moved since it was laid, so the heavy half is kept and only worked out
   *  again when the network changes, when a different set of runs comes into range, or
   *  once a second so that piers can find ground that has since loaded. The markers and
   *  the ghost are cheap and want to be current, so they are refreshed every frame. */
  private trackView(dt: number): TrackView | null {
    const holding = this.heldTrackTool();
    if (this.trackNet.edges.size === 0 && !holding) {
      this.trackViewCache = null;
      this.trackViewKey = '';
      return null;
    }
    this.trackViewTimer -= dt;
    const near = this.trackNet.edgesNear(this.player.x, this.player.z, TRACK_DRAW);
    near.sort((a, b) => a.id - b.id);
    const key = `${this.trackNet.revision}:${near.map((edge) => edge.id).join(',')}`;
    if (!this.trackViewCache || key !== this.trackViewKey || this.trackViewTimer <= 0) {
      this.trackViewKey = key;
      this.trackViewTimer = TRACK_VIEW_INTERVAL;
      const edges: TrackEdgeView[] = [];
      const piers: TrackPierView[] = [];
      for (const edge of near) {
        const samples = sampleTrack(edge.curve, SAMPLE_STEP);
        edges.push({ id: edge.id, samples });
        this.collectPiers(samples, piers);
      }
      this.trackViewCache = {
        // The pier count is in here because a pier over an unloaded chunk is skipped:
        // without it, the far end of a long run would never grow its legs.
        key: `${key}:${piers.length}`,
        edges,
        piers,
        markers: [],
        ghost: null,
      };
    }
    const view = this.trackViewCache;
    view.markers = holding ? this.trackMarkers() : [];
    view.ghost = holding ? this.trackGhost : null;
    return view;
  }

  /** Every end a new curve could be joined to, plus the start of the one being laid.
   *  Without these, snapping is a rule the player can only find out about by accident. */
  private trackMarkers(): TrackMarkerView[] {
    const markers: TrackMarkerView[] = [];
    for (const node of this.trackNet.freeEnds()) {
      if (Math.hypot(node.x - this.player.x, node.z - this.player.z) > TRACK_DRAW) continue;
      markers.push({ x: node.x, y: node.y, z: node.z, colour: TRACK_END_MARK });
    }
    const draft = this.trackDraft;
    if (draft) {
      markers.push({
        x: draft.anchor.x, y: draft.anchor.y, z: draft.anchor.z, colour: TRACK_START_MARK,
      });
    }
    return markers;
  }

  /** Legs under whatever floats. Nothing is put under a column whose chunk is not loaded:
   *  `heightAt` answers -1 there, and a pier guessed onto ground nobody has generated
   *  would be worse than the gap it was covering up. */
  private collectPiers(samples: TrackSample[], into: TrackPierView[]): void {
    let travelled = 0;
    let next = PIER_STEP / 2;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1];
      const b = samples[i];
      const span = Math.hypot(b.x - a.x, b.z - a.z);
      if (span < 1e-6) continue;
      while (next <= travelled + span) {
        const t = (next - travelled) / span;
        next += PIER_STEP;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        const z = a.z + (b.z - a.z) * t;
        const ground = this.world.heightAt(Math.floor(x), Math.floor(z));
        if (ground < 0) continue;
        const top = y - SLEEPER_THICK;
        const bottom = ground + 1;
        if (top - bottom <= PIER_MIN_GAP) continue;
        const flat = Math.hypot(a.tx, a.tz) || 1;
        into.push({ x, z, top, bottom, sx: a.tz / flat, sz: -a.tx / flat });
      }
      travelled += span;
    }
  }

  /** Lays a curve from two positions and two yaws, skipping the aiming and the cost.
   *  Building a demonstration by hand is the player's afternoon, not the browser test's. */
  private debugLayTrack(
    from: { x: number; y: number; z: number; yaw: number },
    to: { x: number; y: number; z: number; yaw: number },
  ): { ok: boolean; fault?: TrackFault; value?: number; edge?: number; length?: number } {
    const anchor = (at: { x: number; y: number; z: number; yaw: number }): TrackAnchor => ({
      x: at.x, y: at.y, z: at.z, hx: -Math.sin(at.yaw), hz: -Math.cos(at.yaw), grade: 0,
    });
    const laid = this.trackNet.lay(anchor(from), anchor(to));
    if (!laid.ok) return { ok: false, fault: laid.fault, value: laid.value };
    return { ok: true, edge: laid.edge.id, length: laid.edge.curve.length };
  }

  /** A straight run, a right-hand curve and a left-hand one, laid end to end from where
   *  the player is standing. One call shows the whole of what this railway does: that it
   *  curves, that a joint between two curves has no kink in it, and that none of it cares
   *  what the ground underneath is doing. */
  private buildSampleTrack(): { edges: number; length: number } {
    const radius = 14;
    const y = this.player.y + 0.5;
    let x = this.player.x;
    let z = this.player.z;
    let heading = this.player.yaw;
    let laid = 0;
    for (const turn of [0, 0.9, -0.9]) {
      // The chord of a circular arc of this radius through this much of a turn, so the
      // curve the solver finds is the one that was asked for.
      const chord = turn === 0 ? 24 : 2 * radius * Math.sin(Math.abs(turn) / 2);
      const nx = x - Math.sin(heading + turn / 2) * chord;
      const nz = z - Math.cos(heading + turn / 2) * chord;
      const result = this.debugLayTrack(
        { x, y, z, yaw: heading },
        { x: nx, y, z: nz, yaw: heading + turn },
      );
      if (result.ok) laid++;
      x = nx;
      z = nz;
      heading += turn;
    }
    return { edges: laid, length: this.trackNet.totalLength() };
  }

  // --- villages, roads and transport -----------------------------------------

  private updateVillages(dt: number): void {
    const here = this.villages.at(this.player.x, this.player.z);
    if (here && this.villages.discover(here.id)) {
      this.hud.toast(`${here.name}に着いた`);
      // Before the questline picks a target: the hamlet has to exist for it to be chosen.
      if (this.questline.step === 'find_village') this.ensureOutpost(here);
      this.toast(this.questline.onVillageDiscovered(here));
      this.linkQuestVillages();
    }
    this.villages.produce(dt);
    this.transport.update(dt, this.player.x, this.player.z);
    // The tutorial's road step is finished by the *event* of a route joining up, so a
    // player who lays the road before being told to — the shortest road in the game runs
    // between two villages fifty blocks apart — would reach the step with the event
    // already spent, and wait for it forever.
    const quest = this.questRoute();
    if (quest?.connected) this.toast(this.questline.onRouteEstablished(quest));
    this.drainPendingVillagers();
  }

  /** Gives the first village the player walks into a hamlet to trade with, fifty blocks
   *  away, and builds it. Only the tutorial's own village gets one: everywhere else, the
   *  three hundred block gap between villages is the game.
   *
   *  Nothing happens if there is nowhere level enough within reach — the tutorial simply
   *  falls back to the nearest real village, which is what it did before. */
  private ensureOutpost(parent: VillageRecord): void {
    if (parent.outpost || parent.parent) return;
    for (const record of this.villages.byId.values()) {
      if (record.outpost && record.parent === parent.id) return;
    }
    const site = outpostSite(this.options.seed, parent, (x, z) => this.groundHeightAt(x, z));
    if (!site) return;
    const record = this.villages.adopt(outpostRecord(this.options.seed, parent, site));
    // Build whatever is already loaded now; the rest builds itself as chunks arrive,
    // because applying is idempotent.
    for (const { cx, cz } of growthChunks(this.options.seed, record, [])) {
      const chunk = this.world.getChunk(cx, cz);
      if (chunk) this.buildGrowth(record, chunk);
    }
  }

  /** Once the tutorial knows both ends, transport starts watching that pair so the panel
   *  can report how much road is still missing. */
  private linkQuestVillages(): void {
    const { originId, targetId } = this.questline;
    if (originId && targetId) this.transport.requestRoute(originId, targetId);
  }

  /** The level of the road indexed at a column, if there is one. A field rather than a
   *  method so it can be handed to village growth as it stands. */
  private readonly roadLevelAt = (x: number, z: number): number | undefined =>
    this.roads.columns.get(`${x},${z}`);

  /** Every addressable building of a village, cached until the village grows or the road
   *  network moves — a house on a plot somebody has since paved is never built, so it
   *  cannot be somebody's depot either. */
  private buildingsFor(village: VillageRecord): VillageBuilding[] {
    const cached = this.villageBuildings.get(village.id);
    if (cached && cached.stage === village.stage && cached.roads === this.roads.revision) {
      return cached.list;
    }
    const houses: HouseRecord[] = [];
    // A hamlet is not on the village grid, so it has no generated houses at all: the two
    // it was written with are its whole stock of buildings.
    if (village.outpost) houses.push(...outpostBuildings(this.options.seed, village).buildings);
    else houses.push(...this.generator.villageBuildings(village.x, village.z));
    const occupied = village.outpost ? [] : this.generator.villageBuildings(village.x, village.z);
    const paved = ownPaving(this.options.seed, village, occupied);
    for (let stage = 1; stage <= village.stage; stage++) {
      for (const house of growthFor(this.options.seed, village, stage, occupied).buildings) {
        if (roadCrosses(house, village.baseY + 1, this.world, this.roadLevelAt, paved)) continue;
        houses.push(house);
      }
    }
    const list = buildingsOf(village, houses);
    this.villageBuildings.set(village.id, { stage: village.stage, roads: this.roads.revision, list });
    return list;
  }

  /** The building a village loads and unloads at. */
  private depotFor(village: VillageRecord): VillageBuilding | null {
    return depotOf(village, this.buildingsFor(village));
  }

  /** The doorway transport should start and finish a trip at. */
  private depotDoor(id: VillageId): RoadPoint | null {
    const village = this.villages.get(id);
    if (!village) return null;
    const depot = this.depotFor(village);
    return depot ? { x: depot.door.x, y: depot.door.y - 1, z: depot.door.z } : null;
  }

  /** Names the depot of a village, for the panel and the ledger. */
  private depotLabel(id: VillageId): string | null {
    const village = this.villages.get(id);
    if (!village) return null;
    return this.depotFor(village)?.label ?? null;
  }

  /** Watches every pair of found villages close enough to be worth a road.
   *
   *  The player never asks for a route: they lay a road, and trade starts. Watching a pair
   *  costs nothing until its road actually joins up — a survey only runs when the network
   *  has changed, and each village's search is shared between all its pairs. */
  private linkNeighbours(): void {
    const found = this.villages.discovered();
    for (let i = 0; i < found.length; i++) {
      for (let j = i + 1; j < found.length; j++) {
        if (this.transport.routes.length >= MAX_ROUTES) return;
        const a = found[i];
        const b = found[j];
        if (Math.hypot(a.x - b.x, a.z - b.z) > AUTO_ROUTE_RANGE) continue;
        this.transport.requestRoute(a.id, b.id);
      }
    }
  }

  /** The road network as light on the ground: what carries goods, what is still missing,
   *  and where the goods have got to. Rebuilt every frame and cheap to compare — the
   *  renderer only touches geometry when one of these three has actually changed. */
  private guideView(): GuideView {
    const lines: GuideLine[] = [];
    const beams: GuideBeam[] = [];
    const questRoute = this.focusRoute();
    for (const route of this.transport.routes) {
      const id = `${route.from}|${route.to}`;
      if (route.connected) {
        if (route.waypoints.length >= 2) {
          const key = `${id}|c|${this.roads.revision}|${route.waypoints.length}`;
          lines.push({ key, points: this.guideLine(id, key, route.waypoints), colour: GUIDE_ROAD, dashed: false });
        }
        // A short marker over each end, so the two buildings the line actually runs
        // between can be picked out of a village from across it.
        for (const door of [route.fromDoor, route.toDoor]) {
          if (door) beams.push({ ...door, colour: GUIDE_DEPOT, height: 4 });
        }
        continue;
      }
      // Only the lines the player is actually working on. Every watched pair would put a
      // dashed line across half the world.
      if (route !== questRoute && !route.everConnected) continue;
      if (!route.gapFrom || !route.gapTo) continue;
      const key = `${id}|g|${route.gapFrom.x},${route.gapFrom.z}|${route.gapTo.x},${route.gapTo.z}`;
      lines.push({
        key,
        points: this.guideLine(id, key, [route.gapFrom, route.gapTo]),
        colour: GUIDE_GAP,
        dashed: true,
      });
      // A beacon at each end, so the stretch to build can be found from a hilltop rather
      // than only from the minimap.
      beams.push({ ...route.gapFrom, colour: GUIDE_GAP, height: 14 });
      beams.push({ ...route.gapTo, colour: GUIDE_GAP, height: 14 });
    }
    for (const porter of this.transport.porterViews()) {
      beams.push({ x: porter.x, y: porter.y, z: porter.z, colour: GUIDE_PORTER, height: 6 });
    }
    // Road somebody laid that the index will not have. The quietest thing on the screen
    // and the one most worth looking at: "you already did this work, and it does not
    // count" is invisible from every other angle.
    const faults = this.roadFaults();
    for (const fault of faults) {
      beams.push({ x: fault.x, y: fault.y, z: fault.z, colour: GUIDE_FAULT, height: 8 });
    }
    // Where a road stops being wide enough to pull a cart down.
    for (const route of this.transport.routes) {
      if (!route.connected || !route.cartPinch) continue;
      if (route !== questRoute && !this.nearPlayer(route.cartPinch, FAULT_REACH * 2)) continue;
      beams.push({ ...route.cartPinch, colour: GUIDE_NARROW, height: 10 });
    }
    // Where the rails run out. Only on lines somebody has started railing: `surveyRail`
    // hands back no pinch at all for a road with not one rail on it.
    for (const route of this.transport.routes) {
      if (!route.connected || !route.railPinch) continue;
      if (route !== questRoute && !this.nearPlayer(route.railPinch, FAULT_REACH * 2)) continue;
      beams.push({ ...route.railPinch, colour: GUIDE_RAILGAP, height: 12 });
    }
    const tiles = this.roads.columnsIn(
      this.player.x - GUIDE_TILE_REACH,
      this.player.z - GUIDE_TILE_REACH,
      this.player.x + GUIDE_TILE_REACH,
      this.player.z + GUIDE_TILE_REACH,
    );
    return {
      lines,
      tiles,
      tilesKey: `${this.roads.revision}:${Math.round(this.player.x / 8)}:${Math.round(this.player.z / 8)}`,
      beams,
    };
  }

  /** What the two ends of a route have between them. A trip can start from either, so
   *  the origin's pile alone was never the number that mattered. */
  private stockOn(route: Route): number {
    return (this.villages.get(route.from)?.stock ?? 0) + (this.villages.get(route.to)?.stock ?? 0);
  }

  /** Why a joined route has nothing moving on it, when it has nothing moving on it.
   *
   *  A road that is finished and idle is the most confusing state in the game, and the
   *  panel used to answer it with a number that could not explain itself. Every case here
   *  is something the player can act on: wait, haul the workshop its materials, or go and
   *  walk into the village. */
  private idleReason(route: Route): RouteIdle | null {
    if (!route.connected || route.porters.length > 0 || this.stockOn(route) > 0) return null;
    for (const id of [route.from, route.to]) {
      const village = this.villages.get(id);
      if (!village || !village.discovered) {
        return { kind: 'undiscovered', village: village ? displayName(village) : '村', wants: null };
      }
      if (village.input !== null && village.inputStock <= 0) {
        return { kind: 'starved', village: displayName(village), wants: itemLabel(village.input) };
      }
    }
    return { kind: 'stock', village: '', wants: null };
  }

  /** How far off and which way something is, in the terms the panel speaks. */
  private bearingTo(point: { x: number; z: number }): { distance: number; bearing: number } {
    return {
      distance: Math.hypot(point.x - this.player.x, point.z - this.player.z),
      bearing: (Math.atan2(point.x - this.player.x, -(point.z - this.player.z)) * 180) / Math.PI,
    };
  }

  /** Places near the player where road blocks are laid and the index refuses them. */
  private roadFaults(radius = FAULT_REACH): RoadFault[] {
    return this.roads.faults(Math.floor(this.player.x), Math.floor(this.player.z), radius);
  }

  private nearPlayer(point: { x: number; z: number }, within: number): boolean {
    return Math.hypot(point.x - this.player.x, point.z - this.player.z) <= within;
  }

  /** A line laid over the ground rather than through it, cached until its shape changes.
   *
   *  A road's own corners already sit on the road, but the stretch a route is still
   *  missing runs over open country — and drawn as one straight segment between its two
   *  ends it spends most of its length underground, which is to say invisible exactly
   *  where it matters. */
  private guideLine(id: string, key: string, points: readonly RoadPoint[]): GuidePoint[] {
    const cached = this.guideLines.get(id);
    if (cached && cached.key === key) return cached.points;
    const draped: GuidePoint[] = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      draped.push({ x: a.x, z: a.z, y: a.y });
      const steps = Math.round(Math.hypot(b.x - a.x, b.z - a.z));
      for (let step = 1; step < steps; step++) {
        const f = step / steps;
        const x = Math.round(a.x + (b.x - a.x) * f);
        const z = Math.round(a.z + (b.z - a.z) * f);
        draped.push({ x, z, y: Math.max(this.groundHeightAt(x, z), Math.round(a.y + (b.y - a.y) * f)) });
      }
    }
    draped.push({ ...points[points.length - 1] });
    this.guideLines.set(id, { key, points: draped });
    return draped;
  }

  /** The nearest village on the grid that the player has not walked into.
   *
   *  Not `nearestVillage`, which is simply the nearest one and is therefore usually the
   *  village the player is standing in — no help at all to a goal whose whole content is
   *  "go and find another one". */
  private unfoundVillage(): { x: number; z: number } | null {
    let best: { x: number; z: number } | null = null;
    let bestDistance = Infinity;
    for (const seed of this.generator.villagesAround(this.player.x, this.player.z, 3)) {
      if (this.villages.get(villageId(seed.x, seed.z))?.discovered) continue;
      const distance = Math.hypot(seed.x - this.player.x, seed.z - this.player.z);
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      best = { x: seed.x, z: seed.z };
    }
    return best;
  }

  /** The route everything points at: the tutorial's own while it is running, and after
   *  that whichever pair the current goal is about. Without this the panel, the compass
   *  and the line in the world all stayed pinned to the tutorial's fifty metre road while
   *  the goal asked for a second one somewhere else entirely. */
  private focusRoute(): Route | undefined {
    if (this.questline.step !== 'done') return this.questRoute();
    // Asked from both the HUD and the world guide every frame, and it answers by walking
    // the whole network. Nothing about a goal changes in a quarter of a second.
    const now = performance.now();
    if (now - this.focusCache.at < 250) return this.focusCache.route;
    const route = this.questline.currentMilestone()?.pair?.(this.networkState()) ?? undefined;
    this.focusCache = { at: now, route };
    return route;
  }

  /** The shipment on this line the player is closest to, as a distance and a heading. */
  private nearestPorter(
    shipments: readonly PorterView[],
    route: Route,
  ): { distance: number; bearing: number } | null {
    let best: { distance: number; bearing: number } | null = null;
    for (const porter of shipments) {
      if (porter.route !== route) continue;
      const dx = porter.x - this.player.x;
      const dz = porter.z - this.player.z;
      const distance = Math.hypot(dx, dz);
      if (best && best.distance <= distance) continue;
      best = { distance, bearing: (Math.atan2(dx, -dz) * 180) / Math.PI };
    }
    return best;
  }

  /** What the milestones are allowed to look at. */
  private networkState(): NetworkState {
    return {
      villages: this.villages.discovered(),
      routes: this.transport.routes,
      player: { x: this.player.x, z: this.player.z },
      // A goal that needs another village has to be able to point at one, and the only
      // thing that knows where the unvisited ones are is the village grid. One the player
      // has already walked into is not an answer to "find another".
      unfound: this.unfoundVillage(),
    };
  }

  private claimMilestones(): void {
    for (const milestone of this.questline.claimMilestones(this.networkState())) {
      this.hud.toast(`目標達成 — ${milestone.title}`);
      this.payFreight(milestone.reward);
    }
  }

  /** Hands the player their cut. A full inventory does not burn the money: it stays owed
   *  and goes in with the next payment. */
  private payFreight(pay: number): number {
    if (pay <= 0) return 0;
    this.freightOwed += pay;
    const leftover = this.player.inventory.add({ id: 'emerald', count: this.freightOwed });
    const paid = this.freightOwed - leftover;
    this.freightOwed = leftover;
    this.freightEarned += paid;
    return paid;
  }

  private questRoute(): Route | undefined {
    const { originId, targetId } = this.questline;
    if (!originId || !targetId) return undefined;
    return this.transport.find(originId, targetId);
  }

  private toast(message: string | null): void {
    if (message) this.hud.toast(message);
  }

  private announceRoute(route: Route, what: string): void {
    const from = this.villages.get(route.from);
    const to = this.villages.get(route.to);
    if (from && to) this.hud.toast(`${from.name} と ${to.name} の道が${what}`);
  }

  private onRouteConnected(route: Route): void {
    this.announceRoute(route, `つながった（${Math.round(route.length)}m）`);
    this.toast(this.questline.onRouteEstablished(route));
  }

  private onShipmentArrived(arrival: Arrival): void {
    const to = this.villages.get(arrival.to);
    const paid = this.payFreight(arrival.pay);
    if (to) {
      // One line, not two: what turned up, whether it was wanted, and what it earned.
      const wanted = arrival.needed ? '（求めていた品）' : '';
      const fee = paid > 0 ? ` / 運賃 +${paid}` : '';
      this.hud.toast(`${displayName(to)}に${itemLabel(arrival.good)} ${arrival.count} 個${wanted}${fee}`);
    }
    // Deliveries are what keep a village's offers worth walking to.
    for (const mob of this.mobs.mobs) {
      if (mob.kind !== 'villager' || !to) continue;
      if (Math.hypot(mob.homeX - to.x, mob.homeZ - to.z) > radiusOf(to)) continue;
      restockTrades(mob.trades);
    }
    this.toast(this.questline.onArrival(arrival.route));
  }

  /** A village earned a new building. Everything loaded is built now; the rest builds
   *  itself when the player next walks into it, because applying growth is idempotent. */
  private onVillageGrew(id: string, stage: number): void {
    const village = this.villages.get(id);
    if (!village) return;
    this.hud.toast(`${village.name}が発展して${rankLabel(stage)}になった`);
    const occupied = this.generator.villageBuildings(village.x, village.z);
    for (const { cx, cz } of growthChunks(this.options.seed, village, occupied)) {
      const chunk = this.world.getChunk(cx, cz);
      if (chunk) this.buildGrowth(village, chunk);
    }
    this.refreshVillageTrades(village);
  }

  /** Builds whatever growth this village owes into one loaded chunk, and moves its new
   *  villagers in. */
  private buildGrowth(village: VillageRecord, chunk: Chunk): void {
    const occupied = this.generator.villageBuildings(village.x, village.z);
    const result = applyGrowth(this.world, this.options.seed, village, chunk, occupied, this.roadLevelAt);
    for (const chest of result.chests) {
      if (this.world.getBlockEntity(chest.x, chest.y, chest.z)) continue;
      this.world.setBlockEntity(
        chest.x,
        chest.y,
        chest.z,
        createChest(fillVillageChest(this.options.seed, chest.x, chest.y, chest.z, chest.loot)),
      );
    }
    // `populatedChunks` records "ever populated" forever, so it cannot be reused here:
    // clearing it would spawn the village's original villagers a second time. The village
    // remembers how far it has staffed itself instead.
    //
    // Everyone the village owes moves in at once, not just the ones whose house is in this
    // chunk: the rest queue until their own chunk arrives. Spawning only this chunk's
    // share would leave the others behind, because this line closes the gate for good.
    const staffed = Math.max(village.stage, village.outpost ? 1 : 0);
    if (village.spawnedStage >= staffed) return;
    for (const villager of growthVillagers(this.options.seed, village, occupied, this.world, this.roadLevelAt)) {
      this.spawnOrQueueVillager(villager.x, villager.y, villager.z, villager.profession, village.stage);
    }
    village.spawnedStage = staffed;
  }

  private spawnOrQueueVillager(x: number, y: number, z: number, profession: string, stage: number): void {
    if (this.world.hasChunk(toChunkCoord(x), toChunkCoord(z))) {
      this.mobs.addVillager(x + 0.5, y, z + 0.5, profession, stage);
      return;
    }
    this.pendingVillagers.push({ x, y, z, profession });
  }

  private drainPendingVillagers(): void {
    for (let i = this.pendingVillagers.length - 1; i >= 0; i--) {
      const pending = this.pendingVillagers[i];
      if (!this.world.hasChunk(toChunkCoord(pending.x), toChunkCoord(pending.z))) continue;
      this.mobs.addVillager(pending.x + 0.5, pending.y, pending.z + 0.5, pending.profession, 1);
      this.pendingVillagers.splice(i, 1);
    }
  }

  /** Re-rolls the offers of everyone living in a village that just grew. */
  private refreshVillageTrades(village: VillageRecord): void {
    for (const mob of this.mobs.mobs) {
      if (mob.kind !== 'villager' || !mob.profession) continue;
      // A hamlet's reach is its own, or refreshing it would re-roll its parent's people.
      if (Math.hypot(mob.homeX - village.x, mob.homeZ - village.z) > radiusOf(village)) continue;
      this.rollTrades(mob, village);
    }
  }

  /** Gives a villager the offers of the village they actually live in: its own goods for
   *  sale, and emeralds for whatever it is short of.
   *
   *  Done on demand rather than at spawn because a villager's chunk usually loads before
   *  the registry has re-derived the village. Re-rolling is keyed on the stage, so opening
   *  the screen twice does not restock a table the player has been buying from. */
  private ensureVillageTrades(mob: Mob): VillageRecord | null {
    const village = this.villages.at(mob.homeX, mob.homeZ);
    if (!village || !mob.profession) return village ?? null;
    if (mob.villageStage !== village.stage) this.rollTrades(mob, village);
    return village;
  }

  private rollTrades(mob: Mob, village: VillageRecord): void {
    mob.villageStage = village.stage;
    mob.trades = generateTrades(
      this.options.seed,
      mob.profession ?? 'farmer',
      mob.homeX,
      mob.homeZ,
      village.stage,
      { produces: village.produces, needs: village.needs, stage: village.stage },
    );
  }

  /** One line describing what the village the player is standing in is short of. */
  private villageNote(village: VillageRecord): string {
    const wants = village.needs.map((good) => itemLabel(good)).join('・');
    const made = `${displayName(village)}は${itemLabel(village.produces)}を作っている`;
    if (village.input && village.inputStock <= 0) {
      return `${made}が、${itemLabel(village.input)}が届いていないので手が止まっている。求めている物: ${wants}`;
    }
    return `${made}。求めている物: ${wants}`;
  }

  /** Opens (or closes) the manual. Reachable from the pause menu as well as from `H`,
   *  because the moment somebody wants to know how any of this works is usually the
   *  moment they have already stopped playing to look for a menu. */
  openHelp(): void {
    if (this.screens.kind === 'help') {
      this.closeScreen();
      return;
    }
    if (this.paused) this.togglePause();
    this.openScreen(() => this.screens.openHelp(() => this.helpView()));
  }

  /** The live half of the manual: where the tutorial has got to, and which goals are in.
   *  Everything else on that page is read straight out of the systems it describes. */
  private helpView(): HelpView {
    const objective = this.questline.objective(this.villages, this.focusRoute(), this.networkState());
    return helpView({
      step: this.questline.step,
      milestone: this.questline.milestone,
      objective: objective ? { title: objective.title, detail: objective.detail } : null,
    });
  }

  /** Everything the ledger shows, gathered on demand. */
  private ledgerView(): LedgerView {
    const objective = this.questline.objective(this.villages, this.focusRoute(), this.networkState());
    return {
      earnings: this.freightEarned,
      objective: objective ? { title: objective.title, detail: objective.detail } : null,
      villages: this.villages
        .discovered()
        .map((village) => {
          const next = this.villages.progressToNext(village);
          return {
            name: displayName(village),
            kind: kindLabel(village.kind),
            produces: itemLabel(village.produces),
            input: village.input ? itemLabel(village.input) : null,
            inputStock: village.inputStock,
            needs: village.needs.map((good) => itemLabel(good)),
            stock: village.stock,
            stage: village.stage,
            points: next.points,
            toNext: next.needed,
            received: village.received,
            distance: Math.hypot(village.x - this.player.x, village.z - this.player.z),
            starved: village.input !== null && village.inputStock <= 0,
          };
        })
        .sort((a, b) => a.distance - b.distance),
      routes: this.transport.routes.map((route) => ({
        from: this.villages.get(route.from)?.name ?? '?',
        to: this.villages.get(route.to)?.name ?? '?',
        fromDepot: this.depotLabel(route.from),
        toDepot: this.depotLabel(route.to),
        good: route.good ? itemLabel(route.good) : '—',
        connected: route.connected,
        length: route.length,
        missing: route.missing,
        gap: gapText(route.missing),
        grade: route.grade,
        load: this.transport.loadOf(route),
        porters: route.porters.length,
        delivered: route.delivered,
        vehicle: route.vehicle === 'train' ? '列車' : route.vehicle === 'cart' ? '荷車' : '荷運び',
        climb: route.climb,
        detour: route.detour,
      })),
    };
  }

  private spawnPorter(point: RoadPoint, vehicle: Vehicle): number | null {
    if (!this.world.hasChunk(toChunkCoord(point.x), toChunkCoord(point.z))) return null;
    const mob = new Mob(vehicle, point.x + 0.5, point.y + 1, point.z + 0.5);
    mob.follow = { x: mob.x, z: mob.z };
    this.mobs.add(mob);
    this.porterMobs.set(mob.id, mob);
    return mob.id;
  }

  /** Walks the porter after its shipment. The shipment is already at `point`; the mob is
   *  only ever catching up with it.
   *
   *  It used to be picked up and put down the moment it fell a leash behind, which is the
   *  one thing a walking creature must never look like it does — and it happened
   *  constantly, because the index called a two block riser a road and the porter's jump
   *  clears 1.11 blocks. The rule is fixed; this is the belt and braces. A porter that
   *  has fallen behind *runs*, up to `CATCH_UP` times its pace, and only past
   *  `PORTER_LOST` is it given up on — and then it is dropped rather than moved, so the
   *  next frame draws a fresh one where the goods are, twenty-four blocks away, where
   *  nobody was watching. */
  private movePorter(id: number, point: RoadPoint, speed: number): void {
    const mob = this.livePorter(id);
    if (!mob) return;
    const x = point.x + 0.5;
    const z = point.z + 0.5;
    mob.follow = { x, z };
    const lag = Math.hypot(mob.x - x, mob.z - z);
    // A porter on a paved road has to walk as fast as the goods it is following, or it
    // would spend the whole route being dragged along; past that it hurries, in
    // proportion to how far behind it has got.
    const keepUp = Math.max(1, (speed * 1.5) / mob.def.speed);
    const hurry = 1 + (CATCH_UP - 1) * Math.min(1, lag / PORTER_LEASH);
    mob.speedScale = keepUp * hurry;
    if (lag <= PORTER_LOST) return;
    this.removePorter(id);
  }

  /** The porter mob behind an id, or nothing when the mob manager has taken it away.
   *  Without the second check a despawned porter would keep answering from wherever it
   *  last stood. */
  private livePorter(id: number): Mob | null {
    const mob = this.porterMobs.get(id);
    if (!mob) return null;
    if (mob.isDead || !this.mobs.mobs.includes(mob)) {
      this.porterMobs.delete(id);
      return null;
    }
    return mob;
  }

  private removePorter(id: number): void {
    const mob = this.porterMobs.get(id);
    this.porterMobs.delete(id);
    if (!mob) return;
    const index = this.mobs.mobs.indexOf(mob);
    if (index >= 0) this.mobs.mobs.splice(index, 1);
  }

  /** What the villager in front of the player has to say about the tutorial, if anything. */
  private questInteractionFor(mob: Mob): (QuestInteraction & { ready: boolean; run(): void }) | null {
    const village = this.villages.at(mob.homeX, mob.homeZ);
    if (!village) return null;
    const interaction = this.questline.interactionFor(village, this.villages, (good) =>
      this.player.inventory.count(good),
    );
    if (!interaction) return null;
    // Only handing the crate over needs it in the pack. Accepting the job is what *gets*
    // the player the crate, so gating that on already holding one shut the tutorial.
    const held = interaction.good ? this.player.inventory.count(interaction.good) : 0;
    const ready = interaction.kind !== 'deliver' || held >= interaction.count;
    const detail =
      ready || !interaction.good
        ? interaction.detail
        : `${interaction.detail}（今 ${held} / ${interaction.count} 個）`;
    return {
      ...interaction,
      detail,
      ready,
      run: () => {
        if (!ready) return;
        if (interaction.kind === 'accept' && interaction.good) {
          // The village loads the player up: this step is about carrying, not farming.
          const left = this.player.inventory.add({
            id: interaction.good,
            count: interaction.count,
          });
          if (left > 0) {
            this.player.inventory.remove(interaction.good, interaction.count - left);
            this.toast('持ち物がいっぱいで受け取れない。空けてからもう一度話しかけよう');
            return;
          }
        }
        if (interaction.kind === 'deliver' && interaction.good) {
          this.player.inventory.remove(interaction.good, interaction.count);
          this.villages.addPoints(village.id, interaction.count);
          this.player.inventory.add({ id: 'emerald', count: 2 });
        }
        // Re-supplying does not advance the step, so `complete` says nothing; the player
        // still needs to be told the crate is in their pack.
        this.toast(
          this.questline.complete(interaction.kind, this.villages) ??
            (interaction.kind === 'accept' ? '積み荷を受け取った' : null),
        );
        this.linkQuestVillages();
      },
    };
  }


  /** Lays a dirt path from one village's street to the other's, following the ground.
   *  Debug only: it writes recorded edits exactly as a player's shovel would, so the road
   *  index picks it up through the ordinary block-change hook. */
  private debugBuildRoad(fromId?: string, toId?: string, surface?: string, width = 1): number {
    const from = this.villages.get(fromId ?? this.questline.originId ?? '');
    const to = this.villages.get(toId ?? this.questline.targetId ?? '');
    if (!from || !to) return 0;
    // Paving from the console is what lets the browser test check that a better road
    // really does move more goods; by hand it is a long afternoon with a shovel.
    const block = surface ? itemDef(surface)?.placesBlock ?? Block.DIRT_PATH : Block.DIRT_PATH;
    // From one village's street to the other's, not centre to centre: the middle of a
    // village is its well and its houses, and a road ploughed through them is neither
    // what a player would build nor pleasant to arrive in.
    const start = this.roads.streetPoint(from, to.x, to.z);
    const end = this.roads.streetPoint(to, from.x, from.z);
    return this.runRoad(start, end, block, start.y, end.y, width);
  }

  /** Lays an unbroken line of road columns from one point to the other. */
  private runRoad(
    from: { x: number; z: number },
    to: { x: number; z: number },
    block: BlockId,
    startY: number,
    endY?: number,
    width = 1,
    supply: { take(): boolean } | null = null,
  ): number {
    return runRoad(
      {
        ground: (x, z) => this.groundHeightAt(x, z),
        lay: (x, y, z) => this.layRoadColumn(x, y, z, block, supply),
      },
      from,
      to,
      startY,
      ROAD_GRADE,
      SEA_LEVEL + 1,
      endY,
      width,
    );
  }

  private groundHeightAt(x: number, z: number): number {
    if (this.world.hasChunk(toChunkCoord(x), toChunkCoord(z))) {
      const top = this.world.heightAt(x, z);
      if (top >= 0) return top;
    }
    return this.generator.height(x, z);
  }

  /** Writes one road column plus the headroom above it. Chunks nobody has visited get the
   *  edit recorded directly — which is what a shovel would have left behind anyway, and
   *  what the road index reads, so a road can be run through country the player has never
   *  stood in and still be there when they arrive. */
  private layRoadColumn(
    x: number,
    y: number,
    z: number,
    block: BlockId = Block.DIRT_PATH,
    supply: { take(): boolean } | null = null,
  ): void {
    const surface = this.betterOf(x, y, z, block);
    // Nothing to do, and so nothing to pay for: running rails back along rails that are
    // already there should cost the player no iron at all.
    const here = `${x},${z}`;
    if (this.roads.columns.get(here) === y && this.roads.surfaces.get(here) === surface) return;
    if (supply && !supply.take()) return;
    if (this.world.hasChunk(toChunkCoord(x), toChunkCoord(z))) {
      this.world.setBlock(x, y, z, surface);
      // Headroom, and then whatever falls into it. Cutting under a dune drops the entire
      // sand column onto the fresh road one block at a time, and a road with something
      // sitting on it is not a road — the index drops it and the route reads as broken.
      for (let guard = 0; guard < 40; guard++) {
        let cleared = false;
        for (let h = 1; h <= HEADROOM; h++) {
          if (this.world.getBlock(x, y + h, z) === Block.AIR) continue;
          this.world.setBlock(x, y + h, z, Block.AIR);
          cleared = true;
        }
        if (!cleared) break;
      }
      return;
    }
    const key = chunkKey(toChunkCoord(x), toChunkCoord(z));
    let edits = this.world.edits.get(key);
    if (!edits) {
      edits = new Map();
      this.world.edits.set(key, edits);
    }
    edits.set(blockIndex(toLocalCoord(x), y, toLocalCoord(z)), surface);
    for (let h = 1; h <= HEADROOM; h++) {
      edits.set(blockIndex(toLocalCoord(x), y + h, toLocalCoord(z)), Block.AIR);
    }
    this.roads.onBlockChanged(x, y, z, Block.GRASS, surface);
  }

  /** What to actually lay at a column: never something worse than what is already there.
   *  Widening a paved road would otherwise scrape it back to dirt, and the shovel's own
   *  sweep has always known better than to do that. */
  private betterOf(x: number, y: number, z: number, block: BlockId): BlockId {
    const here = `${x},${z}`;
    if (this.roads.columns.get(here) !== y) return block;
    const existing = this.roads.surfaces.get(here);
    if (existing === undefined) return block;
    return (ROAD_SPEED.get(existing) ?? 0) > (ROAD_SPEED.get(block) ?? 0) ? existing : block;
  }

  // --- screens and pausing ---------------------------------------------------

  /** Anything that takes the mouse away from the world: a container, or the warp box. */
  private get uiOpen(): boolean {
    return this.screens.isOpen || this.warpDialog.isOpen;
  }

  private openScreen(open: () => void): void {
    this.warpDialog.hide();
    open();
    this.options.input.releaseLock();
    document.body.classList.add('screen-open');
  }

  private closeScreen(): void {
    this.screens.close();
    this.openContainerPos = null;
    document.body.classList.remove('screen-open');
    this.relock();
  }

  /** Takes the pointer back after a screen closes. Escape only ever released the cursor
   *  because the screen had released it; handing it straight back means the player is
   *  looking around again without having to click. */
  private relock(): void {
    if (!this.ready || this.paused || this.player.isDead || this.uiOpen) return;
    this.options.input.requestLock();
    // The browser can refuse — the request rides on Escape, which is not a user gesture
    // everywhere. Waiting a moment before putting the prompt back means the usual case,
    // where the lock is granted, does not flash it up for a frame.
    window.setTimeout(() => {
      if (!this.running || this.paused || this.player.isDead || this.uiOpen) return;
      this.hud.setClickPrompt(!this.options.input.locked);
    }, 250);
  }

  // --- debug warping ---------------------------------------------------------

  private toggleWarpDialog(): void {
    if (this.warpDialog.isOpen) {
      this.closeWarpDialog();
      return;
    }
    // Any open screen goes without handing the pointer back, because the box wants it.
    this.screens.close();
    this.openContainerPos = null;
    this.warpDialog.openAt(this.player);
    this.options.input.releaseLock();
    document.body.classList.add('screen-open');
    this.hud.setClickPrompt(false);
  }

  private closeWarpDialog(): void {
    if (!this.warpDialog.isOpen) return;
    this.warpDialog.hide();
    document.body.classList.remove('screen-open');
    this.relock();
  }

  /** Jumps to a block column. Without a height the player lands just above the ground,
   *  which the generator can answer for anywhere — loaded chunk or not. */
  private jumpTo(x: number, z: number, y: number | null): void {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    // unstick() lifts the player out of anything they land inside of.
    this.player.teleportTo(
      bx + 0.5,
      y === null ? this.generator.height(bx, bz) + 2 : clampWarpY(y),
      bz + 0.5,
    );
  }

  /** The same jump, announced and with the box put away: what the G box and the console
   *  helper both do. */
  warpTo(target: WarpTarget): { x: number; y: number; z: number } {
    this.jumpTo(target.x, target.z, target.y);
    this.closeWarpDialog();
    this.hud.toast(`X ${Math.floor(target.x)} / Y ${Math.round(this.player.y)} / Z ${Math.floor(target.z)} へ移動した`);
    return { x: this.player.x, y: this.player.y, z: this.player.z };
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
    // Dying far from spawn means the spawn chunk has long since been unloaded, so there
    // is nothing to stand on yet and the generator's idea of the height can be several
    // blocks out. Settling again once the ground exists is what stops the player being
    // handed back their life and a fall for it. `teleportTo` resets the fall distance, so
    // the drop in the meantime costs nothing.
    this.settlePending = !this.settlePlayerOnGround();
    this.hud.setClickPrompt(!this.options.input.locked);
  }

  /** Starts the world with a finished road in it.
   *
   *  Everything about the transport layer is easier to believe once you have seen one:
   *  four hundred blocks of dirt path running from one village's street to another's,
   *  with porters already walking it. Reading "lay a road between two villages" and
   *  standing on one are not the same size of idea, and the road is what makes the
   *  difference between the two obvious.
   *
   *  It is written the way a player's would be — recorded edits, laid by `runRoad`,
   *  indexed through the ordinary block-change hook — so nothing about it is special
   *  except that nobody had to walk it. */
  buildSampleRoad(): { from: string; to: string; blocks: number } | null {
    const nearby = this.villages.ensureNear(this.player.x, this.player.z, 3);
    if (nearby.length < 2) {
      this.placeAtSpawn();
      return null;
    }
    const fromPlayer = (v: VillageRecord): number =>
      Math.hypot(v.x - this.player.x, v.z - this.player.z);
    let from = nearby[0];
    for (const village of nearby) if (fromPlayer(village) < fromPlayer(from)) from = village;
    // The neighbour whose road would come out closest to the length worth showing: far
    // enough to be a journey, near enough that a porter walks it inside a session, and
    // over country rather than out to sea — a causeway is a fine thing to build but a
    // poor thing to be handed, because it shows none of what a road crosses.
    let to: VillageRecord | null = null;
    let best = Infinity;
    for (const village of nearby) {
      if (village.id === from.id) continue;
      const run = this.roadRun(from, village);
      const score = Math.abs(run.blocks - SAMPLE_ROAD) + run.water * SAMPLE_ROAD;
      if (score < best) {
        best = score;
        to = village;
      }
    }
    if (!to) {
      this.placeAtSpawn();
      return null;
    }

    const start = this.roads.streetPoint(from, to.x, to.z);
    const end = this.roads.streetPoint(to, from.x, from.z);
    const blocks = this.runRoad(start, end, Block.DIRT_PATH, start.y, end.y, SAMPLE_WIDTH);
    // Then the same line again in rail, one column wide, skipping the stretch nearest the
    // player. The spine is worked out from `start` and `end` alone and is laid in order,
    // so this second pass lands on exactly the centre of the band the first one put down,
    // at the same heights — and `betterOf` keeps rail over dirt, so the road underneath
    // is not disturbed. What comes out is a road three across with rails down the middle
    // of all but its first `SAMPLE_RAIL_GAP` columns.
    let reached = 0;
    this.runRoad(start, end, Block.RAIL, start.y, end.y, 1, {
      take: () => ++reached > SAMPLE_RAIL_GAP,
    });
    const gap = Math.min(SAMPLE_RAIL_GAP, reached);
    this.player.inventory.add({ id: 'rail', count: gap + SAMPLE_RAIL_SPARE });
    this.villages.discover(from.id);
    this.villages.discover(to.id);
    this.transport.requestRoute(from.id, to.id);
    this.transport.invalidate();
    // Standing on the road, looking down it, is the whole point of the sample — so the
    // player starts on the road itself rather than in the middle of the village, and far
    // enough along it that they are not looking at the walls of a cutting.
    const stand = this.roadViewpoint(start, end);
    this.spawnPoint = { x: stand.x, z: stand.z };
    this.player.teleportTo(stand.x + 0.5, stand.y + 1, stand.z + 0.5);
    this.player.yaw = Math.atan2(-(end.x - start.x), -(end.z - start.z));
    this.sampleToast = `見本: ${from.name}と${to.name}を結ぶ ${blocks} マスの道（幅 ${SAMPLE_WIDTH}・荷車が通れる）`;
    // The second line is the invitation. The first says what is already there; this says
    // what is missing, where, and that the answer is in the player's hands.
    this.railToast =
      `この先はレールが敷いてある。足もとの ${gap} マスだけ空いているので、` +
      `持っているレールで埋めれば列車が走る（紫の光の柱がその場所）`;
    return { from: from.name, to: to.name, blocks };
  }

  /** A place along a fresh road worth standing on: on the road, a little way from the
   *  village, and out in the open rather than down in a cutting. */
  private roadViewpoint(start: RoadPoint, end: RoadPoint): RoadPoint {
    const steps = Math.max(Math.abs(end.x - start.x), Math.abs(end.z - start.z));
    let fallback: RoadPoint | null = null;
    for (let i = Math.min(10, steps); i <= steps; i++) {
      const x = Math.round(start.x + ((end.x - start.x) * i) / steps);
      const z = Math.round(start.z + ((end.z - start.z) * i) / steps);
      const y = this.roads.columns.get(`${x},${z}`);
      if (y === undefined) continue;
      fallback ??= { x, y, z };
      if (this.groundHeightAt(x, z) <= y) return { x, y, z };
    }
    return fallback ?? start;
  }

  /** What a road between two villages would come out as: how many columns, street to
   *  street, counted the way `runRoad` walks it, and what fraction of them would be
   *  bridge rather than road. */
  private roadRun(from: VillageRecord, to: VillageRecord): { blocks: number; water: number } {
    const start = this.roads.streetPoint(from, to.x, to.z);
    const end = this.roads.streetPoint(to, from.x, from.z);
    // A road goes up, down, left and right, so its length is the two legs added together
    // rather than the longer of them. Counting the way it used to be walked would pick a
    // pair whose finished road is half again as long as the sample is meant to be.
    const columns = Math.abs(end.x - start.x) + Math.abs(end.z - start.z) + 1;
    const steps = Math.max(Math.abs(end.x - start.x), Math.abs(end.z - start.z));
    let wet = 0;
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(start.x + ((end.x - start.x) * i) / steps);
      const z = Math.round(start.z + ((end.z - start.z) * i) / steps);
      if (this.groundHeightAt(x, z) <= SEA_LEVEL) wet++;
    }
    return { blocks: columns, water: wet / (steps + 1) };
  }

  // --- spawn placement -------------------------------------------------------

  /** What a new world starts with. Deliberately the two blocks everything else is built
   *  out of rather than tools: a bridge over the first stream, a floor, a way to fill in
   *  the dip a road has to cross. Handed out here rather than in `placeAtSpawn`, which
   *  also runs on respawn — a kit that arrives again every time the player dies is not a
   *  starting kit. */
  private stockStartingKit(): void {
    for (const id of STARTING_KIT) this.player.inventory.add({ id, count: STARTING_COUNT });
  }

  private placeAtSpawn(): void {
    const spawn = findSpawn(this.generator);
    this.spawnPoint = { x: spawn.x, z: spawn.z };
    this.player.teleportTo(spawn.x + 0.5, spawn.y, spawn.z + 0.5);
  }



  /** Drops the player onto the real surface. Returns false when the chunk under them has
   *  not been generated yet and there is no surface to drop onto. */
  private settlePlayerOnGround(): boolean {
    const x = Math.floor(this.player.x);
    const z = Math.floor(this.player.z);
    const top = this.world.heightAt(x, z);
    if (top < 0) return false;
    this.player.teleportTo(this.player.x, top + 1, this.player.z);
    return true;
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
          villageStage: mob.villageStage,
        })),
      populatedChunks: [...this.populatedChunks],
      villages: this.villages.toJSON(),
      freight: this.freightEarned,
      routes: this.transport.toJSON(),
      quest: this.questline.toJSON(),
      pendingVillagers: [...this.pendingVillagers],
      tracks: this.trackNet.toJSON(),
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
      /** Chunks still to be generated plus chunks generated but not yet turned into a
       *  mesh. Zero means what is on screen is what the world actually holds, which is
       *  what a screenshot wants to be sure of — and a condition to wait on instead of
       *  guessing at a duration. Water meshes are left out: a live river re-dirties them
       *  every tick, so they never reach zero. */
      backlog: (): number => this.pool.pending + this.world.dirtyChunks.size,
      difficulty: (): { current: string; rules: unknown; choices: string[] } => ({
        current: this.player.rules.id,
        rules: { ...this.player.rules },
        choices: DIFFICULTIES.map((rules) => rules.id),
      }),
      setDifficulty: (id: Difficulty): string => {
        this.setDifficulty(id);
        return this.player.rules.label;
      },
      hostiles: (): number => this.mobs.hostileCount,
      world: this.world,
      give: (id: string, count = 1): number => this.player.inventory.add({ id, count }),
      setTime: (time: number): void => {
        this.day.time = ((time % 1) + 1) % 1;
      },
      toggleDayCycle: (): boolean => (this.day.running = !this.day.running),
      toggleFly: (): boolean => (this.player.flying = !this.player.flying),
      /** Lands just above the terrain, without the toast the G box shows. */
      teleport: (x: number, z: number): void => this.jumpTo(x, z, null),
      /** Where the player is standing, to the block. */
      position: (): { x: number; y: number; z: number; chunkX: number; chunkZ: number } => ({
        x: Math.round(this.player.x * 10) / 10,
        y: Math.round(this.player.y * 10) / 10,
        z: Math.round(this.player.z * 10) / 10,
        chunkX: Math.floor(this.player.x / CHUNK_SIZE),
        chunkZ: Math.floor(this.player.z / CHUNK_SIZE),
      }),
      /** The G box from the console: `warp(120, -340)` or `warp(120, -340, 80)`. */
      warp: (x: number, z: number, y: number | null = null): { x: number; y: number; z: number } =>
        this.warpTo({ x, z, y }),
      /** Jumps to the nearest generated village, which is otherwise a long walk. */
      gotoVillage: (): { x: number; z: number } | null => {
        const village = this.generator.findNearestVillage(this.player.x, this.player.z, 4);
        if (village) this.debug.teleport(village.x, village.z);
        return village;
      },
      // --- villages, roads and transport ---------------------------------
      villages: () =>
        [...this.villages.byId.values()].map((v) => ({
          id: v.id, name: v.name, rank: rankLabel(v.stage), x: v.x, z: v.z,
          kind: v.kind, produces: v.produces, input: v.input, inputStock: v.inputStock,
          needs: [...v.needs], stage: v.stage, points: v.points, stock: v.stock,
          received: v.received, discovered: v.discovered,
          outpost: v.outpost ?? false, parent: v.parent ?? null,
        })),
      /** The village the player is standing in, or the nearest known one. */
      village: (): VillageRecord | null => {
        const here = this.villages.at(this.player.x, this.player.z);
        if (here) return here;
        let best: VillageRecord | null = null;
        let bestDistance = Infinity;
        for (const village of this.villages.byId.values()) {
          const distance = Math.hypot(village.x - this.player.x, village.z - this.player.z);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = village;
          }
        }
        return best;
      },
      /** Registers and reveals everything nearby, skipping the walk. */
      discoverNearby: (cellRadius = 2): number => {
        let found = 0;
        for (const village of this.villages.ensureNear(this.player.x, this.player.z, cellRadius)) {
          if (this.villages.discover(village.id)) found++;
        }
        return found;
      },
      quest: () => ({
        step: this.questline.step,
        origin: this.questline.originId,
        target: this.questline.targetId,
        cargo: this.questline.cargo,
      }),
      /** Skips a tutorial step from the console when there is no villager to hand. */
      questStep: (kind: 'accept' | 'deliver' | 'learn'): string | null => {
        const message = this.questline.complete(kind, this.villages);
        this.linkQuestVillages();
        return message;
      },
      gotoQuestTarget: (): { x: number; z: number } | null => {
        const objective = this.questline.objective(this.villages, this.focusRoute(), this.networkState());
        if (!objective?.marker) return null;
        this.debug.teleport(objective.marker.x, objective.marker.z);
        return { x: objective.marker.x, z: objective.marker.z };
      },
      routes: () =>
        this.transport.routes.map((route) => ({
          from: route.from, to: route.to, good: route.good,
          connected: route.connected, length: route.length, missing: route.missing,
          porters: route.porters.length, quality: Math.round(route.quality * 100) / 100,
          grade: route.grade, load: this.transport.loadOf(route), delivered: route.delivered,
          wanted: this.villages.get(route.to)?.needs.includes(route.good) ?? false,
          vehicle: route.vehicle, climb: route.climb,
          detour: Math.round(route.detour * 100) / 100,
          direct: Math.round(route.direct), doorGap: Math.round(route.doorGap),
          cartPinch: route.cartPinch, railPinch: route.railPinch, nearMiss: route.nearMiss,
        })),
      /** Everything the L screen shows, without opening it. */
      ledger: (): LedgerView => this.ledgerView(),
      /** Emeralds the network has paid out so far. */
      earnings: (): number => this.freightEarned,
      milestones: () => ({
        index: this.questline.milestone,
        current: this.questline.currentMilestone()?.title ?? null,
        all: MILESTONES.map((m) => m.title),
      }),
      porters: () =>
        this.mobs.mobs.filter((mob) => HAULING_KINDS.includes(mob.kind)).length,
      /** Where every shipment currently is, whether or not anybody can see it. Standing
       *  at one of these is what makes a porter appear. */
      porterSpots: () =>
        this.transport.routes.flatMap((route) =>
          route.porters
            .map((porter) => this.transport.pointAt(route, porter.t))
            .filter((point): point is RoadPoint => point !== null)
            .map((point) => ({ x: Math.round(point.x), y: point.y, z: Math.round(point.z) })),
        ),
      /** What the in-world guide is drawing right now: lines along working roads, dashed
       *  ones across what is missing, beacons at both ends of a gap and over every
       *  shipment, and a tile per indexed road column near the player. */
      guide: () => {
        const view = this.guideView();
        return {
          lines: view.lines.length,
          dashed: view.lines.filter((line) => line.dashed).length,
          tiles: view.tiles.length,
          beams: view.beams.length,
        };
      },
      /** Every addressable building of the village the player is standing in, and which
       *  of them goods come and go through. */
      buildings: () => {
        const here = this.villages.at(this.player.x, this.player.z);
        if (!here) return null;
        const depot = this.depotFor(here);
        return {
          village: here.name,
          depot: depot?.id ?? null,
          list: this.buildingsFor(here).map((b) => ({
            id: b.id, label: b.label, role: b.role,
            x0: b.x0, z0: b.z0, w: b.w, d: b.d,
            door: b.door, outside: b.outside,
            depot: b.id === depot?.id,
          })),
        };
      },
      /** What the crosshair is on, and the key that would claim it. */
      lookingAt: () => this.buildingPrompt(),
      /** Moves a village's loading and unloading, the way looking at a building and
       *  pressing F does. */
      setDepot: (id: string): string | null => {
        const here = this.villages.at(this.player.x, this.player.z);
        if (!here) return null;
        const building = this.buildingsFor(here).find((b) => b.id === id);
        if (!building) return null;
        here.depot = building.id;
        this.transport.invalidate();
        return building.label;
      },
      /** Develops the village the player is standing in, one stage at a time, the way a
       *  delivery does. Hauling forty crates to watch a house go up is the game rather
       *  than the browser test. */
      growHere: (stage = 4): { name: string; stage: number; plots: Footprint[]; next: Footprint[] } | null => {
        const here = this.villages.at(this.player.x, this.player.z);
        if (!here) return null;
        const occupied = this.generator.villageBuildings(here.x, here.z);
        const plots: Footprint[] = [];
        while (here.stage < stage) {
          const grew = this.villages.addPoints(here.id, STAGE_POINTS[here.stage]);
          if (grew === null) break;
          // Banking the points is only half of it: a delivery raises the buildings too,
          // and that is the half this is here to look at.
          this.onVillageGrew(here.id, grew);
          plots.push(...growthFor(this.options.seed, here, grew, occupied).footprints);
        }
        // The plots the stage after this one would fill, so a test can put something on
        // one before the village gets there. Planning a stage does not build it.
        const next = here.stage >= STAGE_POINTS.length
          ? []
          : growthFor(this.options.seed, here, here.stage + 1, occupied).footprints;
        return { name: here.name, stage: here.stage, plots, next };
      },
      /** Every block one growth stage wants to put down, for working out why one of them
       *  is not there. */
      planFor: (stage: number) => {
        const here = this.villages.at(this.player.x, this.player.z);
        if (!here) return [];
        const occupied = this.generator.villageBuildings(here.x, here.z);
        return growthFor(this.options.seed, here, stage, occupied).placements;
      },
      /** State of the road index, for working out why a road is not joining up. */
      roadIndex: () => ({ columns: this.roads.columns.size, revision: this.roads.revision }),
      /** The world's clock speed, and how much of it the machine is keeping up with. */
      speed: () => ({ set: this.options.settings.speed, effective: this.effectiveSpeed }),
      setSpeed: (speed: number): number => this.setSpeed(speed),
      /** Road the player laid that the index will not have, and why. */
      roadFaults: (radius = FAULT_REACH): RoadFault[] => this.roadFaults(radius),
      /** Widens the quest route's road to what a cart needs, the way walking its length
       *  again with a shovel would. Three columns for four hundred blocks is the player's
       *  afternoon, not the browser test's. */
      widenRoad: (fromId?: string, toId?: string): number =>
        this.debugBuildRoad(fromId, toId, undefined, 3),
      /** Lays a road between the quest's two villages. Building 300 blocks of it by hand
       *  is the player's job, not the smoke test's. */
      buildRoad: (fromId?: string, toId?: string, surface?: string): number =>
        this.debugBuildRoad(fromId, toId, surface),
      /** Rails the quest route from end to end, which is what puts a train on it. Single
       *  track, because that is all a train asks for. */
      buildRailway: (fromId?: string, toId?: string): number =>
        this.debugBuildRoad(fromId, toId, 'rail', 1),
      /** Builds the sample world's road here and now, and stands the player on it. */
      sampleRoad: (): { from: string; to: string; blocks: number } | null =>
        this.buildSampleRoad(),

      // --- the free-form railway (curves, not blocks) ---
      /** Lays a curve between two points without aiming at anything. The angles are yaw
       *  in radians, the same convention the player's own heading uses. */
      layTrack: (
        from: { x: number; y: number; z: number; yaw: number },
        to: { x: number; y: number; z: number; yaw: number },
      ) => this.debugLayTrack(from, to),
      /** From where the player stands, along their yaw, turning by `turn` radians. */
      layTrackHere: (span = 24, turn = 0) => {
        const yaw = this.player.yaw;
        const y = this.player.y + 0.5;
        return this.debugLayTrack(
          { x: this.player.x, y, z: this.player.z, yaw },
          {
            x: this.player.x - Math.sin(yaw + turn / 2) * span,
            y,
            z: this.player.z - Math.cos(yaw + turn / 2) * span,
            yaw: yaw + turn,
          },
        );
      },
      /** A straight run and two curves laid end to end from here, for seeing the lot at
       *  once. The counterpart of `sampleRoad` for the railway that is not made of blocks. */
      sampleTrack: (): { edges: number; length: number } => this.buildSampleTrack(),
      tracks: () => ({
        nodes: this.trackNet.nodes.size,
        edges: this.trackNet.edges.size,
        length: this.trackNet.totalLength(),
        revision: this.trackNet.revision,
        freeEnds: this.trackNet.freeEnds().length,
      }),
      trackEdges: () => [...this.trackNet.edges.values()].map((edge) => ({
        id: edge.id,
        a: edge.a,
        b: edge.b,
        length: edge.curve.length,
        minRadius: edge.curve.minRadius,
        steepest: edge.curve.steepest,
        segments: edge.curve.plan.map((piece) => piece.kind),
      })),
      /** The height of the deck over a point, or null where there is none to stand on. */
      trackDeckAt: (x: number, z: number, low = -64, high = 320): number | null =>
        this.trackNet.surfaceTopAt(x, z, low, high),
      /** A point on a laid curve, so a test can check the shape rather than a vertex count. */
      trackAt: (edgeId: number, s: number): TrackPoint | null => {
        const edge = this.trackNet.edges.get(edgeId);
        return edge ? pointAt(edge.curve, s) : null;
      },
      trackTangentAt: (edgeId: number, s: number): TrackPoint | null => {
        const edge = this.trackNet.edges.get(edgeId);
        return edge ? tangentAt(edge.curve, s) : null;
      },
      /** What the tool is doing: whether it is even in hand, and whether a start is down. */
      trackTool: () => ({
        held: this.heldTrackTool(),
        pending: this.trackDraft?.anchor ?? null,
        ghost: this.trackGhost ? (this.trackGhost.valid ? 'valid' : 'invalid') : 'none',
        fault: this.trackGhostFault,
        readout: this.trackReadout,
        aim: this.trackAim().point,
      }),
      /** What the renderer is being handed right now. */
      trackView: () => {
        const view = this.trackView(TRACK_VIEW_INTERVAL);
        return view === null ? null : {
          key: view.key,
          edges: view.edges.length,
          samples: view.edges.reduce((total, edge) => total + edge.samples.length, 0),
          piers: view.piers.length,
          markers: view.markers.length,
          ghost: view.ghost ? (view.ghost.valid ? 'valid' : 'invalid') : 'none',
        };
      },
      /** The debug mode itself: nothing is used up, and `C` opens a shelf of everything. */
      creative: (on?: boolean): boolean => {
        const next = on ?? !this.options.settings.creative;
        this.options.settings.creative = next;
        this.player.inventory.unlimited = next;
        if (!next && this.screens.kind === 'creative') this.closeScreen();
        this.hud.toast(next ? 'デバッグ: 全アイテム無限（C で一覧）' : 'デバッグモードを切にした');
        return next;
      },
      /** Fills the hotbar and pockets with as much of the game as will fit. The shelf
       *  behind `C` holds the rest; this is for a console one-liner. */
      giveAll: (): number => {
        let given = 0;
        for (const def of allItems()) {
          if (this.player.inventory.add({ id: def.id, count: def.maxStack }) === 0) given++;
        }
        return given;
      },
      clearTracks: (): number => {
        this.cancelTrackDraft(false);
        return this.trackNet.clear();
      },
      /** Road columns the index holds inside a square, for checking that a sweep of the
       *  shovel left an unbroken road rather than a dotted line. */
      roadColumnsNear: (x: number, z: number, radius = 24): RoadPoint[] =>
        this.roads.columnsIn(x - radius, z - radius, x + radius, z + radius),
      /** Runs the transport clock forward, the way setWeatherSeconds does for weather.
       *  Nothing is drawn while it runs, so it deliberately reports the player as far
       *  away: a visible porter is driven by its mob, which cannot walk inside a
       *  synchronous loop. */
      advanceTransport: (seconds: number): void => {
        const step = 0.5;
        const away = 1e7;
        for (let t = 0; t < seconds; t += step) {
          this.villages.produce(step);
          this.transport.update(step, away, away);
        }
      },
      /** Opens a container screen without having to place and click the block. */
      openScreen: (kind: 'inventory' | 'crafting' | 'furnace' | 'chest' | 'ledger' | 'help'): void => {
        this.openScreen(() => {
          if (kind === 'crafting') this.screens.openCraftingTable();
          else if (kind === 'furnace') this.screens.openFurnace(createFurnace());
          else if (kind === 'chest') this.screens.openChest(createChest().slots);
          else if (kind === 'ledger') this.screens.openLedger(() => this.ledgerView());
          else if (kind === 'help') this.screens.openHelp(() => this.helpView());
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
          /** Loaded chunks with a river in them, which are the ones being kept up to date. */
          riverChunks: this.riverFlow.trackedCount,
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
      /** Sets the world clock outright, which is how the browser tests watch a change
       *  upstream arrive here a few minutes later. */
      setWeatherSeconds: (seconds: number): number => {
        this.advanceWeather(Math.max(0, seconds));
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
    // After the edits are in place: the road index is built from them, not from the
    // world, which is what lets a road be surveyed while its chunks are still unloaded.
    this.villages.loadJSON(data.villages);
    this.roads.seedFromEdits();
    this.transport.loadJSON(data.routes);
    this.questline.loadJSON(data.quest);
    this.freightEarned = data.freight ?? 0;
    // Absent in every world written before this railway existed, which opens with none
    // laid - the right answer, and the reason SAVE_VERSION did not have to move.
    if (data.tracks) this.trackNet = TrackNetwork.fromJSON(data.tracks);
    for (const pending of data.pendingVillagers ?? []) this.pendingVillagers.push(pending);
    for (const key of data.populatedChunks) this.populatedChunks.add(key);
    for (const villager of data.villagers) {
      const mob = this.mobs.addVillager(villager.x, villager.y, villager.z, villager.profession);
      const trades = tradesFromJSON(villager.trades);
      if (trades.length > 0) mob.trades = trades;
      // Without this the offers would be rolled again the first time the player opened
      // the screen, quietly restocking everything they had already bought.
      mob.villageStage = villager.villageStage ?? -1;
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

/** Why a curve was refused, in a sentence the player can act on. The numbers come from
 *  `tracks.ts` rather than being typed out again here. */
function trackFaultText(fault: TrackFault, value: number, turn: 'left' | 'right' | null = null): string {
  switch (fault) {
    case 'short':
      return `始点に近すぎる（${MIN_SPAN} マス以上はなれた所を指す）`;
    case 'long':
      return `一度に敷けるのは ${MAX_SPAN} マスまで（今 ${Math.round(value)} マス）`;
    case 'behind':
      return '始点の向きの後ろへはつなげない';
    case 'radius':
      // Which way it was turning, because "too tight" is not something a player can act
      // on until they know which way to turn their head to loosen it.
      return `曲がりが急すぎる（${turn ? `${bendWord(turn)} ` : ''}半径 ${value.toFixed(1)} マス、${MIN_RADIUS} マス以上必要）`;
    case 'grade':
      return `勾配が急すぎる（${slopeWord(value)} ${Math.round(Math.abs(value) * 100)}%、${Math.round(MAX_GRADE * 100)}% まで）`;
    case 'occupied':
      return 'その線路の端は両側ともふさがっている';
    default:
      return 'この向きではつなげない';
  }
}

/** Anything under half a percent is level, and saying "up 0%" would be worse than
 *  saying nothing. */
const LEVEL = 0.005;

function slopeWord(grade: number): string {
  return Math.abs(grade) < LEVEL ? '水平' : grade > 0 ? '上り' : '下り';
}

function bendWord(turn: 'left' | 'right'): string {
  return turn === 'right' ? '右' : '左';
}

/** The shape under the crosshair, in the three lines the readout shows and the toast
 *  borrows. Horizontal length, because that is what everything in `tracks.ts` measures. */
function trackLines(summary: TrackSummary): string[] {
  // Signed off the rounded number, not the raw one: a run that drops four centimetres
  // should not be labelled "-0.0".
  const climbed = Math.abs(summary.rise).toFixed(1);
  const rise = climbed === '0.0' ? '±0.0' : `${summary.rise > 0 ? '+' : '-'}${climbed}`;
  const slope = Math.abs(summary.steepest) < LEVEL
    ? '勾配 なし（水平）'
    : `勾配 ${slopeWord(summary.steepest)} ${Math.round(Math.abs(summary.steepest) * 100)}%（高低差 ${rise} マス）`;
  const bend = summary.bend === 'straight'
    ? '曲がり なし（直線）'
    : summary.bend === 's'
      ? `曲がり S字 半径 ${summary.radius.toFixed(1)} マス`
      : `曲がり ${bendWord(summary.bend)} 半径 ${summary.radius.toFixed(1)} マス`;
  return [`長さ ${summary.length.toFixed(1)} マス`, slope, bend];
}
