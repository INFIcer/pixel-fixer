import test from 'node:test';
import assert from 'node:assert/strict';

import { resample, createSolidImage, RESAMPLE_METHODS } from '../src/resample.js';

function imageFromRows(rows) {
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const color = rows[y][x];
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = color[3] ?? 255;
    }
  }
  return { width, height, data };
}

const RED = [255, 0, 0, 255];
const GREEN = [0, 255, 0, 255];
const BLUE = [0, 0, 255, 255];
const WHITE = [255, 255, 255, 255];
const BLACK = [0, 0, 0, 255];

test('最近邻：同尺寸整数裁剪逐像素原样复制', () => {
  const source = imageFromRows([
    [RED, GREEN, BLUE],
    [WHITE, BLACK, [12, 34, 56, 77]],
  ]);
  const out = resample(source, { x: 0, y: 0, width: 3, height: 2 }, 3, 2, 'nearest');
  assert.equal(out.width, 3);
  assert.equal(out.height, 2);
  assert.deepEqual(Array.from(out.data), Array.from(source.data));
});

test('最近邻：裁剪偏移取点正确', () => {
  const source = imageFromRows([
    [RED, GREEN, BLUE],
    [WHITE, BLACK, RED],
  ]);
  const out = resample(source, { x: 1, y: 0, width: 2, height: 2 }, 2, 2, 'nearest');
  const expected = [
    GREEN, BLUE,
    BLACK, RED,
  ].flat();
  assert.deepEqual(Array.from(out.data), expected);
});

test('最近邻：2x 放大每个源像素成为 2x2 色块', () => {
  const source = imageFromRows([
    [RED, GREEN],
    [BLUE, WHITE],
  ]);
  const out = resample(source, { x: 0, y: 0, width: 2, height: 2 }, 4, 4, 'nearest');
  const sx = (x) => Math.floor(x / 2);
  const sy = (y) => Math.floor(y / 2);
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      const offset = (y * 4 + x) * 4;
      const expected = source.data[(sy(y) * 2 + sx(x)) * 4 + 3] === 255
        ? [
          source.data[(sy(y) * 2 + sx(x)) * 4],
          source.data[(sy(y) * 2 + sx(x)) * 4 + 1],
          source.data[(sy(y) * 2 + sx(x)) * 4 + 2],
          255,
        ]
        : [0, 0, 0, 0];
      assert.deepEqual(Array.from(out.data.slice(offset, offset + 4)), expected);
    }
  }
});

test('区域平均：2x1 红蓝缩小为 1 像素得到中间色', () => {
  const source = imageFromRows([[RED, BLUE]]);
  const out = resample(source, { x: 0, y: 0, width: 2, height: 1 }, 1, 1, 'area');
  assert.deepEqual(Array.from(out.data), [128, 0, 128, 255]);
});

test('区域平均：向下取整时保留 2x2 平均色', () => {
  const source = imageFromRows([
    [RED, RED],
    [BLUE, BLUE],
  ]);
  const out = resample(source, { x: 0, y: 0, width: 2, height: 2 }, 1, 1, 'area');
  assert.deepEqual(Array.from(out.data), [128, 0, 128, 255]);
});

test('所有重采样算法都返回正确输出尺寸', () => {
  const source = createSolidImage(9, 7, [10, 20, 30, 255]);
  for (const method of RESAMPLE_METHODS) {
    const out = resample(source, { x: 1, y: 1, width: 5, height: 4 }, 3, 2, method.id);
    assert.equal(out.width, 3, method.id);
    assert.equal(out.height, 2, method.id);
    assert.equal(out.data.length, 3 * 2 * 4, method.id);
  }
});

test('裁剪范围完全在源图外时输出透明', () => {
  const source = createSolidImage(4, 4, [255, 0, 0, 255]);
  const out = resample(source, { x: -10, y: 0, width: 2, height: 2 }, 2, 2, 'nearest');
  assert.deepEqual(Array.from(out.data), new Array(16).fill(0));
});

test('双线性放大保持颜色通道范围与 alpha', () => {
  const source = imageFromRows([
    [BLACK, WHITE],
    [WHITE, BLACK],
  ]);
  const out = resample(source, { x: 0, y: 0, width: 2, height: 2 }, 5, 5, 'bilinear');
  for (let i = 0; i < out.width * out.height; i += 1) {
    const offset = i * 4;
    assert.ok(out.data[offset] >= 0 && out.data[offset] <= 255);
    assert.equal(out.data[offset], out.data[offset + 1]);
    assert.equal(out.data[offset], out.data[offset + 2]);
    assert.equal(out.data[offset + 3], 255);
  }
});

test('非法参数会给出明确错误', () => {
  const source = createSolidImage(2, 2, RED);
  assert.throws(() => resample(source, { x: 0, y: 0, width: 1, height: 1 }, 0, 1, 'nearest'), /输出尺寸/);
  assert.throws(() => resample(source, { x: 0, y: 0, width: 1, height: 1 }, 1, 1, 'nope'), /未知/);
});
