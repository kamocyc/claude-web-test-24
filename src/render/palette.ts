/** Shared art direction: soft surfaces with saturated colours reserved for feedback. */
export const PASTEL = {
  grassLight: '#d3f39a', grass: '#a9e06d', grassDeep: '#7cc551',
  dirtLight: '#d8b189', dirt: '#c39a70', dirtDeep: '#a67d55',
  stoneLight: '#dfe4ee', stone: '#c3c9d8', stoneDeep: '#a4abbd',
  sandLight: '#fbeec4', sand: '#f2ddaa', sandDeep: '#dfc48c',
  snow: '#f0f6ff', snowDeep: '#d8e6f7',
  barkLight: '#d3a97c', bark: '#bb8f63', barkDeep: '#9a7049',
  birch: '#eee8d8', birchDeep: '#b9ad9b',
  leafLight: '#a5e87e', leaf: '#7fd45f', leafDeep: '#5fb247',
  pineLight: '#83cf91', pine: '#56b97b', pineDeep: '#3c8e65',
  waterLight: '#b3ecfb', water: '#7fd6f2', waterDeep: '#4fb8e0',
  ink: '#4a4360', panel: '#fffaf4', pink: '#ff76aa', blue: '#70c9ee',
} as const;

/** Mob colours, as numbers because the model table hands them straight to three.js.
 *  Light and soft like everything else in the world, but each animal keeps the hue it is
 *  known by — a pastel spider is still unmistakably a spider, and the hostiles still read
 *  as hostile from the colour alone. */
export const MOB = {
  skin: 0xf1cba7, skinDeep: 0xdcaf88,
  pig: 0xf7b4bd, pigDeep: 0xe89dab, pigSnout: 0xe98ba0,
  cow: 0xc79a76, cowDeep: 0xb08260, cowPatch: 0xfdf4e6,
  sheep: 0xfbf5ea, sheepDeep: 0xd5c4b6,
  chicken: 0xfdf8ee, beak: 0xf8ba55, comb: 0xf4798c,
  villager: 0xc9946a, villagerTrim: 0xe3ba8f, villagerLegs: 0x99714f,
  porter: 0x7fa8d4, porterTrim: 0x9cc2e6, porterLegs: 0x5e7fac,
  zombie: 0x8fcf87, zombieShirt: 0x6fc0bd, zombieLegs: 0x8390d6,
  bone: 0xf3efe5, boneDeep: 0xdcd6c8,
  spider: 0x9070b0, spiderDeep: 0x765897, spiderLeg: 0x624a86, spiderEye: 0xff7fa8,
} as const;

export const SKY = {
  dawn: ['#ffd6b8', '#ffc7dd', '#b9d9ff'],
  day: ['#bfe9ff', '#9fd8fb', '#7fc6f5'],
  dusk: ['#ffc09a', '#ff9ec4', '#8f9fe8'],
  night: ['#2b2f5c', '#3a3f77', '#4a4f91'],
} as const;
