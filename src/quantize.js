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

import {
  clamp,
  clampByte,
  rgbToHex,
  rgbToLab,
  labToRgb,
  labDistanceSq,
} from './color.js';

export const TRANSPARENT_INDEX = 0xffffffff;

// 精确颜色超过该数量时，阈值/目标色数模式改用 4bit/通道的预聚合模型。
// 64×64 输出最多只有 4096 种颜色，因此正常像素画工作流不会触发。
export const MAX_EXACT_COLORS = 7000;

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
export function createColorModel(image, options = {}) {
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
export function quantize(image, options = {}) {
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
