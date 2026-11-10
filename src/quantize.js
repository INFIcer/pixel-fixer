// 色阶简化 / 颜色量化。
//
// 阈值模式：把颜色看作 CIELAB 空间中的点，建立一棵与阈值无关的固定划分树，
// 再按“簇内任意两色的 ΔE 不超过阈值”自上而下切割。小簇精确检查最大两两
// 距离，大簇用 2 × 簇心到最远成员距离作上界，因此不会出现 A~B、B~C 就把
// A、C 链式并在一起的单链接问题。树只由颜色数据决定，所以颜色数随阈值单调不增。
//
// 目标色数模式：带权 k-means++（LAB 空间），固定随机种子，结果可重现。
//
// 区域联动：聚类完成后，把“局部孤立、且与邻域主色簇心距离很近”的零散像素
// 并入邻域主色簇，让像素画里成片的同色更完整；固定扫描顺序，结果确定。
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

// 精确颜色超过该数量时，阈值/目标色数模式改用 5bit/通道的预聚合模型。
// 阈值 ≤ 2 时为了保证“只合并极少数近似色”，仍然使用精确颜色。
export const MAX_EXACT_COLORS = 7000;

/** 低于等于该阈值时不启用预聚合，避免把阈值 1 的少量近似色提前粗暴合并。 */
export const PRECISE_THRESHOLD_LIMIT = 2;

// 5bit/通道：32×32×32 = 32768 个格子，比 4bit 精细 8 倍。
const BIN_BITS = 5;
const BIN_SHIFT = 8 - BIN_BITS;
const BIN_LEVELS = 1 << BIN_BITS;
const BIN_COUNT = BIN_LEVELS * BIN_LEVELS * BIN_LEVELS;

function binKey(r, g, b) {
  return ((r >> BIN_SHIFT) << (BIN_BITS * 2)) | ((g >> BIN_SHIFT) << BIN_BITS) | (b >> BIN_SHIFT);
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
      const key = binKey(data[offset], data[offset + 1], data[offset + 2]);
      counts[key] += 1;
      sumR[key] += data[offset];
      sumG[key] += data[offset + 1];
      sumB[key] += data[offset + 2];
    }

    const entries = [];
    for (let key = 0; key < BIN_COUNT; key += 1) {
      if (!counts[key]) continue;
      const count = counts[key];
      // 每个候选色的真实位置仍然是该格内所有真实像素的均值。
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

// 半径受限的层次划分：
// - 划分树只由颜色数据决定、与阈值无关，因此阈值越高只会把节点从“继续分”
//   改为“合并”，颜色数必然单调不增；
// - 每个节点记录簇内任意两色的最大距离（小簇精确计算，大簇用 2 × 半径作
//   上界），只有该距离 ≤ 阈值时才允许整块保留，所以不会出现 A~B、B~C 就把
//   A、C 链式并进来的情况；
// - 划分时优先在颜色分布的空隙处切开，避免把同一团相近色拆到两个分支里。
const EXACT_DIAMETER_LIMIT = 64;
const MAX_HIERARCHY_DEPTH = 128;
// 同一份颜色模型在阈值滑动时复用这棵树，避免重复计算。
const hierarchyCache = new WeakMap();

/** 计算区间内颜色在 LAB 各轴上的跨度，返回跨度最大的轴与跨度。 */
function widestRange(order, start, end, labs) {
  let minL = Number.POSITIVE_INFINITY;
  let maxL = Number.NEGATIVE_INFINITY;
  let minA = Number.POSITIVE_INFINITY;
  let maxA = Number.NEGATIVE_INFINITY;
  let minB = Number.POSITIVE_INFINITY;
  let maxB = Number.NEGATIVE_INFINITY;
  for (let i = start; i < end; i += 1) {
    const offset = order[i] * 3;
    const l = labs[offset];
    const a = labs[offset + 1];
    const b = labs[offset + 2];
    if (l < minL) minL = l;
    if (l > maxL) maxL = l;
    if (a < minA) minA = a;
    if (a > maxA) maxA = a;
    if (b < minB) minB = b;
    if (b > maxB) maxB = b;
  }
  const ranges = [maxL - minL, maxA - minA, maxB - minB];
  let dimension = 0;
  if (ranges[1] > ranges[dimension]) dimension = 1;
  if (ranges[2] > ranges[dimension]) dimension = 2;
  return { dimension, range: ranges[dimension] };
}

/**
 * 在区间内选择切分点。
 * 优先选两侧成员都不太少的最大空隙；若某个空隙特别大（≥ 全跨度的 1/4），
 * 即使一侧成员很少也允许切开，这样远离主色的少量颜色不会把整团相近色拆散。
 * 深度过大时退回中位切分，保证树深有上界。
 */
function chooseSplit(order, start, end, labs, depth) {
  if (end - start <= 1) return -1;
  const { dimension, range } = widestRange(order, start, end, labs);
  if (!(range > 1e-9)) return -1;

  const view = order.subarray(start, end);
  view.sort((left, right) => {
    const delta = labs[left * 3 + dimension] - labs[right * 3 + dimension];
    return delta !== 0 ? delta : left - right;
  });

  const length = end - start;
  if (depth >= MAX_HIERARCHY_DEPTH) return start + (length >> 1);

  const minSide = length <= 24 ? 1 : Math.max(1, Math.floor(length * 0.05));
  const hugeGap = range * 0.25;
  let bestPosition = -1;
  let bestGap = -1;
  for (let i = 1; i < length; i += 1) {
    const gap = labs[order[start + i] * 3 + dimension] - labs[order[start + i - 1] * 3 + dimension];
    const side = Math.min(i, length - i);
    if (side < minSide && gap < hugeGap) continue;
    if (gap > bestGap + 1e-12) {
      bestGap = gap;
      bestPosition = i;
    } else if (Math.abs(gap - bestGap) <= 1e-12) {
      // 空隙相同时取更靠近中间的位置，避免树退化成一条链。
      const previous = Math.abs(bestPosition - length / 2);
      const current = Math.abs(i - length / 2);
      if (current < previous) bestPosition = i;
    }
  }
  if (bestPosition <= 0) bestPosition = length >> 1;
  return start + bestPosition;
}

/**
 * 建立与阈值无关的颜色划分树。节点成员用 order[start, end) 表示；
 * 区间在构造过程中被重排成连续块，因此不需要为每个节点保存成员数组。
 */
function buildColorHierarchy(model) {
  const { entries, labs } = model;
  const n = entries.length;
  if (n === 0) return null;

  const order = new Uint32Array(n);
  for (let i = 0; i < n; i += 1) order[i] = i;

  const capacity = Math.max(1, n * 2 - 1);
  const starts = new Uint32Array(capacity);
  const ends = new Uint32Array(capacity);
  const centers = new Float64Array(capacity * 3);
  const weights = new Float64Array(capacity);
  // 簇内最大两两距离的平方（小簇精确值，大簇用上界）。
  const extents = new Float64Array(capacity);
  const lefts = new Int32Array(capacity).fill(-1);
  const rights = new Int32Array(capacity).fill(-1);
  const depths = new Uint16Array(capacity);
  let nodeCount = 0;

  function createNode(start, end, depth) {
    let weight = 0;
    let sumL = 0;
    let sumA = 0;
    let sumB = 0;
    for (let i = start; i < end; i += 1) {
      const index = order[i];
      const count = entries[index].count;
      const offset = index * 3;
      weight += count;
      sumL += labs[offset] * count;
      sumA += labs[offset + 1] * count;
      sumB += labs[offset + 2] * count;
    }
    const centerL = sumL / weight;
    const centerA = sumA / weight;
    const centerB = sumB / weight;

    // 先算 2 × 最大半径作为平方上界；成员较少时再算精确的最大两两距离，
    // 避免“近似圆”被上界误判为超过阈值而多切一刀。
    let maxRadiusSq = 0;
    for (let i = start; i < end; i += 1) {
      const offset = order[i] * 3;
      const dl = labs[offset] - centerL;
      const da = labs[offset + 1] - centerA;
      const db = labs[offset + 2] - centerB;
      const distanceSq = dl * dl + da * da + db * db;
      if (distanceSq > maxRadiusSq) maxRadiusSq = distanceSq;
    }
    let extent = 4 * maxRadiusSq;

    const length = end - start;
    if (length > 1 && length <= EXACT_DIAMETER_LIMIT) {
      let exact = 0;
      for (let i = start; i < end; i += 1) {
        const leftOffset = order[i] * 3;
        const ll = labs[leftOffset];
        const la = labs[leftOffset + 1];
        const lb = labs[leftOffset + 2];
        for (let j = i + 1; j < end; j += 1) {
          const rightOffset = order[j] * 3;
          const dl = ll - labs[rightOffset];
          const da = la - labs[rightOffset + 1];
          const db = lb - labs[rightOffset + 2];
          const distanceSq = dl * dl + da * da + db * db;
          if (distanceSq > exact) exact = distanceSq;
        }
      }
      if (exact < extent) extent = exact;
    }

    const id = nodeCount;
    nodeCount += 1;
    starts[id] = start;
    ends[id] = end;
    centers[id * 3] = centerL;
    centers[id * 3 + 1] = centerA;
    centers[id * 3 + 2] = centerB;
    weights[id] = weight;
    extents[id] = extent;
    depths[id] = depth;
    return id;
  }

  const root = createNode(0, n, 0);
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    const start = starts[node];
    const end = ends[node];
    if (end - start <= 1 || extents[node] <= 1e-12) continue;
    const middle = chooseSplit(order, start, end, labs, depths[node]);
    if (middle <= start || middle >= end) continue;
    const left = createNode(start, middle, depths[node] + 1);
    const right = createNode(middle, end, depths[node] + 1);
    lefts[node] = left;
    rights[node] = right;
    stack.push(left, right);
  }

  return { order, starts, ends, centers, weights, extents, lefts, rights };
}

function hierarchyFor(model) {
  let hierarchy = hierarchyCache.get(model);
  if (!hierarchy) {
    hierarchy = buildColorHierarchy(model);
    if (hierarchy) hierarchyCache.set(model, hierarchy);
  }
  return hierarchy;
}

/** 按阈值自上而下切树：节点内最大色差 ≤ 阈值就整块保留，否则继续分。 */
function collectThresholdClusters(model, threshold) {
  const hierarchy = hierarchyFor(model);
  if (!hierarchy) return [];
  const limitSq = threshold * threshold + 1e-9;
  const output = [];
  const stack = [0];
  while (stack.length) {
    const node = stack.pop();
    if (hierarchy.extents[node] <= limitSq || hierarchy.lefts[node] === -1) {
      output.push(node);
      continue;
    }
    stack.push(hierarchy.rights[node], hierarchy.lefts[node]);
  }
  return output;
}

function clustersToPalette(model, hierarchy, clusterNodes) {
  const n = model.entries.length;
  const uniqueToPalette = new Uint32Array(n);
  const palette = [];
  const ordered = clusterNodes.slice().sort((left, right) => (
    hierarchy.weights[right] - hierarchy.weights[left]
    || hierarchy.centers[left * 3] - hierarchy.centers[right * 3]
  ));

  ordered.forEach((node, paletteIndex) => {
    const start = hierarchy.starts[node];
    const end = hierarchy.ends[node];
    let r;
    let g;
    let b;
    if (end - start === 1) {
      const only = model.entries[hierarchy.order[start]];
      r = only.r;
      g = only.g;
      b = only.b;
    } else {
      [r, g, b] = labToRgb(
        hierarchy.centers[node * 3],
        hierarchy.centers[node * 3 + 1],
        hierarchy.centers[node * 3 + 2],
      );
    }
    palette.push(paletteEntryFromColor(r, g, b, hierarchy.weights[node]));
    for (let i = start; i < end; i += 1) uniqueToPalette[hierarchy.order[i]] = paletteIndex;
  });

  return { palette, uniqueToPalette };
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

  const hierarchy = hierarchyFor(model);
  const clusters = collectThresholdClusters(model, threshold);
  return clustersToPalette(model, hierarchy, clusters);
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
      const key = binKey(data[offset], data[offset + 1], data[offset + 2]);
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

// 区域联动时允许并入邻域主色的最大色差。ΔE 3 约为人眼可察觉的差异下限，
// 超过它就可能把用户有意保留的两种颜色抹成一种，因此即使阈值很高也到此为止。
const SPATIAL_MAX_DELTA = 3;

/**
 * 区域联动：把局部孤立的零散像素并入邻域主色簇。
 *
 * 规则（全部确定性）：
 * - 按行优先固定顺序扫描，每轮基于上一轮快照判断，最多 2 轮；
 * - 只处理 8 邻域里没有任何同簇像素的孤立像素；
 * - 邻域主色簇需占可见邻域的 60% 以上（角落至少 3 个邻居）；
 * - 当前簇与邻域主色簇的簇心色差需不超过 min(阈值, 3)；
 * - 棋盘格像素在斜向有同簇邻居，不会被改动；成片区域内部也不会被改动。
 *
 * @param {{data:Uint8ClampedArray|Uint8Array,width:number,height:number}} image
 * @param {Uint32Array} indices 聚类后的调色板索引
 * @param {Array<{r:number,g:number,b:number}>} palette 调色板
 * @param {number} threshold 阈值（ΔE）；≤0 时不生效
 * @param {number} [rounds=2] 平滑轮数（1~2）
 * @returns {{indices:Uint32Array, moved:number}}
 */
export function smoothSpatialIndices(image, indices, palette, threshold, rounds = 2) {
  const result = new Uint32Array(indices);
  if (!(threshold > 0) || !palette || palette.length < 2) {
    return { indices: result, moved: 0 };
  }

  const { width, height, data } = image;
  const labs = new Float64Array(palette.length * 3);
  for (let i = 0; i < palette.length; i += 1) {
    const lab = rgbToLab(palette[i].r, palette[i].g, palette[i].b);
    labs[i * 3] = lab[0];
    labs[i * 3 + 1] = lab[1];
    labs[i * 3 + 2] = lab[2];
  }

  const limitSq = Math.min(threshold, SPATIAL_MAX_DELTA) ** 2;
  const neighborOffsets = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
  ];
  const counts = new Uint32Array(palette.length);
  const touched = [];
  let movedTotal = 0;

  const roundCount = Math.max(1, Math.min(2, Math.round(rounds)));
  for (let round = 0; round < roundCount; round += 1) {
    const snapshot = result.slice();
    let moved = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x;
        if (data[pixel * 4 + 3] === 0) continue;
        const self = snapshot[pixel];
        if (self === TRANSPARENT_INDEX) continue;

        let sameNeighbors = 0;
        let visibleNeighbors = 0;
        let bestIndex = -1;
        let bestCount = 0;
        touched.length = 0;
        for (const [dx, dy] of neighborOffsets) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const neighbor = ny * width + nx;
          if (data[neighbor * 4 + 3] === 0) continue;
          visibleNeighbors += 1;
          const index = snapshot[neighbor];
          if (index === TRANSPARENT_INDEX) continue;
          if (index === self) {
            sameNeighbors += 1;
            continue;
          }
          if (counts[index] === 0) touched.push(index);
          counts[index] += 1;
          if (counts[index] > bestCount
            || (counts[index] === bestCount && (bestIndex < 0 || index < bestIndex))) {
            bestCount = counts[index];
            bestIndex = index;
          }
        }
        for (const index of touched) counts[index] = 0;

        if (sameNeighbors > 0 || bestIndex < 0) continue;
        const required = Math.max(3, Math.ceil(visibleNeighbors * 0.6));
        if (bestCount < required) continue;
        const self3 = self * 3;
        const best3 = bestIndex * 3;
        const dl = labs[self3] - labs[best3];
        const da = labs[self3 + 1] - labs[best3 + 1];
        const db = labs[self3 + 2] - labs[best3 + 2];
        if (dl * dl + da * da + db * db > limitSq + 1e-9) continue;
        result[pixel] = bestIndex;
        moved += 1;
      }
    }
    movedTotal += moved;
    if (moved === 0) break;
  }
  return { indices: result, moved: movedTotal };
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
 *   spatial?: boolean,
 *   model?: object
 * }} options
 */
export function quantize(image, options = {}) {
  validateImage(image);
  const mode = options.mode === 'target' ? 'target' : 'threshold';
  const threshold = clamp(Number(options.threshold) || 0, 0, 100);
  const maxColors = Math.max(1, Math.min(256, Math.round(Number(options.maxColors) || 16)));
  const dither = Boolean(options.dither);
  const spatial = Boolean(options.spatial);

  let model = modelMatches(image, options.model) ? options.model : createColorModel(image);
  let approximate = false;
  const needsClustering = mode === 'target' || threshold > 0;
  // 阈值 ≤ 2 时即使颜色很多也不用预聚合，保证“阈值 1 只合并极少数近似色”。
  const allowPreaggregate = mode === 'target' || threshold > PRECISE_THRESHOLD_LIMIT;

  if (needsClustering && allowPreaggregate && model.entries.length > MAX_EXACT_COLORS && model.kind === 'exact') {
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
  let spatialApplied = false;
  let spatialMoved = 0;
  // 抖动会把像素刻意打散，与区域联动的目标冲突，因此抖动开启时不参与。
  if (spatial && !dither && mode === 'threshold' && threshold > 0) {
    const smoothed = smoothSpatialIndices(image, indices, clusters.palette, threshold);
    indices = smoothed.indices;
    spatialMoved = smoothed.moved;
    spatialApplied = true;
  }
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
    spatial: spatialApplied,
    spatialMoved,
    palette,
    indices,
    colorCount: palette.length,
    totalPixels: model.totalPixels,
    opaquePixels: model.opaquePixels,
    transparentPixels,
    approximate,
  };
}
