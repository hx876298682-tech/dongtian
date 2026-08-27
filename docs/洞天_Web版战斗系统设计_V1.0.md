# 《洞天》Web版战斗系统设计 V1.0

## 设计基线

战斗服务端严格使用 `1.0.0-frozen` 参数表和活动配置。战斗是自动、逐秒、可回放的状态机；客户端只负责战前配置、预览和展示，不参与伤害、胜负或奖励计算。

V1 不启用暴击、PVP 或主动技能按钮，但五行、词条特殊效果、秘境 Boss 状态、灵灼、丹药自动使用、高阶境界专属技能和失败恢复已经属于冻结战斗规则，不能再标为“后期开启”。

## 战斗上下文

一次战斗输入：

```text
player_snapshot
equipment_snapshot
technique_snapshot
treasure_snapshot
activity_id
pill_budget
random_seed
config_version
```

一次战斗输出：

```text
outcome                 # success / timeout / player_dead / gate_blocked
elapsed_seconds
event_log_hash
damage_summary
pill_used
loot_intent
pity_delta
failure_cooldown_until
```

普通地图、秘境和高阶 Boss 使用同一个接口，通过 `activity.type` 选择对应规则。

## 角色属性汇总

基础值和成长对象相加：

```text
attack  = base_attack  + equipment_attack  + technique_attack  + treasure_attack
defence = base_defence + equipment_defence + technique_defence + treasure_defence
health  = base_health  + equipment_health  + technique_health  + treasure_health
speed   = base_speed   + equipment_speed   + technique_speed   + treasure_speed
```

V1 基础值：

```text
base_attack=120
base_defence=100
base_health=1000
base_accuracy=100
base_evasion=100
base_attack_interval=4s
min_attack_interval=1s
```

功能词条先汇总：

```text
outgoing_special = 1 + sum(armor_break_grade * 0.02)
incoming_special = max(0, 1 - sum(body_protection_grade * 0.02))
health = base_health * (1 + sum(vitality_grade * 0.04)) + flat_health
pill_heal = base_pill_heal * (1 + sum(rejuvenation_grade * 0.05))
```

未装备的词条、功法或法宝按 0 处理。特殊词条只影响登记的战斗项，不改变掉落概率、突破成本或资源产能。

## 攻击间隔与命中

```text
attack_interval = max(1,
  4 / (1 + speed / 100)
)
```

命中率按攻击方命中与防守方闪避计算：

```text
if accuracy >= evasion:
  hit_chance = 1 - evasion / (2 * accuracy)
else:
  hit_chance = accuracy / (2 * evasion)
```

冻结基础样例为 `100 accuracy / 50 enemy evasion = 0.75` 命中率。命中率不是展示战力的线性属性。

## 伤害与五行

V1 不使用未登记的 `0.8–1.2` 随机伤害倍率。单次命中伤害为：

```text
raw_damage = attacker_attack * combat.damage.base_coefficient
             * 100 / (100 + defender_defence)
             * hit_result
             * outgoing_special
             * element_multiplier
             * phase_multiplier
```

`combat.damage.base_coefficient=0.5`。五行闭环为金克木、木克土、土克水、水克火、火克金：

```text
克制：1.25
被克制：0.80
中性、同属性或任一方 neutral：1.00
```

五行倍率只应用一次；普通地图默认角色为 `neutral`，已有元素词条或配置后才启用克制。

## 战力

战力只用于展示和排行榜，不替代实际 DPS、生存或入口门槛判定：

```text
battle_power = attack * 1.0
             + defence * 0.8
             + health * 0.05
             + speed * 2.0
```

基础角色战力为 `250`。高阶入口使用 `collected_p10` 的攻击、防御、生命三项门槛，不使用单一战力值。

## 普通地图战斗

首发普通地图：

| 地图 | 目标击杀时间 | 敌方防御 | 敌方闪避 | 结算方式 |
| --- | ---: | ---: | ---: | --- |
| 百草谷 | 30s | 30 | 50 | 成功后发资源、装备、残卷抽取 |
| 黑风谷 | 90s | 70 | 50 | 成功后发资源、装备、残卷抽取 |
| 赤炎洞 | 240s | 120 | 50 | 成功后扣 4 丹药，再发奖励 |

普通地图按目标击杀时间计算每场完成时点。资源、装备品质和古修残卷保底使用对应 `map.*` 与 `loot.*` 参数；失败不发奖励，第一次失败停止该主行动后续战斗并进入 `60s` 恢复冷却。

## 秘境 Boss 战斗

秘境目标通关时间为清风/炎狱/天渊 `600/1200/2400s`。Boss 统一执行：

1. 开战建立基础生命、初始护盾和状态计时器。
2. 每秒处理技能计时、眩晕、玩家攻击、Boss 攻击、持续伤害和自动丹药。
3. 护盾存在时，玩家普通伤害先扣护盾；生命低于等于 `50%` 时进入二阶段，Boss 伤害乘 `1.20`。
4. Boss 每 `60s` 尝试眩晕 `3s`；眩晕秒跳过玩家攻击。
5. 灵灼按秘境配置施放；玩家状态抗性 `20%`，Boss 控制抗性 `25%`、持续伤害抗性 `30%`。
6. Boss 被击败后扣本场丹药，再原子发放妖丹、稀有资源、功法/法宝抽取和保底更新。

Boss 失败时：奖励为 0、丹药不扣、保底不推进、只提交失败冷却和状态 revision；重试必须带 expected revision 和幂等 attempt ID。

## 丹药与生存

```text
if health <= max_health * 40% and pills_available:
  consume 1 pill
  health = min(health + 250, max_health * 80%)
```

恢复词条只按登记倍率放大治疗量。成功战斗结束时生命重置为满值；失败战斗不发奖励并保留失败恢复状态。三档秘境基础 Boss 自动丹药预算为 `2/18/84`，具体场次由逐秒模拟决定。

## 高阶入口与专属技能

元婴至渡劫高阶 Boss 每 `168h` 一次遭遇，使用 `collected_p10` 构筑入口门槛。门槛外的结果为 `gate_blocked`，不扣 Boss 丹药、不发独立掉落、不推进 Boss 保底；小时级高阶资源供给仍按冻结供给率结算。

门槛内使用境界专属 Boss 技能：持续时间和攻击压制从 `dungeon.high_tier.*.signature_skill.*` 读取。门槛内自然失败候选为 `0%`，若未来构筑导致 timeout 或死亡，沿用失败活动状态机，不虚构成功奖励。

## 战斗逐秒伪代码

```text
validate activity, gate, config_version, pill budget
snapshot player/equipment/technique/treasure stats
initialize hp, boss hp/shield, phase, pity, random seed
for second in 1..target_seconds:
  tick status timers and scheduled skills
  if player is not stunned and attack timer is ready:
    resolve hit -> defence -> special -> element -> shield/hp
  if boss attack timer is ready:
    resolve boss hit -> defence -> status -> player hp
  apply DoT and phase multiplier
  use auto pill if threshold reached
  stop on boss death, player death, or timeout
commit success rewards only after full validation
```

事件顺序、随机状态和结果摘要必须写入可回放日志；客户端只接收日志摘要，不得修改中间事件。

## 挂机与离线

角色只有一个主动序列；炼丹/炼器/研究不能作为后台生产与战斗并行，灵田显式种植不占主动槽。离线结算最多 `24h`，按在线相同动作间隔、`60s` 批处理和余数结转执行。离线战斗中的第一次失败立即停止该地图后续战斗；已经完成的成功场次正常发奖。当前序列切换会先结算旧序列。

每次结算必须使用 `settlement_id`、服务器时间、`expected_revision` 和固定 `config_version`。重复结算返回原摘要；完全重叠、时间回拨和过期 revision 拒绝。

## 掉落与奖励事务

奖励顺序固定为：

```text
战斗成功 -> 扣本场资源 -> 计算掉落/品质/保底
-> 应用库存上限与溢出 -> 装备出口/进阶保留
-> 写入结算摘要和新 revision
```

普通/精良装备按 `retain_rare` 自动分解；稀有及以上按含词条期望售价出售，仓库满载时先保留进阶所需的一个重复件。失败场不执行上述奖励事务。

## V1 明确不包含

- 暴击、PVP、主动技能按钮和未登记的随机伤害。
- 用推荐战力替代真实战斗判定。
- 客户端本地结算奖励。
- 将后续内容或商业化货币写回 `1.0.0-frozen` 参数。
