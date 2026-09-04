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
  eyeRed: 0xff6d78, eyeBlue: 0x86d9ff, eyeDark: 0x4a3d4c,
  pig: 0xf7b4bd, pigDeep: 0xe89dab, pigSnout: 0xe98ba0,
  cow: 0xc79a76, cowDeep: 0xb08260, cowPatch: 0xfdf4e6, cowHorn: 0xf5e0ad,
  sheep: 0xfbf5ea, sheepDeep: 0xd5c4b6,
  cat: 0xd18a68, catDeep: 0x765b5b, catEye: 0x9de36d,
  dog: 0xc8956f, dogDeep: 0x7f594f, dogCollar: 0x6d9fd1,
  fox: 0xe8844f, foxDeep: 0xfdf0d8, foxLeg: 0xb95d3d,
  rabbit: 0xe3c9bd, rabbitDeep: 0xb99d98, rabbitEar: 0xf09eae,
  camel: 0xc69b62, camelDeep: 0x9d7446,
  chicken: 0xfdf8ee, chickenWing: 0xe4d9cd, beak: 0xf8ba55, comb: 0xf4798c,
  villager: 0xc9946a, villagerTrim: 0xe3ba8f, villagerLegs: 0x99714f,
  porter: 0x7fa8d4, porterTrim: 0x9cc2e6, porterLegs: 0x5e7fac,
  zombie: 0x8fcf87, zombieShirt: 0x6fc0bd, zombieLegs: 0x8390d6,
  bone: 0xf3efe5, boneDeep: 0xdcd6c8,
  spider: 0x9070b0, spiderDeep: 0x765897, spiderLeg: 0x624a86, spiderEye: 0xff7fa8,
} as const;

/** The people of the world, as the ranges the specs in `people.ts` pick from.
 *
 *  Ranges rather than named colours, because what matters is that a street holds a
 *  variety and not that any one person is a particular brown. Skin tones are four across
 *  a warm range; hair runs black to grey by way of the browns and one fair; the coats are
 *  the dyed wools a place like this would actually have. */
export const PEOPLE = {
  skin: [0xf1cba7, 0xe0b088, 0xc08d63, 0x8c6242],
  nose: 0xdcaf88,
  hair: [0x4a3a30, 0x2f2a2c, 0x6b4a34, 0xc9a262, 0xd9d4cc, 0xa9a29b],
  coat: [
    0xc9946a, 0x8f7f6d, 0x9a6f86, 0xe0a45c, 0x7fa8d4, 0xb0708a,
    0x6f9e7a, 0x5e7fac, 0xd0a3b4, 0x7d7495, 0x9c6f52, 0x6d8fa8,
  ],
  trim: [0xe3ba8f, 0xd8cfc2, 0xf0d5b0, 0xffe1a8, 0xcfe3f2],
  legs: [0x99714f, 0x6a6270, 0x8a7f9a, 0x5c5a72],
  cap: 0x5e7fac,
  straw: 0xe3c98d,
  scarf: 0xd7a0b4,
  apron: 0xf3ead6,
  satchel: 0x8a6a4d,
  strap: 0x6b5340,
  stick: 0xa8794b,
  basket: 0xd8b782,
} as const;

export const SKY = {
  dawn: ['#ffd6b8', '#ffc7dd', '#b9d9ff'],
  day: ['#bfe9ff', '#9fd8fb', '#7fc6f5'],
  dusk: ['#ffc09a', '#ff9ec4', '#8f9fe8'],
  night: ['#2b2f5c', '#3a3f77', '#4a4f91'],
} as const;
