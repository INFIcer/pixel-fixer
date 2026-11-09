import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyAspectLock,
  aspectLabel,
  buildExportMeta,
  clampZoom,
  computeFrame,
  defaultClipboardName,
  fitZoom,
  formatBytes,
  formatPercent,
  formatZoomPercent,
  gcd,
  parseZoomInput,
  percentToSlider,
  rangeProgress,
  sliderToPercent,
  sliderToZoom,
  stepZoom,
  wheelZoomFactor,
  zoomAroundPoint,
  zoomFromPercent,
  zoomPercent,
  zoomShortcut,
  zoomStepFactor,
  zoomToSlider,
} from '../src/uistate.js';
import { computeCropRect } from '../src/engine.js';

test('gcd 与宽高比文案', () => {
  assert.equal(gcd(64, 48), 16);
  assert.equal(gcd(0, 0), 1);
  assert.equal(aspectLabel(64, 48), '4 : 3');
  assert.equal(aspectLabel(512, 512), '1 : 1');
  assert.equal(aspectLabel(1920, 1080), '16 : 9');
});

test('formatBytes 三档单位', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1023), '1023 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(2 * 1024 * 1024), '2.00 MB');
});

test('formatPercent 极值与精度', () => {
  assert.equal(formatPercent(0), '0.00%');
  assert.equal(formatPercent(0.00004), '<0.01%');
  assert.equal(formatPercent(0.0555), '5.55%');
  assert.equal(formatPercent(0.5), '50.0%');
  assert.equal(formatPercent(1), '100%');
});

test('锁定宽高比：改宽度时高度联动（1:1）', () => {
  assert.deepEqual(applyAspectLock('width', 96, 64, 1, 64, 64), { width: 96, height: 96 });
  assert.deepEqual(applyAspectLock('width', 8, 64, 1, 64, 64), { width: 8, height: 8 });
  assert.deepEqual(applyAspectLock('width', 9999, 64, 1, 64, 64), { width: 512, height: 512 });
});

test('锁定宽高比：改高度时宽度联动（4:3）', () => {
  assert.deepEqual(applyAspectLock('height', 64, 48, 4 / 3, 64, 64), { width: 64, height: 48 });
  assert.deepEqual(applyAspectLock('height', 64, 96, 4 / 3, 64, 64), { width: 128, height: 96 });
  assert.deepEqual(applyAspectLock('height', 64, 8, 4 / 3, 64, 64), { width: 11, height: 8 });
});

test('锁定宽高比：非法输入回退且比例无效时原样返回', () => {
  assert.deepEqual(applyAspectLock('width', Number.NaN, Number.NaN, 1, 64, 48), { width: 64, height: 64 });
  assert.deepEqual(applyAspectLock('width', 100, 50, 0, 64, 64), { width: 100, height: 50 });
  assert.deepEqual(applyAspectLock('height', 100, 50, Number.NaN, 64, 64), { width: 100, height: 50 });
});

test('导出信息包含文件名、像素数与倍数尺寸', () => {
  const meta = buildExportMeta('森林 小屋.png', { outputWidth: 64, outputHeight: 48 }, 4, 12);
  assert.equal(meta.filename, '森林 小屋_fixed_64x48@4x.png');
  assert.equal(meta.stats, '64×48 · 3072 像素 · 12 色 · 导出尺寸 256×192');
  const single = buildExportMeta('a.png', { outputWidth: 32, outputHeight: 32 }, 1, 0);
  assert.equal(single.filename, 'a_fixed_32x32.png');
});

test('剪贴板文件名使用固定时间可复现', () => {
  const date = new Date(2026, 0, 2, 3, 4, 5);
  assert.equal(defaultClipboardName('image/png', date), 'clipboard_20260102_030405.png');
  assert.equal(defaultClipboardName('image/jpeg', date), 'clipboard_20260102_030405.jpg');
  assert.equal(defaultClipboardName(undefined, date), 'clipboard_20260102_030405.png');
});

test('rangeProgress 映射到 0~100 并截断', () => {
  assert.equal(rangeProgress(55, 10, 100), 50);
  assert.equal(rangeProgress(-5, 10, 100), 0);
  assert.equal(rangeProgress(500, 10, 100), 100);
  assert.equal(rangeProgress(5, 10, 10), 0);
  assert.equal(rangeProgress(Number.NaN, 0, 100), 0);
});

/* ---------- 缩放数学 ---------- */

test('缩放 clamp：夹在 10%~1600%，非法值回退 100%', () => {
  assert.equal(clampZoom(0), 0.1);
  assert.equal(clampZoom(0.05), 0.1);
  assert.equal(clampZoom(20), 16);
  assert.equal(clampZoom(Number.NaN), 1);
  assert.equal(clampZoom(1.375), 1.375);
  assert.equal(zoomPercent(1), 100);
  assert.equal(zoomPercent(1.375), 137.5);
  assert.equal(zoomPercent(99), 1600);
  assert.equal(zoomFromPercent(137), 1.37);
  assert.equal(zoomFromPercent(9999), 16);
  assert.equal(zoomFromPercent(0), 0.1);
  assert.equal(zoomFromPercent(Number.NaN), 1);
});

test('百分比展示与输入解析：允许 %、空格、小数与越界夹取', () => {
  assert.equal(formatZoomPercent(1), '100%');
  assert.equal(formatZoomPercent(1.37), '137%');
  assert.equal(formatZoomPercent(0.105), '10.5%');
  assert.equal(formatZoomPercent(0.1), '10%');
  assert.equal(parseZoomInput('137%', 1), 1.37);
  assert.equal(parseZoomInput(' 137.5 % ', 1), 1.375);
  assert.equal(parseZoomInput('137,5', 1), 1.375);
  assert.equal(parseZoomInput('9999', 1), 16);
  assert.equal(parseZoomInput('-20', 1), 0.1);
  assert.equal(parseZoomInput('abc', 1.5), 1.5);
  assert.equal(parseZoomInput('', 1.5), 1.5);
});

test('对数滑块：位置与百分比可逆且单调', () => {
  assert.equal(percentToSlider(10), 0);
  assert.equal(percentToSlider(1600), 1000);
  const expected = (1000 * Math.log(10)) / Math.log(160);
  assert.ok(Math.abs(percentToSlider(100) - expected) < 1e-9);
  assert.ok(Math.abs(sliderToPercent(percentToSlider(137)) - 137) < 1e-9);
  assert.ok(Math.abs(sliderToZoom(zoomToSlider(2.5)) - 2.5) < 1e-9);
  assert.ok(percentToSlider(100) > percentToSlider(50));
  assert.ok(percentToSlider(50) > percentToSlider(10));
  assert.equal(sliderToPercent(-5), 10);
  assert.equal(sliderToPercent(5000), 1600);
  // 对数刻度中点约为几何平均 sqrt(10*1600) ≈ 126.5%。
  assert.ok(Math.abs(sliderToPercent(500) - 10 * Math.sqrt(160)) < 1e-9);
});

test('滚轮缩放因子：指数曲线、方向与 Shift 精调（×0.25）', () => {
  assert.ok(Math.abs(wheelZoomFactor(100) - Math.exp(-0.15)) < 1e-12);
  assert.ok(wheelZoomFactor(100) < 1);
  assert.ok(wheelZoomFactor(-100) > 1);
  assert.equal(wheelZoomFactor(0), 1);
  assert.equal(wheelZoomFactor(Number.NaN), 1);
  const normal = wheelZoomFactor(120);
  const fine = wheelZoomFactor(120, { shift: true });
  assert.ok(fine > normal && fine < 1);
  assert.ok(Math.abs(Math.log(fine) / Math.log(normal) - 0.25) < 1e-12);
});

test('+/- 微调：普通 1.02，Shift 1.005，边界不再越界', () => {
  assert.ok(Math.abs(stepZoom(1, 1) - 1.02) < 1e-12);
  assert.ok(Math.abs(stepZoom(1, -1) - 1 / 1.02) < 1e-12);
  assert.ok(Math.abs(stepZoom(1, 1, true) - 1.005) < 1e-12);
  assert.ok(Math.abs(stepZoom(1, -1, true) - 1 / 1.005) < 1e-12);
  assert.equal(stepZoom(16, 1), 16);
  assert.equal(stepZoom(0.1, -1), 0.1);
  assert.equal(zoomStepFactor(false), 1.02);
  assert.equal(zoomStepFactor(true), 1.005);
});

test('键盘映射：+ - 0 f，输入框聚焦或带修饰键时忽略', () => {
  const key = (value, extra = {}) => zoomShortcut({ key: value, ...extra }, false);
  assert.equal(key('+'), 'zoom-in');
  assert.equal(key('='), 'zoom-in');
  assert.equal(key('-'), 'zoom-out');
  assert.equal(key('_'), 'zoom-out');
  assert.equal(key('0'), 'reset');
  assert.equal(key('f'), 'fit');
  assert.equal(key('F'), 'fit');
  assert.equal(key('g'), null);
  assert.equal(zoomShortcut({ key: '+' }, true), null);
  assert.equal(zoomShortcut({ key: 'f', ctrlKey: true }, false), null);
  assert.equal(zoomShortcut({ key: '0', metaKey: true }, false), null);
  assert.equal(zoomShortcut({ key: '-', altKey: true }, false), null);
});

test('锚点不变式：缩放前后鼠标下的源图坐标一致', () => {
  const sourceWidth = 800;
  const sourceHeight = 600;
  const pointerX = 350;
  const pointerY = 300;
  const frame = { x: 100, y: 50, width: 400, height: 400 };
  const frameCenterX = frame.x + frame.width / 2;
  const frameCenterY = frame.y + frame.height / 2;

  const before = computeCropRect(sourceWidth, sourceHeight, 64, 64, 1, 0, 0);
  const beforeScale = frame.width / before.width;
  const sourceX = before.x + before.width / 2 + (pointerX - frameCenterX) / beforeScale;
  const sourceY = before.y + before.height / 2 + (pointerY - frameCenterY) / beforeScale;

  const next = zoomAroundPoint({
    sourceWidth,
    sourceHeight,
    outputWidth: 64,
    outputHeight: 64,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    newScale: 1.5,
    pointerX,
    pointerY,
    frame,
  });
  assert.equal(next.scale, 1.5);

  const after = computeCropRect(sourceWidth, sourceHeight, 64, 64, next.scale, next.offsetX, next.offsetY);
  const afterScale = frame.width / after.width;
  const afterX = after.x + after.width / 2 + (pointerX - frameCenterX) / afterScale;
  const afterY = after.y + after.height / 2 + (pointerY - frameCenterY) / afterScale;
  assert.ok(Math.abs(afterX - sourceX) < 1e-9);
  assert.ok(Math.abs(afterY - sourceY) < 1e-9);
});

test('锚点缩放：贴边时受约束但结果仍合法', () => {
  const next = zoomAroundPoint({
    sourceWidth: 800,
    sourceHeight: 600,
    outputWidth: 64,
    outputHeight: 64,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    newScale: 16,
    pointerX: 105,
    pointerY: 55,
    frame: { x: 100, y: 50, width: 400, height: 400 },
  });
  assert.equal(next.scale, 16);
  assert.ok(Number.isFinite(next.offsetX) && Number.isFinite(next.offsetY));
  const crop = computeCropRect(800, 600, 64, 64, next.scale, next.offsetX, next.offsetY);
  assert.ok(crop.x >= -1e-9 && crop.x + crop.width <= 800 + 1e-9);
  assert.ok(crop.y >= -1e-9 && crop.y + crop.height <= 600 + 1e-9);
});

test('裁切框几何与适应窗口', () => {
  const frame = computeFrame(800, 600, 4 / 3);
  assert.ok(Math.abs(frame.x + frame.width / 2 - 400) < 1e-9);
  assert.ok(Math.abs(frame.y + frame.height / 2 - 300) < 1e-9);
  assert.ok(frame.width <= 744 + 1e-9);
  assert.ok(frame.height <= 544 + 1e-9);

  const scale = fitZoom(1024, 512, 64, 64, 800, 600);
  assert.ok(scale > 0.6 && scale < 0.7);
  const squareFrame = computeFrame(800, 600, 1);
  const crop = computeCropRect(1024, 512, 64, 64, scale, 0, 0);
  const viewScale = squareFrame.width / crop.width;
  assert.ok(1024 * viewScale <= 744 + 1e-9);
  assert.ok(512 * viewScale <= 544 + 1e-9);
  assert.ok(Math.abs(fitZoom(512, 512, 64, 64, 800, 600) - 1) < 1e-9);
  assert.equal(fitZoom(0, 100, 64, 64, 800, 600), 1);
});
