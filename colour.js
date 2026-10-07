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

// Find the main colour of an image (ideally a cut-out with a transparent
// background). Uses a small "k-means" clustering: group similar pixels
// together and return the biggest group's average colour.
export async function dominantColour(blob) {
  const bmp = await createImageBitmap(blob);
  const size = 80;
  const scale = Math.min(1, size / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), hgt = Math.max(1, Math.round(bmp.height * scale));
  const canvas = new OffscreenCanvas(w, hgt);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, hgt);
  bmp.close?.();
  const data = ctx.getImageData(0, 0, w, hgt).data;

  let pixels = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 200) pixels.push([data[i], data[i + 1], data[i + 2]]);
  }
  // No transparency (background not removed)? Use the middle of the photo.
  if (pixels.length > w * hgt * 0.95 || pixels.length < 20) {
    pixels = [];
    for (let y = Math.floor(hgt * 0.25); y < hgt * 0.75; y++) {
      for (let x = Math.floor(w * 0.25); x < w * 0.75; x++) {
        const i = (y * w + x) * 4;
        pixels.push([data[i], data[i + 1], data[i + 2]]);
      }
    }
  }

  const k = 3;
  let centres = [0, 0.5, 0.99].map(f => pixels[Math.floor(f * (pixels.length - 1))].slice());
  let groups = [];
  for (let iter = 0; iter < 10; iter++) {
    groups = centres.map(() => []);
    for (const p of pixels) {
      let best = 0, bestD = Infinity;
      centres.forEach((c, j) => {
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (d < bestD) { bestD = d; best = j; }
      });
      groups[best].push(p);
    }
    centres = groups.map((g, j) => g.length
      ? [0, 1, 2].map(ch => g.reduce((sum, p) => sum + p[ch], 0) / g.length)
      : centres[j]);
  }
  const biggest = groups.reduce((bi, g, j) => (g.length > groups[bi].length ? j : bi), 0);
  const [r, g, b] = centres[biggest];
  return { ...rgbToHsl(r, g, b), hex: rgbToHex(r, g, b) };
}
