# 《洞天》Web版核心玩法数据结构设计 V1.0

## 设计基线

本文件定义《洞天》Web MVP 的静态配置和运行时状态结构，数值来源统一为 `1.0.0-frozen` 参数表。JSON 负责内容对象和引用关系；PostgreSQL 负责玩家状态、库存、行动、保底、随机状态和结算记录。

不得在 JSON 中复制参数表的最终数值。内容对象通过 `parameter_id` 或公式规则引用参数，配置加载时必须校验 ID 存在、版本一致和枚举合法。

## 当前运行时模型：`global_single_slot_v1`

当前 MVP 的主动玩法采用玩家级单行动槽。炼气、普通地图、秘境/高阶远征、炼丹、炼器、功法研究和法宝研究不能并行；新序列启动会先结算旧序列并替换 `primary_action`。炼丹/炼器产出完成后直接进入资源或装备状态，不经过领取动作。

灵田不占主动槽，使用显式种植批次字段 `planted_plots`、`planted_at`、`mature_at`；成熟由下一次离线结算事务自动入库并清空。`planted_plots IS NULL` 只代表旧安装兼容连续模式。旧 `building_job` 结构仅保留读取/回放兼容，不能被解释成当前正在运行的生产序列。

## 配置包

```text
game_data/
  manifest.json
  realm.json
  activities.json
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

### `manifest.json`

```json
{
  "config_version": "1.0.0-frozen",
  "parameter_table": "洞天数值参数表.csv",
  "parameter_sha256": "944c1655e47999bc4405239836b2398749b169d21d61a1f32e20e88bb20f8c92",
  "schema_version": "1.0",
  "status": "frozen_v1"
}
```

### `realm.json`

境界对象至少包含：`id`、`order`、`substage_count`、`target_xp`、`breakthrough_id`、`capacity_multiplier`、`unlock_ids`。首发境界 ID 为：

```text
qi, foundation, core,
nascent_soul, divine_transformation, void_refining,
body_unity, great_vehicle, tribulation
```

炼气/筑基/金丹按 GDD 早期目标结算；元婴至渡劫每境界拆为 10 个小境界，使用 `growth.realm.substage_count=10`。历史 proposal 中的高阶被动练功份额 `growth.realm.high_tier_training_share=0.35` 不在当前 `global_single_slot_v1` runtime 启用。

### `activities.json`

普通地图固定为：`bai_cao_valley`、`black_wind_valley`、`red_flame_cave`。

秘境固定为：`qing_feng`、`yan_prison`、`sky_abyss`。

每个活动包含：

```json
{
  "id": "black_wind_valley",
  "type": "map",
  "unlock": { "realm_id": "foundation" },
  "target_kill_time_parameter": "map.black_wind_valley.target_kill_time",
  "enemy_id": "black_wind_wolf",
  "loot_table_id": "map.black_wind_valley",
  "failure_policy": "stop_primary_action"
}
```

秘境对象额外包含入口丹药、目标通关时间、Boss 配置、四类保底计数器和失败冷却引用。高阶活动额外包含 `entry_gate.profile=collected_p10`；门槛外只阻断 Boss 独立奖励，不阻断登记的小时级资源供给。

### `equipment.json`

装备实例的 canonical 部位只有六个：

```text
weapon, armor_1, armor_2, armor_3, armor_4, accessory
```

展示层可以把四个防具映射为头冠、衣甲、护腕、靴子等名称，但掉落和进阶必须使用六槽 ID，部位权重为武器/防具/饰品 `1/4/1`。

装备定义包含：`id`、`slot`、`quality`、`base_budget`、`affix_pool_id`、`promotion_rule`、`awakening_rule`、`sale_value_rule`。装备实例还必须保存 `instance_id`、`reinforcement_level`、`affixes`、`locked_slots`、`quality`、`created_config_version`。

词条对象至少包含：`type`、`grade`、`value`、`locked`。传说目标模板为 `speed|special`，仙器目标模板为 `speed|element|special`；特殊词条按部位目标映射为武器 `armor_break`、防具 `body_protection`、饰品 `rejuvenation`。

### `techniques.json` 与 `treasures.json`

功法对象包含：`id`、`quality`、`max_layer=100`、每层属性增量、研究成本、重复转换规则。首发对象池为 12 个成员。

法宝对象包含：`id`、`realm_pool`、`max_stars=10`、每星属性、重复兑换资源、满星收藏印记规则。首发六件法宝和元婴至渡劫扩展池均通过对象池 ID 引用。

### `buildings.json`、`recipes.json`

建筑 ID 为：

```text
training_room, alchemy_room, forge_room,
spirit_farm, technique_pavilion, treasure_pavilion
```

建筑等级为 1–5，等级速度倍率为 `1/1.1/1.25/1.45/1.7`。炼丹和炼器 V1 无隐式失败；炼丹基础间隔 30 秒、炼器基础间隔 60 秒，生产 Modifier 顺序为 `interval_then_quantity`，小数余量规则为 `carry_fraction`。

配方对象包含：输入资源、输入数量、动作间隔、输出资源、输出数量和消耗优先级。资源不足时不扣部分材料，不生成部分产出。

## 运行时状态

### `player_state`

```text
player_id
realm_id
substage_index
cultivation_xp
primary_action_id | null
primary_action_started_at | null
primary_action_carry_seconds
primary_action_model_version   # 当前为 global_single_slot_v1
last_settled_at
state_revision
config_version
```

`primary_action` 只能是当前已登记的单一主动序列：闭关、普通地图、秘境/高阶远征、选择配方的炼丹、选择配方与装备模板的炼器、功法研究或法宝研究之一。生产目标写入可选 `targetId`（持久化列 `primary_action_target`），新序列会先结算旧序列。灵田不占用该字段；其它生产/研究不得通过后台 job 绕过该字段。

### `building_state`

```text
player_id
building_id
level
active_job_id | null
job_started_at | null
carry_seconds
carry_quantity
queued_job_ids
planted_plots | null           # 仅 spirit_farm 显式种植批次
planted_at | null
mature_at | null
state_revision
```

灵田按独立种植批次运行；炼丹房、炼器房、功法阁和法宝阁的主动产出由 `primary_action` 驱动。legacy 队列只读不结算。高阶境界的被动练功份额不在当前 global model 启用。

### `inventory_state`

资源使用整数数量并执行参数表库存上限：灵石、灵木、灵矿、灵药、丹药、古修残卷、装备及高阶资源均禁止负数。溢出必须记录到结算摘要，不能静默变成负库存或额外货币。

```text
player_id
resource_balances
equipment_instance_ids
warehouse_level
overflow_counters
state_revision
```

### `progress_state`

```text
map_pity_counters
dungeon_pity_counters
random_event_state
support_route_state
high_tier_gate_state
failure_cooldown_until
random_state
state_revision
```

普通地图古修残卷使用 100 击杀保底；秘境维护四类独立保底；失败不推进保底。随机事件每 168 小时抽取一次，最多同时生效一个：灵潮 `20% / 6h / 1.25x`，妖兽袭扰 `10% / 4h / 0.80x`，只作用于生产动作。

### `collection_state`

```text
technique_layers
treasure_stars
treasure_collection_marks
duplicate_conversion_balances
state_revision
```

### `settlement_record`

```text
settlement_id
player_id
request_started_at
request_ended_at
settled_seconds
expected_revision
committed_revision
config_version
summary_hash
status                  # pending / committed / rejected
```

## 结算和状态迁移

所有会改变资源的请求遵循：

```text
读取服务器时间 -> 限制 24h -> 裁剪重叠区间
-> 读取配置快照和玩家 revision
-> 按当前 primary_action 逐批模拟，并处理灵田显式成熟批次
-> 处理战斗/生产/掉落/保底/库存上限
-> 校验非负和入口门槛
-> 原子写入状态与 settlement_record
```

同一 `settlement_id` 重试返回首次摘要；`expected_revision` 过期直接拒绝；时间回拨、结束早于开始或完全重叠不发放收益。失败战斗不发奖励、不推进保底，普通地图首次失败停止该主行动的后续战斗结算。

## V1 数据规模

V1 不使用与冻结基线冲突的“20 境界、5 地图、8 建筑”草案规模。实现范围是 9 个大境界（其中 6 个高阶扩展）、3 张普通地图、3 档秘境、6 个核心建筑、6 个装备部位、12 个首发功法成员和首发/扩展法宝对象池。后续内容只增加配置，不改写既有 ID。
