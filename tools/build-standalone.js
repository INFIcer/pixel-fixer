// 生成 file:// 兼容包。
//
// 背景：Chromium/Edge 默认禁止 file:// 页面跨文件加载 ES module（CORS）。
// 为了让双击 index.html 也能运行，这里把同一套源码模块转换成极小的
// CommonJS 风格运行时，打包为经典脚本 src/standalone.js。
//
// 这个脚本只是开发时的同步工具，不是运行依赖；交付物中包含生成好的文件。
// 使用：node tools/build-standalone.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const modules = ['color', 'resample', 'quantize', 'exporter', 'project', 'engine', 'uistate', 'app'];
const outputPath = path.join(root, 'src', 'standalone.js');

function indent(text, spaces = 2) {
  const prefix = ' '.repeat(spaces);
  return text.split('\n').map((line) => (line ? prefix + line : line)).join('\n');
}

function transform(source, name) {
  const exported = new Set();

  // 收集并去掉 export 声明。
  let code = source.replace(
    /^export\s+(async\s+function|function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
    (match, kind, identifier) => {
      exported.add(identifier);
      return `${kind} ${identifier}`;
    },
  );

  // 静态 import → 运行时 require。
  code = code.replace(
    /^import\s*\{([\s\S]*?)\}\s*from\s*['"]\.\/([^'"]+)['"];?[ \t]*$/gm,
    (match, names, specifier) => {
      const dependency = specifier.replace(/\.js$/, '');
      const cleaned = names
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => item.replace(/\s+as\s+/, ': '))
        .join(', ');
      return `const { ${cleaned} } = __require(${JSON.stringify(dependency)});`;
    },
  );

  const leftoverImport = /^\s*import\s+/m.test(code);
  const leftoverExport = /^\s*export\s+/m.test(code);
  if (leftoverImport || leftoverExport) {
    throw new Error(`模块 ${name} 中仍有未处理的 import/export 语句`);
  }

  const assignment = exported.size
    ? `\n  Object.assign(__exports, { ${[...exported].join(', ')} });`
    : '';

  return [
    `__define(${JSON.stringify(name)}, function (__exports, __require) {`,
    '  "use strict";',
    indent(code.trim(), 2),
    assignment,
    '});',
  ].filter(Boolean).join('\n');
}

const definitions = [];
for (const name of modules) {
  const file = path.join(root, 'src', `${name}.js`);
  if (!fs.existsSync(file)) throw new Error(`缺少模块：${file}`);
  const source = fs.readFileSync(file, 'utf8');
  definitions.push(transform(source, name));
}

const header = `/* 自动生成：由 tools/build-standalone.js 从 src/*.js 生成，请勿直接编辑。
 * 用途：file:// 下 Chromium 不允许加载跨文件 ES module 时的兼容入口。
 * 修改源码后运行：node tools/build-standalone.js
 */
`;

const bundle = `${header}(function () {
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

${definitions.map((definition) => indent(definition, 2)).join('\n\n')}

  __require("app");
})();
`;

fs.writeFileSync(outputPath, bundle, 'utf8');
const bytes = Buffer.byteLength(bundle, 'utf8');
console.log(`已生成 ${path.relative(root, outputPath)}（${(bytes / 1024).toFixed(1)} KB，${modules.length} 个模块）`);
