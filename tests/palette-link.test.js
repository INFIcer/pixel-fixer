import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LARGE_RESULT_PIXELS,
  buildPaletteLookup,
  countPalettePixels,
  formatPixelInfo,
  formatPixelSummary,
  isLargeResult,
  paletteIndexOfColor,
  paletteStats,
  pixelColorAt,
  previewPointToPixel,
} from '../src/palette-link.js';

/* ---------- 预览坐标 → 输出像素 ---------- */

test('坐标换算：1× / 4× / 8× 放大倍数', () => {
  const output = { outputWidth: 64, outputHeight: 64 };
  const point = (rect, x, y) => previewPointToPixel(
    { x: rect.left + x, y: rect.top + y },
    { ...rect, ...output },
  );

  const one = { left: 100, top: 50, width: 64, height: 64 };
  assert.deepEqual(point(one, 0.5, 0.5), { x: 0, y: 0, index: 0 });
  assert.deepEqual(point(one, 32.5, 10.5), { x: 32, y: 10, index: 10 * 64 + 32 });
  assert.deepEqual(point(one, 63.5, 63.5), { x: 63, y: 63, index: 4095 });

  const four = { left: 120, top: 80, width: 256, height: 256 };
  assert.deepEqual(point(four, 0.5, 0.5), { x: 0, y: 0, index: 0 });
  assert.deepEqual(point(four, 128.5, 64.5), { x: 32, y: 16, index: 16 * 64 + 32 });
  assert.deepEqual(point(four, 255.5, 255.5), { x: 63, y: 63, index: 4095 });

  const eight = { left: 0, top: 0, width: 512, height: 512 };
  assert.deepEqual(point(eight, 256.5, 256.5), { x: 32, y: 32, index: 32 * 64 + 32 });
  assert.deepEqual(point(eight, 511.5, 511.5), { x: 63, y: 63, index: 4095 });
});

test('坐标换算：画布 CSS 尺寸与内部像素尺寸不一致时按比例定位', () => {
  const layout = {
    left: 40,
    top: 20,
    width: 300,
    height: 180,
    outputWidth: 32,
    outputHeight: 24,
  };
  assert.deepEqual(previewPointToPixel({ x: 40, y: 20 }, layout), { x: 0, y: 0, index: 0 });
  assert.deepEqual(previewPointToPixel({ x: 190, y: 110 }, layout), { x: 16, y: 12, index: 12 * 32 + 16 });
  assert.deepEqual(previewPointToPixel({ x: 339.9, y: 199.9 }, layout), { x: 31, y: 23, index: 767 });
});

test('坐标换算：devicePixelRatio / canvas 内部尺寸不参与定位', () => {
  const layout = {
    left: 10,
    top: 10,
    width: 256,
    height: 256,
    outputWidth: 64,
    outputHeight: 64,
    // 这些字段来自 canvas 位图，只影响清晰度，不应改变命中的输出像素。
    dpr: 2,
    bitmapWidth: 512,
    bitmapHeight: 512,
    zoom: 4,
  };
  assert.deepEqual(previewPointToPixel({ x: 10 + 128.5, y: 10 + 128.5 }, layout), {
    x: 32,
    y: 32,
    index: 32 * 64 + 32,
  });
  const hidpi = { ...layout, dpr: 3, bitmapWidth: 768, bitmapHeight: 768 };
  assert.deepEqual(
    previewPointToPixel({ x: 10 + 128.5, y: 10 + 128.5 }, hidpi),
    previewPointToPixel({ x: 10 + 128.5, y: 10 + 128.5 }, layout),
  );
});

test('坐标换算：左/上/右/下越界与非法参数', () => {
  const layout = {
    left: 100,
    top: 50,
    width: 200,
    height: 100,
    outputWidth: 20,
    outputHeight: 10,
  };
  assert.equal(previewPointToPixel({ x: 99, y: 60 }, layout), null);
  assert.equal(previewPointToPixel({ x: 110, y: 49 }, layout), null);
  // 半开区间：正好落在右边界 / 下边界不属于画布。
  assert.equal(previewPointToPixel({ x: 300, y: 60 }, layout), null);
  assert.equal(previewPointToPixel({ x: 110, y: 150 }, layout), null);
  assert.deepEqual(previewPointToPixel({ x: 299.999, y: 149.999 }, layout), {
    x: 19,
    y: 9,
    index: 199,
  });

  assert.equal(previewPointToPixel({ x: Number.NaN, y: 60 }, layout), null);
  assert.equal(previewPointToPixel({ x: 110, y: Number.NaN }, layout), null);
  assert.equal(previewPointToPixel({ x: 110, y: 60 }, { ...layout, width: 0 }), null);
  assert.equal(previewPointToPixel({ x: 110, y: 60 }, { ...layout, height: -1 }), null);
  assert.equal(previewPointToPixel({ x: 110, y: 60 }, { ...layout, outputWidth: 0 }), null);
  assert.equal(previewPointToPixel({ x: 110, y: 60 }, { ...layout, outputHeight: Number.NaN }), null);
  assert.equal(previewPointToPixel(null, layout), null);
  assert.equal(previewPointToPixel({ x: 110, y: 60 }, null), null);
});

/* ---------- 颜色 / 调色盘索引 ---------- */

test('颜色 → 调色盘索引：HEX、RGB 对象、重复色与缺失色', () => {
  const palette = ['#FF0000', { hex: '#00ff00' }, '#0000ff', '#ff0000'];
  assert.equal(paletteIndexOfColor(palette, '#f00'), 0);
  assert.equal(paletteIndexOfColor(palette, '#FF0000'), 0);
  assert.equal(paletteIndexOfColor(palette, { r: 0, g: 255, b: 0 }), 1);
  assert.equal(paletteIndexOfColor(palette, '#00f'), 2);
  assert.equal(paletteIndexOfColor(palette, '#123456'), -1);
  assert.equal(paletteIndexOfColor(palette, 'not-a-color'), -1);
  assert.equal(paletteIndexOfColor(palette, null), -1);
  assert.equal(paletteIndexOfColor([], '#fff'), -1);
  assert.equal(paletteIndexOfColor(null, '#fff'), -1);
});

test('颜色查表：重复 HEX 取首次出现', () => {
  const lookup = buildPaletteLookup(['#fff', { hex: '#ffffff' }, '#000000']);
  assert.equal(lookup.size, 2);
  assert.equal(lookup.get('#ffffff'), 0);
  assert.equal(lookup.get('#000000'), 2);
  assert.equal(lookup.has('#123456'), false);
  assert.equal(buildPaletteLookup(null).size, 0);
});

/* ---------- 像素颜色与占比 ---------- */

test('读取像素颜色：不透明、全透明、越界', () => {
  const image = {
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]),
  };
  assert.deepEqual(pixelColorAt(image, 0), {
    r: 255,
    g: 0,
    b: 0,
    a: 255,
    hex: '#ff0000',
    transparent: false,
  });
  assert.deepEqual(pixelColorAt(image, 1), {
    r: 0,
    g: 0,
    b: 0,
    a: 0,
    hex: null,
    transparent: true,
  });
  assert.equal(pixelColorAt(image, 2), null);
  assert.equal(pixelColorAt(image, -1), null);
  assert.equal(pixelColorAt(image, 1.5), null);
  assert.equal(pixelColorAt(null, 0), null);
  assert.equal(pixelColorAt({ width: 1, height: 1, data: [1, 2, 3] }, 0), null);
});

test('按索引统计像素数与占比：透明/越界不计入', () => {
  const stats = countPalettePixels([0, 0, 1, 0xffffffff, 2, 9], 3);
  assert.deepEqual(stats, [
    { count: 2, ratio: 0.5 },
    { count: 1, ratio: 0.25 },
    { count: 1, ratio: 0.25 },
  ]);
  assert.deepEqual(countPalettePixels([], 2), [
    { count: 0, ratio: 0 },
    { count: 0, ratio: 0 },
  ]);
  assert.deepEqual(countPalettePixels(null, 0), []);
});

test('读取调色板条目的像素数、占比与颜色值', () => {
  const palette = [{ hex: '#abc', count: 3, ratio: 0.25 }];
  assert.deepEqual(paletteStats(palette, 0), { hex: '#aabbcc', count: 3, ratio: 0.25 });
  assert.equal(paletteStats(palette, 1), null);
  assert.equal(paletteStats(null, 0), null);
  assert.deepEqual(paletteStats([{ hex: '#000000' }], 0), { hex: '#000000', count: 0, ratio: 0 });
});

/* ---------- 文案与尺寸判定 ---------- */

test('当前像素文案：位置、颜色与透明', () => {
  assert.equal(formatPixelInfo(12, 34, '#aabbcc'), '当前像素：12, 34 · #AABBCC');
  assert.equal(formatPixelInfo(0, 0, '#000'), '当前像素：0, 0 · #000000');
  assert.equal(formatPixelInfo(5, 6, null), '当前像素：5, 6 · 透明');
  assert.equal(formatPixelInfo(Number.NaN, 6, '#fff'), '当前像素：—');
});

test('悬浮提示文案：颜色值、占比与像素数', () => {
  assert.equal(formatPixelSummary('#aabbcc', 0.1234, 512), '#AABBCC · 12.3% · 512 px');
  assert.equal(formatPixelSummary('#000000', 0.5, 3), '#000000 · 50.0% · 3 px');
  assert.equal(formatPixelSummary('not-a-color', 0.5, 3), '');
});

test('大结果判定：超过 256×256 才走低成本绘法', () => {
  assert.equal(LARGE_RESULT_PIXELS, 65536);
  assert.equal(isLargeResult(256, 256), false);
  assert.equal(isLargeResult(257, 256), true);
  assert.equal(isLargeResult(512, 512), true);
  assert.equal(isLargeResult(0, 0), false);
  assert.equal(isLargeResult(Number.NaN, 100), false);
});
