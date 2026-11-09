// 临时浏览器冒烟测试：通过 CDP 驱动已启动的 Edge。
// 用法：先启动 Edge --remote-debugging-port=9223，然后 node tools/cdp-smoke.mjs

import fs from 'node:fs';
import path from 'node:path';

const endpoint = process.env.CDP_ENDPOINT || 'http://127.0.0.1:9223';
const pages = await (await fetch(`${endpoint}/json/list`)).json();
const page = pages.find((item) => item.type === 'page' && item.url.startsWith('http://127.0.0.1:8123'));
if (!page) throw new Error('没有找到测试页面');

const socket = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
const consoleEvents = [];
let sequence = 0;

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
    return;
  }
  if (message.method === 'Runtime.consoleAPICalled') {
    consoleEvents.push({ type: message.params.type, args: message.params.args.map((arg) => arg.value ?? arg.description) });
  }
  if (message.method === 'Runtime.exceptionThrown') {
    consoleEvents.push({ type: 'exception', text: message.params.exceptionDetails.text });
  }
  if (message.method === 'Log.entryAdded') {
    const entry = message.params.entry;
    if (entry.level === 'error') consoleEvents.push({ type: 'log', text: entry.text, url: entry.url });
  }
});

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

function send(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  }
  return response.result.value;
}

async function waitFor(expression, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`等待超时：${expression}`);
}

await send('Runtime.enable');
await send('Page.enable');
await send('Log.enable');
await send('Page.reload', { ignoreCache: true });
await waitFor('Boolean(window.__PIXFIX__)', 20000);

const initial = await evaluate('window.__PIXFIX__.getState()');
console.log('初始状态', JSON.stringify(initial));

const dataUrl = await evaluate(`(() => {
  const logical = document.createElement('canvas');
  logical.width = 80; logical.height = 80;
  const g = logical.getContext('2d');
  // 天空渐变（低分辨率色带）
  for (let y = 0; y < 80; y += 1) {
    for (let x = 0; x < 80; x += 1) {
      let r = 18 + Math.floor(y * 0.35);
      let gg = 35 + Math.floor(y * 0.5);
      let b = 64 + Math.floor(y * 0.55);
      if (y > 55) { r = 28 + (x % 7); gg = 45 + (y % 5); b = 38; }
      g.fillStyle = 'rgb(' + r + ',' + gg + ',' + b + ')';
      g.fillRect(x, y, 1, 1);
    }
  }
  // 月亮
  g.fillStyle = '#fde68a';
  for (let y = 8; y < 25; y += 1) {
    for (let x = 50; x < 68; x += 1) {
      if ((x - 59) ** 2 + (y - 16) ** 2 < 64) g.fillRect(x, y, 1, 1);
    }
  }
  // 远山
  g.fillStyle = '#243b53';
  for (let x = 0; x < 80; x += 1) {
    const peak = 48 + Math.round(10 * Math.sin(x / 9));
    g.fillRect(x, peak, 1, 62 - peak);
  }
  // 小房子
  g.fillStyle = '#d97706'; g.fillRect(18, 47, 18, 18);
  g.fillStyle = '#7c2d12'; g.fillRect(18, 44, 18, 4);
  g.fillStyle = '#fef3c7'; g.fillRect(24, 52, 5, 6);
  g.fillStyle = '#111827'; g.fillRect(33, 52, 4, 13);
  // 草地
  g.fillStyle = '#365314'; g.fillRect(0, 64, 80, 16);
  g.fillStyle = '#4d7c0f';
  for (let i = 0; i < 50; i += 1) {
    const x = (i * 37) % 80;
    const y = 66 + (i * 13) % 12;
    g.fillRect(x, y, 1, 2);
  }
  // 轻微噪声
  const pixels = g.getImageData(0, 0, 80, 80);
  let seed = 1234567;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < pixels.data.length; i += 4) {
    const n = Math.round((random() - 0.5) * 9);
    pixels.data[i] = Math.max(0, Math.min(255, pixels.data[i] + n));
    pixels.data[i + 1] = Math.max(0, Math.min(255, pixels.data[i + 1] + n));
    pixels.data[i + 2] = Math.max(0, Math.min(255, pixels.data[i + 2] + n));
  }
  g.putImageData(pixels, 0, 0);
  const scaled = document.createElement('canvas');
  scaled.width = 160; scaled.height = 160;
  const s = scaled.getContext('2d');
  s.imageSmoothingEnabled = false;
  s.drawImage(logical, 0, 0, 160, 160);
  return scaled.toDataURL('image/png');
})()`);

const imported = await evaluate(`window.__PIXFIX__.importDataUrl(${JSON.stringify(dataUrl)}, '夜山小屋.png')`);
console.log('导入后', JSON.stringify({ source: imported.source, colors: imported.colors, timing: imported.timings }));

const thresholded = await evaluate('window.__PIXFIX__.setThreshold(14)');
console.log('阈值 14 后', JSON.stringify({ colors: thresholded.colors, palette: thresholded.palette.slice(0, 5), timing: thresholded.timings }));

const targetHex = thresholded.palette[0].sourceHex;
const recolored = await evaluate(`window.__PIXFIX__.setPaletteColor(${JSON.stringify(targetHex)}, '#ff4fd8')`);
console.log('改色后', JSON.stringify({ map: recolored.recolorMap, first: recolored.palette[0] }));

const projectText = await evaluate('window.__PIXFIX__.getProjectText()');
console.log('工程文本字节', Buffer.byteLength(projectText, 'utf8'));

const loaded = await evaluate(`window.__PIXFIX__.loadProjectText(${JSON.stringify(projectText)})`);
console.log('工程重载后', JSON.stringify({ colors: loaded.state.colors, map: loaded.state.recolorMap, threshold: loaded.state.threshold }));

const resultDataUrl = await evaluate('window.__PIXFIX__.getResultDataUrl(4)');
const resultBytes = Buffer.from(resultDataUrl.split(',')[1], 'base64');
fs.writeFileSync(path.join(process.cwd(), 'shot-export-4x.png'), resultBytes);
const pngWidth = resultBytes.readUInt32BE(16);
const pngHeight = resultBytes.readUInt32BE(20);
console.log('导出 PNG', pngWidth, 'x', pngHeight, resultBytes.length, 'bytes');

await new Promise((resolve) => setTimeout(resolve, 500));
const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
fs.writeFileSync(path.join(process.cwd(), 'shot-demo.png'), Buffer.from(screenshot.data, 'base64'));

const title = await evaluate('document.title');
const status = await evaluate('document.getElementById("statusText").textContent');
console.log('标题', title, '状态', status);
console.log('控制台错误', JSON.stringify(consoleEvents.filter((event) => event.type === 'error' || event.type === 'exception' || event.type === 'log'), null, 2));

socket.close();
