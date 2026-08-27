#!/bin/bash

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 进入 demo 目录
cd "$SCRIPT_DIR/demo" || exit 1

echo "=========================================="
echo "         《洞天》一键启动服务"
echo "=========================================="
echo "正在启动本地开发服务器并打开浏览器..."

# 启动 Vite 开发服务器并自动唤起浏览器
npx vite --open
