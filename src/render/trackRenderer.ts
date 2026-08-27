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
 *  The track has no collision. It is geometry, with nothing in the block grid underneath,
 *  so the player walks through it. Giving it a collider means a second list for
 *  `player.update` to consult on every step, which is a change to how movement works
 *  rather than to how track is drawn. */

import * as THREE from 'three';
import { GAUGE, TRACK_WIDTH, type TrackSample } from '../game/tracks';

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
  markers: TrackMarkerView[];
  ghost: TrackGhostView | null;
}

type Vec = [number, number, number];

const EMPTY: TrackView = { key: '', edges: [], piers: [], markers: [], ghost: null };

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
