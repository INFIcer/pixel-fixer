import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyAspectLock,
  aspectLabel,
  buildExportMeta,
  defaultClipboardName,
  formatBytes,
  formatPercent,
  gcd,
  rangeProgress,
} from '../src/uistate.js';

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
  assert.equal(meta.stats, '64×48 · 3072 像素 · 12 色 · 导出 256×192');
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
