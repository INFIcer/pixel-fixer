// .pixfix.json 工程文件：创建、校验、序列化、反序列化。
// 纯逻辑，不依赖 DOM。

import { normalizeHex } from './color.js';
import { isValidResample } from './resample.js';

export const PROJECT_VERSION = 1;

function fail(message) {
  throw new Error(`工程文件无效：${message}`);
}

function nowIso(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === 'string') {
    const time = Date.parse(value);
    if (Number.isFinite(time)) return new Date(time).toISOString();
  }
  return new Date().toISOString();
}

function finiteNumber(value, fallback, min = -Number.MAX_VALUE, max = Number.MAX_VALUE) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function integer(value, fallback, min, max) {
  return Math.max(min, Math.min(max, Math.round(finiteNumber(value, fallback, min, max))));
}

function normalizePalette(value, fieldName) {
  if (value == null) return [];
  if (!Array.isArray(value)) fail(`${fieldName} 必须是数组`);
  const seen = new Set();
  const result = [];
  for (const item of value) {
    const raw = typeof item === 'string' ? item : item?.hex;
    const hex = normalizeHex(raw);
    if (!hex) continue;
    if (!seen.has(hex)) {
      seen.add(hex);
      result.push(hex);
    }
  }
  return result;
}

function normalizeRecolorMap(value) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) fail('recolorMap 必须是对象');
  const result = {};
  for (const [source, target] of Object.entries(value)) {
    const sourceHex = normalizeHex(source);
    const targetHex = normalizeHex(target);
    if (sourceHex && targetHex) result[sourceHex] = targetHex;
  }
  return result;
}

/**
 * 缩放百分比规范化：旧工程没有 ui.sourceZoom 时，用 transform.scale 推导，
 * 这样旧文件仍能恢复到保存时的缩放，而不是被重置为 100%。
 */
function zoomPercentValue(value, fallbackScale) {
  const fallbackPercent = (Number(fallbackScale) || 1) * 100;
  const number = Number(value);
  const percent = Number.isFinite(number) ? number : fallbackPercent;
  return Math.round(Math.max(10, Math.min(1600, percent)) * 100) / 100;
}

function normalizeUi(value, fallbackScale = 1) {
  const ui = value && typeof value === 'object' ? value : {};
  const zoom = Number(ui.resultZoom);
  const exportScale = Number(ui.exportScale);
  return {
    resultZoom: [1, 4, 8].includes(zoom) ? zoom : 4,
    lockAspect: Boolean(ui.lockAspect),
    exportScale: [1, 2, 4, 8, 16].includes(exportScale) ? exportScale : 1,
    // 源图缩放百分比（10~1600）：与 transform.scale 对应，便于阅读与恢复。
    sourceZoom: zoomPercentValue(ui.sourceZoom, fallbackScale),
  };
}

/**
 * 规范化工程对象。无效版本会抛错；未知字段丢弃。
 * @param {object} raw
 */
export function normalizeProject(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('根节点必须是对象');
  if (Number(raw.version) !== PROJECT_VERSION) {
    fail(`不支持的版本 ${raw.version ?? '缺失'}（当前支持 ${PROJECT_VERSION}）`);
  }

  const sourceImage = raw.sourceImage;
  if (typeof sourceImage !== 'string' || !/^data:image\/[a-z0-9.+-]+[,;]/i.test(sourceImage)) {
    fail('sourceImage 必须是图片 dataURL');
  }

  const sourceWidth = integer(raw.sourceWidth, 0, 0, 100000);
  const sourceHeight = integer(raw.sourceHeight, 0, 0, 100000);
  if (sourceWidth < 1 || sourceHeight < 1) fail('源图宽高必须为正整数');

  const transformRaw = raw.transform && typeof raw.transform === 'object' ? raw.transform : {};
  const transform = {
    scale: finiteNumber(transformRaw.scale, 1, 0.1, 16),
    offsetX: finiteNumber(transformRaw.offsetX, 0, -100000, 100000),
    offsetY: finiteNumber(transformRaw.offsetY, 0, -100000, 100000),
    outputWidth: integer(transformRaw.outputWidth, 64, 8, 512),
    outputHeight: integer(transformRaw.outputHeight, 64, 8, 512),
  };

  const resample = isValidResample(raw.resample) ? raw.resample : 'nearest';
  const colorMode = raw.colorMode === 'target' ? 'target' : 'threshold';
  const createdAt = nowIso(raw.createdAt);
  const updatedAt = nowIso(raw.updatedAt);

  return {
    version: PROJECT_VERSION,
    createdAt,
    updatedAt,
    sourceImage,
    sourceWidth,
    sourceHeight,
    sourceName: typeof raw.sourceName === 'string' && raw.sourceName.trim()
      ? raw.sourceName.trim().slice(0, 512)
      : '未命名.png',
    transform,
    resample,
    colorMode,
    threshold: finiteNumber(raw.threshold, 0, 0, 100),
    maxColors: integer(raw.maxColors, 16, 1, 256),
    dither: Boolean(raw.dither),
    palette: normalizePalette(raw.palette, 'palette'),
    recolorMap: normalizeRecolorMap(raw.recolorMap),
    manualPalette: normalizePalette(raw.manualPalette, 'manualPalette'),
    ui: normalizeUi(raw.ui, transform.scale),
  };
}

/**
 * 从当前工作状态创建工程对象。
 * @param {object} input
 * @param {{now?: Date|string, createdAt?: string}} [options]
 */
export function createProject(input, options = {}) {
  const now = nowIso(options.now || new Date());
  const createdAt = nowIso(options.createdAt || input?.createdAt || now);
  return normalizeProject({
    version: PROJECT_VERSION,
    createdAt,
    updatedAt: now,
    sourceImage: input?.sourceImage,
    sourceWidth: input?.sourceWidth,
    sourceHeight: input?.sourceHeight,
    sourceName: input?.sourceName,
    transform: input?.transform,
    resample: input?.resample,
    colorMode: input?.colorMode,
    threshold: input?.threshold,
    maxColors: input?.maxColors,
    dither: input?.dither,
    palette: input?.palette,
    recolorMap: input?.recolorMap,
    manualPalette: input?.manualPalette,
    ui: input?.ui,
  });
}

/** 序列化为带缩进的 UTF-8 JSON 字符串。 */
export function serializeProject(project) {
  return JSON.stringify(normalizeProject(project), null, 2);
}

/** 解析并校验工程 JSON 字符串。 */
export function parseProject(text) {
  if (typeof text !== 'string' || !text.trim()) fail('文件为空');
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    fail(`JSON 解析失败（${error.message}）`);
  }
  return normalizeProject(raw);
}

/** 估算工程文本 UTF-8 字节数。 */
export function projectSizeBytes(text) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(text)).length;
  return Buffer.byteLength(String(text), 'utf8');
}
