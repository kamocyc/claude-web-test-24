/** The road network, drawn on the ground as light.
 *
 *  A road here is allowed to be dashed and is indexed rather than looked at, so "is this
 *  joined up?" stopped being answerable by standing on it. The panel says yes or no and
 *  the minimap says roughly where — but the question a player actually asks is "which bit
 *  of this do I still have to build?", and that one is only really answered in the world
 *  itself.
 *
 *  So: a green line runs along every road that carries goods, an amber dashed line lies
 *  across the stretch that is still missing with a beacon at each end of it, and a pale
 *  tile sits on every column the game counts as road near the player. That last one is
 *  the honest one — a road buried under a landslide stops being indexed, and this is
 *  where that becomes visible instead of mysterious.
 *
 *  Geometry is rebuilt only when the network or the player's whereabouts have actually
 *  moved on; the beams are pooled and only ever repositioned. */

import * as THREE from 'three';

export interface GuidePoint {
  x: number;
  z: number;
  /** The road block's own y. The line is drawn just above its top face. */
  y: number;
}

export interface GuideLine {
  /** Changes when the line's shape does, and only then. The points are draped over the
   *  ground a block at a time, so a long road is hundreds of them — comparing those every
   *  frame would cost more than the rebuild it exists to avoid. */
  key: string;
  points: GuidePoint[];
  colour: number;
  /** The missing stretch, drawn as the dashes it wants to become. */
  dashed: boolean;
}

export interface GuideBeam {
  x: number;
  z: number;
  y: number;
  colour: number;
  height: number;
}

export interface GuideView {
  lines: GuideLine[];
  /** Columns the road index counts, near the player. */
  tiles: GuidePoint[];
  /** Changes whenever `tiles` could have: the road index's revision and roughly where the
   *  player is. Comparing the tiles themselves every frame would cost more than the
   *  rebuild it is there to avoid. */
  tilesKey: string;
  /** Where a road stops, and where each shipment has got to. */
  beams: GuideBeam[];
}

const EMPTY: GuideView = { lines: [], tiles: [], beams: [], tilesKey: '' };

/** Height above a road block's top face. Enough that the ground cannot swallow it at a
 *  grazing angle, low enough that it still reads as painted on. */
const LIFT = 0.18;
const LINE_WIDTH = 0.9;
const TILE_SIZE = 0.5;
/** What the road index counts, drawn faintly enough to be a hint rather than litter. */
const TILE_COLOUR = 0x9fd8ff;
/** Length of one dash and the space after it, in blocks. */
const DASH = 1.6;
const DASH_GAP = 1.1;

export class RouteGuide {
  readonly group = new THREE.Group();
  private readonly lines: THREE.Mesh;
  private readonly tiles: THREE.Mesh;
  private readonly lineMaterial: THREE.MeshBasicMaterial;
  private readonly beamGeometry: THREE.CylinderGeometry;
  private readonly beams: THREE.Mesh[] = [];
  private signature = '';
  private phase = 0;

  constructor() {
    this.group.name = 'route-guide';
    // Drawn after the world and never into the depth buffer, so a line lying on a road
    // cannot z-fight with the road.
    this.lineMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.lines = new THREE.Mesh(new THREE.BufferGeometry(), this.lineMaterial);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 3;
    this.group.add(this.lines);
    // The tiles are a separate mesh so they can stay faint while the lines pulse.
    this.tiles = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: TILE_COLOUR,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.tiles.frustumCulled = false;
    this.tiles.renderOrder = 2;
    this.group.add(this.tiles);
    this.beamGeometry = new THREE.CylinderGeometry(0.3, 0.3, 1, 6, 1, true);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  /** `dt` only drives the pulse, which is what makes an unfinished road read as something
   *  asking to be finished rather than as scenery. */
  update(view: GuideView | null, dt: number): void {
    const next = view ?? EMPTY;
    this.phase = (this.phase + dt) % 2;
    this.lineMaterial.opacity = 0.78 + 0.14 * Math.sin(this.phase * Math.PI);

    const signature = this.signatureOf(next);
    if (signature !== this.signature) {
      this.signature = signature;
      this.rebuild(next);
    }
    this.placeBeams(next.beams);
  }

  /** Cheap enough to run every frame, and it changes only when a road or a shipment
   *  does — the tiles are keyed on the player's whereabouts by the caller. */
  private signatureOf(view: GuideView): string {
    return `${view.lines.map((line) => line.key).join('|')}#${view.tilesKey}#${view.tiles.length}`;
  }

  private rebuild(view: GuideView): void {
    const positions: number[] = [];
    const colors: number[] = [];
    const colour = new THREE.Color();
    for (const line of view.lines) {
      colour.setHex(line.colour);
      for (let i = 1; i < line.points.length; i++) {
        this.segment(positions, colors, colour, line.points[i - 1], line.points[i], line.dashed);
      }
    }
    replaceGeometry(this.lines, positions, colors);

    const tilePositions: number[] = [];
    const half = TILE_SIZE / 2;
    for (const tile of view.tiles) {
      const y = tile.y + 1 + LIFT * 0.6;
      quad(
        tilePositions, null, colour,
        tile.x + 0.5 - half, y, tile.z + 0.5 - half,
        tile.x + 0.5 + half, y, tile.z + 0.5 - half,
        tile.x + 0.5 + half, y, tile.z + 0.5 + half,
        tile.x + 0.5 - half, y, tile.z + 0.5 + half,
      );
    }
    replaceGeometry(this.tiles, tilePositions, null);
  }

  /** One stretch of line, as a flat ribbon following the ground it runs over. */
  private segment(
    positions: number[],
    colors: number[],
    colour: THREE.Color,
    a: GuidePoint,
    b: GuidePoint,
    dashed: boolean,
  ): void {
    const ax = a.x + 0.5;
    const az = a.z + 0.5;
    const bx = b.x + 0.5;
    const bz = b.z + 0.5;
    const length = Math.hypot(bx - ax, bz - az);
    if (length < 1e-3) return;
    // Sideways, so the ribbon lies flat across the direction of travel.
    const nx = (-(bz - az) / length) * (LINE_WIDTH / 2);
    const nz = ((bx - ax) / length) * (LINE_WIDTH / 2);

    const at = (f: number): [number, number, number] => [
      ax + (bx - ax) * f,
      a.y + (b.y - a.y) * f + 1 + LIFT,
      az + (bz - az) * f,
    ];

    const stride = dashed ? DASH + DASH_GAP : length;
    for (let start = 0; start < length - 1e-3; start += stride) {
      const end = Math.min(length, start + (dashed ? DASH : length));
      const [sx, sy, sz] = at(start / length);
      const [ex, ey, ez] = at(end / length);
      quad(
        positions, colors, colour,
        sx - nx, sy, sz - nz,
        sx + nx, sy, sz + nz,
        ex + nx, ey, ez + nz,
        ex - nx, ey, ez - nz,
      );
    }
  }

  /** Pillars of light, made as they are needed and hidden when they are not. */
  private placeBeams(beams: GuideBeam[]): void {
    for (let i = 0; i < beams.length; i++) {
      const beam = beams[i];
      let mesh = this.beams[i];
      if (!mesh) {
        mesh = new THREE.Mesh(
          this.beamGeometry,
          new THREE.MeshBasicMaterial({
            transparent: true,
            // Not additive: against a bright sky an additive amber beacon washes out to
            // white, which is the one colour it must not be.
            opacity: 0.45,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        mesh.renderOrder = 4;
        this.beams[i] = mesh;
        this.group.add(mesh);
      }
      mesh.visible = true;
      mesh.position.set(beam.x + 0.5, beam.y + 1 + beam.height / 2, beam.z + 0.5);
      mesh.scale.set(1, beam.height, 1);
      (mesh.material as THREE.MeshBasicMaterial).color.setHex(beam.colour);
    }
    for (let i = beams.length; i < this.beams.length; i++) this.beams[i].visible = false;
  }
}

function replaceGeometry(mesh: THREE.Mesh, positions: number[], colors: number[] | null): void {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  mesh.geometry.dispose();
  mesh.geometry = geometry;
}

/** Two triangles, wound so the ribbon is visible from either side. */
function quad(
  positions: number[],
  colors: number[] | null,
  colour: THREE.Color,
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
  x2: number, y2: number, z2: number,
  x3: number, y3: number, z3: number,
): void {
  positions.push(x0, y0, z0, x1, y1, z1, x2, y2, z2, x0, y0, z0, x2, y2, z2, x3, y3, z3);
  if (colors) for (let i = 0; i < 6; i++) colors.push(colour.r, colour.g, colour.b);
}
