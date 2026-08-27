# 《洞天》Web版首发内容规格 V1.0

> 当前 runtime 说明：建筑表中的炼丹房、炼器房、功法阁和法宝阁是可被主动序列选择的动作来源，不是与战斗并行的后台队列；灵田通过显式种植不占主动槽，成熟后自动入库。实际 API/状态以 `global_single_slot_v1` 和《洞天_Web版API与数据库详细契约V1.0》为准。

## 文档定位

本文件把 `1.0.0-frozen` 数值参数绑定为可实现的首发内容对象。它只新增内容对象 ID、配置关系、展示字段和待制作字段，不改写数值参数表。

冻结基线：

- 参数版本：`1.0.0-frozen`
- 参数表：`docs/洞天数值参数表.csv`
- 参数表 SHA-256：`7113fe72dd40ed36869408551f5f20a9e72e83af519b4a03d657296ed4987f75`
- 内容状态：`content_spec_v1`
- 未填入的名称、图标、立绘、文本和行为脚本不得在运行时使用临时默认值，必须标记为 `content_pending`。

## 首发范围

| 内容类型 | 首发规模 | 状态 |
| --- | ---: | --- |
| 大境界 | 9（炼气、筑基、金丹 + 6 高阶） | 数值已冻结 |
| 普通地图 | 3 | 数值已冻结，内容表现待制作 |
| 秘境 | 3 | 数值已冻结，Boss 表现待制作 |
| 核心建筑 | 6 | 数值已冻结 |
| 装备部位 | 6 | 数值已冻结 |
| 功法对象 | 12 本首发池 | 对象与品质/五行已登记 |
| 法宝对象 | 6 件首发池 | 对象与掉落权重已登记 |
| 高阶法宝 | 6 境界 × 12 件扩展池 | 原型已登记，表现待制作 |

## 内容对象通用字段

所有静态内容对象必须包含：

```text
id                  稳定英文 ID
display_name        中文显示名；未定时 content_pending
description         短描述；未定时 content_pending
icon_asset_id       图标资源 ID；未定时 content_pending
unlock_rule         解锁条件引用
parameter_refs      冻结参数 ID 列表
loot_table_id       掉落表引用（适用时）
behavior_script_id  行为脚本引用（敌人/Boss 适用时）
content_version     内容版本
status              content_spec_v1 / content_pending / released
```

数值字段不在内容文件内复制，统一通过 `parameter_refs` 读取参数表。

## 境界对象

### `realm.json`

| ID | 中文名 | 小境界规则 | 关键引用 |
| --- | --- | --- | --- |
| `qi` | 炼气 | 早期目标 | `growth.cultivation.qi_target_xp` |
| `foundation` | 筑基 | 早期目标 | `growth.cultivation.foundation_target_xp` |
| `core` | 金丹 | 早期目标 | `growth.cultivation.core_target_xp` |
| `nascent_soul` | 元婴 | 10 小境界 | `breakthrough.core_to_nascent_soul.*` |
| `divine_transformation` | 化神 | 10 小境界 | `breakthrough.nascent_soul_to_divine_transformation.*` |
| `void_refining` | 炼虚 | 10 小境界 | `breakthrough.divine_transformation_to_void_refining.*` |
| `body_unity` | 合体 | 10 小境界 | `breakthrough.void_refining_to_body_unity.*` |
| `great_vehicle` | 大乘 | 10 小境界 | `breakthrough.body_unity_to_great_vehicle.*` |
| `tribulation` | 渡劫 | 10 小境界 | `breakthrough.great_vehicle_to_tribulation.*` |

高阶境界使用 `growth.realm.substage_count=10` 和 `growth.realm.high_tier_training_share=0.35`。飞升不进入 V1 首发可玩境界，保留为后续内容入口。

## 普通地图与敌人对象

普通地图对象 ID 固定为 `bai_cao_valley`、`black_wind_valley`、`red_flame_cave`。敌人对象先使用与地图绑定的稳定 ID，敌人名称、立绘和行为脚本属于内容制作字段。

| 地图 ID | 显示名 | 敌人 ID | 目标击杀 | 敌方 HP | 防御 | 闪避 | 攻击 | 命中 | 五行 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `bai_cao_valley` | 百草谷 | `map_bai_cao_enemy` | 30s | 260 | 30 | 50 | 50 | 80 | 木 |
| `black_wind_valley` | 黑风谷 | `map_black_wind_enemy` | 90s | 596 | 70 | 50 | 100 | 100 | 土 |
| `red_flame_cave` | 赤炎洞 | `map_red_flame_enemy` | 240s | 1,227 | 120 | 50 | 200 | 120 | 火 |

上表数值必须读取以下参数前缀，不得复制为第二份可编辑数值：

```text
map.{map_id}.target_kill_time
map.{map_id}.enemy_effective_hp
map.{map_id}.enemy_defence
map.{map_id}.enemy_evasion
map.{map_id}.enemy_attack
map.{map_id}.enemy_accuracy
map.{map_id}.enemy_element
```

### 普通地图奖励绑定

| 地图 | 每场灵石/灵矿/灵木 | 装备掉率 | 残卷掉率 | 残卷保底 |
| --- | --- | ---: | ---: | ---: |
| 百草谷 | `5 / 1 / 1` | 2% | 0.5% | 100 击杀 |
| 黑风谷 | `20 / 2 / 2` | 5% | 1.5% | 100 击杀 |
| 赤炎洞 | `60 / 4 / 4` | 10% | 3% | 100 击杀 |

装备品质权重按普通到仙器分别为：

```text
百草谷：65 / 25 / 8 / 2 / 0 / 0
黑风谷：35 / 35 / 20 / 8 / 2 / 0
赤炎洞：15 / 25 / 30 / 20 / 8 / 2
```

赤炎洞每场消耗 4 丹药；空库存时失败，不发本场奖励，并停止该主行动后续战斗。

## 秘境与 Boss 对象

秘境对象 ID 固定为 `qing_feng`、`yan_prison`、`sky_abyss`；中文显示名为清风秘境、炎狱秘境、天渊秘境。

| 秘境 | 目标通关 | 入口丹药 | Boss 自动丹药 | 妖丹/场 | Boss HP | 防御 | 攻击 | 命中 | 五行 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `qing_feng` | 600s | 2 | 2 | 1 | 4,132 | 100 | 60 | 110 | 木 |
| `yan_prison` | 1,200s | 5 | 18 | 2 | 8,242 | 180 | 120 | 130 | 火 |
| `sky_abyss` | 2,400s | 10 | 84 | 4 | 16,463 | 300 | 240 | 150 | 水 |

三档 Boss 都使用初始护盾 20%、50% 二阶段阈值、60 秒眩晕/3 秒持续、灵灼技能和状态抗性。具体参数引用：

```text
dungeon.{dungeon_id}.boss_*
dungeon.{dungeon_id}.boss_skill.spirit_burn_*
combat.boss.initial_barrier_percent
combat.boss.phase_two_damage_multiplier
combat.boss.stun_interval
combat.boss.stun_duration
combat.player.status_resistance_percent
combat.boss.status.control_resistance_percent
combat.boss.status.damage_over_time_resistance_percent
```

秘境掉落表分别绑定千年灵药、天外陨铁、功法和法宝概率；秘境不使用普通地图古修残卷保底。

| 秘境 | 灵药 | 陨铁 | 功法 | 法宝 |
| --- | ---: | ---: | ---: | ---: |
| 清风 | 20% | 10% | 5% | 1% |
| 炎狱 | 35% | 20% | 10% | 3% |
| 天渊 | 50% | 35% | 20% | 8% |

## 建筑与基础配方

| 建筑 ID | 中文名 | 主要产出/作用 | 基础动作 |
| --- | --- | --- | --- |
| `training_room` | 练功房 | 修为 | 60s / 70 修为 |
| `alchemy_room` | 炼丹房 | 丹药 | 30s / 1 批 |
| `forge_room` | 炼器房 | 装备 | 60s / 1 件 |
| `spirit_farm` | 灵田 | 灵药 | 4 块地 / 7,200s |
| `technique_pavilion` | 功法阁 | 功法研究修为 | 60s / 70 修为 |
| `treasure_pavilion` | 法宝阁 | 收藏印记倍率 | 等级 Modifier |

基础配方：

| 配方 ID | 输入 | 输出 |
| --- | --- | --- |
| `alchemy_basic` | 2 灵药 + 1 灵石 | 1 丹药 |
| `forge_basic` | 4 灵矿 + 2 灵木 + 2 灵石 | 1 件装备 |

六座建筑均为 1–5 级；生产顺序为 `interval_then_quantity`，小数规则为 `carry_fraction`，炼丹和炼器 V1 失败率为 0%。

## 功法对象池

首发 12 本功法，品质各两本，默认同时装备 1 本，最高 100 层：

| ID | 显示名 | 五行 |
| --- | --- | --- |
| `qing_mu_longevity` | 青木长生诀 | 木 |
| `white_head_guard` | 白首守御 | 水 |
| `vajra_body` | 金刚炼体 | 金 |
| `sunfire_canon` | 烈阳经 | 火 |
| `mysterious_water_arts` | 玄水真诀 | 水 |
| `thick_earth_arts` | 厚土诀 | 土 |
| `azure_lotus_sword` | 青莲剑诀 | 木 |
| `heaven_flame_blade` | 天炎刃诀 | 火 |
| `taiyi_method` | 太乙法 | neutral |
| `five_phase_cycle` | 五行轮转 | 金 |
| `hongmeng_void` | 鸿蒙虚空 | neutral |
| `yin_yang_book` | 阴阳书 | 土 |

品质、层数属性、研究成本和重复转换引用 `growth.technique.*`；内容对象只保存对象 ID、品质、元素和显示字段。

## 法宝对象池

首发 6 件法宝，最高 10 星：

```text
qing_lian_lamp   青莲灯   攻击
shan_he_seal     山河印   防御
heaven_bag       乾坤袋   生产效率
zhu_que_feather  朱雀翎   攻击
xuan_gui_shell   玄龟甲   生命
tai_xu_mirror    太虚镜   速度
```

三档秘境对象权重从参数表读取，不在内容文件中重写。元婴至渡劫每境界另有 12 件扩展池，使用 `star_lantern`、`mountain_core`、`heaven_vessel`、`vermillion_wing`、`tortoise_aegis`、`mirror_gate`、`thunder_sword`、`moon_wheel`、`cloud_seal`、`earth_dragon`、`spirit_compass`、`sun_crown` 十二个原型 ID。

## 装备对象模板

### 六部位

```text
weapon, armor_1, armor_2, armor_3, armor_4, accessory
```

部位权重为武器/防具/饰品 `1/4/1`。每件实例固定 3 个词条槽；功能槽上限按普通到仙器为 `0/0/1/1/2/3`。品质为普通、精良、稀有、史诗、传说、仙器。

### 实例最小字段

```text
instance_id
template_id
slot
quality
reinforcement_level
awakening_level
affixes[]
locked_slots[]
created_config_version
```

普通/精良装备进入自动分解；稀有及以上按含词条期望售价出售；仓库满载时优先保留进阶所需的一个同部位重复件。升品、洗练、觉醒和目标词条费用均引用冻结参数。

## 首发内容待制作字段

以下内容不是数值缺口，但在内容包发布前必须补齐：

- 9 个境界的描述、图标和解锁文案。
- 3 个普通地图和 3 个秘境的背景、场景、入口文案和敌人显示名。
- 普通敌人的行为脚本 ID；普通地图当前只冻结战斗属性，不冻结敌人技能表现。
- 三个秘境 Boss 的名称、立绘、技能表现、战斗日志文案和掉落展示文案。
- 六部位装备模板的名称池、图标、外观标签和套用的属性模板。
- 12 本功法、6 件法宝和高阶扩展对象的图标、描述、品质展示和获取提示。
- 解锁规则的具体内容文案；若规则改变数值门槛，必须新增参数变更号并重跑审计。

## 内容包验收

内容包发布前必须满足：

1. 所有对象 ID 唯一，所有 `parameter_refs` 在冻结参数表中存在。
2. 地图/秘境奖励权重合计合法，掉落表不跨普通地图保底和秘境保底。
3. 装备实例只能使用六部位 ID，功法/法宝对象池不能重复注册同一对象。
4. `content_pending` 对象不能被解锁、掉落或进入战斗。
5. 内容包 manifest 的参数版本和 SHA-256 与 `1.0.0-frozen` 一致。

## 下一步

首发内容规格完成后，下一份设计文档应定义“新手引导与解锁流程”，把上述对象按首日、首周和境界节点编排；不在此阶段新增战斗或经济参数。
