import test from 'node:test';
import assert from 'node:assert/strict';

import { createHistory, HISTORY_LIMIT } from '../src/history.js';

const snap = (value) => ({ value });

test('历史栈：撤销与重做恢复两侧快照', () => {
  const history = createHistory();
  history.push({ label: '移动', before: snap(0), after: snap(1) });
  history.push({ label: '缩放', before: snap(1), after: snap(2) });
  assert.equal(history.undoCount(), 2);
  assert.equal(history.canUndo(), true);
  assert.equal(history.canRedo(), false);

  const first = history.undo(snap(2));
  assert.equal(first.label, '缩放');
  assert.deepEqual(first.snapshot, snap(1));
  assert.equal(history.canRedo(), true);

  const second = history.undo(snap(1));
  assert.deepEqual(second.snapshot, snap(0));
  assert.equal(history.canUndo(), false);

  const redo = history.redo(snap(0));
  assert.deepEqual(redo.snapshot, snap(1));
  const redoAgain = history.redo(snap(1));
  assert.deepEqual(redoAgain.snapshot, snap(2));
  assert.equal(history.canRedo(), false);
});

test('历史栈：连续动作在时间窗内合并成一条', () => {
  const history = createHistory();
  history.push(
    { label: '滚轮缩放', before: snap(1), after: snap(1.1) },
    { coalesceKey: 'source-zoom', windowMs: 400, now: 1000 },
  );
  history.push(
    { label: '滚轮缩放', before: snap(1.1), after: snap(1.2) },
    { coalesceKey: 'source-zoom', windowMs: 400, now: 1180 },
  );
  assert.equal(history.undoCount(), 1);
  assert.equal(history.peekUndo(), '滚轮缩放');

  const merged = history.undo(snap(1.2));
  assert.deepEqual(merged.snapshot, snap(1));
});

test('历史栈：超出时间窗或换一种动作就另起一条', () => {
  const history = createHistory();
  history.push(
    { label: '滚轮缩放', before: snap(1), after: snap(1.1) },
    { coalesceKey: 'source-zoom', windowMs: 400, now: 1000 },
  );
  history.push(
    { label: '滚轮缩放', before: snap(1.1), after: snap(1.2) },
    { coalesceKey: 'source-zoom', windowMs: 400, now: 1500 },
  );
  history.push(
    { label: '移动', before: snap(1.2), after: snap(1.3) },
    { coalesceKey: 'source-pan', windowMs: 400, now: 1550 },
  );
  assert.equal(history.undoCount(), 3);
  assert.equal(history.peekUndo(), '移动');
});

test('历史栈：新编辑清空重做分支', () => {
  const history = createHistory();
  history.push({ label: '改色', before: snap(0), after: snap(1) });
  history.undo(snap(1));
  assert.equal(history.canRedo(), true);

  history.push({ label: '重采样', before: snap(0), after: snap(2) });
  assert.equal(history.canRedo(), false);
  assert.equal(history.undoCount(), 1);
});

test('历史栈：撤销后继续同类动作不会跨分支合并', () => {
  const history = createHistory();
  history.push(
    { label: '滚轮缩放', before: snap(1), after: snap(2) },
    { coalesceKey: 'source-zoom', windowMs: 400, now: 1000 },
  );
  history.undo(snap(2));

  history.push(
    { label: '滚轮缩放', before: snap(1), after: snap(3) },
    { coalesceKey: 'source-zoom', windowMs: 400, now: 1100 },
  );
  assert.equal(history.undoCount(), 1);
  assert.equal(history.redoCount(), 0);
  assert.deepEqual(history.undo(snap(3)).snapshot, snap(1));
});

test('历史栈：只保留最近 limit 条', () => {
  const history = createHistory({ limit: 3 });
  for (let i = 0; i < 5; i += 1) {
    history.push({ label: `编辑${i}`, before: snap(i), after: snap(i + 1) });
  }
  assert.equal(history.undoCount(), 3);
  assert.deepEqual(history.undo(snap(5)).snapshot, snap(4));
  assert.deepEqual(history.undo(snap(4)).snapshot, snap(3));
  assert.deepEqual(history.undo(snap(3)).snapshot, snap(2));
  assert.equal(history.undo(snap(2)), null);
});

test('历史栈：默认上限与重置', () => {
  const history = createHistory();
  assert.equal(HISTORY_LIMIT, 50);
  history.push({ label: '裁切', before: snap(0), after: snap(1) });
  history.undo(snap(1));
  history.reset();
  assert.equal(history.canUndo(), false);
  assert.equal(history.canRedo(), false);
  assert.equal(history.undo(snap(0)), null);
  assert.equal(history.redo(snap(0)), null);
});

test('历史栈：缺少快照时拒绝写入', () => {
  const history = createHistory();
  assert.throws(() => history.push({ label: '坏记录' }), /缺少快照/);
});
