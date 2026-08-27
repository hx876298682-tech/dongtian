# 《洞天》Web版 API 与数据库详细契约 V1.0

## 契约范围

本契约面向 `1.0.0-frozen` 数值基线的 Web MVP。所有写操作由服务端完成，客户端不能提交修为、掉落、伤害、战斗结果或最终库存。

### `GET /v1/action-catalog`

返回当前玩家可用于全局行动槽的只读目标目录，响应使用统一 envelope，`data.schemaVersion` 为
`action_catalog_v1`，`data.actionModel` 为 `global_single_slot_v1`。目录包含功法、丹方、器方及装备模板、
斩妖地图和采集地图，客户端提交行动时分别使用 `techniqueId`、`recipeId`、
`recipeId + equipmentTemplateId` 或 `mapId`。

目录状态必须按来源解释：`released` 表示当前冻结内容/参数；`proposal_v1` 表示运行时已有 MVP
切片但尚未进入正式冻结内容（当前功法挂机专注目标、采药、挖矿属于此类）；`content_pending` 不得启动。
该 GET 路由不结算、不迁移、不写入玩家状态，返回 envelope 的 `stateRevision` 仅用于客户端读取一致性。

统一请求头（所有需要认证的请求）：

```text
Authorization: Bearer <access_token>
Idempotency-Key: <client_generated_key>
X-Expected-Revision: <integer>
X-Config-Version: 1.0.0-frozen
```

`Idempotency-Key` 只对状态写入路由强制要求（管理员的 `/v1/admin/config/refresh` 是无 body 的刷新例外）；只读路由不需要它。玩家状态写入路由要求 revision；
管理员配置发布路由不使用玩家 revision。`X-Expected-Revision`
可以只放在请求头，也可以同时放在 JSON body 的 `expectedRevision` 字段中；两处都提供时必须相同。
HTTP JSON 响应实际使用 camelCase 字段：`requestId`、`configVersion`、`stateRevision`、`serverTime`。
健康检查是例外：`GET /healthz` 只返回 `{"status":"ok"}`，`GET /readyz` 返回 readiness 报告；
`GET /metrics` 返回 Prometheus text，不是 JSON envelope。

## 数据库原则

- PostgreSQL 是唯一权威状态库；Redis 不保存不可恢复的最终资源状态。
- 资源数量和生产余数使用非负 `numeric`；需要整数语义的修为、revision、计时字段使用 `bigint`/整数约束。
- 所有玩家状态表使用 `player_id` 主键或复合唯一键，写事务锁定同一玩家状态行。
- 所有状态写入带 `state_revision`；更新条件必须包含旧 revision。
- `config_version` 写入每次结算和内容实例，保证历史结果可回放。
- 软删除只用于内容或审计记录；库存、结算和保底记录不得物理删除。

## 核心表

### `player_state`

```text
player_id              uuid primary key
realm_id               text not null
substage_index         smallint not null default 0
cultivation_xp         bigint not null check (cultivation_xp >= 0)
primary_action_id      text null
primary_action_started timestamptz null
primary_action_carry_seconds bigint not null default 0 check (primary_action_carry_seconds >= 0)
last_settled_at        timestamptz not null
state_revision         bigint not null default 0 check (state_revision >= 0)
config_version         text not null
equipment_count        bigint not null default 0 check (equipment_count >= 0)
created_at             timestamptz not null
updated_at             timestamptz not null
```

### `building_state`

```text
player_id              uuid not null references player_state(player_id)
building_id            text not null
level                  smallint not null check (level between 1 and 5)
active_job_id          uuid null
job_started_at         timestamptz null
carry_seconds          numeric not null default 0 check (carry_seconds >= 0)
carry_quantity         numeric not null default 0 check (carry_quantity >= 0)
planted_plots          numeric null
planted_at             timestamptz null
mature_at              timestamptz null
queued_job_ids         jsonb not null default '[]'
state_revision         bigint not null default 0 check (state_revision >= 0)
primary key (player_id, building_id)
```

### `inventory_resource`

```text
player_id              uuid not null references player_state(player_id)
resource_id            dongtian_resource_id not null
amount                 numeric not null check (amount >= 0)
capacity               numeric not null check (capacity >= 0)
reserved_amount        numeric not null default 0 check (reserved_amount >= 0)
overflow_amount        numeric not null default 0 check (overflow_amount >= 0)
state_revision         bigint not null default 0 check (state_revision >= 0)
primary key (player_id, resource_id)
```

`resource_id` 使用 PostgreSQL `dongtian_resource_id` enum，允许值为
`spirit_stone/spirit_herb/spirit_ore/spirit_wood/pill/ancient_scroll/millennium_herb/meteor_iron/demon_core`。
`amount + reserved_amount` 不得超过可用容量；溢出只记录结算摘要和统计，不自动转成未登记货币。

### `equipment_instance`

```text
instance_id            text not null
player_id              uuid not null references player_state(player_id)
template_id            text not null
slot                   text not null
quality                text not null
reinforcement_level    smallint not null default 0
awakening_level        smallint not null default 0
affixes                jsonb not null
locked_slots           jsonb not null default '[]'
is_equipped            boolean not null default false
created_config_version text not null
created_at             timestamptz not null
primary key (player_id, instance_id)
```

`instance_id` 是稳定的内容/运行时字符串，唯一性限定在玩家内；数据库主键为
`(player_id, instance_id)`，不是全局 UUID。
`slot` 只能是 `weapon/armor_1/armor_2/armor_3/armor_4/accessory`；词条和品质必须通过内容 Schema 校验。

### `collection_state`

```text
player_id              uuid primary key references player_state(player_id)
technique_layers       jsonb not null default '{}'
technique_research_xp  bigint not null default 0 check (technique_research_xp >= 0)
treasure_stars         jsonb not null default '{}'
collection_marks       bigint not null default 0 check (collection_marks >= 0)
duplicate_balances     jsonb not null default '{}'
state_revision         bigint not null default 0 check (state_revision >= 0)
```

### `progress_state`

```text
player_id              uuid primary key references player_state(player_id)
map_pity               jsonb not null default '{}'
dungeon_pity           jsonb not null default '{}'
random_event_state     jsonb not null default '{}'
support_route_state    jsonb not null default '{}'
high_tier_gate_state   jsonb not null default '{}'
failure_cooldowns      jsonb not null default '{}'
active_dungeon_id      text null
dungeon_status         text not null default 'idle'
dungeon_phase          smallint not null default 0 check (dungeon_phase >= 0)
dungeon_boss_hp        numeric not null default 0 check (dungeon_boss_hp >= 0)
dungeon_started_at     timestamptz null
dungeon_carry_seconds  bigint not null default 0 check (dungeon_carry_seconds >= 0)
dungeon_failure_cooldown_until timestamptz null
random_state           jsonb not null
state_revision         bigint not null default 0 check (state_revision >= 0)
```

`dungeon_status` 只能是 `idle/fighting/success/failed/cooldown`；`dungeon_boss_hp` 使用
`numeric` 保留战斗结算中的小数 HP。

### `settlement_record`

```text
settlement_id          uuid primary key
player_id              uuid not null references player_state(player_id)
request_started_at     timestamptz not null
request_ended_at       timestamptz not null
settled_seconds        bigint not null check (settled_seconds between 0 and 86400)
expected_revision      bigint not null check (expected_revision >= 0)
committed_revision     bigint null check (committed_revision >= 0)
config_version         text not null
summary_hash           text not null
status                 text not null
response_payload      jsonb not null
created_at             timestamptz not null
committed_at           timestamptz null
claim_token            text null
claim_until            timestamptz null
```

`settlement_id` 唯一；状态只能是 `pending/committed/rejected`。重复请求必须返回同一 `response_payload`。

### `audit_event`

```text
event_id               uuid primary key
player_id              uuid not null references player_state(player_id)
settlement_id          uuid null references settlement_record(settlement_id)
event_type             text not null
before_revision        bigint not null check (before_revision >= 0)
after_revision         bigint not null check (after_revision >= 0)
config_version         text not null
payload_hash           text not null
payload                jsonb null
created_at             timestamptz not null
```

审计日志保存摘要哈希，不在日志中保存可被客户端修改的最终资源来源。

## API 契约

### `GET /v1/bootstrap`

返回玩家快照、建筑、库存摘要、可用活动、待结算区间和配置版本。只读，不推进时间、不发放收益。

### `POST /v1/actions/start`

请求：

```json
{
  "actionId": "black_wind_valley",
  "expectedRevision": 12
}
```

HTTP 层只接受上述 camelCase 字段；`action_id` 或 `expected_revision` 等 snake_case 字段会以
`VALIDATION_FAILED` 拒绝，不提供旧字段兼容别名。

服务端先结算上一段未结算区间，再校验活动解锁、失败冷却和资源预留，成功后替换 `primary_action` 并递增 revision。

### `POST /v1/settlements/offline`

请求：

```json
{
  "settlementId": "uuid",
  "requestedStartedAt": "server_snapshot_time",
  "requestedEndedAt": "server_now",
  "expectedRevision": 12
}
```

处理顺序：服务器时间校验 -> 裁剪最多 24h -> 裁剪重叠区间 -> 读取配置快照 -> 当前 `primary_action` 逐批模拟并处理灵田显式成熟批次 -> 战斗/生产/掉落/保底/库存校验 -> 原子提交。`global_single_slot_v1` 下不会模拟 legacy building queue。

### `POST /v1/buildings/{buildingId}/jobs`

请求包含 `recipeId`、`quantity`、`expectedRevision`。当前 HTTP DTO 不接受 `collectionId`；资源不足不扣部分输入；生产失败率按 V1 参数为 0。该 route 只保留 legacy 队列兼容，`global_single_slot_v1` 下拒绝新建；当前炼丹/炼器必须通过 `/v1/actions/start`，不使用此队列和领取语义。

### `POST /v1/buildings/spirit_farm/plant`

请求包含 `plots`（1 至当前冻结 `plot_count`）和 `expectedRevision`，并要求 `Idempotency-Key`。该端点不占用全局主动行动槽，不引入未冻结的种子资源或成本；服务端沿用灵田成熟时间、建筑速度倍率和每 plot 产量参数，写入 `planted_plots`、`planted_at`、`mature_at`。成熟批次在下一次离线结算事务中自动入库并清空种植状态。旧安装 `planted_plots IS NULL` 继续使用兼容的连续灵田产出模式，直到显式种植迁移。

### `POST /v1/buildings/spirit_farm/plots/{plotId}/plant`

新逐块接口。body 为 `plantId` 与 `expectedRevision`，要求 `Idempotency-Key`；`plotId` 必须为 `plot_1` 至当前冻结 `plot_count`。接口不占用全局主动行动槽，允许不同地块同时种植，但同一 `plotId` 在成熟前重复种植返回 `VALIDATION_FAILED`。成熟后由下一次离线结算事务自动入库并清除该地块状态，重复结算幂等。

### `POST /v1/progression/breakthrough`

服务端检查修为、灵石、丹药和特殊材料。材料不足返回缺口，不改变任何状态；材料齐全执行 100% 成功的原子支付与境界迁移。

### `POST /v1/combat/preview`

只读请求只接受 `activityId` 和 `expectedRevision`，返回属性快照、预计结果、丹药预算、入口门槛和配置版本；
当前版本不接受客户端提交装备/功法选择，也不写战斗日志、奖励、保底或库存。

### `POST /v1/combat/start`

请求只接受 `activityId` 和 `expectedRevision`。`activityId` 为三档秘境 ID 或六境界高阶 realm；服务端生成并持久化 `attemptId` 与随机种子，客户端不能提交这两个字段。

普通地图长期挂机不要求客户端逐场调用，由离线/行动结算批量模拟。

### `POST /v1/equipment/{instanceId}/actions`

`action` 枚举：`equip/unequip/reinforce/promote/reroll/lock/awaken/salvage/sell`。每次操作必须校验实例归属、部位、资源、锁定槽和当前 revision。

### 已实现扩展端点

以下端点已经由当前 HTTP adapter 提供，字段白名单、认证、配置版本和错误 envelope 遵循本契约顶部的统一规则。随机事件仍不在接口范围内；FI-05 兑换已按批准的 starter/境界分池协议登记。

#### 主行动与结算

- `POST /v1/actions/stop`：请求字段为 `settlementId`、`requestedStartedAt`、`requestedEndedAt`、`expectedRevision`；先结算当前行动，再清空主行动。
- `POST /v1/actions/switch`：请求字段为 `actionId`、`settlementId`、`requestedStartedAt`、`requestedEndedAt`、`expectedRevision`；原子完成旧行动结算、停止并启动新行动。
- `POST /v1/actions/start`：`actionId` 可为 `training`、普通地图、已登记秘境/高阶行动、`alchemy`、`forge`、兼容旧调用的 `alchemy_basic`/`forge_basic`、`technique_research` 或 `treasure_research`。`alchemy` 必须携带 `recipeId`；`forge` 必须携带 `recipeId` 与 `equipmentTemplateId`，服务端只接受当前内容包中已发布的目标。选择目标写入 `primary_action.targetId`，目标与当前行动不同时时，服务端先完成旧行动结算。炼丹完成批次直接写入资源；炼器按正式 writer 生成 `EquipmentInstance` 并直接入库，不提供领取动作。未知 recipe/template fail-closed。
- `POST /v1/settlements/offline`：除 settlement body 外必须携带 `Idempotency-Key`；settlement ID 负责 durable replay，重复请求返回首次响应。

#### 建筑与只读经济投影

- `POST /v1/buildings/spirit_farm/plant`：legacy 批次兼容接口，body 为 `plots`（1 至当前灵田地块上限）和 `expectedRevision`。
- `POST /v1/buildings/spirit_farm/plots/{plotId}/plant`：逐块正式接口，body 为 `plantId` 和 `expectedRevision`；不同地块可并行等待成熟，同一地块不可重叠种植。两者均不占主动行动槽，成熟收益在离线结算中自动入库。
- `POST /v1/buildings/{buildingId}/jobs`：仅 legacy 兼容；global model 下不能新建或被动结算，不能作为炼丹/炼器 UI 入口。
- `POST /v1/buildings/{buildingId}/upgrade`：只接受 `expectedRevision`，按冻结建筑升级成本原子扣除并递增 revision。
- `POST /v1/economy/long-term`：只读长期经济投影，body 为 `horizonHours`（720 或 2160）和 `seed`，不修改玩家状态。
- `POST /v1/economy/long-term/equipment-consumption`：只读长期装备消费投影，body 为 `horizonHours` 和 `seed`；正式自动升品 mutation 不属于此端点。
- `POST /v1/economy/long-term/confidence`：只读确定性置信区间投影，body 为 `horizonHours`、`seed`、`sampleCount`，不修改玩家状态。

#### 秘境与高阶战斗

- `GET /v1/dungeons/{dungeonId}/preview`：只读秘境入口、Boss、丹药和当前保底摘要。
- `POST /v1/dungeons/start`：body 为 `dungeonId`、`expectedRevision`；服务端生成 `attemptId` 和 seed。
- `POST /v1/dungeons/settle`：body 为 `attemptId`、`expectedRevision`；`outcome` 为服务端字段，客户端提交会被拒绝；要求 `Idempotency-Key`。
- `GET /v1/high-tier/{realm}/preview`：只读高阶入口门槛、技能摘要、丹药预算和配置版本。
- `POST /v1/high-tier/start`：body 为 `realm`、`expectedRevision`；服务端生成并持久化 attempt 与 seed。
- `POST /v1/high-tier/settle`：body 为 `attemptId`、`expectedRevision`；`outcome` 为服务端字段，客户端提交会被拒绝；要求 `Idempotency-Key`。
- `POST /v1/combat/start`：统一 start 入口；`activityId` 仅可为已登记秘境 ID 或高阶 realm，实际转发到对应 start service。

#### 查询、回放与排行榜

- `GET /v1/replays/{settlementId}`：仅允许认证玩家读取其自己的 settlement replay；不重新计算历史结果。
- `GET /v1/collection/events`：读取当前玩家的收藏 append-only 事件流；支持 `limit` 和可选 `before` 游标。
- `GET /v1/leaderboards/{type}`：`type` 为 `realm`、`cultivation_xp` 或 `combat_power`；支持 `limit`（1-100）和 `offset`（0-100000），只读且不递增玩家 revision。

#### 收藏与管理配置

- `POST /v1/collection/actions`：当前已实现 action 为 `research` 和 `treasure_upgrade`；两者的字段互斥并要求 `expectedRevision` 与 `Idempotency-Key`。
- `POST /v1/collection/exchanges`：FI-05 兑换请求仅接受 `poolId`、`targetTreasureId`、`expectedRevision`，成本固定为 10 个所选池印记；目标必须为该池 0 星对象。池余额独立，starter 以外的境界池要求玩家达到对应境界；池满返回 `COLLECTION_POOL_COMPLETE`，请求必须携带 `Idempotency-Key`。
- `POST /v1/equipment/auto-promotion/policy`：保存显式目标自动升品策略；仅在正式 `schedule.equipment.auto_promotion.enabled=1` 参数存在时启用。
- `POST /v1/equipment/auto-promotion/cycles`：执行服务器小时 `cycleId`；目标和重复件必须同模板/部位/品质，重复件不得已装备或锁定，资源必须保留策略线；批次事务失败时不写入装备或资源。
- `POST /v1/admin/config/refresh`：仅 admin role；无 body、无玩家 revision、无需 `Idempotency-Key`，刷新当前 active release。
- `POST /v1/admin/config/canary`：仅 admin role；body 为 `version`、`reason`、`canaryPercent`，要求 `Idempotency-Key`。
- `POST /v1/admin/config/activate`：仅 admin role；body 为 `version`、`reason`，要求 `Idempotency-Key`。
- `POST /v1/admin/config/rollback`：仅 admin role；body 为 `version`、`reason`，要求 `Idempotency-Key`。

#### 运维端点

- `GET /healthz`：未认证存活探针，固定返回 `{ "status": "ok" }`，不返回配置或依赖详情。
- `GET /readyz`：未认证就绪探针；缺少或异常的 database/config/scanner 任一依赖均返回 `503` 和 `not_ready`。
- `GET /metrics`：认证后返回 Prometheus text；设置 `DONGTIAN_METRICS_REQUIRE_ADMIN=1` 时要求 admin role，不返回 JSON envelope。

## 错误码

```text
AUTH_REQUIRED             未登录或 token 无效
FORBIDDEN                 已登录但缺少管理员权限
CONFIG_VERSION_MISMATCH   客户端配置版本过期
STALE_REVISION            expectedRevision 过期
DUPLICATE_REQUEST         请求已完成，返回首次摘要
TIME_RANGE_INVALID        时间回拨或结束早于开始
OVERLAP_ALREADY_SETTLED   请求区间已被结算
OFFLINE_RANGE_CLIPPED     请求超过 24h；响应返回裁剪后的可结算区间
CONTENT_LOCKED            内容未解锁
RESOURCE_INSUFFICIENT     资源不足，不改变状态
PILL_INSUFFICIENT         丹药不足，战斗不发奖励
GATE_BLOCKED              高阶 Boss 门槛不足
COOLDOWN_ACTIVE           失败恢复或活动冷却中
INVENTORY_FULL            仓库满载，返回出口处理预览
NOT_FOUND                 资源或回放记录不存在
VALIDATION_FAILED         请求字段或内容引用非法
INTERNAL_ROLLBACK         事务失败，保证无部分提交
TRANSACTION_RETRYABLE     瞬时事务冲突，客户端可在保持幂等 key 的前提下重试
```

## 事务与 CAS 规范

所有状态写请求必须在一个 PostgreSQL 事务中完成：

```text
BEGIN
  select player_state and related states for update
  check expected_revision
  calculate result with one config snapshot
  write inventory/building/progress/collection changes
  insert settlement or action audit record
  increment revisions
COMMIT
```

如果任一校验失败，整体回滚。重复 `settlement_id` 不重新计算；失败战斗只提交冷却和 revision，不提交奖励、丹药扣除或保底推进。

## 迁移和兼容

- 数据库迁移按 `V1_001`、`V1_002`、`V1_003` 顺序执行，不允许手工修改线上表；`V1_003` 持久化跨实例 metrics 事件，供监控适配器重放聚合。
- 参数版本升级必须先发布只读兼容代码，再发布新配置，再开放新写入。
- 历史结算保留原 `config_version`，不能用当前公式重算历史奖励。
- 新字段必须可空或提供明确默认值；改变含义的字段必须新增字段名和迁移脚本。

状态：`engineering_contract_v1`。
### `spirit_farm_plot_state`

逐块灵田的权威状态。该表与旧 `building_state.planted_plots` 批次字段并存：新客户端使用逐块模型，旧安装继续按旧字段读取，不能把两种模型混种在同一玩家状态中。

```text
player_id              uuid references player_state not null
plot_id                text not null                 -- plot_1 .. plot_N，N 为冻结 plot_count
plant_id               text not null                 -- 内容标识；当前不引入未冻结种子成本
planted_at             timestamptz not null
mature_at              timestamptz not null         -- 必须晚于 planted_at
state_revision         bigint not null default 0
primary key (player_id, plot_id)
```

每块地最多一个未成熟种物。成熟结算在同一个离线结算 CAS 事务中增加 `spirit_herb` 并删除该行；重复结算不会重复发放。`plant_id` 当前只作为种物身份和回放审计字段，产量沿用冻结的 `building.spirit_farm.herb_yield_per_plot`，正式种子成本/不同灵物产出需另行冻结内容包。
