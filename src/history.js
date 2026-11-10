// 编辑历史：只管快照栈、容量与连续动作合并，不直接接触 DOM 或应用状态。
// 快照的深拷贝与“哪些字段算一次编辑”由调用方负责，便于单独测试合并规则。

export const HISTORY_LIMIT = 50;

/**
 * 创建一条编辑历史。
 *
 * 记录结构：{ id, label, before, after, coalesceKey, at }
 * - before / after 是调用方生成的完整状态快照；
 * - coalesceKey 相同且间隔在 windowMs 内的新记录，只更新上一条的 after；
 * - undo/redo 用“当前状态”补齐另一侧快照，保证来回切换后仍然准确。
 */
export function createHistory({ limit = HISTORY_LIMIT } = {}) {
  const capacity = Math.max(1, Math.floor(Number(limit) || HISTORY_LIMIT));
  const past = [];
  const future = [];
  let sequence = 0;

  function trim() {
    while (past.length > capacity) past.shift();
  }

  function push(entry, options = {}) {
    if (!entry || entry.before === undefined || entry.after === undefined) {
      throw new Error('历史记录缺少快照');
    }
    const coalesceKey = options.coalesceKey || null;
    const windowMs = Math.max(0, Number(options.windowMs) || 0);
    const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();

    // 从历史中间做了新编辑时，旧的“未来”已经失效。
    const hadFuture = future.length > 0;
    if (hadFuture) future.length = 0;

    const last = past[past.length - 1];
    if (
      !hadFuture
      && coalesceKey
      && last
      && last.coalesceKey === coalesceKey
      && now - last.at <= windowMs
    ) {
      last.after = entry.after;
      last.at = now;
      if (entry.label) last.label = entry.label;
      return last;
    }

    const record = {
      id: ++sequence,
      label: entry.label || '编辑',
      before: entry.before,
      after: entry.after,
      coalesceKey,
      at: now,
    };
    past.push(record);
    trim();
    return record;
  }

  /** 撤销：返回要恢复的快照，并把“当前状态”存进重做栈。 */
  function undo(current) {
    const entry = past.pop();
    if (!entry) return null;
    future.push({ ...entry, after: current });
    return { label: entry.label, snapshot: entry.before };
  }

  /** 重做：返回要恢复的快照，并把“当前状态”放回撤销栈。 */
  function redo(current) {
    const entry = future.pop();
    if (!entry) return null;
    past.push({ ...entry, before: current });
    trim();
    return { label: entry.label, snapshot: entry.after };
  }

  function reset() {
    past.length = 0;
    future.length = 0;
  }

  return {
    push,
    undo,
    redo,
    reset,
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    undoCount: () => past.length,
    redoCount: () => future.length,
    peekUndo: () => (past.length ? past[past.length - 1].label : null),
    peekRedo: () => (future.length ? future[future.length - 1].label : null),
  };
}
