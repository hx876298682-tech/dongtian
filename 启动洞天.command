#!/bin/zsh
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

export NODE_ENV=development
export APP_ENV=local
export API_HOST=127.0.0.1
export API_PORT=3000
export WEB_ORIGIN=http://127.0.0.1:5173
export DATABASE_URL="postgresql://${USER}@127.0.0.1:5432/dongtian"
export SESSION_SECRET="local-development-session-secret"
export CSRF_SECRET="local-development-csrf-secret"
export RANDOM_SEED_ENCRYPTION_KEY="local-development-random-seed-key"
export ACTIVE_CONFIG_VERSION=2026.08.16.1
export CONFIG_STORAGE_MODE=filesystem
export CONFIG_STORAGE_PATH="$PROJECT_DIR/config/releases"
export LOG_LEVEL=info
export VITE_API_PROXY_TARGET=http://127.0.0.1:3000

say() { print "[洞天] $1"; }
fail() { print -u2 "[洞天] 错误：$1"; read -k 1 "?按任意键关闭..."; exit 1; }

command -v pnpm >/dev/null || fail "没有找到 pnpm。请先安装 Node.js 24.x 和 pnpm 11.x。"
command -v psql >/dev/null || fail "没有找到 PostgreSQL 客户端。请先安装 PostgreSQL 18。"

if command -v brew >/dev/null && brew services list | rg -q '^postgresql@18\s+stopped'; then
  say "正在启动本机 PostgreSQL 18..."
  brew services start postgresql@18 >/dev/null
fi

pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1 || fail "PostgreSQL 没有在 127.0.0.1:5432 运行。"

say "准备本地数据库..."
psql -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -c "SELECT 1" >/dev/null 2>&1 || fail "无法连接本机 PostgreSQL。请确认当前 macOS 用户有本地数据库权限。"
psql -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -tc "SELECT 1 FROM pg_database WHERE datname = 'dongtian'" | rg -q 1 || createdb -h 127.0.0.1 dongtian
pnpm db:migrate
pnpm db:seed

if lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then fail "端口 3000 已被占用。"; fi
if lsof -nP -iTCP:5173 -sTCP:LISTEN >/dev/null 2>&1; then fail "端口 5173 已被占用。"; fi

say "启动 API 和 Web..."
pnpm --filter @dongtian/api dev >"$PROJECT_DIR/.local-api.log" 2>&1 &
API_PID=$!
pnpm --filter @dongtian/web dev -- --host 127.0.0.1 --port 5173 --strictPort >"$PROJECT_DIR/.local-web.log" 2>&1 &
WEB_PID=$!

cleanup() {
  kill "$API_PID" "$WEB_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for _ in {1..60}; do
  curl -fsS http://127.0.0.1:3000/api/v1/health/live >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS http://127.0.0.1:3000/api/v1/health/live >/dev/null 2>&1 || fail "API 启动失败，请查看 .local-api.log。"

say "打开浏览器：http://127.0.0.1:5173/"
open http://127.0.0.1:5173/
say "保持这个窗口打开即可体验。关闭窗口会停止本次启动的 API 和 Web。"
read -k 1 "?体验结束后按任意键停止服务并关闭..."
