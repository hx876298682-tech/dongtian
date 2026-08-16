# 洞天

《洞天》是修仙 Idle MMO 的 PC / Web Monorepo。

当前仅包含 DT-M0-001 工程地基：工作区、严格 TypeScript、应用与共享包的最小入口，以及统一工具链。账号、数据库、结算、队列、秘境、市场和其他游戏业务在后续任务中按规格逐项实现。

## 本地命令

```text
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Node.js 与 pnpm 版本由 `.nvmrc`、`package.json#engines` 和 `packageManager` 固定。

## E2E

浏览器门禁使用 Playwright 和 PostgreSQL 18。默认流程需要本机可用的 Docker Compose；如果你已经有一套可达的测试数据库，也可以把 E2E 脚本指向它。默认流程会自动：

1. 启动 `postgres` / `postgres-test`。
2. 执行数据库迁移和 seed。
3. 启动 API 和 Web 开发服务器。
4. 通过 `tests/e2e/**` 运行 Chromium E2E。

运行前如果浏览器二进制尚未安装，先执行：

```text
pnpm test:e2e:install
```

手工准备或排障时，可以先确认数据库可用：

```text
pnpm infra:up
pnpm db:migrate
pnpm db:seed
```

然后再执行：

```text
pnpm test:e2e
```
