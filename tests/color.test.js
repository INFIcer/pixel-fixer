import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clamp,
  clampByte,
  formatHexPalette,
  hexToRgb,
  labDistance,
  labDistanceSq,
  labToRgb,
  luminance,
  normalizeHex,
  parseHexPalette,
  rgbToHex,
  rgbToLab,
} from '../src/color.js';

test('HEX 解析：#rgb 与 #rrggbb，兼容省略井号', () => {
  assert.deepEqual(hexToRgb('#f80'), { r: 255, g: 136, b: 0 });
  assert.deepEqual(hexToRgb('#FF8800'), { r: 255, g: 136, b: 0 });
  assert.deepEqual(hexToRgb('0c2238'), { r: 12, g: 34, b: 56 });
  assert.deepEqual(hexToRgb('  #ffffff  '), { r: 255, g: 255, b: 255 });
});

test('HEX 解析：非法输入返回 null', () => {
  for (const value of ['', '#', '#ff', '#ffff', '#gggggg', 'rgb(1,2,3)', null, 123]) {
    assert.equal(hexToRgb(value), null, String(value));
  }
});

test('normalizeHex 统一为小写 #rrggbb', () => {
  assert.equal(normalizeHex('#ABC'), '#aabbcc');
  assert.equal(normalizeHex('#A1B2C3'), '#a1b2c3');
  assert.equal(normalizeHex('zzz'), null);
});

test('rgbToHex 对通道做四舍五入并钳制到 0~255', () => {
  assert.equal(rgbToHex(0, 127.6, 300), '#0080ff');
  assert.equal(rgbToHex(-5, Number.NaN, 12), '#00000c');
});

test('clamp / clampByte 边界行为', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-5, 0, 3), 0);
  assert.equal(clampByte(3.4), 3);
  assert.equal(clampByte(3.5), 4);
  assert.equal(clampByte(Number.POSITIVE_INFINITY), 0);
  assert.equal(clampByte(Number.NaN), 0);
});

test('sRGB 与 CIELAB 往返误差不超过 1', () => {
  const colors = [
    [0, 0, 0],
    [255, 255, 255],
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [128, 128, 128],
    [12, 34, 56],
    [217, 119, 6],
  ];
  for (const [r, g, b] of colors) {
    const lab = rgbToLab(r, g, b);
    assert.ok(Math.abs(lab[0]) <= 100.001, `L 越界：${lab[0]}`);
    const back = labToRgb(lab[0], lab[1], lab[2]);
    assert.ok(Math.abs(back[0] - r) <= 1, `R ${r} → ${back[0]}`);
    assert.ok(Math.abs(back[1] - g) <= 1, `G ${g} → ${back[1]}`);
    assert.ok(Math.abs(back[2] - b) <= 1, `B ${b} → ${back[2]}`);
  }
});

test('LAB 色差：自身为 0、满足对称性、平方值与开方一致', () => {
  const a = rgbToLab(255, 0, 0);
  const b = rgbToLab(0, 0, 255);
  assert.equal(labDistance(a, a), 0);
  assert.equal(labDistanceSq(a, a), 0);
  assert.ok(Math.abs(labDistance(a, b) - labDistance(b, a)) < 1e-9);
  assert.ok(Math.abs(labDistanceSq(a, b) - labDistance(a, b) ** 2) < 1e-6);
  assert.ok(labDistance(a, b) > 100);
});

test('luminance 按 Rec.709 权重计算', () => {
  assert.ok(Math.abs(luminance(255, 255, 255) - 255) < 1e-9);
  assert.equal(luminance(0, 0, 0), 0);
  assert.ok(Math.abs(luminance(0, 255, 0) - 182.376) < 1e-9);
});

test('parseHexPalette：忽略空行、注释、行尾注释并去重', () => {
  const text = [
    '// 天空色',
    '#ff0000',
    '',
    '#00FF00 // 草地',
    '; 注释',
    '#f00',
    '#0000ff',
    '#ffffff',
    '不是颜色',
  ].join('\n');
  assert.deepEqual(parseHexPalette(text), ['#ff0000', '#00ff00', '#0000ff', '#ffffff']);
});

test('parseHexPalette：支持 #rgb 简写与多行混合大小写', () => {
  assert.deepEqual(parseHexPalette('#ABC\n#aabbcc\nddEEFF'), ['#aabbcc', '#ddeeff']);
  assert.deepEqual(parseHexPalette(''), []);
  assert.deepEqual(parseHexPalette(null), []);
});

test('formatHexPalette：大写、去重、丢弃非法项', () => {
  assert.equal(
    formatHexPalette(['#ff0000', { hex: '#00FF00' }, 'nope', '#ff0000']),
    '#FF0000\n#00FF00',
  );
  assert.equal(formatHexPalette([]), '');
});
