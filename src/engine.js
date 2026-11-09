// 引擎层纯逻辑：裁剪几何、调色板复写、输出像素合成。
// 不依赖 DOM，便于在 Node 中做端到端算法测试。

import { hexToRgb, normalizeHex } from './color.js';
import { resample } from './resample.js';
import { TRANSPARENT_INDEX } from './quantize.js';

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 16;

export function clampScale(scale) {
  const value = Number(scale);
  if (!Number.isFinite(value)) return 1;
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, value));
}

export function normalizeOutputSize(value, fallback = 64) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(8, Math.min(512, Math.round(number)));
}

/**
 * 计算裁剪区域（源图像素坐标）。
 * scale=1 时，裁剪框是源图内能放下的最大输出宽高比区域；
 * scale 越大裁剪越小（放大），offsetX/offsetY 是裁剪中心相对源图中心的偏移。
 */
export function computeCropRect(sourceWidth, sourceHeight, outputWidth, outputHeight, scale = 1, offsetX = 0, offsetY = 0) {
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) throw new TypeError('源图尺寸无效');
  if (!(outputWidth > 0) || !(outputHeight > 0)) throw new TypeError('输出尺寸无效');
  const aspect = outputWidth / outputHeight;
  let fitWidth;
  let fitHeight;
  if (sourceWidth / sourceHeight > aspect) {
    fitHeight = sourceHeight;
    fitWidth = sourceHeight * aspect;
  } else {
    fitWidth = sourceWidth;
    fitHeight = sourceWidth / aspect;
  }

  const safeScale = clampScale(scale);
  const cropWidth = fitWidth / safeScale;
  const cropHeight = fitHeight / safeScale;
  const centerX = sourceWidth / 2 + (Number(offsetX) || 0);
  const centerY = sourceHeight / 2 + (Number(offsetY) || 0);

  return {
    x: centerX - cropWidth / 2,
    y: centerY - cropHeight / 2,
    width: cropWidth,
    height: cropHeight,
    fitWidth,
    fitHeight,
  };
}

/**
 * 把偏移限制在合理范围：缩放后裁剪框尽量不跑出源图；
 * 当裁剪框比源图还大时，允许源图完整落在框内并保留移动空间。
 */
export function constrainTransform(sourceWidth, sourceHeight, outputWidth, outputHeight, scale, offsetX, offsetY) {
  const safeScale = clampScale(scale);
  const rect = computeCropRect(sourceWidth, sourceHeight, outputWidth, outputHeight, safeScale, 0, 0);

  const minX = Math.min(0, sourceWidth - rect.width);
  const maxX = Math.max(0, sourceWidth - rect.width);
  const minY = Math.min(0, sourceHeight - rect.height);
  const maxY = Math.max(0, sourceHeight - rect.height);

  const rawX = sourceWidth / 2 + (Number(offsetX) || 0) - rect.width / 2;
  const rawY = sourceHeight / 2 + (Number(offsetY) || 0) - rect.height / 2;
  const x = Math.max(minX, Math.min(maxX, rawX));
  const y = Math.max(minY, Math.min(maxY, rawY));

  return {
    scale: safeScale,
    offsetX: x + rect.width / 2 - sourceWidth / 2,
    offsetY: y + rect.height / 2 - sourceHeight / 2,
  };
}

/** 按当前变换直接重采样，方便 Node 端到端测试。 */
export function resampleOutput(sourceImage, transform, method = 'nearest') {
  const rect = computeCropRect(
    sourceImage.width,
    sourceImage.height,
    transform.outputWidth,
    transform.outputHeight,
    transform.scale,
    transform.offsetX,
    transform.offsetY,
  );
  return {
    crop: rect,
    image: resample(sourceImage, rect, transform.outputWidth, transform.outputHeight, method),
  };
}

/**
 * 规范化重映射表：键与值都是小写 #rrggbb，非法项丢弃。
 * @returns {Record<string,string>}
 */
export function normalizeRecolorMap(recolorMap) {
  const result = {};
  if (!recolorMap || typeof recolorMap !== 'object') return result;
  for (const [source, target] of Object.entries(recolorMap)) {
    const sourceHex = normalizeHex(source);
    const targetHex = normalizeHex(target);
    if (sourceHex && targetHex) result[sourceHex] = targetHex;
  }
  return result;
}

/**
 * 把自动聚类调色板与手动改色表合成为最终调色板。
 * sourceHex 永远指向自动聚类颜色，用于保存 recolorMap 与撤销。
 */
export function resolvePalette(palette, recolorMap = {}) {
  const map = normalizeRecolorMap(recolorMap);
  return (palette || []).map((entry) => {
    const sourceHex = normalizeHex(entry.hex) || '#000000';
    const targetHex = map[sourceHex] || sourceHex;
    const rgb = hexToRgb(targetHex);
    return {
      ...entry,
      sourceHex,
      hex: targetHex,
      r: rgb.r,
      g: rgb.g,
      b: rgb.b,
      changed: targetHex !== sourceHex,
    };
  });
}

/**
 * 将量化索引与最终调色板合成为 RGBA 输出。
 * 透明度沿用重采样结果的 alpha；透明像素保持透明。
 * @returns {{width:number,height:number,data:Uint8ClampedArray}}
 */
export function composeOutput(resampled, quantized, finalPalette) {
  if (!resampled || !quantized || !finalPalette) throw new TypeError('合成参数缺失');
  const { width, height } = resampled;
  const pixelCount = width * height;
  if (quantized.indices.length !== pixelCount) throw new TypeError('量化索引长度不匹配');

  const colorBytes = new Uint8ClampedArray(finalPalette.length * 3);
  finalPalette.forEach((entry, index) => {
    colorBytes[index * 3] = entry.r;
    colorBytes[index * 3 + 1] = entry.g;
    colorBytes[index * 3 + 2] = entry.b;
  });

  const data = new Uint8ClampedArray(pixelCount * 4);
  for (let i = 0; i < pixelCount; i += 1) {
    const alpha = resampled.data[i * 4 + 3];
    const paletteIndex = quantized.indices[i];
    if (alpha === 0 || paletteIndex === TRANSPARENT_INDEX) continue;
    const colorOffset = paletteIndex * 3;
    const offset = i * 4;
    data[offset] = colorBytes[colorOffset];
    data[offset + 1] = colorBytes[colorOffset + 1];
    data[offset + 2] = colorBytes[colorOffset + 2];
    data[offset + 3] = alpha;
  }
  return { width, height, data };
}

/** RGB 的 CSS 颜色字符串，供界面使用。 */
export function cssColor(entry, alpha = 1) {
  return alpha >= 1
    ? `rgb(${entry.r} ${entry.g} ${entry.b})`
    : `rgb(${entry.r} ${entry.g} ${entry.b} / ${alpha})`;
}
