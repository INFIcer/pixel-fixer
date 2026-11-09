/* 自动生成：由 tools/build-standalone.js 从 src/*.js 生成，请勿直接编辑。
 * 用途：file:// 下 Chromium 不允许加载跨文件 ES module 时的兼容入口。
 * 修改源码后运行：node tools/build-standalone.js
 */
(function () {
  "use strict";

  const __definitions = new Map();
  const __cache = new Map();

  function __define(name, factory) {
    __definitions.set(name, factory);
  }

  function __require(name) {
    if (__cache.has(name)) return __cache.get(name);
    const factory = __definitions.get(name);
    if (!factory) throw new Error("standalone 模块缺失：" + name);
    const exports = {};
    __cache.set(name, exports);
    factory(exports, __require);
    return exports;
  }

  __define("color", function (__exports, __require) {
    "use strict";
    // 颜色基础工具：sRGB / Lab 转换、HEX 解析与格式化。
    // 本文件不依赖 DOM，可在浏览器与 Node 中直接复用。

    const D65_X = 0.95047;
    const D65_Y = 1.0;
    const D65_Z = 1.08883;

    /** 四舍五入并限制到 0~255。 */
    function clampByte(value) {
      if (!Number.isFinite(value)) return 0;
      return Math.max(0, Math.min(255, Math.round(value)));
    }

    /** 限制数值范围。 */
    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    /** RGB 转 #rrggbb（统一小写，便于作为映射键）。 */
    function rgbToHex(r, g, b) {
      return `#${[r, g, b].map((v) => clampByte(v).toString(16).padStart(2, '0')).join('')}`;
    }

    /**
     * 解析 #rgb / #rrggbb / rgb 三种写法。
     * @returns {{r:number,g:number,b:number}|null}
     */
    function hexToRgb(hex) {
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
    function normalizeHex(hex) {
      const rgb = hexToRgb(hex);
      return rgb ? rgbToHex(rgb.r, rgb.g, rgb.b) : null;
    }

    /** 感知亮度（用于排序和文字对比，不是 Lab 的 L）。 */
    function luminance(r, g, b) {
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
    function rgbToLab(r, g, b) {
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
    function labToRgb(L, a, b) {
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
    function labDistance(a, b) {
      const dl = a[0] - b[0];
      const da = a[1] - b[1];
      const db = a[2] - b[2];
      return Math.sqrt(dl * dl + da * da + db * db);
    }

    /** CIE76 色差平方（避免开方，用于比较）。 */
    function labDistanceSq(a, b) {
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
    function parseHexPalette(text) {
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
    function formatHexPalette(colors) {
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

    Object.assign(__exports, { clampByte, clamp, rgbToHex, hexToRgb, normalizeHex, luminance, rgbToLab, labToRgb, labDistance, labDistanceSq, parseHexPalette, formatHexPalette });
  });

  __define("resample", function (__exports, __require) {
    "use strict";
    // 重采样核心：最近邻、双线性、双三次、Lanczos3、区域平均。
    // 输入输出都是普通对象 {data,width,height}，不依赖 DOM / ImageData 构造器。

    const RESAMPLE_METHODS = Object.freeze([
      {
        id: 'nearest',
        name: '最近邻',
        short: '保留原始色块，像素画首选',
        description: '直接取最近的源像素，不产生新颜色。适合已经对齐的像素画。',
      },
      {
        id: 'bilinear',
        name: '双线性',
        short: '柔和，会生成过渡色',
        description: '按相邻像素线性混合；缩放后边缘略软，容易产生过渡色。',
      },
      {
        id: 'bicubic',
        name: '双三次',
        short: '更平滑，边缘更自然',
        description: '在双线性基础上进一步平滑；边缘更柔和，也更容易出现过渡色和轻微光晕。',
      },
      {
        id: 'lanczos3',
        name: 'Lanczos3',
        short: '锐利，细节保留好',
        description: '细节保留更锐利；缩小后边缘可能出现轻微光晕。',
      },
      {
        id: 'area',
        name: '区域平均',
        short: '按覆盖面积取平均，适合缩小',
        description: '按覆盖面积取平均；缩小最稳定，放大后边缘会偏软。',
      },
    ]);

    const VALID_METHODS = new Set(RESAMPLE_METHODS.map((item) => item.id));

    function isValidResample(method) {
      return VALID_METHODS.has(method);
    }

    function clamp01(value) {
      return Math.max(0, Math.min(1, value));
    }

    function byte(value) {
      return Math.max(0, Math.min(255, Math.round(value)));
    }

    function makeOutput(width, height) {
      return {
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
      };
    }

    function validate(image, crop, width, height, method) {
      if (!image || !image.data || !Number.isInteger(image.width) || !Number.isInteger(image.height)) {
        throw new TypeError('源图数据无效');
      }
      if (image.data.length !== image.width * image.height * 4) {
        throw new TypeError('源图像素长度与尺寸不一致');
      }
      if (!crop || !Number.isFinite(crop.x) || !Number.isFinite(crop.y)
        || !(crop.width > 0) || !(crop.height > 0)) {
        throw new TypeError('裁切区域无效');
      }
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
        throw new TypeError('输出尺寸无效');
      }
      if (!isValidResample(method)) {
        throw new TypeError(`未知的重采样算法：${method}`);
      }
    }

    /** 双三次 Catmull-Rom 核。 */
    function cubicKernel(x) {
      const ax = Math.abs(x);
      if (ax < 1) return (1.5 * ax - 2.5) * ax * ax + 1;
      if (ax < 2) return ((-0.5 * ax + 2.5) * ax - 4) * ax + 2;
      return 0;
    }

    function sinc(x) {
      if (Math.abs(x) < 1e-8) return 1;
      const px = Math.PI * x;
      return Math.sin(px) / px;
    }

    function lanczos3Kernel(x) {
      const ax = Math.abs(x);
      if (ax >= 3) return 0;
      return sinc(x) * sinc(x / 3);
    }

    const KERNELS = {
      bilinear: { radius: 1, fn: (x) => Math.max(0, 1 - Math.abs(x)) },
      bicubic: { radius: 2, fn: cubicKernel },
      lanczos3: { radius: 3, fn: lanczos3Kernel },
    };

    /**
     * 为某个输出轴预计算卷积权重。
     * 坐标约定：输出像素中心 (i + 0.5) 映射到源图连续坐标 cropStart + (i + 0.5) * scale - 0.5。
     * 缩小时按缩放倍率扩大核半径做抗锯齿。
     */
    function buildContributions(cropStart, cropSize, outSize, srcSize, radius, kernel) {
      const scale = cropSize / outSize;
      // 缩小时扩大核做抗锯齿，但把支持半径限制在 2x，避免 1024→64 时
      // Lanczos3 一次检查上百个样本导致预览卡顿。需要极限缩小质量时使用“区域平均”。
      const filterScale = Math.max(1, Math.min(2, scale));
      const support = radius * filterScale;
      const result = new Array(outSize);

      for (let outIndex = 0; outIndex < outSize; outIndex += 1) {
        const center = cropStart + (outIndex + 0.5) * scale - 0.5;
        const start = Math.floor(center - support) + 1;
        const end = Math.ceil(center + support) - 1;
        const weights = [];

        for (let index = start; index <= end; index += 1) {
          const weight = kernel((index - center) / filterScale);
          if (Math.abs(weight) < 1e-8) continue;
          // 边缘钳制：把落在图外的权重折到最近的边缘像素，避免图像边缘透明化。
          const clamped = Math.max(0, Math.min(srcSize - 1, index));
          weights.push([clamped, weight]);
        }

        let sum = 0;
        for (const item of weights) sum += item[1];
        if (sum === 0) {
          weights.length = 0;
          weights.push([Math.max(0, Math.min(srcSize - 1, Math.round(center))), 1]);
        } else {
          for (const item of weights) item[1] /= sum;
        }
        result[outIndex] = weights;
      }
      return result;
    }

    function resampleKernel(image, crop, outWidth, outHeight, method) {
      const { radius, fn } = KERNELS[method];
      const xContrib = buildContributions(crop.x, crop.width, outWidth, image.width, radius, fn);
      const yContrib = buildContributions(crop.y, crop.height, outHeight, image.height, radius, fn);
      const output = makeOutput(outWidth, outHeight);
      const src = image.data;
      const dst = output.data;

      for (let oy = 0; oy < outHeight; oy += 1) {
        const sy = crop.y + (oy + 0.5) * (crop.height / outHeight) - 0.5;
        const outsideY = sy < -0.5 || sy > image.height - 0.5;
        const yWeights = yContrib[oy];

        for (let ox = 0; ox < outWidth; ox += 1) {
          const sx = crop.x + (ox + 0.5) * (crop.width / outWidth) - 0.5;
          const outsideX = sx < -0.5 || sx > image.width - 0.5;
          if (outsideX || outsideY) continue;

          const xWeights = xContrib[ox];
          let sumA = 0;
          let sumR = 0;
          let sumG = 0;
          let sumB = 0;

          for (const [iy, wy] of yWeights) {
            if (wy === 0) continue;
            const rowOffset = iy * image.width * 4;
            for (const [ix, wx] of xWeights) {
              const weight = wx * wy;
              if (weight === 0) continue;
              const index = rowOffset + ix * 4;
              const alpha = src[index + 3] / 255;
              if (alpha === 0) continue;
              const premult = alpha * weight;
              sumA += premult;
              sumR += src[index] * premult;
              sumG += src[index + 1] * premult;
              sumB += src[index + 2] * premult;
            }
          }

          const outIndex = (oy * outWidth + ox) * 4;
          if (sumA <= 1e-8) continue;
          dst[outIndex] = byte(sumR / sumA);
          dst[outIndex + 1] = byte(sumG / sumA);
          dst[outIndex + 2] = byte(sumB / sumA);
          dst[outIndex + 3] = byte(clamp01(sumA) * 255);
        }
      }
      return output;
    }

    /** 区域平均（box/area）。按覆盖面积精确加权，支持分数边界。 */
    function resampleArea(image, crop, outWidth, outHeight) {
      const output = makeOutput(outWidth, outHeight);
      const src = image.data;
      const dst = output.data;
      const scaleX = crop.width / outWidth;
      const scaleY = crop.height / outHeight;

      for (let oy = 0; oy < outHeight; oy += 1) {
        const y0 = crop.y + oy * scaleY;
        const y1 = y0 + scaleY;
        const iy0 = Math.floor(y0);
        const iy1 = Math.ceil(y1);
        const ySegments = [];
        for (let iy = iy0; iy < iy1; iy += 1) {
          const overlap = Math.min(y1, iy + 1) - Math.max(y0, iy);
          if (overlap > 0) ySegments.push([iy, overlap / scaleY]);
        }

        for (let ox = 0; ox < outWidth; ox += 1) {
          const x0 = crop.x + ox * scaleX;
          const x1 = x0 + scaleX;
          const ix0 = Math.floor(x0);
          const ix1 = Math.ceil(x1);
          const xSegments = [];
          for (let ix = ix0; ix < ix1; ix += 1) {
            const overlap = Math.min(x1, ix + 1) - Math.max(x0, ix);
            if (overlap > 0) xSegments.push([ix, overlap / scaleX]);
          }

          let sumA = 0;
          let sumR = 0;
          let sumG = 0;
          let sumB = 0;

          for (const [iy, wy] of ySegments) {
            if (iy < 0 || iy >= image.height) continue;
            const rowOffset = iy * image.width * 4;
            for (const [ix, wx] of xSegments) {
              if (ix < 0 || ix >= image.width) continue;
              const index = rowOffset + ix * 4;
              const alpha = src[index + 3] / 255;
              if (alpha === 0) continue;
              const premult = alpha * wx * wy;
              sumA += premult;
              sumR += src[index] * premult;
              sumG += src[index + 1] * premult;
              sumB += src[index + 2] * premult;
            }
          }

          const outIndex = (oy * outWidth + ox) * 4;
          if (sumA <= 1e-8) continue;
          dst[outIndex] = byte(sumR / sumA);
          dst[outIndex + 1] = byte(sumG / sumA);
          dst[outIndex + 2] = byte(sumB / sumA);
          dst[outIndex + 3] = byte(clamp01(sumA) * 255);
        }
      }
      return output;
    }

    /** 最近邻。保留透明度，不进行任何颜色混合。 */
    function resampleNearest(image, crop, outWidth, outHeight) {
      const output = makeOutput(outWidth, outHeight);
      const src = image.data;
      const dst = output.data;
      const scaleX = crop.width / outWidth;
      const scaleY = crop.height / outHeight;

      for (let oy = 0; oy < outHeight; oy += 1) {
        const sy = Math.round(crop.y + (oy + 0.5) * scaleY - 0.5);
        for (let ox = 0; ox < outWidth; ox += 1) {
          const sx = Math.round(crop.x + (ox + 0.5) * scaleX - 0.5);
          if (sx < 0 || sx >= image.width || sy < 0 || sy >= image.height) continue;
          const srcIndex = (sy * image.width + sx) * 4;
          const dstIndex = (oy * outWidth + ox) * 4;
          dst[dstIndex] = src[srcIndex];
          dst[dstIndex + 1] = src[srcIndex + 1];
          dst[dstIndex + 2] = src[srcIndex + 2];
          dst[dstIndex + 3] = src[srcIndex + 3];
        }
      }
      return output;
    }

    /**
     * 按裁剪区域重采样。
     * @param {{data:Uint8ClampedArray|Uint8Array,width:number,height:number}} image
     * @param {{x:number,y:number,width:number,height:number}} crop 单位：源图像素，可含小数
     * @param {number} outWidth
     * @param {number} outHeight
     * @param {'nearest'|'bilinear'|'bicubic'|'lanczos3'|'area'} method
     * @returns {{data:Uint8ClampedArray,width:number,height:number}}
     */
    function resample(image, crop, outWidth, outHeight, method = 'nearest') {
      validate(image, crop, outWidth, outHeight, method);
      if (method === 'nearest') return resampleNearest(image, crop, outWidth, outHeight);
      if (method === 'area') return resampleArea(image, crop, outWidth, outHeight);
      return resampleKernel(image, crop, outWidth, outHeight, method);
    }

    /** 生成纯色测试图，便于 Node 测试与演示。 */
    function createSolidImage(width, height, rgba) {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < width * height; i += 1) {
        data[i * 4] = rgba[0];
        data[i * 4 + 1] = rgba[1];
        data[i * 4 + 2] = rgba[2];
        data[i * 4 + 3] = rgba[3] ?? 255;
      }
      return { width, height, data };
    }

    Object.assign(__exports, { RESAMPLE_METHODS, isValidResample, resample, createSolidImage });
  });

  __define("quantize", function (__exports, __require) {
    "use strict";
    // 色阶简化 / 颜色量化。
    //
    // 阈值模式：把颜色看作 CIELAB 空间中的点，用大小随阈值变化的网格 + 并查集
    // 求“距离小于阈值”图的连通分量（单链接层次聚类）。网格单元的对角线严格小于
    // 阈值，因此同格颜色必然合并；只需检查相邻 ±2 格即可保证不漏边。这样比
    // O(n²) 的完整 MST 快得多，同时颜色数量随阈值单调不增。
    //
    // 目标色数模式：带权 k-means++（LAB 空间），固定随机种子，结果可重现。
    //
    // 抖动：可选的 Floyd–Steinberg 误差扩散（RGB 空间，默认关闭）。

    const { clamp, clampByte, rgbToHex, rgbToLab, labToRgb, labDistanceSq } = __require("color");

    const TRANSPARENT_INDEX = 0xffffffff;

    // 精确颜色超过该数量时，阈值/目标色数模式改用 4bit/通道的预聚合模型。
    // 64×64 输出最多只有 4096 种颜色，因此正常像素画工作流不会触发。
    const MAX_EXACT_COLORS = 7000;

    const BIN_COUNT = 16 * 16 * 16;

    class UnionFind {
      constructor(size) {
        this.parent = new Int32Array(size);
        this.rank = new Uint8Array(size);
        for (let i = 0; i < size; i += 1) this.parent[i] = i;
      }

      find(value) {
        let root = value;
        while (this.parent[root] !== root) root = this.parent[root];
        while (this.parent[value] !== value) {
          const next = this.parent[value];
          this.parent[value] = root;
          value = next;
        }
        return root;
      }

      union(a, b) {
        let rootA = this.find(a);
        let rootB = this.find(b);
        if (rootA === rootB) return false;
        if (this.rank[rootA] < this.rank[rootB]) [rootA, rootB] = [rootB, rootA];
        this.parent[rootB] = rootA;
        if (this.rank[rootA] === this.rank[rootB]) this.rank[rootA] += 1;
        return true;
      }
    }

    function validateImage(image) {
      if (!image || !image.data || !Number.isInteger(image.width) || !Number.isInteger(image.height)) {
        throw new TypeError('量化输入无效');
      }
      if (image.data.length !== image.width * image.height * 4) {
        throw new TypeError('量化输入的像素长度与尺寸不一致');
      }
    }

    function sortEntries(entries) {
      entries.sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex));
      return entries;
    }

    function finalizeModel(width, height, entries, opaquePixels, kind, extra = {}) {
      const labs = new Float32Array(entries.length * 3);
      for (let i = 0; i < entries.length; i += 1) {
        const lab = rgbToLab(entries[i].r, entries[i].g, entries[i].b);
        labs[i * 3] = lab[0];
        labs[i * 3 + 1] = lab[1];
        labs[i * 3 + 2] = lab[2];
      }
      return {
        width,
        height,
        totalPixels: width * height,
        opaquePixels,
        entries,
        labs,
        kind,
        ...extra,
      };
    }

    /**
     * 建立颜色模型（颜色频次 + LAB 坐标）。
     * @param {{data:Uint8ClampedArray|Uint8Array,width:number,height:number}} image
     * @param {{binned?:boolean}} [options]
     */
    function createColorModel(image, options = {}) {
      validateImage(image);
      const { width, height, data } = image;
      const binned = Boolean(options.binned);
      let opaquePixels = 0;

      if (binned) {
        const counts = new Uint32Array(BIN_COUNT);
        const sumR = new Float64Array(BIN_COUNT);
        const sumG = new Float64Array(BIN_COUNT);
        const sumB = new Float64Array(BIN_COUNT);

        for (let i = 0; i < width * height; i += 1) {
          const offset = i * 4;
          if (data[offset + 3] === 0) continue;
          opaquePixels += 1;
          const key = ((data[offset] >> 4) << 8) | ((data[offset + 1] >> 4) << 4) | (data[offset + 2] >> 4);
          counts[key] += 1;
          sumR[key] += data[offset];
          sumG[key] += data[offset + 1];
          sumB[key] += data[offset + 2];
        }

        const entries = [];
        for (let key = 0; key < BIN_COUNT; key += 1) {
          if (!counts[key]) continue;
          const count = counts[key];
          const r = Math.round(sumR[key] / count);
          const g = Math.round(sumG[key] / count);
          const b = Math.round(sumB[key] / count);
          entries.push({ r, g, b, hex: rgbToHex(r, g, b), count, binKey: key });
        }
        sortEntries(entries);
        const binLookup = new Int32Array(BIN_COUNT).fill(-1);
        entries.forEach((entry, index) => {
          binLookup[entry.binKey] = index;
        });
        return finalizeModel(width, height, entries, opaquePixels, 'binned', { binLookup });
      }

      const counts = new Map();
      for (let i = 0; i < width * height; i += 1) {
        const offset = i * 4;
        if (data[offset + 3] === 0) continue;
        opaquePixels += 1;
        const packed = (data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2];
        counts.set(packed, (counts.get(packed) || 0) + 1);
      }

      const entries = [];
      for (const [packed, count] of counts) {
        const r = (packed >> 16) & 0xff;
        const g = (packed >> 8) & 0xff;
        const b = packed & 0xff;
        entries.push({ r, g, b, hex: rgbToHex(r, g, b), count, packed });
      }
      sortEntries(entries);

      const packedToIndex = new Map();
      entries.forEach((entry, index) => {
        packedToIndex.set(entry.packed, index);
      });
      return finalizeModel(width, height, entries, opaquePixels, 'exact', { packedToIndex });
    }

    function paletteEntryFromColor(r, g, b, count) {
      return { r, g, b, hex: rgbToHex(r, g, b), count };
    }

    function thresholdClusters(model, threshold) {
      const n = model.entries.length;
      const uniqueToPalette = new Uint32Array(n);

      if (n === 0) return { palette: [], uniqueToPalette };
      if (threshold <= 0) {
        const palette = model.entries.map((entry, index) => {
          uniqueToPalette[index] = index;
          return paletteEntryFromColor(entry.r, entry.g, entry.b, entry.count);
        });
        return { palette, uniqueToPalette };
      }

      const labs = model.labs;
      const uf = new UnionFind(n);

      // 单元对角线严格小于阈值，保证同格颜色两两距离 < 阈值。
      const cellSize = threshold / (Math.sqrt(3) * 1.000001);
      const cells = new Map();
      for (let i = 0; i < n; i += 1) {
        const cx = Math.floor(labs[i * 3] / cellSize);
        const cy = Math.floor(labs[i * 3 + 1] / cellSize);
        const cz = Math.floor(labs[i * 3 + 2] / cellSize);
        const key = `${cx},${cy},${cz}`;
        let cell = cells.get(key);
        if (!cell) {
          cell = { cx, cy, cz, members: [] };
          cells.set(key, cell);
        }
        cell.members.push(i);
      }

      // 同格颜色必然在同一连通分量。
      for (const cell of cells.values()) {
        if (cell.members.length < 2) continue;
        const first = cell.members[0];
        for (let m = 1; m < cell.members.length; m += 1) {
          uf.union(first, cell.members[m]);
        }
      }

      // 只需检查正方向的 ±2 格邻域；每个无序格对只检查一次。
      const offsets = [];
      for (let dx = -2; dx <= 2; dx += 1) {
        for (let dy = -2; dy <= 2; dy += 1) {
          for (let dz = -2; dz <= 2; dz += 1) {
            if (dx === 0 && dy === 0 && dz === 0) continue;
            if (dx > 0 || (dx === 0 && dy > 0) || (dx === 0 && dy === 0 && dz > 0)) {
              offsets.push([dx, dy, dz]);
            }
          }
        }
      }

      const limit = threshold * threshold;
      for (const cell of cells.values()) {
        for (const [dx, dy, dz] of offsets) {
          const other = cells.get(`${cell.cx + dx},${cell.cy + dy},${cell.cz + dz}`);
          if (!other) continue;
          if (uf.find(other.members[0]) === uf.find(cell.members[0])) continue;

          let merged = false;
          for (const a of cell.members) {
            const a3 = a * 3;
            const al = labs[a3];
            const aa = labs[a3 + 1];
            const ab = labs[a3 + 2];
            for (const b of other.members) {
              const b3 = b * 3;
              const dl = al - labs[b3];
              const da = aa - labs[b3 + 1];
              const db = ab - labs[b3 + 2];
              if (dl * dl + da * da + db * db < limit) {
                uf.union(a, b);
                merged = true;
                break;
              }
            }
            if (merged) break;
          }
        }
      }

      const groups = new Map();
      for (let i = 0; i < n; i += 1) {
        const root = uf.find(i);
        let members = groups.get(root);
        if (!members) {
          members = [];
          groups.set(root, members);
        }
        members.push(i);
      }

      const clusters = [];
      for (const members of groups.values()) {
        let count = 0;
        let sumL = 0;
        let sumA = 0;
        let sumB = 0;
        for (const index of members) {
          const entry = model.entries[index];
          const countWeight = entry.count;
          count += countWeight;
          sumL += model.labs[index * 3] * countWeight;
          sumA += model.labs[index * 3 + 1] * countWeight;
          sumB += model.labs[index * 3 + 2] * countWeight;
        }

        let r;
        let g;
        let b;
        if (members.length === 1) {
          const only = model.entries[members[0]];
          r = only.r;
          g = only.g;
          b = only.b;
        } else {
          [r, g, b] = labToRgb(sumL / count, sumA / count, sumB / count);
        }
        clusters.push({ color: paletteEntryFromColor(r, g, b, count), members, count });
      }

      clusters.sort((a, b) => b.count - a.count || a.color.hex.localeCompare(b.color.hex));
      const palette = clusters.map((cluster, paletteIndex) => {
        for (const member of cluster.members) uniqueToPalette[member] = paletteIndex;
        return cluster.color;
      });

      return { palette, uniqueToPalette };
    }

    function mulberry32(seed) {
      let a = seed >>> 0;
      return function random() {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    function kmeansClusters(model, maxColors) {
      const n = model.entries.length;
      const uniqueToPalette = new Uint32Array(n);
      if (n === 0) return { palette: [], uniqueToPalette };

      const k = Math.max(1, Math.min(256, Math.round(maxColors)));
      if (n <= k) {
        const palette = model.entries.map((entry, index) => {
          uniqueToPalette[index] = index;
          return paletteEntryFromColor(entry.r, entry.g, entry.b, entry.count);
        });
        return { palette, uniqueToPalette };
      }

      const labs = model.labs;
      const centers = new Float64Array(k * 3);
      const minD2 = new Float64Array(n);
      const chosen = new Uint8Array(n);
      const rng = mulberry32((0x9e3779b9 ^ Math.imul(n, 0x85ebca6b) ^ Math.imul(k, 0xc2b2ae35)) >>> 0);

      // 首个中心取出现频率最高的颜色，其余用带权 k-means++。
      let first = 0;
      chosen[first] = 1;
      centers[0] = labs[0];
      centers[1] = labs[1];
      centers[2] = labs[2];
      for (let i = 0; i < n; i += 1) {
        minD2[i] = labDistanceSq(
          [labs[i * 3], labs[i * 3 + 1], labs[i * 3 + 2]],
          [centers[0], centers[1], centers[2]],
        );
      }

      for (let c = 1; c < k; c += 1) {
        let total = 0;
        for (let i = 0; i < n; i += 1) total += model.entries[i].count * minD2[i];

        let pick = -1;
        if (total > 0) {
          let target = rng() * total;
          for (let i = 0; i < n; i += 1) {
            target -= model.entries[i].count * minD2[i];
            if (target <= 0) {
              pick = i;
              break;
            }
          }
        }
        if (pick === -1) {
          for (let i = 0; i < n; i += 1) {
            if (!chosen[i]) {
              pick = i;
              break;
            }
          }
        }
        if (pick === -1) pick = 0;
        chosen[pick] = 1;
        centers[c * 3] = labs[pick * 3];
        centers[c * 3 + 1] = labs[pick * 3 + 1];
        centers[c * 3 + 2] = labs[pick * 3 + 2];

        const cl = centers[c * 3];
        const ca = centers[c * 3 + 1];
        const cb = centers[c * 3 + 2];
        for (let i = 0; i < n; i += 1) {
          const dl = labs[i * 3] - cl;
          const da = labs[i * 3 + 1] - ca;
          const db = labs[i * 3 + 2] - cb;
          const d2 = dl * dl + da * da + db * db;
          if (d2 < minD2[i]) minD2[i] = d2;
        }
      }

      const assignment = new Int32Array(n);
      let movement = Number.POSITIVE_INFINITY;
      for (let iteration = 0; iteration < 18 && movement > 1e-4; iteration += 1) {
        const sums = new Float64Array(k * 3);
        const weights = new Float64Array(k);

        for (let i = 0; i < n; i += 1) {
          let bestCluster = 0;
          let bestDistance = Number.POSITIVE_INFINITY;
          for (let c = 0; c < k; c += 1) {
            const c3 = c * 3;
            const dl = labs[i * 3] - centers[c3];
            const da = labs[i * 3 + 1] - centers[c3 + 1];
            const db = labs[i * 3 + 2] - centers[c3 + 2];
            const d2 = dl * dl + da * da + db * db;
            if (d2 < bestDistance) {
              bestDistance = d2;
              bestCluster = c;
            }
          }
          assignment[i] = bestCluster;
          const weight = model.entries[i].count;
          weights[bestCluster] += weight;
          sums[bestCluster * 3] += labs[i * 3] * weight;
          sums[bestCluster * 3 + 1] += labs[i * 3 + 1] * weight;
          sums[bestCluster * 3 + 2] += labs[i * 3 + 2] * weight;
        }

        movement = 0;
        for (let c = 0; c < k; c += 1) {
          if (weights[c] === 0) continue;
          const nextL = sums[c * 3] / weights[c];
          const nextA = sums[c * 3 + 1] / weights[c];
          const nextB = sums[c * 3 + 2] / weights[c];
          const delta = Math.abs(nextL - centers[c * 3])
            + Math.abs(nextA - centers[c * 3 + 1])
            + Math.abs(nextB - centers[c * 3 + 2]);
          movement = Math.max(movement, delta);
          centers[c * 3] = nextL;
          centers[c * 3 + 1] = nextA;
          centers[c * 3 + 2] = nextB;
        }
      }

      // 用最终中心重新分配一次，保证映射与展示一致。
      const groups = new Map();
      for (let i = 0; i < n; i += 1) {
        let bestCluster = 0;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (let c = 0; c < k; c += 1) {
          const c3 = c * 3;
          const dl = labs[i * 3] - centers[c3];
          const da = labs[i * 3 + 1] - centers[c3 + 1];
          const db = labs[i * 3 + 2] - centers[c3 + 2];
          const d2 = dl * dl + da * da + db * db;
          if (d2 < bestDistance) {
            bestDistance = d2;
            bestCluster = c;
          }
        }
        let members = groups.get(bestCluster);
        if (!members) {
          members = [];
          groups.set(bestCluster, members);
        }
        members.push(i);
      }

      const clusters = [];
      for (const [centerIndex, members] of groups) {
        let count = 0;
        for (const index of members) count += model.entries[index].count;
        const [r, g, b] = labToRgb(
          centers[centerIndex * 3],
          centers[centerIndex * 3 + 1],
          centers[centerIndex * 3 + 2],
        );
        clusters.push({
          color: paletteEntryFromColor(r, g, b, count),
          members,
          count,
        });
      }

      clusters.sort((a, b) => b.count - a.count || a.color.hex.localeCompare(b.color.hex));
      const palette = clusters.map((cluster, paletteIndex) => {
        for (const member of cluster.members) uniqueToPalette[member] = paletteIndex;
        return cluster.color;
      });
      return { palette, uniqueToPalette };
    }

    function nearestPaletteByRgb(r, g, b, palette) {
      let best = 0;
      let bestScore = Number.POSITIVE_INFINITY;
      for (let i = 0; i < palette.length; i += 1) {
        const dr = r - palette[i].r;
        const dg = g - palette[i].g;
        const db = b - palette[i].b;
        // 人眼对绿色更敏感，简单加权可让抖动分布更自然。
        const score = dr * dr * 2 + dg * dg * 4 + db * db * 3;
        if (score < bestScore) {
          bestScore = score;
          best = i;
        }
      }
      return best;
    }

    /** Floyd–Steinberg 误差扩散，仅改变像素到调色板的映射，不改变调色板本身。 */
    function ditherIndices(image, palette) {
      const { width, height, data } = image;
      const pixelCount = width * height;
      const indices = new Uint32Array(pixelCount).fill(TRANSPARENT_INDEX);
      if (!palette.length) return indices;

      const errors = new Float32Array(pixelCount * 3);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const pixel = y * width + x;
          const offset = pixel * 4;
          if (data[offset + 3] === 0) continue;

          const e3 = pixel * 3;
          const r = clampByte(data[offset] + errors[e3]);
          const g = clampByte(data[offset + 1] + errors[e3 + 1]);
          const b = clampByte(data[offset + 2] + errors[e3 + 2]);
          const paletteIndex = nearestPaletteByRgb(r, g, b, palette);
          indices[pixel] = paletteIndex;

          const chosen = palette[paletteIndex];
          const er = r - chosen.r;
          const eg = g - chosen.g;
          const eb = b - chosen.b;

          const distribute = (nx, ny, factor) => {
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) return;
            const target = (ny * width + nx) * 4;
            if (data[target + 3] === 0) return;
            const targetError = (ny * width + nx) * 3;
            errors[targetError] += er * factor;
            errors[targetError + 1] += eg * factor;
            errors[targetError + 2] += eb * factor;
          };

          distribute(x + 1, y, 7 / 16);
          distribute(x - 1, y + 1, 3 / 16);
          distribute(x, y + 1, 5 / 16);
          distribute(x + 1, y + 1, 1 / 16);
        }
      }
      return indices;
    }

    function buildIndices(image, model, uniqueToPalette) {
      const { width, height, data } = image;
      const indices = new Uint32Array(width * height).fill(TRANSPARENT_INDEX);

      if (model.kind === 'binned') {
        const { binLookup } = model;
        for (let i = 0; i < width * height; i += 1) {
          const offset = i * 4;
          if (data[offset + 3] === 0) continue;
          const key = ((data[offset] >> 4) << 8) | ((data[offset + 1] >> 4) << 4) | (data[offset + 2] >> 4);
          const entryIndex = binLookup[key];
          if (entryIndex >= 0) indices[i] = uniqueToPalette[entryIndex];
        }
        return indices;
      }

      const { packedToIndex } = model;
      for (let i = 0; i < width * height; i += 1) {
        const offset = i * 4;
        if (data[offset + 3] === 0) continue;
        const packed = (data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2];
        const entryIndex = packedToIndex.get(packed);
        if (entryIndex !== undefined) indices[i] = uniqueToPalette[entryIndex];
      }
      return indices;
    }

    /** 计算实际使用到的调色板颜色并删除零占比颜色，同时重映射索引。 */
    function finalizePalette(palette, indices, visiblePixels) {
      const counts = new Uint32Array(palette.length);
      for (let i = 0; i < indices.length; i += 1) {
        const index = indices[i];
        if (index !== TRANSPARENT_INDEX) counts[index] += 1;
      }

      const remap = new Uint32Array(palette.length);
      const result = [];
      for (let i = 0; i < palette.length; i += 1) {
        if (counts[i] === 0) {
          remap[i] = 0xffffffff;
          continue;
        }
        remap[i] = result.length;
        const entry = palette[i];
        result.push({
          r: entry.r,
          g: entry.g,
          b: entry.b,
          hex: entry.hex,
          count: counts[i],
          ratio: visiblePixels > 0 ? counts[i] / visiblePixels : 0,
        });
      }

      if (result.length !== palette.length) {
        for (let i = 0; i < indices.length; i += 1) {
          const index = indices[i];
          if (index !== TRANSPARENT_INDEX) indices[i] = remap[index];
        }
      }
      return result;
    }

    function modelMatches(image, model) {
      return model
        && model.width === image.width
        && model.height === image.height
        && Array.isArray(model.entries);
    }

    /**
     * 颜色量化入口。
     * @param {{data:Uint8ClampedArray|Uint8Array,width:number,height:number}} image
     * @param {{
     *   mode?: 'threshold'|'target',
     *   threshold?: number,
     *   maxColors?: number,
     *   dither?: boolean,
     *   model?: object
     * }} options
     */
    function quantize(image, options = {}) {
      validateImage(image);
      const mode = options.mode === 'target' ? 'target' : 'threshold';
      const threshold = clamp(Number(options.threshold) || 0, 0, 100);
      const maxColors = Math.max(1, Math.min(256, Math.round(Number(options.maxColors) || 16)));
      const dither = Boolean(options.dither);

      let model = modelMatches(image, options.model) ? options.model : createColorModel(image);
      let approximate = false;
      const needsClustering = mode === 'target' || threshold > 0;

      if (needsClustering && model.entries.length > MAX_EXACT_COLORS && model.kind === 'exact') {
        if (!model.binnedFallback) {
          model.binnedFallback = createColorModel(image, { binned: true });
        }
        model = model.binnedFallback;
        approximate = true;
      }

      const clusters = mode === 'target'
        ? kmeansClusters(model, maxColors)
        : thresholdClusters(model, threshold);

      let indices = buildIndices(image, model, clusters.uniqueToPalette);
      if (dither) {
        indices = ditherIndices(image, clusters.palette);
      }

      const palette = finalizePalette(clusters.palette, indices, model.opaquePixels);
      const transparentPixels = model.totalPixels - model.opaquePixels;

      return {
        mode,
        threshold,
        maxColors,
        dither,
        palette,
        indices,
        colorCount: palette.length,
        totalPixels: model.totalPixels,
        opaquePixels: model.opaquePixels,
        transparentPixels,
        approximate,
      };
    }

    Object.assign(__exports, { TRANSPARENT_INDEX, MAX_EXACT_COLORS, createColorModel, quantize });
  });

  __define("exporter", function (__exports, __require) {
    "use strict";
    // 导出相关纯逻辑：最近邻放大、调色板色块图、文件名、无依赖 PNG 编码器。
    // 浏览器界面优先用 Canvas 的 toBlob 导出（压缩更好）；这里同时提供纯 JS PNG 编码，
    // 便于 Node 测试与无 Canvas 环境使用。

    const { clampByte, hexToRgb, normalizeHex } = __require("color");

    /** 最近邻放大，保证像素边界锐利、颜色值完全不变。 */
    function upscaleImage(image, factor) {
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
    function makePaletteStrip(colors, options = {}) {
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
    function sanitizeBaseName(name) {
      let base = String(name || 'pixel-art').trim();
      base = base.replace(/^.*[\\/]/, '');
      base = base.replace(/\.(png|jpe?g|webp|gif|bmp|avif)$/i, '');
      base = base.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim();
      return base || 'pixel-art';
    }

    function buildExportFilename(baseName, width, height, scale = 1) {
      const base = sanitizeBaseName(baseName);
      const suffix = scale > 1 ? `@${scale}x` : '';
      return `${base}_fixed_${width}x${height}${suffix}.png`;
    }

    function buildPaletteFilename(baseName, colorCount) {
      return `${sanitizeBaseName(baseName)}_palette_${colorCount}colors.png`;
    }

    function buildProjectFilename(baseName) {
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
    function encodePNG(image) {
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
    function paletteHexLines(colors) {
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

    Object.assign(__exports, { upscaleImage, makePaletteStrip, sanitizeBaseName, buildExportFilename, buildPaletteFilename, buildProjectFilename, encodePNG, paletteHexLines });
  });

  __define("project", function (__exports, __require) {
    "use strict";
    // .pixfix.json 工程文件：创建、校验、序列化、反序列化。
    // 纯逻辑，不依赖 DOM。

    const { normalizeHex } = __require("color");
    const { isValidResample } = __require("resample");

    const PROJECT_VERSION = 1;

    function fail(message) {
      throw new Error(`无法打开工程：${message}`);
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

    function normalizePalette(value) {
      if (value == null) return [];
      if (!Array.isArray(value)) fail('调色板数据格式不正确，请重新生成调色盘。');
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
      if (typeof value !== 'object' || Array.isArray(value)) fail('改色记录格式不正确，请重新生成调色盘。');
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
        // 调色盘联动开关：只有明确写入 false 才关闭；旧工程缺省视为开启。
        hoverHighlight: ui.hoverHighlight !== false,
      };
    }

    /**
     * 规范化工程对象。无效版本会抛错；未知字段丢弃。
     * @param {object} raw
     */
    function normalizeProject(raw) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('文件内容不完整，请确认选择的是本工具保存的工程文件。');
      if (Number(raw.version) !== PROJECT_VERSION) {
        fail(`版本 ${raw.version ?? '缺失'} 不受支持，请用当前版本重新保存工程。`);
      }

      const sourceImage = raw.sourceImage;
      if (typeof sourceImage !== 'string' || !/^data:image\/[a-z0-9.+-]+[,;]/i.test(sourceImage)) {
        fail('工程中缺少可用的源图，请重新导入图片后再保存。');
      }

      const sourceWidth = integer(raw.sourceWidth, 0, 0, 100000);
      const sourceHeight = integer(raw.sourceHeight, 0, 0, 100000);
      if (sourceWidth < 1 || sourceHeight < 1) fail('工程中的源图尺寸无效。');

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
        palette: normalizePalette(raw.palette),
        recolorMap: normalizeRecolorMap(raw.recolorMap),
        manualPalette: normalizePalette(raw.manualPalette),
        ui: normalizeUi(raw.ui, transform.scale),
      };
    }

    /**
     * 从当前工作状态创建工程对象。
     * @param {object} input
     * @param {{now?: Date|string, createdAt?: string}} [options]
     */
    function createProject(input, options = {}) {
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
    function serializeProject(project) {
      return JSON.stringify(normalizeProject(project), null, 2);
    }

    /** 解析并校验工程 JSON 字符串。 */
    function parseProject(text) {
      if (typeof text !== 'string' || !text.trim()) fail('文件是空的，请选择有效的工程文件。');
      let raw;
      try {
        raw = JSON.parse(text);
      } catch {
        fail('文件内容无法识别，请确认选择的是 .pixfix.json 工程文件。');
      }
      return normalizeProject(raw);
    }

    /** 估算工程文本 UTF-8 字节数。 */
    function projectSizeBytes(text) {
      if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(text)).length;
      return Buffer.byteLength(String(text), 'utf8');
    }

    Object.assign(__exports, { PROJECT_VERSION, normalizeProject, createProject, serializeProject, parseProject, projectSizeBytes });
  });

  __define("engine", function (__exports, __require) {
    "use strict";
    // 引擎层纯逻辑：裁剪几何、调色板复写、输出像素合成。
    // 不依赖 DOM，便于在 Node 中做端到端算法测试。

    const { hexToRgb, normalizeHex } = __require("color");
    const { resample } = __require("resample");
    const { TRANSPARENT_INDEX } = __require("quantize");

    const MIN_SCALE = 0.1;
    const MAX_SCALE = 16;

    function clampScale(scale) {
      const value = Number(scale);
      if (!Number.isFinite(value)) return 1;
      return Math.max(MIN_SCALE, Math.min(MAX_SCALE, value));
    }

    function normalizeOutputSize(value, fallback = 64) {
      const number = Number(value);
      if (!Number.isFinite(number)) return fallback;
      return Math.max(8, Math.min(512, Math.round(number)));
    }

    /**
     * 计算裁剪区域（源图像素坐标）。
     * scale=1 时，裁剪框是源图内能放下的最大输出宽高比区域；
     * scale 越大裁剪越小（放大），offsetX/offsetY 是裁剪中心相对源图中心的偏移。
     */
    function computeCropRect(sourceWidth, sourceHeight, outputWidth, outputHeight, scale = 1, offsetX = 0, offsetY = 0) {
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
    function constrainTransform(sourceWidth, sourceHeight, outputWidth, outputHeight, scale, offsetX, offsetY) {
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
    function resampleOutput(sourceImage, transform, method = 'nearest') {
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
    function normalizeRecolorMap(recolorMap) {
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
    function resolvePalette(palette, recolorMap = {}) {
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
    function composeOutput(resampled, quantized, finalPalette) {
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
    function cssColor(entry, alpha = 1) {
      return alpha >= 1
        ? `rgb(${entry.r} ${entry.g} ${entry.b})`
        : `rgb(${entry.r} ${entry.g} ${entry.b} / ${alpha})`;
    }

    Object.assign(__exports, { MIN_SCALE, MAX_SCALE, clampScale, normalizeOutputSize, computeCropRect, constrainTransform, resampleOutput, normalizeRecolorMap, resolvePalette, composeOutput, cssColor });
  });

  __define("uistate", function (__exports, __require) {
    "use strict";
    // 界面纯逻辑：显示格式、宽高比锁定、导出信息、缩放数学。
    // 这里不触碰 DOM，便于在 Node 中直接测试；src/app.js 只负责取值与渲染。

    const { clamp } = __require("color");
    const { buildExportFilename } = __require("exporter");
    const { computeCropRect, constrainTransform, normalizeOutputSize } = __require("engine");

    /** 最大公约数，用于化简宽高比。 */
    function gcd(a, b) {
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
    function aspectLabel(width, height) {
      const safeWidth = Math.max(1, Math.round(width) || 1);
      const safeHeight = Math.max(1, Math.round(height) || 1);
      const divisor = gcd(safeWidth, safeHeight);
      return `${safeWidth / divisor} : ${safeHeight / divisor}`;
    }

    /** 文件大小的人类可读格式。 */
    function formatBytes(bytes) {
      const value = Number(bytes) || 0;
      if (value < 1024) return `${value} B`;
      if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
      return `${(value / (1024 * 1024)).toFixed(2)} MB`;
    }

    /** 占比文案：极小值显示 <0.01%，避免出现 0.00%。 */
    function formatPercent(ratio) {
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
    function applyAspectLock(which, width, height, ratio, fallbackWidth = 64, fallbackHeight = 64) {
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
    function buildExportMeta(baseName, transform, factor, colorCount) {
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
    function defaultClipboardName(type, date = new Date()) {
      const extension = (type || 'image/png').split('/')[1]?.replace('jpeg', 'jpg') || 'png';
      const pad = (value) => String(value).padStart(2, '0');
      return `clipboard_${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
        + `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.${extension}`;
    }

    /** 平移滑块进度（CSS 变量），供 range 控件着色。 */
    function rangeProgress(value, min, max) {
      const low = Number(min);
      const high = Number(max);
      const current = Number(value);
      if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low || !Number.isFinite(current)) return 0;
      return clamp(((current - low) / (high - low)) * 100, 0, 100);
    }

    /* ---------- 缩放数学（纯逻辑，app.js 与测试共用） ---------- */

    /** 缩放范围：10%~1600%，与 engine.js 的 MIN_SCALE / MAX_SCALE 保持一致。 */
    const ZOOM_MIN = 0.1;
    const ZOOM_MAX = 16;
    const ZOOM_MIN_PERCENT = ZOOM_MIN * 100;
    const ZOOM_MAX_PERCENT = ZOOM_MAX * 100;

    /** 对数滑块的内部刻度：0 对应 10%，1000 对应 1600%。 */
    const ZOOM_SLIDER_MAX = 1000;

    /** 微调按钮的倍率：普通 1.02，按住 Shift 时 1.005。 */
    const ZOOM_STEP = 1.02;
    const ZOOM_STEP_FINE = 1.005;

    /** 滚轮指数缩放系数：factor = e^(-deltaY * 0.0015)，Shift 时再乘 0.25。 */
    const WHEEL_ZOOM_SENSITIVITY = 0.0015;
    const WHEEL_ZOOM_FINE = 0.25;

    /** 预览区留白，与 app.js 绘制裁切框时使用的边距一致。 */
    const ZOOM_FRAME_PADDING = 28;

    /** 把缩放值夹到 10%~1600%；非法值回退到 100%。 */
    function clampZoom(scale) {
      const value = Number(scale);
      if (!Number.isFinite(value)) return 1;
      return clamp(value, ZOOM_MIN, ZOOM_MAX);
    }

    /** 缩放值 → 百分比数值（未取整，便于继续计算）。 */
    function zoomPercent(scale) {
      return clampZoom(scale) * 100;
    }

    /**
     * 百分比展示：低于 100% 时保留 1 位小数（10.5%），100% 以上取整（137%）。
     * 显示只影响文案，不改变真实缩放值。
     */
    function formatZoomPercent(scale) {
      const percent = zoomPercent(scale);
      if (percent < 100) {
        const rounded = Math.round(percent * 10) / 10;
        return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
      }
      return `${Math.round(percent)}%`;
    }

    /** 百分比 → 缩放值（夹到 10%~1600%）。 */
    function zoomFromPercent(percent) {
      const value = Number(percent);
      if (!Number.isFinite(value)) return 1;
      return clampZoom(value / 100);
    }

    /**
     * 解析百分比输入框：允许 "137%"、"137"、" 137.5 % "，空值或非数字回退到 fallback。
     * 越界值直接夹到 10%~1600%（例如 5000% → 1600%，0% → 10%）。
     */
    function parseZoomInput(text, fallbackScale = 1) {
      const fallback = clampZoom(fallbackScale);
      const raw = String(text ?? '').replace(/[%\s]/g, '').replace(',', '.');
      if (!raw) return fallback;
      const value = Number(raw);
      if (!Number.isFinite(value)) return fallback;
      return clampZoom(value / 100);
    }

    /** 百分比 → 对数滑块位置（0~1000），拖动时连续变化。 */
    function percentToSlider(percent) {
      const numeric = Number(percent);
      const safe = Number.isFinite(numeric) ? numeric : ZOOM_MIN_PERCENT;
      const clamped = clamp(safe, ZOOM_MIN_PERCENT, ZOOM_MAX_PERCENT);
      const ratio = Math.log(clamped / ZOOM_MIN_PERCENT)
        / Math.log(ZOOM_MAX_PERCENT / ZOOM_MIN_PERCENT);
      return clamp(ratio * ZOOM_SLIDER_MAX, 0, ZOOM_SLIDER_MAX);
    }

    /** 对数滑块位置 → 百分比，是 percentToSlider 的逆运算。 */
    function sliderToPercent(value) {
      const numeric = Number(value);
      const safe = Number.isFinite(numeric) ? numeric : 0;
      const ratio = clamp(safe, 0, ZOOM_SLIDER_MAX) / ZOOM_SLIDER_MAX;
      return ZOOM_MIN_PERCENT * (ZOOM_MAX_PERCENT / ZOOM_MIN_PERCENT) ** ratio;
    }

    /** 缩放值 ↔ 滑块位置。 */
    function zoomToSlider(scale) {
      return percentToSlider(zoomPercent(scale));
    }

    function sliderToZoom(value) {
      return zoomFromPercent(sliderToPercent(value));
    }

    /**
     * 滚轮缩放因子：factor = exp(-deltaY * 0.0015 * (shift ? 0.25 : 1))。
     * 连续指数缩放不会在挡位之间跳变；无效 deltaY 返回 1（不动）。
     */
    function wheelZoomFactor(deltaY, options = {}) {
      const delta = Number(deltaY);
      if (!Number.isFinite(delta) || delta === 0) return 1;
      const fine = options && options.shift ? WHEEL_ZOOM_FINE : 1;
      return Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY * fine);
    }

    /** 微调倍率：普通 1.02，Shift 1.005。 */
    function zoomStepFactor(fine = false) {
      return fine ? ZOOM_STEP_FINE : ZOOM_STEP;
    }

    /**
     * 单次 +/- 微调。direction > 0 放大，< 0 缩小；结果夹在 10%~1600%。
     * @param {number} scale 当前缩放
     * @param {number} direction 方向（通常为 +1 / -1）
     * @param {boolean} [fine] 是否精调（Shift）
     */
    function stepZoom(scale, direction, fine = false) {
      const factor = zoomStepFactor(fine);
      const next = clampZoom(scale) * (Number(direction) < 0 ? 1 / factor : factor);
      return clampZoom(next);
    }

    /**
     * 键盘快捷键映射：+ / - 缩放，0 回到 1:1，f 适应窗口。
     * 输入框（含滑块）、可编辑元素聚焦时不触发；带 Ctrl / Cmd / Alt 的组合同样忽略。
     * @returns {'zoom-in'|'zoom-out'|'reset'|'fit'|null}
     */
    function zoomShortcut(event, editing = false) {
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
    function computeFrame(viewportWidth, viewportHeight, aspect, padding = ZOOM_FRAME_PADDING) {
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
    function fitZoom(
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
    function zoomAroundPoint(input) {
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

    Object.assign(__exports, { gcd, aspectLabel, formatBytes, formatPercent, applyAspectLock, buildExportMeta, defaultClipboardName, rangeProgress, ZOOM_MIN, ZOOM_MAX, ZOOM_MIN_PERCENT, ZOOM_MAX_PERCENT, ZOOM_SLIDER_MAX, ZOOM_STEP, ZOOM_STEP_FINE, WHEEL_ZOOM_SENSITIVITY, WHEEL_ZOOM_FINE, ZOOM_FRAME_PADDING, clampZoom, zoomPercent, formatZoomPercent, zoomFromPercent, parseZoomInput, percentToSlider, sliderToPercent, zoomToSlider, sliderToZoom, wheelZoomFactor, zoomStepFactor, stepZoom, zoomShortcut, computeFrame, fitZoom, zoomAroundPoint });
  });

  __define("palette-link", function (__exports, __require) {
    "use strict";
    // 调色盘联动纯逻辑：预览坐标 → 输出像素、像素颜色 → 调色盘索引、占比统计与文案。
    // 这里不触碰 DOM，便于在 Node 中直接测试；取元素、绘制高亮与节流在 src/app.js。
    //
    // 坐标说明：计算只依赖 getBoundingClientRect() 得到的 CSS 盒与输出网格尺寸。
    // 滚动偏移、页面缩放与 devicePixelRatio 都已经反映在 client 坐标与 CSS 盒里；
    // canvas.width / canvas.height（内部像素）只影响清晰度，不参与换算，
    // 因此显示尺寸与内部尺寸不一致时也不会指错像素。

    const { normalizeHex, rgbToHex } = __require("color");
    const { formatPercent } = __require("uistate");

    /** 结果超过该像素数时，反向高亮只画掩码，不再逐像素描边（256×256 以上）。 */
    const LARGE_RESULT_PIXELS = 256 * 256;

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
    function previewPointToPixel(point, layout = {}) {
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
    function pixelColorAt(image, index) {
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
    function paletteIndexOfColor(palette, color) {
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
    function buildPaletteLookup(palette) {
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
    function countPalettePixels(indices, paletteSize) {
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
    function paletteStats(palette, index) {
      if (!Array.isArray(palette)) return null;
      const position = Math.round(Number(index));
      if (!Number.isInteger(position) || position < 0 || position >= palette.length) return null;
      const entry = palette[position];
      const count = Math.max(0, Math.round(Number(entry?.count) || 0));
      const ratio = Number.isFinite(Number(entry?.ratio)) ? Number(entry.ratio) : 0;
      return { hex: entryHex(entry), count, ratio };
    }

    /** 结果预览底部的简短位置信息：当前像素：12, 34 · #AABBCC（透明时显示“透明”）。 */
    function formatPixelInfo(x, y, hex) {
      const px = Math.round(Number(x));
      const py = Math.round(Number(y));
      if (!Number.isFinite(px) || !Number.isFinite(py)) return '当前像素：—';
      const color = normalizeHex(hex);
      return color
        ? `当前像素：${px}, ${py} · ${color.toUpperCase()}`
        : `当前像素：${px}, ${py} · 透明`;
    }

    /** 跟随鼠标的悬浮提示：#AABBCC · 12.3% · 512 px。 */
    function formatPixelSummary(hex, ratio, count) {
      const color = normalizeHex(hex);
      if (!color) return '';
      const pixels = Math.max(0, Math.round(Number(count) || 0));
      return `${color.toUpperCase()} · ${formatPercent(ratio)} · ${pixels} px`;
    }

    /** 结果是否属于“很大”的尺寸（像素数超过 256×256），用于选择低成本高亮绘法。 */
    function isLargeResult(width, height) {
      const w = toPositiveInteger(width);
      const h = toPositiveInteger(height);
      return w * h > LARGE_RESULT_PIXELS;
    }

    Object.assign(__exports, { LARGE_RESULT_PIXELS, previewPointToPixel, pixelColorAt, paletteIndexOfColor, buildPaletteLookup, countPalettePixels, paletteStats, formatPixelInfo, formatPixelSummary, isLargeResult });
  });

  __define("app", function (__exports, __require) {
    "use strict";
    // 像素画修复工具 — 界面与工作流。
    // 纯浏览器 ES module；所有算法在独立模块中，这里只负责状态、画布和交互。

    const { RESAMPLE_METHODS, isValidResample } = __require("resample");
    const { createColorModel, quantize } = __require("quantize");
    const { computeCropRect, constrainTransform, resampleOutput, resolvePalette, composeOutput, normalizeOutputSize, normalizeRecolorMap } = __require("engine");
    const { createProject, serializeProject, parseProject, projectSizeBytes } = __require("project");
    const { makePaletteStrip, upscaleImage, encodePNG, buildExportFilename, buildPaletteFilename, buildProjectFilename, sanitizeBaseName } = __require("exporter");
    const { normalizeHex, parseHexPalette, formatHexPalette, clamp } = __require("color");
    const { applyAspectLock, aspectLabel, buildExportMeta, clampZoom, computeFrame, defaultClipboardName, fitZoom, formatBytes, formatPercent, formatZoomPercent, parseZoomInput, rangeProgress, sliderToZoom, stepZoom, wheelZoomFactor, zoomAroundPoint, zoomPercent, zoomShortcut, zoomToSlider } = __require("uistate");
    const { buildPaletteLookup, formatPixelInfo, formatPixelSummary, isLargeResult, paletteIndexOfColor, paletteStats, pixelColorAt, previewPointToPixel } = __require("palette-link");

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
      // 调色盘联动：悬浮色块时是否在结果预览中高亮同色像素；旧工程缺省为开。
      hoverHighlight: true,
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

    // 调色盘联动的当前状态。pixelIndex 是“结果预览”里当前悬停的输出像素；
    // swatchIndex 是鼠标悬停的调色盘色块。两者不会同时存在（鼠标只能在一个区域）。
    const hoverLink = {
      pendingPoint: null,
      frameQueued: false,
      pixelIndex: -1,
      pixelX: -1,
      pixelY: -1,
      pixelHex: null,
      paletteIndex: -1,
      swatchIndex: -1,
      mask: null,
    };
    let paletteLookup = null;

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
      resetPaletteLink();
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
        'outCrop', 'pixelCount', 'resultColors', 'pixelInfo', 'paletteCount',
        'btnImportHex', 'btnExportHex', 'paletteHint', 'paletteList',
        'paletteEmpty', 'hoverHighlight', 'pixelTooltip', 'fileImage',
        'fileProject', 'fileHex', 'colorPicker',
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
        // 反向高亮的掩码与当前倍数绑定，换挡前先清除，避免旧掩码被按新尺寸拉伸。
        clearSwatchHighlight(false);
        state.resultZoom = zoom;
        syncResultZoomButtons();
        drawResultScaled();
        centerResultScroll();
      });

      el.resultCanvas.addEventListener('pointermove', onResultPointerMove);
      el.resultCanvas.addEventListener('pointerleave', onResultPointerLeave);
      el.resultScroll.addEventListener('scroll', onResultScroll, { passive: true });
      el.paletteList.addEventListener('pointermove', onPalettePointerMove);
      el.paletteList.addEventListener('pointerleave', onPalettePointerLeave);
      el.hoverHighlight.addEventListener('change', onHoverHighlightChange);

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
      state.hoverHighlight = true;
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
      state.hoverHighlight = project.ui.hoverHighlight;
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

      // 输出像素与调色盘索引都会变化，先让旧的联动高亮失效。
      resetPaletteLink();

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
      paintSwatchHighlight(context);
      el.resultTip.textContent = `${zoom}× 最近邻放大 · 实际 ${outputCanvas.width}×${outputCanvas.height}`;
    }

    function centerResultScroll() {
      requestAnimationFrame(() => {
        el.resultScroll.scrollLeft = Math.max(0, (el.resultScroll.scrollWidth - el.resultScroll.clientWidth) / 2);
        el.resultScroll.scrollTop = Math.max(0, (el.resultScroll.scrollHeight - el.resultScroll.clientHeight) / 2);
      });
    }

    /* ---------- 调色盘联动 ---------- */

    /**
     * 颜色 → 调色盘索引。量化索引是权威映射：改色后两个自动色可能落到同一个 HEX，
     * 此时只有索引能区分色块。仅当索引与读到的颜色对不上时，才退回按 HEX 查表。
     */
    function resolvePaletteIndex(pixelIndex, hex) {
      const direct = cache.quantized?.indices?.[pixelIndex];
      if (Number.isInteger(direct) && direct >= 0 && direct < finalPalette.length
        && finalPalette[direct]?.hex === hex) {
        return direct;
      }
      if (!paletteLookup) paletteLookup = buildPaletteLookup(finalPalette);
      const hit = paletteLookup.get(hex);
      if (hit !== undefined) return hit;
      return paletteIndexOfColor(finalPalette, hex);
    }

    function paletteCardAt(index) {
      if (!Number.isInteger(index) || index < 0) return null;
      return el.paletteList.querySelector(`.swatch-card[data-index="${index}"]`);
    }

    function removePixelCard(index) {
      const card = paletteCardAt(index);
      if (card) card.classList.remove('is-pixel-active');
    }

    /** 清空所有联动状态（不重绘画布；调用方通常马上会重建结果）。 */
    function resetPaletteLink() {
      hoverLink.pendingPoint = null;
      hoverLink.pixelIndex = -1;
      hoverLink.pixelX = -1;
      hoverLink.pixelY = -1;
      hoverLink.pixelHex = null;
      hoverLink.paletteIndex = -1;
      hoverLink.swatchIndex = -1;
      hoverLink.mask = null;
      paletteLookup = null;

      if (el.paletteList) {
        for (const card of el.paletteList.querySelectorAll('.swatch-card.is-pixel-active')) {
          card.classList.remove('is-pixel-active');
        }
      }
      if (el.pixelTooltip) {
        el.pixelTooltip.hidden = true;
        el.pixelTooltip.textContent = '';
      }
      if (el.pixelInfo) {
        el.pixelInfo.textContent = '当前像素：—';
        el.pixelInfo.classList.remove('has-pixel');
      }
    }

    function clearPixelHover() {
      removePixelCard(hoverLink.paletteIndex);
      hoverLink.pixelIndex = -1;
      hoverLink.pixelX = -1;
      hoverLink.pixelY = -1;
      hoverLink.pixelHex = null;
      hoverLink.paletteIndex = -1;
      if (el.pixelTooltip) {
        el.pixelTooltip.hidden = true;
        el.pixelTooltip.textContent = '';
      }
      if (el.pixelInfo) {
        el.pixelInfo.textContent = '当前像素：—';
        el.pixelInfo.classList.remove('has-pixel');
      }
    }

    /** 取消色块 → 预览的高亮；repaint 为 true 时立即重画结果预览。 */
    function clearSwatchHighlight(repaint = false) {
      const active = hoverLink.swatchIndex >= 0;
      hoverLink.swatchIndex = -1;
      hoverLink.mask = null;
      if (active && repaint) drawResultScaled();
    }

    function onResultPointerMove(event) {
      if (!state.source || !outputImageData || !cache.quantized) return;
      hoverLink.pendingPoint = { x: event.clientX, y: event.clientY };
      if (hoverLink.frameQueued) return;
      hoverLink.frameQueued = true;
      requestAnimationFrame(flushResultHover);
    }

    /** 按帧处理预览悬停：同一帧内多次移动只换算一次。 */
    function flushResultHover() {
      hoverLink.frameQueued = false;
      const point = hoverLink.pendingPoint;
      hoverLink.pendingPoint = null;
      if (!point || !state.source || !outputImageData || !cache.quantized) return;

      const rect = el.resultCanvas.getBoundingClientRect();
      const hit = previewPointToPixel(point, {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        outputWidth: outputImageData.width,
        outputHeight: outputImageData.height,
      });
      if (!hit) {
        clearPixelHover();
        return;
      }

      // 同一像素重复移动：只跟随提示位置，不重复读色、查表或滚动调色盘。
      if (hit.index === hoverLink.pixelIndex) {
        positionPixelTooltip(point.x, point.y);
        return;
      }

      const color = pixelColorAt(outputImageData, hit.index);
      if (!color || color.transparent) {
        clearPixelHover();
        el.pixelInfo.textContent = formatPixelInfo(hit.x, hit.y, null);
        return;
      }

      applyPixelHover(hit, color, resolvePaletteIndex(hit.index, color.hex), point);
    }

    function applyPixelHover(hit, color, paletteIndex, point) {
      removePixelCard(hoverLink.paletteIndex);
      hoverLink.pixelIndex = hit.index;
      hoverLink.pixelX = hit.x;
      hoverLink.pixelY = hit.y;
      hoverLink.pixelHex = color.hex;
      hoverLink.paletteIndex = paletteIndex;

      const card = paletteCardAt(paletteIndex);
      if (card) {
        card.classList.add('is-pixel-active');
        revealPaletteCard(card);
      }

      el.pixelInfo.textContent = formatPixelInfo(hit.x, hit.y, color.hex);
      el.pixelInfo.classList.add('has-pixel');

      if (!el.pixelTooltip) return;
      const stats = paletteStats(finalPalette, paletteIndex);
      el.pixelTooltip.textContent = stats?.hex
        ? formatPixelSummary(stats.hex, stats.ratio, stats.count)
        : color.hex.toUpperCase();
      el.pixelTooltip.hidden = false;
      positionPixelTooltip(point.x, point.y);
    }

    function onResultPointerLeave() {
      hoverLink.pendingPoint = null;
      clearPixelHover();
    }

    function onResultScroll() {
      // 滚动后画布相对鼠标的位置已经变了，先取消定位，等下一次移动重新换算。
      if (hoverLink.pixelIndex >= 0) clearPixelHover();
    }

    /** 把调色盘滚动到刚好能看见目标色块的位置，不改变页面滚动。 */
    function revealPaletteCard(card) {
      const list = el.paletteList;
      if (!list || !card) return;
      const listRect = list.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      if (cardRect.top >= listRect.top && cardRect.bottom <= listRect.bottom) return;
      const target = cardRect.top - listRect.top - Math.max(0, (listRect.height - cardRect.height) / 2);
      list.scrollTop += target;
    }

    function positionPixelTooltip(clientX, clientY) {
      const tip = el.pixelTooltip;
      if (!tip || tip.hidden) return;
      const gap = 14;
      const margin = 8;
      const width = tip.offsetWidth || 180;
      const height = tip.offsetHeight || 24;
      let left = clientX + gap;
      let top = clientY + gap;
      if (left + width > window.innerWidth - margin) left = clientX - width - gap;
      if (left < margin) left = margin;
      if (top + height > window.innerHeight - margin) top = clientY - height - gap;
      if (top < margin) top = margin;
      tip.style.left = `${Math.round(left)}px`;
      tip.style.top = `${Math.round(top)}px`;
    }

    /* ---- 色块 → 预览像素（反向） ---- */

    function onPalettePointerMove(event) {
      const card = event.target.closest?.('.swatch-card');
      if (!card) {
        clearSwatchHighlight(true);
        return;
      }
      const index = Number(card.dataset.index);
      if (!Number.isInteger(index) || index === hoverLink.swatchIndex) return;
      if (!state.hoverHighlight || !outputImageData || !cache.quantized) {
        clearSwatchHighlight(true);
        return;
      }
      hoverLink.swatchIndex = index;
      hoverLink.mask = null;
      drawResultScaled();
    }

    function onPalettePointerLeave() {
      clearSwatchHighlight(true);
    }

    function onHoverHighlightChange() {
      state.hoverHighlight = Boolean(el.hoverHighlight.checked);
      if (!state.hoverHighlight) clearSwatchHighlight(true);
    }

    /**
     * 为某个调色板索引预生成掩码 canvas（输出分辨率）与边界路径（显示分辨率）。
     * 大结果只保留掩码，不逐像素描边；两种方式都只在悬停色块变化时计算一次。
     */
    function buildSwatchHighlight(index, width, height, zoom) {
      const cached = hoverLink.mask;
      if (cached
        && cached.index === index
        && cached.zoom === zoom
        && cached.width === width
        && cached.height === height) {
        return cached;
      }

      const indices = cache.quantized?.indices;
      if (!indices || indices.length !== width * height) return null;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) return null;

      const image = context.createImageData(width, height);
      const data = image.data;
      // 1× 显示时单个输出像素只有 1×1，1px 描边会盖住原色，因此只提亮不描边。
      const drawEdges = zoom >= 2;
      const edges = drawEdges && !isLargeResult(width, height) && typeof Path2D === 'function'
        ? new Path2D()
        : null;
      const fillAlpha = drawEdges ? 64 : 76;

      for (let y = 0; y < height; y += 1) {
        const row = y * width;
        for (let x = 0; x < width; x += 1) {
          const pixel = row + x;
          if (indices[pixel] !== index) continue;

          // 半透明白色只提亮、不覆盖原色；2× 及以上再用 1px 青色线勾出边界。
          const offset = pixel * 4;
          data[offset] = 255;
          data[offset + 1] = 255;
          data[offset + 2] = 255;
          data[offset + 3] = fillAlpha;

          if (!edges) continue;
          const left = x * zoom;
          const top = y * zoom;
          const right = left + zoom;
          const bottom = top + zoom;
          if (y === 0 || indices[pixel - width] !== index) {
            edges.moveTo(left, top + 0.5);
            edges.lineTo(right, top + 0.5);
          }
          if (y === height - 1 || indices[pixel + width] !== index) {
            edges.moveTo(left, bottom - 0.5);
            edges.lineTo(right, bottom - 0.5);
          }
          if (x === 0 || indices[pixel - 1] !== index) {
            edges.moveTo(left + 0.5, top);
            edges.lineTo(left + 0.5, bottom);
          }
          if (x === width - 1 || indices[pixel + 1] !== index) {
            edges.moveTo(right - 0.5, top);
            edges.lineTo(right - 0.5, bottom);
          }
        }
      }

      context.putImageData(image, 0, 0);
      hoverLink.mask = { index, width, height, zoom, canvas, edges };
      return hoverLink.mask;
    }

    function paintSwatchHighlight(context) {
      if (!state.hoverHighlight || hoverLink.swatchIndex < 0) return;
      if (!outputImageData || !cache.quantized) return;

      const width = outputImageData.width;
      const height = outputImageData.height;
      const mask = buildSwatchHighlight(hoverLink.swatchIndex, width, height, state.resultZoom);
      if (!mask) return;

      context.save();
      context.imageSmoothingEnabled = false;
      context.drawImage(mask.canvas, 0, 0, el.resultCanvas.width, el.resultCanvas.height);
      if (mask.edges) {
        context.strokeStyle = 'rgba(45, 212, 191, 0.9)';
        context.lineWidth = 1;
        context.stroke(mask.edges);
      }
      context.restore();
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
      // 改色会改变颜色与色块内容，旧的像素定位/色块高亮不再可信。
      resetPaletteLink();
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
      // 调色盘重新渲染后，颜色 → 索引查表必须重建。
      paletteLookup = null;
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
      el.hoverHighlight.checked = state.hoverHighlight;
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
          hoverHighlight: state.hoverHighlight,
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
        hoverHighlight: state.hoverHighlight,
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
        getHoverState() {
          return {
            hoverHighlight: state.hoverHighlight,
            pixel: hoverLink.pixelIndex >= 0
              ? {
                index: hoverLink.pixelIndex,
                x: hoverLink.pixelX,
                y: hoverLink.pixelY,
                hex: hoverLink.pixelHex,
                paletteIndex: hoverLink.paletteIndex,
              }
              : null,
            swatchIndex: hoverLink.swatchIndex,
            pixelCardActive: Boolean(el.paletteList.querySelector('.swatch-card.is-pixel-active')),
            tooltip: el.pixelTooltip && !el.pixelTooltip.hidden ? el.pixelTooltip.textContent : null,
          };
        },
        setHoverHighlight(value) {
          state.hoverHighlight = Boolean(value);
          el.hoverHighlight.checked = state.hoverHighlight;
          if (!state.hoverHighlight) clearSwatchHighlight(true);
          return getDebugState();
        },
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
  });

  __require("app");
})();
