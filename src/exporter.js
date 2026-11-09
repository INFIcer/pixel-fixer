// 导出相关纯逻辑：最近邻放大、调色板色块图、文件名、无依赖 PNG 编码器。
// 浏览器界面优先用 Canvas 的 toBlob 导出（压缩更好）；这里同时提供纯 JS PNG 编码，
// 便于 Node 测试与无 Canvas 环境使用。

import { clampByte, hexToRgb, normalizeHex } from './color.js';

/** 最近邻放大，保证像素边界锐利、颜色值完全不变。 */
export function upscaleImage(image, factor) {
  if (!image || !image.data || !Number.isInteger(image.width) || !Number.isInteger(image.height)) {
    throw new TypeError('导出图像数据无效');
  }
  if (!Number.isInteger(factor) || factor < 1 || factor > 64) {
    throw new TypeError('放大倍数必须是 1~64 的整数');
  }
  const width = image.width * factor;
  const height = image.height * factor;
  const data = new Uint8ClampedArray(width * height * 4);

  if (factor === 1) {
    data.set(image.data);
    return { width, height, data };
  }

  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.floor(y / factor);
    const sourceRow = sourceY * image.width * 4;
    const destRow = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.floor(x / factor);
      const sourceIndex = sourceRow + sourceX * 4;
      const destIndex = destRow + x * 4;
      data[destIndex] = image.data[sourceIndex];
      data[destIndex + 1] = image.data[sourceIndex + 1];
      data[destIndex + 2] = image.data[sourceIndex + 2];
      data[destIndex + 3] = image.data[sourceIndex + 3];
    }
  }
  return { width, height, data };
}

function resolveColor(color) {
  if (typeof color === 'string') {
    const rgb = hexToRgb(color);
    return rgb ? { ...rgb, a: 255 } : null;
  }
  if (color && Number.isFinite(color.r) && Number.isFinite(color.g) && Number.isFinite(color.b)) {
    return { r: color.r, g: color.g, b: color.b, a: color.a ?? 255 };
  }
  return null;
}

/**
 * 生成调色板色块图（无文字，纯色块），颜色多时自动换行。
 * @param {Array<string|{r:number,g:number,b:number}>} colors
 * @param {{cellSize?:number, gap?:number, columns?:number, background?:string|number[]}} [options]
 */
export function makePaletteStrip(colors, options = {}) {
  const list = (colors || []).map(resolveColor).filter(Boolean);
  if (list.length === 0) {
    return { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 0]) };
  }

  const cellSize = Math.max(8, Math.min(256, Math.round(options.cellSize ?? 48)));
  const gap = Math.max(0, Math.min(32, Math.round(options.gap ?? 2)));
  const columns = Math.max(1, Math.min(list.length, Math.round(options.columns ?? 16)));
  const rows = Math.ceil(list.length / columns);
  const width = columns * cellSize + (columns + 1) * gap;
  const height = rows * cellSize + (rows + 1) * gap;
  const data = new Uint8ClampedArray(width * height * 4);

  let bg;
  if (Array.isArray(options.background)) {
    bg = options.background.map(clampByte);
    if (bg.length === 3) bg.push(255);
  } else {
    const rgb = hexToRgb(options.background || '#0b0f14');
    bg = rgb ? [rgb.r, rgb.g, rgb.b, 255] : [11, 15, 20, 255];
  }
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = bg[0];
    data[i * 4 + 1] = bg[1];
    data[i * 4 + 2] = bg[2];
    data[i * 4 + 3] = bg[3] ?? 255;
  }

  list.forEach((color, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const startX = gap + column * (cellSize + gap);
    const startY = gap + row * (cellSize + gap);
    for (let y = 0; y < cellSize; y += 1) {
      for (let x = 0; x < cellSize; x += 1) {
        const offset = ((startY + y) * width + startX + x) * 4;
        data[offset] = color.r;
        data[offset + 1] = color.g;
        data[offset + 2] = color.b;
        data[offset + 3] = color.a;
      }
    }
  });

  return { width, height, data };
}

/** 去掉路径与非法字符，得到可安全写入文件名的基名。 */
export function sanitizeBaseName(name) {
  let base = String(name || 'pixel-art').trim();
  base = base.replace(/^.*[\\/]/, '');
  base = base.replace(/\.(png|jpe?g|webp|gif|bmp|avif)$/i, '');
  base = base.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim();
  return base || 'pixel-art';
}

export function buildExportFilename(baseName, width, height, scale = 1) {
  const base = sanitizeBaseName(baseName);
  const suffix = scale > 1 ? `@${scale}x` : '';
  return `${base}_fixed_${width}x${height}${suffix}.png`;
}

export function buildPaletteFilename(baseName, colorCount) {
  return `${sanitizeBaseName(baseName)}_palette_${colorCount}colors.png`;
}

export function buildProjectFilename(baseName) {
  return `${sanitizeBaseName(baseName)}.pixfix.json`;
}

// ---------- 极简 PNG 编码器（zlib stored blocks） ----------

let CRC_TABLE = null;

function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  CRC_TABLE = table;
  return table;
}

function crc32(bytes) {
  const table = crcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function writeUint32(target, offset, value) {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function makeChunk(type, data) {
  const typeBytes = new Uint8Array([...type].map((char) => char.charCodeAt(0)));
  const chunk = new Uint8Array(12 + data.length);
  writeUint32(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  writeUint32(chunk, 8 + data.length, crc32(crcInput));
  return chunk;
}

function zlibStore(raw) {
  const blockSize = 65535;
  const blocks = Math.max(1, Math.ceil(raw.length / blockSize));
  const output = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  let offset = 0;
  output[offset++] = 0x78;
  output[offset++] = 0x01;

  for (let block = 0; block < blocks; block += 1) {
    const start = block * blockSize;
    const end = Math.min(raw.length, start + blockSize);
    const length = end - start;
    output[offset++] = block === blocks - 1 ? 0x01 : 0x00;
    output[offset++] = length & 0xff;
    output[offset++] = (length >>> 8) & 0xff;
    output[offset++] = (~length) & 0xff;
    output[offset++] = ((~length) >>> 8) & 0xff;
    output.set(raw.subarray(start, end), offset);
    offset += length;
  }

  writeUint32(output, offset, adler32(raw));
  return output;
}

/**
 * 将 RGBA 图像编码为 PNG。使用 zlib stored block 保证零依赖、像素完全无损；
 * 文件比浏览器 Canvas 导出更大，界面实际导出优先使用 toBlob。
 * @returns {Uint8Array}
 */
export function encodePNG(image) {
  if (!image || !image.data || !Number.isInteger(image.width) || !Number.isInteger(image.height)) {
    throw new TypeError('PNG 输入图像无效');
  }
  const { width, height, data } = image;
  if (width < 1 || height < 1) throw new TypeError('PNG 尺寸无效');
  if (data.length !== width * height * 4) throw new TypeError('PNG 像素长度不匹配');

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = new Uint8Array(13);
  writeUint32(ihdr, 0, width);
  writeUint32(ihdr, 4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const destOffset = y * (stride + 1);
    raw[destOffset] = 0; // filter: none
    raw.set(data.subarray(y * stride, (y + 1) * stride), destOffset + 1);
  }

  const compressed = zlibStore(raw);
  const idatChunks = [];
  const idatSize = 256 * 1024;
  for (let offset = 0; offset < compressed.length; offset += idatSize) {
    idatChunks.push(makeChunk('IDAT', compressed.subarray(offset, offset + idatSize)));
  }

  const chunks = [makeChunk('IHDR', ihdr), ...idatChunks, makeChunk('IEND', new Uint8Array(0))];
  const totalLength = signature.length + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const png = new Uint8Array(totalLength);
  png.set(signature, 0);
  let offset = signature.length;
  for (const chunk of chunks) {
    png.set(chunk, offset);
    offset += chunk.length;
  }
  return png;
}

/** 将调色板颜色格式化为每行一个 HEX（保持顺序并去重）。 */
export function paletteHexLines(colors) {
  const seen = new Set();
  const lines = [];
  for (const color of colors || []) {
    const hex = typeof color === 'string' ? color : color?.hex;
    const normalized = normalizeHex(hex);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      lines.push(normalized.toUpperCase());
    }
  }
  return lines.join('\n');
}
