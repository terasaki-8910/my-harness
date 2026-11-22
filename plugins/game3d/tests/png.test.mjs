import assert from "node:assert/strict";
import test from "node:test";
import zlib from "node:zlib";
import { decodePng } from "../skills/game3d/scripts/lib/png.mjs";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, body = Buffer.alloc(0)) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "latin1");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function filterRow(type, row, prior, bpp) {
  const out = Buffer.alloc(row.length);
  for (let i = 0; i < row.length; i += 1) {
    const a = i >= bpp ? row[i - bpp] : 0;
    const b = prior ? prior[i] : 0;
    const c = prior && i >= bpp ? prior[i - bpp] : 0;
    const predictor = [0, a, b, (a + b) >> 1, paeth(a, b, c)][type];
    out[i] = (row[i] - predictor) & 0xff;
  }
  return out;
}

// filters: one filter type for every row, or an array with one type per row.
function encodePng({ width, height, colourType, channels, pixels, filters = 0, bitDepth = 8, interlace = 0, idatChunks = 1, extra = [] }) {
  const stride = width * channels;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.from(pixels.subarray(y * stride, (y + 1) * stride));
    const prior = y > 0 ? Buffer.from(pixels.subarray((y - 1) * stride, y * stride)) : null;
    const type = Array.isArray(filters) ? filters[y % filters.length] : filters;
    rows.push(Buffer.concat([Buffer.from([type]), filterRow(type, row, prior, channels)]));
  }
  const compressed = zlib.deflateSync(Buffer.concat(rows));
  const pieces = [];
  const size = Math.ceil(compressed.length / idatChunks);
  for (let offset = 0; offset < compressed.length; offset += size) pieces.push(chunk("IDAT", compressed.subarray(offset, offset + size)));
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = bitDepth;
  header[9] = colourType;
  header[12] = interlace;
  return Buffer.concat([SIGNATURE, chunk("IHDR", header), ...extra, ...pieces, chunk("IEND")]);
}

function samplePixels(width, height, channels) {
  const pixels = new Uint8Array(width * height * channels);
  let seed = 12345 + channels;
  for (let i = 0; i < pixels.length; i += 1) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    pixels[i] = seed >>> 24;
  }
  return pixels;
}

const TYPES = [[0, 1], [4, 2], [2, 3], [6, 4]];
const FILTERS = ["None", "Sub", "Up", "Average", "Paeth"];

for (const [colourType, channels] of TYPES) {
  test(`decodePng round-trips colour type ${colourType} (${channels} channels) through each row filter`, () => {
    const width = 13;
    const height = 7;
    const pixels = samplePixels(width, height, channels);
    FILTERS.forEach((name, filter) => {
      const decoded = decodePng(encodePng({ width, height, colourType, channels, pixels, filters: filter }));
      assert.equal(decoded.width, width, name);
      assert.equal(decoded.height, height, name);
      assert.equal(decoded.channels, channels, name);
      assert.ok(decoded.data instanceof Uint8Array, name);
      assert.deepEqual(decoded.data, pixels, name);
    });
    const mixed = decodePng(encodePng({ width, height, colourType, channels, pixels, filters: [4, 3, 2, 1, 0, 2, 4] }));
    assert.deepEqual(mixed.data, pixels, "a different filter on every row");
  });
}

test("decodePng joins several IDAT chunks", () => {
  const pixels = samplePixels(40, 30, 3);
  for (const idatChunks of [2, 3, 50]) {
    const buffer = encodePng({ width: 40, height: 30, colourType: 2, channels: 3, pixels, filters: [1, 2, 3, 4], idatChunks });
    assert.ok(buffer.toString("latin1").split("IDAT").length - 1 >= 2);
    assert.deepEqual(decodePng(buffer).data, pixels);
  }
});

test("decodePng accepts a Uint8Array and ignores ancillary chunks", () => {
  const pixels = samplePixels(5, 4, 4);
  const buffer = encodePng({ width: 5, height: 4, colourType: 6, channels: 4, pixels, extra: [chunk("tEXt", Buffer.from("Comment\0hi"))] });
  assert.deepEqual(decodePng(new Uint8Array(buffer)).data, pixels);
});

test("decodePng rejects unsupported formats and damaged files with a message that names the problem", () => {
  const rgb = samplePixels(4, 4, 3);
  const valid = encodePng({ width: 4, height: 4, colourType: 2, channels: 3, pixels: rgb });
  const sixteen = encodePng({ width: 4, height: 4, colourType: 2, channels: 6, pixels: samplePixels(4, 4, 6), bitDepth: 16 });
  assert.throws(() => decodePng(sixteen), /bit depth 16/);
  const palette = encodePng({ width: 4, height: 4, colourType: 3, channels: 1, pixels: samplePixels(4, 4, 1), extra: [chunk("PLTE", Buffer.alloc(12))] });
  assert.throws(() => decodePng(palette), /palette/);
  assert.throws(() => decodePng(encodePng({ width: 4, height: 4, colourType: 2, channels: 3, pixels: rgb, interlace: 1 })), /interlaced/);
  assert.throws(() => decodePng(Buffer.from("not a png at all, just text")), /bad signature/);
  assert.throws(() => decodePng(Buffer.alloc(0)), /bad signature/);
  assert.throws(() => decodePng(valid.subarray(0, valid.length - 20)), /truncated/);
  assert.throws(() => decodePng(valid.subarray(0, 30)), /truncated/);
  assert.throws(() => decodePng(valid.subarray(0, valid.length - 12)), /truncated.*IEND/);
  assert.throws(() => decodePng(encodePng({ width: 4, height: 4, colourType: 2, channels: 3, pixels: rgb, filters: 7 })), /filter type 7/);
});

test("decodePng rejects image data whose size does not match the header", () => {
  const short = Buffer.concat([SIGNATURE, chunk("IHDR", Buffer.from([0, 0, 0, 4, 0, 0, 0, 4, 8, 2, 0, 0, 0])), chunk("IDAT", zlib.deflateSync(Buffer.alloc(10))), chunk("IEND")]);
  assert.throws(() => decodePng(short), /truncated/);
  const long = Buffer.concat([SIGNATURE, chunk("IHDR", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0])), chunk("IDAT", zlib.deflateSync(Buffer.alloc(20))), chunk("IEND")]);
  assert.throws(() => decodePng(long), /longer|inflated/);
  const garbage = Buffer.concat([SIGNATURE, chunk("IHDR", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0])), chunk("IDAT", Buffer.from("garbage")), chunk("IEND")]);
  assert.throws(() => decodePng(garbage), /inflated/);
});
