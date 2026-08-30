import { describe, expect, it } from 'vitest';
import { cargoCaption, cargoStyle } from '../render/cargoRenderer';

describe('cargo world readouts', () => {
  it('gives travellers and major goods different physical silhouettes', () => {
    expect(cargoStyle('passenger').form).toBe('people');
    expect(cargoStyle('oak_log').form).toBe('logs');
    expect(cargoStyle('wheat').form).toBe('sacks');
    expect(cargoStyle('coal').form).toBe('mineral');
    expect(cargoStyle('iron_ingot').form).toBe('ingots');
    expect(cargoStyle('oak_planks').form).toBe('planks');
  });

  it('writes both the state, item name and whole count on the placard', () => {
    expect(cargoCaption({ kind: 'waiting', label: '小麦', count: 12.9 })).toBe('待機  小麦 ×12');
    expect(cargoCaption({ kind: 'train', label: '人', count: 7 })).toBe('輸送  人 ×7');
  });
});
