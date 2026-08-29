import { describe, expect, it } from 'vitest';
import { KEYS, helpView } from '../ui/help';
import { MILESTONES, QUEST_STEPS } from '../game/questline';
import { BLOCKS_PER_PORTER, CART_LOAD, MAX_PORTERS, TRAIN_LOAD } from '../game/transport';
import { MAX_STOCK, PRODUCE_SECONDS, RANKS, STAGE_POINTS } from '../game/villages';
import { HEADROOM, MAX_STEP, ROAD_SPEED } from '../game/roads';
import { CELL_STOCK, COMMUTE_EVERY, HOME_PEOPLE, HOUSEHOLD_GOODS } from '../game/townEconomy';
import { USE_LABELS } from '../game/buildings';
import { itemLabel } from '../game/items';
import { MAX_SWITCH_ANGLE } from '../game/tracks';
import { MAX_LINE_STOPS, STOP_SPACING } from '../game/lines';
import { DEPOSIT_RADIUS, INDUSTRY_TYPES } from '../game/industry';
import { FIELD_SIZE } from '../world/generation/fields';

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
    expect(body).toContain(`${TRAIN_LOAD} 倍`);
    for (const rank of RANKS) expect(body).toContain(rank);
    for (const points of STAGE_POINTS) expect(body).toContain(`発展度 ${points}`);
    for (const speed of new Set(ROAD_SPEED.values())) expect(body).toContain(`${speed.toFixed(2)} 倍`);
  });

  it('says what makes goods actually move', () => {
    const body = text(view('done', 0));
    expect(body).toContain('荷が出る条件');
    // The one rule that is different from every other game like this, said first and
    // said plainly: a finished road on its own carries nothing.
    expect(body).toContain('道があるだけでは荷は 1 個も動かない');
    expect(body).toContain('原料が **全種類** そろうまで 1 個も作らない');
    expect(body).toContain('在庫が 1 個でもあれば荷は出発する');
    expect(body).toContain('荷は在庫のあるほうの端から出る');
    expect(body).toContain(`${PRODUCE_SECONDS} 秒`);
    expect(body).toContain(`${MAX_STOCK} 個`);
    expect(body).toContain(`${BLOCKS_PER_PORTER} ブロックごとに 1 人、最大 ${MAX_PORTERS} 人`);
  });

  it('explains the two things the player now builds that no road can replace', () => {
    const body = text(view('done', 0));
    expect(body).toContain('停留所と路線');
    expect(body).toContain('一次産業');
    // The numbers, out of the systems rather than typed here.
    expect(body).toContain(`${MAX_LINE_STOPS} か所まで`);
    expect(body).toContain(`${STOP_SPACING} マス以上離す`);
    expect(body).toContain(`周囲 ${DEPOSIT_RADIUS} マス`);
    for (const type of INDUSTRY_TYPES) expect(body).toContain(type.label);
    // Both halves of a deposit count, and the page has to say so or an outcrop is just
    // scenery the player walks past.
    expect(body).toContain('地中の鉱脈も、地表に出ている露頭も');
  });

  it('explains the one thing the player does not build — the fields', () => {
    const body = text(view('done', 0));
    expect(body).toContain('畑と食料');
    expect(body).toContain(`1 区画 ${FIELD_SIZE}×${FIELD_SIZE} マス`);
    expect(body).toContain('2 倍の面積');
    // Where the crop goes, which is the whole of what the player needs to know about it.
    expect(body).toContain('集荷所の在庫');
    expect(body).toContain('商店');
  });

  it('explains the two halves of a signalled railway', () => {
    // The branch and the block are one feature: a signal on a line that cannot pass is a
    // way of jamming it, so the page has to teach both or neither.
    const body = text(view('done', 0));
    expect(body).toContain('分岐 — 途中から割って枝を出す');
    expect(body).toContain('信号 — 閉塞と、詰まったとき');
    // The angle comes out of the solver rather than being repeated here, so a change to
    // the limit moves the manual with it.
    expect(body).toContain(`${Math.round((MAX_SWITCH_ANGLE * 180) / Math.PI)}°`);
    expect(body).toContain('鉄インゴット 2 ＋ 木材 2');
    // The one promise the whole feature stands on.
    expect(body).toContain('信号を 1 つも置いていない線路は、今までとまったく同じに動く');
    expect(body).toContain('待避線');
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

describe('the town section', () => {
  const section = view('done').sections.find((s) => s.heading.startsWith('町の中'));

  it('names all three uses and what is inside them', () => {
    expect(section).toBeDefined();
    const rows = section?.table?.rows ?? [];
    expect(rows.map((r) => r[0])).toEqual([
      USE_LABELS.residential, USE_LABELS.commercial, USE_LABELS.industrial,
    ]);
    // Straight off the implementation, so tuning the town does not leave the manual lying.
    expect(rows[0][1]).toBe(`${HOME_PEOPLE}`);
  });

  it('takes its numbers and its shopping lists from the code', () => {
    const words = [section?.heading, ...(section?.notes ?? [])].join('\n');
    expect(words).toContain(`${COMMUTE_EVERY} 秒`);
    expect(words).toContain(`${CELL_STOCK} 個`);
    for (const good of HOUSEHOLD_GOODS) expect(words).toContain(itemLabel(good));
  });

  it('says the thing a player cannot see for themselves', () => {
    // A shop nobody walks into looks exactly like a shop that is doing fine, and that is
    // the one rule of the town nothing in the world can show.
    expect(text(view('done'))).toContain('人が来た建物だけが品物を使う');
  });
});
