// 界面纯逻辑：显示格式、宽高比锁定、导出信息、缩放数学。
// 这里不触碰 DOM，便于在 Node 中直接测试；src/app.js 只负责取值与渲染。

import { clamp } from './color.js';
import { buildExportFilename } from './exporter.js';
import { computeCropRect, constrainTransform, normalizeOutputSize } from './engine.js';

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

/* ---------- 输出宽高输入（输入中不钳制，提交时才规范化） ---------- */

/** 输出尺寸的合法范围，与 engine.js 的 normalizeOutputSize 保持一致。 */
export const CROP_SIZE_MIN = 8;
export const CROP_SIZE_MAX = 512;

/**
 * 解析宽/高输入框里的文本。输入过程中允许空值、暂时不合法的中间态，
 * 这里只做“能不能读成一个数”的判断，不钳制、不回写。
 * @returns {{valid:boolean, value:number|null, empty:boolean}}
 */
export function parseCropSizeInput(text) {
  const raw = String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/,/g, '.')
    .replace(/px$/, '');
  if (!raw) return { valid: false, value: null, empty: true };
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(raw)) return { valid: false, value: null, empty: false };
  const value = Number(raw);
  if (!Number.isFinite(value)) return { valid: false, value: null, empty: false };
  return { valid: true, value, empty: false };
}

/** 把数值规范化为 8~512 的整数；非法值回退到 fallback（同样会被规范化）。 */
export function normalizeCropSize(value, fallback = 64) {
  const fallbackValue = Number.isFinite(Number(fallback)) ? Number(fallback) : 64;
  return normalizeOutputSize(value, fallbackValue);
}

/**
 * 提交一次宽/高编辑（失焦或回车时调用）。
 * - 只按用户正在编辑的那一边联动，绝不改回用户刚输入的那一边；
 * - 输入为空或不是数字时整体回退到当前值；
 * - 合法但越界的数值夹到 8~512。
 * @param {object} input
 * @param {'width'|'height'} input.which 正在编辑的输入框
 * @param {string} input.widthText 宽度输入框文本
 * @param {string} input.heightText 高度输入框文本
 * @param {number} input.currentWidth 当前宽度
 * @param {number} input.currentHeight 当前高度
 * @param {number} input.ratio 锁定时的宽高比（宽 / 高）
 * @param {boolean} input.lockAspect 是否锁定宽高比
 * @returns {{width:number,height:number,changed:boolean,invalid:boolean}}
 */
export function resolveCropSizeEdit(input = {}) {
  const which = input.which === 'height' ? 'height' : 'width';
  const currentWidth = normalizeCropSize(input.currentWidth, 64);
  const currentHeight = normalizeCropSize(input.currentHeight, 64);
  const parsedWidth = parseCropSizeInput(input.widthText ?? String(currentWidth));
  const parsedHeight = parseCropSizeInput(input.heightText ?? String(currentHeight));
  const edited = which === 'height' ? parsedHeight : parsedWidth;

  if (!edited.valid) {
    return {
      width: currentWidth,
      height: currentHeight,
      changed: false,
      invalid: true,
    };
  }

  let width = currentWidth;
  let height = currentHeight;
  const safeRatio = Number(input.ratio);

  if (which === 'width') {
    width = normalizeCropSize(edited.value, currentWidth);
    if (input.lockAspect && Number.isFinite(safeRatio) && safeRatio > 0) {
      height = normalizeCropSize(width / safeRatio, currentHeight);
    } else if (parsedHeight.valid) {
      height = normalizeCropSize(parsedHeight.value, currentHeight);
    }
  } else {
    height = normalizeCropSize(edited.value, currentHeight);
    if (input.lockAspect && Number.isFinite(safeRatio) && safeRatio > 0) {
      width = normalizeCropSize(height * safeRatio, currentWidth);
    } else if (parsedWidth.valid) {
      width = normalizeCropSize(parsedWidth.value, currentWidth);
    }
  }

  return {
    width,
    height,
    changed: width !== currentWidth || height !== currentHeight,
    invalid: false,
  };
}

/** Esc 取消：恢复进入输入框时记录的宽高。 */
export function restoreCropSizeSnapshot(snapshot, fallbackWidth = 64, fallbackHeight = 64) {
  return {
    width: normalizeCropSize(snapshot?.width, fallbackWidth),
    height: normalizeCropSize(snapshot?.height, fallbackHeight),
  };
}

/**
 * 加/减按钮（或方向键）的即时步进：基于当前已提交值计算，不读取输入框里的中间态。
 */
export function stepCropSize(input = {}) {
  const which = input.which === 'height' ? 'height' : 'width';
  const currentWidth = normalizeCropSize(input.currentWidth, 64);
  const currentHeight = normalizeCropSize(input.currentHeight, 64);
  const delta = Math.round(Number(input.delta) || 0);
  const nextWidth = which === 'width' ? currentWidth + delta : currentWidth;
  const nextHeight = which === 'height' ? currentHeight + delta : currentHeight;
  return resolveCropSizeEdit({
    which,
    widthText: String(nextWidth),
    heightText: String(nextHeight),
    currentWidth,
    currentHeight,
    ratio: input.ratio,
    lockAspect: Boolean(input.lockAspect),
  });
}

/**
 * 锁定宽高比时的尺寸联动。
 * 只按正在编辑的那一边推导另一边，不再反过来修正用户刚输入的值。
 * @param {'width'|'height'} which 用户正在编辑的输入框
 * @param {number} width 输入框里的宽度值
 * @param {number} height 输入框里的高度值
 * @param {number} ratio 目标宽高比（宽 / 高）
 * @param {number} fallbackWidth 宽度非法时的回退值
 * @param {number} fallbackHeight 高度非法时的回退值
 * @returns {{width:number,height:number}}
 */
export function applyAspectLock(which, width, height, ratio, fallbackWidth = 64, fallbackHeight = 64) {
  const parsedWidth = parseCropSizeInput(String(width));
  const parsedHeight = parseCropSizeInput(String(height));
  const baseWidth = parsedWidth.valid
    ? normalizeCropSize(parsedWidth.value, fallbackWidth)
    : normalizeCropSize(fallbackWidth, 64);
  const baseHeight = parsedHeight.valid
    ? normalizeCropSize(parsedHeight.value, fallbackHeight)
    : normalizeCropSize(fallbackHeight, 64);
  const safeRatio = Number(ratio);
  if (!Number.isFinite(safeRatio) || safeRatio <= 0) {
    return { width: baseWidth, height: baseHeight };
  }

  if (which === 'height') {
    return {
      width: normalizeCropSize(baseHeight * safeRatio, baseWidth),
      height: baseHeight,
    };
  }
  return {
    width: baseWidth,
    height: normalizeCropSize(baseWidth / safeRatio, baseHeight),
  };
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
    stats: `${outputWidth}×${outputHeight} · ${pixels} 像素 · ${colorText} 色 · 导出尺寸 ${outputWidth * scale}×${outputHeight * scale}`,
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

/* ---------- 缩放数学（纯逻辑，app.js 与测试共用） ---------- */

/** 缩放范围：10%~1600%，与 engine.js 的 MIN_SCALE / MAX_SCALE 保持一致。 */
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 16;
export const ZOOM_MIN_PERCENT = ZOOM_MIN * 100;
export const ZOOM_MAX_PERCENT = ZOOM_MAX * 100;

/** 对数滑块的内部刻度：0 对应 10%，1000 对应 1600%。 */
export const ZOOM_SLIDER_MAX = 1000;

/** 微调按钮的倍率：普通 1.02，按住 Shift 时 1.005。 */
export const ZOOM_STEP = 1.02;
export const ZOOM_STEP_FINE = 1.005;

/** 滚轮指数缩放系数：factor = e^(-deltaY * 0.0015)，Shift 时再乘 0.25。 */
export const WHEEL_ZOOM_SENSITIVITY = 0.0015;
export const WHEEL_ZOOM_FINE = 0.25;

/** 预览区留白，与 app.js 绘制裁切框时使用的边距一致。 */
export const ZOOM_FRAME_PADDING = 28;

/** 把缩放值夹到 10%~1600%；非法值回退到 100%。 */
export function clampZoom(scale) {
  const value = Number(scale);
  if (!Number.isFinite(value)) return 1;
  return clamp(value, ZOOM_MIN, ZOOM_MAX);
}

/** 缩放值 → 百分比数值（未取整，便于继续计算）。 */
export function zoomPercent(scale) {
  return clampZoom(scale) * 100;
}

/**
 * 百分比展示：低于 100% 时保留 1 位小数（10.5%），100% 以上取整（137%）。
 * 显示只影响文案，不改变真实缩放值。
 */
export function formatZoomPercent(scale) {
  const percent = zoomPercent(scale);
  if (percent < 100) {
    const rounded = Math.round(percent * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
  }
  return `${Math.round(percent)}%`;
}

/** 百分比 → 缩放值（夹到 10%~1600%）。 */
export function zoomFromPercent(percent) {
  const value = Number(percent);
  if (!Number.isFinite(value)) return 1;
  return clampZoom(value / 100);
}

/**
 * 解析百分比输入框：允许 "137%"、"137"、" 137.5 % "，空值或非数字回退到 fallback。
 * 越界值直接夹到 10%~1600%（例如 5000% → 1600%，0% → 10%）。
 */
export function parseZoomInput(text, fallbackScale = 1) {
  const fallback = clampZoom(fallbackScale);
  const raw = String(text ?? '').replace(/[%\s]/g, '').replace(',', '.');
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return clampZoom(value / 100);
}

/** 百分比 → 对数滑块位置（0~1000），拖动时连续变化。 */
export function percentToSlider(percent) {
  const numeric = Number(percent);
  const safe = Number.isFinite(numeric) ? numeric : ZOOM_MIN_PERCENT;
  const clamped = clamp(safe, ZOOM_MIN_PERCENT, ZOOM_MAX_PERCENT);
  const ratio = Math.log(clamped / ZOOM_MIN_PERCENT)
    / Math.log(ZOOM_MAX_PERCENT / ZOOM_MIN_PERCENT);
  return clamp(ratio * ZOOM_SLIDER_MAX, 0, ZOOM_SLIDER_MAX);
}

/** 对数滑块位置 → 百分比，是 percentToSlider 的逆运算。 */
export function sliderToPercent(value) {
  const numeric = Number(value);
  const safe = Number.isFinite(numeric) ? numeric : 0;
  const ratio = clamp(safe, 0, ZOOM_SLIDER_MAX) / ZOOM_SLIDER_MAX;
  return ZOOM_MIN_PERCENT * (ZOOM_MAX_PERCENT / ZOOM_MIN_PERCENT) ** ratio;
}

/** 缩放值 ↔ 滑块位置。 */
export function zoomToSlider(scale) {
  return percentToSlider(zoomPercent(scale));
}

export function sliderToZoom(value) {
  return zoomFromPercent(sliderToPercent(value));
}

/**
 * 滚轮缩放因子：factor = exp(-deltaY * 0.0015 * (shift ? 0.25 : 1))。
 * 连续指数缩放不会在挡位之间跳变；无效 deltaY 返回 1（不动）。
 */
export function wheelZoomFactor(deltaY, options = {}) {
  const delta = Number(deltaY);
  if (!Number.isFinite(delta) || delta === 0) return 1;
  const fine = options && options.shift ? WHEEL_ZOOM_FINE : 1;
  return Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY * fine);
}

/** 微调倍率：普通 1.02，Shift 1.005。 */
export function zoomStepFactor(fine = false) {
  return fine ? ZOOM_STEP_FINE : ZOOM_STEP;
}

/**
 * 单次 +/- 微调。direction > 0 放大，< 0 缩小；结果夹在 10%~1600%。
 * @param {number} scale 当前缩放
 * @param {number} direction 方向（通常为 +1 / -1）
 * @param {boolean} [fine] 是否精调（Shift）
 */
export function stepZoom(scale, direction, fine = false) {
  const factor = zoomStepFactor(fine);
  const next = clampZoom(scale) * (Number(direction) < 0 ? 1 / factor : factor);
  return clampZoom(next);
}

/**
 * 键盘快捷键映射：+ / - 缩放，0 回到 1:1，f 适应窗口。
 * 输入框（含滑块）、可编辑元素聚焦时不触发；带 Ctrl / Cmd / Alt 的组合同样忽略。
 * @returns {'zoom-in'|'zoom-out'|'reset'|'fit'|null}
 */
export function zoomShortcut(event, editing = false) {
  if (editing || !event) return null;
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const key = String(event.key || '').toLowerCase();
  if (key === '+' || key === '=') return 'zoom-in';
  if (key === '-' || key === '_') return 'zoom-out';
  if (key === '0') return 'reset';
  if (key === 'f') return 'fit';
  return null;
}

/**
 * 计算源图预览里“输出裁切框”的位置与尺寸（画布 CSS 像素坐标）。
 * 绘制与“适应窗口”共用，避免两处几何口径不一致。
 */
export function computeFrame(viewportWidth, viewportHeight, aspect, padding = ZOOM_FRAME_PADDING) {
  const width = Math.max(1, Number(viewportWidth) || 1);
  const height = Math.max(1, Number(viewportHeight) || 1);
  const numericAspect = Number(aspect);
  const safeAspect = Number.isFinite(numericAspect) && numericAspect > 0 ? numericAspect : 1;
  const pad = Math.max(0, Number(padding) || 0);
  const availableW = Math.max(40, width - pad * 2);
  const availableH = Math.max(40, height - pad * 2);
  let frameWidth = Math.min(availableW, availableH * safeAspect);
  let frameHeight = frameWidth / safeAspect;
  if (frameHeight > availableH) {
    frameHeight = availableH;
    frameWidth = frameHeight * safeAspect;
  }
  return {
    x: (width - frameWidth) / 2,
    y: (height - frameHeight) / 2,
    width: frameWidth,
    height: frameHeight,
  };
}

/**
 * “适应窗口”的缩放值：让整张源图都落在预览画布内。
 * 推导：viewScale = frame.width / crop.width = frame.width * scale / fitWidth，
 * 因此源图显示尺寸 = 源图尺寸 * frame.width * scale / fitWidth；
 * 分别对宽、高解出上限，取较小者，最后夹到 10%~1600%。
 */
export function fitZoom(
  sourceWidth,
  sourceHeight,
  outputWidth,
  outputHeight,
  viewportWidth,
  viewportHeight,
  padding = ZOOM_FRAME_PADDING,
) {
  const sw = Number(sourceWidth);
  const sh = Number(sourceHeight);
  const ow = Number(outputWidth);
  const oh = Number(outputHeight);
  if (!(sw > 0) || !(sh > 0) || !(ow > 0) || !(oh > 0)) return 1;

  const aspect = ow / oh;
  const frame = computeFrame(viewportWidth, viewportHeight, aspect, padding);
  if (!(frame.width > 0)) return 1;

  const fit = computeCropRect(sw, sh, ow, oh, 1, 0, 0);
  const pad = Math.max(0, Number(padding) || 0);
  const availableW = Math.max(40, (Number(viewportWidth) || 1) - pad * 2);
  const availableH = Math.max(40, (Number(viewportHeight) || 1) - pad * 2);

  const scaleX = (availableW * fit.fitWidth) / (sw * frame.width);
  const scaleY = (availableH * fit.fitWidth) / (sh * frame.width);
  return clampZoom(Math.min(scaleX, scaleY));
}

/**
 * 以画布上的某个点为锚点缩放：保证缩放前后，鼠标下的源图像素坐标不变。
 * 通过“旧视图反推源图坐标 → 新视图反推裁切中心”实现，最后交给
 * constrainTransform 约束偏移（贴边时锚点会被边界限制，这是预期行为）。
 *
 * @param {object} input
 * @param {number} input.sourceWidth 源图宽
 * @param {number} input.sourceHeight 源图高
 * @param {number} input.outputWidth 输出宽
 * @param {number} input.outputHeight 输出高
 * @param {number} input.scale 旧缩放
 * @param {number} input.offsetX 旧裁切中心偏移
 * @param {number} input.offsetY 旧裁切中心偏移
 * @param {number} input.newScale 目标缩放
 * @param {number} input.pointerX 锚点画布 X（CSS 像素）
 * @param {number} input.pointerY 锚点画布 Y（CSS 像素）
 * @param {{x:number,y:number,width:number,height:number}} input.frame 当前视图的裁切框
 * @returns {{scale:number,offsetX:number,offsetY:number}}
 */
export function zoomAroundPoint(input) {
  const {
    sourceWidth,
    sourceHeight,
    outputWidth,
    outputHeight,
    scale,
    offsetX = 0,
    offsetY = 0,
    newScale,
    pointerX,
    pointerY,
    frame,
  } = input || {};

  const base = clampZoom(scale);
  const safeOffsetX = Number.isFinite(Number(offsetX)) ? Number(offsetX) : 0;
  const safeOffsetY = Number.isFinite(Number(offsetY)) ? Number(offsetY) : 0;
  const fallback = { scale: base, offsetX: safeOffsetX, offsetY: safeOffsetY };

  const frameWidth = Number(frame?.width);
  const frameHeight = Number(frame?.height);
  const x = Number(pointerX);
  const y = Number(pointerY);
  const valid = sourceWidth > 0 && sourceHeight > 0 && outputWidth > 0 && outputHeight > 0
    && frameWidth > 0 && frameHeight > 0 && Number.isFinite(x) && Number.isFinite(y);
  if (!valid) return fallback;

  const target = clampZoom(newScale);
  const oldCrop = computeCropRect(
    sourceWidth,
    sourceHeight,
    outputWidth,
    outputHeight,
    base,
    safeOffsetX,
    safeOffsetY,
  );
  const oldViewScale = frameWidth / oldCrop.width;
  if (!(oldViewScale > 0) || !Number.isFinite(oldViewScale)) return fallback;

  const frameCenterX = Number(frame.x || 0) + frameWidth / 2;
  const frameCenterY = Number(frame.y || 0) + frameHeight / 2;
  // 锚点处的源图坐标（缩放前）。
  const imageX = oldCrop.x + oldCrop.width / 2 + (x - frameCenterX) / oldViewScale;
  const imageY = oldCrop.y + oldCrop.height / 2 + (y - frameCenterY) / oldViewScale;

  const freeCrop = computeCropRect(
    sourceWidth,
    sourceHeight,
    outputWidth,
    outputHeight,
    target,
    0,
    0,
  );
  const newViewScale = frameWidth / freeCrop.width;
  if (!(newViewScale > 0) || !Number.isFinite(newViewScale)) return fallback;

  // 反推新的裁切中心，使同一个源图坐标仍落在锚点下。
  const centerX = imageX - (x - frameCenterX) / newViewScale;
  const centerY = imageY - (y - frameCenterY) / newViewScale;

  return constrainTransform(
    sourceWidth,
    sourceHeight,
    outputWidth,
    outputHeight,
    target,
    centerX - sourceWidth / 2,
    centerY - sourceHeight / 2,
  );
}
