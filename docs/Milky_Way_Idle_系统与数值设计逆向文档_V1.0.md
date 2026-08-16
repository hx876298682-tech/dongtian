# 《银河奶牛放置 Milky Way Idle》系统与数值设计逆向文档 V1.0

**版本：V1.0**  
**调研时间：2026-08-15**  
**文档性质：竞品逆向分析，非官方内部 GDD**

---

# 1. 项目概览

## 1.1 产品定位

《Milky Way Idle》是一款：

**多人在线 + Idle RPG + 技能成长 + 生产制造 + 玩家经济 + 自动战斗**

的长期养成游戏。

官方核心描述包括：

- 自定义行动队列
- 离线自动成长
- 10 个非战斗技能
- 7 个战斗技能
- 采集与制造
- 自动战斗
- Boss / Dungeon
- 玩家市场
- 公会
- 组队
- 排行榜
- 长期装备强化

Steam 版于 2025 年 3 月 6 日上线，并与此前已经运行近两年的网页服务器连接；截至 2026 年游戏仍处于持续更新状态。

---

# 2. 最核心的设计理念

游戏本质可以概括成：

> **把 MMORPG 中需要玩家亲自重复执行的劳动，转换成“时间资源配置”。**

传统 RPG：

```text
玩家时间
↓
手动操作
↓
资源
↓
成长
```

Milky Way Idle：

```text
玩家决策
↓
安排未来时间
↓
服务器自动执行
↓
资源
↓
重新规划
```

因此真正需要玩家做的不是操作，而是：

**“接下来 10 个小时，我应该让角色做什么？”**

---

# 3. 核心 Gameplay Loop

整体核心循环：

```text
选择目标
↓
安排行动
↓
消耗时间
↓
获得资源 / XP
↓
升级技能
↓
加工资源
↓
获得装备 / 消耗品
↓
提高效率
↓
挑战更高等级内容
↓
获得高级资源
↓
市场交换 / 再投资
↓
继续循环
```

这里存在三个相互咬合的子循环。

## 3.1 生产循环

```text
采集
↓
原材料
↓
加工
↓
中间材料
↓
制造装备 / 食物 / 饮品
↓
提升生产效率
↓
更高效采集
```

## 3.2 战斗循环

```text
装备
↓
战斗
↓
怪物掉落
↓
高级装备 / 材料 / 技能书
↓
强化
↓
更高难度战斗
```

## 3.3 经济循环

```text
生产 / 战斗
↓
获得商品
↓
市场出售
↓
Coin
↓
购买自己不擅长生产的物品
↓
提高自己的专业效率
↓
生产更多商品
```

真正让游戏拥有 MMO 属性的是第三条。

---

# 4. 行动系统 Action Queue

这是整个产品最重要的核心系统。

## 4.1 基本机制

玩家选择一个行动后，角色会不断重复执行。

例如：

```text
Milk Cow
Milk Cow
Milk Cow
……
```

玩家也可以提前加入多个有限行动：

```text
采集 Milk ×1000
↓
制作 Cheese ×500
↓
制造装备 ×20
↓
Cooking ×200
↓
Combat
```

系统顺序执行，而玩家可以离线。

官方目前默认离线进度上限为 **10 小时**，可通过系统升级等方式增加。

---

# 5. “时间”是游戏的基础货币

Milky Way Idle 实际存在两套货币。

显性货币：

**Coin。**

隐性货币：

# Time

任何行为都要消耗 Action Time。

因此玩家永远在计算：

```text
收益 / 时间
```

例如：

```text
动作 A
10 秒
获得 10 金

= 1 金 / 秒

动作 B
20 秒
获得 30 金

= 1.5 金 / 秒
```

玩家最终关注的是：

**XP/hour**

**Coin/hour**

**Items/hour**

而不是单次产量。

---

# 6. 技能系统

目前总计：

# 17 个技能

其中：

**10 个非战斗技能**

**7 个战斗技能。**

技能最高可成长至 **200 级**。

---

# 7. 非战斗技能

## 7.1 Gathering

三个基础采集技能：

| 技能 | 功能 |
|---|---|
| Milking | 牛奶及相关资源 |
| Foraging | 植物、果实等 |
| Woodcutting | 木材 |

它们承担游戏经济的：

# 一级资源入口

## 7.2 Production

主要生产技能：

| 技能 | 功能 |
|---|---|
| Cheesesmithing | 奶制材料、装备、工具 |
| Crafting | 木材加工、武器、首饰等 |
| Tailoring | 皮革、纤维、衣物 |
| Cooking | 战斗食物 |
| Brewing | 茶、咖啡、Buff饮料 |

不同生产技能之间大量互相需要材料，而不是形成完全独立的产业。

## 7.3 高级系统

另外两个重要技能：

### Enhancing

装备强化。

### Alchemy

资源转化。

Alchemy 主要提供：

- Coinify
- Decompose
- Transmute

即：

```text
物品 → Coin

物品 → 基础材料

材料A → 材料B
```

它承担资源回收、价值转换和市场套利等功能。

---

# 8. 技能的核心不是等级，而是 Efficiency

生产技能最关键属性之一：

# Efficiency

它不是单纯：

“产量 +20%”。

机制大致可以理解为：

```text
Guaranteed Actions
=
1 + floor(Efficiency / 100)

额外一次行动概率
=
Efficiency mod 100
```

例如：

### Efficiency = 60%

每次行动：

```text
基础产出 ×1

60% 概率额外执行一次
```

长期平均：

≈1.6 次产出。

### Efficiency = 150%

则：

```text
保底：
2次

另外：
50%概率 +1
```

长期平均：

≈2.5 次。

---

# 9. 为什么这个 Efficiency 设计很好

它把玩家成长从：

```text
Lv50
→
Lv51
→
数值稍微上涨
```

变成：

```text
Efficiency 98%
↓
99%
↓
100%
```

达到 100% 后立即跨越：

# “每次至少生产两份”

这种整数断点会产生很强的 Build 追求。

因此玩家会产生：

> 我再强化两级工具，就能过 200% Efficiency。

这比线性的 +1% 更容易制造阶段目标。

---

# 10. Action Speed

生产效率另外一个维度是：

# Speed

例如 Brewing 的时间公式为：

```text
Action Time
=
Base Time / (1 + Brewing Speed)
```

不同：

- 工具
- 装备
- 消耗品
- 永久成长

都会改变 Speed。

所以最终实际生产率：

```text
生产率
≈
Efficiency
×
1 / Action Time
```

因此玩家同时追求：

**单次产出更多**

和

**单位时间行动次数更多。**

---

# 11. Rare Find

第三条生产成长轴：

# Rare Find

用于增加稀有资源获得概率。

Rare Find 的多个来源采用乘法方式叠加，而不是简单相加。

于是生产 Build 实际拥有至少：

```text
Efficiency
Speed
Wisdom
Rare Find
```

四个方向。

玩家不会只追一个“生产战力”。

---

# 12. Wisdom

Wisdom 可以理解成：

# XP Growth Modifier

用于提高技能经验获取。

Combat 中存在：

```text
Final XP
=
Base XP
× Survival Rate
× (1 + Wisdom)
× Rate
× (1 + Charm Experience)
```

等修正结构。

因此玩家面临经典选择：

```text
当前赚钱更多
还是
当前升级更快？
```

这形成：

Efficiency Build

与

Wisdom Build

之间的权衡。

---

# 13. 装备系统

游戏装备不仅服务于战斗。

还有大量：

# Production Equipment

包括：

工具  
衣物  
饰品  
Pouch 等。

Equipment 系统包括 Head、Body、Legs、Hands、Feet、Weapon 等战斗槽位，同时还有 Pouch、Tool 等功能槽位。

---

# 14. Tool Progression

工具自身存在明显 Tier。

新手阶段常见工具需求等级节点类似：

```text
Lv1
Lv10
Lv20
Lv35
Lv50
Lv65
Lv80
……
```

社区的新手路线因此经常不是：

“只把一个技能练满”。

而是：

```text
采集
↓
升级 Cheesesmithing
↓
做更高级工具
↓
回头提高采集效率
```

这形成重要的：

# 横向技能依赖。

---

# 15. 装备强化 Enhancing

Enhancing 是游戏最重要的资源 Sink 之一。

强化成功率并不是固定数字。

其结构为：

```text
Final Success Rate
=
Base Rate
×
(Level Modifier
+ Tool Bonus
+ Over-Level Bonus …)
```

核心变量是：

**Enhancing 等级相对于被强化装备 Item Level 的差值。**

---

# 16. 强化的设计作用

强化承担四个功能：

### ① 长期成长

高级装备获得以后仍然可以继续投入。

### ② 资源销毁

大量装备 / 材料被强化系统吃掉。

### ③ 制造装备需求

普通装备不只是“一件就够”。

强化机制可以持续制造装备需求。

### ④ 市场价格支撑

因为强化消耗物品：

```text
装备产量
≠
永久累积库存
```

这对玩家市场非常重要。

---

# 17. Alchemy 的经济意义

Alchemy 是非常值得研究的系统。

三个核心动作：

```text
Coinify
物品 → 钱

Decompose
高级物品 → 原材料

Transmute
一种资源 → 另一种资源
```

这意味着：

玩家经济不是完全单向。

例如：

```text
木头
↓
武器
↓
强化失败 / 分解
↓
材料
↓
再次生产
```

形成：

# Resource Recycling Loop

而不是所有物品永远堆积。

---

# 18. Combat Skills

目前拥有：

| 技能 | 主要作用 |
|---|---|
| Stamina | HP |
| Intelligence | MP / Ability Slots |
| Attack | 命中、攻击速度、施法速度 |
| Melee | 近战伤害 |
| Defense | 闪避 |
| Ranged | 远程 |
| Magic | 魔法 |

---

# 19. Combat Level

战斗等级不是简单技能平均值。

公式为：

```text
Combat Level
=
0.1 ×
(
Stamina
+ Intelligence
+ Attack
+ Defense
+ MAX(Melee,Ranged,Magic)
)

+

0.5 ×
MAX(
Attack,
Defense,
Melee,
Ranged,
Magic
)
```

也就是说：

# 专精技能具有更高权重。

玩家不需要所有战斗技能平均发展。

---

# 20. HP

Stamina 的 HP 基础公式：

```text
Max HP
=
floor(
10 ×
(10 + Effective Stamina Level)
+
Equipment HP
)
```

基础约：

100 HP。

之后每点有效 Stamina：

约 +10 HP。

---

# 21. MP

Intelligence：

```text
Max MP
=
100
+
Intelligence Level × 10
```

同时 Intelligence 还是一个重要的技能槽门槛：

```text
Lv1–19
1个普通技能槽

Lv20–49
2个

Lv50–89
3个

Lv90+
4个
```

另外存在特殊技能槽。

这属于非常优秀的：

# 非线性等级奖励。

玩家达到 20 / 50 / 90 时获得的是机制变化，而不是单纯数值增加。

---

# 22. Attack

Attack 同时控制：

- Accuracy
- Attack Speed
- Cast Speed

其中：

```text
Accuracy
=
(10 + Attack)
×
(1 + Bonus%)
```

攻击间隔：

```text
Attack Interval
=
Base Interval
/
[
(1 + Attack / 2000)
×
(1 + Attack Speed Bonus)
]
```

所以每 1 Attack 大约提供 0.05% 的基础攻速成长。

---

# 23. Melee / Defense

Melee：

```text
Melee Damage
=
(10 + Melee)
×
(1 + Bonus%)
```

Defense：

```text
Evasion
=
(10 + Defense)
×
(1 + Bonus%)
```

同时部分特殊武器允许：

Defense 转化为伤害属性，形成 Tank Build。

---

# 24. 命中率

命中不是：

```text
Accuracy - Evasion
```

而是平滑曲线：

```text
Hit Chance
=
Accuracy^1.4
/
(
Accuracy^1.4
+
Evasion^1.4
)
```

因此不会轻易出现：

100% 命中

或者

0% 命中

这种极端硬阈值。

---

# 25. 战斗 XP 分配

战斗 XP 并不是所有属性同时平均上涨。

大致分：

# Primary Training

武器确定主要战斗技能。

获得约：

**30% 怪物经验。**

剩余经验则根据：

Focus Training / Charm

等规则进行定向或者拆分。

这意味着玩家可以：

# 控制 Build 成长方向。

---

# 26. Combat Style

战斗并不存在固定：

Warrior / Mage / Archer

职业。

而是：

```text
武器
+
Combat Style
+
Ability
+
Equipment
+
Charm
```

决定角色流派。

因此属于：

# Classless RPG。

这是长期挂机游戏非常适合的结构。

玩家无需重建角色，只需要换 Build。

---

# 27. 自动战斗

玩家可以提前设置：

- Ability
- Consumable
- 自动触发条件

因此挂机战斗的核心不是：

“玩家什么时候按技能”。

而是：

# 编写战斗策略。

例如：

```text
HP < 50%
→ 使用食物

敌人数量 ≥ 3
→ 使用 AOE

MP > 60%
→ 使用高耗魔技能
```

---

# 28. Dungeon

Dungeon 属于高级 PvE。

特点：

- 多波 Boss
- 多 Tier
- 支持组队
- 高等级内容

Wiki 当前列有三个难度层级；社区攻略通常以约 5 人队伍作为高阶 Dungeon 的典型配置。

---

# 29. 组队的数值平衡

组队不能让多人永久无脑获得数倍经验。

XP 会根据队伍进行拆分。

因此多人优势主要来自：

```text
生存能力
Build互补
挑战更高级敌人
高级掉落
```

而不是简单：

# 人越多 XP 越高。

---

# 30. 怪物与掉落

怪物承担：

```text
战斗 XP
普通掉落
稀有掉落
装备
技能相关物品
高级材料
```

同时存在：

# Bestiary

怪物击杀积累 Credit 后获得 Bestiary Points。

因此杀怪除了物品与经验之外，还有长期收藏型成长。

---

# 31. Collection

游戏存在 Collection 体系。

Steam 成就中包括：

```text
100 Collection Points
200 Collection Points
500 Collection Points
```

说明游戏通过：

# 获得不同物品

产生另一条长期目标。

---

# 32. 玩家市场 Marketplace

这是游戏与普通单机 Idle 最重要的区别。

玩家可以：

```text
Buy Listing
Sell Listing
```

进行玩家之间资源交换。

玩家生产行为因此不是只服务自己。

一个行为的真实收益变成：

```text
资源产量
×
市场价格
/
行动时间
```

---

# 33. 市场如何改变数值系统

假设：

```text
资源A：

100 / 小时

市场价：
200 Coin

收益：
20,000 Coin/h
```

资源 B：

```text
150 / 小时

市场价：
80 Coin

收益：
12,000 Coin/h
```

即使资源 B：

产量更高，

玩家仍然可能采 A。

所以最终市场自动产生：

# 动态 Meta。

---

# 34. 玩家专业化

市场让玩家不需要：

# 全技能自给自足。

例如：

```text
玩家 A
高 Milking
高 Cheesesmithing

↓

出售装备


玩家 B
高 Foraging
高 Brewing

↓

出售茶


玩家 C
Combat Build

↓

购买装备和消耗品
↓

出售 Boss 掉落
```

最终形成：

# 玩家驱动生产链。

---

# 35. Marketplace 同时也是最大风险系统

官方 2026 年路线图明确把 Marketplace 改造列为重点，并表示目标之一是降低：

**垄断和市场操纵。**

说明这个系统已经复杂到需要：

市场治理。

对于同类游戏来说必须提前考虑：

```text
小号
工作室
机器人
价格操纵
跨账号转钱
库存垄断
通货膨胀
货币出售
```

---

# 36. Tasks

游戏存在随机任务系统。

目前：

**任务不会过期。**

同时有：

**8 个基础任务槽位。**

完成任务可以获得：

Task Tokens / Task Points

等长期资源。

这是非常聪明的设计。

它避免：

```text
今天没上线
↓
任务没做
↓
产生 FOMO
```

更符合 Idle 产品定位。

---

# 37. Achievement

当前 Steam 包含 **77 个成就**。

内容覆盖：

- 技能等级
- 制造
- 强化
- Boss
- Collection
- Bestiary
- Housing
- Alchemy
- Ability

等系统。

Wiki 中则存在进一步的 Achievement Tier 结构；部分 Tier 本身提供永久 Buff。

因此：

# Achievement 本身也是角色成长系统。

---

# 38. Housing

Housing 是非常重要的后期系统。

目前拥有：

# 17 个 House Rooms

基本对应 17 个技能。

每个 Room：

# 8 Levels。

---

# 39. House 的数值结构

例如战斗类房间会提供：

```text
+1 对应技能 Level / 房间等级

+Wisdom

+Rare Find

+额外专属 Buff
```

例如：

Dojo：

```text
Attack
Attack Speed
Cast Speed
Wisdom
Rare Find
```

Library：

```text
Intelligence
MP Regeneration
Wisdom
Rare Find
```

Dining Room：

```text
Stamina
HP Regeneration
Wisdom
Rare Find
```

---

# 40. House 的经济意义

至少多个战斗房间使用类似 Coin 阶梯：

```text
Lv1      500,000
Lv2    2,000,000
Lv3    5,000,000
Lv4   12,000,000
Lv5   25,000,000
Lv6   50,000,000
Lv7   90,000,000
Lv8  160,000,000
```

同时需要：

大量木材  
装备  
食物  
技能物品等。

所以 Housing 实际承担：

# Endgame Resource Sink。

---

# 41. 为什么 House 的设计非常重要

早期：

```text
材料
→ 做装备
```

装备够用以后：

需求下降。

Housing 重新创造：

```text
大量木头需求
大量装备需求
大量消耗品需求
大量 Coin 需求
```

因此重新支撑整个生产经济。

这是非常典型的：

# 经济后期资源黑洞。

---

# 42. Guild

Guild 早期主要承担：

聊天和社交。

2026 年 7 月已经扩展成为：

# 长期成长系统。

目前存在：

### 每周 Guild Trials

每周随机：

**4 个生产/生活 Trial**

+

**2 个 Combat Trial。**

玩家报名后使用角色 Loadout 快照参加。

Trial：

**不会中断玩家正常挂机行为，也不会消耗原本的消耗品。**

这是极其重要的 Idle MMO 设计原则。

---

# 43. Guild Trial 数值

Trial：

```text
Lv100 开始
↓
每 Tier +10 Level
↓
最高 Lv300
```

难度随着参与人数变化。

奖励：

```text
Guild Points
Guild Tokens
```

---

# 44. Guild Buildings

当前：

# 23 个 Guild Buildings

每栋：

最高 **Level 20**。

作用包括：

- 提升成员上限
- 增加 Guild Point
- 增加 Guild Token
- 增加 Guild XP
- Trial Buff
- 增加报名人数

其中：

17 座 Trial Building

对应角色技能 / 战斗属性。

---

# 45. Shrine

当前：

# 5 个 Shrine

包括：

- Force
- Tempo
- Spirit
- Rarity
- Scholar

每座提供：

一个生产 Buff

+

一个战斗 Buff。

玩家使用 Guild Tokens / Guild Credits 解锁永久个人 Buff。

因此 Guild 已经形成：

```text
个人生产
↓
公会贡献
↓
Guild成长
↓
永久个人Buff
↓
更高个人生产
```

完整闭环。

---

# 46. 公会最大的设计亮点

普通 MMO：

```text
晚上8点集合
↓
打团
```

Milky Way Idle：

```text
提交角色
↓
系统读取Loadout
↓
自动参与
↓
正常挂机不受影响
```

这是非常适合 Idle 游戏的：

# 弱同步 MMO。

---

# 47. Monetization

游戏：

# Free to Play

存在：

Cowbells

以及：

# MooPass。

Steam 同时明确标记存在游戏内购买。

---

# 48. Cowbell

Cowbell 为高级货币。

Cowbell Store 可以购买包括：

```text
+1 Marketplace Listing
+1 Offline Hour
+1 Action Queue
+1 Loadout
+1 Task Slot
```

等永久便利功能。

其主要付费逻辑实际上是：

# Convenience Monetization

而不是直接出售顶级装备。

---

# 49. MooPass

MooPass 是会员系统。

目前资料列出的部分权益包括：

```text
+5% Wisdom
+10小时 Offline Progress
+6 Market Listing
+1 Action Queue
+8 Task Slot Limit
```

等便利与成长 Buff。

---

# 50. 游戏最关键的经济 Faucet

资源进入经济系统主要通过：

```text
Gathering
Combat
Rare Drop
Tasks
Alchemy
部分系统奖励
```

---

# 51. 游戏最关键的 Sink

资源离开经济主要通过：

```text
Crafting
Cooking
Brewing
Enhancing
Alchemy
Housing
Guild Contributions
Consumables
```

形成：

```text
Faucet
↓
市场
↓
Sink
```

而不是：

```text
Faucet
↓
市场
↓
永久库存
```

---

# 52. 数值系统真正的四层结构

Milky Way Idle 可以抽象成：

## Layer 1：Base Progression

```text
Skill Level
```

最稳定。

## Layer 2：Gear

```text
Tool
Equipment
Charm
Pouch
```

允许玩家 Build。

## Layer 3：Consumables

```text
Food
Tea
Coffee
Drink
```

不断消耗。

## Layer 4：Permanent Meta Progression

```text
Housing
Achievements
Guild Shrine
```

长期永久成长。

最终：

```text
实际效率

=
基础技能
×
装备Build
×
消耗品
×
永久成长
```

这就是为什么一个看似简单的：

“采集 Milk”

可以玩几百甚至几千小时。

---

# 53. 游戏的数值哲学

其核心不是：

# 大数值。

而是：

# 小比例长期叠加。

例如：

```text
+1 Skill
+0.5% Speed
+0.2% Rare Find
+3% Efficiency
```

单次提升不巨大。

但是不同系统组合以后：

```text
Level
+
Tool
+
Equipment
+
Enhancement
+
House
+
Achievement
+
Food
+
Tea
+
Guild
```

逐渐产生巨大效率差异。

---

# 54. 为什么这种设计特别适合市场

如果：

```text
LV100玩家
产量 = LV50 ×100
```

新人市场完全没有意义。

而采用：

多层小倍率以后：

老玩家虽然更强，

但不会永远把：

低级物品生产成本压成 0。

这有利于长期 MMO 经济。

---

# 55. 新内容的典型扩展方式

这个架构最大的优势：

添加一个新 Tier 非常便宜。

例如：

```text
新的木头
↓
新的 Lumber
↓
新的装备
↓
新的工具
↓
新的怪物
↓
新的 House 材料
```

直接延长：

所有系统。

---

# 56. 玩家短中长期目标结构

## 秒级

Action Progress。

## 分钟级

资源到账。

## 小时级

技能升级。

## 天级

新工具 / 新装备。

## 周级

House Upgrade。

Guild Trial。

## 月级

高级 Build。

高强化装备。

## 年级

Total Level。

Collection。

Bestiary。

Achievement。

Guild。

排行榜。

---

# 57. 早期体验的问题

Milky Way Idle 初期最大的风险并不是系统少。

恰恰是：

# 系统太多。

新玩家常见问题包括：

- UI 信息过载
- 不知道应该练什么
- 开局节奏较慢
- 缺乏明确目标

这是我们做类似产品必须吸取的教训。

---

# 58. 为什么 Tasks / Achievements / Tutorial 重要

原始设计思想：

```text
自由选择技能
↓
自己创造目标
```

理论很好。

但新人可能看到：

```text
17技能
100+物品
市场
装备
怪物
```

完全不知道：

# 为什么我要做这些？

因此必须提供：

```text
短期引导目标
+
长期自由目标
```

而不是完全开放。

---

# 59. 整个游戏真正的“发动机”

从设计层面看，不是 Combat。

也不是 Crafting。

而是以下五个系统一起组成：

```text
          时间
           ↓
       Action Queue
           ↓
          技能
        ↙     ↘
      生产     战斗
        ↘     ↙
          物品
           ↓
          市场
           ↓
        再投资成长
           ↓
         更高效率
           ↓
          时间
```

核心闭环是：

# 时间 → 资源 → 市场价值 → 成长 → 更高时间效率

---

# 60. 这个设计为什么容易形成持续游玩

玩家永远存在一个：

# “再优化一点点”

的问题。

例如：

```text
当前：

1260 Milk/h
```

玩家发现：

```text
换工具：

1380/h
```

强化：

```text
1440/h
```

喝 Tea：

```text
1580/h
```

升级 House：

```text
1630/h
```

Efficiency 过整数断点：

```text
1900/h
```

于是玩家真正玩的不是：

“挤奶”。

而是：

# 优化系统。

---

# 61. 对我们修仙项目最值得迁移的设计

优先级：

## S级——必须研究

### ① Action Queue

直接对应：

**闭关计划。**

### ② Independent Skills

修仙百艺独立升级。

### ③ Efficiency + Speed 双轴

不要只有：

“炼丹等级”。

应该同时：

```text
成功率
产量
速度
稀有率
经验
```

### ④ Player Marketplace

对应：

**坊市。**

这是项目从单机挂机升级成 MMO 世界的关键。

### ⑤ Resource Sink

对应：

```text
炼器
淬炼
洞府
宗门
突破
```

---

# 62. A级——非常值得迁移

### Housing

直接变：

# 洞府。

### Guild

直接变：

# 宗门。

### Collection

可以变：

# 天材地宝图鉴。

### Bestiary

可以变：

# 妖兽图鉴。

### Achievement Tier

可以变：

# 天道成就 / 修仙阅历。

---

# 63. 不建议直接照搬

## ① 17 个技能开局全部展示

我们应该：

逐步开放。

## ② 缺乏总目标

修仙题材天然可以解决：

```text
炼气
↓
筑基
↓
金丹
↓
元婴
```

境界就是整个系统的：

# 长期主线。

## ③ 生产技能主题之间关系不够直观

我们的资源链应该明确：

```text
采药
↓
炼丹
↓
修炼 / 突破
```

```text
挖矿
↓
炼器
↓
战斗
```

```text
伐木
↓
制符 / 阵法
↓
秘境
```

认知成本会明显降低。

---

# 64. 修仙版应该新增的核心层

Milky Way Idle：

```text
Skills
↓
Gear
↓
更高 Skills
```

我们的版本应该增加：

# Realm。

形成：

```text
技能
↓
生产
↓
装备 / 丹药
↓
战斗
↓
修为与突破材料
↓
境界突破
↓
解锁新的世界 Tier
↓
新技能 / 新资源
```

境界就成为：

# 整个复杂经济系统的“总导航”。

---

# 65. 推荐我们的最终底层结构

```text
                    境界
                      ↑
                      │
                    修为
                      ↑
                      │
        ┌─────────────┼─────────────┐
        │             │             │
       采集           制造          战斗
        │             │             │
       灵草          炼丹          妖兽
       灵矿          炼器          秘境
       灵木          制符          Boss
        │             │             │
        └─────────────┼─────────────┘
                      │
                     物品
                      │
                     坊市
                      │
                    灵石
                      │
                     投资
             ┌────────┼────────┐
             │        │        │
            装备      洞府      宗门
             │        │        │
             └────────┼────────┘
                      │
                   效率提升
                      │
                     时间
```

---

# 66. 最终逆向结论

《Milky Way Idle》表面是一款：

# 挂机 RPG。

实际上底层更接近：

# 时间驱动型 MMO 经济模拟器。

它最重要的设计并不是：

“离线也能升级”。

而是：

> 玩家需要决定如何分配有限的长期时间，并通过生产、战斗、装备和市场不断提高这段时间的价值。

真正核心公式可以抽象为：

```text
玩家价值
=
时间
×
时间利用率
×
生产效率
×
资源市场价值
```

而整个长期成长系统的目的，就是不断提高后三项。

因此，如果我们要做修仙版本，最应该继承的不是：

奶牛 → 灵草

Cheese → 丹药

这种表层映射。

而是完整继承：

# 「时间规划 → 专业技能 → 生产链 → 玩家经济 → 永久成长 → 新阶段」

这套底层结构。

再在它上面增加：

# 「境界突破」

就会形成一个比原版更容易理解长期目标的修仙挂机 MMO。

---

# 附录 A：关键数值公式

## 生产 Efficiency

```text
Guaranteed Actions
=
1 + floor(Efficiency / 100)

Chance For Additional Action
=
Efficiency mod 100
```

## Production Speed

```text
Action Time
=
Base Action Time
/
(1 + Speed Bonus)
```

不同技能的具体 Speed 来源不同。

## Combat Hit Chance

```text
Hit Chance
=
Accuracy^1.4
/
(
Accuracy^1.4
+
Evasion^1.4
)
```

## Accuracy

```text
Accuracy
=
(10 + Attack)
×
(1 + Accuracy Bonus)
```

## Attack Interval

```text
Attack Interval
=
Base Interval
/
[
(1 + Attack / 2000)
×
(1 + Attack Speed Bonus)
]
```

## Melee Damage

```text
Melee Damage
=
(10 + Melee)
×
(1 + Damage Bonus)
```

## Evasion

```text
Evasion
=
(10 + Defense)
×
(1 + Evasion Bonus)
```

## Max HP

```text
Maximum HP
=
floor(
10 ×
(10 + Effective Stamina)
+
Equipment HP
)
```

## Max MP

```text
Maximum MP
=
100
+
Intelligence × 10
```

## Combat Level

```text
Combat Level
=
0.1 ×
(
Stamina
+
Intelligence
+
Attack
+
Defense
+
MAX(Melee,Ranged,Magic)
)

+

0.5 ×
MAX(
Attack,
Defense,
Melee,
Ranged,
Magic
)
```

---

# 附录 B：后续需要继续逆向的数据

V1.0 已经确定了系统骨架。

如果进入真正制作阶段，还应该继续建立一份完整 Excel 数值数据库，包括：

```text
1. Level 1–200 XP曲线

2. 所有采集资源：
   等级
   Action Time
   XP
   Drop

3. 所有Recipe：
   Input
   Output
   Time
   XP

4. 所有Tool：
   Requirement
   Efficiency
   Speed
   Rare Find

5. 所有装备基础属性

6. Enhancement +0～高强化完整成功率

7. 全部Monster：
   HP
   Attack
   Defense
   Damage
   XP
   Loot

8. Dungeon：
   Tier
   Boss
   Reward

9. Housing：
   Lv1～8材料和成本

10. Guild：
    Lv1～20 Building成本与Buff

11. Marketplace：
    价格历史与核心资源利润/h

12. 前30天典型玩家成长速度
```

只有完成这一层以后，我们才能真正开始给修仙版本定：

**炼气需要多久、筑基需要多久、灵草每小时多少、丹药成本多少、灵石每天产出多少、装备价格多少。**

也就是说：

> **系统设计现在已经能开始；真正的数值策划，还需要下一步建立“银河奶牛完整数值数据库”。**
