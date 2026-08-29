import type { MobKind } from './mobs/types';
import {
  MAX_GRADE,
  MAX_SPAN,
  MIN_RADIUS,
  MIN_SPAN,
  type TrackEdge,
  type TrackFault,
  type TrackNode,
  type TrackPoint,
  type TrackSummary,
} from './tracks';

/** How far a carriage may move under its passenger in one frame and still carry them. */
export const RIDE_LOST = 4;

/** A laid run the crosshair is on, and how far along it. */
export interface TrackRun {
  edge: TrackEdge;
  at: number;
}

/** The point, endpoint or middle of a run currently under the track-tool crosshair. */
export interface TrackAim {
  point: TrackPoint;
  node: TrackNode | null;
  run: TrackRun | null;
}

export const LEVEL = 0.005;

/** A road waypoint is a block centre; a railway waypoint is already an exact point. */
export function centreOf(kind: MobKind): number {
  return kind === 'train' ? 0 : 0.5;
}

export function slopeWord(grade: number): string {
  return Math.abs(grade) < LEVEL ? '水平' : grade > 0 ? '上り' : '下り';
}

export function bendWord(turn: 'left' | 'right'): string {
  return turn === 'right' ? '右' : '左';
}

/** Why a curve was refused, in a sentence the player can act on. */
export function trackFaultText(fault: TrackFault, value: number, turn: 'left' | 'right' | null = null): string {
  switch (fault) {
    case 'short':
      return `始点に近すぎる（${MIN_SPAN} マス以上はなれた所を指す）`;
    case 'long':
      return `一度に敷けるのは ${MAX_SPAN} マスまで（今 ${Math.round(value)} マス）`;
    case 'behind':
      return '始点の向きの後ろへはつなげない';
    case 'radius':
      return `曲がりが急すぎる（${turn ? `${bendWord(turn)} ` : ''}半径 ${value.toFixed(1)} マス、${MIN_RADIUS} マス以上必要）`;
    case 'grade':
      return `勾配が急すぎる（${slopeWord(value)} ${Math.round(Math.abs(value) * 100)}%、${Math.round(MAX_GRADE * 100)}% まで）`;
    case 'occupied':
      return '本線から分かれるには角度が急すぎる（もっと線路に沿って向く）';
    default:
      return 'この向きではつなげない';
  }
}

/** The track shape under the crosshair, formatted for the three-line readout. */
export function trackLines(summary: TrackSummary): string[] {
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
