# 《洞天》Web版 MVP 技术架构设计 V1.0

## 文档定位

本架构以《洞天》数值版本 `1.0.0-frozen` 为唯一数值基线。实现必须读取参数表和内容配置，不得在前端或服务端重新定义一套战斗、掉落、挂机或离线公式。

冻结基线：

- 参数表：`docs/洞天数值参数表.csv`
- 参数行数/列数：`1143 / 12`
- 参数表 SHA-256：`7113fe72dd40ed36869408551f5f20a9e72e83af519b4a03d657296ed4987f75`
- 参数状态：`confirmed` 与 `frozen_v1`
- 路线策略：`qing_90d_then_black`
- 装备出口：`retain_rare`
- 高阶入口档：`collected_p10`

## 总体架构

```text
浏览器客户端
    |
API/BFF（认证、请求校验、视图组装）
    |
游戏应用层（行动、生产、战斗、掉落、成长、离线结算）
    |----------------------|
权威状态库 PostgreSQL     Redis（缓存/队列，不作最终状态源）
    |
配置包仓库（JSON 内容 + 参数表 + manifest/hash）
```

服务器是唯一结算方。客户端只提交意图和上一次 `state_revision`，不能提交修为、掉落、战斗结果或库存最终值。

## 当前运行时覆盖：`global_single_slot_v1`

本节优先级高于本文较早的“后台生产”描述。当前 MVP 使用全局单行动槽：炼气、普通地图、炼丹、炼器、功法研究和法宝研究都写入同一个 `primary_action`，同一玩家只能有一个主动序列。启动不同序列会先在同一结算/CAS 链路结算并结束旧序列，再启动新序列。

- 炼丹/炼器序列完成批次后直接写入资源或装备库存，不存在“领取生产收益”步骤。
- 灵田是唯一不占主动槽的种植设施：通过显式 plant route 写入种植批次，成熟后由下一次离线结算自动入库并清空；旧安装 `planted_plots IS NULL` 仅保留兼容连续产出。
- legacy `building_job` 只用于历史读取/回放兼容，在全局模型下不能新建，也不会被动产出。
- 秘境和高阶 Boss attempt 与主动序列互斥。
- 当前尚未冻结生产数量 DTO、丹道/炼器技能等级榜单和旧队列取消/返还/冻结迁移语义，不能从 proposal 文档自行推导。

## 技术选型与边界

- 前端：React + TypeScript；Tailwind 只负责表现层，不承载数值公式。
- API：Node.js + TypeScript + NestJS。
- 权威数据库：PostgreSQL，保存玩家可变状态、结算记录和版本引用。
- Redis：缓存静态配置、排行榜读模型、异步任务；Redis 丢失时不得导致资源重发或状态回滚。
- 配置：JSON 内容文件与 `洞天数值参数表.csv` 一起打包，使用 `config_version` 和 SHA-256 校验；启动时执行 Schema 校验。

## 模块划分

### 配置与版本模块

加载并校验 `parameter_manifest.json`、参数表和内容 JSON。每次结算写入 `config_version`；运行中的结算不得跨版本混用公式。

### 玩家与成长模块

负责境界、修为、突破、功法研究、法宝星级和战力快照。高阶境界每境界 10 个小境界；当前 `global_single_slot_v1` 不启用高阶被动练功或功法阁被动研究，相关研究/修炼必须由主动序列驱动。

### 行动与生产模块

角色只有一个 `primary_action`（闭关、地图/秘境/高阶远征或一类生产/研究序列）。炼丹房、炼器房、功法阁和法宝阁的主动产出使用该槽位；灵田使用独立种植批次。legacy `background_jobs` 仅保留历史兼容，不是新玩法入口。生产 Modifier 顺序为 `interval_then_quantity`，小数规则为 `carry_fraction`。

### 战斗模块

使用冻结的逐秒战斗状态机，输入角色属性快照、活动配置、丹药预算和随机状态，输出战斗事件、胜负、消耗和奖励意图。普通地图、三档秘境和六境界高阶 Boss 共用结算接口，但使用不同活动配置。

### 经济与库存模块

所有资源经过非负校验、库存上限和溢出规则。突破优先于可选活动；生产只能消耗资源预留之外的数量；仓库满载时按 `retain_rare` 和 `progression_reserve=1` 处理装备。

### 离线结算模块

单次最多结算 `24h`，按 `60s` 批处理和动作余数结转。每次结算必须具备唯一 `settlement_id`、`expected_revision` 和服务器时间区间，并在同一数据库事务中写入库存、余数、保底、随机状态和结算记录。

### 排行榜模块

排行榜只读取已提交状态或异步读模型，不能参与战斗奖励和成长判定。V1 支持战力、境界、Boss 进度、丹道、炼器和收藏等榜单。

## 权威状态与并发规则

核心状态至少包括：

- `player_state`：境界、修为、主行动、登录/结算时间、`state_revision`。
- `building_state`：建筑等级、当前配方/研究对象、动作余数、队列状态。
- `inventory_state`：资源数量、装备实例、仓库容量和溢出统计。
- `progress_state`：地图/秘境保底、高阶入口、活动轮换和随机事件状态。
- `collection_state`：功法层数、法宝星级、重复转换和收藏印记。
- `settlement_record`：结算 ID、请求区间、实际秒数、配置版本、摘要哈希和提交状态。

所有写请求执行：

```text
校验请求 -> 校验 expected_revision -> 读取同一配置快照
-> 模拟状态变化 -> 校验非负/上限/奖励边界
-> PostgreSQL 原子提交 -> state_revision + 1
```

重复 `settlement_id` 返回首次摘要；旧 revision 拒绝；时间回拨和完全重叠区间不发放收益。数据库隔离级别和行锁属于工程验收，但不得改变上述数值契约。

## API 最小集合

- `GET /v1/bootstrap`：返回配置版本、玩家状态和可用内容。
- `POST /v1/actions/start`：开始/切换一个主动序列，先结算未结算区间；炼丹/炼器/研究也使用此路由。
- `POST /v1/settlements/offline`：提交离线结算请求。
- `POST /v1/buildings/spirit_farm/plant`：种植灵田批次；不占全局主动槽，成熟后下一次离线结算自动入库。
- `POST /v1/buildings/{buildingId}/jobs`：仅为 legacy 历史队列兼容入口；`global_single_slot_v1` 下拒绝新建，不得用于表达当前炼丹/炼器玩法。
- `POST /v1/progression/breakthrough`：按冻结材料和修为执行突破。
- `POST /v1/equipment/{instanceId}/actions`：按 `action` 执行装备 equip/unequip/reinforce/promote/reroll/lock/awaken/salvage/sell；服务端校验实例归属、部位、资源、锁定槽和当前 revision。
- `GET /v1/combat/preview`：只读战斗预览，不写奖励和库存。
- `GET /v1/leaderboards/{type}`：读取排行榜快照。

所有会改变状态的接口都必须携带客户端生成的幂等键和 `expected_revision`；服务端生成随机种子和结算摘要。

## 配置目录

```text
game_data/
  manifest.json
  realm.json
  activities.json          # 3 普通地图 + 3 秘境 + 高阶入口
  monsters.json
  loot_tables.json
  equipment.json
  techniques.json
  treasures.json
  items.json
  recipes.json
  buildings.json
  actions.json
  modifiers.json
  progression.json
```

静态内容 ID 必须稳定；数值参数引用 `parameter_id`，不在内容文件中复制同一数值。配置缺项、重复 ID、版本不匹配时服务启动失败。

## MVP 交付范围

V1 MVP 不是另造一套缩小数值，而是实现冻结基线的最小闭环：

- 境界：炼气、筑基、金丹，以及元婴至渡劫六个高阶境界；高阶境界各 10 个小境界。
- 普通地图：百草谷、黑风谷、赤炎洞；秘境：清风、炎狱、天渊。
- 建筑：练功房、炼丹房、炼器房、灵田、功法阁、法宝阁。
- 装备：武器、四防具、饰品六部位；六档品质；词条、强化、升品、洗练、觉醒和仓库出口。
- 核心循环：查看当前主动序列 -> 在序列之间切换并自动结算 -> 种植灵田并等待成熟 -> 远征/掉落/成长 -> 突破。

## 实施顺序

1. 配置包、参数 manifest、Schema 校验和 PostgreSQL 状态表。
2. 玩家状态、单主动序列、灵田种植和离线结算事务。
3. 普通地图逐秒战斗、库存/掉落/保底和装备实例。
4. 三档秘境 Boss 状态、高阶入口和失败活动状态机。
5. 功法、法宝、装备成长、排行榜读模型和前端页面。

## 验收标准

- 服务器使用冻结参数表，能复算全量审计关键样例。
- 同一结算 ID 重试不重复发放；旧 revision 被拒绝。
- 24 小时离线结算、资源上限、保底、失败冷却和随机状态可回放。
- 客户端显示值与服务端结算摘要一致；任何客户端传入的结果字段都被忽略。
