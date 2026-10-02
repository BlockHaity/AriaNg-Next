// Generates the PWA icon set (no external image dependencies).
// Run: node scripts/generate-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const BG = [0x67, 0x50, 0xa4]; // M3 primary
const FG = [0xff, 0xff, 0xff];

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Draws a rounded-square "download arrow into a tray" glyph. */
function pixel(x, y, size) {
  const u = x / size;
  const v = y / size;
  const cx = u - 0.5;
  const cy = v - 0.5;
  // rounded square mask (radius 22%)
  const r = 0.22;
  const qx = Math.max(Math.abs(cx) - (0.5 - r), 0);
  const qy = Math.max(Math.abs(cy) - (0.5 - r), 0);
  if (Math.hypot(qx, qy) > r) return null;

  const inArrowShaft = Math.abs(cx) < 0.075 && cy > -0.24 && cy < 0.08;
  const inArrowHead =
    cy >= 0.02 && cy < 0.24 && Math.abs(cx) < (0.24 - (cy - 0.02)) * 1.0 + 0.075;
  const inTray = cy > 0.26 && cy < 0.355 && Math.abs(cx) < 0.235;
  if (inArrowShaft || inArrowHead || inTray) return FG;
  return BG;
}

function png(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const c = pixel(x, y, size);
      if (c === null) {
        raw[p++] = 0;
        raw[p++] = 0;
        raw[p++] = 0;
        raw[p++] = 0;
      } else {
        raw[p++] = c[0];
        raw[p++] = c[1];
        raw[p++] = c[2];
        raw[p++] = 0xff;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public', { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(`public/pwa-${size}x${size}.png`, png(size));
}
writeFileSync('public/apple-touch-icon.png', png(180));
writeFileSync('public/favicon.ico', png(32));
console.log('icons written');
