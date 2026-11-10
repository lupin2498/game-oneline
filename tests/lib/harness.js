'use strict';
// Khung test dùng chung: máy chủ tĩnh có gắn "móc" đọc trạng thái game, mở Chromium, gom lỗi JS.
const http = require('http'), fs = require('fs'), path = require('path');
const playwright = require('playwright');
// Trình duyệt chạy test: chromium (mặc định) | firefox | webkit  —  BROWSER=webkit node tests/run.js web
const BROWSER = process.env.BROWSER || 'chromium';
if (!playwright[BROWSER]) throw new Error('BROWSER phải là chromium, firefox hoặc webkit');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'tests', '.out');
const HOOK_MARK = '/*__TEST_HOOK__*/';
// Chạy trong closure của game: cho test đọc/ghi biến nội bộ. KHÔNG có trong bản phát hành.
const HOOK = 'window.__dbg={snap:function(){var c=corridor(wy(dotY));return {st:state,mode:mode,dotX:dotX,dotY:dotY,' +
  'cx:c.x,hw:c.hw,hb:c.hb,dist:dist,scroll:scroll,speed:speed,m:meters(),best:best,trail:trail.length,wps:wps.length,' +
  'sparks:sparks.length,ax:anchor?anchor.px:null,ay:anchor?anchor.py:null,sx:stickX,sy:stickY,reason:overReason,' +
  'code:overCode,time:time,activeId:activeId};},run:function(code){return eval(code);}};';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function instrument(html) {
  if (!html.includes(HOOK_MARK)) throw new Error('index.html thiếu dấu ' + HOOK_MARK);
  return html.replace(HOOK_MARK, HOOK);
}
function emulatorConfig(port) {
  return 'window.FIREBASE_CONFIG=' + JSON.stringify({
    apiKey: 'demo-key', authDomain: 'demo-oneline.firebaseapp.com', projectId: 'demo-oneline', appId: 'demo-app',
    loginPage: 'http://127.0.0.1:' + port + '/login.html',
    emulator: { auth: 'http://127.0.0.1:9099', host: '127.0.0.1', firestorePort: 8089 }
  }) + ';';
}

// opts: { config: undefined (file thật) | 'emulator' | chuỗi JS, instrument: true, overrides: {'/duong-dan': noi dung} }
function serve(opts) {
  opts = opts || {};
  const overrides = opts.overrides || {};
  const hits = [];
  const server = http.createServer(function (req, res) {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    hits.push(p);
    const send = function (code, type, body, extra) {
      res.writeHead(code, Object.assign({ 'Content-Type': type, 'Cache-Control': 'max-age=3600' }, extra || {}));
      res.end(body);
    };
    if (Object.prototype.hasOwnProperty.call(overrides, p)) {
      const o = overrides[p];
      if (o === null) return send(404, 'text/plain', 'not found');
      return send(200, TYPES[path.extname(p)] || 'application/octet-stream', o);
    }
    if (p === '/firebase-config.js' && opts.config) {
      const body = opts.config === 'emulator' ? emulatorConfig(server.address().port) : opts.config;
      return send(200, TYPES['.js'], body, { 'Cache-Control': 'no-cache' });
    }
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT + path.sep) || /\/(node_modules|\.git)\//.test(file)) return send(403, 'text/plain', 'forbidden');
    fs.readFile(file, function (err, buf) {
      if (err) return send(404, 'text/plain', 'not found');
      if (p === '/index.html' && opts.instrument !== false) buf = Buffer.from(instrument(buf.toString('utf8')));
      send(200, TYPES[path.extname(p)] || 'application/octet-stream', buf);
    });
  });
  return new Promise(function (resolve) {
    server.listen(opts.port || 0, '127.0.0.1', function () {
      const port = server.address().port;
      resolve({ port: port, url: 'http://127.0.0.1:' + port, hits: hits, overrides: overrides,
        close: function () { return new Promise(function (r) { server.close(r); }); } });
    });
  });
}

// Bản sao tĩnh có gắn móc, để mở bằng file:// giống như trong APK / app iOS
function fileCopy(name, configJs) {
  const dir = path.join(OUT, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), instrument(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')));
  for (const f of ['privacy.html', 'manifest.webmanifest', 'sw.js']) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  fs.copyFileSync(path.join(ROOT, 'lib', 'online.js'), path.join(dir, 'lib', 'online.js'));
  fs.cpSync(path.join(ROOT, 'icons'), path.join(dir, 'icons'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'firebase-config.js'), configJs || fs.readFileSync(path.join(ROOT, 'firebase-config.js'), 'utf8'));
  return 'file://' + dir + '/index.html';
}

async function launch(args) {
  if (BROWSER !== 'chromium') return playwright[BROWSER].launch();
  return playwright.chromium.launch({ args: ['--enable-precise-memory-info'].concat(args || []) });
}

// Hàm trợ giúp chạy trong trang: bắn pointer event theo toạ độ game 480x760, chờ khung hình
function pageHelpers() {
  window.__t = {
    fire: function (type, x, y, id, ptype, extra) {
      var cv = document.getElementById('cv'), r = cv.getBoundingClientRect(), k = r.width / 480;
      var target = type === 'pointerdown' ? document.getElementById('wrap') : window;
      var init = { bubbles: true, cancelable: true, clientX: r.left + x * k, clientY: r.top + y * k,
        pointerId: id == null ? 1 : id, pointerType: ptype || 'touch', isPrimary: true, button: 0, buttons: 1 };
      if (extra) for (var key in extra) init[key] = extra[key];
      return target.dispatchEvent(new PointerEvent(type, init));
    },
    raf: function (n) {
      n = n || 1;
      return new Promise(function (res) { var i = 0; (function f() { if (i++ >= n) return res(); requestAnimationFrame(f); })(); });
    }
  };
}

async function newPage(browser, url, o) {
  o = o || {};
  const ctx = await browser.newContext({
    viewport: o.viewport || { width: 412, height: 860 }, deviceScaleFactor: o.dpr || 2,
    hasTouch: !!o.touch, isMobile: BROWSER === 'firefox' ? undefined : !!o.mobile,     // Firefox không có chế độ giả lập di động
    userAgent: o.ua, serviceWorkers: o.sw ? 'allow' : 'block'
  });
  const page = await ctx.newPage();
  page._errs = []; page._logs = []; page._net = [];
  page.on('pageerror', function (e) { page._errs.push('pageerror: ' + e.message); });
  page.on('dialog', function (d) { page._errs.push('dialog: ' + d.message()); d.dismiss().catch(function () {}); });
  page.on('console', function (m) {
    const t = m.text();
    if (t.indexOf('[oneline]') === 0) page._logs.push(t);
    if (m.type() === 'error') (/Failed to load resource|net::ERR/.test(t) ? page._net : page._errs).push('console: ' + t);
  });
  await page.addInitScript(pageHelpers);
  if (o.init) await page.addInitScript(o.init, o.initArg);
  if (url) {
    await page.goto(url);
    if (o.wait !== false) await page.waitForFunction(function () { return !!window.__dbg; }, null, { timeout: 15000 });
  }
  return page;
}

function suite(name) {
  const res = [];
  const s = {
    name: name, res: res,
    ok: function (label, cond, detail) {
      res.push({ pass: !!cond, label: label, detail: detail });
      console.log((cond ? 'PASS' : 'FAIL') + '  ' + label + (detail !== undefined && detail !== '' ? '  — ' + detail : ''));
      return !!cond;
    },
    done: function () {
      const bad = res.filter(function (r) { return !r.pass; }).length;
      console.log('==> ' + name + ': ' + (res.length - bad) + ' đạt, ' + bad + ' lỗi');
      return bad;
    }
  };
  return s;
}

// Chạy một file test: đóng trình duyệt + máy chủ, đặt mã thoát
function main(name, fn) {
  const s = suite(name);
  const cleanup = [];
  fn(s, cleanup).then(function () { return 0; }, function (e) {
    s.ok('Test chạy hết không văng lỗi', false, (e && e.stack || String(e)).split('\n').slice(0, 4).join(' | '));
  }).then(async function () {
    for (const c of cleanup.reverse()) { try { await c(); } catch (e) { /* */ } }
    process.exit(s.done() ? 1 : 0);
  });
}

const snap = function (page) { return page.evaluate(function () { return window.__dbg.snap(); }); };
const run = function (page, code) { return page.evaluate(function (c) { return window.__dbg.run(c); }, code); };

// Giả lập WebView chưa có kích thước lúc trang chạy (innerWidth/innerHeight = 0, không bắn "resize" khi có kích thước):
// dùng làm o.init của newPage; bật kích thước thật bằng  window.__zero = false
function zeroViewport() {
  var w = Object.getOwnPropertyDescriptor(window, 'innerWidth'), h = Object.getOwnPropertyDescriptor(window, 'innerHeight');
  var cw = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth'), ch = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight');
  window.__zero = true;
  Object.defineProperty(window, 'innerWidth', { configurable: true, get: function () { return window.__zero ? 0 : w.get.call(window); } });
  Object.defineProperty(window, 'innerHeight', { configurable: true, get: function () { return window.__zero ? 0 : h.get.call(window); } });
  Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, get: function () { return window.__zero && this === document.documentElement ? 0 : cw.get.call(this); } });
  Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get: function () { return window.__zero && this === document.documentElement ? 0 : ch.get.call(this); } });
}
// Trạng thái khung chơi + nút Bắt đầu (toạ độ so với khung, theo tỉ lệ)
function frameInfo(page) {
  return page.evaluate(function () {
    var wr = document.getElementById('wrap'), w = wr.getBoundingClientRect(), b = document.getElementById('bStart').getBoundingClientRect(), cv = document.getElementById('cv');
    return { vis: getComputedStyle(wr).visibility, w: w.width, bx: (b.left + b.width / 2 - w.left) / w.width, bw: b.width / w.width,
      inside: b.left >= w.left - 0.5 && b.right <= w.right + 0.5, canvas: cv.width, ui: document.getElementById('ui').style.transform };
  });
}

// Trang chọn tài khoản của Firebase Auth Emulator: mở form "Add new account". Bấm nút ngay khi nó vừa hiện có thể
// trúng lúc script của trang chưa gắn xong sự kiện (bấm không ăn), nên bấm lại cho tới khi form hiện ra.
async function emulatorAddAccount(page) {
  await page.waitForSelector('#add-account-button', { timeout: 20000 });
  for (let i = 0; i < 20; i++) {
    if (await page.locator('#autogen-button').isVisible().catch(function () { return false; })) return;
    await page.click('#add-account-button', { timeout: 1500 }).catch(function () {});
    await page.waitForTimeout(400);
  }
  throw new Error('Auth Emulator: không mở được form thêm tài khoản');
}

module.exports = { BROWSER, emulatorAddAccount, ROOT, OUT, serve, fileCopy, launch, newPage, suite, main, snap, run, instrument, emulatorConfig, zeroViewport, frameInfo };

// Xoá sạch dữ liệu Firebase Emulator (tài khoản + bảng điểm) trước mỗi file test online
async function resetEmulators() {
  await fetch('http://127.0.0.1:8089/emulator/v1/projects/demo-oneline/databases/(default)/documents', { method: 'DELETE' });
  await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-oneline/accounts', { method: 'DELETE' });
}
module.exports.resetEmulators = resetEmulators;
