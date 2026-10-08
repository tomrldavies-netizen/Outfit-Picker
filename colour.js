// Colour helpers: convert between formats, sort colours into neutral
// families, and find the main colour in a photo.
import { RULES } from './settings.js';

export const FAMILIES = ['black', 'white', 'grey', 'navy', 'beige', 'brown', 'denim', 'coloured'];

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  return rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}

// How far apart two hues are on the colour wheel (0-180 degrees).
export function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

const inRange = (v, min = -Infinity, max = Infinity) => v >= min && v <= max;

// Sort a colour into black / white / grey / navy / beige / brown / denim,
// or "coloured". Thresholds live in settings.js.
export function classifyColour({ h, s, l }) {
  const N = RULES.colour.neutrals;
  if (l <= N.blackMaxL) return 'black';
  if (s <= N.greyMaxS) return l >= N.whiteMinL ? 'white' : 'grey';
  if (l >= 94) return 'white';
  if (inRange(h, N.navy.hMin, N.navy.hMax) && l <= N.navy.lMax && s >= N.navy.sMin) return 'navy';
  if (inRange(h, N.denim.hMin, N.denim.hMax) && inRange(s, N.denim.sMin, N.denim.sMax) && inRange(l, N.denim.lMin, N.denim.lMax)) return 'denim';
  if (inRange(h, N.brown.hMin, N.brown.hMax) && inRange(s, N.brown.sMin, N.brown.sMax) && inRange(l, N.brown.lMin, N.brown.lMax)) return 'brown';
  if (inRange(h, N.beige.hMin, N.beige.hMax) && inRange(s, N.beige.sMin, N.beige.sMax) && inRange(l, N.beige.lMin, N.beige.lMax)) return 'beige';
  return 'coloured';
}

// The family you corrected by hand wins; otherwise it's worked out from the colour.
export function colourFamily(colour) {
  if (!colour) return 'grey';
  return colour.override || classifyColour(colour);
}

// A friendly name for a hue, used when an item has no name.
export function hueName({ h, s, l }) {
  if (s < 15) return l > 70 ? 'light grey' : l < 30 ? 'charcoal' : 'grey';
  const names = [[15, 'red'], [40, 'orange'], [65, 'yellow'], [160, 'green'], [195, 'teal'], [255, 'blue'], [290, 'purple'], [335, 'pink'], [360, 'red']];
  return names.find(([max]) => h < max)[1];
}

export function describeColour(colour) {
  const fam = colourFamily(colour);
  return fam === 'coloured' ? hueName(colour) : fam;
}

// Convert to "Lab", a colour space where distances match how different
// two colours look to people. L = lightness, a = green↔red, b = blue↔yellow.
export function rgbToLab(r, g, b) {
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const R = lin(r), G = lin(g), B = lin(b);
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
  const fy = f(R * 0.2126 + G * 0.7152 + B * 0.0722);
  const fz = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
