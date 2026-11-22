// Image size from file headers only (no decoding): PNG, JPEG, WebP and KTX2.

function asBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return null;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const KTX2_IDENTIFIER = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);

function result(format, width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) return null;
  return { format, width, height };
}

function pngSize(buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (buffer.toString("latin1", 12, 16) !== "IHDR") return null;
  return result("png", buffer.readUInt32BE(16), buffer.readUInt32BE(20));
}

// Markers C0-CF are frame headers except C4 (DHT), C8 (JPG) and CC (DAC).
function isFrameMarker(marker) {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function jpegSize(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let position = 2;
  while (position < buffer.length) {
    if (buffer[position] !== 0xff) return null;
    while (position < buffer.length && buffer[position] === 0xff) position += 1;
    if (position >= buffer.length) return null;
    const marker = buffer[position];
    position += 1;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (position + 2 > buffer.length) return null;
    const length = buffer.readUInt16BE(position);
    if (length < 2) return null;
    if (isFrameMarker(marker)) {
      if (position + 7 > buffer.length) return null;
      return result("jpeg", buffer.readUInt16BE(position + 5), buffer.readUInt16BE(position + 3));
    }
    position += length;
  }
  return null;
}

function webpSize(buffer) {
  if (buffer.length < 25 || buffer.toString("latin1", 0, 4) !== "RIFF" || buffer.toString("latin1", 8, 12) !== "WEBP") return null;
  const kind = buffer.toString("latin1", 12, 16);
  if (kind === "VP8 ") {
    if (buffer.length < 30 || (buffer[20] & 1) !== 0) return null;
    if (buffer[23] !== 0x9d || buffer[24] !== 0x01 || buffer[25] !== 0x2a) return null;
    return result("webp", buffer.readUInt16LE(26) & 0x3fff, buffer.readUInt16LE(28) & 0x3fff);
  }
  if (kind === "VP8L") {
    if (buffer[20] !== 0x2f) return null;
    const bits = buffer.readUInt32LE(21);
    return result("webp", (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (kind === "VP8X" && buffer.length >= 30) return result("webp", buffer.readUIntLE(24, 3) + 1, buffer.readUIntLE(27, 3) + 1);
  return null;
}

function ktx2Size(buffer) {
  if (buffer.length < 28 || !buffer.subarray(0, 12).equals(KTX2_IDENTIFIER)) return null;
  return result("ktx2", buffer.readUInt32LE(20), buffer.readUInt32LE(24));
}

export function imageSize(data) {
  const buffer = asBuffer(data);
  if (!buffer) return null;
  return pngSize(buffer) ?? jpegSize(buffer) ?? webpSize(buffer) ?? ktx2Size(buffer);
}

export function mimeTypeForFormat(format) {
  return { png: "image/png", jpeg: "image/jpeg", webp: "image/webp", ktx2: "image/ktx2" }[format] ?? null;
}
