/** The free-form railway, drawn as track rather than as blocks.
 *
 *  This is the half of the new railway that the chunk mesher cannot do. A rail block goes
 *  through the mesher as a cube with a picture on the top, because the mesher has no notion
 *  of orientation and the road index it serves joins columns up, down, left and right. A
 *  curve has an orientation at every point along it, so it gets its own geometry and its
 *  own group in the scene, in the manner of `routeGuide.ts`: plain data in, one signature
 *  compared per frame, and a rebuild only when the shape has actually changed.
 *
 *  Unlike the route guide this is not an overlay and does not switch off with a setting -
 *  it is something the player built. What does switch off is the ghost and the end markers,
 *  and those are gated on holding the tool, which is the honest gate for them.
 *
 *  The deck can be walked on, but not by anything drawn here. None of this is in the
 *  block grid, and the sweep that moves the player resolves every contact onto the
 *  nearest integer plane, so a deck at 64.37 is settled onto afterwards instead - see
 *  `StandingSurface` in `core/aabb.ts` and `TrackNetwork.surfaceTopAt`. The piers are
 *  drawn and nothing more: they hold the deck up to the eye, and the player walks
 *  through them. The only other thing given the deck is the train, which has freight to
 *  carry along it; every other mob and every dropped item falls straight through. */

import * as THREE from 'three';
import {
  GAUGE,
  PLATFORM_GAP,
  PLATFORM_LONG,
  PLATFORM_TOP,
  PLATFORM_WIDE,
  TRACK_WIDTH,
  type TrackSample,
} from '../game/tracks';

/** Rail head, in blocks. */
const RAIL_WIDTH = 0.16;
const RAIL_HEIGHT = 0.14;
/** A sleeper spans the full TRACK_WIDTH; these are its other two dimensions. */
const SLEEPER_LONG = 0.3;
/** Also the depth of the deck: piers stop here, just under the sleepers. */
export const SLEEPER_THICK = 0.12;
/** Sleeper pitch along the track. */
export const SLEEPER_STEP = 0.6;
/** How finely a curve should be sampled for this to look smooth. */
export const SAMPLE_STEP = 0.5;

const PIER_SIZE = 0.34;
const CAP_THICK = 0.16;
const CAP_LONG = 0.5;

/** The station. A platform down one side of the track with a roof over part of it, and
 *  the crates that are waiting to be loaded standing on it.
 *
 *  Down one side rather than both: a single platform is what a light railway has, and two
 *  would hide the track between them from anybody standing beside the line. How long, how
 *  wide, how far out and how high all come from `tracks.ts`, because the player stands on
 *  this and a platform drawn anywhere other than where their feet are held up would be
 *  the worst kind of wrong. */
const PLATFORM_THICK = 0.9;
const ROOF_LONG = 4.4;
const ROOF_HEIGHT = 2.6;
const POST_SIZE = 0.16;
const CRATE = 0.52;
/** Crates on the platform, at most. Past this the pile stops growing and starts meaning
 *  "full", which is all a heap of boxes can say anyway. */
const MAX_CRATES = 6;

const PLATFORM_COLOUR = 0x9d968a;
const PLATFORM_EDGE = 0xb6afa2;
const ROOF_COLOUR = 0xa8503f;
const CRATE_COLOUR = 0xb99a5e;
const CRATE_BAND = 0x5f4826;

/** The signal: how far off the centreline the post stands, how thick it is, and how high
 *  the lamp sits. Head height rather than roof height — a signal that stood above the
 *  train would be read from the hillside and not from the cab. */
const SIGNAL_GAP = 0.5;
const SIGNAL_POST = 0.16;
const SIGNAL_HEIGHT = 2.4;
const SIGNAL_LAMP = 0.38;
const SIGNAL_CASE = 0x2f3238;
const SIGNAL_CLEAR = 0x46e07a;
const SIGNAL_STOP = 0xe8443c;
/** Amber, and only for a line that has stopped and is not going to start again on its
 *  own. Red means wait; this one means the player has to do something. */
const SIGNAL_STALL = 0xf5c02a;

const STEEL = 0xb0b4bc;
const STEEL_TOP = 0xd0d4dc;
const TIMBER = 0x7a5a38;
const PIER_COLOUR = 0x8a8378;
const GHOST_GOOD = 0x66dd88;
const GHOST_BAD = 0xdd5555;

/** Width of the centreline ribbon the ghost falls back to when the shape is refused. */
const HINT_WIDTH = 0.4;
const HINT_LIFT = 0.08;

export interface TrackEdgeView {
  id: number;
  samples: TrackSample[];
}

export interface TrackPierView {
  x: number;
  z: number;
  top: number;
  bottom: number;
  /** Horizontal across the track, so the cap beam sits square under the sleepers. */
  sx: number;
  sz: number;
}

export interface TrackStationView {
  /** The end of the line the station stands on. */
  x: number;
  y: number;
  z: number;
  /** The track's heading through it, unit in XZ: the platform lies alongside this. */
  hx: number;
  hz: number;
  /** Goods standing on the platform waiting for a train, as the village's own pile. Zero
   *  draws an empty platform, which is worth seeing: it is a station whose village has
   *  nothing to send. */
  waiting: number;
}

/** What a signal is showing. Three, because there are three things worth saying: the road
 *  ahead is yours, somebody else is on it, and somebody else is on it and never leaving. */
export type SignalAspect = 'clear' | 'stop' | 'stall';

export interface TrackSignalView {
  /** The node it stands on. */
  x: number;
  y: number;
  z: number;
  /** The track's heading through it, unit in XZ: the post stands off to one side of this. */
  hx: number;
  hz: number;
  aspect: SignalAspect;
}

export interface TrackMarkerView {
  x: number;
  y: number;
  z: number;
  colour: number;
}

export interface TrackGhostView {
  samples: TrackSample[];
  valid: boolean;
  /** Changes only when the ghost has visibly moved; see `Game.trackView`. */
  key: string;
}

export interface TrackView {
  /** The network's revision, what is in range, and how many piers actually resolved -
   *  that last part matters because a pier over an unloaded chunk is skipped, and without
   *  it in the key the far end of a long run would never grow its legs once the chunk
   *  arrived. */
  key: string;
  edges: TrackEdgeView[];
  piers: TrackPierView[];
  stations: TrackStationView[];
  signals: TrackSignalView[];
  markers: TrackMarkerView[];
  ghost: TrackGhostView | null;
}

type Vec = [number, number, number];

const EMPTY: TrackView = {
  key: '', edges: [], piers: [], stations: [], signals: [], markers: [], ghost: null,
};

export class TrackRenderer {
  readonly group = new THREE.Group();
  private readonly laid: THREE.Mesh;
  private readonly ghost: THREE.Mesh;
  private readonly markerGeometry: THREE.CylinderGeometry;
  private readonly markers: THREE.Mesh[] = [];
  private key = ' ';
  private ghostKey = ' ';

  constructor() {
    this.group.name = 'track';
    // Lambert rather than the chunk shader: that one wants baked `aLight`/`aShade`
    // attributes a swept ribbon has no way to supply. The scene's hemisphere and
    // directional lights are already there for the mobs, so this gets the world's day and
    // night for nothing - which a MeshBasicMaterial would not, and track that glowed at
    // midnight would be the one thing out here that did.
    //
    // Double sided because the geometry is swept along a curve that turns both ways:
    // getting every winding right along an S-bend is work whose only reward is holes
    // wherever it is wrong.
    this.laid = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    );
    this.laid.frustumCulled = false;
    this.group.add(this.laid);

    this.ghost = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.ghost.frustumCulled = false;
    this.ghost.renderOrder = 5;
    this.group.add(this.ghost);

    this.markerGeometry = new THREE.CylinderGeometry(0.16, 0.16, 1, 6, 1, true);
  }

  update(view: TrackView | null): void {
    const next = view ?? EMPTY;
    if (next.key !== this.key) {
      this.key = next.key;
      this.rebuild(next);
    }
    const ghostKey = next.ghost?.key ?? '';
    if (ghostKey !== this.ghostKey) {
      this.ghostKey = ghostKey;
      this.rebuildGhost(next.ghost);
    }
    this.placeMarkers(next.markers);
  }

  dispose(): void {
    this.laid.geometry.dispose();
    this.ghost.geometry.dispose();
    this.markerGeometry.dispose();
  }

  private rebuild(view: TrackView): void {
    const positions: number[] = [];
    const colours: number[] = [];
    for (const edge of view.edges) {
      emitRails(positions, colours, edge.samples, STEEL, STEEL_TOP);
      emitSleepers(positions, colours, edge.samples, TIMBER);
    }
    for (const pier of view.piers) emitPier(positions, colours, pier, PIER_COLOUR);
    for (const station of view.stations) emitStation(positions, colours, station);
    for (const signal of view.signals) emitSignal(positions, colours, signal);
    replaceGeometry(this.laid, positions, colours, true);
  }

  private rebuildGhost(ghost: TrackGhostView | null): void {
    const positions: number[] = [];
    const colours: number[] = [];
    if (ghost) {
      if (ghost.valid) {
        emitRails(positions, colours, ghost.samples, GHOST_GOOD, GHOST_GOOD);
        emitSleepers(positions, colours, ghost.samples, GHOST_GOOD);
      } else {
        // A different shape, not merely a different colour: "this will not be built" reads
        // faster as a thin line where the track should have been.
        emitHint(positions, colours, ghost.samples, GHOST_BAD);
      }
    }
    replaceGeometry(this.ghost, positions, colours, false);
  }

  /** Posts of light on every end a new curve could join, made as they are needed and
   *  hidden when they are not - the same pooling the route guide's beacons use. */
  private placeMarkers(markers: TrackMarkerView[]): void {
    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i];
      let mesh = this.markers[i];
      if (!mesh) {
        mesh = new THREE.Mesh(
          this.markerGeometry,
          new THREE.MeshBasicMaterial({
            transparent: true,
            opacity: 0.5,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        mesh.renderOrder = 6;
        this.markers[i] = mesh;
        this.group.add(mesh);
      }
      mesh.visible = true;
      mesh.position.set(marker.x, marker.y + 0.9, marker.z);
      mesh.scale.set(1, 1.8, 1);
      (mesh.material as THREE.MeshBasicMaterial).color.setHex(marker.colour);
    }
    for (let i = markers.length; i < this.markers.length; i++) this.markers[i].visible = false;
  }
}

// --- geometry -----------------------------------------------------------------

/** The frame at a sample: forward along the track, sideways across it, and up out of it.
 *  Sideways is kept horizontal - there is no cant here, and a level sleeper is what the
 *  eye expects of light track anyway. */
function frameAt(sample: TrackSample): { f: Vec; s: Vec; u: Vec } {
  const f: Vec = [sample.tx, sample.ty, sample.tz];
  const flat = Math.hypot(sample.tx, sample.tz) || 1;
  const s: Vec = [sample.tz / flat, 0, -sample.tx / flat];
  const raw = cross(f, s);
  const length = Math.hypot(raw[0], raw[1], raw[2]) || 1;
  return { f, s, u: [raw[0] / length, raw[1] / length, raw[2] / length] };
}

function cross(a: Vec, b: Vec): Vec {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function at(sample: TrackSample, s: Vec, u: Vec, across: number, up: number): Vec {
  return [
    sample.x + s[0] * across + u[0] * up,
    sample.y + s[1] * across + u[1] * up,
    sample.z + s[2] * across + u[2] * up,
  ];
}

/** Two rails swept along the samples: the head and both flanks. The underside of a rail
 *  is never in view, so it is never built. */
function emitRails(
  positions: number[], colours: number[], samples: TrackSample[], side: number, top: number,
): void {
  if (samples.length < 2) return;
  const half = RAIL_WIDTH / 2;
  for (const centre of [GAUGE / 2, -GAUGE / 2]) {
    let previous = frameAt(samples[0]);
    for (let i = 1; i < samples.length; i++) {
      const current = frameAt(samples[i]);
      const a = samples[i - 1];
      const b = samples[i];
      const aOut = at(a, previous.s, previous.u, centre + half, 0);
      const aIn = at(a, previous.s, previous.u, centre - half, 0);
      const aOutTop = at(a, previous.s, previous.u, centre + half, RAIL_HEIGHT);
      const aInTop = at(a, previous.s, previous.u, centre - half, RAIL_HEIGHT);
      const bOut = at(b, current.s, current.u, centre + half, 0);
      const bIn = at(b, current.s, current.u, centre - half, 0);
      const bOutTop = at(b, current.s, current.u, centre + half, RAIL_HEIGHT);
      const bInTop = at(b, current.s, current.u, centre - half, RAIL_HEIGHT);
      quad(positions, colours, top, aOutTop, aInTop, bInTop, bOutTop);
      quad(positions, colours, side, aOut, aOutTop, bOutTop, bOut);
      quad(positions, colours, side, aInTop, aIn, bIn, bInTop);
      previous = current;
    }
  }
}

/** Sleepers at a fixed pitch, found by walking the samples and stepping off the distance
 *  between them. The pitch is in horizontal arc length, which at the steepest grade the
 *  solver allows is two percent short of the true one. */
function emitSleepers(
  positions: number[], colours: number[], samples: TrackSample[], colour: number,
): void {
  if (samples.length < 2) return;
  const halfWide = TRACK_WIDTH / 2;
  const halfLong = SLEEPER_LONG / 2;
  let travelled = 0;
  let next = SLEEPER_STEP / 2;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const span = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (span < 1e-6) continue;
    while (next <= travelled + span) {
      const t = (next - travelled) / span;
      const centre: TrackSample = {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
        tx: a.tx + (b.tx - a.tx) * t,
        ty: a.ty + (b.ty - a.ty) * t,
        tz: a.tz + (b.tz - a.tz) * t,
      };
      const { f, s, u } = frameAt(centre);
      box(
        positions, colours, colour, centre, f, s, u,
        halfLong, halfWide, SLEEPER_THICK / 2, -SLEEPER_THICK / 2,
      );
      next += SLEEPER_STEP;
    }
    travelled += span;
  }
}

/** A leg down to the ground with a beam across the top of it. One post reads as a stick;
 *  the beam is what makes it read as something holding the track up. */
function emitPier(positions: number[], colours: number[], pier: TrackPierView, colour: number): void {
  const f: Vec = [-pier.sz, 0, pier.sx];
  const s: Vec = [pier.sx, 0, pier.sz];
  const u: Vec = [0, 1, 0];
  const cap = { x: pier.x, y: pier.top - CAP_THICK / 2, z: pier.z };
  box(positions, colours, colour, cap, f, s, u, CAP_LONG / 2, TRACK_WIDTH / 2, CAP_THICK / 2, 0);
  const legTop = pier.top - CAP_THICK;
  const height = legTop - pier.bottom;
  if (height <= 0) return;
  const leg = { x: pier.x, y: pier.bottom + height / 2, z: pier.z };
  box(positions, colours, colour, leg, f, s, u, PIER_SIZE / 2, PIER_SIZE / 2, height / 2, 0);
}

/** A platform beside the rails, a roof over the middle of it, and the freight waiting on
 *  it. All three are the same idea from different distances: from a hilltop the roof says
 *  a station is there, from the road the crates say whether it has anything to send, and
 *  from the platform itself the train that pulls in is as long as the pile was. */
function emitStation(positions: number[], colours: number[], station: TrackStationView): void {
  const flat = Math.hypot(station.hx, station.hz) || 1;
  const f: Vec = [station.hx / flat, 0, station.hz / flat];
  const s: Vec = [f[2], 0, -f[0]];
  const u: Vec = [0, 1, 0];
  // Middle of the platform, one half width plus the gap out from the centreline.
  const across = TRACK_WIDTH / 2 + PLATFORM_GAP + PLATFORM_WIDE / 2;
  const centre = {
    x: station.x + s[0] * across,
    y: station.y + PLATFORM_TOP,
    z: station.z + s[2] * across,
  };
  // The surface is the top, so the slab hangs below it rather than standing on it — and
  // the top is a carriage floor's height, which is the whole point of a platform.
  box(
    positions, colours, PLATFORM_COLOUR, centre, f, s, u,
    PLATFORM_LONG / 2, PLATFORM_WIDE / 2, PLATFORM_THICK / 2, -PLATFORM_THICK / 2,
  );
  // A lip along the track side, which is what makes the platform read as an edge to stand
  // at rather than as a slab somebody left there.
  const lip = {
    x: station.x + s[0] * (TRACK_WIDTH / 2 + PLATFORM_GAP + 0.15),
    y: station.y + PLATFORM_TOP,
    z: station.z + s[2] * (TRACK_WIDTH / 2 + PLATFORM_GAP + 0.15),
  };
  box(positions, colours, PLATFORM_EDGE, lip, f, s, u, PLATFORM_LONG / 2, 0.15, 0.04, -0.04);

  // Two posts and a roof over the middle of it.
  const postAcross = PLATFORM_WIDE / 2 - POST_SIZE;
  for (const along of [-ROOF_LONG / 2 + POST_SIZE, ROOF_LONG / 2 - POST_SIZE]) {
    const post = {
      x: centre.x + f[0] * along + s[0] * postAcross,
      y: centre.y,
      z: centre.z + f[2] * along + s[2] * postAcross,
    };
    box(
      positions, colours, TIMBER, post, f, s, u,
      POST_SIZE / 2, POST_SIZE / 2, ROOF_HEIGHT / 2, ROOF_HEIGHT / 2,
    );
  }
  const roof = { x: centre.x, y: centre.y, z: centre.z };
  box(
    positions, colours, ROOF_COLOUR, roof, f, s, u,
    ROOF_LONG / 2, PLATFORM_WIDE / 2 + 0.2, 0.12, ROOF_HEIGHT + 0.12,
  );

  // The freight. Laid out in a row down the platform under the roof, so a full station and
  // an empty one are told apart from wherever the train would be coming from.
  const crates = Math.max(0, Math.min(MAX_CRATES, Math.round(station.waiting)));
  for (let i = 0; i < crates; i++) {
    const along = (i - (MAX_CRATES - 1) / 2) * (CRATE + 0.14);
    const crate = {
      x: centre.x + f[0] * along + s[0] * 0.35,
      y: centre.y,
      z: centre.z + f[2] * along + s[2] * 0.35,
    };
    box(positions, colours, CRATE_COLOUR, crate, f, s, u, CRATE / 2, CRATE / 2, CRATE / 2, CRATE / 2);
    box(positions, colours, CRATE_BAND, crate, f, s, u, CRATE / 2 + 0.01, CRATE / 2 + 0.01, 0.04, CRATE / 2);
  }
}

/** A post beside the rails with a lamp on it.
 *
 *  Read from the train's seat and from the hillside both, which is why the lamp is a
 *  block of flat colour rather than a light: at fifty blocks a green dot and a red dot are
 *  the difference between "the line is clear" and "go and look", and that has to survive
 *  being three pixels across. */
function emitSignal(positions: number[], colours: number[], signal: TrackSignalView): void {
  const flat = Math.hypot(signal.hx, signal.hz) || 1;
  const f: Vec = [signal.hx / flat, 0, signal.hz / flat];
  const s: Vec = [f[2], 0, -f[0]];
  const u: Vec = [0, 1, 0];
  // Off the side the platforms are not on, so a signal at a station does not stand in the
  // middle of the platform roof.
  const across = -(TRACK_WIDTH / 2 + SIGNAL_GAP);
  const foot = {
    x: signal.x + s[0] * across,
    y: signal.y,
    z: signal.z + s[2] * across,
  };
  // Standing *on* the deck: the offset lifts the middle of the post by half its height, so
  // its foot is at the rail and its top is where the lamp goes.
  box(
    positions, colours, TIMBER, foot, f, s, u,
    SIGNAL_POST / 2, SIGNAL_POST / 2, SIGNAL_HEIGHT / 2, SIGNAL_HEIGHT / 2,
  );
  const head = { x: foot.x, y: foot.y + SIGNAL_HEIGHT, z: foot.z };
  box(
    positions, colours, SIGNAL_CASE, head, f, s, u,
    SIGNAL_LAMP / 2, SIGNAL_LAMP / 2 + 0.07, SIGNAL_LAMP / 2 + 0.07, SIGNAL_LAMP / 2,
  );
  // The lamp itself, standing proud of the case *along* the track and inset across it, so
  // that what a train sees coming up to it is the light and what somebody standing beside
  // it sees is the casing. Both ends are lit: one signal, read from either direction.
  const lit = signal.aspect === 'stall'
    ? SIGNAL_STALL
    : signal.aspect === 'stop' ? SIGNAL_STOP : SIGNAL_CLEAR;
  box(
    positions, colours, lit, head, f, s, u,
    SIGNAL_LAMP / 2 + 0.05, SIGNAL_LAMP / 2 - 0.06, SIGNAL_LAMP / 2 - 0.06, SIGNAL_LAMP / 2,
  );
}

/** The ribbon a refused ghost falls back to: where the track would have run, without
 *  pretending it is track. */
function emitHint(
  positions: number[], colours: number[], samples: TrackSample[], colour: number,
): void {
  if (samples.length < 2) return;
  const half = HINT_WIDTH / 2;
  let previous = frameAt(samples[0]);
  for (let i = 1; i < samples.length; i++) {
    const current = frameAt(samples[i]);
    const a = samples[i - 1];
    const b = samples[i];
    quad(
      positions, colours, colour,
      at(a, previous.s, previous.u, -half, HINT_LIFT),
      at(a, previous.s, previous.u, half, HINT_LIFT),
      at(b, current.s, current.u, half, HINT_LIFT),
      at(b, current.s, current.u, -half, HINT_LIFT),
    );
    previous = current;
  }
}

/** A box in the frame (f, s, u), with half extents along each and an offset along u. */
function box(
  positions: number[], colours: number[], colour: number,
  centre: { x: number; y: number; z: number },
  f: Vec, s: Vec, u: Vec,
  halfF: number, halfS: number, halfU: number, offsetU: number,
): void {
  const corner = (df: number, ds: number, du: number): Vec => [
    centre.x + f[0] * df * halfF + s[0] * ds * halfS + u[0] * (du * halfU + offsetU),
    centre.y + f[1] * df * halfF + s[1] * ds * halfS + u[1] * (du * halfU + offsetU),
    centre.z + f[2] * df * halfF + s[2] * ds * halfS + u[2] * (du * halfU + offsetU),
  ];
  const ppp = corner(1, 1, 1);
  const ppm = corner(1, 1, -1);
  const pmp = corner(1, -1, 1);
  const pmm = corner(1, -1, -1);
  const mpp = corner(-1, 1, 1);
  const mpm = corner(-1, 1, -1);
  const mmp = corner(-1, -1, 1);
  const mmm = corner(-1, -1, -1);
  quad(positions, colours, colour, mpp, ppp, pmp, mmp);
  quad(positions, colours, colour, mmm, pmm, ppm, mpm);
  quad(positions, colours, colour, ppp, ppm, pmm, pmp);
  quad(positions, colours, colour, mpp, mmp, mmm, mpm);
  quad(positions, colours, colour, mpp, mpm, ppm, ppp);
  quad(positions, colours, colour, mmp, mmm, pmm, pmp);
}

const SCRATCH = new THREE.Color();

function quad(
  positions: number[], colours: number[], colour: number,
  a: Vec, b: Vec, c: Vec, d: Vec,
): void {
  positions.push(...a, ...b, ...c, ...a, ...c, ...d);
  SCRATCH.setHex(colour);
  for (let i = 0; i < 6; i++) colours.push(SCRATCH.r, SCRATCH.g, SCRATCH.b);
}

function replaceGeometry(
  mesh: THREE.Mesh, positions: number[], colours: number[], normals: boolean,
): void {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  // Vertices are never shared, so this comes out per face - the same faceted look the
  // rest of the world has, rather than a smoothed tube.
  if (normals) geometry.computeVertexNormals();
  mesh.geometry.dispose();
  mesh.geometry = geometry;
}
