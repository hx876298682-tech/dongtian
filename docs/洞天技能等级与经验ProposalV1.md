# 洞天技能等级与经验 Proposal V1

> 状态：`proposal_v1`，不是 `1.0.0-frozen` 正式参数。本文只定义当前服务端 MVP 的可重复派生规则，正式平衡仍需产品冻结。

## 规则

- XP 是唯一持久化事实；等级不单独落库，读取时由 XP 派生，避免 Memory/PostgreSQL 漂移。
- 所有技能统一从 1 级开始，累计 XP 达到 `100 * (level - 1)^2` 时进入该等级。
- 因此：0-99 XP 为 1 级，100-399 XP 为 2 级，400-899 XP 为 3 级。
- `levelFromXp(xp) = floor(sqrt(floor(max(xp, 0)) / 100)) + 1`；非法或负 XP 按 0 处理。

## 技能字段

- 功法：按 `techniqueId` 分别保存 XP 和等级；功法排行榜按所有功法 XP 总和排序。
- 采药、挖矿、炼丹、炼器：分别保存 XP，排行榜返回 XP 与派生等级。
- Bootstrap 的 `player.skillLevels` 和排行榜的 `skillLevel` 都是只读派生视图。

## 当前工程边界

本规则不改变行动间隔、每次行动 XP、正式内容对象池或 frozen 参数；正式等级曲线、等级上限、技能等级对属性/产出的加成，待后续产品输入冻结。
