import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';

import {
  upscaleImage,
  makePaletteStrip,
  buildExportFilename,
  buildPaletteFilename,
  buildProjectFilename,
  encodePNG,
  paletteHexLines,
} from '../src/exporter.js';

function twoByTwo() {
  return {
    width: 2,
    height: 2,
    data: new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      255, 255, 255, 255,
    ]),
  };
}

test('最近邻放大 2x：尺寸翻倍且像素色值不变', () => {
  const source = twoByTwo();
  const out = upscaleImage(source, 2);
  assert.equal(out.width, 4);
  assert.equal(out.height, 4);
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      const sourceOffset = ((Math.floor(y / 2) * 2) + Math.floor(x / 2)) * 4;
      const destOffset = (y * 4 + x) * 4;
      assert.deepEqual(
        Array.from(out.data.slice(destOffset, destOffset + 4)),
        Array.from(source.data.slice(sourceOffset, sourceOffset + 4)),
      );
    }
  }
});

test('最近邻放大 1x/2x/4x/8x/16x：色值与透明度逐像素不变', () => {
  const width = 5;
  const height = 3;
  const source = {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  };
  for (let i = 0; i < width * height; i += 1) {
    source.data[i * 4] = (i * 37) % 256;
    source.data[i * 4 + 1] = (i * 71) % 256;
    source.data[i * 4 + 2] = (i * 113) % 256;
    source.data[i * 4 + 3] = 80 + (i % 3) * 60;
  }

  for (const factor of [1, 2, 4, 8, 16]) {
    const out = upscaleImage(source, factor);
    assert.equal(out.width, width * factor, `${factor}x 宽`);
    assert.equal(out.height, height * factor, `${factor}x 高`);
    for (let y = 0; y < out.height; y += 1) {
      for (let x = 0; x < out.width; x += 1) {
        const sourceOffset = (Math.floor(y / factor) * width + Math.floor(x / factor)) * 4;
        const outOffset = (y * out.width + x) * 4;
        assert.deepEqual(
          Array.from(out.data.slice(outOffset, outOffset + 4)),
          Array.from(source.data.slice(sourceOffset, sourceOffset + 4)),
          `${factor}x @${x},${y}`,
        );
      }
    }
  }
});

test('放大倍数必须是 1~64 的整数', () => {
  const source = twoByTwo();
  for (const factor of [0, -1, 1.5, 65]) {
    assert.throws(() => upscaleImage(source, factor), /放大倍数/);
  }
});

test('放大 1x 返回副本，不共享原数组', () => {
  const source = twoByTwo();
  const out = upscaleImage(source, 1);
  assert.deepEqual(Array.from(out.data), Array.from(source.data));
  assert.notEqual(out.data, source.data);
});

test('调色板色块图尺寸与色块内容正确', () => {
  const strip = makePaletteStrip(['#ff0000', '#00ff00', '#0000ff'], {
    cellSize: 10,
    gap: 2,
    columns: 2,
    background: '#000000',
  });
  assert.equal(strip.width, 2 * 10 + 3 * 2);
  assert.equal(strip.height, 2 * 10 + 3 * 2);
  const interior = (x, y) => {
    const offset = (y * strip.width + x) * 4;
    return Array.from(strip.data.slice(offset, offset + 4));
  };
  assert.deepEqual(interior(2 + 1, 2 + 1), [255, 0, 0, 255]);
  assert.deepEqual(interior(2 + 10 + 2 + 1, 2 + 1), [0, 255, 0, 255]);
  assert.deepEqual(interior(2 + 1, 2 + 10 + 2 + 1), [0, 0, 255, 255]);
});

test('导出文件名包含原始基名、尺寸和放大倍数', () => {
  assert.equal(buildExportFilename('森林 小屋.png', 64, 64, 1), '森林 小屋_fixed_64x64.png');
  assert.equal(buildExportFilename('森林 小屋.png', 64, 64, 4), '森林 小屋_fixed_64x64@4x.png');
  assert.equal(buildPaletteFilename('a.png', 12), 'a_palette_12colors.png');
  assert.equal(buildProjectFilename('a.png'), 'a.pixfix.json');
});

test('PNG 编码器输出合法签名、尺寸，并可解压还原像素', () => {
  const image = twoByTwo();
  const png = encodePNG(image);
  assert.deepEqual(Array.from(png.slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);

  let offset = 8;
  const chunks = [];
  while (offset < png.length) {
    const length = (png[offset] << 24) | (png[offset + 1] << 16) | (png[offset + 2] << 8) | png[offset + 3];
    const type = String.fromCharCode(...png.slice(offset + 4, offset + 8));
    const data = png.slice(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 12 + length;
  }
  const ihdr = chunks.find((chunk) => chunk.type === 'IHDR');
  assert.equal(ihdr.data[0] << 24 | ihdr.data[1] << 16 | ihdr.data[2] << 8 | ihdr.data[3], 2);
  assert.equal(ihdr.data[4] << 24 | ihdr.data[5] << 16 | ihdr.data[6] << 8 | ihdr.data[7], 2);
  assert.equal(ihdr.data[8], 8);
  assert.equal(ihdr.data[9], 6);

  const idat = Buffer.concat(chunks.filter((chunk) => chunk.type === 'IDAT').map((chunk) => Buffer.from(chunk.data)));
  const raw = inflateSync(idat);
  assert.equal(raw.length, (2 * 4 + 1) * 2);
  assert.equal(raw[0], 0);
  assert.deepEqual(Array.from(raw.slice(1, 9)), Array.from(image.data.slice(0, 8)));
  assert.deepEqual(Array.from(raw.slice(10, 18)), Array.from(image.data.slice(8, 16)));
});

test('HEX 调色板导出保持顺序并去重', () => {
  assert.equal(
    paletteHexLines(['#ff0000', { hex: '#00FF00' }, '#ff0000']),
    '#FF0000\n#00FF00',
  );
});
