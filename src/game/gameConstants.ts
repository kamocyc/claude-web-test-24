import { MAX_STEP } from './roads';

export const UNLOAD_MARGIN = 2;
export const REACH = 5;

/** How near the player has to be to put a stop down or take one back up. */
export const STOP_REACH = 6;
/** How near the player has to be to take an industry back down. */
export const INDUSTRY_REACH = 8;
export const ATTACK_REACH = 3.6;
export const AUTOSAVE_SECONDS = 30;
export const MINIMAP_REACH = 130;
export const BUILDING_REACH = 28;
export const GUIDE_TILE_REACH = 40;

/** Route-guide colours, shared by all of the guide-building code in Game. */
export const GUIDE_ROAD = 0x5cff92;
export const GUIDE_GAP = 0xffa04d;
export const GUIDE_PORTER = 0x8ef0b8;
export const GUIDE_FAULT = 0xff5a5a;
export const GUIDE_NARROW = 0xffc457;
export const GUIDE_RAILGAP = 0xb08cff;
export const GUIDE_STATION = 0xff9adf;
export const GUIDE_DEPOT = 0xffd479;
export const GUIDE_LINK = 0x35c8ff;
export const GUIDE_NOLINK = 0x9aa4b0;
export const GUIDE_STALL = 0xf5c02a;

export const COMMUTE_VISIBLE = 48;
export const LINK_VISIBLE = 110;

/** Deliberately gentler than the step the road index will walk. */
export const ROAD_GRADE = MAX_STEP / 2;
export const ROAD_REACH = 20;

export const TRACK_REACH = 48;
export const TRACK_LIFT = 0.06;
export const TRACK_PICK = 1.2;
export const TRACK_DRAW = 128;
export const PIER_STEP = 4;
export const PIER_MIN_GAP = 0.4;
export const TRACK_VIEW_INTERVAL = 1;
export const TRACK_START_MARK = 0xffbb33;
export const TRACK_END_MARK = 0x66ccff;
export const TRACK_SPLIT_MARK = 0xffa0d8;
/** How far a train has to have moved before it looks again at what it is running into.
 *  Short next to a car, so consecutive checks overlap and nothing slips between them. */
export const PLOUGH_STEP = 0.3;
/** Blocks per pass that throw a burst of debris. A train through a hillside breaks more
 *  in one frame than the particle pool holds, and the first few say it just as well. */
export const PLOUGH_PARTICLES = 6;

export const STALL_LIGHT = 6;
export const PORT_MARK_OUT = 0.9;

export const SAMPLE_ROAD = 400;
export const PAVE_INTERVAL = 0.06;
export const PAVE_BRIDGE = 12;
export const SAMPLE_WIDTH = 3;
export const SAMPLE_TRACK_GAP = 48;
export const SAMPLE_TRACK_SPARE = 24;
export const SAMPLE_STATIONS = 2;
export const SAMPLE_STOPS = 4;
export const SAMPLE_TRACK_OFFSET = 6;
export const MINIMAP_RAIL_STEP = 6;
export const SAMPLE_TRACK_STEP = 64;
export const SAMPLE_TRACK_PROBE = 8;
export const SAMPLE_TRACK_CLEAR = 2;
/** How fast the laid deck may follow the ground down, as a rise over run.
 *
 *  Not `MAX_GRADE`, and it must not be: this is the *average* slope the deck is asked
 *  for, while `MAX_GRADE` is the *steepest point* of the profile that gets laid. A
 *  segment that comes level at both ends and drops h over L peaks at 1.5 h/L in the
 *  middle, so anything above `MAX_GRADE / 1.5` — 0.133 — is an envelope the track solver
 *  is then obliged to reject with a `grade` fault, and the railway simply does not get
 *  built. It sat at 0.15 for as long as the terrain never handed it a long enough drop to
 *  notice. */
export const SAMPLE_TRACK_GRADE = 0.12;

export const FAULT_TOAST_INTERVAL = 4;
export const FAULT_REACH = 40;
export const WORLD_BUDGET_MS = 12;
export const TUTORIAL_STOPS = 2;
export const STARTING_KIT: readonly string[] = ['oak_planks', 'dirt'];
export const STARTING_COUNT = 32;

export const MESH_BUDGET = 3;
export const WATER_MESH_BUDGET = 6;
