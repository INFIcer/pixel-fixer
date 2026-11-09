import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PROJECT_VERSION,
  createProject,
  serializeProject,
  parseProject,
  projectSizeBytes,
} from '../src/project.js';

const DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3Q6wAAAABJRU5ErkJggg==';

function example() {
  return createProject({
    sourceImage: DATA_URL,
    sourceWidth: 1024,
    sourceHeight: 768,
    sourceName: '测试 图.png',
    transform: {
      scale: 1.75,
      offsetX: -12.5,
      offsetY: 8,
      outputWidth: 64,
      outputHeight: 48,
    },
    resample: 'lanczos3',
    colorMode: 'threshold',
    threshold: 18,
    maxColors: 24,
    dither: true,
    palette: ['#FF0000', '#00ff00'],
    recolorMap: { '#FF0000': '#112233' },
    manualPalette: ['#112233', '#00FF00'],
    ui: { resultZoom: 8, lockAspect: true, exportScale: 8 },
  }, {
    now: new Date('2026-01-02T03:04:05.000Z'),
    createdAt: '2025-12-31T00:00:00.000Z',
  });
}

test('工程对象字段完整且值被规范化', () => {
  const project = example();
  assert.equal(project.version, PROJECT_VERSION);
  assert.equal(project.createdAt, '2025-12-31T00:00:00.000Z');
  assert.equal(project.updatedAt, '2026-01-02T03:04:05.000Z');
  assert.equal(project.sourceName, '测试 图.png');
  assert.deepEqual(project.recolorMap, { '#ff0000': '#112233' });
  assert.deepEqual(project.palette, ['#ff0000', '#00ff00']);
  assert.equal(project.transform.outputWidth, 64);
  assert.equal(project.transform.outputHeight, 48);
  assert.equal(project.ui.resultZoom, 8);
  assert.equal(project.ui.exportScale, 8);
  assert.equal(project.ui.lockAspect, true);
});

test('UI 状态：旧工程缺少 exportScale 时回退为 1，非法值被拒绝', () => {
  const raw = JSON.parse(serializeProject(example()));
  delete raw.ui.exportScale;
  assert.equal(parseProject(JSON.stringify(raw)).ui.exportScale, 1);

  raw.ui.exportScale = 3;
  assert.equal(parseProject(JSON.stringify(raw)).ui.exportScale, 1);

  raw.ui.exportScale = 16;
  assert.equal(parseProject(JSON.stringify(raw)).ui.exportScale, 16);

  raw.ui.resultZoom = 2;
  assert.equal(parseProject(JSON.stringify(raw)).ui.resultZoom, 4);
});

test('序列化 / 反序列化往返一致', () => {
  const project = example();
  const text = serializeProject(project);
  assert.ok(text.includes('"version": 1'));
  const parsed = parseProject(text);
  assert.deepEqual(parsed, project);
});

test('重新序列化后仍一致（幂等）', () => {
  const project = example();
  const once = parseProject(serializeProject(project));
  const twice = parseProject(serializeProject(once));
  assert.deepEqual(twice, once);
});

test('非法版本与损坏 JSON 给出中文错误', () => {
  const project = example();
  const badVersion = JSON.parse(serializeProject(project));
  badVersion.version = 999;
  assert.throws(() => parseProject(JSON.stringify(badVersion)), /不支持的版本/);
  assert.throws(() => parseProject('{oops'), /JSON 解析失败/);
  assert.throws(() => parseProject(''), /文件为空/);
});

test('缺失或非法 sourceImage 会被拒绝', () => {
  const project = JSON.parse(serializeProject(example()));
  project.sourceImage = 'not-a-data-url';
  assert.throws(() => parseProject(JSON.stringify(project)), /sourceImage/);
});

test('尺寸与阈值被限制到合法范围', () => {
  const raw = JSON.parse(serializeProject(example()));
  raw.transform.outputWidth = 9999;
  raw.transform.outputHeight = 1;
  raw.transform.scale = 100;
  raw.threshold = 500;
  raw.maxColors = 999;
  const parsed = parseProject(JSON.stringify(raw));
  assert.equal(parsed.transform.outputWidth, 512);
  assert.equal(parsed.transform.outputHeight, 8);
  assert.equal(parsed.transform.scale, 16);
  assert.equal(parsed.threshold, 100);
  assert.equal(parsed.maxColors, 256);
});

test('工程大小估算返回 UTF-8 字节数', () => {
  const text = serializeProject(example());
  assert.equal(projectSizeBytes(text), Buffer.byteLength(text, 'utf8'));
  assert.ok(projectSizeBytes(text) > 100);
});
