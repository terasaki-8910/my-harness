export function toSlash(value) {
  return String(value).replaceAll("\\", "/");
}

/**
 * Luminance statistics of a decoded PNG ({ width, height, channels, data }).
 * Every `step`-th pixel in x and y is sampled; Y = 0.2126 R + 0.7152 G + 0.0722 B on a 0..1 scale
 * (grey images use the grey value, alpha is ignored). `white` and `black` are the fractions of
 * samples with Y > 0.97 and Y < 0.03.
 */
export function frameStats(image, { step = 4 } = {}) {
  if (!Number.isInteger(step) || step < 1) throw new Error("step must be a positive integer");
  const { width, height, channels, data } = image;
  const colour = channels >= 3;
  let count = 0;
  let sum = 0;
  let sumOfSquares = 0;
  let white = 0;
  let black = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const index = (y * width + x) * channels;
      const luminance = (colour ? 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2] : data[index]) / 255;
      count += 1;
      sum += luminance;
      sumOfSquares += luminance * luminance;
      if (luminance > 0.97) white += 1;
      if (luminance < 0.03) black += 1;
    }
  }
  if (count === 0) throw new Error("image has no pixels");
  const mean = sum / count;
  return { mean, std: Math.sqrt(Math.max(0, sumOfSquares / count - mean * mean)), white: white / count, black: black / count };
}

export function blankReason(stats, { minStd = 0.02, maxFlat = 0.98 } = {}) {
  if (stats.white >= maxFlat) return "white";
  if (stats.black >= maxFlat) return "black";
  if (stats.std < minStd) return "uniform";
  return null;
}

/** Nearest-rank percentiles of frame intervals in ms; `frames` is the number of intervals measured. */
export function intervalStats(intervals) {
  if (intervals.length === 0) throw new Error("no frame intervals were recorded");
  const sorted = [...intervals].sort((a, b) => a - b);
  const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
  return { frames: sorted.length, p50: percentile(50), p95: percentile(95), p99: percentile(99), max: sorted[sorted.length - 1] };
}
