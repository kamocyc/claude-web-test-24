import * as THREE from 'three';
import { boxIntersectsWorld, type StandingSurface } from '../core/aabb';
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
  type TrackSignalView,
  type TrackStationView,
  type TrackView,
} from '../render/trackRenderer';
import { createChunkMaterials, type ChunkMaterials } from '../render/materials';
import { Sky } from '../render/sky';
import { buildAtlas, type Atlas } from '../render/textures';
import {
  RideDecks,
  TRAIL_STEP,
  consistLength,
  consistOf,
  decksOf,
  offDeck,
  onDeck,
  posesAlong,
  pushTrail,
  seedTrail,
  type CarDeck,
  type CarPose,
} from './consist';
import { Block, type BlockId, blockDef, isFarmland, isReplaceable, supportsPlant } from '../world/blocks';
import {
  CHUNK_HEIGHT,
  CHUNK_SIZE,
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
import { WorldMap } from '../ui/worldMap';
import type { CompassMarker } from '../ui/compass';
import { ScreenManager } from '../ui/screens';
import { WarpDialog } from '../ui/warpDialog';
import { clampWarpY, type WarpTarget } from './warp';
import { createChest, createFurnace, isChest, isFurnace } from './blockEntities';
import { applyDamage, applyKnockback } from './combat';
import { DIFFICULTIES, type Difficulty, difficultyRules } from './difficulty';
import { DayCycle } from './daycycle';
import { DropManager } from './drops';
import { EXHAUSTION } from './hunger';
import { HOTBAR_SIZE, type ItemStack } from './inventory';
import { allItems, itemDef, itemLabel } from './items';
import { fillVillageChest } from './loot';
import { bestToolSlot, blockDrops, heldTool, miningTime } from './mining';
import { Mob } from './mobs/ai';
import { MobManager, type MobUpdateContext } from './mobs/spawner';
import { HAULING_KINDS, type MobKind } from './mobs/types';
import { MapMemory, SurveyedTerrain } from './cartography';
import { NO_INPUT, PLAYER_HEIGHT, PLAYER_WIDTH, Player, type PlayerInput } from './player';
import {
  type SaveData,
  downloadSave,
  writeSave,
} from './save';
import { findSpawn } from './seeds';
import { SPEEDS, nearestSpeed } from './settings';
import { tickFurnace } from './smelting';
import { generateTrades, restockTrades } from './trading';
import { VILLAGE_RADIUS, type Footprint, type HouseRecord } from '../world/generation/village';
import {
  HEADROOM,
  ROAD_SPEED,
  RoadNetwork,
  faultText,
  townPlace,
  type RoadFault,
  type RoadPoint,
} from './roads';
import {
  MIN_SPAN,
  SNAP_RADIUS,
  STATION_REACH,
  TrackNetwork,
  freePorts,
  edgesOf,
  headingOf,
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
  type TrackSample,
} from './tracks';
import { runRoad, treadBrush, treadLine, TREAD_DIRT, type PaveMaterial, type PaveTarget } from './paving';
import {
  CATCH_UP,
  carsFor,
  PORTER_LEASH,
  PORTER_LOST,
  TransportNetwork,
  type Arrival,
  type PorterView,
  type Route,
  type Vehicle,
} from './transport';
import {
  FARMED,
  PASSENGER,
  PASSENGER_LABEL,
  STAGE_POINTS,
  VillageRegistry,
  displayName,
  radiusOf,
  rankLabel,
  villageId,
  type GoodId,
  type VillageId,
  type VillageRecord,
} from './villages';
import { CELL_STOCK, TownEconomy, type Commute } from './townEconomy';
import { LineNetwork, MAX_LINE_STOPS, STOP_SPACING, STOP_TOWN_REACH, type Stop } from './lines';
import { networkSites, STOP_SITE_REACH } from './sites';
import {
  INDUSTRY_SPACING,
  IndustryRegistry,
  MAX_INDUSTRY_STOCK,
  depositMissReason,
  industryType,
  surveyGround,
  type Industry,
} from './industry';
import type { LedgerTown, LedgerView } from '../ui/ledger';
import type { RouteIdle } from '../ui/routePanel';
import type { LineActions, LinePanelView } from '../ui/linePanel';
import { helpView, type HelpView } from '../ui/help';
import { applyFields, countFields } from './villageFields';
import { fieldArea, fieldTarget, fieldsAt } from '../world/generation/fields';
import { applyGrowth, growthChunks, growthFor, growthVillagers, outpostBuildings, ownPaving, roadCrosses } from './villageGrowth';
import {
  buildingAt,
  buildingsOf,
  depotOf,
  describeBuilding,
  pathAroundPlots,
  pointAlongPath,
  useLabel,
  type VillageBuilding,
} from './buildings';
import { outpostRecord, outpostSite } from './outpost';
import { MILESTONES, Questline, gapText, type NetworkState, type QuestInteraction } from './questline';
import { biomeDef } from '../world/generation/biome';
import {
  ATTACK_REACH,
  AUTOSAVE_SECONDS,
  BUILDING_REACH,
  COMMUTE_VISIBLE,
  FAULT_REACH,
  FAULT_TOAST_INTERVAL,
  GUIDE_DEPOT,
  GUIDE_FAULT,
  GUIDE_GAP,
  GUIDE_LINK,
  GUIDE_NARROW,
  GUIDE_NOLINK,
  GUIDE_PORTER,
  GUIDE_RAILGAP,
  GUIDE_ROAD,
  GUIDE_STALL,
  GUIDE_STATION,
  GUIDE_TILE_REACH,
  INDUSTRY_REACH,
  LINK_VISIBLE,
  MESH_BUDGET,
  MINIMAP_RAIL_STEP,
  MINIMAP_REACH,
  PAVE_BRIDGE,
  PAVE_INTERVAL,
  PIER_MIN_GAP,
  PIER_STEP,
  PORT_MARK_OUT,
  REACH,
  ROAD_GRADE,
  ROAD_REACH,
  SAMPLE_ROAD,
  SAMPLE_STATIONS,
  SAMPLE_STOPS,
  SAMPLE_TRACK_CLEAR,
  SAMPLE_TRACK_GAP,
  SAMPLE_TRACK_GRADE,
  SAMPLE_TRACK_OFFSET,
  SAMPLE_TRACK_PROBE,
  SAMPLE_TRACK_SPARE,
  SAMPLE_TRACK_STEP,
  SAMPLE_WIDTH,
  STALL_LIGHT,
  STARTING_COUNT,
  STARTING_KIT,
  STOP_REACH,
  TRACK_DRAW,
  TRACK_END_MARK,
  TRACK_LIFT,
  TRACK_PICK,
  TRACK_REACH,
  TRACK_SPLIT_MARK,
  TRACK_START_MARK,
  TRACK_VIEW_INTERVAL,
  TUTORIAL_STOPS,
  UNLOAD_MARGIN,
  WATER_MESH_BUDGET,
  WORLD_BUDGET_MS,
} from './gameConstants';
import { rayBoxDistance, roundPoint } from './gameGeometry';
import { movementFromInput, punctuationCommand } from './gameInput';
import { bearingBetween, isWithin } from './gameNavigation';
import { createGameSnapshot, restoreSaveFoundation, restoreSavedVillagers } from './gamePersistence';
import type { GameOptions, StopLink } from './gameTypes';
import {
  LEVEL,
  RIDE_LOST,
  bendWord,
  centreOf,
  slopeWord,
  trackFaultText,
  trackLines,
  type TrackAim,
  type TrackRun,
} from './trackInteraction';

export type { GameOptions } from './gameTypes';

export class Game {
  readonly world: World;
  readonly player = new Player();
  /** Every chunk the player has ever had loaded, as a surveyed surface, so the maps can
   *  draw the ground they have walked over long after it was thrown away. */
  readonly mapMemory = new MapMemory();
  /** What the maps read: the loaded world first, the survey behind it, nothing beyond. */
  private readonly surveyed: SurveyedTerrain;
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
  /** What the track tool was pointing at this frame, for the markers. */
  private trackAimCache: TrackAim | null = null;
  /** The tops of the trains that are currently drawn, rebuilt every world step. */
  private readonly rideDecks = new RideDecks();
  /** The deck the player is standing on and whereabouts on it, in the car's own frame.
   *  Null when they are on solid ground. */
  private riding: { id: string; along: number; across: number } | null = null;
  /** Frames a carriage would have carried the player into a wall and did not. */
  private rideRefused = 0;
  /** Everything under the player's feet that the block grid does not know about: the
   *  railway's decks and platforms, and the carriages running along them. Held as one
   *  object rather than assigned per frame because the player keeps a reference to it, and
   *  because which of the two answers is the higher one is nobody else's business. */
  private readonly playerSurface: StandingSurface = {
    surfaceTopAt: (x, z, low, high) => {
      const rails = this.trackNet.surfaceTopAt(x, z, low, high);
      const car = this.rideDecks.surfaceTopAt(x, z, low, high);
      if (rails === null) return car;
      return car === null ? rails : Math.max(rails, car);
    },
  };
  /** The railway as the map draws it, kept until the track or the player moves far
   *  enough to matter. Sampling every curve in range is the same work the world renderer
   *  caches, and the map asks for it on every frame. */
  private railMap: { key: string; lines: { x: number; z: number }[][] } | null = null;
  /** The start of a curve that has been clicked but not yet finished. */
  /** The start of the run being laid: where it is, the end it snapped to if it snapped to
   *  one, and the run it will cut when the far end goes down if it started on one. */
  private trackDraft: {
    anchor: TrackAnchor;
    node: number | null;
    split?: { edge: number; at: number };
  } | null = null;
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
  /** The industry under the crosshair. Kept apart from `lookedAt` because an industry is
   *  not in a village and is found by distance rather than by plot. */
  private lookedAtWorks: Industry | null = null;
  /** The block the crosshair is on, within the player's reach. */
  private aimHit: RaycastHit | null = null;
  /** The rail end the crosshair is on, while a station is in hand. */
  private aimNode: TrackNode | null = null;
  private focusCache: { at: number; route: Route | undefined } = { at: -1e9, route: undefined };
  private readonly effects: Effects;
  private readonly sky: Sky;
  private readonly light: LightEngine;
  private readonly water: WaterSimulator;
  private readonly generator: TerrainGenerator;
  private readonly pool: ChunkWorkerPool;
  private readonly mobs: MobManager;
  private readonly drops: DropManager;
  private readonly hud: Hud;
  /** The big map, on M. Same map as the corner one, at any size the player asks for. */
  private readonly worldMap: WorldMap;
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
  /** What is going on inside those villages: who lives where, what each building wants,
   *  and who is walking across town to work. */
  private readonly towns: TownEconomy;
  /** Commuter mobs by the commute they are drawing, keyed the way porters are. */
  private readonly commuterMobs = new Map<number, Mob>();
  /** The walk each commute is following. Weak, so it goes when the commute does. */
  private readonly commutePaths = new WeakMap<Commute, { x: number; y: number; z: number }[]>();
  private readonly roads: RoadNetwork;
  private readonly transport: TransportNetwork;
  /** The service the player has designed, and the places it calls at. */
  private readonly lines = new LineNetwork();
  /** Which revision of that the legs were last rebuilt from. */
  private linesAt = -1;
  /** Which line the line table's 「加える」 buttons add to. */
  private selectedLine: string | null = null;
  /** The primary industries they have sited. */
  private readonly industries = new IndustryRegistry();
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
    this.surveyed = new SurveyedTerrain(this.world, this.mapMemory);
    this.generator = new TerrainGenerator(options.seed);
    this.light = new LightEngine(this.world);
    this.water = new WaterSimulator(this.world);
    // The town is built first and handed to the registry, so a delivery reaches the
    // buildings that asked for it without the registry ever learning what a building is.
    // `buildingsOf` is read through a closure rather than captured because the building
    // list is rebuilt whenever a road block moves.
    this.towns = new TownEconomy(options.seed, {
      buildingsOf: (id) => {
        const village = this.villages.get(id);
        return village ? this.buildingsFor(village) : [];
      },
    });
    this.villages = new VillageRegistry(options.seed, this.generator, this.towns);
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
    this.scene.add(
      this.chunkRenderer.group, this.entityRenderer.group, this.effects.group,
      this.routeGuide.group, this.trackRenderer.group,
    );

    this.mobs = new MobManager(this.world, options.seed);
    this.drops = new DropManager(this.world);
    this.transport = new TransportNetwork(
      this.roads,
      // What a stop is attached to. `sites.ts` is the one place that knows about towns
      // and industries at the same time; transport itself has never heard of either.
      networkSites(this.villages, this.industries, {
        doorOf: (id) => this.depotDoor(id),
        plotsOf: (id) => {
          const village = this.villages.get(id);
          if (!village) return [];
          // The well at the crossing is not a building, and it is just as solid: a roof
          // on four corner posts over a three by three. A walk that cuts across it is a
          // porter standing in a post, so it counts as something to go round. A hamlet
          // has no well.
          if (village.outpost) return this.buildingsFor(village);
          return [
            ...this.buildingsFor(village),
            { x0: village.x - 1, z0: village.z - 1, w: 3, d: 3 },
          ];
        },
      }),
      {
        onConnected: (route) => this.onRouteConnected(route),
        onDisconnected: (route) => this.announceRoute(route, 'とぎれた'),
        onArrival: (arrival) => this.onShipmentArrived(arrival),
        onStageUp: (at, stage) => {
          if (at.town) this.onVillageGrew(at.town, stage);
        },
      },
      {
        spawnPorter: (point, vehicle, cargo, good) => this.spawnPorter(point, vehicle, cargo, good),
        porterPosition: (id) => {
          const mob = this.livePorter(id);
          return mob ? { x: mob.x, z: mob.z } : null;
        },
        movePorter: (id, point, speed) => this.movePorter(id, point, speed),
        removePorter: (id) => this.removePorter(id),
      },
      // The railway, as the two questions freight has of it. `this.trackNet` is read
      // through the closures rather than captured, because loading a save replaces the
      // network wholesale and a captured one would leave transport surveying the world
      // the player left behind.
      {
        wayBetween: (from, to) => this.trackNet.wayBetween(from, to),
        railheadTowards: (from, to) => this.trackNet.railheadTowards(from, to),
        stationGapAt: (place) => this.trackNet.stationGapNear(place),
        revision: () => this.trackNet.revision,
      },
    );
    this.hud = new Hud(this.atlas);
    this.worldMap = new WorldMap(this.atlas, () => this.toggleWorldMap());
    this.worldMap.bindWarp((x, z) => this.warpFromMap(x, z));
    this.screens = new ScreenManager(
      this.player,
      this.atlas,
      (stack) => this.dropAtPlayer(stack),
      (recipe, made) => this.hud.toast(`${itemLabel(recipe.result.id)} を ${made * recipe.result.count} 個作った`),
    );

    document.body.append(this.hud.root, this.worldMap.root, this.screens.layer, this.warpDialog.root);
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
    this.pool.dispose();
    this.chunkRenderer.dispose();
    this.trackRenderer.dispose();
    this.hud.root.remove();
    this.worldMap.dispose();
    this.worldMap.root.remove();
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
    // wholesale. The only other thing given a surface is the train, in `spawnPorter`: it
    // has freight to carry along the deck. A porter or a cart has no reason to be up on a
    // viaduct and no way down off one, and a dropped item has neither — and none of them
    // has any business standing on a moving carriage, which is why they get the rails and
    // the player gets the rails and the trains on them.
    this.player.surface = this.playerSurface;
    this.applyDifficulty();
    if (this.settlePending && this.settlePlayerOnGround()) this.settlePending = false;
    this.water.setCenter(this.player.x, this.player.z);
    this.runWorld(dt);
    // The trains have moved; anybody standing on one goes with it, before their own move
    // is worked out from where they now are.
    this.carryRider();
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
    this.recordRide();
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
    const navigation = this.navigationInfo();
    this.hud.update(dt, this.player, this.debugInfo(), navigation);
    this.worldMap.update(this.surveyed, this.player, navigation.overlay);

    this.villageSearchTimer -= dt;
    if (this.villageSearchTimer <= 0) {
      this.villageSearchTimer = 2;
      // Registering is what makes a village *knowable*; walking into it is what makes it
      // discovered. Both ride the same timer because both walk the same village grid.
      this.villages.ensureNear(this.player.x, this.player.z, 2);
      this.nearestVillage = this.generator.findNearestVillage(this.player.x, this.player.z, 2);
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
    // Out here rather than inside the step, because this draws rather than simulates: at
    // ×16 the town is stepped sixteen times and the people walking across it are put
    // where they have got to once, which is all a frame can show anyway.
    this.updateCommuters();
  }

  /** One step of everything that is not the player. */
  private stepWorld(dt: number): void {
    this.water.update(dt);
    this.day.update(dt);
    this.updateMobs(dt);
    this.updateDrops(dt);
    this.updateTicks(dt);
    this.updateFurnaces(dt);
    this.updateVillages(dt);
    // Last, so the cars are placed from where the engines finished this step rather than
    // from where they started it. At more than single speed the world takes several steps
    // a frame, and a trail that only saw the last of them would be a train that jumped.
    this.updateTrains();
  }

  /** Runs the world's clock forward without waiting for the frames it would take.
   *
   *  Exactly what game speed does — `stepWorld` over and over — with two differences that
   *  only make sense from a console. There is no frame budget, so it runs the whole span
   *  asked for rather than as much of it as fits; and the once-every-two-seconds village
   *  sweep runs along with it, because that sweep is on the *frame* clock rather than the
   *  world's, and a hundred seconds of world with no sweep in it is a hundred seconds in
   *  which nothing is discovered and no goal is claimed.
   *
   *  This is what makes the browser test runnable in a coffee break. A porter that takes
   *  forty seconds to walk a road is forty seconds of waiting or forty milliseconds of
   *  this, and as far as anything under test is concerned they are the same forty seconds:
   *  the clock is the truth, and this only turns the handle faster.
   *
   *  What it cannot skip is chunk generation, which happens on workers and in its own
   *  time. Anything waiting on the world to *exist* still has to wait. */
  fastForward(seconds: number, step = 0.5): number {
    const dt = Math.max(0.05, Math.min(1, step));
    const steps = Math.max(0, Math.round(Math.max(0, seconds) / dt));
    for (let i = 0; i < steps; i++) {
      this.stepWorld(dt);
      this.villageSearchTimer -= dt;
      if (this.villageSearchTimer > 0) continue;
      this.villageSearchTimer = 2;
      this.villages.ensureNear(this.player.x, this.player.z, 2);
      this.claimMilestones();
    }
    // The commuters are drawn once a frame rather than once a step, so they are caught up
    // here rather than sixteen times over.
    if (steps > 0) this.updateCommuters();
    return steps;
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
    this.sky.update(this.day, this.camera, this.renderer);
    this.renderer.render(this.scene, this.camera);
  }

  /** Places worth walking back to, refreshed at most once a second because finding
   *  the nearest village walks the village grid. */
  private navigationInfo(): NavigationInfo {
    // How far out the overlays have to reach. The corner map's own span while it is the
    // only map up; the big one's while that is open, or a road two villages away would be
    // missing from the very view somebody opened the map to see it in.
    const mapReach = this.worldMap.isOpen
      ? Math.max(MINIMAP_REACH, this.worldMap.reach)
      : MINIMAP_REACH;
    // Where the overlays have to be gathered *around*, which is not the player once the
    // big map has been dragged: a map slid two villages over needs the roads from over
    // there, and gathering them around the player would leave it drawing bare ground.
    const mapAt = this.worldMap.isOpen ? this.worldMap.centreFrom(this.player) : this.player;
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
    return {
      surface: this.surveyed,
      markers,
      showCompass: this.options.settings.compass,
      showMinimap: this.options.settings.minimap,
      showRoutes: this.options.settings.routes,
      showCoords: this.options.settings.coords,
      building: this.buildingPrompt(),
      track: this.heldTrackTool() ? this.trackReadout : null,
      overlay: {
        markers,
        // Only the roads that could be on screen: the index holds every column the
        // player ever laid, and even the big map at its widest is a fraction of that.
        roads: this.roads.columnsIn(
          mapAt.x - mapReach,
          mapAt.z - mapReach,
          mapAt.x + mapReach,
          mapAt.z + mapReach,
        ),
        rails: this.railOverlay(mapAt, mapReach),
        gap:
          questRoute?.gapFrom && questRoute.gapTo
            ? { from: questRoute.gapFrom, to: questRoute.gapTo }
            : null,
        faults: this.roadFaults(MINIMAP_REACH, mapAt),
      },
      routes: {
        quest: objective,
        // How far, and which way. The compass carries the same marker, but the panel is
        // where the player looks to know whether it is a walk or an expedition.
        aim: aim ? bearingBetween(this.player, aim) : null,
        // Only the lines worth a row: the ones that work, the one the tutorial is asking
        // for, and any that used to work and have been dug up. Every other watched pair
        // would just be a wall of "not connected".
        routes: this.transport.routes
          .filter((route) => route.connected || route.everConnected || route === questRoute)
          .map((route) => ({
            line: this.lines.lines.get(route.lineId)?.name ?? '路線',
            from: route.from.name,
            to: route.to.name,
            surveyed: route.surveyed,
            connected: route.connected,
            length: route.length,
            missing: route.missing,
            porters: route.porters.length,
            fromDepot: this.stopLabel(route.from),
            toDepot: this.stopLabel(route.to),
            nearest: this.nearestPorter(shipments, route),
            stock: this.stockOn(route),
            idle: this.idleReason(route),
            grade: route.grade,
            load: this.transport.loadOf(route),
            wanted: this.townOf(route.to)?.needs.includes(route.good) ?? false,
            carrying: this.carryingOn(route),
            vehicle: route.vehicle,
            cartPinch: route.cartPinch ? this.bearingTo(route.cartPinch) : null,
            railPinch: route.railPinch ? this.bearingTo(route.railPinch) : null,
            stationGap: route.stationGap ? this.bearingTo(route.stationGap) : null,
            stall: route.stall ? this.bearingTo(route.stall) : null,
            climb: route.climb,
            detour: route.detour,
            doorGap: route.doorGap,
            // Only the faults near the break the player is being pointed at. Everything
            // the index refuses everywhere would be a list, and a list is not a place.
            faults: route.gapFrom ? this.roads.faults(route.gapFrom.x, route.gapFrom.z, 12) : [],
            nearMiss: route.nearMiss !== null,
          })),
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
      // Last look at it: whatever the player did here is what the map should remember.
      this.mapMemory.record(chunk);
      this.chunkRenderer.remove(chunk.key);
      this.world.removeChunk(chunk.cx, chunk.cz);
    }
  }

  private onChunkReady(message: ChunkReadyMessage): void {
    const chunk = new Chunk(message.cx, message.cz, message.blocks, message.water);
    chunk.generated = true;
    this.world.addChunk(chunk);
    // Before lighting is seeded, so a village that grew while this chunk was away has its
    // new walls in place when the light is baked against them.
    for (const village of this.villages.byId.values()) {
      if (Math.abs(village.x - chunk.originX) > VILLAGE_RADIUS + CHUNK_SIZE) continue;
      if (Math.abs(village.z - chunk.originZ) > VILLAGE_RADIUS + CHUNK_SIZE) continue;
      if (village.stage > 0 || village.outpost) this.buildGrowth(village, chunk);
      // A town ploughs from the day it is generated, so this one is not behind the stage
      // check: stage 0 has fields, it simply has fewer of them.
      this.buildFields(village);
    }
    this.light.seedChunk(chunk);
    this.water.registerChunk(chunk, message.springs ?? []);
    // Surveyed as it arrives as well as as it leaves, so a chunk that is loaded now is
    // already on the map of a world saved before the player walks away from it.
    this.mapMemory.record(chunk);

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
      // Punctuation goes by the character it produced, not by the key it came off.
      // `event.code` names a position on a US keyboard, and on a JIS one that position
      // holds something else: the key that types `[` reports BracketRight there, `]`
      // reports Backslash, and `＋` is a shifted semicolon. Nothing about the game speed
      // or the map zoom is about where a key sits, so the letters below are matched on
      // what was typed, and only the named keys (Escape, F3, the letters) go by code.
      if (this.punctuation(event)) return;
      switch (event.code) {
        case 'Escape':
          if (this.worldMap.isOpen) this.toggleWorldMap();
          else if (this.screens.isOpen) this.closeScreen();
          else if (this.warpDialog.isOpen) this.closeWarpDialog();
          else this.togglePause();
          break;
        case 'KeyE':
          if (this.paused || this.player.isDead) break;
          if (this.warpDialog.isOpen) this.closeWarpDialog();
          else if (this.screens.isOpen) this.closeScreen();
          else this.openScreen(() => this.screens.openInventory());
          break;
        case 'KeyH':
          if (this.player.isDead) break;
          this.openHelp();
          break;
        case 'KeyM':
          if (this.paused || this.player.isDead) break;
          if (this.screens.isOpen || this.warpDialog.isOpen) break;
          this.toggleWorldMap();
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
        case 'KeyN':
          if (this.paused || this.player.isDead) break;
          if (this.screens.kind === 'lines') this.closeScreen();
          else this.openScreen(() => this.screens.openLines(() => this.linePanelView(), this.lineActions()));
          break;
        case 'KeyF':
          if (this.paused || this.player.isDead || this.uiOpen) break;
          this.chooseDepot();
          break;
        case 'KeyR':
          if (this.paused || this.player.isDead || this.uiOpen) break;
          this.paveToHere();
          break;
        case 'Home':
          // Only while the map is up: everywhere else Home is the browser's.
          if (this.worldMap.isOpen) {
            event.preventDefault();
            this.worldMap.recentre();
          }
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

  /** The keys that are punctuation rather than a named key, handled by what they type.
   *  Returns true when the event was one of them and has been dealt with. */
  private punctuation(event: KeyboardEvent): boolean {
    const command = punctuationCommand(event.key);
    switch (command) {
      case 'slower':
      case 'faster':
        if (this.paused || this.player.isDead || this.uiOpen) return true;
        this.nudgeSpeed(command === 'slower' ? -1 : 1);
        return true;
      case 'zoom-in':
        if (this.worldMap.isOpen) this.worldMap.zoom(-1);
        return true;
      case 'zoom-out':
        if (this.worldMap.isOpen) this.worldMap.zoom(1);
        return true;
      default:
        return false;
    }
  }

  private readMovement(): PlayerInput {
    const input = this.options.input;
    const wheel = input.takeWheel();
    if (wheel !== 0) {
      const size = 9;
      this.player.inventory.selected = (this.player.inventory.selected + wheel + size) % size;
      this.hud.showHeldItem(this.player.inventory.held?.id ?? null);
    }
    return movementFromInput(input);
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
    this.lookedAtWorks = null;
    const hit = raycastVoxels(this.world, eye, look, { maxDistance: BUILDING_REACH });
    if (!hit) return;
    // An industry is looked for first and by distance: it stands on its own out in the
    // country, so there is no village to ask about it, and every one of them is the same
    // shed — which makes this the one place its kind can be read.
    const works = this.industries.near(hit.x, hit.z, INDUSTRY_REACH);
    if (works) {
      this.lookedAtWorks = works;
      return;
    }
    const village = this.villages.at(hit.x, hit.z);
    if (!village || !village.discovered) return;
    const building = buildingAt(this.buildingsFor(village), hit.x, hit.z);
    if (building) this.lookedAt = { building, village };
  }

  /** What the HUD says about the building under the crosshair. */
  private buildingPrompt(): { title: string; hint: string } | null {
    if (this.uiOpen) return null;
    // Something about to be put down comes first: the player is mid-decision, and the
    // question they are asking is about the thing in their hand rather than the wall
    // behind it.
    const placing = this.placementPrompt();
    if (placing) return placing;
    if (this.lookedAtWorks) return this.industryPrompt(this.lookedAtWorks);
    if (!this.lookedAt) return null;
    const { building, village } = this.lookedAt;
    const depot = this.depotFor(village);
    const isDepot = depot?.id === building.id;
    return {
      title: describeBuilding(building, village, isDepot, this.buildingNote(village, building)),
      hint: isDepot ? 'ここから荷が出入りする' : '[F] この村の集荷所にする',
    };
  }

  /** What a stop or a station in the player's hand would attach to, in words, beside the
   *  light that says the same thing in the world.
   *
   *  The light answers "where"; this answers "how far off am I" — the number that decides
   *  whether the answer is to move two blocks or to give up on this hillside. */
  private placementPrompt(): { title: string; hint: string } | null {
    const held = this.player.inventory.held?.id;
    if (held === 'stop' && this.aimHit) {
      const at = { x: this.aimHit.x, z: this.aimHit.z };
      const link = this.linkAt(at.x, at.z);
      const crowding = this.lines.stopNear(at.x, at.z, STOP_SPACING);
      const hint = crowding
        ? `置けない — ${crowding.name}に近すぎる（停留所どうしは ${STOP_SPACING}マス以上）`
        : '右クリックで設置';
      const serves: string[] = [];
      if (link.works) serves.push(`${link.works.name}（産業）`);
      if (link.town) serves.push(`${displayName(link.town)}（町）`);
      if (serves.length > 0) return { title: `ここに置くと ${serves.join(' と ')} につながる`, hint };
      return { title: `ここに置いても何にもつながらない（${this.outOfReach(link, STOP_TOWN_REACH)}）`, hint };
    }
    if (held === 'station') {
      const node = this.aimNode;
      if (!node) return null;
      const served = this.villageServedBy(node);
      const title = served
        ? `この端に駅を建てると ${displayName(served.village)} に届く（${Math.round(served.distance)}m）`
        : `この端に駅を建ててもどの村にも届かない（${this.outOfReach(this.stationLink(node), STATION_REACH)}）`;
      return { title, hint: node.station ? '右クリックで撤去' : '右クリックで建てる' };
    }
    return null;
  }

  /** How far off the nearest of each is, when neither is near enough. The one number worth
   *  saying at the moment the answer is no. */
  private outOfReach(link: StopLink, townReach: number): string {
    const parts: string[] = [];
    parts.push(
      link.nearTown
        ? `一番近い町まで ${Math.round(link.nearTown.distance)}m / ${townReach}m`
        : '町が見つかっていない',
    );
    if (link.nearWorks) {
      parts.push(`産業まで ${Math.round(link.nearWorks.distance)}m / ${STOP_SITE_REACH}m`);
    }
    return parts.join('、');
  }

  /** What the works under the crosshair is: which kind it is, what it digs, how fast, and
   *  how much has piled up waiting for somebody to come and take it.
   *
   *  Every industry is built out of the same shed, so this is where its kind lives. The
   *  hint is whichever sentence is true of it: no stop yet, a stop that is not collecting,
   *  or a working one — and on that last one, how to take the thing back down. */
  private industryPrompt(works: Industry): { title: string; hint: string } {
    const kind = industryType(works.kind)?.label ?? '産業';
    const title =
      `${works.name}［${kind}］— ${this.goodName(works.good)} ` +
      `在庫 ${works.stock} / ${MAX_INDUSTRY_STOCK}・産出 ×${works.richness.toFixed(1)}・` +
      `出荷 ${works.shipped}`;
    const stop = this.lines.stopNear(works.x, works.z, STOP_SITE_REACH);
    if (!stop) {
      return { title, hint: `停留所が無い — ${STOP_SITE_REACH}マス以内に置いて路線につなごう` };
    }
    if (works.stock >= MAX_INDUSTRY_STOCK) {
      return { title, hint: `満杯 — ${stop.name}を路線（N）に並べたか確かめよう` };
    }
    return { title, hint: `${stop.name}が集める。[産業設置具] 右クリックで撤去` };
  }

  /** What the building under the crosshair is waiting for, in one clause.
   *
   *  This is where the town economy is legible without opening anything: a works with no
   *  raw material and a shop with no customers look identical from the street, and they
   *  are two entirely different jobs for the player. */
  private buildingNote(village: VillageRecord, building: VillageBuilding): string | undefined {
    const cell = this.towns.get(village.id)?.cells.get(building.id);
    if (!cell) return undefined;
    if (cell.use === 'residential') {
      const empty = [...cell.wants].filter(([, held]) => held <= 0).map(([good]) => good);
      // 「要る」 rather than 「切れている」: a town the player has only just walked into never
      // had any, and telling them it ran out would be describing a delivery that never was.
      if (empty.length > 0) return `${empty.map((g) => this.goodName(g)).join('・')}が要る`;
      return `${cell.people} 人が住んでいる`;
    }
    // A works in a village that converts nothing is the village's own shed: it has no
    // appetite because there is nothing to feed it, and saying so beats saying nothing at
    // all in the one place the player is looking straight at it.
    if (cell.wants.size === 0) {
      if (cell.use !== 'industrial') return undefined;
      return `${this.goodName(village.produces)}を採っている`;
    }
    if (cell.staff <= 0) return 'まだ誰も通ってきていない';
    const empty = [...cell.wants].filter(([, held]) => held <= 0).map(([good]) => good);
    if (empty.length > 0) return `${empty.map((g) => this.goodName(g)).join('・')}を待っている`;
    return `${cell.staff} 人が働いている`;
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
    // Kept for the guide, which runs in the render loop and has to know where a stop in
    // the player's hand would land.
    this.aimHit = hit;
    // The rail end under the crosshair, for the station's preview. Only while a station is
    // in hand: the pick is a raycast against the curves, and nothing else needs it.
    this.aimNode = this.player.inventory.held?.id === 'station' ? this.trackAim().node : null;
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
    if (from && span > 1 && span <= PAVE_BRIDGE) treadLine(this.paveTarget, from, hit, from.y, material);
    else treadBrush(this.paveTarget, hit.x, hit.z, hit.y, material);
    this.paveFrom = { x: hit.x, y: hit.y, z: hit.z };
    this.reportPavingFaults(PAVE_INTERVAL, hit.x, hit.z);
  }

  /** What the held item lays while the right button is down.
   *
   *  There is no mode, only what is in the player's hand. A shovel treads a path; nothing
   *  else lays anything, because the one other thing worth building along a route is a
   *  railway, and a railway is not made of blocks any more — it is drawn with the track
   *  tool, which takes the mouse over entirely. */
  private heldPaving(): PaveMaterial | null {
    return heldTool(this.player.inventory.held)?.tool?.kind === 'shovel' ? TREAD_DIRT : null;
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
    const laid = this.runRoad(
      { x: hit.x, z: hit.z },
      { x: Math.floor(this.player.x), z: Math.floor(this.player.z) },
      material.block,
      hit.y,
    );
    if (laid === 0) this.hud.toast('道をのばせる地面がない');
    else this.hud.toast(`道を ${laid} マスのばした`);
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
    // Ctrl, not Shift: holding Shift is a dash now, and running up to a chest should
    // still open it rather than build a wall against it.
    const sneaking =
      this.options.input.isDown('ControlLeft') || this.options.input.isDown('ControlRight');

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

    // A station is aimed at the rails and not at a block. The end of a curve is nowhere
    // near the middle of anybody's cube, and the ground under it is not what is being
    // built on — so this gets its own trace, the same one the track tool uses.
    if (held.id === 'station') {
      this.useStation();
      return;
    }

    // A signal, likewise. Unlike a station it may go anywhere along the line and not only
    // on an end, so it may have to cut the run it is put on first.
    if (held.id === 'signal') {
      this.useSignal();
      return;
    }

    // A stop goes on the ground, but what it puts there is not a block: it is a place on
    // the network, and the little platform under it is only how the player finds it again.
    if (held.id === 'stop') {
      this.useStop(hit);
      return;
    }

    // The industry kit reads the ground rather than building on it, so it is aimed at
    // whatever the player is standing on and not at a face.
    if (held.id === 'industry_kit') {
      this.useIndustryKit(hit);
      return;
    }

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
  private trackAim(): TrackAim {
    const eye = { x: this.player.x, y: this.player.eyeY, z: this.player.z };
    const look = this.player.lookVector();
    // An end the line of sight passes wins outright, before the ground is consulted at
    // all: track hanging in the air is not in the block grid, so the ray goes through it
    // and lands somewhere behind. Without this the one end most worth building on - the
    // far end of a viaduct - is the one that cannot be pointed at.
    const onRay = this.trackNet.nodeAlongRay(eye, look, TRACK_REACH);
    if (onRay) return { point: { x: onRay.x, y: onRay.y, z: onRay.z }, node: onRay, run: null };
    const hit = raycastVoxels(this.world, eye, look, { maxDistance: TRACK_REACH });
    // A hit at zero distance means the eye is inside a block; there is no face there.
    const point = hit && hit.distance >= 0.5
      ? {
        x: eye.x + look.x * hit.distance + hit.nx * TRACK_LIFT,
        y: eye.y + look.y * hit.distance + hit.ny * TRACK_LIFT,
        z: eye.z + look.z * hit.distance + hit.nz * TRACK_LIFT,
      }
      : this.trackAimInAir(eye, look);
    const node = this.trackNet.nodeAt(point, SNAP_RADIUS);
    // The middle of a run somebody is pointing at. It is what makes a switch buildable
    // anywhere rather than only where the player happened to stop laying, so it is worth
    // a second pick against the curves — but an end always wins, because an end is the
    // thing you were more likely aiming at.
    return { point, node, run: node ? null : this.runUnderCrosshair(eye, look) };
  }

  /** The point on the network nearest a place on the map, as a run and how far along it.
   *  What the debug hooks use to aim at track without a crosshair. */
  private runNearest(x: number, z: number): { edge: number; at: number } | null {
    let best: { edge: number; at: number } | null = null;
    let nearest = Infinity;
    for (const edge of this.trackNet.edgesNear(x, z, TRACK_DRAW)) {
      for (let s = 0; s <= edge.curve.length; s += 0.25) {
        const p = pointAt(edge.curve, s);
        const off = Math.hypot(p.x - x, p.z - z);
        if (off >= nearest) continue;
        nearest = off;
        best = { edge: edge.id, at: s };
      }
    }
    return best;
  }

  /** The laid run the crosshair is on and how far along it, or null. */
  private runUnderCrosshair(eye: TrackPoint, look: TrackPoint): TrackRun | null {
    const edge = this.trackNet.edgeAlongRay(eye, look, TRACK_REACH, TRACK_PICK);
    if (!edge) return null;
    // Where along it. Sampled rather than solved: the curve is a biarc and inverting one
    // for the nearest point is a great deal of algebra for a number the player is choosing
    // by eye anyway.
    let at = 0;
    let nearest = Infinity;
    for (let s = 0; s <= edge.curve.length; s += 0.25) {
      const p = pointAt(edge.curve, s);
      const on = TrackNetwork.onRay(eye, look, TRACK_REACH, p);
      if (!on || on.off >= nearest) continue;
      nearest = on.off;
      at = s;
    }
    return { edge, at };
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
   *  a curve *arrives* at is the same direction turned round.
   *
   *  A node with nothing free is a line already through, and there the yaw is back in
   *  charge: the only track that can leave one is the branch of a switch, and which way it
   *  goes is exactly what the player is choosing by turning their head. `lay` decides
   *  whether that angle is a turnout or a refusal. */
  private trackAnchorAt(
    aim: TrackAim,
    arriving: boolean,
  ): TrackAnchor {
    const branching = aim.node !== null && freePorts(aim.node).length === 0;
    if (!aim.node || branching || aim.run) {
      const yaw = this.player.yaw;
      // The middle of a laid run is a switch waiting to be cut: the place is the point on
      // the curve, and which way the branch leaves is the player's yaw, exactly as it is
      // at a switch that already exists.
      const at = aim.node ?? (aim.run ? pointAt(aim.run.edge.curve, aim.run.at) : aim.point);
      const sign = (branching || aim.run) && arriving ? -1 : 1;
      return {
        x: at.x,
        y: at.y,
        z: at.z,
        hx: -Math.sin(yaw) * sign,
        hz: -Math.cos(yaw) * sign,
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
    // Kept for the renderer, which runs after this and wants to mark what the crosshair is
    // on without tracing the ray a second time.
    this.trackAimCache = aim;
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

  /** Puts the start down.
   *
   *  Three places it can go, and the player picks between them by where they point rather
   *  than by choosing a mode: an open end joins on, the middle of a laid run is cut there
   *  and the cut becomes a switch, and anywhere else is a fresh start in the open. */
  private beginTrack(aim: TrackAim): void {
    if (aim.run) {
      // The cut itself waits for the second click. Doing it now would mean a player who
      // pointed at a run, thought better of it and cancelled had silently left the line
      // in two pieces — the one thing a cancel must never do.
      this.trackDraft = {
        anchor: this.trackAnchorAt(aim, false),
        node: null,
        split: { edge: aim.run.edge.id, at: aim.run.at },
      };
      this.hud.toast('ここで線路を割って分岐する。もう一度右クリックで終点');
      return;
    }
    if (aim.node && freePorts(aim.node).length === 0) {
      // A line already through. The branch of a switch may still leave it, if the way the
      // player is facing is near enough to the line to be a turnout — which `lay` decides
      // when the far end goes down, because until then there is no curve to judge.
      this.trackDraft = { anchor: this.trackAnchorAt(aim, false), node: aim.node.id };
      this.hud.toast('本線から分岐する。もう一度右クリックで終点');
      return;
    }
    this.trackDraft = { anchor: this.trackAnchorAt(aim, false), node: aim.node?.id ?? null };
    this.hud.toast(aim.node
      ? '既存の線路の端につないだ。もう一度右クリックで終点'
      : '始点を置いた。もう一度右クリックで終点');
  }

  /** Cuts the run the draft started on, so the branch has somewhere to leave from.
   *  Null when the cut was refused, which it says out loud — the commonest reason is
   *  having pointed too near one end of the run. */
  private splitForBranch(split: { edge: number; at: number }): TrackNode | null {
    const cut = this.trackNet.splitEdge(split.edge, split.at);
    if (!cut.ok) {
      this.warn(cut.fault === 'short'
        ? '線路の端に近すぎる — 区間の途中を狙う'
        : trackFaultText(cut.fault, cut.value));
      return null;
    }
    this.transport.invalidate();
    return cut.node;
  }

  private cancelTrackDraft(announce: boolean): void {
    this.trackDraft = null;
    this.trackGhost = null;
    this.trackGhostFault = null;
    this.trackReadout = null;
    if (announce) this.hud.toast('敷設をやめた');
  }

  private commitTrack(aim: TrackAim): void {
    const draft = this.trackDraft;
    if (!draft) return;
    // The cut the start was pointed at, made now that there is going to be a branch to
    // hang off it. A refusal here says so and leaves the start down, like any other.
    let from = draft.node;
    if (draft.split) {
      const cut = this.splitForBranch(draft.split);
      if (!cut) return;
      from = cut.id;
    }
    const laid = this.trackNet.lay(draft.anchor, this.trackAnchorAt(aim, true), {
      ...(from !== null ? { fromNode: from } : {}),
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

  /** Builds a station on the end of the line under the crosshair, or takes one back.
   *
   *  One button doing both directions, which is unusual here and right for this: a station
   *  is one thing in one place, and "click it again to pick it up" needs no explaining.
   *  The alternative was the track tool's split of build on the right and remove on the
   *  left, and that would have meant the left button doing something other than mining
   *  while an ordinary item was in the player's hand.
   *
   *  Whether the station is near enough to a village to be of any use is the game's
   *  business and not the player's guesswork, so the toast says which village it serves,
   *  or how far the nearest one is when it serves none. */
  private useStation(): void {
    const node = this.trackAim().node;
    if (!node) {
      this.warn('線路の端に向けて右クリックすると駅を建てる');
      return;
    }
    if (node.station) {
      this.trackNet.setStation(node.id, false);
      this.transport.invalidate();
      const refund = this.player.inventory.unlimited ? 0 : 1;
      if (refund > 0 && this.player.inventory.add({ id: 'station', count: 1 }) > 0) {
        this.dropAtPlayer({ id: 'station', count: 1 });
      }
      this.hud.toast('駅を撤去した');
      return;
    }
    if (!this.player.inventory.has('station', 1)) {
      this.warn('駅が無い（作業台で 木材 6 ＋ 鉄インゴット 1）');
      return;
    }
    this.trackNet.setStation(node.id, true);
    this.transport.invalidate();
    this.player.inventory.remove('station', 1);
    const served = this.villageServedBy(node);
    if (served) {
      this.hud.toast(`${displayName(served.village)}の駅を建てた`);
      return;
    }
    const away = Math.round(this.distanceToNearestVillage(node));
    this.hud.toast(`駅を建てた — どの村にも届いていない（一番近い村まで ${away}m）`);
  }

  /** Puts a stop down, or takes one back up.
   *
   *  Pointing at one that is already there removes it — the same one-gesture rule the
   *  station follows, and for the same reason: a separate "remove" key for a thing the
   *  player put down half a minute ago is a key nobody finds. */
  private useStop(hit: RaycastHit | null): void {
    const at = hit ? { x: hit.x, y: hit.y + 1, z: hit.z } : null;
    const standing = this.lines.stopNear(this.player.x, this.player.z, STOP_REACH);
    if (standing && (!at || Math.hypot(standing.x - at.x, standing.z - at.z) <= STOP_REACH)) {
      const lines = this.lines.linesAt(standing.id).length;
      this.lines.removeStop(standing.id);
      this.syncLines();
      this.removeStopMarker(standing);
      if (!this.player.inventory.unlimited && this.player.inventory.add({ id: 'stop', count: 1 }) > 0) {
        this.dropAtPlayer({ id: 'stop', count: 1 });
      }
      this.hud.toast(
        lines > 0 ? `${standing.name}を撤去した — ${lines} 本の路線から外れた` : `${standing.name}を撤去した`,
      );
      return;
    }
    if (!at) {
      this.warn('地面に向けて右クリックすると停留所を置く');
      return;
    }
    if (!this.player.inventory.has('stop', 1)) {
      this.warn('停留所が無い（作業台で 木材 4 ＋ 丸石 2）');
      return;
    }
    // Which town this serves is decided now and never revisited: the player chose to build
    // it here, and a town growing outwards later should not adopt somebody's junction.
    const town = this.villages.at(at.x, at.z)
      ?? this.nearestTownWithin(at.x, at.z, STOP_TOWN_REACH);
    const placed = this.lines.addStop(at, town?.id ?? null, town?.name);
    if (!placed.ok) {
      this.warn('近すぎる — 停留所どうしは離して置く');
      return;
    }
    this.player.inventory.remove('stop', 1);
    this.buildStopMarker(placed.stop);
    this.syncLines();
    const works = this.industries.near(at.x, at.z, STOP_SITE_REACH);
    if (town) this.hud.toast(`${placed.stop.name}を置いた（${displayName(town)}）`);
    else if (works) this.hud.toast(`${placed.stop.name}を置いた（${works.name}）`);
    else this.hud.toast(`${placed.stop.name}を置いた — まだ町も産業も無い場所`);
  }

  /** The nearest town within a radius, whether or not the point is inside its plateau. */
  private nearestTownWithin(x: number, z: number, radius: number): VillageRecord | undefined {
    let best: VillageRecord | undefined;
    let bestDistance = radius;
    for (const village of this.villages.byId.values()) {
      const distance = Math.hypot(village.x - x, village.z - z);
      if (distance > bestDistance) continue;
      best = village;
      bestDistance = distance;
    }
    return best;
  }

  /** Surveys what the player is standing on and builds whatever it supports.
   *
   *  The refusal is the interesting half. "Nothing here" is not an error message — it is
   *  the tool doing its job, and it says what the ground actually held so the player knows
   *  whether they are close or nowhere near. */
  private useIndustryKit(hit: RaycastHit | null): void {
    const at = hit
      ? { x: hit.x, y: hit.y + 1, z: hit.z }
      : { x: Math.floor(this.player.x), y: Math.floor(this.player.y), z: Math.floor(this.player.z) };
    const standing =
      this.industries.near(at.x, at.z, INDUSTRY_REACH)
      ?? this.industries.near(this.player.x, this.player.z, INDUSTRY_REACH);
    if (standing) {
      this.takeDownIndustry(standing);
      return;
    }
    if (!this.player.inventory.has('industry_kit', 1)) {
      this.warn('産業設置具が無い（作業台で 鉄インゴット 2 ＋ 木材 4）');
      return;
    }
    const ground = surveyGround(this.world, at.x, at.y, at.z);
    const best = ground.find((report) => report.short.length === 0) ?? null;
    const result = this.industries.place(at, best);
    if (!result.ok) {
      if (result.why === 'too-close') {
        this.warn(
          `${result.near.name}まで ${Math.round(result.distance)}m しかない` +
            `（産業どうしは ${INDUSTRY_SPACING}m 以上）— 同じ資源で二重取りはできない`,
        );
        return;
      }
      // The refusal is the interesting half, and it is built from the same scan that would
      // have said yes: how much was there, how thin it was spread, and which of the two is
      // the thing to go and fix.
      this.warn(depositMissReason(ground));
      return;
    }
    this.player.inventory.remove('industry_kit', 1);
    this.buildIndustrySite(result.industry);
    this.transport.invalidate();
    this.hud.toast(
      `${result.industry.name}を建てた — ${itemLabel(result.industry.good)}を掘る` +
        `（産出 ×${result.industry.richness.toFixed(1)}）。停留所を置いて路線につなごう`,
    );
  }

  /** Takes an industry back down.
   *
   *  The same one gesture the stop and the station follow: point the thing you built it
   *  with at what you built, and it comes back up. The graded yard stays — the ground was
   *  flattened and un-flattening it would be a lie about what the player did to the hill —
   *  and the shed, the chimney and the crates go, because those are the whole of how a
   *  works is told apart from a hillside. */
  private takeDownIndustry(works: Industry): void {
    this.industries.remove(works.id);
    this.removeIndustrySite(works);
    this.transport.invalidate();
    if (!this.player.inventory.unlimited && this.player.inventory.add({ id: 'industry_kit', count: 1 }) > 0) {
      this.dropAtPlayer({ id: 'industry_kit', count: 1 });
    }
    const stop = this.lines.stopNear(works.x, works.z, STOP_SITE_REACH);
    this.hud.toast(
      stop
        ? `${works.name}を撤去した — ${stop.name}に集める先が無くなった`
        : `${works.name}を撤去した`,
    );
  }

  /** Unbuilds the shed. Only blocks that are still what the site put there are taken, so
   *  anything the player built on top of theirs survives them changing their mind. */
  private removeIndustrySite(works: Industry): void {
    const clear = (x: number, y: number, z: number, placed: BlockId): void => {
      if (this.world.getBlock(x, y, z) !== placed) return;
      this.world.setBlock(x, y, z, Block.AIR);
    };
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = 0; dy <= 2; dy++) clear(works.x + dx, works.y + dy, works.z + dz, Block.COBBLESTONE);
        clear(works.x + dx, works.y + 3, works.z + dz, Block.OAK_PLANKS);
      }
    }
    for (let dy = 0; dy <= 6; dy++) clear(works.x - 1, works.y + dy, works.z - 1, Block.STONE_BRICKS);
    clear(works.x + 2, works.y, works.z + 2, Block.OAK_LOG);
    clear(works.x + 2, works.y, works.z - 2, Block.OAK_LOG);
    clear(works.x - 2, works.y, works.z + 2, Block.OAK_LOG);
  }

  /** The little platform that says where a stop is.
   *
   *  Nothing about it is load-bearing — the stop is a fact about the network, and these
   *  blocks are only how the player finds it again from across a field. Written as ordinary
   *  recorded edits, so it saves and loads like anything else the player built. */
  private buildStopMarker(stop: Stop): void {
    const floor = stop.y - 1;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        this.world.setBlock(stop.x + dx, floor, stop.z + dz, Block.COBBLESTONE);
        // Anything standing in the paved square goes: a stop under a bush is a stop
        // nobody can see.
        if (dx !== 0 || dz !== 0) this.world.setBlock(stop.x + dx, stop.y, stop.z + dz, Block.AIR);
      }
    }
    this.world.setBlock(stop.x, stop.y, stop.z, Block.OAK_LOG);
    this.world.setBlock(stop.x, stop.y + 1, stop.z, Block.OAK_LOG);
    this.world.setBlock(stop.x, stop.y + 2, stop.z, Block.WOOL);
  }

  /** Takes the post down again. The paving stays: it is road, the player may well have
   *  built a road up to it, and pulling it up under them would be a hole where their line
   *  used to be. */
  private removeStopMarker(stop: Stop): void {
    for (let dy = 0; dy <= 2; dy++) {
      const at = this.world.getBlock(stop.x, stop.y + dy, stop.z);
      if (at !== Block.OAK_LOG && at !== Block.WOOL) continue;
      this.world.setBlock(stop.x, stop.y + dy, stop.z, Block.AIR);
    }
  }

  /** The works itself: a yard, a shed and a chimney.
   *
   *  Unmistakable from a distance and unmistakably not a town building — cobble and gravel
   *  where a town is planks and glass, and a chimney taller than anything a 集落 has. */
  private buildIndustrySite(works: Industry): void {
    const floor = works.y - 1;
    for (let dz = -3; dz <= 3; dz++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (Math.abs(dx) === 3 && Math.abs(dz) === 3) continue;
        this.world.setBlock(works.x + dx, floor, works.z + dz, Block.GRAVEL);
        for (let dy = 0; dy <= 3; dy++) {
          this.world.setBlock(works.x + dx, works.y + dy, works.z + dz, Block.AIR);
        }
      }
    }
    // The shed: three by three, walls of cobble, a plank roof, and a doorway on the south
    // side so the yard reads as somewhere things come out of.
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const wall = Math.abs(dx) === 1 || Math.abs(dz) === 1;
        for (let dy = 0; dy <= 2; dy++) {
          if (!wall) continue;
          this.world.setBlock(works.x + dx, works.y + dy, works.z + dz, Block.COBBLESTONE);
        }
        this.world.setBlock(works.x + dx, works.y + 3, works.z + dz, Block.OAK_PLANKS);
      }
    }
    this.world.setBlock(works.x, works.y, works.z + 1, Block.AIR);
    this.world.setBlock(works.x, works.y + 1, works.z + 1, Block.AIR);
    // The chimney. Twice the height of the shed, because that is the whole of what makes
    // one of these findable from the ridge the player surveyed it from.
    for (let dy = 0; dy <= 6; dy++) {
      this.world.setBlock(works.x - 1, works.y + dy, works.z - 1, Block.STONE_BRICKS);
    }
    // Crates in the yard, so a works looks like somewhere with something to collect.
    this.world.setBlock(works.x + 2, works.y, works.z + 2, Block.OAK_LOG);
    this.world.setBlock(works.x + 2, works.y, works.z - 2, Block.OAK_LOG);
    this.world.setBlock(works.x - 2, works.y, works.z + 2, Block.OAK_LOG);
  }

  /** Puts a signal on the railway, or takes one back down.
   *
   *  A station goes on an end of the line because that is what a station is. A signal is
   *  not: where the blocks want to be divided has nothing to do with where the player
   *  happened to stop laying, and a signal that could only go on a joint would be a signal
   *  they had to plan their whole railway around. So pointing at the middle of a run cuts
   *  it there and puts the signal on what the cut leaves behind — the same one gesture the
   *  track tool uses to start a branch, for the same reason. */
  private useSignal(): void {
    const aim = this.trackAim();
    const held = this.player.inventory.has('signal', 1) || this.player.inventory.unlimited;
    if (aim.node?.signal) {
      this.trackNet.setSignal(aim.node.id, false);
      this.transport.invalidate();
      const refund = this.player.inventory.unlimited ? 0 : 1;
      if (refund > 0 && this.player.inventory.add({ id: 'signal', count: 1 }) > 0) {
        this.dropAtPlayer({ id: 'signal', count: 1 });
      }
      this.hud.toast('信号機を撤去した');
      return;
    }
    if (!aim.node && !aim.run) {
      this.warn('線路に向けて右クリックすると信号機を建てる');
      return;
    }
    if (!held) {
      this.warn('信号機が無い（作業台で 鉄インゴット 2 ＋ 木材 2）');
      return;
    }
    let node = aim.node;
    if (!node) {
      const cut = this.splitForBranch({ edge: aim.run!.edge.id, at: aim.run!.at });
      if (!cut) return;
      node = cut;
    }
    this.trackNet.setSignal(node.id, true);
    this.transport.invalidate();
    this.player.inventory.remove('signal', 1);
    const blocks = this.trackNet.sections();
    const watched = blocks.watched.size;
    this.hud.toast(watched > 0 ? `信号機を建てた — 閉塞 ${watched} 区間` : '信号機を建てた');
  }

  /** The discovered village a station stands close enough to serve, nearest first. */
  private villageServedBy(place: TrackPoint): { village: VillageRecord; distance: number } | null {
    let best: { village: VillageRecord; distance: number } | null = null;
    for (const village of this.villages.discovered()) {
      const distance = Math.hypot(village.x - place.x, village.z - place.z);
      if (distance > STATION_REACH || (best && best.distance <= distance)) continue;
      best = { village, distance };
    }
    return best;
  }

  /** How far the nearest village of any kind is, for a station that serves none. */
  private distanceToNearestVillage(place: TrackPoint): number {
    let best = Infinity;
    for (const seed of this.generator.villagesAround(place.x, place.z, 3)) {
      best = Math.min(best, Math.hypot(seed.x - place.x, seed.z - place.z));
    }
    return best === Infinity ? 0 : best;
  }

  /** The curve as it would be if the player clicked now.
   *
   *  Because the shape is a pure function of the aim and the yaw, the end of the ghost
   *  follows the player's head with no extra machinery at all - turning on the spot is how
   *  the curve gets chosen. A shape the solver refuses still draws, as a thin line, so the
   *  reason is visible while they are still turning rather than only after they click. */
  private updateTrackGhost(aim: TrackAim): void {
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
      const stations = this.trackStations();
      const signals = this.trackSignals();
      this.trackViewCache = {
        // The pier count is in here because a pier over an unloaded chunk is skipped:
        // without it, the far end of a long run would never grow its legs. So is what is
        // waiting on each platform and what each signal is showing, because those are the
        // parts of this that change while nothing about the railway does.
        key: [
          key,
          piers.length,
          stations.map((s) => s.waiting).join(','),
          signals.map((s) => s.aspect).join(','),
        ].join(':'),
        edges,
        piers,
        stations,
        signals,
        markers: [],
        ghost: null,
      };
    }
    const view = this.trackViewCache;
    view.markers = holding ? this.trackMarkers(this.trackAimCache) : [];
    view.ghost = holding ? this.trackGhost : null;
    return view;
  }

  /** The stations in range, each with the pile its village has waiting on it.
   *
   *  The pile is the village's own stock and not something the station holds: a station is
   *  where the goods are put on the train, not a second warehouse with its own arithmetic.
   *  What the crates say is "there is this much here to go", which is the question a
   *  player standing on a platform watching nothing happen is actually asking. */
  private trackStations(): TrackStationView[] {
    const out: TrackStationView[] = [];
    for (const node of this.trackNet.stations()) {
      if (Math.hypot(node.x - this.player.x, node.z - this.player.z) > TRACK_DRAW) continue;
      out.push({
        x: node.x, y: node.y, z: node.z, ...headingOf(node),
        waiting: this.villageServedBy(node)?.village.stock ?? 0,
      });
    }
    return out;
  }

  /** The signals in range and what each is showing.
   *
   *  Red is "there is a shipment in the block on the other side of me", which is exactly
   *  the question a shipment asks itself before it crosses — so the lamp can never be
   *  telling the player something different from what the railway is doing. Amber is a
   *  block that has stopped and will not start again by itself, and it is the only one of
   *  the three that is asking for anything. */
  private trackSignals(): TrackSignalView[] {
    const blocks = this.trackNet.sections();
    const busy = this.transport.busySections();
    const stalls = this.transport.routes
      .map((route) => route.stall)
      .filter((point): point is RoadPoint => point !== null);
    const out: TrackSignalView[] = [];
    for (const node of this.trackNet.signals()) {
      if (Math.hypot(node.x - this.player.x, node.z - this.player.z) > TRACK_DRAW) continue;
      const stalled = stalls.some(
        (point) => Math.hypot(point.x - node.x, point.z - node.z) <= STALL_LIGHT,
      );
      const held = edgesOf(node).some((id) => {
        const block = blocks.of.get(id);
        return block !== undefined && busy.has(block);
      });
      out.push({
        x: node.x, y: node.y, z: node.z, ...headingOf(node),
        aspect: stalled ? 'stall' : held ? 'stop' : 'clear',
      });
    }
    return out;
  }

  /** Every end a new curve could be joined to, plus the start of the one being laid.
   *  Without these, snapping is a rule the player can only find out about by accident. */
  private trackMarkers(aim: TrackAim | null): TrackMarkerView[] {
    const markers: TrackMarkerView[] = [];
    // One per free port and not one per node. A switch is an end and a middle at the same
    // time: it has a way out still open and two that are taken, and a single marker on top
    // of it would say nothing about which. Each sits a little way out along the way its
    // own port faces, which is the direction a curve would leave by.
    for (const node of this.trackNet.freeEnds()) {
      if (Math.hypot(node.x - this.player.x, node.z - this.player.z) > TRACK_DRAW) continue;
      for (const port of freePorts(node)) {
        const way = node.ports[port];
        markers.push({
          x: node.x + way.hx * PORT_MARK_OUT,
          y: node.y + way.grade * PORT_MARK_OUT,
          z: node.z + way.hz * PORT_MARK_OUT,
          colour: TRACK_END_MARK,
        });
      }
    }
    // And where a click would cut a run in two to make a switch. Its own colour, because
    // it is a different thing from joining onto an end: this one changes track that is
    // already there.
    if (aim?.run && !this.trackDraft) {
      const at = pointAt(aim.run.edge.curve, aim.run.at);
      markers.push({ x: at.x, y: at.y, z: at.z, colour: TRACK_SPLIT_MARK });
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
    from: { x: number; y: number; z: number; yaw: number; grade?: number },
    to: { x: number; y: number; z: number; yaw: number; grade?: number },
  ): { ok: boolean; fault?: TrackFault; value?: number; edge?: number; length?: number } {
    const anchor = (at: { x: number; y: number; z: number; yaw: number; grade?: number }): TrackAnchor => ({
      x: at.x, y: at.y, z: at.z, hx: -Math.sin(at.yaw), hz: -Math.cos(at.yaw), grade: at.grade ?? 0,
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
      // Walking in is the moment every chunk of it is loaded, which is the moment the
      // fields can be ploughed whole.
      this.buildFields(here);
      // Before the questline picks a target: the hamlet has to exist for it to be chosen.
      if (this.questline.step === 'find_village') this.ensureOutpost(here);
      this.toast(this.questline.onVillageDiscovered(here));
    }
    // The industries first: they are the head of the chain, and a works fed this frame
    // should have something to work with in the same frame rather than the next one.
    // Unlike a town, an industry digs whether or not anybody has found it — it is
    // somewhere the player built, so there is nothing left to discover about it.
    this.industries.produce(dt);
    this.villages.produce(dt);
    // The town runs on the same clock as the village it is inside, and before transport:
    // whoever decided to travel this frame should be on the platform when the line asks.
    this.towns.update(dt, this.villages.byId.values());
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

  /** The level of the road indexed at a column, if there is one. A field rather than a
   *  method so it can be handed to village growth as it stands. */
  private readonly roadLevelAt = (x: number, z: number): number | undefined =>
    this.roads.columns.get(`${x},${z}`);

  /** A stop at a town, made if there is not one there already.
   *
   *  Refusing to put a second stop on top of the first is the right answer to a player
   *  clicking twice and the wrong one here: what the sample world wants is "a stop serves
   *  this town", and one that is already standing serves it perfectly well. */
  private stopServing(village: VillageRecord): Stop | null {
    const placed = this.lines.addStop(
      { x: village.x, y: village.baseY + 1, z: village.z }, village.id, village.name,
    );
    if (placed.ok) {
      this.buildStopMarker(placed.stop);
      return placed.stop;
    }
    return this.lines.stopNear(village.x, village.z, STOP_TOWN_REACH);
  }

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

  /** Rebuilds the legs whenever the player has changed the service.
   *
   *  Nothing here decides what to run. A road that joins two towns is a road; until
   *  somebody has put stops at both and named them on a line, no goods move over it and
   *  the panel says so. This is the whole of the difference between this game and the one
   *  where trade started by itself, and it is one method long. */
  private syncLines(): void {
    if (this.linesAt === this.lines.revision) return;
    this.linesAt = this.lines.revision;
    this.transport.syncLines(this.lines);
  }

  /** The town a stop serves, when it serves one. */
  private townOf(stop: Stop): VillageRecord | undefined {
    return stop.town ? this.villages.get(stop.town) : undefined;
  }

  /** What to call the place a stop stands at, on the panel and in a toast. */
  private stopLabel(stop: Stop): string {
    const town = this.townOf(stop);
    if (town) return displayName(town);
    const works = this.industries.near(stop.x, stop.z, STOP_SITE_REACH);
    return works ? works.name : stop.name;
  }

  /** What a stop at a point is — or would be — attached to.
   *
   *  Exactly the two rules `useStop` and `sites.ts` apply, asked one gesture early. A town
   *  is *recorded* when the stop goes down: inside its plateau, or within `STOP_TOWN_REACH`
   *  of its middle. An industry is found by *proximity* within `STOP_SITE_REACH`, every
   *  time it is asked, for as long as the stop stands. */
  private linkAt(x: number, z: number): StopLink {
    let nearTown: { village: VillageRecord; distance: number } | null = null;
    for (const village of this.villages.byId.values()) {
      const distance = Math.hypot(village.x - x, village.z - z);
      if (nearTown && nearTown.distance <= distance) continue;
      nearTown = { village, distance };
    }
    const inside = this.villages.at(x, z);
    const town = inside ?? (nearTown && nearTown.distance <= STOP_TOWN_REACH ? nearTown.village : null);
    let nearWorks: { works: Industry; distance: number } | null = null;
    for (const works of this.industries.all()) {
      const distance = Math.hypot(works.x - x, works.z - z);
      if (nearWorks && nearWorks.distance <= distance) continue;
      nearWorks = { works, distance };
    }
    const works = nearWorks && nearWorks.distance <= STOP_SITE_REACH ? nearWorks.works : null;
    return { town, works, nearTown, nearWorks };
  }

  /** What a stop that is already down serves.
   *
   *  Its town is whatever was recorded the moment it was put there, not what a fresh look
   *  at the ground says now — a town growing outwards later does not adopt somebody's
   *  junction, and a stop put down before its town was ever found never gets one. That
   *  difference is invisible from the ground and is exactly what this light is for. */
  private stopLink(stop: Stop): StopLink {
    return { ...this.linkAt(stop.x, stop.z), town: this.townOf(stop) ?? null };
  }

  /** Where a tether's far end hangs: the doorway goods actually pass through when the town
   *  has one, the middle of the place when it does not. */
  private townAnchor(village: VillageRecord): RoadPoint {
    return (
      this.depotDoor(village.id)
      ?? { x: village.x, y: this.groundHeightAt(village.x, village.z), z: village.z }
    );
  }

  /** Every stop and station near the player, tied by light to what it is judged to serve —
   *  and, when one is in the player's hand, where the next one would be tied.
   *
   *  This is the question the player asks most often and could least easily answer. Which
   *  town a stop serves is decided the instant it is put down and never revisited, and an
   *  industry is picked up by being near enough: two invisible rules that between them
   *  decide whether anything ever moves. They were readable in a toast that had already
   *  scrolled away and in a panel that has to be trusted. A stop is a decision about a
   *  place, so the answer belongs in the place. */
  private linkLight(lines: GuideLine[], beams: GuideBeam[]): void {
    for (const stop of this.lines.stops.values()) {
      if (!this.nearPlayer(stop, LINK_VISIBLE)) continue;
      this.drawLink(lines, beams, `stop:${stop.id}`, stop, this.stopLink(stop), false);
    }
    // A station is the same question with one answer fewer: rails load through a town and
    // never through an industry, so `STATION_REACH` is the whole of its rule.
    for (const node of this.trackNet.stations()) {
      if (!this.nearPlayer(node, LINK_VISIBLE)) continue;
      this.drawLink(lines, beams, `station:${node.id}`, roundPoint(node), this.stationLink(node), false);
    }
    // Nothing is about to be placed while a screen is open, and a dashed line left over
    // the last thing the player aimed at would say otherwise.
    if (this.uiOpen) return;
    const held = this.player.inventory.held?.id;
    if (held === 'stop' && this.aimHit) {
      const at = { x: this.aimHit.x, y: this.aimHit.y + 1, z: this.aimHit.z };
      this.drawLink(lines, beams, 'preview', at, this.linkAt(at.x, at.z), true);
    }
    if (held === 'station' && this.aimNode && !this.aimNode.station) {
      this.drawLink(lines, beams, 'preview', roundPoint(this.aimNode), this.stationLink(this.aimNode), true);
    }
  }

  /** What a station on a rail end serves: a village within `STATION_REACH`, or nothing. */
  private stationLink(node: TrackPoint): StopLink {
    const served = this.villageServedBy(node);
    return { town: served?.village ?? null, works: null, nearTown: served, nearWorks: null };
  }

  /** One tether. Solid for something that is there, dashed for something in the hand. */
  private drawLink(
    lines: GuideLine[],
    beams: GuideBeam[],
    id: string,
    at: { x: number; y: number; z: number },
    link: StopLink,
    preview: boolean,
  ): void {
    const ends: RoadPoint[] = [];
    if (link.works) ends.push({ x: link.works.x, y: link.works.y, z: link.works.z });
    if (link.town) ends.push(this.townAnchor(link.town));
    if (ends.length === 0) {
      // Grey and alone: a legitimate thing to be halfway through building, and a thing no
      // goods will ever pass through until it is finished.
      beams.push({ x: at.x, y: at.y, z: at.z, colour: GUIDE_NOLINK, height: preview ? 10 : 5 });
      return;
    }
    beams.push({ x: at.x, y: at.y, z: at.z, colour: GUIDE_LINK, height: preview ? 12 : 6 });
    for (let i = 0; i < ends.length; i++) {
      const end = ends[i];
      const key = `${id}|${i}|${at.x},${at.z}|${end.x},${end.z}|${this.roads.revision}`;
      lines.push({
        key,
        points: this.guideLine(`link:${id}:${i}`, key, [at, end]),
        colour: GUIDE_LINK,
        dashed: preview,
      });
      beams.push({ ...end, colour: GUIDE_LINK, height: 4 });
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
    // Where the railway towards the far village stops. Only for a pair somebody has
    // started laying one between: `railheadTowards` hands back nothing at all when
    // neither village has a station.
    for (const route of this.transport.routes) {
      if (!route.connected || !route.railPinch) continue;
      if (route !== questRoute && !this.nearPlayer(route.railPinch, FAULT_REACH * 2)) continue;
      beams.push({ ...route.railPinch, colour: GUIDE_RAILGAP, height: 12 });
    }
    // And where the rails have arrived and there is nothing to load them at. This is the
    // beacon over a railway that looks finished, which is the only kind of finished-
    // looking thing in the game that carries nothing.
    for (const route of this.transport.routes) {
      if (!route.connected || !route.stationGap) continue;
      if (route !== questRoute && !this.nearPlayer(route.stationGap, FAULT_REACH * 2)) continue;
      beams.push({ ...route.stationGap, colour: GUIDE_STATION, height: 12 });
    }
    // And a railway that has stopped. Amber, and the only beacon on the list that stands
    // over something the player built correctly: the line works, there is simply no way
    // past. Both jammed routes report their own, so a head-on meeting lights both ends of
    // it and the shape of the problem is visible from the air.
    for (const route of this.transport.routes) {
      if (!route.stall) continue;
      if (route !== questRoute && !this.nearPlayer(route.stall, FAULT_REACH * 2)) continue;
      beams.push({ ...route.stall, colour: GUIDE_STALL, height: 14 });
    }
    this.linkLight(lines, beams);
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
    return this.readyAt(route.from) + this.readyAt(route.to);
  }

  /** What is standing at one end waiting to be collected — a town's finished goods, or an
   *  industry's pile of raw material. */
  private readyAt(stop: Stop): number {
    const town = this.townOf(stop);
    if (town) return town.stock;
    return this.industries.near(stop.x, stop.z, STOP_SITE_REACH)?.stock ?? 0;
  }

  /** Why a joined route has nothing moving on it, when it has nothing moving on it.
   *
   *  A road that is finished and idle is the most confusing state in the game, and the
   *  panel used to answer it with a number that could not explain itself. Every case here
   *  is something the player can act on: wait, haul the workshop its materials, or go and
   *  walk into the village. */
  private idleReason(route: Route): RouteIdle | null {
    if (!route.connected || route.porters.length > 0 || this.stockOn(route) > 0) return null;
    for (const stop of [route.from, route.to]) {
      const village = this.townOf(stop);
      if (!village) {
        // A stop serving nothing at all. Worth saying plainly: it is the one failure a
        // player can make that looks exactly like a finished line.
        if (!this.industries.near(stop.x, stop.z, STOP_SITE_REACH)) {
          return { kind: 'nosite', village: stop.name, wants: null };
        }
        continue;
      }
      if (!village.discovered) {
        return { kind: 'undiscovered', village: displayName(village), wants: null };
      }
      const short = this.villages.starvedOf(village);
      if (short !== null) {
        return { kind: 'starved', village: displayName(village), wants: itemLabel(short) };
      }
    }
    return { kind: 'stock', village: '', wants: null };
  }

  /** How far off and which way something is, in the terms the panel speaks. */
  private bearingTo(point: { x: number; z: number }): { distance: number; bearing: number } {
    return bearingBetween(this.player, point);
  }

  /** Places where road blocks are laid and the index refuses them. Near the player, or
   *  near wherever the big map is looking when it is the thing asking. */
  private roadFaults(radius = FAULT_REACH, at: { x: number; z: number } = this.player): RoadFault[] {
    return this.roads.faults(Math.floor(at.x), Math.floor(at.z), radius);
  }

  private nearPlayer(point: { x: number; z: number }, within: number): boolean {
    return isWithin(this.player, point, within);
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
      industries: this.industries.all(),
      stops: [...this.lines.stops.values()],
      lines: [...this.lines.lines.values()],
      player: { x: this.player.x, z: this.player.z },
      // A goal that needs another village has to be able to point at one, and the only
      // thing that knows where the unvisited ones are is the village grid. One the player
      // has already walked into is not an answer to "find another".
      unfound: this.unfoundVillage(),
    };
  }

  private claimMilestones(): void {
    const state = this.networkState();
    // The two tutorial steps nobody can announce with an event: putting a stop down and
    // adding a call to a line are edits to a network, not things that happen at a place.
    this.toast(this.questline.observe(state));
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

  /** The leg the tutorial is about: whichever one runs between its two towns. */
  private questRoute(): Route | undefined {
    const { originId, targetId } = this.questline;
    if (!originId || !targetId) return undefined;
    return this.transport.routes.find(
      (route) =>
        (route.from.town === originId && route.to.town === targetId) ||
        (route.from.town === targetId && route.to.town === originId),
    );
  }

  private toast(message: string | null): void {
    if (message) this.hud.toast(message);
  }

  private announceRoute(route: Route, what: string): void {
    this.hud.toast(`${this.stopLabel(route.from)} と ${this.stopLabel(route.to)} の間が${what}`);
  }

  private onRouteConnected(route: Route): void {
    this.announceRoute(route, `つながった（${Math.round(route.length)}m）`);
    this.toast(this.questline.onRouteEstablished(route));
  }

  private onShipmentArrived(arrival: Arrival): void {
    const to = this.townOf(arrival.to);
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
    // A bigger town works more land. The parcels this stage earned are ploughed now if the
    // player is standing in it, and when they next come back if they are not.
    this.buildFields(village);
    this.refreshVillageTrades(village);
  }

  /** Ploughs whatever of a town's fields it owes into the chunks that are loaded.
   *
   *  Cheap when there is nothing to do, which is almost always: one look at the middle of
   *  each parcel says whether it has been turned over already. */
  private buildFields(village: VillageRecord): void {
    applyFields(this.world, this.options.seed, village, this.roadLevelAt);
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
    const short = this.villages.starvedOf(village);
    if (short !== null) {
      return `${made}が、${itemLabel(short)}が届いていないので手が止まっている。求めている物: ${wants}`;
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

  /** Everything the line table shows. Read afresh on every refresh, so a leg that joins
   *  up while the page is open says so without the player closing it. */
  private linePanelView(): LinePanelView {
    // The first line, when the player has not picked one. Opening the page and finding no
    // 「加える」 button working would read as the page being broken.
    if (!this.selectedLine || !this.lines.lines.has(this.selectedLine)) {
      this.selectedLine = [...this.lines.lines.keys()][0] ?? null;
    }
    return {
      selected: this.selectedLine,
      lines: [...this.lines.lines.values()].map((line) => ({
        id: line.id,
        name: line.name,
        full: line.stops.length >= MAX_LINE_STOPS,
        calls: line.stops.map((stopId, index) => {
          const stop = this.lines.stops.get(stopId);
          return {
            index,
            name: stop?.name ?? '?',
            place: stop ? this.stopPlace(stop) : '—',
          };
        }),
        legs: this.transport.legsOfLine(line.id).map((route) => ({
          from: route.from.name,
          to: route.to.name,
          connected: route.connected,
          length: route.length,
          missing: route.missing,
          vehicle: route.vehicle === 'train' ? '列車' : route.vehicle === 'cart' ? '荷車' : '徒歩',
        })),
      })),
      stops: [...this.lines.stops.values()]
        .map((stop) => ({
          id: stop.id,
          name: stop.name,
          place: this.stopPlace(stop),
          onLines: this.lines.linesAt(stop.id).length,
          distance: Math.hypot(stop.x - this.player.x, stop.z - this.player.z),
        }))
        .sort((a, b) => a.distance - b.distance),
    };
  }

  /** What stands at a stop, for the line table. Different from `stopLabel`, which names
   *  the place: this says what kind of thing it is, which is what tells the player whether
   *  a leg to it will carry anything. */
  private stopPlace(stop: Stop): string {
    const town = this.townOf(stop);
    if (town) return `${displayName(town)}（${itemLabel(town.produces)}）`;
    const works = this.industries.near(stop.x, stop.z, STOP_SITE_REACH);
    if (works) return `${works.name}（${itemLabel(works.good)}）`;
    return '町も産業も無い';
  }

  /** What the buttons on the line table do. */
  private lineActions(): LineActions {
    return {
      create: () => {
        this.selectedLine = this.lines.createLine().id;
        this.syncLines();
      },
      select: (id) => {
        this.selectedLine = id;
      },
      rename: (id, name) => {
        this.lines.renameLine(id, name);
        this.syncLines();
      },
      remove: (id) => {
        this.lines.deleteLine(id);
        this.syncLines();
      },
      addCall: (lineId, stopId) => {
        if (!this.lines.addCall(lineId, stopId)) {
          this.hud.toast('加えられない — 同じ停留所を続けて 2 回は呼べない');
          return;
        }
        this.syncLines();
      },
      removeCall: (lineId, index) => {
        this.lines.removeCall(lineId, index);
        this.syncLines();
      },
    };
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
            produces: itemLabel(village.produces),
            inputs: village.inputs.map((good) => ({
              label: itemLabel(good),
              held: this.villages.inputHeld(village, good),
            })),
            needs: village.needs.map((good) => itemLabel(good)),
            stock: village.stock,
            stage: village.stage,
            points: next.points,
            toNext: next.needed,
            received: village.received,
            distance: Math.hypot(village.x - this.player.x, village.z - this.player.z),
            starved: this.villages.starvedOf(village) !== null,
            people: this.towns.populationOf(village.id),
            waiting: this.villages.waiting(village.id),
            wants: this.towns.shortOf(village.id).map((entry) => this.goodName(entry.good)),
          };
        })
        .sort((a, b) => a.distance - b.distance),
      town: this.townLedger(),
      industries: this.industries.all().map((works) => ({
        name: works.name,
        kind: industryType(works.kind)?.label ?? '産業',
        richness: works.richness,
        good: this.goodName(works.good),
        stock: works.stock,
        full: works.stock >= MAX_INDUSTRY_STOCK,
        shipped: works.shipped,
        served: this.lines.stopNear(works.x, works.z, STOP_SITE_REACH) !== null,
        distance: Math.hypot(works.x - this.player.x, works.z - this.player.z),
      })),
      routes: this.transport.routes.map((route) => ({
        line: this.lines.lines.get(route.lineId)?.name ?? '路線',
        from: route.from.name,
        to: route.to.name,
        fromDepot: this.stopLabel(route.from),
        toDepot: this.stopLabel(route.to),
        good: route.good ? this.goodName(route.good) : '—',
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

  /** The town the player is standing in, building by building. Null anywhere else — the
   *  ledger is about the network everywhere except here, and here it is about the place. */
  private townLedger(): LedgerTown | null {
    const here = this.villages.at(this.player.x, this.player.z);
    if (!here) return null;
    const town = this.towns.get(here.id);
    if (!town) return null;
    const buildings = this.buildingsFor(here);
    return {
      name: displayName(here),
      people: this.towns.populationOf(here.id),
      waiting: town.waiting,
      fields: {
        parcels: fieldsAt(this.options.seed, here, here.stage).length,
        area: fieldArea(here.stage),
        harvest: here.harvest,
      },
      buildings: [...town.cells.values()]
        .map((cell) => ({
          label: buildings.find((b) => b.id === cell.id)?.label ?? cell.id,
          use: useLabel(cell.use),
          people: cell.people,
          staff: cell.staff,
          wants: [...cell.wants].map(([good, held]) => ({
            good: this.goodName(good),
            held,
            of: CELL_STOCK,
          })),
        }))
        // Homes first, then the places they walk to, which is the order the loop runs in.
        .sort((a, b) => a.use.localeCompare(b.use) || a.label.localeCompare(b.label)),
    };
  }

  /** Where a town's own crop has got to: the shops that sell it, and the works that bakes
   *  with it. The one number that says the inward carry is working. */
  private foodHeld(village: VillageRecord): { shops: number; mill: number } {
    const town = this.towns.get(village.id);
    let shops = 0;
    for (const cell of town?.cells.values() ?? []) {
      if (cell.use !== 'commercial') continue;
      for (const good of FARMED) shops += cell.wants.get(good) ?? 0;
    }
    let mill = 0;
    for (const good of FARMED) mill += village.inputStock.get(good) ?? 0;
    return { shops, mill };
  }

  /** What a line is carrying right now, when it is something other than the route's own
   *  headline good. Only people qualify today, and only they are worth a row: a line the
   *  player built for crates that is quietly running passengers should say so. */
  private carryingOn(route: Route): string | null {
    if (route.porters.some((porter) => porter.good === PASSENGER)) return PASSENGER_LABEL;
    return null;
  }

  /** What to call a cargo. People are the one good that is not an item, so `itemLabel`
   *  cannot answer for them. */
  private goodName(good: GoodId): string {
    return good === PASSENGER ? PASSENGER_LABEL : itemLabel(good);
  }

  /** Where every train's cars are, and what there is to stand on because of them.
   *
   *  The engine is the mob and nothing here moves it; the cars are placed behind it from
   *  where it has been, and every flat top on the train goes into one index the player's
   *  feet can ask a single question of. */
  private updateTrains(): void {
    const decks: CarDeck[] = [];
    for (const mob of this.mobs.mobs) {
      if (mob.kind !== 'train') continue;
      const kinds = consistOf(mob.cars, mob.carriesPeople);
      const keep = consistLength(kinds) + TRAIL_STEP * 2;
      const head = { x: mob.x, y: mob.y, z: mob.z };
      // A train that has only just been drawn has been nowhere, and there is no honest way
      // to say which side of it the cars are on. So it waits: one breadcrumb's worth of
      // movement tells it which way it is going, and then the whole trail is laid out
      // straight behind it at once — which is what a train that has been running out of
      // sight has in fact been doing. The alternative, guessing from the mob's yaw, is a
      // train that reverses into the scenery whenever the guess is wrong.
      if (mob.trail.length < 2) {
        const from = mob.trail[0];
        if (!from) {
          mob.trail.push({ ...head });
          continue;
        }
        if (Math.hypot(head.x - from.x, head.z - from.z) < TRAIL_STEP) continue;
        mob.trail = seedTrail(head, head.x - from.x, head.z - from.z, keep);
      } else {
        pushTrail(mob.trail, head, keep);
      }
      const poses = posesAlong(mob.trail, kinds);
      mob.consist = poses.slice(1);
      // The engine takes its pose from the mob rather than from the trail: the mob is the
      // shipment, and a head drawn a breadcrumb behind where the goods are would be a
      // train arriving after its own cargo.
      const engine: CarPose = { kind: 'loco', x: mob.x, y: mob.y, z: mob.z, yaw: mob.yaw };
      const cars = [engine, ...mob.consist];
      for (let i = 0; i < cars.length; i++) decks.push(...decksOf(`${mob.id}:${i}`, cars[i]));
    }
    this.rideDecks.update(decks);
  }

  /** Moves whoever is standing on a carriage along with it.
   *
   *  Done before the player's own move rather than after, so their walking is worked out
   *  from where the train has already put them — step off a moving train and you carry on
   *  from beside it, not from where it was when the frame began. The move is refused when
   *  it would post them into a wall: a train passing a cutting must not push a passenger
   *  into the rock, and the honest answer there is that they stay where they are and the
   *  carriage leaves without them. */
  private carryRider(): void {
    const riding = this.riding;
    if (riding === null) return;
    const deck = this.rideDecks.byId(riding.id);
    if (!deck) {
      this.riding = null;
      return;
    }
    const at = offDeck(deck, riding.along, riding.across);
    // Vertically as well as horizontally. The player's own settle would find the deck
    // again on a level run, but only within a third of a block: a train doing seven blocks
    // a second up a one-in-five bank lifts its floor further than that in a single frame,
    // and further still on a frame the browser dropped or at sixteen times speed. A rider
    // is pinned to the carriage they are standing in, not merely put down near it.
    const lift = deck.top - this.player.y;
    // Except for somebody who has just jumped: pinning them back down would swallow the
    // jump, and jumping is how anybody gets off a train.
    const carried = {
      x: at.x,
      y: this.player.vy > 0 ? this.player.y : deck.top,
      z: at.z,
      width: PLAYER_WIDTH,
      height: PLAYER_HEIGHT,
    };
    // A carriage passing a cutting must not post its passenger into the rock. It leaves
    // without them instead, which is the honest thing for it to do and visibly a thing
    // that happened rather than a thing that glitched.
    if (Math.abs(lift) > RIDE_LOST || boxIntersectsWorld(this.world, carried)) {
      this.rideRefused++;
      this.riding = null;
      return;
    }
    this.player.x = carried.x;
    this.player.z = carried.z;
    if (carried.y !== this.player.y) {
      this.player.y = carried.y;
      this.player.vy = 0;
      this.player.onGround = true;
    }
  }

  /** Remembers where on the carriage the player is standing, once they have moved.
   *
   *  Two numbers in the car's own frame rather than a world position, because a train
   *  turns as well as travels: a rider held on by translation alone slides off the outside
   *  of every bend, and one held on by their place on the floor walks round the curve with
   *  the carriage exactly as they would with a room. */
  private recordRide(): void {
    const deck = this.player.onGround
      ? this.rideDecks.deckAt(this.player.x, this.player.z, this.player.y - 0.05, this.player.y + 0.05)
      : null;
    this.riding = deck
      ? { id: deck.id, ...onDeck(deck, this.player.x, this.player.z) }
      : null;
  }

  private spawnPorter(
    point: RoadPoint,
    vehicle: Vehicle,
    cargo: number,
    good: GoodId,
  ): number | null {
    if (!this.world.hasChunk(toChunkCoord(point.x), toChunkCoord(point.z))) return null;
    const middle = centreOf(vehicle);
    const mob = new Mob(vehicle, point.x + middle, point.y + 1, point.z + middle);
    mob.follow = { x: mob.x, z: mob.z };
    // What the train couples up behind it. A porter carries its load on its back and has
    // nowhere to put a second crate, so the count is only ever read for a train.
    mob.cars = carsFor(cargo);
    mob.carriesPeople = good === PASSENGER;
    // The one thing on rails is the only thing given the deck to stand on. Everything
    // else that walks has no reason to be up on a viaduct and no way down off one; a
    // train has both, and without this it walks off the first pier and falls.
    if (vehicle === 'train') mob.surface = this.trackNet;
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
    const middle = centreOf(mob.kind);
    const x = point.x + middle;
    const z = point.z + middle;
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

  /** Draws the people walking across whatever town the player is standing in.
   *
   *  A commute is a number in `townEconomy.ts` and this is its view, exactly as a porter
   *  is the view of a shipment: the villager is put where the commute has got to, and
   *  dropped the moment the player is too far away for it to be worth drawing. Nothing a
   *  villager does can hold a commute up — the same rule, and for the same reason, as the
   *  one written out at length at the top of `transport.ts`.
   *
   *  Only the town the player is in costs anything: the walk between two doorways is a
   *  breadth-first search around the plots, and running one for every town in the world
   *  every frame would be a search nobody could see the result of. */
  private updateCommuters(): void {
    const live = new Set<number>();
    for (const town of this.towns.towns.values()) {
      const village = this.villages.get(town.id);
      if (!village) continue;
      const away = Math.hypot(village.x - this.player.x, village.z - this.player.z);
      if (away > COMMUTE_VISIBLE + radiusOf(village)) continue;
      const buildings = this.buildingsFor(village);
      for (const commute of town.commutes) {
        const path = this.commutePath(commute, buildings);
        const here = path ? pointAlongPath(path, commute.t) : null;
        if (!here) continue;
        const near = Math.hypot(here.x - this.player.x, here.z - this.player.z) <= COMMUTE_VISIBLE;
        const mob = commute.mobId === null ? null : this.liveCommuter(commute.mobId);
        if (mob && near) {
          mob.follow = { x: here.x + 0.5, z: here.z + 0.5 };
          live.add(commute.mobId!);
          continue;
        }
        if (mob) {
          this.removeCommuter(commute.mobId!);
          commute.mobId = null;
        } else if (commute.mobId !== null) {
          // Killed, or never drawn. Either way nothing is showing this commute now.
          commute.mobId = null;
        }
        if (!near) continue;
        commute.mobId = this.spawnCommuter(village, here);
        if (commute.mobId !== null) live.add(commute.mobId);
      }
    }
    // A commute that ended — or a town that stopped existing — leaves its villager behind,
    // and a villager is the one mob the spawner never clears up by distance.
    for (const id of [...this.commuterMobs.keys()]) {
      if (!live.has(id)) this.removeCommuter(id);
    }
  }

  /** The walk between the two doorways of a commute, going round the houses rather than
   *  through them. Kept per commute because a breadth-first search across a village is not
   *  something to run sixty times a second, and thrown away with the commute itself. */
  private commutePath(
    commute: Commute,
    buildings: readonly VillageBuilding[],
  ): { x: number; y: number; z: number }[] | null {
    const cached = this.commutePaths.get(commute);
    if (cached) return cached;
    const from = buildings.find((b) => b.id === commute.from);
    const to = buildings.find((b) => b.id === commute.to);
    if (!from || !to) return null;
    const plots = buildings.filter((b) => b.id !== from.id && b.id !== to.id);
    const walk = pathAroundPlots(from.outside, to.outside, plots)
      // No way round at all — a doorway somebody has walled in. The straight line is at
      // least somewhere to go, and the villager's own step and hop deal with the rest.
      ?? [{ ...from.outside }, { ...to.outside }];
    this.commutePaths.set(commute, walk);
    return walk;
  }

  private spawnCommuter(village: VillageRecord, at: { x: number; y: number; z: number }): number | null {
    if (!this.world.hasChunk(toChunkCoord(at.x), toChunkCoord(at.z))) return null;
    const mob = new Mob('villager', at.x + 0.5, at.y + 1, at.z + 0.5);
    // Home is the village rather than the house, which is what `ensureVillageTrades` and
    // the tutorial's villagers both read: somebody walking to work is still somebody the
    // player can stop and talk to.
    mob.homeX = village.x;
    mob.homeZ = village.z;
    mob.follow = { x: mob.x, z: mob.z };
    this.mobs.add(mob);
    this.commuterMobs.set(mob.id, mob);
    return mob.id;
  }

  private liveCommuter(id: number): Mob | null {
    const mob = this.commuterMobs.get(id);
    if (!mob) return null;
    if (mob.isDead || !this.mobs.mobs.includes(mob)) {
      this.commuterMobs.delete(id);
      return null;
    }
    return mob;
  }

  private removeCommuter(id: number): void {
    const mob = this.commuterMobs.get(id);
    this.commuterMobs.delete(id);
    if (!mob) return;
    const index = this.mobs.mobs.indexOf(mob);
    if (index >= 0) this.mobs.mobs.splice(index, 1);
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
        if (interaction.kind === 'learn') {
          // The town that has just explained stops and lines hands over the first two.
          // The recipe is a click away and the player would find it — but this is the one
          // moment the game is teaching the thing everything else hangs off, and sending
          // them to the crafting screen for two blocks of cobblestone first is sending
          // them away from the lesson.
          this.player.inventory.add({ id: 'stop', count: TUTORIAL_STOPS });
        }
        // Re-supplying does not advance the step, so `complete` says nothing; the player
        // still needs to be told the crate is in their pack.
        this.toast(
          this.questline.complete(interaction.kind, this.villages) ??
            (interaction.kind === 'accept' ? '積み荷を受け取った' : null),
        );
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
    const start = this.roads.streetPoint(townPlace(from), to.x, to.z);
    const end = this.roads.streetPoint(townPlace(to), from.x, from.z);
    return this.runRoad(start, end, block, start.y, end.y, width);
  }

  /** Lays a railway between two villages, end to end. */
  private debugBuildRailway(fromId?: string, toId?: string): number {
    const from = this.villages.get(fromId ?? this.questline.originId ?? '');
    const to = this.villages.get(toId ?? this.questline.targetId ?? '');
    if (!from || !to) return 0;
    const built = this.layRailway(
      this.roads.streetPoint(townPlace(from), to.x, to.z),
      this.roads.streetPoint(townPlace(to), from.x, from.z),
    );
    this.transport.invalidate();
    return Math.round(built.length);
  }

  /** Lays an unbroken line of road columns from one point to the other. */
  private runRoad(
    from: { x: number; z: number },
    to: { x: number; z: number },
    block: BlockId,
    startY: number,
    endY?: number,
    width = 1,
  ): number {
    return runRoad(
      {
        ground: (x, z) => this.groundHeightAt(x, z),
        lay: (x, y, z) => this.layRoadColumn(x, y, z, block),
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
  ): void {
    const surface = this.betterOf(x, y, z, block);
    // Nothing to do: a line run back over road that is already there changes nothing.
    const here = `${x},${z}`;
    if (this.roads.columns.get(here) === y && this.roads.surfaces.get(here) === surface) return;
    if (this.world.hasChunk(toChunkCoord(x), toChunkCoord(z))) {
      const changed = this.world.setBlock(x, y, z, surface);
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
      // Paving a column that already held this exact block writes nothing and records
      // nothing — and the index reads the *record*, not the world, so a road nobody
      // recorded is not a road. Gravel laid over the natural gravel of a riverbed, or over
      // a village's own paving, is exactly that: one column of it in the middle of a
      // finished run reads as 「未接続 あと 1m」 with the road plainly on the ground.
      if (!changed) {
        this.recordEdit(x, y, z, surface);
        this.roads.onBlockChanged(x, y, z, surface, surface);
      }
      return;
    }
    this.recordEdit(x, y, z, surface);
    for (let h = 1; h <= HEADROOM; h++) this.recordEdit(x, y + h, z, Block.AIR);
    this.roads.onBlockChanged(x, y, z, Block.GRASS, surface);
  }

  /** Writes one cell into the recorded edits without touching the world.
   *
   *  For the two cases where the world cannot or need not be written: a chunk that is not
   *  in memory, and a cell that already holds exactly this block. The index reads the
   *  record rather than the world, so both of them still have to be recorded. */
  private recordEdit(x: number, y: number, z: number, block: BlockId): void {
    const key = chunkKey(toChunkCoord(x), toChunkCoord(z));
    let edits = this.world.edits.get(key);
    if (!edits) {
      edits = new Map();
      this.world.edits.set(key, edits);
    }
    edits.set(blockIndex(toLocalCoord(x), y, toLocalCoord(z)), block);
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
    return this.screens.isOpen || this.warpDialog.isOpen || this.worldMap.isOpen;
  }

  /** Opens or closes the big map. It takes the pointer the way any other screen does:
   *  reading a map and steering are not things anybody does at the same time. */
  private toggleWorldMap(): void {
    const open = !this.worldMap.isOpen;
    this.worldMap.show(open);
    if (open) {
      this.screens.close();
      this.warpDialog.hide();
      this.options.input.releaseLock();
      document.body.classList.add('screen-open');
    } else {
      document.body.classList.remove('screen-open');
      // Zooming the map turns the wheel, and the wheel is also the hotbar. Nothing reads
      // the accumulator while a screen is up, so without this the whole zoom comes out as
      // a hotbar scroll the moment the map closes.
      this.options.input.takeWheel();
    }
    this.hud.setClickPrompt(!open && this.ready && !this.paused && !this.player.isDead);
  }

  /** Sends the player to a place they picked on the map.
   *
   *  Behind the debug mode, exactly as the all-items shelf is: walking to somewhere you
   *  can see on the map is most of what the map is for, and a game that let you skip it
   *  from the map itself would be a different game. The `G` box stays where it is — typing
   *  coordinates you already know is a different thing from pointing at a place. */
  private warpFromMap(x: number, z: number): void {
    if (!this.options.settings.creative) {
      this.hud.toast('デバッグモードが切になっている（Esc のポーズ画面で入れる）');
      return;
    }
    this.toggleWorldMap();
    this.jumpTo(x, z, null);
    // The same wording the `G` box uses, because it is the same thing happening.
    this.hud.toast(`X ${Math.floor(x)} / Y ${Math.round(this.player.y)} / Z ${Math.floor(z)} へ移動した`);
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

    const start = this.roads.streetPoint(townPlace(from), to.x, to.z);
    const end = this.roads.streetPoint(townPlace(to), from.x, from.z);
    const blocks = this.runRoad(start, end, Block.DIRT_PATH, start.y, end.y, SAMPLE_WIDTH);
    // Then a railway beside it, which is the other half of the demonstration: the same
    // two villages joined by something that does not touch the ground at all. The stretch
    // nearest the player is left open, and the tool and the rails to close it go in the
    // pack.
    const railway = this.layRailway(start, end, SAMPLE_TRACK_GAP);
    // The far end already has its station, because the far half of the line is already
    // built and a demonstration should demonstrate a whole thing. The near one is the
    // player's, and it is the second half of the invitation: closing the gap is not
    // enough on its own, and finding that out by building the rails and watching nothing
    // happen would be the worst possible way to learn the rule.
    if (railway.laid > 0) this.buildStationNear(end);
    this.player.inventory.add({ id: 'track_tool', count: 1 });
    this.player.inventory.add({ id: 'rail', count: railsFor(SAMPLE_TRACK_GAP) + SAMPLE_TRACK_SPARE });
    this.player.inventory.add({ id: 'station', count: SAMPLE_STATIONS });
    this.villages.discover(from.id);
    this.villages.discover(to.id);
    // A stop at each end and a line calling at both, because the sample world is supposed
    // to show a working service and nothing works without one.
    this.player.inventory.add({ id: 'stop', count: SAMPLE_STOPS });
    this.player.inventory.add({ id: 'industry_kit', count: 1 });
    const near = this.stopServing(from);
    const far = this.stopServing(to);
    if (near && far) {
      const line = this.lines.createLine('見本線');
      this.lines.addCall(line.id, near.id);
      this.lines.addCall(line.id, far.id);
    }
    this.syncLines();
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
    this.railToast = railway.laid === 0
      ? null
      : `道の横に ${Math.round(railway.length)} マスの線路が高架で敷いてある。足もとの ${SAMPLE_TRACK_GAP} マスだけ空いているので、` +
        `線路敷設ツールでつなぎ、こちら側の端に駅を建てれば列車が走る` +
        `（向こうの端の駅はもう建っている。紫の光の柱がつなぐ場所。空を見上げて 2 度目のクリック）`;
    return { from: from.name, to: to.name, blocks };
  }


  /** Lays a railway between two places as curves, the way a player would.
   *
   *  The line runs beside whatever spine it is given rather than on it, and it is laid
   *  from `leave` blocks along that spine to the far end, so the near stretch is left for
   *  somebody to close.
   *
   *  The height is the interesting part. A railway does not follow the ground — that is
   *  the whole of what it is for — so the deck is an *envelope* over it: the highest of
   *  every probe along the line, each one falling away at the steepest slope the line is
   *  allowed. That is one pass and it cannot bury the deck in a hillside, which a smoothed
   *  copy of the ground can. What it does instead is fly: a dip is crossed on piers rather
   *  than dived into, which is what a railway looks like and what a road cannot do. */
  /** Puts a station on the end of the line nearest a place. For the builders that hand a
   *  player a railway they did not lay themselves: a line arriving at a village with
   *  nothing to load it at is a line that carries nothing, and being handed one of those
   *  as a demonstration would demonstrate the wrong thing. */
  private buildStationNear(place: { x: number; z: number }, reach = STATION_REACH): TrackNode | null {
    let best: TrackNode | null = null;
    let nearest = Infinity;
    for (const node of this.trackNet.nodesNear(place.x, place.z, reach)) {
      const gap = Math.hypot(node.x - place.x, node.z - place.z);
      if (gap >= nearest) continue;
      nearest = gap;
      best = node;
    }
    if (!best) return null;
    this.trackNet.setStation(best.id, true);
    this.transport.invalidate();
    return best;
  }

  private layRailway(
    from: { x: number; z: number },
    to: { x: number; z: number },
    leave = 0,
  ): { laid: number; length: number } {
    const span = Math.hypot(to.x - from.x, to.z - from.z);
    if (span - leave < MIN_SPAN) return { laid: 0, length: 0 };
    const ux = (to.x - from.x) / span;
    const uz = (to.z - from.z) / span;
    // Perpendicular, so the line runs alongside the spine rather than down the middle.
    const at = (s: number): { x: number; z: number } => ({
      x: from.x + ux * s - uz * SAMPLE_TRACK_OFFSET,
      z: from.z + uz * s + ux * SAMPLE_TRACK_OFFSET,
    });
    const probes: { s: number; y: number }[] = [];
    for (let s = 0; s <= span; s += SAMPLE_TRACK_PROBE) {
      const p = at(s);
      probes.push({
        s,
        y: this.groundHeightAt(Math.round(p.x), Math.round(p.z)) + SAMPLE_TRACK_CLEAR,
      });
    }
    const deckAt = (s: number): number => {
      let top = -Infinity;
      for (const probe of probes) top = Math.max(top, probe.y - SAMPLE_TRACK_GRADE * Math.abs(s - probe.s));
      return top;
    };

    const count = Math.max(1, Math.ceil((span - leave) / SAMPLE_TRACK_STEP));
    const stops: number[] = [];
    for (let i = 0; i <= count; i++) stops.push(leave + ((span - leave) * i) / count);
    const heights = stops.map(deckAt);
    // The slope through each joint, so the profile runs on through it instead of coming
    // level at every end and setting off again — which is what an end of grade zero means
    // and what would make a long climb a row of humps.
    const grades = stops.map((_, i) =>
      i === 0 || i === stops.length - 1
        ? 0
        : (heights[i + 1] - heights[i - 1]) / (stops[i + 1] - stops[i - 1]),
    );
    const yaw = Math.atan2(-(to.x - from.x), -(to.z - from.z));
    let laid = 0;
    for (let i = 0; i < count; i++) {
      const a = at(stops[i]);
      const b = at(stops[i + 1]);
      const result = this.debugLayTrack(
        { x: a.x, y: heights[i], z: a.z, yaw, grade: grades[i] },
        { x: b.x, y: heights[i + 1], z: b.z, yaw, grade: grades[i + 1] },
      );
      if (result.ok) laid++;
    }
    return { laid, length: this.trackNet.totalLength() };
  }

  /** The curves near the player, as polylines for the map. */
  private railOverlay(
    at: { x: number; z: number } = this.player,
    reach = MINIMAP_REACH,
  ): { x: number; z: number }[][] {
    const key = `${this.trackNet.revision}:${Math.round(at.x / 32)},${Math.round(at.z / 32)}:${reach}`;
    if (this.railMap?.key === key) return this.railMap.lines;
    const lines = this.trackNet
      .edgesNear(at.x, at.z, reach)
      .map((edge) => sampleTrack(edge.curve, MINIMAP_RAIL_STEP).map((p) => ({ x: p.x, z: p.z })));
    this.railMap = { key, lines };
    return lines;
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
    const start = this.roads.streetPoint(townPlace(from), to.x, to.z);
    const end = this.roads.streetPoint(townPlace(to), from.x, from.z);
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
    const ok = writeSave(this.snapshot());
    if (announce) this.hud.toast(ok ? 'セーブしました' : 'セーブに失敗しました');
    return ok;
  }

  /** Everything worth keeping about this world, in the shape a save file has. Written to
   *  local storage by `save`, and handed to the player as a file by `exportSave`. */
  snapshot(): SaveData {
    return createGameSnapshot({
      seed: this.options.seed,
      time: this.day.time,
      world: this.world,
      mapMemory: this.mapMemory,
      player: this.player,
      mobs: this.mobs.mobs,
      isCommuter: (id) => this.commuterMobs.has(id),
      populatedChunks: this.populatedChunks,
      villages: this.villages.toJSON(),
      freight: this.freightEarned,
      network: this.lines.toJSON(),
      industries: this.industries.toJSON(),
      quest: this.questline.toJSON(),
      pendingVillagers: this.pendingVillagers,
      tracks: this.trackNet.toJSON(),
    });
  }

  /** Writes the world out as a file the player keeps. Local storage is one slot per
   *  browser and it is cleared by the things that clear a browser; a file is a world you
   *  can put somewhere, copy to another machine, or keep a dozen of. */
  exportSave(): void {
    const name = downloadSave(this.snapshot());
    this.hud.toast(`${name} に書き出しました`);
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
       *  guessing at a duration. Water meshes are left out: moving water re-dirties them
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
          produces: v.produces, inputs: [...v.inputs],
          inputStock: Object.fromEntries(v.inputStock),
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
        return this.questline.complete(kind, this.villages);
      },
      gotoQuestTarget: (): { x: number; z: number } | null => {
        const objective = this.questline.objective(this.villages, this.focusRoute(), this.networkState());
        if (!objective?.marker) return null;
        this.debug.teleport(objective.marker.x, objective.marker.z);
        return { x: objective.marker.x, z: objective.marker.z };
      },
      routes: () =>
        this.transport.routes.map((route) => ({
          id: route.id, line: this.lines.lines.get(route.lineId)?.name ?? '?',
          from: route.from.name, to: route.to.name,
          fromTown: route.from.town, toTown: route.to.town, good: route.good,
          connected: route.connected, length: route.length, missing: route.missing,
          porters: route.porters.length, quality: Math.round(route.quality * 100) / 100,
          grade: route.grade, load: this.transport.loadOf(route), delivered: route.delivered,
          wanted: this.townOf(route.to)?.needs.includes(route.good) ?? false,
          vehicle: route.vehicle, climb: route.climb,
          detour: Math.round(route.detour * 100) / 100,
          direct: Math.round(route.direct), doorGap: Math.round(route.doorGap),
          cartPinch: route.cartPinch, railPinch: route.railPinch, nearMiss: route.nearMiss,
          stationGap: route.stationGap,
        })),
      // --- stops, lines and industries ------------------------------------
      /** Every stop the player has put down. */
      stops: () =>
        [...this.lines.stops.values()].map((stop) => ({
          id: stop.id, name: stop.name, x: stop.x, y: stop.y, z: stop.z,
          town: stop.town, place: this.stopPlace(stop),
          onLines: this.lines.linesAt(stop.id).length,
        })),
      /** Every line, and where each one calls. */
      lines: () =>
        [...this.lines.lines.values()].map((line) => ({
          id: line.id, name: line.name,
          calls: line.stops.map((id) => this.lines.stops.get(id)?.name ?? '?'),
          legs: this.transport.legsOfLine(line.id).map((route) => ({
            from: route.from.name, to: route.to.name,
            connected: route.connected, vehicle: route.vehicle,
            length: Math.round(route.length), missing: Math.round(route.missing),
          })),
        })),
      /** Puts a stop down from the console, skipping the item and the reach. */
      placeStop: (x = this.player.x, z = this.player.z, y?: number) => {
        const at = {
          x: Math.round(x),
          y: y ?? this.groundHeightAt(Math.round(x), Math.round(z)),
          z: Math.round(z),
        };
        const town = this.villages.at(at.x, at.z) ?? this.nearestTownWithin(at.x, at.z, STOP_TOWN_REACH);
        const placed = this.lines.addStop(at, town?.id ?? null, town?.name);
        if (!placed.ok) return { ok: false as const, why: placed.why };
        this.buildStopMarker(placed.stop);
        this.syncLines();
        return { ok: true as const, id: placed.stop.id, name: placed.stop.name, town: placed.stop.town };
      },
      /** Makes a line calling at the named stops, in order. */
      makeLine: (stopIds: string[], name?: string) => {
        const line = this.lines.createLine(name);
        for (const id of stopIds) this.lines.addCall(line.id, id);
        this.selectedLine = line.id;
        this.syncLines();
        return { id: line.id, name: line.name, calls: line.stops.length };
      },
      /** What every stop and station is judged to serve — the same two rules the light in
       *  the world draws, in a form a test can read. */
      links: () => ({
        stops: [...this.lines.stops.values()].map((stop) => {
          const link = this.stopLink(stop);
          return {
            id: stop.id, name: stop.name, x: stop.x, z: stop.z,
            town: link.town ? displayName(link.town) : null,
            works: link.works?.name ?? null,
            townAway: link.nearTown ? Math.round(link.nearTown.distance) : null,
            worksAway: link.nearWorks ? Math.round(link.nearWorks.distance) : null,
          };
        }),
        stations: this.trackNet.stations().map((node) => {
          const served = this.villageServedBy(node);
          return {
            id: node.id, x: Math.round(node.x), z: Math.round(node.z),
            town: served ? displayName(served.village) : null,
            away: served ? Math.round(served.distance) : null,
          };
        }),
      }),
      /** What a stop put down at a point would serve, before putting one down. */
      linkAt: (x = this.player.x, z = this.player.z) => {
        const link = this.linkAt(Math.round(x), Math.round(z));
        return {
          town: link.town ? displayName(link.town) : null,
          works: link.works?.name ?? null,
          townAway: link.nearTown ? Math.round(link.nearTown.distance) : null,
          worksAway: link.nearWorks ? Math.round(link.nearWorks.distance) : null,
          townReach: STOP_TOWN_REACH,
          worksReach: STOP_SITE_REACH,
        };
      },
      /** Every town's fields: what it works, and what is waiting at its depot. */
      fields: () =>
        this.villages
          .discovered()
          .filter((village) => !village.outpost)
          .map((village) => ({
            town: displayName(village),
            x: village.x,
            z: village.z,
            stage: village.stage,
            parcels: fieldsAt(this.options.seed, village, village.stage).length,
            area: fieldArea(village.stage),
            target: fieldTarget(village.stage),
            harvest: village.harvest,
            distance: Math.round(Math.hypot(village.x - this.player.x, village.z - this.player.z)),
            // What the ground actually allowed, which is never quite what was planned.
            standing: countFields(this.world, this.options.seed, village),
            // And where the crop got to. The depot is usually empty because it is a
            // doorway rather than a barn: what is cut is carried in the same breath.
            food: this.foodHeld(village),
          })),
      /** Ploughs the fields of the town underfoot now, rather than waiting for a chunk to
       *  arrive. Says how much soil it actually turned over, which is the number the
       *  ground has the final say in. */
      plough: () => {
        const here = this.villages.at(this.player.x, this.player.z)
          ?? this.nearestTownWithin(this.player.x, this.player.z, VILLAGE_RADIUS * 2);
        if (!here) return { ok: false as const, why: 'no-town' as const };
        const work = applyFields(this.world, this.options.seed, here, this.roadLevelAt);
        return { ok: true as const, town: displayName(here), ...work };
      },
      /** Every industry the player has sited. */
      industries: () =>
        this.industries.all().map((works) => ({
          id: works.id, name: works.name, kind: works.kind,
          label: industryType(works.kind)?.label ?? '産業',
          good: works.good,
          x: works.x, y: works.y, z: works.z,
          stock: works.stock, shipped: works.shipped,
          richness: Math.round(works.richness * 100) / 100,
          served: this.lines.stopNear(works.x, works.z, STOP_SITE_REACH) !== null,
        })),
      /** What the ground here would support, without building anything. Every kind is
       *  reported on, including the ones that missed and by how much — which is the whole
       *  of what a refusal in the world says, in a form a test can read. */
      survey: (x = this.player.x, z = this.player.z) => {
        const at = { x: Math.round(x), y: this.groundHeightAt(Math.round(x), Math.round(z)), z: Math.round(z) };
        const ground = surveyGround(this.world, at.x, at.y, at.z);
        return {
          found: ground
            .filter((report) => report.short.length === 0)
            .map((report) => ({
              kind: report.kind, label: report.label, good: report.good,
              count: report.count, density: Math.round(report.density * 1000) / 1000,
              richness: Math.round(report.richness * 100) / 100,
            })),
          all: ground.map((report) => ({
            kind: report.kind, label: report.label,
            count: report.count, need: report.needCount,
            density: Math.round(report.density * 1000) / 1000,
            needDensity: report.needDensity,
            short: [...report.short],
          })),
          why: ground.some((report) => report.short.length === 0) ? null : depositMissReason(ground),
        };
      },
      /** Sites an industry from the console, skipping the item and the reach. */
      placeIndustry: (x = this.player.x, z = this.player.z) => {
        const at = { x: Math.round(x), y: this.groundHeightAt(Math.round(x), Math.round(z)), z: Math.round(z) };
        const ground = surveyGround(this.world, at.x, at.y, at.z);
        const result = this.industries.place(at, ground.find((report) => report.short.length === 0) ?? null);
        if (!result.ok) {
          return {
            ok: false as const,
            why: result.why,
            reason: result.why === 'too-close'
              ? `${result.near.name}まで ${Math.round(result.distance)}m`
              : depositMissReason(ground),
          };
        }
        this.buildIndustrySite(result.industry);
        this.transport.invalidate();
        return {
          ok: true as const,
          id: result.industry.id, name: result.industry.name,
          good: result.industry.good, x: result.industry.x, z: result.industry.z,
        };
      },
      /** Takes one back down, as the kit does. Names the one nearest the point when no id
       *  is given, so a test can undo what it just built without holding on to the id. */
      removeIndustry: (id?: string) => {
        const works = id
          ? this.industries.get(id)
          : this.industries.near(this.player.x, this.player.z, INDUSTRY_SPACING);
        if (!works) return { ok: false as const, why: 'no-industry' as const };
        this.takeDownIndustry(works);
        return { ok: true as const, id: works.id, name: works.name };
      },
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
      /** Every hauler currently drawn, and what it is. A railed shipment is a porter in
       *  the village, a train on the rails and a porter again at the far end, so what is
       *  in here changes as the goods change hands — and `cars` is the load, coupled up. */
      haulers: () =>
        this.mobs.mobs
          .filter((mob) => HAULING_KINDS.includes(mob.kind))
          .map((mob) => ({
            kind: mob.kind, cars: mob.cars,
            x: Math.round(mob.x), y: Math.round(mob.y), z: Math.round(mob.z),
          })),
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
      /** The town inside the village the player is standing in: who lives where, what
       *  each building is waiting for, and who is walking across it right now. */
      town: () => {
        const here = this.villages.at(this.player.x, this.player.z);
        if (!here) return null;
        const town = this.towns.get(here.id);
        if (!town) return null;
        const buildings = this.buildingsFor(here);
        return {
          village: here.name,
          people: this.towns.populationOf(here.id),
          waiting: town.waiting,
          short: this.towns.shortOf(here.id),
          buildings: [...town.cells.values()].map((cell) => ({
            id: cell.id,
            label: buildings.find((b) => b.id === cell.id)?.label ?? cell.id,
            use: cell.use,
            people: cell.people,
            staff: cell.staff,
            wants: [...cell.wants].map(([good, held]) => ({ good, held })),
          })),
        };
      },
      /** Everybody walking across the town the player is in, and whether a villager is
       *  currently drawing each of them. A commute with no mob is one happening out of
       *  sight, which is the thing worth being able to see from here. */
      commutes: () => {
        const here = this.villages.at(this.player.x, this.player.z);
        const town = here ? this.towns.get(here.id) : undefined;
        if (!town) return [];
        return town.commutes.map((commute) => ({
          from: commute.from,
          to: commute.to,
          t: Number(commute.t.toFixed(3)),
          dir: commute.dir,
          drawn: commute.mobId !== null,
        }));
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
      /** Turns the world's clock by hand. See `fastForward`: the same seconds the game
       *  would have run, without the wall clock going with them. */
      fastForward: (seconds: number, step?: number): number => this.fastForward(seconds, step),
      /** Walks every leg's road again now rather than within `RESURVEY_INTERVAL`. What
       *  "I have just changed a block, is it joined up yet?" wants to ask. */
      resurvey: (): number => {
        this.transport.invalidate();
        this.transport.update(0, this.player.x, this.player.z);
        return this.transport.routes.filter((route) => route.connected).length;
      },
      /** How far the world is streamed, in chunks. Small is fast: most of what the browser
       *  test waits for is chunks being generated, and most of what it looks at is under
       *  its own feet. */
      renderDistance: (chunks?: number): number => {
        if (chunks !== undefined) {
          this.options.settings.renderDistance = Math.max(2, Math.min(16, Math.round(chunks)));
          this.setRenderDistance(this.options.settings.renderDistance);
        }
        return this.options.settings.renderDistance;
      },
      /** Road the player laid that the index will not have, and why. */
      roadFaults: (radius = FAULT_REACH): RoadFault[] => this.roadFaults(radius),
      /** Widens the quest route's road to what a cart needs, the way walking its length
       *  again with a shovel would. Three columns for four hundred blocks is the player's
       *  afternoon, not the browser test's. */
      widenRoad: (fromId?: string, toId?: string): number =>
        this.debugBuildRoad(fromId, toId, undefined, 3),
      /** Lays a road between the quest's two towns. Building 300 blocks of it by hand
       *  is the player's job, not the smoke test's. */
      buildRoad: (fromId?: string, toId?: string, surface?: string): number =>
        this.debugBuildRoad(fromId, toId, surface),
      /** The same, between two arbitrary points — which is what a road to an industry is,
       *  since an industry is somewhere the player chose rather than a place on the grid.
       *  Each end is snapped to the nearest street of whatever town it stands in, so a
       *  road to a town still arrives on its street rather than through its houses. */
      pave: (ax: number, az: number, bx: number, bz: number, surface?: string, width = 1): number => {
        const block = surface ? itemDef(surface)?.placesBlock ?? Block.DIRT_PATH : Block.DIRT_PATH;
        const end = (x: number, z: number, towards: { x: number; z: number }): RoadPoint => {
          const town = this.villages.at(x, z);
          if (town) return this.roads.streetPoint(townPlace(town), towards.x, towards.z);
          const at = { x: Math.round(x), z: Math.round(z) };
          return { ...at, y: this.groundHeightAt(at.x, at.z) };
        };
        const from = end(ax, az, { x: bx, z: bz });
        const to = end(bx, bz, { x: ax, z: az });
        return this.runRoad(from, to, block, from.y, to.y, width);
      },
      /** Lays a railway from one village to the other, which is what puts a train on the
       *  route. Curves, piers and all — the same builder the sample world uses, with
       *  nothing left open at the near end. */
      buildRailway: (fromId?: string, toId?: string): number => this.debugBuildRailway(fromId, toId),
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
      /** Pulls one curve out of the network, the way a left click on it would. */
      removeTrack: (edgeId: number): boolean => this.trackNet.remove(edgeId),
      /** Cuts a laid run in two, the way pointing at the middle of one and clicking does.
       *  The node it leaves behind is where a branch or a signal can go. */
      splitTrack: (edgeId: number, at: number) => {
        const cut = this.trackNet.splitEdge(edgeId, at);
        if (!cut.ok) return { ok: false as const, fault: cut.fault, value: cut.value };
        this.transport.invalidate();
        return {
          ok: true as const,
          node: cut.node.id,
          x: Math.round(cut.node.x * 10) / 10,
          y: Math.round(cut.node.y * 10) / 10,
          z: Math.round(cut.node.z * 10) / 10,
          edges: cut.edges.map((edge) => edge.id),
        };
      },
      /** Every switch on the network, and how many ways out each has. */
      switches: () => [...this.trackNet.nodes.values()]
        .filter((node) => node.ports.length > 2)
        .map((node) => ({
          id: node.id,
          x: Math.round(node.x), y: Math.round(node.y), z: Math.round(node.z),
          ways: node.ports.length,
          taken: node.ports.filter((port) => port.edge !== null).length,
        })),
      /** Every signal on the network. */
      signals: () => this.trackNet.signals().map((node) => ({
        id: node.id,
        x: Math.round(node.x), y: Math.round(node.y), z: Math.round(node.z),
      })),
      /** Puts a signal on the railway nearest a point, or takes one down. Cuts a run in
       *  two where there is no end to put one on, which is what pointing at the middle of
       *  a run and clicking does. */
      putSignal: (x: number, z: number, built = true): number | null => {
        const near = this.trackNet.nodesNear(x, z, 6);
        near.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
        let node = near[0] ?? null;
        if (!node && built) {
          const run = this.runNearest(x, z);
          if (!run) return null;
          const cut = this.trackNet.splitEdge(run.edge, run.at);
          if (!cut.ok) return null;
          node = cut.node;
        }
        if (!node || !this.trackNet.setSignal(node.id, built)) return null;
        this.transport.invalidate();
        return node.id;
      },
      /** The blocks the signals cut the railway into, and how many runs are in each.
       *  `watched` is the ones a signal actually bounds, which are the only ones anything
       *  ever waits for — a network with none placed reports every block unwatched. */
      sections: () => {
        const blocks = this.trackNet.sections();
        const count = new Map<number, number>();
        for (const id of blocks.of.values()) count.set(id, (count.get(id) ?? 0) + 1);
        return [...count].map(([id, runs]) => ({ id, runs, watched: blocks.watched.has(id) }));
      },
      /** Every station on the network, and which village each one is close enough to
       *  serve. A line with no station on it carries nothing, so this is the first thing
       *  to look at when a finished railway is not running trains. */
      stations: () => this.trackNet.stations().map((node) => ({
        id: node.id,
        x: Math.round(node.x), y: Math.round(node.y), z: Math.round(node.z),
        serves: this.villageServedBy(node)?.village.name ?? null,
      })),
      /** Builds a station on the end of the line nearest a point, the way pointing at that
       *  end and clicking with one in hand would. Null when there is no end near enough. */
      buildStation: (x: number, z: number): { id: number; x: number; y: number; z: number } | null => {
        const node = this.buildStationNear({ x, z });
        return node ? { id: node.id, x: node.x, y: node.y, z: node.z } : null;
      },
      /** Takes one back down, so a test can watch a running line stop. */
      removeStation: (nodeId: number): boolean => {
        const removed = this.trackNet.setStation(nodeId, false);
        if (removed) this.transport.invalidate();
        return removed;
      },
      /** Every train currently drawn, and what it is made of. The engine is the mob; the
       *  cars behind it are placed from where it has been, so this is also how to see
       *  whether a long train is following the rails round a bend or cutting across it. */
      trains: () => this.mobs.mobs
        .filter((mob) => mob.kind === 'train')
        .map((mob) => ({
          id: mob.id,
          load: mob.cars,
          x: Math.round(mob.x), y: Math.round(mob.y), z: Math.round(mob.z),
          cars: mob.consist.map((car) => ({
            kind: car.kind,
            x: Math.round(car.x * 10) / 10,
            y: Math.round(car.y * 10) / 10,
            z: Math.round(car.z * 10) / 10,
          })),
        })),
      /** What the player is standing on that the block grid knows nothing about: a
       *  carriage floor, a wagon load, a cab roof — or nothing, on solid ground. `refused`
       *  counts the frames a carriage tried to carry them into a wall and left without
       *  them, which is the one way a ride ends that looks like a bug from outside. */
      riding: () => {
        const deck = this.rideDecks.deckAt(
          this.player.x, this.player.z, this.player.y - 0.05, this.player.y + 0.05,
        );
        return {
          on: this.riding?.id ?? null,
          along: this.riding ? Math.round(this.riding.along * 100) / 100 : null,
          across: this.riding ? Math.round(this.riding.across * 100) / 100 : null,
          deck: deck ? { id: deck.id, top: Math.round(deck.top * 100) / 100 } : null,
          refused: this.rideRefused,
        };
      },
      /** Flat tops on moving vehicles anywhere near the player right now. */
      rideDecks: (): number => this.rideDecks.count,
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
          stations: view.stations.length,
          waiting: view.stations.reduce((total, station) => total + station.waiting, 0),
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
      /** Runs the transport clock forward without drawing anything.
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
    restoreSaveFoundation(data, {
      day: this.day,
      mapMemory: this.mapMemory,
      player: this.player,
      world: this.world,
    });
    // After the edits are in place: the road index is built from them, not from the
    // world, which is what lets a road be surveyed while its chunks are still unloaded.
    this.villages.loadJSON(data.villages);
    // Nothing about a town is saved, so the towns of the world being closed have to go:
    // they are laid out again, hungry, from the villages that just came back.
    this.towns.clear();
    for (const id of [...this.commuterMobs.keys()]) this.removeCommuter(id);
    this.roads.seedFromEdits();
    this.industries.loadJSON(data.industries);
    this.lines.loadJSON(data.network);
    this.linesAt = -1;
    this.syncLines();
    this.questline.loadJSON(data.quest);
    this.freightEarned = data.freight ?? 0;
    // Absent in every world written before this railway existed, which opens with none
    // laid - the right answer, and the reason SAVE_VERSION did not have to move.
    if (data.tracks) this.trackNet = TrackNetwork.fromJSON(data.tracks);
    for (const pending of data.pendingVillagers ?? []) this.pendingVillagers.push(pending);
    for (const key of data.populatedChunks) this.populatedChunks.add(key);
    restoreSavedVillagers(data, this.mobs);
  }
}
