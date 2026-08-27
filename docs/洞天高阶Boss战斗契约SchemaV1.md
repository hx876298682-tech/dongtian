# 《洞天》高阶 Boss 战斗契约 Schema V1

## 目的

当前 `1.0.0-frozen` 参数包只冻结了六境界 `signature_skill` 压制窗口、入口门槛、Boss 生命倍率、丹药预算和失败事务规则。它没有冻结高阶 Boss 的攻击、防御、命中、逐境界技能数组、抗性或自动丹药对象，因此运行时不能从三档秘境参数推导高阶 Boss 数值。

工程运行时采用显式模式：

- 未登记 `dungeon.high_tier.combat_mode` 时，兼容 `signature_only_v1`，只允许现有 signature skill 摘要/压制结算。
- 只有显式登记 `dungeon.high_tier.combat_mode=full_v1`，并提供六个境界完整对象后，才允许未来接入完整逐秒高阶战斗。
- `full_v1` 缺字段、类型错误、范围错误、重复技能 ID 或非法模式会在服务启动、配置快照校验和发布注册时拒绝；错误包含参数路径和 diagnostics，不会回退到猜测值。

## Full V1 参数对象

每个 `dungeon.high_tier.<realm>` 必须登记：

```text
boss_attack                       number >= 0
boss_defence                      number >= 0
boss_accuracy                     number >= 0
boss_attack_interval_seconds      number > 0
boss_element                      neutral|metal|wood|water|fire|earth
skills                            non-empty array
resistances                       { controlPercent, damageOverTimePercent,
                                    outputSuppressionPercent } in [0,100]
auto_pill                         { thresholdPercent, healPerUse,
                                    targetPercent, maxUses }
```

技能数组的每项必须包含唯一 `id`、`kind`（`damage`、`damage_over_time`、`control` 或 `output_suppression`）、正数 `cooldownSeconds`、不超过冷却的正数 `durationSeconds` 和非负 `magnitude`。自动丹药要求 `targetPercent >= thresholdPercent`，`maxUses` 必须为非负整数。

上述是结构契约，不是尚未有设计证据的数值冻结；完整模式参数在正式设计补齐前不得写入 `frozen_v1` 发布包。

## 正式发布 provenance 门禁

结构合法不等于可发布。`full_v1` 进入配置 release 的 draft/validate/canary/activate/rollback 生命周期前，每个境界的八个参数对象必须同时满足：

- 参数条目 `status` 必须为 `frozen_v1`；
- 参数条目 `source` 必须为非空的可追溯来源；
- 六个境界的字段必须全部存在并先通过上面的结构校验。

战斗引擎单元测试仍可以使用内存 contract fixture，但 fixture 不构成发布证据。当前权威 CSV、生成后的 `FROZEN_PARAMETERS` 和正式发布包均未登记上述八类 full_v1 字段，因此当前正式模式继续为 `signature_only_v1`；不能用测试 fixture、`proposal_v1` 文档或推导的秘境参数激活 full_v1。

代码校验器：`demo/src/server/high-tier-contract.ts`。
验证：`demo/src/server/high-tier-contract.test.ts`、`demo/src/server/config-release.test.ts`。其中 `high-tier-contract.test.ts` 还会读取权威 `docs/洞天数值参数表.csv`，逐境界确认上述 full_v1 字段未进入冻结表；release lifecycle 另验证缺少 `status/source` 的结构合法 fixture 不能进入正式发布，避免把测试 fixture 或 proposal 数值误认为正式参数。

状态：`signature_only_compat / full_v1_schema_gate`。高阶完整多技能逐秒战斗仍待参数设计冻结后实现。
