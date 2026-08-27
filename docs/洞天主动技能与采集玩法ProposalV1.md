# 洞天主动技能与采集玩法 Proposal V1

> 本文记录当前 MVP vertical slice 的工程语义。它不是 frozen 数值发布输入，不得被当作正式平衡参数或随机事件输入。

## 全局主动槽

所有主动行动继续使用 `global_single_slot_v1`。开始新行动时，服务端先结算旧行动，再写入新行动；收益在结算事务内直接进入资源/技能状态，不存在手动领取。

## 练功房

API 使用 `POST /v1/actions/start`，`actionId=technique_training`，并要求 `techniqueId`。

- 已有功法 ID 来自现有功法池；`focus_cultivation` 是 MVP 明确标注的专注修为 proposal 目标。
- 每个完整 60 秒动作增加对应功法 `techniqueXp` 和 `techniqueAttributes` 各 1。
- 普通功法每动作增加冻结练功房基础修为 XP；`focus_cultivation` 使用 2 倍修为收益。
- 结算响应透传 `skillXpDelta.technique`，玩家状态持久化在 `skillProgress`。

## 采药与挖矿

API 使用同一 start action route：

- `actionId=herbalism, mapId=herb_grove`：每 60 秒产出 2 `spirit_herb`，增加 1 herbalism XP。
- `actionId=mining, mapId=ore_mine`：每 60 秒产出 1 `spirit_ore`，增加 1 mining XP。

未知行动、地图或功法 fail-closed。资源使用正常容量和 overflow 规则，结算响应透传 `skillXpDelta.herbalism/mining`。

## 持久化与边界

Memory 状态直接保存 `skillProgress`；PostgreSQL 将其放在现有 `progress_state.support_route_state.skillProgress` JSON 中，以兼容旧 schema，不改变 frozen CSV/hash。正式技能等级、属性公式、地图池、产出和排行榜仍需产品冻结后进入正式 release。
