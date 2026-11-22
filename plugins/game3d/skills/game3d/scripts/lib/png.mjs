import zlib from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = new Map([[0, 1], [2, 3], [4, 2], [6, 4]]);
const MAX_SAMPLES = 2 ** 30;

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceUp = Math.abs(estimate - up);
  const distanceUpLeft = Math.abs(estimate - upLeft);
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left;
  return distanceUp <= distanceUpLeft ? up : upLeft;
}

function readChunks(buffer) {
  let header = null;
  let sawEnd = false;
  const data = [];
  let offset = SIGNATURE.length;
  while (offset < buffer.length && !sawEnd) {
    if (offset + 8 > buffer.length) throw new Error("PNG is truncated: the last chunk header is incomplete");
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const start = offset + 8;
    if (start + length + 4 > buffer.length) throw new Error(`PNG is truncated: the ${type} chunk is cut off`);
    const body = buffer.subarray(start, start + length);
    if (type === "IHDR") {
      if (header || length !== 13) throw new Error("PNG has a malformed IHDR chunk");
      header = {
        width: body.readUInt32BE(0), height: body.readUInt32BE(4), bitDepth: body[8], colourType: body[9],
        compression: body[10], filter: body[11], interlace: body[12],
      };
    } else if (!header) {
      throw new Error("PNG is malformed: the first chunk is not IHDR");
    } else if (type === "IDAT") {
      data.push(body);
    } else if (type === "IEND") {
      sawEnd = true;
    }
    offset = start + length + 4;
  }
  if (!header) throw new Error("PNG has no IHDR chunk");
  if (!sawEnd) throw new Error("PNG is truncated: no IEND chunk");
  return { header, data };
}

/**
 * Decode an 8-bit, non-interlaced grey, grey+alpha, RGB or RGBA PNG.
 * Chunk CRCs are not verified; a damaged stream fails when it is inflated.
 */
export function decodePng(input) {
  const buffer = ArrayBuffer.isView(input) ? Buffer.from(input.buffer, input.byteOffset, input.byteLength) : Buffer.from(input);
  if (buffer.length < SIGNATURE.length || !buffer.subarray(0, SIGNATURE.length).equals(SIGNATURE)) throw new Error("Not a PNG file: bad signature");
  const { header, data } = readChunks(buffer);
  const { width, height, bitDepth, colourType } = header;
  if (colourType === 3) throw new Error("PNG palette images (colour type 3) are not supported");
  const channels = CHANNELS.get(colourType);
  if (!channels) throw new Error(`PNG colour type ${colourType} is not valid`);
  if (bitDepth !== 8) throw new Error(`PNG bit depth ${bitDepth} is not supported (only 8-bit samples)`);
  if (header.interlace !== 0) throw new Error("PNG interlaced images (Adam7) are not supported");
  if (header.compression !== 0 || header.filter !== 0) throw new Error("PNG uses an unknown compression or filter method");
  if (width === 0 || height === 0 || width * height * channels > MAX_SAMPLES) throw new Error(`PNG size ${width}x${height} is not supported`);
  if (data.length === 0) throw new Error("PNG has no image data (IDAT chunk)");

  const stride = width * channels;
  const expected = height * (stride + 1);
  let raw;
  try {
    raw = zlib.inflateSync(Buffer.concat(data), { maxOutputLength: expected + 1 });
  } catch (error) {
    throw new Error(`PNG image data cannot be inflated: ${error.message}`);
  }
  if (raw.length < expected) throw new Error(`PNG image data is truncated: ${raw.length} of ${expected} bytes`);
  if (raw.length > expected) throw new Error(`PNG image data is longer than ${width}x${height} pixels need`);

  const out = new Uint8Array(height * stride);
  const bpp = channels;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const source = y * (stride + 1) + 1;
    const target = y * stride;
    const prior = target - stride;
    switch (filter) {
      case 0:
        for (let i = 0; i < stride; i += 1) out[target + i] = raw[source + i];
        break;
      case 1:
        for (let i = 0; i < stride; i += 1) out[target + i] = raw[source + i] + (i >= bpp ? out[target + i - bpp] : 0);
        break;
      case 2:
        for (let i = 0; i < stride; i += 1) out[target + i] = raw[source + i] + (y > 0 ? out[prior + i] : 0);
        break;
      case 3:
        for (let i = 0; i < stride; i += 1) {
          const left = i >= bpp ? out[target + i - bpp] : 0;
          const up = y > 0 ? out[prior + i] : 0;
          out[target + i] = raw[source + i] + ((left + up) >> 1);
        }
        break;
      case 4:
        for (let i = 0; i < stride; i += 1) {
          const left = i >= bpp ? out[target + i - bpp] : 0;
          const up = y > 0 ? out[prior + i] : 0;
          const upLeft = i >= bpp && y > 0 ? out[prior + i - bpp] : 0;
          out[target + i] = raw[source + i] + paeth(left, up, upLeft);
        }
        break;
      default:
        throw new Error(`PNG row ${y} has an unknown filter type ${filter}`);
    }
  }
  return { width, height, channels, data: out };
}
