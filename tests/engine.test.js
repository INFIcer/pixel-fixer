import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_SCALE,
  MIN_SCALE,
  computeCropRect,
  constrainTransform,
  convertLegacyScale,
  fitScale,
  resampleOutput,
  resolvePalette,
  composeOutput,
} from '../src/engine.js';
import { quantize, TRANSPARENT_INDEX } from '../src/quantize.js';
import { createProject, parseProject, serializeProject } from '../src/project.js';

function makeImage(width, height, colorAt) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = colorAt(x, y);
      const offset = (y * width + x) * 4;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = color[3] ?? 255;
    }
  }
  return { width, height, data };
}

test('像素 1:1：输出 64、源 1024、scale=1 时裁切 64×64', () => {
  const rect = computeCropRect(1024, 1024, 64, 64, 1, 0, 0);
  assert.deepEqual(
    { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    { x: 480, y: 480, width: 64, height: 64 },
  );
});

test('像素 1:1：scale 放大/缩小与裁切尺寸成反比', () => {
  const doubled = computeCropRect(1024, 1024, 64, 64, 2, 0, 0);
  assert.deepEqual(
    { x: doubled.x, y: doubled.y, width: doubled.width, height: doubled.height },
    { x: 496, y: 496, width: 32, height: 32 },
  );
  const halved = computeCropRect(1024, 1024, 64, 64, 0.5, 0, 0);
  assert.deepEqual(
    { x: halved.x, y: halved.y, width: halved.width, height: halved.height },
    { x: 448, y: 448, width: 128, height: 128 },
  );
  const whole = computeCropRect(1024, 1024, 64, 64, 0.0625, 0, 0);
  assert.deepEqual(
    { x: whole.x, y: whole.y, width: whole.width, height: whole.height },
    { x: 0, y: 0, width: 1024, height: 1024 },
  );
});

test('像素 1:1：非方形输出与偏移同时生效', () => {
  const rect = computeCropRect(1024, 768, 64, 48, 2, 100, -50);
  assert.equal(rect.width, 32);
  assert.equal(rect.height, 24);
  assert.equal(rect.x, 596);
  assert.equal(rect.y, 322);
});

test('缩放范围与适应窗口：0.01~64，1024 源图能整图取到', () => {
  assert.equal(MIN_SCALE, 0.01);
  assert.equal(MAX_SCALE, 64);
  assert.equal(fitScale(1024, 1024, 64, 64), 0.0625);
  assert.equal(fitScale(1024, 512, 64, 64), 0.0625);
  assert.equal(fitScale(512, 512, 64, 64), 0.125);
  // 输出 64 时，1% 对应 6400 源像素，足以覆盖 1024 源图。
  assert.ok(64 / MIN_SCALE >= 1024);
});

test('旧工程缩放换算：旧 scale × 输出宽 / 适应框宽', () => {
  // 1024×768、输出 64×64 的旧适应框是 768×768，factor = 64/768。
  assert.ok(Math.abs(convertLegacyScale(1, 1024, 768, 64, 64) - 64 / 768) < 1e-12);
  assert.ok(Math.abs(convertLegacyScale(2, 1024, 768, 64, 64) - 128 / 768) < 1e-12);
  // 方形源图：适应框就是整图。
  assert.equal(convertLegacyScale(1, 1024, 1024, 64, 64), 0.0625);
});

test('裁剪几何：非法尺寸抛出明确错误', () => {
  assert.throws(() => computeCropRect(0, 10, 64, 64), /源图尺寸/);
  assert.throws(() => computeCropRect(10, 10, 0, 64), /输出尺寸/);
});

test('偏移约束：裁剪框不会被移出源图，并标记已靠边', () => {
  const constrained = constrainTransform(1024, 768, 64, 64, 2, 9999, -9999);
  const rect = computeCropRect(1024, 768, 64, 64, constrained.scale, constrained.offsetX, constrained.offsetY);
  assert.ok(rect.x >= -1e-9);
  assert.ok(rect.y >= -1e-9);
  assert.ok(rect.x + rect.width <= 1024 + 1e-9);
  assert.ok(rect.y + rect.height <= 768 + 1e-9);
  assert.equal(constrained.offsetX, 496);
  assert.equal(constrained.offsetY, -368);
  assert.equal(constrained.clamped, true);
});

test('偏移约束：裁剪框大于源图时允许源图在框内滑动', () => {
  const constrained = constrainTransform(100, 100, 512, 512, 0.25, 9999, -9999);
  const rect = computeCropRect(100, 100, 512, 512, constrained.scale, constrained.offsetX, constrained.offsetY);
  assert.equal(rect.width, 2048);
  assert.equal(rect.height, 2048);
  assert.ok(rect.x <= 1e-9 && rect.x >= -1948 - 1e-9);
  assert.ok(rect.y <= 1e-9 && rect.y >= -1948 - 1e-9);
  assert.equal(constrained.offsetX, 974);
  assert.equal(constrained.offsetY, -974);
  assert.equal(constrained.clamped, true);
});

test('偏移约束：居中时不算被边界钳制', () => {
  const constrained = constrainTransform(1024, 768, 64, 64, 1, 100, -50);
  assert.equal(constrained.clamped, false);
});

test('resampleOutput：按变换裁出指定区域并重采样', () => {
  const source = makeImage(8, 8, (x, y) => [x * 30, y * 30, 0]);
  const { crop, image } = resampleOutput(source, {
    scale: 2,
    offsetX: 0,
    offsetY: 0,
    outputWidth: 4,
    outputHeight: 4,
  }, 'nearest');
  assert.deepEqual(
    { x: crop.x, y: crop.y, width: crop.width, height: crop.height },
    { x: 3, y: 3, width: 2, height: 2 },
  );
  assert.equal(image.width, 4);
  assert.equal(image.height, 4);
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      const offset = (y * 4 + x) * 4;
      const sourceX = Math.min(7, 3 + Math.floor(x / 2));
      const sourceY = Math.min(7, 3 + Math.floor(y / 2));
      assert.equal(image.data[offset], sourceX * 30);
      assert.equal(image.data[offset + 1], sourceY * 30);
      assert.equal(image.data[offset + 2], 0);
      assert.equal(image.data[offset + 3], 255);
    }
  }
});

test('改色调色板：sourceHex 保持不变，最终色被替换', () => {
  const palette = [
    { r: 255, g: 0, b: 0, hex: '#ff0000', count: 10, ratio: 0.5 },
    { r: 0, g: 0, b: 255, hex: '#0000ff', count: 10, ratio: 0.5 },
  ];
  const final = resolvePalette(palette, { '#FF0000': '#12AB34' });
  assert.equal(final[0].sourceHex, '#ff0000');
  assert.equal(final[0].hex, '#12ab34');
  assert.equal(final[0].r, 0x12);
  assert.equal(final[0].g, 0xab);
  assert.equal(final[0].b, 0x34);
  assert.equal(final[0].changed, true);
  assert.equal(final[1].hex, '#0000ff');
  assert.equal(final[1].changed, false);
});

test('输出合成保留透明度与改色后的像素值', () => {
  const resampled = {
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([
      0, 0, 0, 0,
      255, 255, 255, 128,
    ]),
  };
  const quantized = { indices: new Uint32Array([TRANSPARENT_INDEX, 0]) };
  const out = composeOutput(resampled, quantized, [{ r: 10, g: 20, b: 30, hex: '#0a141e' }]);
  assert.deepEqual(Array.from(out.data), [0, 0, 0, 0, 10, 20, 30, 128]);
});

test('端到端算法链路：裁剪→64×64→阈值合并→改色→工程往返', () => {
  // 8×8 四色旗，带一些细微色差，模拟扩散模型噪声。
  const source = makeImage(8, 8, (x, y) => {
    if (x < 4 && y < 4) return [250 + (x % 3), 10, 10];
    if (x >= 4 && y < 4) return [10, 245 + (y % 2), 10];
    if (x < 4) return [10, 10, 240 + (x % 2)];
    return [240, 240, 230 + (x % 2)];
  });

  const transform = {
    // 8×8 源图放大到 64×64 输出：1 源像素 = 8 输出像素，scale 取 8。
    scale: 8,
    offsetX: 0,
    offsetY: 0,
    outputWidth: 64,
    outputHeight: 64,
  };
  const { crop, image: resampled } = resampleOutput(source, transform, 'nearest');
  assert.equal(resampled.width, 64);
  assert.equal(resampled.height, 64);
  assert.equal(crop.width, 8);

  const quantized = quantize(resampled, { threshold: 10, mode: 'threshold' });
  assert.ok(quantized.colorCount >= 1);
  assert.ok(quantized.colorCount < 20);

  const firstHex = quantized.palette[0].hex;
  const finalPalette = resolvePalette(quantized.palette, { [firstHex]: '#123456' });
  const composed = composeOutput(resampled, quantized, finalPalette);
  assert.equal(composed.width, 64);
  assert.equal(composed.height, 64);
  let changedPixels = 0;
  for (let i = 0; i < 64 * 64; i += 1) {
    const index = quantized.indices[i];
    if (index === 0) {
      const offset = i * 4;
      assert.equal(composed.data[offset], 0x12);
      assert.equal(composed.data[offset + 1], 0x34);
      assert.equal(composed.data[offset + 2], 0x56);
      changedPixels += 1;
    }
  }
  assert.ok(changedPixels > 0);

  const project = createProject({
    sourceImage: 'data:image/png;base64,AAAA',
    sourceWidth: source.width,
    sourceHeight: source.height,
    sourceName: 'chain.png',
    transform,
    resample: 'nearest',
    colorMode: 'threshold',
    threshold: 10,
    maxColors: 16,
    dither: false,
    palette: quantized.palette.map((entry) => entry.hex),
    recolorMap: { [firstHex]: '#123456' },
    manualPalette: finalPalette.map((entry) => entry.hex),
    ui: { resultZoom: 4, lockAspect: true },
  }, { now: new Date('2026-01-01T00:00:00.000Z') });

  const restored = parseProject(serializeProject(project));
  assert.deepEqual(restored, project);
  assert.equal(restored.recolorMap[firstHex], '#123456');
});
