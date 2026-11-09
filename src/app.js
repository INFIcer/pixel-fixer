// 像素画修复工具 — 界面与工作流。
// 纯浏览器 ES module；所有算法在独立模块中，这里只负责状态、画布和交互。

import { RESAMPLE_METHODS, isValidResample } from './resample.js';
import { createColorModel, quantize } from './quantize.js';
import {
  computeCropRect,
  constrainTransform,
  resampleOutput,
  resolvePalette,
  composeOutput,
  normalizeOutputSize,
  normalizeRecolorMap,
} from './engine.js';
import {
  createProject,
  serializeProject,
  parseProject,
  projectSizeBytes,
} from './project.js';
import {
  makePaletteStrip,
  upscaleImage,
  encodePNG,
  buildExportFilename,
  buildPaletteFilename,
  buildProjectFilename,
  sanitizeBaseName,
} from './exporter.js';
import {
  normalizeHex,
  parseHexPalette,
  formatHexPalette,
  clamp,
} from './color.js';
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
  parseZoomInput,
  rangeProgress,
  sliderToZoom,
  stepZoom,
  wheelZoomFactor,
  zoomAroundPoint,
  zoomPercent,
  zoomShortcut,
  zoomToSlider,
} from './uistate.js';

const MAX_UNDO = 50;
const LARGE_PROJECT_BYTES = 8 * 1024 * 1024;
const LARGE_EXPORT_PIXELS = 24_000_000;

const state = {
  source: null,
  transform: {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    outputWidth: 64,
    outputHeight: 64,
  },
  lockAspect: true,
  aspectRatio: 1,
  resample: 'nearest',
  colorMode: 'threshold',
  threshold: 0,
  maxColors: 16,
  dither: false,
  recolorMap: {},
  resultZoom: 4,
  exportScale: 1,
  createdAt: null,
  updatedAt: null,
  dirty: false,
};

const cache = {
  geometryKey: null,
  resampled: null,
  crop: null,
  model: null,
  quantKey: null,
  quantized: null,
};

const finalPalette = [];
const recolorHistory = [];
const el = {};

let sourceSequence = 0;
let rebuildQueued = false;
let sourceDrawQueued = false;
let recolorQueued = false;
let paletteRenderToken = 0;
let dragState = null;
let dragDepth = 0;
let pickerSession = null;
let toastTimer = null;
let outputCanvas = null;
let outputImageData = null;
let lastTimings = { resample: 0, quantize: 0, compose: 0, total: 0 };
let outputTimer = null;
// 滚轮缩放按帧合并：同一帧内的多个 wheel 事件只重绘 / 重建一次。
let pendingWheelZoom = null;
let wheelZoomQueued = false;

/* ---------- 工具函数 ---------- */

function $(id) {
  return document.getElementById(id);
}

function timelineValue(input, value) {
  if (!input) return;
  input.style.setProperty('--range-progress', `${rangeProgress(value, input.min, input.max)}%`);
}

function setBusy(busy) {
  el.topDot.classList.toggle('is-busy', Boolean(busy));
  el.topDot.classList.toggle('is-live', !busy && Boolean(state.source));
  if (busy) el.statusText.textContent = '正在更新预览…';
}

function setStatus(message) {
  el.statusText.textContent = message;
  el.topDot.classList.toggle('is-live', Boolean(state.source));
  el.topDot.classList.remove('is-busy');
}

function showToast(message, type = 'info', duration = 3000) {
  clearTimeout(toastTimer);
  el.toast.textContent = message;
  el.toast.className = `toast is-visible${type === 'error' ? ' is-error' : ''}${type === 'success' ? ' is-success' : ''}`;
  toastTimer = setTimeout(() => {
    el.toast.classList.remove('is-visible');
  }, duration);
}

function markDirty() {
  state.dirty = true;
  updateProjectState();
}

function updateProjectState() {
  if (!el.projectState) return;
  if (!state.source) {
    el.projectState.textContent = '未命名工作';
    document.title = '像素画修复工具 · PIXFIX';
    return;
  }
  const suffix = state.dirty ? '未保存修改' : '已保存';
  el.projectState.textContent = `${state.source.name} · ${suffix}`;
  document.title = `${state.source.name} · 像素画修复工具`;
}

function currentCrop() {
  if (!state.source) return null;
  return computeCropRect(
    state.source.width,
    state.source.height,
    state.transform.outputWidth,
    state.transform.outputHeight,
    state.transform.scale,
    state.transform.offsetX,
    state.transform.offsetY,
  );
}

function invalidateAll() {
  cache.geometryKey = null;
  cache.resampled = null;
  cache.crop = null;
  cache.model = null;
  cache.quantKey = null;
  cache.quantized = null;
  finalPalette.length = 0;
  outputImageData = null;
  outputCanvas = null;
}

/* ---------- 初始化 ---------- */

function init() {
  cacheElements();
  populateResampleSelect();
  bindEvents();
  setupObservers();
  syncAllControls();
  updateActionAvailability();
  updateEmptyStates();
  drawSourcePreview();
  updateSourceInfo();
  updateOutputInfo();
  updateExportMeta();
  renderPalette();
  exposeDebugApi();
  window.__PIXFIX_BOOTED__ = true;
  setStatus('就绪，等待导入');
}

function cacheElements() {
  const ids = [
    'btnImport', 'btnOpenProject', 'btnSaveProject', 'topDot', 'topStatus',
    'outW', 'outH', 'lockAspect', 'aspectLabel', 'zoomRange', 'zoomInput',
    'btnZoomOut', 'btnZoomIn', 'btnZoomFit', 'btnZoomActual',
    'btnResetCrop', 'resampleSelect', 'resampleDesc', 'thresholdGroup',
    'targetGroup', 'thresholdRange', 'thresholdValue', 'targetColors',
    'ditherToggle', 'colorCount', 'approxState', 'btnUndoRecolor',
    'btnResetRecolor', 'exportScale', 'exportFilename', 'exportStats',
    'btnExportPng', 'btnExportPalette', 'sourceWrap', 'sourceCanvas',
    'sourceEmpty', 'btnEmptyImport', 'btnEmptyProject', 'srcInfoBadge',
    'srcDims', 'srcZoom', 'srcOffset', 'srcCrop', 'resultScroll',
    'resultCanvas', 'resultEmpty', 'resultZoomGroup', 'resultTip', 'outDims',
    'outCrop', 'pixelCount', 'resultColors', 'paletteCount',
    'btnImportHex', 'btnExportHex', 'paletteHint', 'paletteList',
    'paletteEmpty', 'fileImage', 'fileProject', 'fileHex', 'colorPicker',
    'statusText', 'timingText', 'projectState', 'dropOverlay', 'toast',
  ];
  for (const id of ids) el[id] = $(id);
}

function populateResampleSelect() {
  el.resampleSelect.replaceChildren();
  for (const method of RESAMPLE_METHODS) {
    const option = document.createElement('option');
    option.value = method.id;
    option.textContent = `${method.name} — ${method.short}`;
    el.resampleSelect.appendChild(option);
  }
}

function setupObservers() {
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(() => scheduleSourceDraw());
    observer.observe(el.sourceWrap);
  }
  window.addEventListener('resize', scheduleSourceDraw);
}

/** 源图预览重绘按帧合并：滚轮连续滚动时每帧只画一次。 */
function scheduleSourceDraw() {
  if (sourceDrawQueued) return;
  sourceDrawQueued = true;
  requestAnimationFrame(() => {
    sourceDrawQueued = false;
    drawSourcePreview();
  });
}

/* ---------- 事件绑定 ---------- */

function bindEvents() {
  el.btnImport.addEventListener('click', () => el.fileImage.click());
  el.btnEmptyImport.addEventListener('click', () => el.fileImage.click());
  el.btnOpenProject.addEventListener('click', () => el.fileProject.click());
  el.btnEmptyProject.addEventListener('click', () => el.fileProject.click());
  el.btnSaveProject.addEventListener('click', saveProject);
  el.btnExportPng.addEventListener('click', exportPng);
  el.btnExportPalette.addEventListener('click', exportPalettePng);
  el.btnImportHex.addEventListener('click', () => el.fileHex.click());
  el.btnExportHex.addEventListener('click', exportHexPalette);
  el.btnUndoRecolor.addEventListener('click', undoRecolor);
  el.btnResetRecolor.addEventListener('click', resetRecolor);
  el.btnResetCrop.addEventListener('click', resetCrop);
  el.btnZoomIn.addEventListener('click', (event) => nudgeZoom(1, event.shiftKey));
  el.btnZoomOut.addEventListener('click', (event) => nudgeZoom(-1, event.shiftKey));
  el.btnZoomFit.addEventListener('click', fitSourceToView);
  el.btnZoomActual.addEventListener('click', resetZoomOneToOne);

  el.fileImage.addEventListener('change', () => {
    const file = el.fileImage.files?.[0];
    el.fileImage.value = '';
    if (file) importAnyFile(file);
  });
  el.fileProject.addEventListener('change', () => {
    const file = el.fileProject.files?.[0];
    el.fileProject.value = '';
    if (file) openProjectFile(file);
  });
  el.fileHex.addEventListener('change', () => {
    const file = el.fileHex.files?.[0];
    el.fileHex.value = '';
    if (file) importHexFile(file);
  });

  setupOutputInput(el.outW, 'width');
  setupOutputInput(el.outH, 'height');
  el.lockAspect.addEventListener('change', () => {
    state.lockAspect = el.lockAspect.checked;
    if (state.lockAspect) {
      state.aspectRatio = state.transform.outputWidth / state.transform.outputHeight;
    }
    updateAspectLabel();
    markDirty();
  });

  el.zoomRange.addEventListener('input', () => {
    if (!state.source) return;
    applySourceZoom(sliderToZoom(el.zoomRange.value));
  });

  el.zoomInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitZoomInput();
      el.zoomInput.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      el.zoomInput.value = formatZoomPercent(state.transform.scale);
      el.zoomInput.blur();
    }
  });
  el.zoomInput.addEventListener('blur', commitZoomInput);
  el.zoomInput.addEventListener('focus', () => el.zoomInput.select());

  el.resampleSelect.addEventListener('change', () => {
    state.resample = isValidResample(el.resampleSelect.value) ? el.resampleSelect.value : 'nearest';
    updateResampleDescription();
    markDirty();
    drawSourcePreview();
    scheduleRebuild(true);
  });

  for (const radio of document.querySelectorAll('input[name="colorMode"]')) {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      state.colorMode = radio.value === 'target' ? 'target' : 'threshold';
      updateModeUI();
      markDirty();
      scheduleRebuild(false);
    });
  }

  el.thresholdRange.addEventListener('input', () => {
    state.threshold = clamp(Number(el.thresholdRange.value) || 0, 0, 100);
    updateThresholdUI();
    markDirty();
    scheduleRebuild(false);
  });

  el.targetColors.addEventListener('input', () => {
    const value = Number(el.targetColors.value);
    if (!Number.isFinite(value) || value < 2 || value > 256) return;
    state.maxColors = Math.round(value);
    markDirty();
    scheduleRebuild(false);
  });
  el.targetColors.addEventListener('change', () => {
    state.maxColors = Math.max(2, Math.min(256, Math.round(Number(el.targetColors.value) || 16)));
    el.targetColors.value = String(state.maxColors);
    markDirty();
    scheduleRebuild(false);
  });

  el.ditherToggle.addEventListener('change', () => {
    state.dither = el.ditherToggle.checked;
    markDirty();
    scheduleRebuild(false);
  });

  el.exportScale.addEventListener('change', () => {
    state.exportScale = Number(el.exportScale.value) || 1;
    updateExportMeta();
  });

  el.resultZoomGroup.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-zoom]');
    if (!button) return;
    const zoom = Number(button.dataset.zoom);
    if (![1, 4, 8].includes(zoom)) return;
    state.resultZoom = zoom;
    syncResultZoomButtons();
    drawResultScaled();
    centerResultScroll();
  });

  el.paletteList.addEventListener('click', (event) => {
    const card = event.target.closest('.swatch-card');
    if (!card) return;
    const index = Number(card.dataset.index);
    openPalettePicker(index);
  });

  el.colorPicker.addEventListener('input', () => {
    if (!pickerSession) return;
    const hex = normalizeHex(el.colorPicker.value);
    if (!hex) return;
    if (!pickerSession.changed) {
      pushHistory(pickerSession.snapshot);
      pickerSession.changed = true;
    }
    if (hex === pickerSession.sourceHex) {
      delete state.recolorMap[pickerSession.sourceHex];
    } else {
      state.recolorMap[pickerSession.sourceHex] = hex;
    }
    markDirty();
    scheduleRecolorRefresh();
  });

  el.colorPicker.addEventListener('change', () => {
    if (!pickerSession) return;
    pickerSession = null;
    updateActionAvailability();
  });

  el.sourceCanvas.addEventListener('pointerdown', onPointerDown);
  el.sourceCanvas.addEventListener('pointermove', onPointerMove);
  el.sourceCanvas.addEventListener('pointerup', onPointerUp);
  el.sourceCanvas.addEventListener('pointercancel', onPointerUp);
  el.sourceCanvas.addEventListener('wheel', onWheel, { passive: false });

  document.addEventListener('paste', onPaste);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('dragenter', onDragEnter);
  document.addEventListener('dragover', onDragOver);
  document.addEventListener('dragleave', onDragLeave);
  document.addEventListener('drop', onDrop);

  window.addEventListener('unhandledrejection', (event) => {
    console.error(event.reason);
    showToast('操作未完成，请重试。', 'error', 5000);
  });
}

function setupOutputInput(input, which) {
  const commit = () => {
    if (outputTimer) {
      clearTimeout(outputTimer);
      outputTimer = null;
    }
    applyOutputFromInputs(which);
  };
  input.addEventListener('input', () => {
    if (outputTimer) clearTimeout(outputTimer);
    outputTimer = setTimeout(commit, 180);
  });
  input.addEventListener('change', commit);
  input.addEventListener('blur', () => {
    // 输入非法时恢复显示，避免留下空框。
    if (!Number.isFinite(Number(input.value)) || Number(input.value) < 8 || Number(input.value) > 512) {
      syncOutputInputs();
    }
  });
}

function applyOutputFromInputs(which) {
  if (!state.source) {
    syncOutputInputs();
    return;
  }
  const widthValue = Number(el.outW.value);
  const heightValue = Number(el.outH.value);
  if (!Number.isFinite(widthValue) || !Number.isFinite(heightValue)) {
    syncOutputInputs();
    return;
  }

  let width = normalizeOutputSize(widthValue, state.transform.outputWidth);
  let height = normalizeOutputSize(heightValue, state.transform.outputHeight);

  if (state.lockAspect) {
    const locked = applyAspectLock(
      which,
      width,
      height,
      state.aspectRatio || 1,
      state.transform.outputWidth,
      state.transform.outputHeight,
    );
    width = locked.width;
    height = locked.height;
  }

  state.transform.outputWidth = width;
  state.transform.outputHeight = height;
  const constrained = constrainTransform(
    state.source.width,
    state.source.height,
    width,
    height,
    state.transform.scale,
    state.transform.offsetX,
    state.transform.offsetY,
  );
  Object.assign(state.transform, constrained);
  syncOutputInputs();
  updateAspectLabel();
  updateSourceInfo();
  markDirty();
  drawSourcePreview();
  scheduleRebuild(true);
}

/* ---------- 导入 / 工程 ---------- */

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片解码失败'));
    image.src = dataUrl;
  });
}

function extractImageData(image) {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) throw new Error('图片尺寸为 0');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('浏览器无法创建 Canvas');
  context.drawImage(image, 0, 0);
  try {
    return { width, height, data: context.getImageData(0, 0, width, height).data };
  } catch (error) {
    throw new Error(`无法读取图片像素：${error.message}`);
  }
}

function isProjectFile(file) {
  return /\.json$/i.test(file.name || '') || /json/i.test(file.type || '');
}

function isImageFile(file) {
  return /^image\//i.test(file.type || '') || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name || '');
}

async function importAnyFile(file) {
  if (!file) return;
  if (isProjectFile(file)) {
    await openProjectFile(file);
    return;
  }
  if (!isImageFile(file)) {
    showToast('不支持的文件类型，请选择图片或 .pixfix.json 工程。', 'error');
    return;
  }
  try {
    setBusy(true);
    setStatus('正在读取图片…');
    const dataUrl = await readAsDataURL(file);
    await installSource(dataUrl, file.name || defaultClipboardName(file.type), { reset: true });
    showToast(`已导入 ${state.source.name}`, 'success');
  } catch (error) {
    console.error(error);
    showToast(`导入失败：${error.message}。请换一张图片重试。`, 'error', 5000);
    setStatus('导入失败');
    setBusy(false);
  }
}

async function installSource(dataUrl, name, options = {}) {
  const image = await loadImage(dataUrl);
  const imageData = extractImageData(image);
  sourceSequence += 1;
  state.source = {
    uid: sourceSequence,
    image,
    imageData,
    dataUrl,
    width: imageData.width,
    height: imageData.height,
    name: name || '未命名.png',
    baseName: sanitizeBaseName(name || 'pixel-art'),
  };

  if (options.reset !== false) {
    resetWorkspaceForSource();
  }

  state.createdAt = state.createdAt || new Date().toISOString();
  state.updatedAt = null;
  state.dirty = true;
  recolorHistory.length = 0;
  pickerSession = null;
  invalidateAll();
  syncAllControls();
  updateEmptyStates();
  updateActionAvailability();
  updateProjectState();
  updateSourceInfo();
  drawSourcePreview();
  rebuildPipeline();
  centerResultScroll();
}

function resetWorkspaceForSource() {
  state.transform = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    outputWidth: 64,
    outputHeight: 64,
  };
  state.lockAspect = true;
  state.aspectRatio = 1;
  state.resample = 'nearest';
  state.colorMode = 'threshold';
  state.threshold = 0;
  state.maxColors = 16;
  state.dither = false;
  state.recolorMap = {};
  state.resultZoom = 4;
  state.exportScale = 1;
  state.createdAt = new Date().toISOString();
  state.updatedAt = null;
  state.dirty = true;
}

async function openProjectFile(file) {
  try {
    setBusy(true);
    setStatus('正在加载工程…');
    const text = await file.text();
    await loadProjectText(text, { quiet: true, fileName: file.name });
    showToast(`工程已加载：${file.name}`, 'success');
  } catch (error) {
    console.error(error);
    showToast(error.message || '工程加载失败，请确认文件是否完整。', 'error', 5500);
    setStatus('工程加载失败');
    setBusy(false);
  }
}

async function loadProjectText(text, options = {}) {
  const project = parseProject(text);
  const image = await loadImage(project.sourceImage);
  const imageData = extractImageData(image);

  sourceSequence += 1;
  state.source = {
    uid: sourceSequence,
    image,
    imageData,
    dataUrl: project.sourceImage,
    width: imageData.width,
    height: imageData.height,
    name: project.sourceName,
    baseName: sanitizeBaseName(project.sourceName),
  };

  // 缩放百分比以 ui.sourceZoom 为准（旧工程会由 transform.scale 推导）。
  const restoredScale = clampZoom(project.ui.sourceZoom / 100);
  const constrained = constrainTransform(
    imageData.width,
    imageData.height,
    project.transform.outputWidth,
    project.transform.outputHeight,
    restoredScale,
    project.transform.offsetX,
    project.transform.offsetY,
  );

  state.transform = {
    ...constrained,
    outputWidth: project.transform.outputWidth,
    outputHeight: project.transform.outputHeight,
  };
  state.lockAspect = project.ui.lockAspect;
  state.aspectRatio = state.transform.outputWidth / state.transform.outputHeight;
  state.resample = project.resample;
  state.colorMode = project.colorMode;
  state.threshold = project.threshold;
  state.maxColors = project.maxColors;
  state.dither = project.dither;
  state.recolorMap = normalizeRecolorMap(project.recolorMap);
  state.resultZoom = project.ui.resultZoom;
  state.exportScale = project.ui.exportScale;
  state.createdAt = project.createdAt;
  state.updatedAt = project.updatedAt;
  state.dirty = false;

  recolorHistory.length = 0;
  pickerSession = null;
  invalidateAll();
  syncAllControls();
  updateEmptyStates();
  updateActionAvailability();
  updateProjectState();
  updateSourceInfo();
  drawSourcePreview();
  rebuildPipeline();
  centerResultScroll();

  const dimensionMismatch = imageData.width !== project.sourceWidth || imageData.height !== project.sourceHeight;
  if (dimensionMismatch) {
    showToast(
      `注意：工程记录的源图尺寸为 ${project.sourceWidth}×${project.sourceHeight}，实际读取为 ${imageData.width}×${imageData.height}，已按实际尺寸载入。`,
      'error',
      5500,
    );
  }

  if (project.palette.length && cache.quantized) {
    const currentPalette = cache.quantized.palette.map((entry) => entry.hex);
    const paletteMismatch = currentPalette.length !== project.palette.length
      || currentPalette.some((hex, index) => hex !== project.palette[index]);
    if (paletteMismatch && !dimensionMismatch) {
      showToast('自动配色已按当前设置重新生成；原有的改色仍会保留。', 'error', 5000);
    }
  }

  if (!options.quiet) showToast('工程已加载', 'success');
  return project;
}

/* ---------- 裁切与画布 ---------- */

function getSourceView() {
  if (!state.source) return null;
  const rect = el.sourceWrap.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const crop = currentCrop();
  if (!crop) return null;
  const aspect = state.transform.outputWidth / state.transform.outputHeight;
  const frame = computeFrame(width, height, aspect);
  const viewScale = frame.width / crop.width;
  const imageX = frame.x + frame.width / 2 - (crop.x + crop.width / 2) * viewScale;
  const imageY = frame.y + frame.height / 2 - (crop.y + crop.height / 2) * viewScale;
  return { width, height, crop, frame, viewScale, imageX, imageY, aspect };
}

function prepareCanvas(canvas, width, height, dpr) {
  const pixelWidth = Math.max(1, Math.round(width * dpr));
  const pixelHeight = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const context = canvas.getContext('2d');
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  return context;
}

function drawSourcePreview() {
  const rect = el.sourceWrap.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const context = prepareCanvas(el.sourceCanvas, width, height, dpr);

  if (!state.source) {
    updateEmptyStates();
    return;
  }

  const view = getSourceView();
  if (!view) return;

  context.imageSmoothingEnabled = false;
  context.drawImage(
    state.source.image,
    view.imageX,
    view.imageY,
    state.source.width * view.viewScale,
    state.source.height * view.viewScale,
  );

  // 图像边界（源图大于裁切框时帮助辨认）。
  context.save();
  context.strokeStyle = 'rgba(129, 148, 168, 0.28)';
  context.lineWidth = 1;
  context.strokeRect(
    view.imageX + 0.5,
    view.imageY + 0.5,
    Math.max(0, state.source.width * view.viewScale - 1),
    Math.max(0, state.source.height * view.viewScale - 1),
  );
  context.restore();

  const { frame } = view;
  // 裁切框外压暗。
  context.save();
  context.fillStyle = 'rgba(4, 8, 12, 0.62)';
  context.fillRect(0, 0, width, Math.max(0, frame.y));
  context.fillRect(0, frame.y + frame.height, width, Math.max(0, height - frame.y - frame.height));
  context.fillRect(0, frame.y, Math.max(0, frame.x), frame.height);
  context.fillRect(frame.x + frame.width, frame.y, Math.max(0, width - frame.x - frame.width), frame.height);
  context.restore();

  // 输出框。
  context.save();
  context.strokeStyle = '#2dd4bf';
  context.lineWidth = 1.5;
  context.strokeRect(
    Math.round(frame.x) + 0.75,
    Math.round(frame.y) + 0.75,
    Math.max(0, Math.round(frame.width) - 1.5),
    Math.max(0, Math.round(frame.height) - 1.5),
  );
  context.strokeStyle = 'rgba(45, 212, 191, 0.22)';
  context.lineWidth = 1;
  context.strokeRect(
    Math.round(frame.x) - 2.5,
    Math.round(frame.y) - 2.5,
    Math.round(frame.width) + 5,
    Math.round(frame.height) + 5,
  );

  // 四角手柄。
  const handle = 8;
  context.strokeStyle = '#99f6e4';
  context.lineWidth = 2;
  const corners = [
    [frame.x, frame.y, 1, 1],
    [frame.x + frame.width, frame.y, -1, 1],
    [frame.x, frame.y + frame.height, 1, -1],
    [frame.x + frame.width, frame.y + frame.height, -1, -1],
  ];
  for (const [x, y, sx, sy] of corners) {
    context.beginPath();
    context.moveTo(x + sx * handle, y);
    context.lineTo(x, y);
    context.lineTo(x, y + sy * handle);
    context.stroke();
  }
  context.restore();

  // 尺寸标签。
  const label = `${state.transform.outputWidth} × ${state.transform.outputHeight}`;
  context.save();
  context.font = '600 10px "Cascadia Code", Consolas, monospace';
  const textWidth = context.measureText(label).width;
  const labelX = clamp(frame.x, 8, width - textWidth - 20);
  const labelY = Math.max(8, frame.y - 25);
  context.fillStyle = 'rgba(7, 13, 18, 0.88)';
  context.fillRect(labelX, labelY, textWidth + 12, 18);
  context.strokeStyle = 'rgba(45, 212, 191, 0.42)';
  context.strokeRect(labelX + 0.5, labelY + 0.5, textWidth + 11, 17);
  context.fillStyle = '#99f6e4';
  context.fillText(label, labelX + 6, labelY + 12.5);
  context.restore();

  updateEmptyStates();
}

function onPointerDown(event) {
  if (!state.source || event.button !== 0) return;
  const view = getSourceView();
  if (!view) return;
  dragState = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    scale: view.viewScale,
  };
  el.sourceCanvas.setPointerCapture?.(event.pointerId);
  el.sourceCanvas.classList.add('is-dragging');
  event.preventDefault();
}

function onPointerMove(event) {
  if (!dragState || event.pointerId !== dragState.pointerId || !state.source) return;
  const dx = event.clientX - dragState.x;
  const dy = event.clientY - dragState.y;
  if (dx === 0 && dy === 0) return;
  dragState.x = event.clientX;
  dragState.y = event.clientY;

  state.transform.offsetX -= dx / dragState.scale;
  state.transform.offsetY -= dy / dragState.scale;
  const constrained = constrainTransform(
    state.source.width,
    state.source.height,
    state.transform.outputWidth,
    state.transform.outputHeight,
    state.transform.scale,
    state.transform.offsetX,
    state.transform.offsetY,
  );
  Object.assign(state.transform, constrained);
  markDirty();
  updateSourceInfo();
  drawSourcePreview();
  scheduleRebuild(true);
}

function onPointerUp(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  dragState = null;
  el.sourceCanvas.classList.remove('is-dragging');
}

function onWheel(event) {
  if (!state.source) return;
  event.preventDefault();
  // 万一百分比输入框还在编辑，先失焦提交，避免旧文本在之后覆盖滚轮结果。
  if (document.activeElement === el.zoomInput) el.zoomInput.blur();
  const rect = el.sourceCanvas.getBoundingClientRect();
  const pointerX = event.clientX - rect.left;
  const pointerY = event.clientY - rect.top;
  if (pointerX < 0 || pointerY < 0 || pointerX > rect.width || pointerY > rect.height) return;

  const factor = wheelZoomFactor(event.deltaY, { shift: event.shiftKey });
  if (factor === 1) return;

  // 同一帧内累计滚轮因子，只做一次锚点缩放与重绘。
  if (pendingWheelZoom) {
    pendingWheelZoom.factor *= factor;
    pendingWheelZoom.pointerX = pointerX;
    pendingWheelZoom.pointerY = pointerY;
  } else {
    pendingWheelZoom = { factor, pointerX, pointerY };
  }
  if (wheelZoomQueued) return;
  wheelZoomQueued = true;
  requestAnimationFrame(flushWheelZoom);
}

function flushWheelZoom() {
  wheelZoomQueued = false;
  const pending = pendingWheelZoom;
  pendingWheelZoom = null;
  if (!pending || !state.source) return;

  const view = getSourceView();
  if (!view) return;
  const target = clampZoom(state.transform.scale * pending.factor);
  if (Math.abs(target - state.transform.scale) < 1e-6) {
    // 已到 10% / 1600% 边界：只同步显示，避免控件与实际值脱节。
    syncZoomControls();
    return;
  }

  const next = zoomAroundPoint({
    sourceWidth: state.source.width,
    sourceHeight: state.source.height,
    outputWidth: state.transform.outputWidth,
    outputHeight: state.transform.outputHeight,
    scale: state.transform.scale,
    offsetX: state.transform.offsetX,
    offsetY: state.transform.offsetY,
    newScale: target,
    pointerX: pending.pointerX,
    pointerY: pending.pointerY,
    frame: view.frame,
  });
  applyZoomTransform(next);
}

/* ---------- 缩放控制 ---------- */

/** 应用缩放结果：同步控件、按帧重绘预览与结果。 */
function applyZoomTransform(transform) {
  Object.assign(state.transform, transform);
  syncZoomControls();
  markDirty();
  scheduleSourceDraw();
  scheduleRebuild(true);
}

/** 以当前裁切中心为基准设置缩放（滑块 / 百分比输入 / 快捷键共用）。 */
function applySourceZoom(scale, offsetX = state.transform.offsetX, offsetY = state.transform.offsetY) {
  if (!state.source) return;
  const constrained = constrainTransform(
    state.source.width,
    state.source.height,
    state.transform.outputWidth,
    state.transform.outputHeight,
    clampZoom(scale),
    offsetX,
    offsetY,
  );
  applyZoomTransform(constrained);
}

/** -/+ 微调：direction > 0 放大；Shift（fine）时步长从 1.02 变 1.005。 */
function nudgeZoom(direction, fine = false) {
  if (!state.source) return;
  applySourceZoom(stepZoom(state.transform.scale, direction, fine));
}

/** 百分比输入框：回车或失焦时解析，非法输入回退到当前值。 */
function commitZoomInput() {
  if (!el.zoomInput) return;
  const next = parseZoomInput(el.zoomInput.value, state.transform.scale);
  el.zoomInput.value = formatZoomPercent(next);
  if (!state.source) return;
  if (Math.abs(next - state.transform.scale) > 1e-9) applySourceZoom(next);
}

/** 1:1：回到 100%，保留当前裁切中心。 */
function resetZoomOneToOne() {
  if (!state.source) return;
  applySourceZoom(1);
}

/** 适应窗口：让整张源图落入预览区并居中。 */
function fitSourceToView() {
  if (!state.source) return;
  const rect = el.sourceWrap.getBoundingClientRect();
  const scale = fitZoom(
    state.source.width,
    state.source.height,
    state.transform.outputWidth,
    state.transform.outputHeight,
    rect.width,
    rect.height,
  );
  applySourceZoom(scale, 0, 0);
}

/** 键盘 + / - / 0 / f 的实际动作。 */
function runZoomShortcut(action) {
  if (action === 'zoom-in') nudgeZoom(1);
  else if (action === 'zoom-out') nudgeZoom(-1);
  else if (action === 'reset') resetZoomOneToOne();
  else if (action === 'fit') fitSourceToView();
}

/** 重置裁切：100% 缩放并居中。 */
function resetCrop() {
  if (!state.source) return;
  applySourceZoom(1, 0, 0);
}

/* ---------- 重建管线 ---------- */

function geometrySignature() {
  if (!state.source) return '';
  const t = state.transform;
  return [
    state.source.uid,
    t.outputWidth,
    t.outputHeight,
    state.resample,
    t.scale.toFixed(6),
    t.offsetX.toFixed(4),
    t.offsetY.toFixed(4),
  ].join('|');
}

function quantSignature(geometryKey) {
  return [
    geometryKey || geometrySignature(),
    state.colorMode,
    state.threshold,
    state.maxColors,
    state.dither ? 1 : 0,
  ].join('|');
}

function scheduleRebuild() {
  if (!state.source) {
    updateEmptyStates();
    return;
  }
  setBusy(true);
  if (rebuildQueued) return;
  rebuildQueued = true;
  requestAnimationFrame(() => {
    rebuildQueued = false;
    rebuildPipeline();
  });
}

function rebuildPipeline() {
  if (!state.source) {
    updateEmptyStates();
    updateActionAvailability();
    setBusy(false);
    return;
  }

  const totalStart = performance.now();
  let resampleTime = 0;
  let quantizeTime = 0;
  let composeTime = 0;

  try {
    const geometryKey = geometrySignature();
    let resampled;
    let crop;

    if (geometryKey !== cache.geometryKey || !cache.resampled) {
      const start = performance.now();
      const result = resampleOutput(state.source.imageData, state.transform, state.resample);
      resampled = result.image;
      crop = result.crop;
      cache.resampled = resampled;
      cache.crop = crop;
      cache.model = createColorModel(resampled);
      cache.geometryKey = geometryKey;
      cache.quantKey = null;
      cache.quantized = null;
      resampleTime = performance.now() - start;
    } else {
      resampled = cache.resampled;
      crop = cache.crop;
    }

    const qKey = quantSignature(geometryKey);
    if (qKey !== cache.quantKey || !cache.quantized) {
      const start = performance.now();
      cache.quantized = quantize(resampled, {
        mode: state.colorMode,
        threshold: state.threshold,
        maxColors: state.maxColors,
        dither: state.dither,
        model: cache.model,
      });
      cache.quantKey = qKey;
      quantizeTime = performance.now() - start;
    }

    const composeStart = performance.now();
    finalPalette.length = 0;
    finalPalette.push(...resolvePalette(cache.quantized.palette, state.recolorMap));
    const composed = composeOutput(resampled, cache.quantized, finalPalette);
    outputImageData = composed;
    ensureOutputCanvas(composed.width, composed.height);
    const context = outputCanvas.getContext('2d');
    const imageData = new ImageData(new Uint8ClampedArray(composed.data), composed.width, composed.height);
    context.putImageData(imageData, 0, 0);
    drawResultScaled();
    composeTime = performance.now() - composeStart;

    lastTimings = {
      resample: resampleTime,
      quantize: quantizeTime,
      compose: composeTime,
      total: performance.now() - totalStart,
    };

    updateTimingText();
    updateSourceInfo(crop);
    updateOutputInfo();
    updateExportMeta();
    renderPalette();
    updateEmptyStates();
    updateActionAvailability();
    updateProjectState();
    updateAspectLabel();
    setBusy(false);
    el.topStatus.textContent = `${state.transform.outputWidth}×${state.transform.outputHeight} · ${finalPalette.length} 色`;
    setStatus('预览已更新');
    if (cache.quantized.approximate) {
      el.approxState.title = '颜色数量过多，本次结果做了近似处理以保持操作流畅';
    } else {
      el.approxState.removeAttribute('title');
    }
  } catch (error) {
    console.error(error);
    setBusy(false);
    setStatus('更新失败');
    showToast(`预览更新失败：${error.message}。请重试。`, 'error', 5500);
  }
}

function ensureOutputCanvas(width, height) {
  if (!outputCanvas) outputCanvas = document.createElement('canvas');
  if (outputCanvas.width !== width || outputCanvas.height !== height) {
    outputCanvas.width = width;
    outputCanvas.height = height;
  }
}

function drawResultScaled() {
  if (!outputCanvas || !state.source) {
    el.resultCanvas.hidden = true;
    return;
  }
  const zoom = state.resultZoom;
  const width = outputCanvas.width * zoom;
  const height = outputCanvas.height * zoom;
  el.resultCanvas.hidden = false;
  if (el.resultCanvas.width !== width || el.resultCanvas.height !== height) {
    el.resultCanvas.width = width;
    el.resultCanvas.height = height;
  }
  const context = el.resultCanvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, width, height);
  context.drawImage(outputCanvas, 0, 0, width, height);
  el.resultTip.textContent = `${zoom}× 最近邻放大 · 实际 ${outputCanvas.width}×${outputCanvas.height}`;
}

function centerResultScroll() {
  requestAnimationFrame(() => {
    el.resultScroll.scrollLeft = Math.max(0, (el.resultScroll.scrollWidth - el.resultScroll.clientWidth) / 2);
    el.resultScroll.scrollTop = Math.max(0, (el.resultScroll.scrollHeight - el.resultScroll.clientHeight) / 2);
  });
}

/* ---------- 改色 ---------- */

function scheduleRecolorRefresh() {
  if (recolorQueued) return;
  recolorQueued = true;
  requestAnimationFrame(() => {
    recolorQueued = false;
    refreshRecolorOnly();
  });
}

function refreshRecolorOnly() {
  if (!cache.quantized || !cache.resampled) return;
  const start = performance.now();
  finalPalette.length = 0;
  finalPalette.push(...resolvePalette(cache.quantized.palette, state.recolorMap));
  const composed = composeOutput(cache.resampled, cache.quantized, finalPalette);
  outputImageData = composed;
  ensureOutputCanvas(composed.width, composed.height);
  const context = outputCanvas.getContext('2d');
  context.putImageData(new ImageData(new Uint8ClampedArray(composed.data), composed.width, composed.height), 0, 0);
  drawResultScaled();
  renderPalette();
  updateOutputInfo();
  updateExportMeta();
  updateActionAvailability();
  updateProjectState();
  const composeTime = performance.now() - start;
  lastTimings = {
    ...lastTimings,
    compose: composeTime,
    total: lastTimings.resample + lastTimings.quantize + composeTime,
  };
  updateTimingText();
}

function pushHistory(snapshot) {
  recolorHistory.push({ ...snapshot });
  if (recolorHistory.length > MAX_UNDO) recolorHistory.shift();
  updateActionAvailability();
}

function undoRecolor() {
  if (!recolorHistory.length) return;
  state.recolorMap = recolorHistory.pop();
  markDirty();
  refreshRecolorOnly();
  updateActionAvailability();
  showToast('已撤销上一次改色');
}

function resetRecolor() {
  if (!Object.keys(state.recolorMap).length) return;
  pushHistory(state.recolorMap);
  state.recolorMap = {};
  markDirty();
  refreshRecolorOnly();
  updateActionAvailability();
  showToast('已还原为自动配色');
}

function openPalettePicker(index) {
  const entry = finalPalette[index];
  if (!entry) return;
  pickerSession = {
    sourceHex: entry.sourceHex,
    snapshot: { ...state.recolorMap },
    changed: false,
  };
  el.colorPicker.value = entry.hex;
  el.colorPicker.click();
}

function importHexFile(file) {
  if (!state.source || !finalPalette.length) {
    showToast('请先导入图片，生成调色盘后再导入 HEX。', 'error');
    return;
  }
  file.text().then((text) => {
    const colors = parseHexPalette(text);
    if (!colors.length) {
      showToast('文件中没有有效的 HEX 颜色，请检查文件内容。', 'error');
      return;
    }
    pushHistory(state.recolorMap);
    state.recolorMap = {};
    const auto = cache.quantized.palette;
    const count = Math.min(colors.length, auto.length);
    for (let i = 0; i < count; i += 1) {
      const sourceHex = auto[i].hex;
      if (colors[i] !== sourceHex) state.recolorMap[sourceHex] = colors[i];
    }
    markDirty();
    refreshRecolorOnly();
    showToast(`已导入 ${colors.length} 个颜色，按顺序替换前 ${count} 个自动配色。`, 'success');
  }).catch((error) => {
    console.error(error);
    showToast(`读取调色盘失败：${error.message}。请检查文件内容。`, 'error');
  });
}

function exportHexPalette() {
  if (!finalPalette.length) {
    showToast('当前没有可导出的颜色', 'error');
    return;
  }
  const text = formatHexPalette(finalPalette);
  const count = text ? text.split('\n').length : 0;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const base = state.source?.baseName || 'pixel-art';
  downloadBlob(blob, `${base}_palette.hex`);
  showToast(`已导出 ${count} 个 HEX 颜色`, 'success');
}

/* ---------- 渲染信息 ---------- */

function updateSourceInfo(crop = currentCrop()) {
  if (!state.source) {
    el.srcInfoBadge.textContent = '未导入';
    el.srcDims.textContent = '源图 —';
    el.srcZoom.textContent = '缩放 100%';
    el.srcOffset.textContent = '偏移 0.0, 0.0';
    el.srcCrop.textContent = '裁切 —';
    return;
  }
  const t = state.transform;
  el.srcInfoBadge.textContent = `${state.source.width}×${state.source.height}`;
  el.srcDims.textContent = `源图 ${state.source.width} × ${state.source.height} px`;
  el.srcZoom.textContent = `缩放 ${formatZoomPercent(t.scale)}`;
  el.srcOffset.textContent = `偏移 ${t.offsetX.toFixed(1)}, ${t.offsetY.toFixed(1)}`;
  if (crop) {
    el.srcCrop.textContent = `裁切 ${crop.width.toFixed(1)} × ${crop.height.toFixed(1)}`;
  }
}

function updateOutputInfo() {
  const t = state.transform;
  el.outDims.textContent = `输出 ${t.outputWidth} × ${t.outputHeight}`;
  el.pixelCount.textContent = `${t.outputWidth * t.outputHeight} 像素`;
  const crop = currentCrop();
  if (crop) {
    el.outCrop.textContent = `裁切 ${crop.width.toFixed(1)} × ${crop.height.toFixed(1)}`;
  } else {
    el.outCrop.textContent = '裁切 —';
  }
  el.resultColors.textContent = `${finalPalette.length} 色`;
  el.colorCount.textContent = String(finalPalette.length);
  if (cache.quantized) {
    el.approxState.textContent = cache.quantized.approximate ? '近似' : '精确';
  } else {
    el.approxState.textContent = '精确';
  }
  el.paletteCount.textContent = `${finalPalette.length} 色`;
  if (finalPalette.length) {
    const changed = finalPalette.filter((entry) => entry.changed).length;
    if (cache.quantized?.approximate) {
      el.paletteHint.textContent = '近似';
    } else if (changed) {
      el.paletteHint.textContent = `已改色 ${changed}`;
    } else {
      el.paletteHint.textContent = state.colorMode === 'target' ? `目标 ${state.maxColors} 色` : '自动配色';
    }
  } else {
    el.paletteHint.textContent = '自动配色';
  }
}

function updateExportMeta() {
  const base = state.source?.baseName || 'pixel-art';
  const factor = Number(el.exportScale.value) || 1;
  const meta = buildExportMeta(base, state.transform, factor, finalPalette.length);
  el.exportFilename.textContent = meta.filename;
  el.exportStats.textContent = meta.stats;
}

function updateTimingText() {
  const { resample, quantize, compose, total } = lastTimings;
  el.timingText.textContent = `重采样 ${resample.toFixed(1)} 毫秒 · 色阶简化 ${quantize.toFixed(1)} 毫秒 · 合成 ${compose.toFixed(1)} 毫秒 · 总计 ${total.toFixed(1)} 毫秒`;
}

function updateEmptyStates() {
  const hasSource = Boolean(state.source);
  el.sourceEmpty.classList.toggle('is-hidden', hasSource);
  el.resultEmpty.classList.toggle('is-hidden', hasSource && Boolean(cache.quantized));
  el.resultCanvas.hidden = !(hasSource && cache.quantized);
  el.paletteEmpty.classList.toggle('is-hidden', finalPalette.length > 0);
  el.paletteList.classList.toggle('is-hidden', finalPalette.length === 0);
}

function updateActionAvailability() {
  const hasSource = Boolean(state.source);
  const hasResult = Boolean(cache.quantized);
  el.btnSaveProject.disabled = !hasSource || !hasResult;
  el.btnExportPng.disabled = !hasSource || !hasResult;
  el.btnExportPalette.disabled = !hasSource || !hasResult;
  el.btnImportHex.disabled = !hasSource || !hasResult;
  el.btnExportHex.disabled = !hasSource || !hasResult;
  el.btnUndoRecolor.disabled = recolorHistory.length === 0;
  el.btnResetRecolor.disabled = Object.keys(state.recolorMap).length === 0;
}

/* ---------- 调色盘 ---------- */

function renderPalette() {
  const token = ++paletteRenderToken;
  const total = finalPalette.length;
  const scrollTop = el.paletteList.scrollTop;
  el.paletteList.replaceChildren();

  el.paletteCount.textContent = `${total} 色`;
  updateEmptyStates();
  if (!total) return;

  const chunkSize = total > 1200 ? 240 : 600;
  let index = 0;
  let firstChunk = true;

  const appendChunk = () => {
    if (token !== paletteRenderToken) return;
    const fragment = document.createDocumentFragment();
    const end = Math.min(total, index + chunkSize);
    for (; index < end; index += 1) {
      fragment.appendChild(buildSwatchCard(finalPalette[index], index));
    }
    el.paletteList.appendChild(fragment);
    if (firstChunk) {
      el.paletteList.scrollTop = scrollTop;
      firstChunk = false;
    }
    if (index < total) {
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(appendChunk, { timeout: 160 });
      } else {
        setTimeout(appendChunk, 0);
      }
    }
  };

  appendChunk();
}

function buildSwatchCard(entry, index) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = `swatch-card${entry.changed ? ' is-changed' : ''}`;
  card.dataset.index = String(index);
  card.title = entry.changed
    ? `自动 ${entry.sourceHex.toUpperCase()} → ${entry.hex.toUpperCase()} · 点击改色`
    : `${entry.hex.toUpperCase()} · 点击改色`;

  const chip = document.createElement('span');
  chip.className = 'swatch-chip';
  chip.style.background = `rgb(${entry.r} ${entry.g} ${entry.b})`;

  const copy = document.createElement('span');
  copy.className = 'swatch-copy';
  const hex = document.createElement('span');
  hex.className = 'swatch-hex';
  hex.textContent = entry.hex.toUpperCase();
  const ratio = document.createElement('span');
  ratio.className = 'swatch-ratio';
  ratio.textContent = `${formatPercent(entry.ratio)} · ${entry.count} px`;
  copy.append(hex, ratio);
  card.append(chip, copy);
  return card;
}

/* ---------- 同步控件 ---------- */

function syncAllControls() {
  syncOutputInputs();
  syncZoomControls();
  el.lockAspect.checked = state.lockAspect;
  updateAspectLabel();
  el.resampleSelect.value = state.resample;
  updateResampleDescription();
  for (const radio of document.querySelectorAll('input[name="colorMode"]')) {
    radio.checked = radio.value === state.colorMode;
  }
  updateModeUI();
  updateThresholdUI();
  el.targetColors.value = String(state.maxColors);
  el.ditherToggle.checked = state.dither;
  el.exportScale.value = String(state.exportScale);
  syncResultZoomButtons();
  updateExportMeta();
  updateActionAvailability();
}

function syncOutputInputs() {
  el.outW.value = String(state.transform.outputWidth);
  el.outH.value = String(state.transform.outputHeight);
}

function syncZoomControls() {
  const scale = state.transform.scale;
  const sliderValue = Math.round(zoomToSlider(scale));
  el.zoomRange.value = String(sliderValue);
  timelineValue(el.zoomRange, sliderValue);
  // 用户正在输入百分比时不要覆盖输入框内容。
  if (el.zoomInput && document.activeElement !== el.zoomInput) {
    el.zoomInput.value = formatZoomPercent(scale);
  }
  updateSourceInfo();
}

function updateAspectLabel() {
  el.aspectLabel.textContent = aspectLabel(state.transform.outputWidth, state.transform.outputHeight);
}

function updateResampleDescription() {
  const method = RESAMPLE_METHODS.find((item) => item.id === state.resample) || RESAMPLE_METHODS[0];
  el.resampleDesc.textContent = method.description;
}

function updateModeUI() {
  const isTarget = state.colorMode === 'target';
  el.thresholdGroup.classList.toggle('is-hidden', isTarget);
  el.targetGroup.classList.toggle('is-hidden', !isTarget);
}

function updateThresholdUI() {
  el.thresholdRange.value = String(state.threshold);
  el.thresholdValue.textContent = String(Math.round(state.threshold));
  timelineValue(el.thresholdRange, state.threshold);
}

function syncResultZoomButtons() {
  for (const button of el.resultZoomGroup.querySelectorAll('button[data-zoom]')) {
    button.classList.toggle('is-active', Number(button.dataset.zoom) === state.resultZoom);
  }
}

/* ---------- 导出 ---------- */

function canvasToBlob(canvas, type = 'image/png') {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== 'function') {
      reject(new Error('浏览器不支持 Canvas 导出'));
      return;
    }
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('PNG 编码失败'));
    }, type);
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // 提前回收会让部分浏览器的大文件下载中断，留出足够时间。
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

async function exportPng() {
  if (!outputCanvas || !state.source) {
    showToast('请先导入图片并生成结果', 'error');
    return;
  }
  const factor = Number(el.exportScale.value) || 1;
  const width = outputCanvas.width * factor;
  const height = outputCanvas.height * factor;

  if (width * height > LARGE_EXPORT_PIXELS) {
    const okay = window.confirm(
      `即将导出 ${width}×${height}（约 ${(width * height / 1_000_000).toFixed(1)} 百万像素）的文件，`
      + '浏览器可能因内存不足而失败。是否继续？',
    );
    if (!okay) return;
  }

  try {
    setBusy(true);
    setStatus('正在导出 PNG…');
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = width;
    exportCanvas.height = height;
    const context = exportCanvas.getContext('2d');
    if (!context) throw new Error('浏览器无法创建导出图像，请减小输出尺寸后重试');
    context.imageSmoothingEnabled = false;
    context.drawImage(outputCanvas, 0, 0, width, height);
    let blob;
    try {
      blob = await canvasToBlob(exportCanvas);
    } catch (error) {
      // 极端浏览器无 toBlob 时使用内置无损 PNG 编码器兜底（文件会更大）。
      const upscaled = upscaleImage(outputImageData, factor);
      blob = new Blob([encodePNG(upscaled)], { type: 'image/png' });
    }
    const filename = buildExportFilename(state.source.baseName, state.transform.outputWidth, state.transform.outputHeight, factor);
    downloadBlob(blob, filename);
    showToast(`已导出 ${filename} · ${formatBytes(blob.size)}`, 'success', 4200);
  } catch (error) {
    console.error(error);
    showToast(`导出失败：${error.message}。请重试。`, 'error', 5000);
  } finally {
    setBusy(false);
    setStatus('预览已更新');
  }
}

async function exportPalettePng() {
  if (!finalPalette.length) {
    showToast('当前没有可导出的颜色', 'error');
    return;
  }
  try {
    const count = finalPalette.length;
    const cellSize = count > 512 ? 20 : count > 128 ? 32 : 48;
    const strip = makePaletteStrip(finalPalette, {
      cellSize,
      gap: 3,
      columns: Math.min(16, count),
      background: '#0b0f14',
    });
    const canvas = document.createElement('canvas');
    canvas.width = strip.width;
    canvas.height = strip.height;
    const context = canvas.getContext('2d');
    context.putImageData(new ImageData(new Uint8ClampedArray(strip.data), strip.width, strip.height), 0, 0);
    const blob = await canvasToBlob(canvas);
    const filename = buildPaletteFilename(state.source?.baseName || 'pixel-art', count);
    downloadBlob(blob, filename);
    showToast(`已导出调色盘 ${filename}`, 'success');
  } catch (error) {
    console.error(error);
    showToast(`调色盘导出失败：${error.message}。请重试。`, 'error', 5000);
  }
}

/* ---------- 工程文件 ---------- */

function makeProjectText() {
  if (!state.source || !cache.quantized) throw new Error('当前没有可保存的内容，请先导入图片');
  const project = createProject({
    sourceImage: state.source.dataUrl,
    sourceWidth: state.source.width,
    sourceHeight: state.source.height,
    sourceName: state.source.name,
    transform: { ...state.transform },
    resample: state.resample,
    colorMode: state.colorMode,
    threshold: state.threshold,
    maxColors: state.maxColors,
    dither: state.dither,
    palette: cache.quantized.palette.map((entry) => entry.hex),
    recolorMap: { ...state.recolorMap },
    manualPalette: finalPalette.map((entry) => entry.hex),
    ui: {
      resultZoom: state.resultZoom,
      lockAspect: state.lockAspect,
      exportScale: state.exportScale,
      // 源图缩放百分比：恢复时优先使用，旧工程缺省时由 transform.scale 推导。
      sourceZoom: Math.round(zoomPercent(state.transform.scale) * 100) / 100,
    },
  }, {
    createdAt: state.createdAt,
    now: new Date(),
  });
  const text = serializeProject(project);
  return { project, text };
}

function saveProject() {
  try {
    const { project, text } = makeProjectText();
    const bytes = projectSizeBytes(text);
    if (bytes > LARGE_PROJECT_BYTES) {
      const okay = window.confirm(
        `工程文件约 ${formatBytes(bytes)}，体积主要来自内嵌的源图。\n`
        + '文件较大，是否继续保存？',
      );
      if (!okay) return;
    }
    const filename = buildProjectFilename(state.source.baseName);
    downloadBlob(new Blob([text], { type: 'application/json;charset=utf-8' }), filename);
    state.createdAt = project.createdAt;
    state.updatedAt = project.updatedAt;
    state.dirty = false;
    updateProjectState();
    updateActionAvailability();
    showToast(`工程已保存：${filename} · ${formatBytes(bytes)}`, 'success', 4200);
  } catch (error) {
    console.error(error);
    showToast(`保存工程失败：${error.message}。请重试。`, 'error', 5000);
  }
}

/* ---------- 拖拽 / 粘贴 / 快捷键 ---------- */

function onDragEnter(event) {
  if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
  event.preventDefault();
  dragDepth += 1;
  el.dropOverlay.classList.add('is-active');
}

function onDragOver(event) {
  if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
}

function onDragLeave(event) {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) el.dropOverlay.classList.remove('is-active');
}

function onDrop(event) {
  event.preventDefault();
  dragDepth = 0;
  el.dropOverlay.classList.remove('is-active');
  const files = Array.from(event.dataTransfer?.files || []);
  if (!files.length) return;
  const project = files.find((file) => isProjectFile(file));
  if (project) {
    openProjectFile(project);
    return;
  }
  const image = files.find((file) => isImageFile(file));
  if (image) {
    importAnyFile(image);
    return;
  }
  showToast('拖入的文件不是图片，也不是工程文件，请重新选择。', 'error');
}

function onPaste(event) {
  const items = event.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (!item.type?.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (!file) continue;
    event.preventDefault();
    importAnyFile(new File([file], defaultClipboardName(file.type), { type: file.type }));
    return;
  }
}

function onKeyDown(event) {
  const target = event.target;
  const editing = target instanceof HTMLElement
    && (target.matches('input, textarea, select') || target.isContentEditable);
  const modifier = event.ctrlKey || event.metaKey;

  // 无修饰键的缩放快捷键：+ / - / 0 / f（输入框聚焦时不触发）。
  if (!modifier) {
    const action = zoomShortcut(event, editing);
    if (!action) return;
    event.preventDefault();
    runZoomShortcut(action);
    return;
  }

  const key = event.key.toLowerCase();

  if (key === 's') {
    event.preventDefault();
    saveProject();
    return;
  }
  if (key === 'o') {
    event.preventDefault();
    el.fileProject.click();
    return;
  }
  if (key === 'z' && !editing) {
    event.preventDefault();
    undoRecolor();
  }
}

/* ---------- 调试 / 自动化验收接口 ---------- */

function getDebugState() {
  return {
    source: state.source
      ? {
        name: state.source.name,
        width: state.source.width,
        height: state.source.height,
      }
      : null,
    transform: { ...state.transform },
    resample: state.resample,
    colorMode: state.colorMode,
    threshold: state.threshold,
    maxColors: state.maxColors,
    dither: state.dither,
    recolorMap: { ...state.recolorMap },
    resultZoom: state.resultZoom,
    colors: finalPalette.length,
    approximate: Boolean(cache.quantized?.approximate),
    timings: { ...lastTimings },
    palette: finalPalette.map((entry) => ({
      hex: entry.hex,
      sourceHex: entry.sourceHex,
      count: entry.count,
      ratio: entry.ratio,
      changed: entry.changed,
    })),
    dirty: state.dirty,
  };
}

function exposeDebugApi() {
  window.__PIXFIX__ = {
    getState: getDebugState,
    getProjectText: () => makeProjectText().text,
    async importDataUrl(dataUrl, name = '测试图.png') {
      await installSource(dataUrl, name, { reset: true });
      return getDebugState();
    },
    async loadProjectText(text, { quiet = true } = {}) {
      const project = await loadProjectText(text, { quiet });
      return { project, state: getDebugState() };
    },
    setThreshold(value) {
      state.colorMode = 'threshold';
      state.threshold = clamp(Number(value) || 0, 0, 100);
      syncAllControls();
      markDirty();
      rebuildPipeline();
      return getDebugState();
    },
    setTargetColors(value) {
      state.colorMode = 'target';
      syncAllControls();
      state.maxColors = clamp(Math.round(Number(value) || 16), 2, 256);
      el.targetColors.value = String(state.maxColors);
      markDirty();
      rebuildPipeline();
      return getDebugState();
    },
    setResample(value) {
      state.resample = isValidResample(value) ? value : 'nearest';
      syncAllControls();
      markDirty();
      rebuildPipeline();
      return getDebugState();
    },
    setOutputSize(width, height) {
      state.transform.outputWidth = normalizeOutputSize(width);
      state.transform.outputHeight = normalizeOutputSize(height);
      state.aspectRatio = state.transform.outputWidth / state.transform.outputHeight;
      syncOutputInputs();
      updateAspectLabel();
      drawSourcePreview();
      markDirty();
      rebuildPipeline();
      return getDebugState();
    },
    setSourceZoom(percent) {
      applySourceZoom(clampZoom(Number(percent) / 100));
      return getDebugState();
    },
    zoomToFit() {
      fitSourceToView();
      return getDebugState();
    },
    setPaletteColor(sourceHex, targetHex) {
      const source = normalizeHex(sourceHex);
      const target = normalizeHex(targetHex);
      if (!source || !target) throw new Error('HEX 颜色无效');
      if (source === target) delete state.recolorMap[source];
      else state.recolorMap[source] = target;
      markDirty();
      refreshRecolorOnly();
      return getDebugState();
    },
    resetPalette() {
      state.recolorMap = {};
      recolorHistory.length = 0;
      markDirty();
      refreshRecolorOnly();
      return getDebugState();
    },
    getTimings: () => ({ ...lastTimings }),
    getResultDataUrl(factor = 1) {
      if (!outputCanvas) throw new Error('尚无结果');
      const scale = Math.max(1, Math.min(16, Math.round(factor)));
      const canvas = document.createElement('canvas');
      canvas.width = outputCanvas.width * scale;
      canvas.height = outputCanvas.height * scale;
      const context = canvas.getContext('2d');
      context.imageSmoothingEnabled = false;
      context.drawImage(outputCanvas, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    },
  };
}

/* ---------- 启动 ---------- */

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
