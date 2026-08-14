# 求职数据管理中心 · 本地服务(零依赖,只用 Python 标准库,与 server.js 行为等价)
# 为什么需要它:双击打开 index.html 是 file:// 页面,Chrome/Edge 不给文件读写权限,
# 绑定过的 data.json 就无法在下次打开时自动读取。跑在 http://localhost 上才是安全上下文。
# 用法:双击「启动.bat」/ 运行「启动.sh」(= python3 server.py),自动启动并打开浏览器。
import json
import os
import sys
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = 8000
URL = f'http://localhost:{PORT}/'
NOOPEN = '--no-open' in sys.argv
MIME = {
    '.html': 'text/html; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
}


def mtime_ms(path):
    # 与 Node 的 stats.mtimeMs 同单位(毫秒浮点),前端只做原样回传比较
    return os.stat(path).st_mtime_ns / 1e6


class Handler(BaseHTTPRequestHandler):
    def _resolve(self):
        p = self.path.split('?')[0]
        try:
            from urllib.parse import unquote
            p = unquote(p)
        except Exception:
            pass
        if p == '/':
            p = '/index.html'
        file = os.path.normpath(os.path.join(ROOT, p.lstrip('/')))
        if not file.startswith(ROOT + os.sep):  # 防目录穿越
            return p, None
        return p, file

    def do_GET(self):
        p, file = self._resolve()
        if file is None:
            return self._text(403, '403 Forbidden')
        try:
            with open(file, 'rb') as f:
                data = f.read()
        except OSError:
            return self._text(404, '404 Not Found')
        ext = os.path.splitext(file)[1].lower()
        self.send_response(200)
        self.send_header('Content-Type', MIME.get(ext, 'application/octet-stream'))
        self.send_header('Cache-Control', 'no-store')
        if p == '/data.json':  # 页面的乐观锁基准:data.json 的当前 mtime
            try:
                self.send_header('X-File-Mtime', repr(mtime_ms(file)))
            except OSError:
                pass
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        # 服务器模式写入:浏览器没记住文件句柄授权时,页面直接 POST 写本目录 data.json。
        # 带 lastMod 做乐观锁——文件在别处被改过(mtime 对不上)就回 409,让页面走冲突弹窗。
        p, file = self._resolve()
        if file is None:
            return self._text(403, '403 Forbidden')
        if p != '/data.json':
            return self._text(404, '404 Not Found')
        try:
            length = int(self.headers.get('Content-Length', 0))
            if length > 2_000_000:
                return self._text(500, 'server error: body too large')
            o = json.loads(self.rfile.read(length).decode('utf-8'))
            if not isinstance(o.get('payload'), str):
                raise ValueError('payload 不是字符串')
            last = o.get('lastMod')
            if isinstance(last, (int, float)) and last > 0:
                if mtime_ms(file) != float(last):
                    return self._json(409, {'conflict': True})
            with open(file, 'w', encoding='utf-8') as f:
                f.write(o['payload'])
            self._json(200, {'mtime': mtime_ms(file)})
        except Exception as e:
            self._text(500, 'server error: ' + str(e))

    def _text(self, code, msg):
        body = msg.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code, obj):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass  # 与 Node 版一致:不刷访问日志


def open_browser():
    if NOOPEN:
        return
    try:
        webbrowser.open(URL)  # 打不开也不报错,手动访问即可
    except Exception:
        pass


if __name__ == '__main__':
    try:
        server = ThreadingHTTPServer(('', PORT), Handler)
    except OSError:
        print('端口 8000 已被占用(服务可能已在运行),直接打开页面。')
        open_browser()
        sys.exit(0)
    print('求职数据管理中心已启动:' + URL)
    print('(保持这个窗口开着;关掉窗口 = 关闭服务。Ctrl+C 退出)')
    open_browser()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
