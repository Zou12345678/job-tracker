#!/usr/bin/env bash
# 求职数据管理中心 · Linux / macOS 启动脚本（Windows 用 启动.bat）
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 没找到 Node.js。请先安装：https://nodejs.org 或 sudo apt install nodejs"
  exit 1
fi
exec node server.js
