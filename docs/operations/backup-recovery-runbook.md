# 备份、恢复与事故运行手册

适用范围：

- PostgreSQL 全量备份与隔离恢复演练
- WAL / RPO / RTO 配置检查
- 配置回滚
- 资产写入止血、补偿审批和事故分级

目标口径：

- 生产目标 RPO <= 15 分钟
- 生产目标 RTO <= 2 小时
- 任何恢复演练都必须先恢复到隔离环境，再做迁移、配置校验、账本审计和 outbox 去重核对
- 默认只读或 dry-run；真正执行必须显式加 `--execute`

## 1. 可执行脚本入口

根脚本：

- `pnpm ops:backup`
- `pnpm ops:restore`
- `pnpm ops:wal-check`
- `pnpm ops:outbox-dedupe`
- `pnpm ops:config-rollback`

约束：

- `DATABASE_URL`、`BACKUP_DIR`、`BACKUP_FILE`、`RESTORE_DATABASE_URL` 都必须显式传入或由环境变量提供
- 不接受广泛默认路径
- 不做 `rm -rf`、不做目录级删除、不会覆盖历史备份

## 2. 全量备份

推荐命令：

```bash
pnpm ops:backup -- \
  --database-url "$DATABASE_URL" \
  --backup-dir "$BACKUP_DIR"
```

如需实际执行：

```bash
pnpm ops:backup -- \
  --database-url "$DATABASE_URL" \
  --backup-dir "$BACKUP_DIR" \
  --execute
```

备份脚本行为：

- 使用 `pg_dump --format=custom --compress=9 --no-owner --no-acl`
- 备份文件写入 `BACKUP_DIR/postgres/<db-name>/<timestamp>.dump`
- 仅创建必要目录，不删除现有目录
- 备份目录必须是显式绝对路径，不能是 `/`、home 根目录或临时根目录

建议保留的备份元数据：

- 源数据库 URL 的脱敏版本
- 备份文件绝对路径
- 创建时间 UTC
- 配置版本
- 执行人和审批单号

## 3. 恢复演练

只允许恢复到隔离数据库，推荐命令：

```bash
pnpm ops:restore -- \
  --backup-file "$BACKUP_FILE" \
  --restore-database-url "$RESTORE_DATABASE_URL" \
  --expected-config-version "$ACTIVE_CONFIG_VERSION"
```

如需实际执行：

```bash
pnpm ops:restore -- \
  --backup-file "$BACKUP_FILE" \
  --restore-database-url "$RESTORE_DATABASE_URL" \
  --expected-config-version "$ACTIVE_CONFIG_VERSION" \
  --execute
```

恢复演练顺序：

1. `pg_restore` 到隔离数据库
2. `pnpm db:migrate`
3. `ACTIVE_CONFIG_VERSION=... pnpm config:validate`
4. `pnpm db:audit`
5. `pnpm ops:outbox-dedupe -- --database-url "$RESTORE_DATABASE_URL"`

通过条件：

- 配置版本与预期一致
- `db:audit` 无差异
- outbox 去重核对无重复 transaction_id 风险
- 恢复目标能完成只读健康检查

失败处理：

- 先冻结写入
- 先修复配置或恢复到上一版本
- 不要直接改历史账本
- 不要在生产库上重试破坏性恢复

## 4. WAL / RPO / RTO 配置检查

推荐命令：

```bash
pnpm ops:wal-check -- --database-url "$DATABASE_URL"
```

检查项：

- `wal_level`
- `archive_mode`
- `archive_command`
- `archive_timeout`
- `checkpoint_timeout`
- `max_wal_size`
- `wal_compression`
- `max_wal_senders`

判断口径：

- `archive_mode=on` 且 `archive_command` 非空，是满足 15 分钟 RPO 的前提
- 归档延迟必须小于等于 15 分钟
- 每月至少完成一次隔离恢复演练，才可以把 2 小时 RTO 当成已验证值
- 如果没有定期演练，RTO 只算目标，不算证据

建议监控：

- 归档失败计数
- 最近一次成功归档到当前时间的间隔
- `pg_last_wal_replay_lsn` 与源库差距
- 恢复演练时长

## 5. outbox 去重核对

推荐命令：

```bash
pnpm ops:outbox-dedupe -- --database-url "$RESTORE_DATABASE_URL"
```

用途：

- 检查 `outbox_events` 中是否存在按 `transaction_id` 去重后的重复记录
- 检查 payload 里的 `transaction_id` 是否和表字段一致

恢复后必须确认：

- 同一事务不会被重复投递
- 消费者幂等键能稳定去重
- 补偿任务按事务 ID 去重，不会重复执行

## 6. 配置回滚流程

推荐命令：

```bash
pnpm ops:config-rollback -- \
  --current-config-version "$CURRENT_CONFIG_VERSION" \
  --target-config-version "$TARGET_CONFIG_VERSION"
```

回滚规则：

- 只切换不可变配置版本，不覆盖历史包
- 先验证目标版本，再切换服务读取引用
- 切换后重启 API 与 Worker，复查健康检查和 `config_version`
- 失败时回到已知可用版本，不在原地修补历史包

如果回滚导致资产写入错误：

- 立刻冻结写入
- 复核当前快照使用的配置版本
- 先把服务切回已知可用版本，再处理差异

## 7. 资产写入止血

触发条件：

- 账本核对差异非零
- 负库存约束失败
- 迁移或配置验证失败后仍继续写入
- outbox 重复投递或消费重复
- 未知配置版本出现在写请求中

止血动作：

1. 暂停资产写路径
2. 停止 worker 中的 outbox 投递和补偿消费
3. 保留只读健康检查
4. 固定事故编号和时间线
5. 只允许审批后的补偿事务

不要做的事：

- 不要手工改余额
- 不要直接删 ledger
- 不要用宽泛 SQL 批量修复生产数据

## 8. 补偿审批

补偿必须是新事务，不修改旧分录。

流程：

1. 创建事故单
2. 记录受影响的 transaction_id、character_id、config_version 和影响范围
3. 给出补偿方案和回滚方案
4. 复核人确认金额、原因和幂等键
5. 执行补偿事务
6. 复跑账本核对和 outbox 去重核对

审批口径：

- 业务负责人确认原因
- 技术负责人确认数据路径
- QA 或值班人确认回归检查

## 9. 事故分级

- S0：资产灾难、重复发奖、数据泄漏、越权写入
- S1：恢复链路不可用、账本核对失败、写入全面阻断
- S2：局部恢复失败、个别配置回滚失败、局部补偿需要人工介入
- S3：只读检查失败、告警误报、文案或仪表盘问题

处置原则：

- S0 / S1 先止血，后分析
- S2 先定位范围，再补偿
- S3 记录即可，不阻塞发布

## 10. 演练验收

一次合格演练至少要留下：

- 备份文件路径
- 恢复目标数据库 URL
- 配置版本
- `db:migrate` 输出
- `db:audit` 输出
- outbox 去重核对结果
- 负责人签字

真实生产演练状态：

- 本次只完成了脚本、命令生成和文档基础
- 尚未在真实系统 PostgreSQL 上执行恢复演练

