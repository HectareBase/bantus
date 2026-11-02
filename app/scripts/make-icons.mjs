// 開発用：assets/icon.svg から、アプリのアイコン（assets/icon.ico と assets/icon.png）を作る。Electron で動かす（npm run icons）
// 小さいサイズ（24px 以下）は、点と線を太くした assets/icon-small.svg から描く
import { app, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const assets = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const SMALL_MAX = 24;

/** SVG を canvas に描いて、指定の大きさの PNG と、生の画素（RGBA）を返す */
async function render(w, svg, size) {
  const url = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const r = await w.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = ${size};
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, ${size}, ${size});
      resolve({ png: c.toDataURL('image/png'), rgba: Array.from(g.getImageData(0, 0, ${size}, ${size}).data) });
    };
    img.onerror = () => reject(new Error('SVG を読み込めません'));
    img.src = ${JSON.stringify(url)};
  })`);
  return { png: Buffer.from(r.png.split(',')[1], 'base64'), rgba: Buffer.from(r.rgba) };
}

/** ICO に入れる BMP（DIB）。下の行から、BGRA の順に並べ、最後に透過用のマスク（すべて 0）を付ける */
function dib(size, rgba) {
  const head = Buffer.alloc(40);
  head.writeUInt32LE(40, 0);
  head.writeInt32LE(size, 4);
  head.writeInt32LE(size * 2, 8);
  head.writeUInt16LE(1, 12);
  head.writeUInt16LE(32, 14);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4;
      const to = ((size - 1 - y) * size + x) * 4;
      pixels[to] = rgba[from + 2];
      pixels[to + 1] = rgba[from + 1];
      pixels[to + 2] = rgba[from];
      pixels[to + 3] = rgba[from + 3];
    }
  }
  const mask = Buffer.alloc(Math.ceil(size / 32) * 4 * size);
  return Buffer.concat([head, pixels, mask]);
}

/** ICO を作る。256px は PNG のまま、それより小さいものは古い読み込み方でも読めるよう BMP で入れる */
function buildIco(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  const bodies = images.map(({ size, png, rgba }) => (size >= 256 ? png : dib(size, rgba)));
  images.forEach(({ size }, i) => {
    const e = 6 + 16 * i;
    const body = bodies[i];
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(body.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += body.length;
  });
  return Buffer.concat([header, ...bodies]);
}

app.whenReady().then(async () => {
  const large = readFileSync(join(assets, 'icon.svg'), 'utf8');
  const small = readFileSync(join(assets, 'icon-small.svg'), 'utf8');
  const w = new BrowserWindow({ show: false });
  await w.loadURL('about:blank');
  const images = [];
  for (const size of SIZES) images.push({ size, ...(await render(w, size <= SMALL_MAX ? small : large, size)) });
  writeFileSync(join(assets, 'icon.ico'), buildIco(images));
  writeFileSync(join(assets, 'icon.png'), images.find((i) => i.size === 256).png);
  console.log(`作りました：${join(assets, 'icon.ico')}、icon.png`);
  app.quit();
});
