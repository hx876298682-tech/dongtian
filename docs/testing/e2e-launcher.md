# E2E 启动器

Playwright E2E 现在支持两种数据库模式：

- `docker`：默认模式，先起本地 `postgres:18-alpine` 的测试栈，再做迁移和 seed。
- `external`：显式外部模式，跳过 `infra:up`，直接对用户提供的隔离测试库做清理、迁移和 seed。

## 外部模式

推荐命令：

```bash
E2E_DATABASE_MODE=external pnpm test:e2e
```

要求：

- `TEST_DATABASE_URL` 必须指向明确的测试库。
- `E2E_DATABASE_WIPE_ALLOWLIST` 必须非空，并且命中当前测试库的精确目标。
- 外部库可以是远程隔离 PostgreSQL 18，但仍必须是 test-like 命名并且被 allowlist 精确命中。
- 清理只会重建 `public` schema，不会执行 `DROP DATABASE`。

## PG16 兼容

发布要求仍然是 PostgreSQL 18。

只有在本机隔离测试库上，且显式设置下列开关时，才允许临时注入 `uuidv7()` shim：

```bash
E2E_ALLOW_PG16_UUIDV7_SHIM=true
```

这只用于本地开发，不应对远程或非隔离数据库启用。

## 便捷脚本

- `pnpm test:e2e:serve:external`
- `pnpm test:e2e:external`
