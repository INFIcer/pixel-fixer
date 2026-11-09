// 颜色基础工具：sRGB / Lab 转换、HEX 解析与格式化。
// 本文件不依赖 DOM，可在浏览器与 Node 中直接复用。

const D65_X = 0.95047;
const D65_Y = 1.0;
const D65_Z = 1.08883;

/** 四舍五入并限制到 0~255。 */
export function clampByte(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** 限制数值范围。 */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** RGB 转 #rrggbb（统一小写，便于作为映射键）。 */
export function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((v) => clampByte(v).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * 解析 #rgb / #rrggbb / rgb 三种写法。
 * @returns {{r:number,g:number,b:number}|null}
 */
export function hexToRgb(hex) {
  if (typeof hex !== 'string') return null;
  let value = hex.trim().toLowerCase();
  if (value.startsWith('#')) value = value.slice(1);
  if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/.test(value)) return null;
  if (value.length === 3) {
    value = value.split('').map((c) => c + c).join('');
  }
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

/** 规范化为小写 #rrggbb；非法输入返回 null。 */
export function normalizeHex(hex) {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHex(rgb.r, rgb.g, rgb.b) : null;
}

/** 感知亮度（用于排序和文字对比，不是 Lab 的 L）。 */
export function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function srgbToLinear(value) {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value) {
  const c = value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
  return c * 255;
}

function labF(t) {
  return t > 0.008856451679035631 ? Math.cbrt(t) : (903.2962962962963 * t + 16) / 116;
}

function labFInv(t) {
  const t3 = t ** 3;
  return t3 > 0.008856451679035631 ? t3 : (116 * t - 16) / 903.2962962962963;
}

/**
 * sRGB → CIELAB（D65）。
 * @returns {[number, number, number]}
 */
export function rgbToLab(r, g, b) {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const x = (lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375) / D65_X;
  const y = (lr * 0.2126729 + lg * 0.7151522 + lb * 0.072175) / D65_Y;
  const z = (lr * 0.0193339 + lg * 0.119192 + lb * 0.9503041) / D65_Z;

  const fx = labF(x);
  const fy = labF(y);
  const fz = labF(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/**
 * CIELAB → sRGB（可能越界，最终钳制到 0~255）。
 * @returns {[number, number, number]}
 */
export function labToRgb(L, a, b) {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;

  const x = labFInv(fx) * D65_X;
  const y = labFInv(fy) * D65_Y;
  const z = labFInv(fz) * D65_Z;

  const lr = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
  const lg = x * -0.969266 + y * 1.8760108 + z * 0.041556;
  const lb = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;

  return [clampByte(linearToSrgb(lr)), clampByte(linearToSrgb(lg)), clampByte(linearToSrgb(lb))];
}

/** CIE76 色差。 */
export function labDistance(a, b) {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dl * dl + da * da + db * db);
}

/** CIE76 色差平方（避免开方，用于比较）。 */
export function labDistanceSq(a, b) {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return dl * dl + da * da + db * db;
}

/**
 * 解析每行一个 HEX 的调色板文本。
 * 支持 #rgb、#rrggbb，忽略空行、// 注释、; 注释与行尾注释。
 * 保持输入顺序并去重。
 * @returns {string[]}
 */
export function parseHexPalette(text) {
  if (typeof text !== 'string') return [];
  const seen = new Set();
  const result = [];
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('//') || line.startsWith(';')) continue;
    line = line.replace(/\s+\/\/.*$/, '').replace(/\s+;.*$/, '');
    const match = line.match(/(?:^|\s)(#?[0-9a-fA-F]{3}|#?[0-9a-fA-F]{6})(?=$|\s|,)/);
    if (!match) continue;
    const hex = normalizeHex(match[1]);
    if (hex && !seen.has(hex)) {
      seen.add(hex);
      result.push(hex);
    }
  }
  return result;
}

/** 把 HEX 数组格式化为每行一个的文本（大写、去重，易读）。 */
export function formatHexPalette(colors) {
  const seen = new Set();
  const lines = [];
  for (const color of colors || []) {
    const hex = normalizeHex(typeof color === 'string' ? color : color?.hex);
    if (!hex || seen.has(hex)) continue;
    seen.add(hex);
    lines.push(hex.toUpperCase());
  }
  return lines.join('\n');
}
