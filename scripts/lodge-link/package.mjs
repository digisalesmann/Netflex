#!/usr/bin/env node
// Packs apps/lodge-link into apps/web/public/downloads/lodge-link.zip, so the office
// can offer it for download. Runs during the build; no zip tool needed.
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '../..');
const src = join(root, 'apps/lodge-link');
const out = join(root, 'apps/web/public/downloads/lodge-link.zip');
const SKIP =
  /(^|\/)(node_modules|lodge-link\.json|lodge-link\.log.*|.*\.test\.ts|fake-controller\.mjs)$/;

function files(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    const rel = relative(src, p);
    if (SKIP.test(rel)) return [];
    return statSync(p).isDirectory() ? files(p) : [rel];
  });
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (b) => {
  let c = -1;
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

const local = [];
const central = [];
let offset = 0;
for (const rel of files(src).sort()) {
  const data = readFileSync(join(src, rel));
  const comp = deflateRawSync(data, { level: 9 });
  const name = Buffer.from(`lodge-link/${rel.split('\\').join('/')}`);
  const crc = crc32(data);
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(20, 4);
  h.writeUInt16LE(0x0800, 6); // UTF-8 names
  h.writeUInt16LE(8, 8); // deflate
  h.writeUInt16LE(0, 10);
  h.writeUInt16LE(0x5b21, 12); // fixed date: reproducible zips
  h.writeUInt32LE(crc, 14);
  h.writeUInt32LE(comp.length, 18);
  h.writeUInt32LE(data.length, 22);
  h.writeUInt16LE(name.length, 26);
  local.push(h, name, comp);
  const c = Buffer.alloc(46);
  c.writeUInt32LE(0x02014b50, 0);
  c.writeUInt16LE(20, 4);
  c.writeUInt16LE(20, 6);
  c.writeUInt16LE(0x0800, 8);
  c.writeUInt16LE(8, 10);
  c.writeUInt16LE(0, 12);
  c.writeUInt16LE(0x5b21, 14);
  c.writeUInt32LE(crc, 16);
  c.writeUInt32LE(comp.length, 20);
  c.writeUInt32LE(data.length, 24);
  c.writeUInt16LE(name.length, 28);
  c.writeUInt32LE(offset, 42);
  central.push(c, name);
  offset += 30 + name.length + comp.length;
}
const cd = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(central.length / 2, 8);
end.writeUInt16LE(central.length / 2, 10);
end.writeUInt32LE(cd.length, 12);
end.writeUInt32LE(offset, 16);
mkdirSync(join(out, '..'), { recursive: true });
writeFileSync(out, Buffer.concat([...local, cd, end]));
console.log(`lodge-link.zip: ${central.length / 2} files`);
