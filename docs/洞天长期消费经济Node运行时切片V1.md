# 洞天长期消费经济 Node 运行时切片 V1

本切片把冻结的 30/90 天窗口、活动时段比例、支援路线、高阶 Boss 遭遇、丹药消耗、装备掉落和法宝对象掉落串成一个只读 Node 运行时结果，不改变玩家状态，也不替代离线结算的权威写入。

入口：

- `GameService.longTermEconomy({ playerId, horizonHours, seed })`
- `POST /v1/economy/long-term`，body 为 `{ horizonHours: 720 | 2160, seed }`

结果使用当前玩家的高阶境界和 active config，返回高阶供给时长、支援时长、路线、Boss 次数/丹药消耗/资源与法宝掉落、支援击杀与装备品质分布、净资源和固定 seed 模式。服务端不会把客户端传入的 realm 当作玩家境界，也不会写入库存、收藏或装备。

## 冻结参数

- 30 天 `720h`、90 天 `2160h`：`schedule.long_horizon.*`。
- 高阶供给窗口 `0.75`、支援窗口 `0.25`：`dungeon.high_tier.supply_window_ratio` 与 `schedule.rotation.support_share`。
- Boss 遭遇间隔 `168h`，Boss 丹药预算、独立掉落、法宝池、法宝保底和当前已登记的自然失败率：对应高阶境界参数。
- `schedule.equipment.support_policy=qing_90d_then_black`：90 天窗口使用已冻结的黑风谷普通地图装备掉落参数；装备品质按现有黑风品质概率和固定 seed 逐次抽取。
- 高阶法宝使用境界专属扩展池；重复件在正式结算中按冻结规则自动推进星级，满星后转收藏印记；`collectionAction` 仍保留用于兼容历史 `duplicateBalances` 和显式人工处理。

## 严格门禁

当前冻结包没有清风支援的普通装备掉率和品质池参数。故 30 天 `qing_feng` 支援路线不会被当作“无装备掉落”运行，也不会复用黑风参数；入口返回 `VALIDATION_FAILED`，details 中包含 `dungeon.qing_feng.equipment_drop_chance / MISSING_PARAMETER`。补齐并冻结清风装备契约后，才可开放 30 天完整装备消费验收。

30 天门禁现在要求完整清风装备契约：`dungeon.qing_feng.equipment_drop_chance`、六档 `dungeon.qing_feng.equipment_quality_*_chance` 以及正权重品质池均必须存在并合法；缺失项会逐项返回 `MISSING_PARAMETER`，品质池为空返回 `INVALID_VALUE`。当前包仍缺这些参数，因此不会把黑风品质表映射到清风。

本切片仍不宣称完成装备仓库出口/升品自动策略、清风 30 天正式参数、Boss full_v1 正式平衡数值和跨进程长期压力测试。固定 seed 置信区间只读切片已实现，但 30 天路线仍按缺参门禁；法宝重复自动升星已在秘境/高阶实时结算中实现，长期统计只计算掉落副本数，不改变玩家收藏状态。

自动装备出口策略已抽成共享契约（`demo/src/server/equipment-exit.ts`）：冻结 `retain_rare` 下库存未满保留，满载普通/精良自动分解，满载稀有及以上出售；策略、开关、回流值或 `progression_reserve` 缺失/漂移均硬失败。由于正式地图模板、部位和属性绑定仍未冻结，该契约暂不能被地图实例 writer 调用来产生正式掉落。

参数门禁还会拒绝高阶 Boss 失败率/掉率不在 `[0,100]` 的配置，以及全零的高阶法宝池或黑风装备品质池；权重总和不为正时不会静默选择最后一个对象。
