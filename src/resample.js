// 重采样核心：最近邻、双线性、双三次、Lanczos3、区域平均。
// 输入输出都是普通对象 {data,width,height}，不依赖 DOM / ImageData 构造器。

export const RESAMPLE_METHODS = Object.freeze([
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

export function isValidResample(method) {
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
export function resample(image, crop, outWidth, outHeight, method = 'nearest') {
  validate(image, crop, outWidth, outHeight, method);
  if (method === 'nearest') return resampleNearest(image, crop, outWidth, outHeight);
  if (method === 'area') return resampleArea(image, crop, outWidth, outHeight);
  return resampleKernel(image, crop, outWidth, outHeight, method);
}

/** 生成纯色测试图，便于 Node 测试与演示。 */
export function createSolidImage(width, height, rgba) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = rgba[0];
    data[i * 4 + 1] = rgba[1];
    data[i * 4 + 2] = rgba[2];
    data[i * 4 + 3] = rgba[3] ?? 255;
  }
  return { width, height, data };
}
