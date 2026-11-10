import test from 'node:test';
import assert from 'node:assert/strict';

import {
  quantize,
  createColorModel,
  smoothSpatialIndices,
  TRANSPARENT_INDEX,
} from '../src/quantize.js';
import { rgbToLab, labDistance } from '../src/color.js';

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

test('相近色合并：远色不会被链式带入，颜色数单调不增', () => {
  const colors = [
    [255, 0, 0],
    [252, 0, 0],
    [250, 0, 0],
    [240, 0, 0],
    [230, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
  ];
  const image = makeImage(colors, colors.length, 1);
  const thresholds = [0, 1, 2, 3, 5, 10, 20, 30, 100];
  let previous = Number.POSITIVE_INFINITY;
  const counts = [];
  for (const threshold of thresholds) {
    const result = quantize(image, { threshold, spatial: false });
    assert.ok(result.colorCount <= previous, `阈值 ${threshold} 颜色数反增：${result.colorCount}`);
    previous = result.colorCount;
    counts.push(result.colorCount);
    // 绿色、蓝色与红色都在 170 ΔE 以上，任何阈值下都不能进入红色簇。
    const farIndices = new Set([result.indices[5], result.indices[6]]);
    for (let i = 0; i < 5; i += 1) {
      assert.ok(!farIndices.has(result.indices[i]), `阈值 ${threshold}：远色被并入红色`);
    }
  }
  assert.equal(counts[0], colors.length);
  assert.ok(counts[1] >= colors.length - 1, `阈值 1 不应大量合并：${counts[1]} 色`);

  // 阈值 10 时五种红色两两最大相差 9.41，应合成一簇；远色仍是独立簇。
  const merged = quantize(image, { threshold: 10, spatial: false });
  for (let i = 1; i < 5; i += 1) {
    assert.equal(merged.indices[i], merged.indices[0], `红色 ${i} 未合并`);
  }
  assert.notEqual(merged.indices[5], merged.indices[0]);
  assert.notEqual(merged.indices[6], merged.indices[0]);
  assert.equal(merged.colorCount, 3);
});

test('链式反例：A~B、B~C 在阈值内但 A~C 超阈值时不会同簇', () => {
  // 三个灰色在 LAB 中近似共线：相邻约 1.56，首尾约 3.12。
  const colors = [[128, 128, 128], [132, 132, 132], [136, 136, 136]];
  const labs = colors.map((color) => rgbToLab(...color));
  const ab = labDistance(labs[0], labs[1]);
  const bc = labDistance(labs[1], labs[2]);
  const ac = labDistance(labs[0], labs[2]);
  assert.ok(ab < 3 && bc < 3, '相邻色应在阈值内');
  assert.ok(ac > 3, '首尾色应超过阈值');

  const image = makeImage(colors, 3, 1);
  const result = quantize(image, { threshold: 3, spatial: false });
  assert.notEqual(result.indices[0], result.indices[2], 'A 与 C 被链式合并');
  assert.ok(result.colorCount >= 2);
});

test('随机颜色：每个最终簇内任意两色的 ΔE 都不超过阈值', () => {
  let seed = 20260214;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const pixels = [];
  for (let i = 0; i < 64; i += 1) {
    pixels.push([Math.floor(random() * 256), Math.floor(random() * 256), Math.floor(random() * 256)]);
  }
  const image = makeImage(pixels, 8, 8);
  const labs = pixels.map((pixel) => rgbToLab(...pixel));

  for (const threshold of [1, 3, 7, 15, 40]) {
    const result = quantize(image, { threshold, spatial: false });
    const groups = new Map();
    for (let i = 0; i < pixels.length; i += 1) {
      const paletteIndex = result.indices[i];
      const members = groups.get(paletteIndex);
      if (members) members.push(i);
      else groups.set(paletteIndex, [i]);
    }
    for (const members of groups.values()) {
      for (let i = 0; i < members.length; i += 1) {
        for (let j = i + 1; j < members.length; j += 1) {
          const distance = labDistance(labs[members[i]], labs[members[j]]);
          assert.ok(
            distance <= threshold + 1e-6,
            `阈值 ${threshold}：同簇两色相差 ${distance.toFixed(3)}`,
          );
        }
      }
    }
  }
});

test('精确颜色超过 7000：阈值 1 不启用近似，合并数量受限', () => {
  // 8400 种唯一颜色，覆盖 21×20×20 的 RGB 网格。
  const colors = [];
  for (let i = 0; i < 21 * 20 * 20; i += 1) {
    colors.push([
      (i % 21) * 12,
      (Math.floor(i / 21) % 20) * 12,
      (Math.floor(i / 420) % 20) * 12,
    ]);
  }
  const image = makeImage(colors, 100, 84);

  const precise = quantize(image, { threshold: 1, spatial: false });
  assert.equal(precise.approximate, false, '阈值 1 不应启用预聚合');
  const merged = colors.length - precise.colorCount;
  assert.ok(merged <= 800, `阈值 1 合并了 ${merged} 色，超出合理范围`);
  assert.ok(precise.colorCount >= 7000, `阈值 1 颜色数过低：${precise.colorCount}`);

  // 阈值 2 仍精确；阈值 3 才允许近似加速。
  assert.equal(quantize(image, { threshold: 2, spatial: false }).approximate, false);
  const approximate = quantize(image, { threshold: 3, spatial: false });
  assert.equal(approximate.approximate, true);
  assert.ok(approximate.colorCount < precise.colorCount);
});

test('区域联动：孤立散点并入相近邻域主色，成片区域不受影响', () => {
  const width = 16;
  const height = 16;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) data[i * 4 + 3] = 255;

  const background = { r: 0, g: 0, b: 255 };
  const closeColor = { r: 2, g: 2, b: 255 };
  assert.ok(
    labDistance(
      rgbToLab(background.r, background.g, background.b),
      rgbToLab(closeColor.r, closeColor.g, closeColor.b),
    ) < 3,
  );

  const indices = new Uint32Array(width * height); // 全部是背景簇 0
  const noisePixels = [[2, 2], [13, 2], [2, 13], [13, 13]];
  for (const [x, y] of noisePixels) indices[y * width + x] = 1;
  // 4×4 的成片区域，内部和边缘像素都有同簇邻居，不应被改动。
  for (let y = 6; y < 10; y += 1) {
    for (let x = 6; x < 10; x += 1) indices[y * width + x] = 1;
  }

  const before = indices.reduce((sum, value) => sum + (value === 1 ? 1 : 0), 0);
  const smoothed = smoothSpatialIndices(
    { width, height, data },
    indices,
    [background, closeColor],
    10,
  );
  assert.equal(smoothed.moved, noisePixels.length, '应只移动四个孤立像素');
  for (const [x, y] of noisePixels) assert.equal(smoothed.indices[y * width + x], 0);
  for (let y = 6; y < 10; y += 1) {
    for (let x = 6; x < 10; x += 1) assert.equal(smoothed.indices[y * width + x], 1);
  }
  const after = smoothed.indices.reduce((sum, value) => sum + (value === 1 ? 1 : 0), 0);
  assert.equal(after, before - noisePixels.length, '成片区域不应被改动');
});

test('区域联动：噪点图减少孤立像素，大块区域颜色不变', () => {
  const width = 48;
  const height = 48;
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 99;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      // 左半是纯色大块，右半是带噪点的相近红色。
      const color = x < width / 2 ? [0, 0, 255] : [255, Math.floor(random() * 40), Math.floor(random() * 40)];
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = 255;
    }
  }
  const image = { width, height, data };
  const off = quantize(image, { threshold: 4, spatial: false });
  const on = quantize(image, { threshold: 4, spatial: true });
  assert.equal(off.spatial, false);
  assert.equal(on.spatial, true);
  assert.ok(on.spatialMoved > 0, '噪点区域应有孤立像素被并入邻域');

  let changed = 0;
  let blockChanged = 0;
  for (let i = 0; i < width * height; i += 1) {
    const before = off.palette[off.indices[i]];
    const after = on.palette[on.indices[i]];
    if (before?.hex !== after?.hex) {
      changed += 1;
      if (i % width < width / 2) blockChanged += 1;
    }
  }
  assert.ok(changed > 0, '区域联动应改变部分零散像素');
  assert.equal(blockChanged, 0, '大块纯色区域不应被改动');
  assert.ok(on.colorCount <= off.colorCount);
});

test('区域联动：棋盘格与交错图案不会被抹平', () => {
  const width = 8;
  const height = 8;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) data[i * 4 + 3] = 255;
  const indices = new Uint32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) indices[y * width + x] = (x + y) % 2;
  }
  const palette = [{ r: 0, g: 0, b: 255 }, { r: 2, g: 2, b: 255 }];
  const smoothed = smoothSpatialIndices({ width, height, data }, indices, palette, 10);
  assert.equal(smoothed.moved, 0);
  assert.deepEqual(Array.from(smoothed.indices), Array.from(indices));
});

test('阈值 0 不合并，区域联动也不生效', () => {
  const image = makeImage(COLORS, COLORS.length, 1);
  const result = quantize(image, { threshold: 0, spatial: true });
  assert.equal(result.spatial, false);
  assert.equal(result.spatialMoved, 0);
  assert.equal(result.colorCount, new Set(COLORS.map((color) => color.join(','))).size);

  const indices = new Uint32Array([0, 1, 0, 1, 0]);
  const palette = [{ r: 0, g: 0, b: 0 }, { r: 2, g: 2, b: 2 }];
  const smoothed = smoothSpatialIndices(image, indices, palette, 0);
  assert.equal(smoothed.moved, 0);
  assert.deepEqual(Array.from(smoothed.indices), Array.from(indices));
});

test('区域联动开关：关闭时报告未启用，开启时报告平滑结果', () => {
  const image = makeImage(COLORS, COLORS.length, 1);
  const off = quantize(image, { threshold: 5, spatial: false });
  assert.equal(off.spatial, false);
  assert.equal(off.spatialMoved, 0);

  const on = quantize(image, { threshold: 5, spatial: true });
  assert.equal(on.spatial, true);
  assert.equal(typeof on.spatialMoved, 'number');
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
