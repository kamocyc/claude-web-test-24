import { describe, expect, it } from 'vitest';
import { KEYS, helpView } from '../ui/help';
import { MILESTONES, QUEST_STEPS } from '../game/questline';
import { BLOCKS_PER_PORTER, CART_LOAD, MAX_PORTERS } from '../game/transport';
import { MAX_STOCK, PRODUCE_SECONDS, RANKS, STAGE_POINTS } from '../game/villages';
import { HEADROOM, MAX_STEP, ROAD_SPEED } from '../game/roads';

function view(step: Parameters<typeof helpView>[0]['step'], milestone = 0) {
  return helpView({ step, milestone, objective: null });
}

function text(v: ReturnType<typeof helpView>): string {
  return v.sections
    .map((s) => [s.heading, ...s.notes, ...(s.steps ?? []).map((x) => `${x.label} ${x.detail}`),
      ...(s.table?.rows ?? []).flat()].join('\n'))
    .join('\n');
}

describe('the 遊びかた screen', () => {
  it('lists every tutorial step and every goal', () => {
    const sections = view('find_village').sections;
    const tutorial = sections.find((s) => s.heading === 'チュートリアル');
    expect(tutorial?.steps).toHaveLength(QUEST_STEPS.length);
    const goals = sections.find((s) => s.heading.startsWith('目標'));
    expect(goals?.steps).toHaveLength(MILESTONES.length);
    expect(goals?.steps?.map((s) => s.label)).toEqual(MILESTONES.map((m) => m.title));
  });

  it('marks where the player has got to', () => {
    const tutorial = view('build_road').sections.find((s) => s.heading === 'チュートリアル');
    const states = tutorial?.steps?.map((s) => s.state) ?? [];
    const at = QUEST_STEPS.findIndex((s) => s.step === 'build_road');
    expect(states[at]).toBe('current');
    expect(states[at - 1]).toBe('done');
    expect(states[at + 1]).toBe('todo');
  });

  it('leaves every goal ahead until the tutorial is over', () => {
    const goals = view('deliver_by_hand', 3).sections.find((s) => s.heading.startsWith('目標'));
    expect(goals?.steps?.every((s) => s.state === 'todo')).toBe(true);
  });

  it('ticks off the goals already claimed', () => {
    const goals = view('done', 2).sections.find((s) => s.heading.startsWith('目標'));
    expect(goals?.steps?.[0].state).toBe('done');
    expect(goals?.steps?.[1].state).toBe('done');
    expect(goals?.steps?.[2].state).toBe('current');
  });

  it('reads its numbers out of the systems rather than repeating them', () => {
    // The point of the page is that it cannot go stale. If any of these are tuned, the
    // manual moves with them or this test fails.
    const body = text(view('done', 0));
    expect(body).toContain(`${HEADROOM} マス空いている`);
    expect(body).toContain(`${MAX_STEP} マス以内`);
    expect(body).toContain(`${CART_LOAD} 倍`);
    for (const rank of RANKS) expect(body).toContain(rank);
    for (const points of STAGE_POINTS) expect(body).toContain(`発展度 ${points}`);
    for (const speed of new Set(ROAD_SPEED.values())) expect(body).toContain(`${speed.toFixed(2)} 倍`);
  });

  it('says what makes goods actually move', () => {
    const body = text(view('done', 0));
    expect(body).toContain('荷が出る条件');
    expect(body).toContain('工房の村は原料が届くまで 1 個も作らない');
    expect(body).toContain('在庫が 1 個でもあれば荷は出発する');
    expect(body).toContain('荷は在庫のあるほうの村から出る');
    expect(body).toContain(`${PRODUCE_SECONDS} 秒`);
    expect(body).toContain(`${MAX_STOCK} 個`);
    expect(body).toContain(`${BLOCKS_PER_PORTER} ブロックごとに 1 人、最大 ${MAX_PORTERS} 人`);
  });

  it('documents every key the game binds, including its own', () => {
    expect(KEYS.some((k) => k.key === 'H')).toBe(true);
    const keys = view('done').sections.find((s) => s.heading === '操作');
    expect(keys?.table?.rows).toHaveLength(KEYS.length);
  });

  it('repeats the current objective at the top', () => {
    const v = helpView({
      step: 'build_road',
      milestone: 0,
      objective: { title: 'つなぐ', detail: 'あと 12m' },
    });
    expect(v.objective).toEqual({ title: 'つなぐ', detail: 'あと 12m' });
  });
});
