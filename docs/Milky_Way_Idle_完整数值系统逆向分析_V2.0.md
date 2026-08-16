# 《Milky Way Idle / 银河奶牛放置》完整数值系统逆向分析 V2.0

**文档类型：** 竞品数值策划逆向 / Numerical Design Reverse Engineering  
**调研日期：** 2026-08-15  
**目的：** 为后续“修仙题材多人放置 RPG”建立可参考的底层数值模型  
**注意：** 本文不是官方内部策划案，而是依据官方公告、当前 Wiki、官方市场数据接口、当前社区工具与历史数据快照进行的逆向整理。

---

# 0. 先说结论

《Milky Way Idle》的数值系统并不是典型国产挂机游戏的：

> 战力 → 百万 → 亿 → 万亿

而是一个以 **“时间价值”** 为底层货币的 MMO 经济系统。

它的主要数值层可以压缩成：

```text
技能等级
×
行动速度
×
行动效率
×
额外产量
×
稀有掉率
×
经验倍率
×
装备强化
×
消耗品 Buff
×
房屋永久成长
×
公会永久成长
```

最终决定玩家真正关心的三个指标：

```text
XP / Hour
Items / Hour
Coin / Hour
```

整个游戏的数值设计目标不是让玩家获得一个越来越大的“战力数字”，而是：

> **让玩家不断把同样 1 小时的挂机时间变得更值钱。**

这也是我们做修仙版时最值得迁移的核心。

---

# 1. 数据可信度说明

本次资料按四档可信度区分。

## A 级：官方当前资料

包括：

- Steam 官方更新公告
- 官方游戏站
- 官方 Marketplace JSON
- 开发者公开说明

用于确认：

- 2025 战斗系统重做
- 2026 Guild Expansion
- Marketplace 数据机制
- MooPass
- 当前功能与改版时间

## B 级：当前 Wiki.gg

Wiki 页面大量数据更新于 2025-12 ～ 2026-06。

用于确认：

- XP 表
- Efficiency
- Gathering Quantity
- Wisdom
- Combat
- Alchemy
- Enhancing
- Housing
- Marketplace 税率
- Collection / Bestiary
- Tasks 等

## C 级：当前社区工具 / 客户端数据解析

包括：

- MWITools
- 社区 XP Planner
- 自动生成的游戏数据类型仓库

这些工具直接读取或解析游戏数据，因此非常有价值。

但需要注意：

> 某些仓库保存的是历史游戏数据快照，不一定等于 2026 当前服务器数值。

本文只把历史快照用于分析 **曲线形态和结构**，不会把已经改版的战斗数值当成当前值。

## D 级：玩家经验数据

例如：

- “某区域每天赚 30M”
- “某技能当前利润最高”

只能用于观察经济量级，不能作为固定策划值。

---

# 2. 数值系统总架构

可以把整个 Milky Way Idle 数值系统理解成 7 层。

```text
Layer 1
时间
│
↓
Layer 2
技能等级 / XP
│
↓
Layer 3
Action Speed / Efficiency / Gathering / Rare Find
│
↓
Layer 4
装备 / Tool / Charm / Consumable
│
↓
Layer 5
Enhancing / Alchemy
│
↓
Layer 6
Housing / Achievement / Guild
│
↓
Layer 7
Marketplace
```

最后形成：

```text
时间
↓
产出
↓
商品
↓
市场价值
↓
再投资
↓
提高单位时间效率
↓
更高产出
```

---

# 3. 等级系统：1～200 级

当前技能最高等级：

**Lv200**

游戏的 XP 曲线是整个长期生命周期的第一根骨架。

---

# 4. XP 曲线关键节点

| 等级 | 累计 XP | 下一等级 XP |
|---:|---:|---:|
| 10 | 791 | 173 |
| 20 | 3,750 | 497 |
| 30 | 11,814 | 1,337 |
| 40 | 33,697 | 3,649 |
| 50 | 93,311 | 9,884 |
| 60 | 252,584 | 26,039 |
| 70 | 664,632 | 66,249 |
| 80 | 1,693,774 | 162,762 |
| 90 | 4,179,145 | 387,129 |
| 100 | 10,000,000 | 1,404,976 |
| 110 | 29,574,787 | 2,810,934 |
| 120 | 68,429,670 | 5,511,809 |
| 125 | 100,000,000 | 14,406,130 |
| 130 | 186,752,428 | 22,545,343 |
| 140 | 534,971,538 | 54,935,714 |
| 150 | 1,376,277,458 | 131,725,012 |
| 160 | 3,377,885,250 | 311,213,781 |
| 170 | 8,073,001,662 | 725,290,240 |
| 175 | 12,390,995,728 | 1,101,910,017 |
| 180 | 18,942,428,633 | 1,668,977,702 |
| 190 | 43,799,759,843 | 3,795,307,178 |
| 199 | 92,125,192,822 | 7,874,807,178 |
| 200 | 100,000,000,000 |  |

几个最重要的锚点：

```text
Lv50     ≈ 93K XP
Lv75     ≈ 1.07M XP
Lv100    = 10M XP
Lv125    = 100M XP
Lv150    ≈ 1.376B XP
Lv175    ≈ 12.391B XP
Lv200    = 100B XP
```

这是一条非常长的指数型曲线。

---

# 5. XP 曲线的真正设计含义

把 200 级总经验设为：

```text
100,000,000,000 XP
```

后，会出现一个极其重要的现象。

## XP 在后期高度集中

从 Lv175 → Lv200：

```text
需要：
87,609,004,272 XP
```

约占 Lv200 总经验的：

**87.61%**

从 Lv150 → Lv200：

约占全部经验：

**98.62%**

从 Lv125 → Lv200：

约占：

**99.90%**

换句话说：

> 到 Lv125，在数学意义上甚至还没有完成 Lv200 所需总 XP 的 0.1%。

但玩家心理上并不会觉得自己只完成 0.1%。

因为游戏不是拿“完成 100B XP”当唯一目标，而是不断提供：

- 新 Action
- 新 Tool
- 新装备
- 新副本
- 新 Housing
- 新 Build

因此 XP 曲线可以非常长。

这正是长生命周期挂机游戏的关键。

---

# 6. 每 25 级的累计 XP 放大倍率

根据公开 XP 表计算：

| 区间 | 累计 XP 放大约 |
|---|---:|
| Lv25 → 50 | ×13.71 |
| Lv50 → 75 | ×11.42 |
| Lv75 → 100 | ×9.39 |
| Lv100 → 125 | ×10.00 |
| Lv125 → 150 | ×13.76 |
| Lv150 → 175 | ×9.00 |
| Lv175 → 200 | ×8.07 |

可以看到：

> 它不是简单的固定指数函数，而是一条人为调过节点的长期经验曲线。

平均下来，每一级通常相当于累计经验增长约：

**+9% ～ +11% 左右。**

因此大约每 7～8 级，玩家面对的累计 XP 量级会明显上一个台阶。

---

# 7. XP 曲线对挂机游戏的意义

如果某玩家当前：

```text
XP/h = 100,000
```

那么：

Lv100：

10M XP。

Lv125：

100M XP。

假设效率完全不成长：

```text
Lv100 →125
≈ 900 小时
```

但实际上玩家同时会得到：

```text
更高等级
更高工具
更高 Wisdom
更高 Action Speed
更高 Efficiency
更好的 Consumable
Housing
Guild
```

所以：

> XP 需求不断指数上升，同时 XP/h 也不断提高。

这就是它数值系统中的“双指数追逐”。

---

# 8. 时间系统

Milky Way Idle 真正最重要的基础资源不是 Coin。

而是：

# Time

所有生产行为都有：

```text
Base Action Time
```

最终：

```text
Actual Action Time
=
Base Action Time
/
(1 + Action Speed)
```

其中 Action Speed 用小数表示：

```text
30% = 0.30
```

例如基础时间：

```text
6 秒
```

Action Speed：

```text
+30%
```

则：

```text
6 / 1.3
≈ 4.615 秒
```

Wiki 中 Azure 系工具给出的 6s → 4.62s 示例与此一致。

---

# 9. 每小时 Action 数

最基础公式：

```text
Actions Per Hour
=
3600
/
Actual Action Time
```

例如：

### 6 秒

```text
600 Actions / Hour
```

### 4.615 秒

```text
≈780 Actions / Hour
```

仅仅 +30% Action Speed：

实际就让每小时行为数量提高：

```text
+30%
```

这是非常直观的乘区。

---

# 10. Efficiency

这是 Milky Way Idle 最漂亮的数值系统之一。

Efficiency 并不是简单：

```text
产量 × (1 + Efficiency)
```

而是把额外效率表现成：

**额外瞬时 Action。**

公式：

```text
Guaranteed Actions
=
1 + floor(Efficiency / 100)

Chance For +1 Extra Action
=
Efficiency mod 100
```

例如：

## 60% Efficiency

```text
保底 1 Action
60% 概率额外 +1 Action
```

数学期望：

```text
1.6 Action
```

---

## 150% Efficiency

```text
保底 2 Action
50% 概率额外 +1
```

数学期望：

```text
2.5 Action
```

---

## 200% Efficiency

```text
保底 3 Action
```

---

# 11. Efficiency 的数学期望

可以进一步化简：

```text
Expected Action Multiplier
=
1 + Efficiency / 100
```

也就是说：

```text
E = 50%
→ ×1.5

E = 100%
→ ×2

E = 200%
→ ×3

E = 300%
→ ×4
```

但 UI 上仍然表现成：

```text
保底额外行动
+
随机额外行动
```

这比单纯写“产量 +200%”更有反馈感。

---

# 12. 为什么 100% 是重要断点

例如：

```text
98%
99%
100%
```

虽然数学期望只是：

```text
1.98
1.99
2.00
```

但是玩家感受从：

```text
“有时候只产1个”
```

变成：

```text
“每次至少产2个”
```

因此会产生非常明确的 Build 目标：

> “我的装备再强化一级就可以过 200% Efficiency。”

这就是：

# Breakpoint Design

---

# 13. Gathering Quantity

采集还有一个独立于 Efficiency 的：

# Gathering Quantity

其结构和 Efficiency 类似：

```text
Guaranteed Extra Items
=
floor(Gathering Quantity / 100)

Chance For +1 Extra Item
=
Gathering Quantity mod 100
```

因此它与 Efficiency 是两个不同乘区。

可以粗略理解为：

```text
Efficiency
= 一次时间里执行几次 Action

Gathering
= 每个 Action 额外拿多少资源
```

这会形成复合增长。

---

# 14. 采集产量的通用模型

一个简化模型：

```text
Output / Hour
=
Actions / Hour
×
Expected Efficiency Multiplier
×
Expected Gathering Quantity
×
Base Yield
```

再加入：

```text
Rare Find
Processing
```

就得到完整采集收益。

---

# 15. Action Speed × Efficiency 的乘法效应

例如基础：

```text
6 秒 / Action
1 Item / Action
```

则：

```text
600 Item/h
```

如果：

```text
Action Speed = +50%
Efficiency = 100%
```

那么：

```text
Action Time
= 6 / 1.5
= 4 秒

Actions/h
= 900

Efficiency Multiplier
= 2
```

产量：

```text
900 × 2
=
1,800 Item/h
```

不是：

```text
600 + 50% + 100%
= 1,500
```

而是：

```text
600 ×1.5 ×2
=1,800
```

所以不同系统采用不同乘区，非常容易形成长期 Build 深度。

---

# 16. Non-combat Skill 的成长属性

当前多个非战斗技能页面显示，其等级会持续提供：

```text
Efficiency
Wisdom
Rare Find
```

常见基础成长结构为：

```text
+1.5% Efficiency
+0.05% Wisdom
+0.2% Rare Find
```

高等级玩家即使使用相同配方，也会因为技能本身拥有明显的单位时间优势。

这让“职业技能等级”拥有真正经济价值。

---

# 17. Wisdom：经验倍率

Wisdom 是游戏最重要的经验成长属性。

---

## 17.1 非战斗 XP

Skilling：

```text
Final XP
=
Base XP
×
(
1
+
Wisdom
+
Charm Experience
)
```

注意：

这里 Wisdom 和 Charm Experience 是：

**加法聚合。**

---

## 17.2 战斗 XP

Combat：

```text
Final XP
=
Base XP
×
Survival Rate
×
(1 + Wisdom)
×
Rate
×
(1 + Charm Experience)
```

这里存在多个独立乘区。

因此：

> 战斗 XP Build 的复杂度高于生产 XP Build。

---

# 18. Survival XP

2025 战斗重做以后：

怪物给予固定基础 XP。

然后根据战斗持续时间增加：

# Survival XP Bonus

Survival Rate 大致从：

```text
瞬杀：
×1.0
```

逐渐提高到：

```text
Enrage 时间：
×2.0
```

普通 Zone：

```text
3 分钟开始 Enrage
```

Boss / Dungeon：

```text
10 分钟
```

所以：

> 打得越慢，单只怪经验越多，但不代表 XP/h 更高。

玩家真正要优化：

```text
XP / Hour
```

而不是：

```text
XP / Monster
```

---

# 19. Rare Find

Rare Find 提高稀有掉落。

多数对应系统可理解成：

```text
Final Rare Drop Rate
=
Base Drop Rate
×
(1 + Rare Find)
```

不同技能拥有独立 Rare Find，同时还存在 Global / Equipment / House 等来源。

这让玩家形成：

```text
稳定产量 Build
vs
稀有掉落 Build
```

---

# 20. Processing

Processing 是一个非常值得迁移的生产辅助数值。

其作用：

> 采集资源时，有概率直接把原材料转化成加工后的材料。

Processing Tea 当前基础效果：

```text
15% Processing
持续 300 秒
```

例如：

```text
原木
↓
有概率直接获得 Lumber
```

它减少了后续加工所需要的：

```text
时间
+
加工行动
```

本质相当于：

# Time Compression

---

# 21. Gourmet

Gourmet 用于：

```text
Cooking
Brewing
```

作用：

> 有概率免费额外生产物品。

Gourmet Tea：

```text
12% Gourmet
持续 300 秒
```

所以期望产量可以近似：

```text
Output
×
(1 + Gourmet)
```

关键是：

**额外产品不额外消耗材料。**

因此 Gourmet 同时提高：

```text
产量/h
+
材料利润率
```

---

# 22. Artisan

Artisan：

> 减少 Production Action 所需材料。

公式：

```text
Material Required
=
Base Materials
×
(1 - Artisan Reduction)
```

基础 Artisan Tea：

```text
10% Reduction
持续 300 秒
```

因此如果某装备正常消耗：

```text
100 原料
```

10% Artisan：

期望成本约：

```text
90 原料
```

这直接影响市场制造利润。

---

# 23. 生产职业真实利润模型

因此一个生产配方不能只算：

```text
售价 - 材料成本
```

真正应该计算：

```text
Profit / Hour
=
(
Expected Output
×
Net Market Sell Price
-
Effective Material Cost
-
Coin Cost
)
/
Total Time
```

其中：

```text
Expected Output
受到：
Efficiency
Gourmet
Rare Find

Effective Material Cost
受到：
Artisan

Total Time
受到：
Action Speed
```

这就是为什么这个游戏能自然产生“生产职业 Build”。

---

# 24. 三个基础 Gathering 的早期 Action 节奏

公开当前 Wiki / 历史客户端数据都可以看到：

早期最基础采集 Action 大量采用：

```text
6 秒
```

例如：

```text
Cow / Farmland / Tree
```

基础动作通常：

```text
6s
5 XP 左右
```

后续高 Tier Action：

```text
时间增长
XP 增长
资源价值增长
```

例如历史数据快照中能看到：

```text
Lv50 Action ≈17s
Lv65 Action ≈20s
```

这里的具体动作数值可能随版本调整，因此不能当 2026 永久表使用。

但曲线结构很明确：

> **等级越高，单次行动越慢，但单位 Action 的 XP 和商品价值提高。**

---

# 25. 为什么高级 Action 不一定永远最好

因为玩家真正优化：

```text
XP/h
Coin/h
Rare Drops/h
```

高级 Action：

```text
XP/Action 更高
```

但 Action Time 也更长。

因此可能存在：

```text
低级 Action：
更高 XP/h

高级 Action：
更高 Coin/h

另一 Action：
更高 Rare/h
```

于是玩家才有选择。

---

# 26. Alchemy 数值系统

Alchemy 是整个经济系统的重要资源转换器。

三种核心行为：

```text
Coinify
Decompose
Transmute
```

---

# 27. Alchemy Action Time

基础：

```text
20 秒
```

公式：

```text
Alchemy Action Time
=
20
/
(1 + Action Speed)
```

---

# 28. Coinify

作用：

```text
Item
→
Coin
```

基础成功率：

```text
70%
```

基础 XP：

```text
Base XP
=
1.0
×
(10 + Item Level)
```

失败：

```text
只获得基础 XP 的 10%
```

Coinify 的设计意义是：

# 官方兜底回收价格。

如果市场没人买：

玩家仍然可以把物品变成 Coin。

---

# 29. Decompose

作用：

```text
高级物品
→
原始材料
```

基础成功率：

```text
60%
```

基础 XP：

```text
Base XP
=
1.4
×
(10 + Item Level)
```

比 Coinify：

```text
+40% Base XP
```

失败：

```text
获得 10% Base XP
```

---

# 30. Transmute

作用：

```text
Item A
→
Item B
```

基础成功率根据物品变化：

大致：

```text
50% ～ 80%
```

基础 XP：

```text
Base XP
=
1.6
×
(10 + Item Level)
```

比 Coinify：

```text
+60%
```

比 Decompose：

约：

```text
+14.3%
```

失败：

```text
物品损失
Coin 损失
获得 10% Base XP
```

---

# 31. Alchemy Success

炼金最终成功率会考虑：

```text
Base Rate
Catalyst
Alchemy Level vs Item Level
Alchemy Success Bonus
```

公开公式结构：

```text
Final Rate
=
[
Base Rate
×
(
1
+
Catalyst
+
Per-Level Modifier × Level Difference
)
]
×
(
1 + Alchemy Success
)
```

当 Alchemy Skill 不足物品等级时：

成功率受到惩罚。

达到或超过 Item Level 后：

不再承受等级不足惩罚。

---

# 32. Alchemy 为什么是非常好的经济稳定器

它同时解决：

## ① 垃圾物品堆积

```text
Item
→ Coin
```

## ② 高级装备库存

```text
Equipment
→ Material
```

## ③ 不同材料之间失衡

```text
Material A
→ Material B
```

## ④ 市场套利

如果：

```text
市场A价格
<
炼金转换后的期望价值
```

玩家就会买入并炼化。

这种玩家套利反而会自动帮助市场恢复均衡。

---

# 33. Enhancing

Enhancing 是游戏最大的：

# Resource Sink

之一。

所有装备可以强化至：

```text
+20
```

---

# 34. 强化属性增长

强化不是：

```text
+固定数值
```

而是：

```text
Base Stat
×
Enhancement Bonus
```

当前 1×强化槽位的完整公开增幅为：

| 强化等级 | 1×槽位基础属性增幅 |
|---:|---:|
| +1 | +2.0% |
| +2 | +4.2% |
| +3 | +6.6% |
| +4 | +9.2% |
| +5 | +12.0% |
| +6 | +15.0% |
| +7 | +18.2% |
| +8 | +21.6% |
| +9 | +25.2% |
| +10 | +29.0% |
| +11 | +33.4% |
| +12 | +38.4% |
| +13 | +44.0% |
| +14 | +50.2% |
| +15 | +57.0% |
| +16 | +64.4% |
| +17 | +72.4% |
| +18 | +81.0% |
| +19 | +90.2% |
| +20 | +100.0% |

可以看到：

```text
+10 = +29%
+15 = +57%
+20 = +100%
```

+20 相当于：

> 将装备可强化基础属性翻倍。

---

# 35. 强化曲线是后段加速

前十级：

```text
+0 → +10
= +29%
```

后十级：

```text
+10 → +20
= 再增加 71 个百分点
```

因此：

> 后期强化不是线性延长，而是明显提高了高强化追求价值。

官方在 2025 Combat Rework 中也明确：

**提高了 +11 以上的 Enhancement Scaling。**

---

# 36. 5× Enhancement Slot

部分物品不是使用普通 1× 增幅。

包括：

```text
Necklace
Ring
Earrings
Back
Trinket
Charm
```

可获得：

# 5× Enhancement Bonus

这意味着：

同一个 +10：

普通装备：

```text
+29% 对应强化属性
```

5× Slot：

强化相关成长的权重会高得多。

因此：

> 不同装备槽位天然拥有不同强化投资价值。

---

# 37. Enhancing Action Time

基础 Action Time：

```text
12 秒
```

Action Speed 会减少强化耗时。

Enhancing Skill 本身还提供：

```text
Action Speed
Enhancing Success
Wisdom
Rare Find
```

因此强化职业本身也是独立专业技能。

---

# 38. Enhancing Success

强化最终成功率结构：

```text
Final Success Rate
=
Base Rate
×
(
Level Modifier
+
Tool Bonus
+
Over-Level Bonus
)
```

其中最重要的是：

```text
Enhancing Level
vs
Item Level
```

如果：

```text
Enhancing Level < Item Level
```

等级修正：

```text
Level Modifier
=
(
Enhancing Level / Item Level
+
1
)
/
2
```

最高：

```text
1.0
```

这意味着：

> 技能等级不足时，并不是不能强化，而是承担明显的成功率惩罚。

---

# 39. +10 的公开成功率例子

Wiki 当前给出的示例：

```text
目标：+10
Base Rate = 30%
```

再经过：

```text
Level Modifier
Tool Bonus
Over-Level Bonus
```

形成最终成功率。

因此：

强化投入的数学期望不能只用“30%”计算。

必须使用玩家当前 Build。

---

# 40. 强化 EV

如果一次强化：

```text
成功率 = p
单次成本 = C
```

且失败只消耗材料，不降强化：

最基础平均成本：

```text
Expected Cost
≈
C / p
```

例如：

```text
p = 30%
```

平均尝试：

```text
3.33 次
```

但实际系统还存在：

```text
保护物
工具
Blessed
强化材料
相同装备保护
Mirror
```

因此真正成本：

```text
Expected Enhancement Cost
=
Σ
(
失败概率
×
每阶段成本
)
```

这也是高级装备长期需求的核心来源。

---

# 41. Blessed

Blessed 提供：

> 强化时获得双倍强化进度的概率。

也就是说，一次成功有可能：

```text
+1
→
额外成为 +2 Progress
```

这进一步产生：

```text
Enhancing Success Build
vs
Blessed Build
vs
Speed Build
```

当前公开检索页面可以确认机制，但完整浓度系数表未在搜索结果中完整暴露，因此本文不伪造具体倍率表。

---

# 42. Refinement

2025 Combat Rework 加入：

# Refinement

目前：

```text
T1 / T2 Dungeon
→ Refinement Chest
→ Refinement Shard
```

可以强化 Lv95 Dungeon Equipment。

Refined Equipment：

```text
普通装备：
额外 +5% Stats

Back Slot：
额外 +10% Stats
```

并且：

```text
100% 保留原 Enhancement Level
```

这是一种非常聪明的“毕业装备延寿”机制。

---

# 43. 战斗系统当前版本说明

这里非常重要：

> 2025 年 8 月游戏进行过一次大型 Combat Rework。

所以网上很多旧攻略中的：

```text
Power
旧 Magic Accuracy
旧 XP from damage
旧 Monster regeneration
```

已经过时。

本文以下只使用重做后的当前结构。

---

# 44. 当前 Combat Skills

```text
Stamina
Intelligence
Attack
Defense
Melee
Ranged
Magic
```

不是固定职业。

角色 Build 由：

```text
Weapon
Combat Style
Equipment
Charm
Ability
Consumables
```

共同决定。

---

# 45. Combat Level

当前公式：

```text
Combat Level
=
0.1
×
(
Stamina
+
Intelligence
+
Attack
+
Defense
+
MAX(Melee, Ranged, Magic)
)

+
0.5
×
MAX(
Attack,
Defense,
Melee,
Ranged,
Magic
)
```

这个公式意味着：

> 专精比平均练级更重要。

---

# 46. HP

Stamina：

```text
Maximum HP
=
floor(
10
×
(
10 + Effective Stamina Level
)
+
Equipment HP
)
```

基础 HP：

```text
100
```

每个有效 Stamina：

约：

```text
+10 HP
```

---

# 47. MP

Intelligence：

```text
Base MP = 100
```

每级 Intelligence：

```text
+10 MP
```

可近似写为：

```text
Max MP
=
100
+
10 × Intelligence
```

具体显示口径会考虑有效等级及装备。

---

# 48. Accuracy

当前所有战斗流派都需要：

# Attack

基础结构：

```text
Accuracy
=
(
10 + Attack Level
)
×
(
1 + Accuracy Bonus
)
```

这是 2025 Rework 以后统一战斗流派的重要改动。

---

# 49. Hit Chance

命中采用平滑竞争公式：

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

例如：

如果：

```text
Accuracy = Evasion
```

则：

```text
Hit Chance = 50%
```

---

# 50. 为什么命中采用这个公式

如果采用：

```text
Accuracy - Evasion
```

容易出现：

```text
0%
100%
```

硬阈值。

现在的指数竞争公式：

- 差距小 → 平滑变化
- 差距大 → 明显优势
- 仍避免突然硬跳

非常适合长期 RPG。

---

# 51. Attack Speed

Attack 同时增加：

```text
Accuracy
Attack Speed
Cast Speed
```

基础攻击间隔结构：

```text
Attack Interval
=
Base Interval
/
[
(
1 + Attack / 2000
)
×
(
1 + Attack Speed Bonus
)
]
```

因此：

```text
Attack = 100
```

仅等级带来的基础速度项约：

```text
+5%
```

---

# 52. Damage Mitigation

物理：

```text
Armor
```

元素：

```text
Fire Resistance
Water Resistance
Nature Resistance
```

穿透后：

```text
Penetrated Defense
=
Defense
-
Penetration
```

当有效防御 ≥ 0：

```text
Damage Taken Multiplier
=
100
/
(
100 + Effective Defense
)
```

例如：

```text
Armor = 100
```

则：

```text
Damage Taken = 50%
```

Armor：

```text
300
```

则：

```text
25%
```

这是经典双曲线减伤。

不会出现线性 Armor 带来的：

```text
100 Armor = 100%减伤
```

问题。

---

# 53. 负防御

当有效防御 < 0：

伤害会被放大。

其结构：

```text
Damage Taken
=
(
100 - Effective Defense
)
/
100
```

例如：

```text
Effective Defense = -20
```

则：

```text
Damage Taken ≈ 120%
```

因此 Penetration 不只是对高防敌人有价值，也可能形成伤害放大区。

---

# 54. Critical

当前基础暴击：

### Ranged

```text
Base Crit
=
30% × Hit Chance
```

### 其他 Style

```text
Base Crit = 0
```

再叠加装备：

```text
Crit Rate Bonus
```

暴击伤害：

```text
Critical Damage
=
Max Damage
×
(
1 + Critical Damage Bonus
)
```

因此 Ranged 天生具有不同的数值构筑逻辑。

---

# 55. Tenacity

Tenacity 用于抵抗：

```text
Stun / Crowd Control
```

结构：

```text
Final CC Chance
=
Base CC Chance
×
100
/
(
100 + Tenacity
)
```

因此：

```text
Tenacity = 100
```

控制概率大致减半。

也是一个典型双曲线软上限。

---

# 56. Combat XP 分配

击杀怪物得到固定 Combat XP。

其中：

```text
30%
```

给予：

# Primary Training Skill

Primary 根据武器决定。

剩下：

```text
70%
```

如果没有 Focus：

通常在可训练技能之间分配。

当前典型分配：

```text
Stamina       14%
Intelligence  14%
Attack         14%
Defense        14%
Primary        14%
```

Primary 本身还已经获得前面的 30%。

所以总计：

```text
Primary ≈44%
```

---

# 57. Focus Training / Charm

如果玩家使用对应 Charm：

剩余：

```text
70%
```

可以定向到目标技能。

因此玩家可以形成：

```text
Combat Build
+
XP Training Build
```

而不是必须平均升级。

---

# 58. Party XP

当前组队战斗：

```text
Monster XP
```

在队员之间：

# 平均分配。

例如 3 人：

```text
≈ 1/3 Base Share / person
```

再叠加个人：

```text
Wisdom
Charm
Level Malus
```

---

# 59. Level Malus

如果队员 Combat Level 比队伍最高玩家低超过：

```text
20%
```

就开始受到：

```text
XP
+
Drop
```

惩罚。

超过 20% 的每 1% 差距：

惩罚增加约：

```text
3%
```

这个设计防止：

> 大号无成本拖小号快速越级。

---

# 60. Party Size

当前：

```text
普通 Zones：
最多 3 人

Dungeons：
最多 5 人
```

因此组队收益不是：

```text
人数越多 → XP越高
```

而是：

```text
多人能力互补
↓
挑战更高级内容
↓
获得更高价值掉落
```

---

# 61. Monster Enrage

当前普通 Monster：

每：

```text
3 分钟
```

进入一次 Enrage。

每层：

```text
Accuracy +10%
Damage +10%
```

最多：

```text
10 层
```

Boss：

```text
10 分钟 / 层
```

这个机制避免：

> 用极端龟壳 Build 无限磨死任何高阶怪物。

---

# 62. Combat Zone Tier

战斗区域现在：

```text
T0 → T5
```

高 Tier：

```text
更多 XP
更多 Drops
部分 Unique Drops
更高难度
```

Dungeon：

目前至少：

```text
T0 → T2
```

因此旧地图不需要不断新增。

只需增加 Tier：

就可以复用已有内容。

---

# 63. 装备数值不是单一“攻击力”

当前 Stats 系统包含大量独立维度：

### Offense

```text
Damage
Accuracy
Attack Speed
Cast Speed
Ability Haste
Crit Rate
Crit Damage
Amplify
Penetration
Life Steal
Mana Leech
```

### Defense

```text
HP
MP
Evasion
Armor
Elemental Resistance
Tenacity
Regeneration
```

### Economy / XP

```text
Wisdom
Rare Find
Combat Drop Quantity
Combat Drop Rate
Skill XP
```

### Production

```text
Efficiency
Gathering
Action Speed
Artisan
Gourmet
Processing
Blessed
Essence Find
```

这就是为什么它可以产生大量 Build，而无需依赖随机词条海。

---

# 64. Housing

Housing 是后期最大的永久资源 Sink 之一。

目前：

```text
17 个 House Rooms
```

基本对应：

```text
17 Skills
```

每个 Room：

```text
8 Levels
```

---

# 65. House Coin 成本曲线

多个当前技能房间共享类似的 Coin 成本梯度：

| House Level | Coin |
|---:|---:|
| 1 | 500,000 |
| 2 | 2,000,000 |
| 3 | 5,000,000 |
| 4 | 12,000,000 |
| 5 | 25,000,000 |
| 6 | 50,000,000 |
| 7 | 90,000,000 |
| 8 | 160,000,000 |

单房间仅 Coin 总投入：

```text
344,500,000 Coin
```

如果 17 个房间全部采用这一 Coin 梯度：

仅 Coin 理论量级就是：

```text
≈5.8565 Billion Coin
```

还没有计算：

```text
木材
装备
食物
材料
稀有物品
```

所以 Housing 本质是：

# 终局经济黑洞。

---

# 66. House Buff

典型 House Room 每级会提供：

```text
对应技能有效等级
Wisdom
Rare Find
技能专属属性
```

例如战斗房：

```text
Dojo → Attack
Library → Intelligence
Dining Room → Stamina
```

长期结果：

```text
市场资源
↓
House
↓
永久效率
↓
更高市场产出
```

形成长期投资回路。

---

# 67. House ROI 的正确计算方法

例如：

某 House Level：

```text
成本：
50M Coin

收益：
+X% Skill Efficiency
```

则不应该问：

```text
战力提升多少？
```

而要问：

```text
提升后每小时多赚多少 Coin？
```

回本时间：

```text
Payback Hours
=
Upgrade Cost
/
Additional Profit Per Hour
```

这种 ROI 思维是整个游戏经济的核心。

---

# 68. Tasks

Random Tasks：

初始生成速度：

```text
约每 8 小时 1 个
```

通过升级：

最低可缩短至：

```text
约 4 小时
```

任务：

```text
不会过期
```

基础 Task Slots：

```text
8
```

后续曾扩展可购买上限至：

```text
40 slots
```

---

# 69. Task Reward

任务主要给：

```text
Coin
Task Token
Task Point
```

其中：

```text
每获得 1 Task Token
→ +1 Task Point
```

Task Token：

用于 Task Shop。

Task Point：

长期累计、排行榜与奖励。

因此任务系统不是单纯每日签到。

而是另一个：

# 永久累计曲线。

---

# 70. Achievement

当前：

```text
73 Achievements
```

分：

```text
6 Tiers
```

每完成一整个 Tier：

给予：

# Permanent Buff

所以 Achievement 不只是展示系统。

它本身进入角色数值成长。

---

# 71. Collection

Collection 统计：

> 玩家通过实际 Gameplay 获取的物品。

Marketplace / General Shop 购买：

**不计 Collection。**

单个物品数量阈值：

```text
1
10
100
1,000
10,000
...
```

分别累计更多 Collection Points。

---

# 72. Collection Point 公式

例如取得某一物品：

```text
1+
→ +1 Point

10+
→ 再 +2

100+
→ 再 +3

1,000+
→ 再 +4

10,000+
→ 再 +5
```

例如：

```text
2,500 个某物品
```

获得：

```text
1 + 2 + 3 + 4
=
10 Points
```

这是一种：

# 对数型收藏增长

而不是线性要求。

---

# 73. Collection Milestone Rewards

当前：

| Collection Points | 奖励频率 | 主要奖励 |
|---|---|---|
| 1–499 | 每 50 点 | 10 Cowbell + Small Cache/Crate |
| 500–999 | 每 100 点 | 30 Cowbell + Medium Cache/Crate |
| 1000+ | 每 100 点 | 50 Cowbell + Large Cache/Crate |

这意味着：

> 长期玩游戏本身可以逐步产生付费货币。

---

# 74. Bestiary

Bestiary 使用：

# Credit

计算击杀贡献。

不同 Tier：

```text
T0 → +0 Extra
T1 → +1
T2 → +2
T3 → +3
T4 → +4
T5 → +5
```

公式：

```text
Total Credit
=
(
1 + Tier Bonus
)
/
Party Size
```

---

# 75. Bestiary Points

同样采用：

```text
1
10
100
1,000
10,000
...
```

阈值结构。

因此即使刷同一种怪：

继续刷也有长期收藏意义。

---

# 76. Bestiary Milestones

| Bestiary Points | 奖励频率 | 奖励 |
|---|---|---|
| 1–99 | 每 10 | 10 Cowbell + 2 Small Treasure Chest |
| 100–199 | 每 20 | 30 Cowbell + 2 Medium Treasure Chest |
| 200+ | 每 20 | 50 Cowbell + 2 Large Treasure Chest |

---

# 77. Guild 2026 数值结构

2026 Guild Expansion 后：

每周 Guild Trials 包含：

```text
4 个 Skilling Trial
+
2 个 Combat Trial
```

Trial：

不会打断玩家正常挂机。

使用：

```text
Loadout Snapshot
```

也不会实际消耗 Consumables。

---

# 78. Guild Trial 难度

Trial 起点：

```text
Lv100
```

每 Tier：

```text
+10 Level
```

最高：

```text
Lv300
```

因此理论上：

```text
100,110,...300
```

共：

```text
21 个难度节点
```

---

# 79. Guild Combat Trial

目前有：

```text
5 种 Encounter Type

Badger
Chameleon
Jellyfish
Hedgehog
Swarm
```

难度还会根据：

```text
参与人数
```

动态缩放。

---

# 80. Guild Buildings

当前：

```text
23 Buildings
```

每栋最高：

```text
Lv20
```

包括：

```text
Guild Hall
Builder's Hall
Treasury
Archives
Skilling Encampment
Combat Encampment
17 个技能/战斗 Trial Building
```

Guild Point 因此有长期消耗目标。

---

# 81. Guild Shrines

当前：

```text
5 Shrines
```

分别：

```text
Force
Tempo
Spirit
Rarity
Scholar
```

每座 Shrine：

解锁：

```text
1 个 Skilling Buff
+
1 个 Combat Buff
```

玩家使用：

```text
Guild Token
+
Guild Credit
```

购买永久个人 Buff。

---

# 82. Shrine Refund

Shrine Buff 如果退款：

返还：

```text
80%
```

即：

```text
20% Reset Tax
```

这是一个重要的资源 Sink。

同时又允许玩家调整 Build。

---

# 83. Guild Credit

Guild Credit 有：

```text
8 种颜色
```

通过向 Guild Shop 兑换不同类别物品获得。

也就是说：

```text
个人库存
↓
Guild Credit
↓
永久 Shrine Buff
```

再次把游戏里过剩物资抽走。

---

# 84. Marketplace

Marketplace 是整个数值系统真正形成 MMO 的关键。

普通物品交易税：

```text
2%
```

所以卖家实际收入：

```text
Net Revenue
=
Sell Price
×
0.98
```

---

# 85. Cowbell Bag 税率

可交易 Premium Currency：

```text
Bag of Cowbells
```

税率：

```text
18%
```

即：

```text
Net Revenue
=
Sell Price
×
0.82
```

明显高于普通商品。

这是为了提高 Premium Currency 与 Coin 之间交易的摩擦成本。

---

# 86. 市场不能用固定价格逆向

官方提供：

```text
Marketplace JSON
```

当前会周期性更新市场：

```text
Top Ask
Top Bid
Volume
Average Price
```

官方 2025 更新后改为：

```text
每小时更新
```

因此：

> “木头值多少钱”不是一个静态策划值。

而是一个服务器动态变量。

---

# 87. 市场生产利润

真实 Manufacturing Profit：

```text
Net Profit / Action
=
Output Value After Tax
-
Input Opportunity Cost
-
Coin Cost
```

每小时：

```text
Profit / Hour
=
Net Profit / Action
×
Actions / Hour
×
Efficiency Effects
```

如果使用自产材料：

也必须用：

```text
Market Opportunity Cost
```

而不能把自产材料当成免费。

---

# 88. 为什么玩家市场不会立即崩

Milky Way Idle 有大量 Sink：

```text
Enhancing
Housing
Guild
Alchemy
Consumables
Crafting
Task-related systems
Equipment protection
Refinement
```

所以资源不是：

```text
生产
↓
永久留在服务器
```

而是：

```text
Faucet
↓
Market
↓
Sink
```

---

# 89. 货币 Faucet

主要 Coin / Value 来源：

```text
Combat
Coinify
Tasks
Vendor / 系统奖励
Marketplace 交易产生的财富转移
```

注意：

Marketplace 本身：

**不创造 Coin。**

它只是：

```text
A玩家 → B玩家
```

并通过 Tax：

销毁一部分 Coin。

---

# 90. Coin Sink

重要 Coin Sink：

```text
Marketplace Tax
Housing
Alchemy Cost
Guild相关投入
强化相关投入
系统商店
Task Reroll
```

因此：

> 市场税不是主要玩法，但它是持续、稳定、与经济规模同步增长的货币回收器。

---

# 91. 防工作室 / 小号经济治理

官方明确执行：

```text
Single-account policy
Trade boosting restrictions
```

2025 官方曾披露：

- 封禁 500+ 主账号
- 数千个 Alt
- 清除 100B+ Coin 级别违规财富

说明：

> 对拥有自由市场的 Idle MMO 来说，数值策划与反作弊本质上是同一个问题。

如果允许无限小号：

整个时间经济会失效。

---

# 92. Offline Progress

基础设计：

```text
约 10 小时 Offline Progress
```

付费/升级可以增加。

这意味着基础玩家每天：

```text
早晚登录一次
```

就能维持主要进度。

这是非常重要的 Daily Rhythm。

---

# 93. MooPass 数值

当前 MooPass 的核心数值权益包括：

```text
+5% XP / Wisdom（Standard）
+10 Hour Offline Limit
+6 Market Listings
+1 Action Queue
+8 Task Slots
+1 Free Task Reroll / Task
```

从数值策划角度看：

它卖的主要不是：

```text
攻击 +500%
```

而是：

# 时间利用率 + 管理容量。

---

# 94. 当前数值系统最重要的乘区

最终可以写成：

```text
Expected Skilling Value / Hour
≈
3600
/
[
Base Time
/
(1 + Speed)
]
×
Base Yield
×
(1 + Efficiency)
×
(1 + Gathering / Gourmet / etc.)
×
Market Value
```

再减：

```text
Material Cost
Tax
Consumable Cost
```

---

# 95. 为什么它不需要无限大数字

玩家提升不是：

```text
攻击：
10
→
10,000
→
10亿
```

而是：

```text
+5% Speed
+12% Gourmet
+10% Artisan
+29% Enhancement
+8 Effective Skill
+5% Wisdom
```

通过乘区组合，单位时间收益仍然可以增长很多。

这对多人市场非常关键。

---

# 96. 典型数值成长的四层

## 第一层：Skill Level

最慢、最稳定。

```text
1 → 200
```

---

## 第二层：Gear / Tool

阶段跳跃。

```text
新工具
↓
效率明显提升
```

---

## 第三层：Consumables

持续成本。

```text
Tea
Coffee
Food
```

让高效率运行需要不断消费市场商品。

---

## 第四层：Permanent Meta

```text
House
Achievement
Collection
Bestiary
Guild Shrine
```

极长期成长。

---

# 97. 为什么 Consumable 特别重要

如果所有 Buff：

都是永久的。

一旦玩家毕业：

市场需求就会消失。

Consumables：

```text
持续时间 300 秒
```

意味着：

每小时不断消耗。

例如：

```text
5分钟 / Tea
→ 理论 12 Tea / Hour
```

因此它是持续制造市场需求的核心。

---

# 98. 五分钟 Buff 的经济意义

假设在线/离线都自动使用：

```text
12 个 / h
288 个 / day
```

只要一批高阶玩家长期运行：

消费需求巨大。

于是：

```text
采集玩家
→ 原料

Brewing玩家
→ Tea

高阶玩家
→ 消费
```

形成稳定经济循环。

---

# 99. 专业化为什么成立

假设玩家 A：

```text
炼制效率高
```

玩家 B：

```text
采集效率高
```

如果所有玩家必须完全自给自足：

市场没有意义。

Milky Way Idle 允许玩家比较：

```text
自己生产成本
vs
市场购买成本
```

于是：

> “不会这个技能”并不是失败，可以通过市场买。

职业分工因此自然出现。

---

# 100. 时间机会成本

这个游戏最重要、但 UI 没有直接写出来的公式：

```text
Opportunity Cost
=
当前最佳 Coin/h
×
该行为所需时间
```

例如：

玩家最赚钱行为：

```text
1M Coin/h
```

某件装备自己制造需要：

```text
2h
```

那么即使材料免费：

它的隐形时间成本也已经是：

```text
2M Coin
```

如果市场售价只有：

```text
1.5M
```

那么理性玩家应该：

```text
直接买
```

这就是自由市场让挂机游戏产生策略深度的根本原因。

---

# 101. ROI 系统

所有成长投资都可以统一成：

```text
ROI
=
新增收益 / 投入
```

回本周期：

```text
Payback Time
=
Investment
/
Hourly Improvement
```

适用于：

```text
Tool
Enhancement
Housing
Consumable
Guild Buff
Equipment
```

玩家实际上是在做：

# 资本配置。

---

# 102. 为什么这个游戏能运营几年

因为增长不是一条线。

而是多个增长曲线错开：

```text
XP：
极长

Equipment：
阶段性

Enhancing：
极长

House：
极长

Collection：
对数长期

Bestiary：
对数长期

Guild：
周级

Marketplace：
永久动态
```

即使一条系统接近毕业：

其他系统仍然存在投资目标。

---

# 103. 对我们修仙版最重要的数值启示

真正应该借鉴的不是具体：

```text
6秒
30%
100B XP
```

而是数值结构。

---

## 103.1 修为等级

可以把：

```text
Lv1–200
```

变成：

```text
炼气
筑基
金丹
元婴
化神
...
```

每个境界内部仍然拥有：

```text
小层级 / 修为 XP
```

这样既有清晰“大目标”，又能保留长 XP 曲线。

---

## 103.2 修仙百艺

不要只设计：

```text
炼丹等级
```

至少拆出：

```text
炼丹效率
炼丹速度
悟性 XP
丹药珍品率
节省材料
额外成丹
```

直接对应：

```text
Efficiency
Action Speed
Wisdom
Rare Find
Artisan
Gourmet
```

---

# 104. 修仙版 Production 公式建议

可以沿用底层结构：

```text
炼丹次数 / h
=
3600
/
(
基础炼丹时间
/
(1 + 炼丹速度)
)
```

成丹：

```text
Expected 丹药
=
基础产量
×
(1 + 炼丹效率)
×
(1 + 额外成丹)
```

材料：

```text
Expected 材料消耗
=
基础材料
×
(1 - 节材)
```

---

# 105. 境界应该承担 Tier Gate

Milky Way Idle：

```text
Skill Level
→ 解锁新 Action
```

我们的版本建议：

```text
Skill Level
+
Realm
```

共同控制。

例如：

```text
炼丹 Lv30
+
筑基境

才能炼：
二阶筑基丹
```

这样境界就成为复杂系统的：

# 总导航。

---

# 106. 我们不应该照搬的 XP 体验

Milky Way Idle 可以：

```text
Lv125 → Lv200
需要极其漫长时间
```

因为：

玩家已经理解这个游戏是 Skill Grind。

修仙题材玩家更期待：

```text
境界突破反馈
```

因此我们应该把一个 100B 级长曲线拆成：

```text
多个境界
```

每个境界都有：

```text
前期快
中期稳定
后期瓶颈
突破
```

玩家体验会更好。

---

# 107. 最值得迁移的经济 Sink

修仙版可以一一映射：

| MWI | 修仙 |
|---|---|
| Enhancing | 淬炼 / 炼器强化 |
| Housing | 洞府 |
| Guild Buildings | 宗门建筑 |
| Consumables | 丹药 / 符箓 / 灵膳 |
| Alchemy | 炼化 |
| Refinement | 法宝升阶 |
| Marketplace Tax | 坊市手续费 |
| Collection | 天材地宝图鉴 |
| Bestiary | 妖兽图鉴 |

这意味着我们不需要凭空发明资源回收器。

---

# 108. 最值得照搬的“软上限”思想

MWI 很少采用：

```text
硬封顶
```

而大量使用：

```text
指数 XP
双曲线减伤
概率
边际递减
成本递增
```

这让玩家始终：

```text
还能提升
```

但是：

```text
越来越贵
```

这是长期游戏最健康的数值结构之一。

---

# 109. 本次逆向的最终数学模型

可以把整个游戏抽象成：

```text
Player Economic Power
=
Available Time
×
Time Utilization
×
Action Frequency
×
Action Yield
×
Resource Value
```

其中：

```text
Available Time
← Offline Limit

Time Utilization
← Action Queue

Action Frequency
← Action Speed

Action Yield
← Efficiency / Gathering / Gourmet

Resource Value
← Marketplace
```

永久成长：

```text
Skill / Gear / House / Guild
```

不断提升中间几项。

---

# 110. 最终结论

《Milky Way Idle》的数值核心不是：

> “挂机拿经验”。

而是：

# 用大量低幅度、不同乘区的成长系统，不断提高 1 小时游戏时间的价值。

其数值设计最重要的 8 个原则：

1. **XP 曲线极长，但通过多系统解锁不断提供阶段目标。**
2. **Action Speed 与 Efficiency 分开，形成真正的乘法成长。**
3. **技能等级本身拥有经济价值。**
4. **Consumable 持续制造市场需求。**
5. **Enhancing / Housing / Guild 持续销毁过剩资源。**
6. **自由市场让“时间机会成本”成为玩法。**
7. **战斗采用软上限公式而不是纯战力比较。**
8. **所有长期成长最终都能回到 XP/h、Item/h、Coin/h。**

如果我们的修仙项目想真正做成：

> “修仙版 Milky Way Idle”

下一步不应该马上开始拍：

```text
炼气期需要1000修为
```

而应该先建立我们自己的：

# 数值母表（Numerical Master Sheet）

至少包含：

```text
境界
技能 XP
Action
基础时间
基础产出
材料投入
Efficiency
Speed
Rare
市场基准价值
装备
强化
怪物
掉落
洞府
宗门
Sink
```

然后通过模拟：

```text
Day 1
Day 3
Day 7
Day 30
Day 90
Day 180
Day 365
```

去验证整个经济是否成立。

---

# 附录 A：完整 Lv1～200 XP 表

数据来自当前 Wiki Experience 表，并与社区 XP 数据表交叉核对。

| 等级 | 累计 XP | 升至下一级所需 XP |
|---:|---:|---:|
| 1 | 0 | 33 |
| 2 | 33 | 43 |
| 3 | 76 | 56 |
| 4 | 132 | 70 |
| 5 | 202 | 84 |
| 6 | 286 | 100 |
| 7 | 386 | 117 |
| 8 | 503 | 134 |
| 9 | 637 | 154 |
| 10 | 791 | 173 |
| 11 | 964 | 195 |
| 12 | 1,159 | 218 |
| 13 | 1,377 | 243 |
| 14 | 1,620 | 271 |
| 15 | 1,891 | 301 |
| 16 | 2,192 | 333 |
| 17 | 2,525 | 368 |
| 18 | 2,893 | 407 |
| 19 | 3,300 | 450 |
| 20 | 3,750 | 497 |
| 21 | 4,247 | 548 |
| 22 | 4,795 | 605 |
| 23 | 5,400 | 668 |
| 24 | 6,068 | 737 |
| 25 | 6,805 | 813 |
| 26 | 7,618 | 899 |
| 27 | 8,517 | 991 |
| 28 | 9,508 | 1,096 |
| 29 | 10,604 | 1,210 |
| 30 | 11,814 | 1,337 |
| 31 | 13,151 | 1,478 |
| 32 | 14,629 | 1,633 |
| 33 | 16,262 | 1,806 |
| 34 | 18,068 | 1,996 |
| 35 | 20,064 | 2,207 |
| 36 | 22,271 | 2,441 |
| 37 | 24,712 | 2,699 |
| 38 | 27,411 | 2,985 |
| 39 | 30,396 | 3,301 |
| 40 | 33,697 | 3,649 |
| 41 | 37,346 | 4,035 |
| 42 | 41,381 | 4,461 |
| 43 | 45,842 | 4,931 |
| 44 | 50,773 | 5,449 |
| 45 | 56,222 | 6,021 |
| 46 | 62,243 | 6,652 |
| 47 | 68,895 | 7,347 |
| 48 | 76,242 | 8,113 |
| 49 | 84,355 | 8,956 |
| 50 | 93,311 | 9,884 |
| 51 | 103,195 | 10,905 |
| 52 | 114,100 | 12,027 |
| 53 | 126,127 | 13,263 |
| 54 | 139,390 | 14,619 |
| 55 | 154,009 | 16,109 |
| 56 | 170,118 | 17,745 |
| 57 | 187,863 | 19,540 |
| 58 | 207,403 | 21,511 |
| 59 | 228,914 | 23,670 |
| 60 | 252,584 | 26,039 |
| 61 | 278,623 | 28,633 |
| 62 | 307,256 | 31,475 |
| 63 | 338,731 | 34,587 |
| 64 | 373,318 | 37,993 |
| 65 | 411,311 | 41,719 |
| 66 | 453,030 | 45,794 |
| 67 | 498,824 | 50,250 |
| 68 | 549,074 | 55,119 |
| 69 | 604,193 | 60,439 |
| 70 | 664,632 | 66,249 |
| 71 | 730,881 | 72,591 |
| 72 | 803,472 | 79,513 |
| 73 | 882,985 | 87,065 |
| 74 | 970,050 | 95,301 |
| 75 | 1,065,351 | 104,282 |
| 76 | 1,169,633 | 114,068 |
| 77 | 1,283,701 | 124,732 |
| 78 | 1,408,433 | 136,347 |
| 79 | 1,544,780 | 148,994 |
| 80 | 1,693,774 | 162,762 |
| 81 | 1,856,536 | 177,743 |
| 82 | 2,034,279 | 194,042 |
| 83 | 2,228,321 | 211,767 |
| 84 | 2,440,088 | 231,039 |
| 85 | 2,671,127 | 251,986 |
| 86 | 2,923,113 | 274,748 |
| 87 | 3,197,861 | 299,474 |
| 88 | 3,497,335 | 326,328 |
| 89 | 3,823,663 | 355,482 |
| 90 | 4,179,145 | 387,129 |
| 91 | 4,566,274 | 421,467 |
| 92 | 4,987,741 | 458,722 |
| 93 | 5,446,463 | 499,124 |
| 94 | 5,945,587 | 542,934 |
| 95 | 6,488,521 | 590,424 |
| 96 | 7,078,945 | 641,889 |
| 97 | 7,720,834 | 697,651 |
| 98 | 8,418,485 | 758,052 |
| 99 | 9,176,537 | 823,463 |
| 100 | 10,000,000 | 1,404,976 |
| 101 | 11,404,976 | 1,499,591 |
| 102 | 12,904,567 | 1,609,833 |
| 103 | 14,514,400 | 1,727,680 |
| 104 | 16,242,080 | 1,853,622 |
| 105 | 18,095,702 | 1,988,184 |
| 106 | 20,083,886 | 2,131,922 |
| 107 | 22,215,808 | 2,285,422 |
| 108 | 24,501,230 | 2,449,310 |
| 109 | 26,950,540 | 2,624,247 |
| 110 | 29,574,787 | 2,810,934 |
| 111 | 32,385,721 | 3,010,117 |
| 112 | 35,395,838 | 3,222,582 |
| 113 | 38,618,420 | 3,449,164 |
| 114 | 42,067,584 | 3,690,748 |
| 115 | 45,758,332 | 3,948,271 |
| 116 | 49,706,603 | 4,222,725 |
| 117 | 53,929,328 | 4,515,161 |
| 118 | 58,444,489 | 4,826,690 |
| 119 | 63,271,179 | 5,158,491 |
| 120 | 68,429,670 | 5,511,809 |
| 121 | 73,941,479 | 5,887,961 |
| 122 | 79,829,440 | 6,288,343 |
| 123 | 86,117,783 | 6,714,431 |
| 124 | 92,832,214 | 7,167,786 |
| 125 | 100,000,000 | 14,406,130 |
| 126 | 114,406,130 | 15,712,264 |
| 127 | 130,118,394 | 17,201,262 |
| 128 | 147,319,656 | 18,827,962 |
| 129 | 166,147,618 | 20,604,810 |
| 130 | 186,752,428 | 22,545,343 |
| 131 | 209,297,771 | 24,664,301 |
| 132 | 233,962,072 | 26,977,715 |
| 133 | 260,939,787 | 29,503,027 |
| 134 | 290,442,814 | 32,259,214 |
| 135 | 322,702,028 | 35,266,910 |
| 136 | 357,968,938 | 38,548,557 |
| 137 | 396,517,495 | 42,128,558 |
| 138 | 438,646,053 | 46,033,441 |
| 139 | 484,679,494 | 50,292,044 |
| 140 | 534,971,538 | 54,935,714 |
| 141 | 589,907,252 | 59,998,511 |
| 142 | 649,905,763 | 65,517,455 |
| 143 | 715,423,218 | 71,532,759 |
| 144 | 786,955,977 | 78,088,116 |
| 145 | 865,044,093 | 85,230,981 |
| 146 | 950,275,074 | 93,012,897 |
| 147 | 1,043,287,971 | 101,489,833 |
| 148 | 1,144,777,804 | 110,722,569 |
| 149 | 1,255,500,373 | 120,777,085 |
| 150 | 1,376,277,458 | 131,725,012 |
| 151 | 1,508,002,470 | 143,644,096 |
| 152 | 1,651,646,566 | 156,618,719 |
| 153 | 1,808,265,285 | 170,740,445 |
| 154 | 1,979,005,730 | 186,108,628 |
| 155 | 2,165,114,358 | 202,831,060 |
| 156 | 2,367,945,418 | 221,024,671 |
| 157 | 2,588,970,089 | 240,816,292 |
| 158 | 2,829,786,381 | 262,343,476 |
| 159 | 3,092,129,857 | 285,755,393 |
| 160 | 3,377,885,250 | 311,213,781 |
| 161 | 3,689,099,031 | 338,894,002 |
| 162 | 4,027,993,033 | 368,986,151 |
| 163 | 4,396,979,184 | 401,696,287 |
| 164 | 4,798,675,471 | 437,247,736 |
| 165 | 5,235,923,207 | 475,882,521 |
| 166 | 5,711,805,728 | 517,862,896 |
| 167 | 6,229,668,624 | 563,473,004 |
| 168 | 6,793,141,628 | 613,020,673 |
| 169 | 7,406,162,301 | 666,839,361 |
| 170 | 8,073,001,662 | 725,290,240 |
| 171 | 8,798,291,902 | 788,764,470 |
| 172 | 9,587,056,372 | 857,685,635 |
| 173 | 10,444,742,007 | 932,512,394 |
| 174 | 11,377,254,401 | 1,013,741,327 |
| 175 | 12,390,995,728 | 1,101,910,017 |
| 176 | 13,492,905,745 | 1,197,600,375 |
| 177 | 14,690,506,120 | 1,301,442,241 |
| 178 | 15,991,948,361 | 1,414,117,248 |
| 179 | 17,406,065,609 | 1,536,363,024 |
| 180 | 18,942,428,633 | 1,668,977,702 |
| 181 | 20,611,406,335 | 1,812,824,804 |
| 182 | 22,424,231,139 | 1,968,838,501 |
| 183 | 24,393,069,640 | 2,138,029,305 |
| 184 | 26,531,098,945 | 2,321,490,193 |
| 185 | 28,852,589,138 | 2,520,403,225 |
| 186 | 31,372,992,363 | 2,736,046,691 |
| 187 | 34,109,039,054 | 2,969,802,806 |
| 188 | 37,078,841,860 | 3,223,166,015 |
| 189 | 40,302,007,875 | 3,497,751,968 |
| 190 | 43,799,759,843 | 3,795,307,178 |
| 191 | 47,595,067,021 | 4,117,719,444 |
| 192 | 51,712,786,465 | 4,467,029,099 |
| 193 | 56,179,815,564 | 4,845,441,132 |
| 194 | 61,025,256,696 | 5,255,338,257 |
| 195 | 66,280,594,953 | 5,699,295,007 |
| 196 | 71,979,889,960 | 6,180,092,921 |
| 197 | 78,159,982,881 | 6,700,736,933 |
| 198 | 84,860,719,814 | 7,264,473,008 |
| 199 | 92,125,192,822 | 7,874,807,178 |
| 200 | 100,000,000,000 |  |

---

# 附录 B：强化属性增幅表

| 强化等级 | 1×槽位基础属性增幅 |
|---:|---:|
| +1 | +2.0% |
| +2 | +4.2% |
| +3 | +6.6% |
| +4 | +9.2% |
| +5 | +12.0% |
| +6 | +15.0% |
| +7 | +18.2% |
| +8 | +21.6% |
| +9 | +25.2% |
| +10 | +29.0% |
| +11 | +33.4% |
| +12 | +38.4% |
| +13 | +44.0% |
| +14 | +50.2% |
| +15 | +57.0% |
| +16 | +64.4% |
| +17 | +72.4% |
| +18 | +81.0% |
| +19 | +90.2% |
| +20 | +100.0% |

---

# 附录 C：核心公式速查

## XP

```text
Skilling XP
=
Base XP
×
(1 + Wisdom + Charm XP)
```

```text
Combat XP
=
Base XP
×
Survival
×
(1 + Wisdom)
×
Rate
×
(1 + Charm XP)
```

## Action

```text
Action Time
=
Base Time
/
(1 + Action Speed)
```

```text
Actions / Hour
=
3600 / Action Time
```

## Efficiency

```text
Guaranteed Actions
=
1 + floor(Efficiency / 100)
```

```text
Extra Action Chance
=
Efficiency mod 100
```

```text
Expected Multiplier
=
1 + Efficiency / 100
```

## Artisan

```text
Material Required
=
Base Material
×
(1 - Artisan)
```

## Hit

```text
Hit Chance
=
Accuracy^1.4
/
(
Accuracy^1.4 + Evasion^1.4
)
```

## Armor / Resistance

```text
Damage Taken
=
100
/
(
100 + Effective Defense
)
```

## CC

```text
Final CC Chance
=
Base CC
×
100
/
(
100 + Tenacity
)
```

## Marketplace

```text
Normal Net Sell
=
Price × 0.98
```

```text
Cowbell Bag Net Sell
=
Price × 0.82
```

## ROI

```text
Payback Hours
=
Investment Cost
/
Additional Profit per Hour
```

---

# 附录 D：数据缺口与注意事项

为了避免“假完整”，这里明确列出本次公开逆向还无法可靠固定下来的数据。

## 1. 2026 当前全部 Action 配方表

历史客户端快照可以取得大量：

```text
Action Time
XP
Input
Output
```

但当前客户端已持续更新。

因此本文没有把 2025 快照冒充 2026 全量数值。

如果我们后续要做真正的数据库级复刻研究，应继续抓：

```text
当前客户端 init data
```

并导出：

```text
所有 Action
所有 Item
所有 Monster
所有 Recipe
所有 Drop Table
```

---

## 2. 当前所有怪物逐只 Stats

2025 Combat Rework 后怪物：

```text
HP
Accuracy
Damage
Defense
XP
```

被大规模重平衡。

旧数据库已经不能可靠代表当前版本。

所以本文保留：

**当前战斗公式**

而不伪造“当前完整 Monster 表”。

---

## 3. Enhancing 每个目标级别完整 Base Success 表

当前 Wiki 可以确认：

```text
+10 Base Rate = 30%
```

以及完整强化属性增幅表。

但搜索索引没有完整暴露 +1～+20 的 Base Success 表。

因此本文没有填猜测值。

---

## 4. 实时 Marketplace Price

这是动态服务器变量。

正确做法不是保存一次价格。

而是：

```text
定时读取官方 Marketplace JSON
```

进行：

```text
Bid
Ask
Average
Volume
Profit/h
```

动态计算。

---

# 附录 E：主要资料来源

## 官方

- [Milky Way Idle Steam 商店](https://store.steampowered.com/app/3224420/Milky_Way_Idle/)
- [2025 Combat Rework 官方公告](https://store.steampowered.com/news/app/3224420/view/496078121040085940)
- [Steam 官方新闻 / 2026 Guild Expansion](https://steamcommunity.com/app/3224420/allnews/)
- [Milky Way Idle 官方站](https://www.milkywayidle.com/)
- [官方 Marketplace JSON](https://www.milkywayidle.com/game_data/marketplace.json)

## Wiki.gg

- [Experience](https://milkywayidle.wiki.gg/wiki/Experience)
- [Efficiency](https://milkywayidle.wiki.gg/wiki/Efficiency)
- [Wisdom](https://milkywayidle.wiki.gg/wiki/Wisdom)
- [Action Speed](https://milkywayidle.wiki.gg/wiki/Action_Speed)
- [Stats](https://milkywayidle.wiki.gg/wiki/Stats)
- [Combat](https://milkywayidle.wiki.gg/wiki/Combat)
- [Combat Level](https://milkywayidle.wiki.gg/wiki/Combat_Level)
- [Stamina](https://milkywayidle.wiki.gg/wiki/Stamina)
- [Intelligence](https://milkywayidle.wiki.gg/wiki/Intelligence)
- [Attack](https://milkywayidle.wiki.gg/wiki/Attack)
- [Enhancing](https://milkywayidle.wiki.gg/wiki/Enhancing)
- [Equipment](https://milkywayidle.wiki.gg/wiki/Equipment)
- [Alchemy](https://milkywayidle.wiki.gg/wiki/Alchemy)
- [Coinify](https://milkywayidle.wiki.gg/wiki/Coinify)
- [Decompose](https://milkywayidle.wiki.gg/wiki/Decompose)
- [Transmute](https://milkywayidle.wiki.gg/wiki/Transmute)
- [Marketplace](https://milkywayidle.wiki.gg/wiki/Marketplace)
- [Houses](https://milkywayidle.wiki.gg/wiki/Houses)
- [Tasks](https://milkywayidle.wiki.gg/wiki/Tasks)
- [Achievement Tiers](https://milkywayidle.wiki.gg/wiki/Achievement_Tiers)
- [Collections](https://milkywayidle.wiki.gg/wiki/Collections)
- [Bestiary](https://milkywayidle.wiki.gg/wiki/Bestiary)
- [Processing](https://milkywayidle.wiki.gg/wiki/Processing)
- [Gourmet](https://milkywayidle.wiki.gg/wiki/Gourmet)
- [Artisan](https://milkywayidle.wiki.gg/wiki/Artisan)

## 社区数据工具

- [MWITools](https://greasyfork.org/en/scripts/494467-mwitools)
- [MilkyWay Market](https://milkyway.market/)
- [c3d-gg / mwi-types](https://github.com/c3d-gg/mwi-types)

---

# 附录 F：下一阶段建议

完成这份文档后，我们已经知道：

**MWI 的数学发动机是什么。**

下一阶段最合理的是建立：

# 《修仙项目 Numerical Master Sheet V0.1》

不要先写剧情。

直接先定：

```text
1. 境界时间轴
2. 修为 XP 曲线
3. 采集 Action 时间
4. 一级资源产量
5. 炼丹 / 炼器生产公式
6. 装备效率曲线
7. 怪物难度
8. 坊市税率
9. 洞府 Sink
10. 宗门 Sink
11. Day 1～365 模拟
```

只要这一张母表跑通，我们这个项目的底层才真正成立。
