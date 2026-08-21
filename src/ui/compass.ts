import { el } from './dom';

export type MarkerKind = 'spawn' | 'death' | 'village' | 'gap' | 'target';

export interface CompassMarker {
  kind: MarkerKind;
  x: number;
  z: number;
}

const MARKER_ICON: Record<MarkerKind, string> = {
  spawn: '⌂',
  death: '✖',
  village: '⌗',
  gap: '⋯',
  target: '⚑',
};

const MARKER_LABEL: Record<MarkerKind, string> = {
  spawn: '出発地点',
  death: '死亡地点',
  village: '村',
  gap: '道のとぎれ',
  target: '目的地',
};

const CARDINALS: { angle: number; label: string }[] = [
  { angle: 0, label: 'N' },
  { angle: 45, label: '' },
  { angle: 90, label: 'E' },
  { angle: 135, label: '' },
  { angle: 180, label: 'S' },
  { angle: 225, label: '' },
  { angle: 270, label: 'W' },
  { angle: 315, label: '' },
];

/** Half the field of view the strip covers, in degrees. */
const HALF_SPAN = 60;

interface Tick {
  node: HTMLElement;
  bearing: number;
}

/** Heading strip across the top of the screen with markers for places worth walking
 *  back to. Bearings are compass degrees: 0 is north, which is -Z. */
export class Compass {
  readonly root = el('div', 'compass');
  private readonly strip = el('div', 'compass-strip');
  private readonly ticks: Tick[] = [];
  /** Pooled, because several villages can be on screen at once now. */
  private readonly markerNodes: { node: HTMLElement; label: HTMLElement; kind: MarkerKind }[] = [];

  constructor() {
    for (const cardinal of CARDINALS) {
      const node = el('div', cardinal.label ? 'compass-tick major' : 'compass-tick', cardinal.label);
      this.strip.appendChild(node);
      this.ticks.push({ node, bearing: cardinal.angle });
    }
    this.root.appendChild(this.strip);
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? '' : 'none';
  }

  update(yaw: number, x: number, z: number, markers: CompassMarker[]): void {
    const heading = ((-yaw * 180) / Math.PI + 360) % 360;
    for (const tick of this.ticks) this.place(tick.node, tick.bearing - heading, null);

    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i];
      const entry = this.markerAt(i, marker.kind);
      const dx = marker.x - x;
      const dz = marker.z - z;
      const bearing = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
      const distance = Math.round(Math.hypot(dx, dz));
      this.place(entry.node, bearing - heading, entry.label, distance);
    }
    for (let i = markers.length; i < this.markerNodes.length; i++) {
      this.markerNodes[i].node.style.display = 'none';
    }
  }

  /** Nodes are made as they are needed and re-labelled in place, so a strip showing four
   *  villages does not churn the DOM every frame. */
  private markerAt(index: number, kind: MarkerKind): { node: HTMLElement; label: HTMLElement } {
    let entry = this.markerNodes[index];
    if (!entry) {
      const node = el('div', `compass-marker ${kind}`);
      const icon = el('span', 'compass-icon', MARKER_ICON[kind]);
      const label = el('span', 'compass-distance');
      node.append(icon, label);
      this.strip.appendChild(node);
      entry = { node, label, kind };
      this.markerNodes[index] = entry;
    }
    if (entry.kind !== kind) {
      entry.kind = kind;
      entry.node.className = `compass-marker ${kind}`;
      (entry.node.firstChild as HTMLElement).textContent = MARKER_ICON[kind];
    }
    entry.node.title = MARKER_LABEL[kind];
    return entry;
  }

  /** Positions one element on the strip, hiding it when it falls outside the span. */
  private place(node: HTMLElement, relative: number, label: HTMLElement | null, distance = 0): void {
    const angle = ((relative + 540) % 360) - 180;
    if (Math.abs(angle) > HALF_SPAN) {
      node.style.display = 'none';
      return;
    }
    node.style.display = '';
    node.style.left = `${50 + (angle / HALF_SPAN) * 50}%`;
    if (label) {
      const text = distance >= 1000 ? `${(distance / 1000).toFixed(1)}k` : String(distance);
      if (label.textContent !== text) label.textContent = text;
    }
  }
}
