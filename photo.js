// Photos: shrink them, remove the background in the browser, and tidy up
// the cut-out. Background removal uses IMG.LY's free open-source model,
// which runs on your phone. It downloads once (~40 MB) and is then cached.

const BG_REMOVAL_URL = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm';
const MAX_INPUT = 1024;   // photo size sent to the model (pixels)
const MAX_SAVED = 600;    // size of the saved cut-out (pixels)

let libPromise;
const loadLib = () => (libPromise ||= import(BG_REMOVAL_URL).catch(e => { libPromise = null; throw e; }));

async function toCanvas(blob, maxSide) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return canvas;
}

const canvasToBlob = (canvas, type, quality) =>
  new Promise(resolve => canvas.toBlob(resolve, type, quality));

// Shrink a camera photo so it's quick to process and small to store.
export async function prepare(file, maxSide = MAX_INPUT) {
  return canvasToBlob(await toCanvas(file, maxSide), 'image/jpeg', 0.88);
}

// Remove the background, then crop to the item and shrink it.
export async function cutOut(blob, onStatus = () => {}) {
  onStatus('Loading background remover…');
  const { removeBackground } = await loadLib();
  const result = await removeBackground(blob, {
    model: 'isnet_quint8',
    output: { format: 'image/png' },
    progress: (key, current, total) => {
      if (key.startsWith('fetch') && total) {
        onStatus(`Downloading cut-out model (first time only): ${Math.round((current / total) * 100)}%`);
      } else if (key.startsWith('compute')) {
        onStatus('Removing background…');
      }
    },
  });
  onStatus('Tidying up…');
  return trimTransparent(result);
}

// Crop away empty transparent edges so every item fills its space on the card.
async function trimTransparent(blob) {
  const src = await toCanvas(blob, 4096);
  const { width: w, height: h } = src;
  const data = src.getContext('2d').getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 20) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('nothing was found in the photo');
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  const scale = Math.min(1, MAX_SAVED / Math.max(cw, ch));
  const out = document.createElement('canvas');
  out.width = Math.round(cw * scale);
  out.height = Math.round(ch * scale);
  out.getContext('2d').drawImage(src, minX, minY, cw, ch, 0, 0, out.width, out.height);
  // WebP keeps transparency and is much smaller than PNG.
  const webp = await canvasToBlob(out, 'image/webp', 0.85);
  return webp && webp.type === 'image/webp' ? webp : canvasToBlob(out, 'image/png');
}

// "Keep the original background" option: just a smaller copy of the photo.
export async function keepOriginal(blob) {
  return canvasToBlob(await toCanvas(blob, MAX_SAVED), 'image/jpeg', 0.85);
}
