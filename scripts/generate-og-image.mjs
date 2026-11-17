import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const GLYPHS = {
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  a: ['00000', '00000', '01110', '00001', '01111', '10001', '01111'],
  n: ['00000', '00000', '10110', '11001', '10001', '10001', '10001'],
  i: ['00100', '00000', '01100', '00100', '00100', '00100', '01110'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
  b: ['10000', '10000', '10110', '11001', '10001', '10001', '01110'],
  l: ['01100', '00100', '00100', '00100', '00100', '00100', '01110'],
  o: ['00000', '00000', '01110', '10001', '10001', '10001', '01110'],
  g: ['00000', '00000', '01111', '10001', '01111', '00001', '01110'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  d: ['00001', '00001', '01101', '10011', '10001', '10001', '01110'],
  e: ['00000', '00000', '01110', '10001', '11111', '10000', '01110'],
  v: ['00000', '00000', '10001', '10001', '10001', '01010', '00100'],
};

const WIDTH = 1200;
const HEIGHT = 630;
const pixels = Buffer.alloc(WIDTH * HEIGHT * 4);

function setPixel(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  const i = (y * WIDTH + x) * 4;
  pixels[i] = r;
  pixels[i + 1] = g;
  pixels[i + 2] = b;
  pixels[i + 3] = a;
}

function fill(r, g, b) {
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
    pixels[i + 3] = 255;
  }
}

function textWidth(text, scale, gap) {
  return [...text].reduce((sum, ch) => sum + (GLYPHS[ch]?.[0].length ?? 5) * scale + gap, -gap);
}

function drawText(text, x, y, scale, color) {
  let cursor = x;
  for (const ch of text) {
    const glyph = GLYPHS[ch];
    if (!glyph) continue;
    glyph.forEach((row, gy) => {
      [...row].forEach((bit, gx) => {
        if (bit !== '1') return;
        for (let py = 0; py < scale; py++) {
          for (let px = 0; px < scale; px++) {
            setPixel(cursor + gx * scale + px, y + gy * scale + py, color[0], color[1], color[2]);
          }
        }
      });
    });
    cursor += glyph[0].length * scale + Math.round(scale * 0.7);
  }
}

fill(0x1c, 0x19, 0x17);
const ink = [0xfa, 0xf7, 0xf2];
const accent = [0xe8, 0x8a, 0x4a];
const title = 'ManiG Blog';
const subtitle = 'blog.manig.dev';
const titleScale = 16;
const subScale = 5;
const titleW = textWidth(title, titleScale, Math.round(titleScale * 0.7));
const subW = textWidth(subtitle, subScale, Math.round(subScale * 0.7));
const titleX = Math.round((WIDTH - titleW) / 2);
const titleY = 230;
drawText(title, titleX, titleY, titleScale, ink);
const ruleY = titleY + 7 * titleScale + 28;
const ruleW = 72;
for (let x = Math.round((WIDTH - ruleW) / 2); x < Math.round((WIDTH + ruleW) / 2); x++) {
  setPixel(x, ruleY, accent[0], accent[1], accent[2]);
  setPixel(x, ruleY + 1, accent[0], accent[1], accent[2]);
}
drawText(subtitle, Math.round((WIDTH - subW) / 2), ruleY + 28, subScale, [0xd6, 0xd3, 0xd1]);

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

const raw = Buffer.alloc((WIDTH * 4 + 1) * HEIGHT);
for (let y = 0; y < HEIGHT; y++) {
  raw[y * (WIDTH * 4 + 1)] = 0;
  pixels.copy(raw, y * (WIDTH * 4 + 1) + 1, y * WIDTH * 4, (y + 1) * WIDTH * 4);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(WIDTH, 0);
ihdr.writeUInt32BE(HEIGHT, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = new URL('../client/public/og-default.png', import.meta.url);
writeFileSync(out, png);
console.log(`wrote ${out.pathname} (${png.length} bytes)`);
