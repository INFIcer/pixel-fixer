import test from 'node:test';
import assert from 'node:assert/strict';

import { quantize, createColorModel, TRANSPARENT_INDEX } from '../src/quantize.js';
import { rgbToLab } from '../src/color.js';

function makeImage(pixels, width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 1) {
    const color = pixels[i];
    data[i * 4] = color[0];
    data[i * 4 + 1] = color[1];
    data[i * 4 + 2] = color[2];
    data[i * 4 + 3] = color[3] ?? 255;
  }
  return { width, height, data };
}

const COLORS = [
  [255, 0, 0],
  [240, 0, 0],
  [225, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
];

test('阈值 0：精确颜色不合并', () => {
  const image = makeImage(COLORS, COLORS.length, 1);
  const result = quantize(image, { mode: 'threshold', threshold: 0 });
  assert.equal(result.colorCount, 5);
  assert.equal(result.palette.length, 5);
  for (const color of COLORS) {
    const hex = `#${color.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
    assert.ok(result.palette.some((entry) => entry.hex === hex), hex);
  }
});

test('阈值模式：颜色数量随阈值单调不增', () => {
  const pixels = [];
  // 构造带频率差异的多簇颜色（红、绿、蓝、灰）。
  for (let i = 0; i < 20; i += 1) pixels.push([250 - (i % 6) * 6, (i % 4) * 8, (i % 3) * 10]);
  for (let i = 0; i < 10; i += 1) pixels.push([10, 220 - i * 8, 20 + i]);
  for (let i = 0; i < 8; i += 1) pixels.push([20 + i, 30, 230 - i * 10]);
  for (let i = 0; i < 4; i += 1) pixels.push([128, 128, 128]);
  const image = makeImage(pixels, 8, Math.ceil(pixels.length / 8));
  // 只量化有效像素；最后一行补透明。
  for (let i = pixels.length; i < image.width * image.height; i += 1) {
    image.data[i * 4 + 3] = 0;
  }

  const thresholds = [0, 1, 2, 4, 8, 16, 32, 64, 100];
  let previous = Number.POSITIVE_INFINITY;
  const counts = [];
  for (const threshold of thresholds) {
    const result = quantize(image, { mode: 'threshold', threshold });
    assert.ok(result.colorCount <= previous, `阈值 ${threshold} 颜色数反增：${result.colorCount} > ${previous}`);
    previous = result.colorCount;
    counts.push(result.colorCount);
  }
  assert.equal(counts[0], new Set(pixels.map((p) => p.join(','))).size);
  assert.ok(counts[counts.length - 1] < counts[0]);
});

test('阈值 0：像素索引映射到与源像素完全相同的 HEX', () => {
  const image = makeImage([
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [12, 34, 56],
  ], 4, 1);
  const result = quantize(image, { threshold: 0 });
  const sourceHex = ['#ff0000', '#00ff00', '#0000ff', '#0c2238'];
  for (let i = 0; i < 4; i += 1) {
    const index = result.indices[i];
    assert.notEqual(index, TRANSPARENT_INDEX);
    assert.equal(result.palette[index].hex, sourceHex[i]);
  }
});

test('阈值合并后同一簇的像素映射一致', () => {
  const image = makeImage([
    [255, 0, 0],
    [255, 0, 0],
    [250, 2, 2],
    [0, 0, 255],
  ], 4, 1);
  const result = quantize(image, { threshold: 20 });
  assert.equal(result.indices[0], result.indices[1]);
  assert.equal(result.indices[1], result.indices[2]);
  assert.notEqual(result.indices[2], result.indices[3]);
});

test('目标颜色数：结果不超过 N，且索引合法', () => {
  const pixels = [];
  for (let i = 0; i < 64; i += 1) {
    pixels.push([(i * 37) % 256, (i * 71) % 256, (i * 113) % 256]);
  }
  const image = makeImage(pixels, 8, 8);
  const result = quantize(image, { mode: 'target', maxColors: 5 });
  assert.ok(result.colorCount >= 1);
  assert.ok(result.colorCount <= 5, `实际 ${result.colorCount}`);
  for (const index of result.indices) assert.ok(index < result.palette.length);
});

test('透明度：透明像素不进入调色板，占比按可见像素计算', () => {
  const image = makeImage([
    [255, 0, 0, 255],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 255, 180],
  ], 2, 2);
  const result = quantize(image, { threshold: 0 });
  assert.equal(result.transparentPixels, 2);
  assert.equal(result.opaquePixels, 2);
  assert.equal(result.palette.length, 2);
  assert.equal(result.indices[1], TRANSPARENT_INDEX);
  const total = result.palette.reduce((sum, entry) => sum + entry.count, 0);
  assert.equal(total, 2);
  for (const entry of result.palette) assert.equal(entry.ratio, 0.5);
});

test('Floyd–Steinberg 抖动只改变索引，调色板颜色保持合法', () => {
  const pixels = [];
  for (let i = 0; i < 16; i += 1) pixels.push([128 + (i % 4) * 16, 128, 128]);
  const image = makeImage(pixels, 4, 4);
  const base = quantize(image, { threshold: 20 });
  const dithered = quantize(image, { threshold: 20, dither: true });
  assert.equal(dithered.palette.length, base.palette.length);
  assert.equal(dithered.indices.length, 16);
  for (const index of dithered.indices) {
    assert.ok(index < dithered.palette.length);
  }
});

test('阈值 0~100 全扫描：颜色数单调不增且阈值 0 精确', () => {
  let seed = 987654321;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const pixels = [];
  for (let i = 0; i < 48; i += 1) {
    pixels.push([Math.floor(random() * 256), Math.floor(random() * 256), Math.floor(random() * 256)]);
  }
  const image = makeImage(pixels, 8, 6);
  const exact = new Set(pixels.map((pixel) => pixel.join(','))).size;

  let previous = Number.POSITIVE_INFINITY;
  for (let threshold = 0; threshold <= 100; threshold += 2) {
    const result = quantize(image, { mode: 'threshold', threshold });
    assert.ok(result.colorCount <= previous, `阈值 ${threshold}：${result.colorCount} > ${previous}`);
    assert.ok(result.colorCount >= 1, `阈值 ${threshold} 颜色数应至少为 1`);
    previous = result.colorCount;
    if (threshold === 0) assert.equal(result.colorCount, exact);
  }
});

test('负阈值按 0 处理，超过 100 按 100 处理', () => {
  const image = makeImage(COLORS, COLORS.length, 1);
  assert.equal(quantize(image, { threshold: -10 }).colorCount, 5);
  const high = quantize(image, { threshold: 1000 });
  assert.equal(high.threshold, 100);
  assert.ok(high.colorCount >= 1);
});

test('目标颜色数：N=1 时结果只有一种颜色', () => {
  const pixels = [[10, 20, 30], [200, 30, 40], [30, 200, 50], [60, 70, 210]];
  const image = makeImage(pixels, 4, 1);
  const result = quantize(image, { mode: 'target', maxColors: 1 });
  assert.equal(result.colorCount, 1);
  for (const index of result.indices) assert.equal(index, 0);
});

test('网格并查集聚类与暴力单链接结果一致', () => {
  let seed = 20260101;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const colors = [];
  for (let i = 0; i < 36; i += 1) {
    colors.push([Math.floor(random() * 256), Math.floor(random() * 256), Math.floor(random() * 256)]);
  }
  const image = makeImage(colors, 6, 6);
  const labs = colors.map((color) => rgbToLab(...color));

  function bruteForceCount(threshold) {
    const seen = new Uint8Array(colors.length);
    let count = 0;
    for (let i = 0; i < colors.length; i += 1) {
      if (seen[i]) continue;
      count += 1;
      const queue = [i];
      seen[i] = 1;
      while (queue.length) {
        const current = queue.pop();
        for (let j = 0; j < colors.length; j += 1) {
          if (seen[j]) continue;
          const dl = labs[current][0] - labs[j][0];
          const da = labs[current][1] - labs[j][1];
          const db = labs[current][2] - labs[j][2];
          if (dl * dl + da * da + db * db < threshold * threshold) {
            seen[j] = 1;
            queue.push(j);
          }
        }
      }
    }
    return count;
  }

  for (const threshold of [0.1, 1, 3, 7, 15, 40, 90]) {
    const result = quantize(image, { threshold });
    assert.equal(result.colorCount, bruteForceCount(threshold), `阈值 ${threshold}`);
  }
});

test('颜色模型可复用，重复量化结果一致', () => {
  const image = makeImage(COLORS, COLORS.length, 1);
  const model = createColorModel(image);
  assert.equal(model.entries.length, 5);
  const first = quantize(image, { threshold: 30, model });
  const second = quantize(image, { threshold: 30, model });
  assert.equal(first.colorCount, second.colorCount);
  assert.deepEqual(Array.from(first.indices), Array.from(second.indices));
});
