// 调色盘联动纯逻辑：预览坐标 → 输出像素、像素颜色 → 调色盘索引、占比统计与文案。
// 这里不触碰 DOM，便于在 Node 中直接测试；取元素、绘制高亮与节流在 src/app.js。
//
// 坐标说明：计算只依赖 getBoundingClientRect() 得到的 CSS 盒与输出网格尺寸。
// 滚动偏移、页面缩放与 devicePixelRatio 都已经反映在 client 坐标与 CSS 盒里；
// canvas.width / canvas.height（内部像素）只影响清晰度，不参与换算，
// 因此显示尺寸与内部尺寸不一致时也不会指错像素。

import { normalizeHex, rgbToHex } from './color.js';
import { formatPercent } from './uistate.js';

/** 结果超过该像素数时，反向高亮只画掩码，不再逐像素描边（256×256 以上）。 */
export const LARGE_RESULT_PIXELS = 256 * 256;

function toPositiveInteger(value) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function entryHex(entry) {
  return normalizeHex(typeof entry === 'string' ? entry : entry?.hex);
}

/**
 * 预览画布上的 client 坐标 → 输出像素坐标与索引。
 *
 * @param {{x:number,y:number}} point 鼠标的 clientX / clientY（CSS 像素）
 * @param {{left:number,top:number,width:number,height:number,
 *          outputWidth:number,outputHeight:number}} layout
 *        left/top/width/height 取自 getBoundingClientRect()；
 *        outputWidth/outputHeight 是当前输出（1×）的像素尺寸，
 *        结果预览的 1×/4×/8× 放大倍数已经体现在 CSS 盒里。
 * @returns {{x:number,y:number,index:number}|null} 越界、尺寸非法或坐标为 NaN 时返回 null
 */
export function previewPointToPixel(point, layout = {}) {
  const clientX = Number(point?.x);
  const clientY = Number(point?.y);
  const left = Number(layout?.left);
  const top = Number(layout?.top);
  const width = Number(layout?.width);
  const height = Number(layout?.height);
  const outputWidth = toPositiveInteger(layout?.outputWidth);
  const outputHeight = toPositiveInteger(layout?.outputHeight);

  const valid = Number.isFinite(clientX)
    && Number.isFinite(clientY)
    && Number.isFinite(left)
    && Number.isFinite(top)
    && Number.isFinite(width)
    && Number.isFinite(height)
    && width > 0
    && height > 0
    && outputWidth > 0
    && outputHeight > 0;
  if (!valid) return null;

  const localX = clientX - left;
  const localY = clientY - top;
  // 半开区间 [0, width)：正好落在右/下边界时不算命中，避免把画布外的点算进最后一行。
  if (localX < 0 || localY < 0 || localX >= width || localY >= height) return null;

  const x = Math.min(outputWidth - 1, Math.floor((localX / width) * outputWidth));
  const y = Math.min(outputHeight - 1, Math.floor((localY / height) * outputHeight));
  return { x, y, index: y * outputWidth + x };
}

/**
 * 读取输出图像某个像素的颜色。
 * 全透明像素返回 hex = null，界面显示“透明”而不是 #000000。
 *
 * @param {{data:Uint8ClampedArray|Uint8Array,width:number,height:number}} image
 * @param {number} index 像素索引（行优先）
 * @returns {{r:number,g:number,b:number,a:number,hex:string|null,transparent:boolean}|null}
 */
export function pixelColorAt(image, index) {
  const data = image?.data;
  const width = toPositiveInteger(image?.width);
  const height = toPositiveInteger(image?.height);
  if (!data || !width || !height) return null;

  const pixel = Math.round(Number(index));
  if (!Number.isInteger(pixel) || pixel < 0 || pixel >= width * height) return null;
  const offset = pixel * 4;
  if (offset + 3 >= data.length) return null;

  const r = data[offset];
  const g = data[offset + 1];
  const b = data[offset + 2];
  const a = data[offset + 3];
  return {
    r,
    g,
    b,
    a,
    hex: a === 0 ? null : rgbToHex(r, g, b),
    transparent: a === 0,
  };
}

/**
 * 颜色 → 调色盘索引（找不到返回 -1）。
 * 颜色可以传 #rgb / #rrggbb 字符串，也可以传 {r,g,b}。
 * 调色盘里可能有改色后重复的 HEX，此时返回第一个匹配项。
 */
export function paletteIndexOfColor(palette, color) {
  if (!Array.isArray(palette) || !palette.length) return -1;

  let hex = null;
  if (typeof color === 'string') {
    hex = normalizeHex(color);
  } else if (color && Number.isFinite(Number(color.r)) && Number.isFinite(Number(color.g))
    && Number.isFinite(Number(color.b))) {
    hex = rgbToHex(Number(color.r), Number(color.g), Number(color.b));
  }
  if (!hex) return -1;

  for (let i = 0; i < palette.length; i += 1) {
    if (entryHex(palette[i]) === hex) return i;
  }
  return -1;
}

/** 预生成“颜色 → 调色盘索引”查表（重复 HEX 取首次出现，结果为空 Map）。 */
export function buildPaletteLookup(palette) {
  const lookup = new Map();
  if (!Array.isArray(palette)) return lookup;
  for (let i = 0; i < palette.length; i += 1) {
    const hex = entryHex(palette[i]);
    if (hex && !lookup.has(hex)) lookup.set(hex, i);
  }
  return lookup;
}

/**
 * 按像素索引统计每个调色板颜色的像素数与占比。
 * 越界索引（含透明像素的 TRANSPARENT_INDEX）不计入总数。
 *
 * @param {ArrayLike<number>} indices 每个输出像素的调色板索引
 * @param {number} paletteSize 调色板颜色数
 * @returns {{count:number,ratio:number}[]}
 */
export function countPalettePixels(indices, paletteSize) {
  const size = Math.max(0, Math.round(Number(paletteSize)) || 0);
  const counts = new Uint32Array(size);
  let visible = 0;
  if (size && indices) {
    for (let i = 0; i < indices.length; i += 1) {
      const index = indices[i];
      if (Number.isInteger(index) && index >= 0 && index < size) {
        counts[index] += 1;
        visible += 1;
      }
    }
  }
  const result = new Array(size);
  for (let i = 0; i < size; i += 1) {
    result[i] = { count: counts[i], ratio: visible > 0 ? counts[i] / visible : 0 };
  }
  return result;
}

/** 从最终调色板读取某个色块的颜色值、像素数与占比。 */
export function paletteStats(palette, index) {
  if (!Array.isArray(palette)) return null;
  const position = Math.round(Number(index));
  if (!Number.isInteger(position) || position < 0 || position >= palette.length) return null;
  const entry = palette[position];
  const count = Math.max(0, Math.round(Number(entry?.count) || 0));
  const ratio = Number.isFinite(Number(entry?.ratio)) ? Number(entry.ratio) : 0;
  return { hex: entryHex(entry), count, ratio };
}

/** 结果预览底部的简短位置信息：当前像素：12, 34 · #AABBCC（透明时显示“透明”）。 */
export function formatPixelInfo(x, y, hex) {
  const px = Math.round(Number(x));
  const py = Math.round(Number(y));
  if (!Number.isFinite(px) || !Number.isFinite(py)) return '当前像素：—';
  const color = normalizeHex(hex);
  return color
    ? `当前像素：${px}, ${py} · ${color.toUpperCase()}`
    : `当前像素：${px}, ${py} · 透明`;
}

/** 跟随鼠标的悬浮提示：#AABBCC · 12.3% · 512 px。 */
export function formatPixelSummary(hex, ratio, count) {
  const color = normalizeHex(hex);
  if (!color) return '';
  const pixels = Math.max(0, Math.round(Number(count) || 0));
  return `${color.toUpperCase()} · ${formatPercent(ratio)} · ${pixels} px`;
}

/** 结果是否属于“很大”的尺寸（像素数超过 256×256），用于选择低成本高亮绘法。 */
export function isLargeResult(width, height) {
  const w = toPositiveInteger(width);
  const h = toPositiveInteger(height);
  return w * h > LARGE_RESULT_PIXELS;
}
