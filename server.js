// 求职数据管理中心 · 本地服务（零依赖，只用 Node 内置模块）
// 为什么需要它：双击打开 index.html 是 file:// 页面，Chrome/Edge 不给文件读写权限，
// 绑定过的 data.json 就无法在下次打开时自动读取。跑在 http://localhost 上才是安全上下文。
// 用法：双击「启动.bat」（= node server.js），自动启动并打开浏览器。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT = __dirname;
const PORT = 8000;
const URL = 'http://localhost:' + PORT + '/';
const NOOPEN = process.argv.includes('--no-open');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function openBrowser() {
  if (NOOPEN) return;
  // 按平台选默认浏览器命令：Windows=start / macOS=open / Linux=xdg-open
  const cmd = process.platform === 'win32' ? 'start "" "' + URL + '"'
    : process.platform === 'darwin' ? 'open "' + URL + '"'
    : 'xdg-open "' + URL + '"';
  exec(cmd, () => {}); // 打不开也不报错，手动访问即可
}

const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT + path.sep)) { // 防目录穿越
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('403 Forbidden');
  }
  /* 服务器模式写入：浏览器没记住文件句柄授权时，页面直接 POST 写本目录 data.json。
     带 lastMod 做乐观锁——文件在别处被改过（mtime 对不上）就回 409，让页面走冲突弹窗。 */
  if (req.method === 'POST' && p === '/data.json') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 2e6) req.destroy(); });
    req.on('end', () => {
      try {
        const o = JSON.parse(body);
        if (typeof o.payload !== 'string') throw new Error('payload 不是字符串');
        if (typeof o.lastMod === 'number' && o.lastMod > 0) {
          const cur = fs.statSync(file).mtimeMs;
          if (cur !== o.lastMod) {
            res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ conflict: true }));
          }
        }
        fs.writeFileSync(file, o.payload, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ mtime: fs.statSync(file).mtimeMs }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('server error: ' + e.message);
      }
    });
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    const headers = {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    };
    if (p === '/data.json') { // 页面的乐观锁基准：data.json 的当前 mtime
      try { headers['X-File-Mtime'] = fs.statSync(file).mtimeMs; } catch (e) {}
    }
    res.writeHead(200, headers);
    res.end(data);
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log('端口 8000 已被占用（服务可能已在运行），直接打开页面。');
    openBrowser();
    process.exit(0);
  }
  console.error(e);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log('求职数据管理中心已启动：' + URL);
  console.log('（保持这个窗口开着；关掉窗口 = 关闭服务。Ctrl+C 退出）');
  openBrowser();
});
