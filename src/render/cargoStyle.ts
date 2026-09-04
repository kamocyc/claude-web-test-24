/** What a load looks like, wherever it is being drawn.
 *
 *  Split out from the renderer that first needed it, because three things now draw the
 *  same goods and they must not drift apart: the placard beside a depot, the emblem over
 *  a moving vehicle, and — since the wagons were opened up — the load sitting in the
 *  wagon itself. A sack of wheat is a sack of wheat in all three.
 *
 *  No three.js here on purpose: the model tables are plain data and are read by tests
 *  that run under Node. */

import type { GoodId } from '../game/villages';

export type CargoForm = 'people' | 'logs' | 'sacks' | 'mineral' | 'ingots' | 'planks' | 'torches' | 'blocks' | 'crate';

export interface CargoStyle {
  form: CargoForm;
  colour: number;
}

/** The one colour that is not a good: the teal of somebody travelling. */
const TRAVEL = 0x57a89a;

/** Stable visual vocabulary: the shape names the family and the colour names the good. */
export function cargoStyle(good: GoodId): CargoStyle {
  switch (good) {
    case 'passenger': return { form: 'people', colour: TRAVEL };
    case 'oak_log': return { form: 'logs', colour: 0x9b6a3c };
    case 'wheat': return { form: 'sacks', colour: 0xe8bd57 };
    case 'bread': return { form: 'sacks', colour: 0xc9813f };
    case 'sand': return { form: 'sacks', colour: 0xe8d7a7 };
    case 'coal': return { form: 'mineral', colour: 0x383640 };
    case 'iron_ore': return { form: 'mineral', colour: 0xa98772 };
    case 'iron_ingot': return { form: 'ingots', colour: 0xcbd4dc };
    case 'oak_planks': return { form: 'planks', colour: 0xc99b61 };
    case 'torch': return { form: 'torches', colour: 0xffb44c };
    case 'glass': return { form: 'blocks', colour: 0x9ddce6 };
    case 'sandstone': return { form: 'blocks', colour: 0xd9c784 };
    default: return { form: 'crate', colour: 0xc58c54 };
  }
}
