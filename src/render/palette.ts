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

export const SKY = {
  dawn: ['#ffd6b8', '#ffc7dd', '#b9d9ff'],
  day: ['#bfe9ff', '#9fd8fb', '#7fc6f5'],
  dusk: ['#ffc09a', '#ff9ec4', '#8f9fe8'],
  night: ['#2b2f5c', '#3a3f77', '#4a4f91'],
} as const;
