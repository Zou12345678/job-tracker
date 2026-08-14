#!/usr/bin/env bash
# 求职数据管理中心 · Linux / macOS 启动脚本(Windows 用 启动.bat)
# 优先用系统自带的 Python3,没有再退回 Node.js,两者行为完全一致
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then
  exec python3 server.py
fi
if command -v node >/dev/null 2>&1; then
  exec node server.js
fi
echo "[错误] 没找到 Python3 或 Node.js。任装其一即可:"
echo "  Python3: sudo apt install python3  (macOS 一般已自带)"
echo "  Node.js: https://nodejs.org"
exit 1
