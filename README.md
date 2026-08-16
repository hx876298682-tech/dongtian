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
