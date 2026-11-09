// 界面纯逻辑：显示格式、宽高比锁定、导出信息。
// 这里不触碰 DOM，便于在 Node 中直接测试；src/app.js 只负责取值与渲染。

import { clamp } from './color.js';
import { buildExportFilename } from './exporter.js';
import { normalizeOutputSize } from './engine.js';

/** 最大公约数，用于化简宽高比。 */
export function gcd(a, b) {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) {
    const temp = y;
    y = x % y;
    x = temp;
  }
  return x || 1;
}

/** 化简后的宽高比文案，例如 64×48 → "4 : 3"。 */
export function aspectLabel(width, height) {
  const safeWidth = Math.max(1, Math.round(width) || 1);
  const safeHeight = Math.max(1, Math.round(height) || 1);
  const divisor = gcd(safeWidth, safeHeight);
  return `${safeWidth / divisor} : ${safeHeight / divisor}`;
}

/** 文件大小的人类可读格式。 */
export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

/** 占比文案：极小值显示 <0.01%，避免出现 0.00%。 */
export function formatPercent(ratio) {
  const percent = (Number(ratio) || 0) * 100;
  if (percent > 0 && percent < 0.01) return '<0.01%';
  if (percent < 10) return `${percent.toFixed(2)}%`;
  if (percent < 100) return `${percent.toFixed(1)}%`;
  return '100%';
}

/**
 * 锁定宽高比时的尺寸联动。
 * 与直接取整可能产生 1px 误差，因此再次校正一次，保证结果尽量贴近比例。
 * @param {'width'|'height'} which 用户正在编辑的输入框
 * @param {number} width 输入框里的宽度值
 * @param {number} height 输入框里的高度值
 * @param {number} ratio 目标宽高比（宽 / 高）
 * @param {number} fallbackWidth 宽度非法时的回退值
 * @param {number} fallbackHeight 高度非法时的回退值
 * @returns {{width:number,height:number}}
 */
export function applyAspectLock(which, width, height, ratio, fallbackWidth = 64, fallbackHeight = 64) {
  let nextWidth = normalizeOutputSize(width, fallbackWidth);
  let nextHeight = normalizeOutputSize(height, fallbackHeight);
  const safeRatio = Number(ratio);
  if (!Number.isFinite(safeRatio) || safeRatio <= 0) {
    return { width: nextWidth, height: nextHeight };
  }

  if (which === 'width') {
    nextHeight = normalizeOutputSize(nextWidth / safeRatio, nextHeight);
    if (Math.abs(nextWidth / nextHeight - safeRatio) > 0.75) {
      nextWidth = normalizeOutputSize(nextHeight * safeRatio, nextWidth);
    }
  } else {
    nextWidth = normalizeOutputSize(nextHeight * safeRatio, nextWidth);
    if (Math.abs(nextWidth / nextHeight - safeRatio) > 0.75) {
      nextHeight = normalizeOutputSize(nextWidth / safeRatio, nextHeight);
    }
  }
  return { width: nextWidth, height: nextHeight };
}

/**
 * 导出区展示信息。
 * @returns {{filename:string,stats:string}}
 */
export function buildExportMeta(baseName, transform, factor, colorCount) {
  const outputWidth = Math.max(1, Math.round(Number(transform?.outputWidth) || 64));
  const outputHeight = Math.max(1, Math.round(Number(transform?.outputHeight) || 64));
  const scale = Math.max(1, Math.round(Number(factor) || 1));
  const colorText = Math.max(0, Math.round(Number(colorCount) || 0));
  const pixels = outputWidth * outputHeight;
  return {
    filename: buildExportFilename(baseName, outputWidth, outputHeight, scale),
    stats: `${outputWidth}×${outputHeight} · ${pixels} 像素 · ${colorText} 色 · 导出 ${outputWidth * scale}×${outputHeight * scale}`,
  };
}

/**
 * 剪贴板图片的默认文件名。
 * @param {string} type MIME
 * @param {Date} [date] 便于测试注入固定时间
 */
export function defaultClipboardName(type, date = new Date()) {
  const extension = (type || 'image/png').split('/')[1]?.replace('jpeg', 'jpg') || 'png';
  const pad = (value) => String(value).padStart(2, '0');
  return `clipboard_${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.${extension}`;
}

/** 平移滑块进度（CSS 变量），供 range 控件着色。 */
export function rangeProgress(value, min, max) {
  const low = Number(min);
  const high = Number(max);
  const current = Number(value);
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low || !Number.isFinite(current)) return 0;
  return clamp(((current - low) / (high - low)) * 100, 0, 100);
}
