// Joins same-size PNG frames into one animated PNG (APNG), which GitHub and
// the VS Code Marketplace show like a GIF, in full colour. No dependencies:
// each frame's image data is copied into the APNG frame chunks as it is.
// Usage: node scripts/apng.mjs <out.png> <delay ms> <frame1.png> <frame2.png> ...
import { readFileSync, writeFileSync } from 'node:fs';

const [out, delayArg, ...frames] = process.argv.slice(2);
if (!out || !delayArg || frames.length < 2) {
  console.error('usage: node scripts/apng.mjs <out.png> <delay ms> <frame.png> <frame.png> ...');
  process.exit(1);
}
const delay = Number(delayArg);
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function readChunks(file) {
  const png = readFileSync(file);
  if (!png.subarray(0, 8).equals(SIGNATURE)) throw new Error(`${file} is not a PNG`);
  const chunks = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    const type = png.toString('ascii', at + 4, at + 8);
    chunks.push({ type, data: png.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  return chunks;
}

const parsed = frames.map(readChunks);
const ihdr = parsed[0].find((c) => c.type === 'IHDR').data;
for (const [i, chunks] of parsed.entries()) {
  if (!chunks.find((c) => c.type === 'IHDR').data.equals(ihdr)) {
    throw new Error(`${frames[i]} differs in size or format from the first frame`);
  }
}
const width = ihdr.readUInt32BE(0);
const height = ihdr.readUInt32BE(4);

const parts = [SIGNATURE, chunk('IHDR', ihdr)];
const actl = Buffer.alloc(8);
actl.writeUInt32BE(frames.length, 0); // frames
actl.writeUInt32BE(0, 4); // loop forever
parts.push(chunk('acTL', actl));

let sequence = 0;
for (const [index, chunks] of parsed.entries()) {
  const fctl = Buffer.alloc(26);
  fctl.writeUInt32BE(sequence++, 0);
  fctl.writeUInt32BE(width, 4);
  fctl.writeUInt32BE(height, 8);
  fctl.writeUInt32BE(0, 12); // x offset
  fctl.writeUInt32BE(0, 16); // y offset
  // The last frame stays up longer, so the result is easy to read.
  fctl.writeUInt16BE(index === parsed.length - 1 ? delay * 2 : delay, 20);
  fctl.writeUInt16BE(1000, 22); // delay is in milliseconds
  fctl.writeUInt8(0, 24); // dispose: none
  fctl.writeUInt8(0, 25); // blend: replace
  parts.push(chunk('fcTL', fctl));
  for (const { data } of chunks.filter((c) => c.type === 'IDAT')) {
    if (index === 0) {
      parts.push(chunk('IDAT', data));
    } else {
      const seq = Buffer.alloc(4);
      seq.writeUInt32BE(sequence++, 0);
      parts.push(chunk('fdAT', Buffer.concat([seq, data])));
    }
  }
}
parts.push(chunk('IEND', Buffer.alloc(0)));
const result = Buffer.concat(parts);
writeFileSync(out, result);
console.log(
  `${out}: ${frames.length} frames, ${width}x${height}, ${(result.length / 1024).toFixed(0)} KB`,
);
