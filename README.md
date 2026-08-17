# 洞天

《洞天》是一个以服务端权威结算为核心的修仙 Idle MMO PC / Web 项目。仓库采用 pnpm Monorepo，包含 React Web 客户端、NestJS API、后台 Worker、PostgreSQL 数据层、确定性游戏规则、配置流水线以及自动化测试。

## 当前状态

截至 2026-08-17，项目已形成可运行的纵向切片，M5“筑基 Endgame”已完成真实 PostgreSQL 18.6 + Chrome 验收。

| 阶段                   | 状态                   | 已实现范围                                                                                                                                               |
| ---------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0 工程地基            | 主体完成，发布工程待补 | Monorepo、严格 TypeScript、环境校验、PostgreSQL / Prisma 迁移、配置校验、OpenAPI、日志与运维基础                                                         |
| M1 时间内核            | 主体完成               | 匿名会话、角色与资产、不可变账本、幂等、Outbox、规则库、在线 / 离线结算和 Worker 续算                                                                    |
| M2 闭关切片            | 主体完成               | 行动队列、采药 / 炼丹、Buff、背包、首页回流摘要和队列编辑                                                                                                |
| M3 秘境切片            | 主体完成               | 装备预设、确定性战斗、秘境机会、青蛇洞状态机、断线恢复和 Web 历练流程                                                                                    |
| M4 生产成长            | 主体完成               | 挖矿 / 炼器内容、工具分配、装备整理、非市场资源可达性检查和生产 Web 流程                                                                                 |
| M5 筑基 Endgame        | 主体完成，真实验收通过 | 已有筑基条件、资源预留、断线恢复、试炼选择、原子升级、筑基 Web 闭环、三槽库存条件队列；3 条毕业 E2E 已在真实 PostgreSQL 18.6 + Chrome 通过 |
| M6 内容体验 / M7 Alpha | 尚未完成               | 已有部分资产校验、性能 / 安全测试和备份恢复工具，但不满足内容下限、可用性测试、容量验证、监控告警与 Alpha 发布门禁                                       |

这不是已发布游戏，也不是 Alpha 候选版本。当前更适合作为可持续开发和验证核心循环的工程版本。

详细进度、验证记录和下一步见 [`docs/工作进度记录.md`](docs/工作进度记录.md)。产品与技术规格索引见 [`docs/开发前文档包/README_开发前文档总索引_V1.0.md`](docs/开发前文档包/README_开发前文档总索引_V1.0.md)。

## 已实现的核心能力

- 服务端权威的角色、资产、账本、队列、结算、装备、秘境、洞府、淬炼与筑基事务。
- 确定性规则库，覆盖周期、掉落、战斗、队列、Buff、工具、淬炼、洞府和筑基计算。
- React 桌面 Web 壳与洞府、百艺、历练、角色装备、工具和背包流程。
- OpenAPI 3.1 契约及 Web 客户端类型，API 响应统一封装。
- PostgreSQL 18 + Prisma 7 数据层，目前包含 13 组迁移。
- Vitest、Playwright、性能、安全、资产、配置、OpenAPI 和运维检查。

## 仓库结构

```text
apps/
  web/           React + Vite 玩家端
  api/           NestJS + Fastify 模块化单体
  worker/        Outbox、结算、洞府与筑基恢复任务
  admin/         管理端包入口
packages/
  contracts/     OpenAPI 契约与 Web API 客户端
  database/      Prisma Schema、迁移和 Repository
  game-rules/    无 I/O 的确定性游戏规则
  config-schema/ 配置 Schema 与运行时校验
  observability/ 日志、追踪和分析事件基础
  ui/            共用 UI 状态组件
config/          版本化游戏配置包
assets/          资产 Manifest 与本地化资源
tooling/         配置、资产、数据库和运维工具
tests/           集成、E2E、性能、安全与运维测试
docs/            GDD、PRD、架构、测试与开发记录
```

## 环境要求

- Node.js 24.x
- pnpm 11.x
- Docker Compose（运行 PostgreSQL 集成链路和默认 E2E 时需要）

版本由 `.nvmrc`、`package.json#engines` 和 `packageManager` 固定。

## 本地启动

macOS 测试者可以直接双击仓库根目录的 [`启动洞天.command`](启动洞天.command)。它会检查本机 PostgreSQL、准备 `dongtian` 数据库、执行迁移和种子，然后启动 API/Web 并打开浏览器。体验结束后回到终端按任意键停止本次启动的服务。

```bash
pnpm install
pnpm infra:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

默认开发入口由各应用脚本启动。环境变量示例见 [`.env.example`](.env.example)。

## 质量门禁

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm asset:validate
pnpm openapi:check
```

浏览器 E2E 默认自动管理测试数据库和本地服务：

```bash
pnpm test:e2e:install
pnpm test:e2e
```

已有外部测试数据库时，可使用：

```bash
E2E_DATABASE_MODE=external pnpm test:e2e
```

详细说明见 [`docs/testing/e2e-launcher.md`](docs/testing/e2e-launcher.md)。

## 当前限制

- 筑基玩家端、三槽库存条件队列和毕业 E2E 已实现并验收；本地默认 E2E 仍可使用 Docker Compose，外部数据库模式已验证 PostgreSQL 18.6 + Chrome。
- 正式美术、音频、完整教程、目标追踪和全页面状态尚未达到 M6 标准。
- CI、部署环境、真实容量压测、监控告警和 Alpha 发布审批尚未完成。
- 仓库当前未附带开源许可证；公开可见不等于授予复制、修改或再分发许可。
