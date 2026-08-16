# 《Milky Way Idle / 银河奶牛放置》内容解锁、玩家成长与留存路径逆向 V3.0

**文档类型：** 竞品逆向 / Progression & Content Pacing Reverse Engineering  
**调研日期：** 2026-08-15  
**适用目的：** 为“修仙题材多人放置 RPG”建立玩家成长骨架、功能解锁节奏和长期留存结构  
**前置文档：**
- V1.0：《系统与数值设计逆向文档》
- V2.0：《完整数值系统逆向分析》

> 本文重点回答的不是“银河奶牛有哪些系统”，而是：
>
> **玩家什么时候接触这些系统？为什么那时接触？每个阶段在追什么目标？一个系统如何把玩家送到下一个系统？**

---

# 0. 核心结论

Milky Way Idle 的成长设计可以概括成：

```text
先教时间规划
↓
再教资源生产
↓
再教装备效率
↓
再教消耗品组合
↓
再鼓励职业专业化
↓
再进入战斗 Build
↓
再进入多人高阶内容
↓
最后用永久成长 / 收藏 / 公会 / 市场维持长期目标
```

它不是把所有内容按“玩家等级”一刀切解锁。

而是同时使用四类门槛：

```text
1. 单技能等级 Skill Level
2. 总等级 Total Level
3. 资产 / 装备 / Buff 软门槛
4. 玩家知识门槛
```

其中最值得我们注意的是：

# Total Level 实际承担“系统复杂度闸门”

当前几个非常清晰的关键节点：

```text
TL 250
→ Medium Pouch

TL 500
→ Large Pouch

TL 750
→ Giant Pouch
→ Wiki 将 TL750 之前整体定义为 Beginner's Phase

TL 1000
→ Labyrinth 首次进入门槛

TL 1250
→ Gluttonous / Guzzling Pouch
```

因此 Milky Way Idle 的玩家成长并不是：

```text
Lv1
Lv2
Lv3
...
```

而更像：

```text
基础理解
↓
多技能协作
↓
Build 成型
↓
专业化
↓
高阶 PvE
↓
长期元成长
```

---

# 1. 资料可信度分级

## A 级：官方当前资料

用于确认：

- 2026 Guild Expansion
- Labyrinth TL1000 门槛
- Combat Rework
- Action Queue QOL
- Marketplace 数据更新
- 新内容的官方设计理由

## B 级：当前 Wiki.gg

用于确认：

- Beginner's Phase = TL750
- Pouch Total Level 门槛
- Tools 等级梯度
- Skills / Equipment / Consumables
- Combat Guide 的推荐起步阶段
- Tasks / Collection / Bestiary 等系统

## C 级：社区成熟攻略

用于观察：

- 新手最优路线
- 玩家通常把什么当成“第一个大目标”
- Standard 与 Ironcow 的路线差异
- 什么系统在玩家认知中真正重要

## D 级：玩家时间样本

例如：

> “第一两天冲到 TL500 后节奏明显变慢”

这类数据只能作为节奏参考，不能当作官方保证的 Day X 进度。

原因是 MWI 允许：

```text
市场购买
技能专业化
完全不同的行动选择
付费 QoL
Standard / Ironcow
```

玩家时间差非常大。

---

# 2. 两种核心玩家模式会改变成长路径

Milky Way Idle 至少存在两个非常关键的角色模式：

## Standard

可以使用玩家 Marketplace。

因此成长逻辑是：

```text
做最有效率的事
↓
卖出
↓
购买自己需要的东西
↓
专业化
```

## Ironcow

基本无法通过正常 Marketplace 买卖所需物资。

因此成长逻辑更接近：

```text
采集
↓
自己生产
↓
自己制造工具
↓
自己制作消耗品
↓
自己准备战斗装备
```

这两个模式说明了一个设计事实：

> **相同系统，在有市场和无市场情况下，实际上是两套不同的成长游戏。**

对我们修仙版来说，这意味着未来也可以考虑：

```text
普通修士
→ 坊市自由交易

独行 / 铁人模式
→ 自给自足
```

但主版本应该围绕自由经济设计。

---

# 3. 玩家进入游戏后的第一个认知任务

一个新玩家第一次进入 MWI 时看到的是大量技能：

```text
Milking
Foraging
Woodcutting
Cheesesmithing
Crafting
Tailoring
Cooking
Brewing
Enhancing
Alchemy
Combat...
```

开发者在早期公开讨论中已经意识到：

> 新玩家最大的困难不是不知道怎么点击，而是不知道“这些技能之间为什么有关联、我为什么要练它”。

社区反馈也明确建议：

- 用任务帮助玩家体验技能
- 给玩家短期目标
- 避免“17 个系统全部摆在你面前，但不知道干什么”

所以 MWI 后续逐渐形成了：

```text
Tutorial
+
Tasks
+
Beginner Guide
+
Total Level Milestones
+
Equipment Requirements
```

这种复合引导。

---

# 4. MWI 的正确新手教学对象不是“按钮”

这点非常重要。

普通手游教程教：

```text
点击这里
点击那里
领取奖励
```

MWI 真正需要教的是：

```text
时间 → Action
Action → XP / Item
Item → Production
Production → Equipment
Equipment → 更高效率
Marketplace → 机会成本
```

所以它的新手教程核心应该被理解成：

# 教“关系”，而不是教“功能”。

这是我们修仙项目必须继承的原则。

---

# 5. 成长阶段总览

根据当前 Wiki、官方门槛以及社区路线，可以把 MWI 的玩家生命周期拆成 8 个阶段：

| 阶段 | 主要门槛 | 玩家核心认知 |
|---|---|---|
| P0 初次体验 | Tutorial | Action 会自动运行 |
| P1 基础生产 | TL 0–250 | 采集→加工→工具 |
| P2 多系统协作 | TL 250–500 | 食物/饮品/队列开始影响效率 |
| P3 新手毕业 | TL 500–750 | Build 初步成型，Giant Pouch 成为大目标 |
| P4 专业化中期 | TL 750–1000 | 选择赚钱技能或战斗路线 |
| P5 高阶系统开启 | TL 1000–1250 | Labyrinth、复杂 Build、多人内容 |
| P6 长期成长 | TL 1250+ | 高级 Pouch、Housing、Enhancing、Collection |
| P7 Endgame | 高技能/高装备 | Guild Trials、Dungeon Tier、Refinement、市场资本化 |

注意：

**TL 区间不是官方定义的“章节”。**

这是本次逆向后，为了理解它实际玩家成长结构所做的设计拆分。

唯一明确的官方/Wiki大阶段是：

```text
Beginner's Phase
→ Reaching Total Level 750
```

---

# 6. P0：前 10～30 分钟——理解 Idle 的规则

## 玩家第一次要明白什么？

不是战斗。

而是：

```text
我选择一个 Action
↓
角色会自动重复
↓
我不需要继续点击
```

这一步决定玩家是否理解产品定位。

MWI 本质是一款：

# Programming Lite / Planning Game

玩家提供的是：

```text
高层意图
```

游戏负责：

```text
重复劳动
```

---

# 7. P0 的核心反馈

新手最先应该获得：

```text
Action Progress
↓
Item +1
XP +X
↓
技能升级
↓
新 Action / 新 Item
```

这是最低层的反馈循环。

周期必须短。

因为玩家还没有：

```text
市场目标
装备目标
Build目标
Boss目标
```

此时唯一的爽点就是：

# “数字正在自动增长。”

---

# 8. P0 为什么必须展示 Action Queue

Action Queue 是 MWI 和普通挂机游戏最大的区别之一。

如果玩家把 MWI 理解成：

```text
点一个技能
↓
挂机
```

产品差异化就没有建立。

正确理解应该是：

```text
我可以规划未来
```

例如：

```text
采集
↓
制作
↓
强化
↓
战斗
↓
最后放无限采集防止角色空闲
```

社区新手建议甚至会强调：

> 在队列末尾放一个无限 Gathering Action，避免睡觉时队列跑完后角色闲置。

这说明 Action Queue 已经不只是 QoL。

它是：

# Idle 策略系统。

---

# 9. P1：TL 0～250——基础生产阶段

这一阶段最重要的是三个无限采集技能：

```text
Milking
Foraging
Woodcutting
```

Gathering 的核心特点：

```text
不需要 Input Material
可以无限执行
```

因此特别适合：

- 新手
- 睡眠挂机
- 工作期间挂机
- 队列保底

---

# 10. 为什么先教 Gathering

如果一开始就让玩家 Craft：

玩家需要先理解：

```text
材料不足
市场
配方
成本
工具
```

认知负担太重。

Gathering 则只有：

```text
时间
↓
资源
```

这是最简单的经济模型。

---

# 11. 第一条真正的生产依赖链

Beginner Guide 给出的典型早期路线之一：

```text
Milking
+
Woodcutting
↓
先练到 10 左右
↓
Cheesesmithing
↓
更新工具
↓
回头继续 Gathering
```

这里玩家第一次理解：

> 生产技能不是“另一个独立小游戏”，而是在提高采集效率。

这一步非常关键。

---

# 12. Tools 是早期成长的主反馈

当前 Tools 存在明显技能等级梯度。

Beginner Guide 给出的核心工具门槛包括：

```text
Lv1
Lv10
Lv20
Lv35
Lv50
Lv65
Lv80
```

后续当前 Wiki 还能看到：

```text
Lv90 Celestial tier
```

也就是说工具成长不是每级换一次。

而是：

# 阶段式跃迁。

---

# 13. Tool Progression 的设计价值

如果每升一级：

```text
+1% Speed
```

反馈很弱。

MWI 让玩家：

```text
技能等级不断上涨
↓
到达 10 / 20 / 35 / 50 / 65 / 80...
↓
突然可以换新工具
↓
Action Time 明显下降
```

所以玩家同时拥有：

```text
连续反馈：XP
+
阶段反馈：Tool Tier
```

这是优秀的长期成长结构。

---

# 14. P1 的玩家目标应该是什么

这一阶段玩家脑中逐渐形成：

```text
我要到下一个工具等级
```

而不是：

```text
我要把技能练满
```

这是 MWI 非常重要的设计。

技能等级本身是过程。

真正的阶段目标是：

```text
Unlock
```

---

# 15. TL250：第一个跨系统节点

当前 Total Level 系统：

```text
Medium Pouch
要求 TL250
```

Medium Pouch 开始提供额外：

```text
Food / Drink Slot
```

这意味着玩家进入：

# Buff 管理阶段。

---

# 16. P2：TL250～500——Buff 与效率组合开始出现

在这之前：

玩家主要关注：

```text
Skill Level
Tool
```

现在开始关注：

```text
Food
Drink
Tea
Coffee
```

而 Drink 并不是纯回血道具。

它们直接改变：

```text
Efficiency
Wisdom
Action Speed
Artisan
Gourmet
Processing
Combat stats
```

这会让玩家第一次理解：

> 同样一个技能，同样一个 Action，不同 Build 的收益可以不同。

---

# 17. 为什么 Pouch 是非常聪明的复杂度解锁器

如果游戏开局直接允许：

```text
3种 Food
3种 Drink
多个 Buff
```

新玩家会被信息淹没。

Pouch 通过：

# 可装备槽位数量

自然控制复杂度。

玩家先只用少量消耗品。

随着 Total Level 提高：

```text
更多槽位
↓
更多 Buff 组合
↓
Build 深度增加
```

这比直接弹窗：

```text
“恭喜你解锁高级 Build！”
```

自然得多。

---

# 18. TL500：第二个 Pouch 节点

```text
Large Pouch
→ TL500
```

玩家开始拥有更多 Food / Drink 组合空间。

这也是一个实际的节奏拐点。

社区玩家曾描述：

> 前一两天 Total Level 上升很快，接近 500 后明显感觉成长速度放缓。

这不是严谨的官方时间表，但反映出一个体验事实：

# TL500 左右开始从“快速理解期”进入“长期挂机期”。

---

# 19. P2 中为什么不能太早鼓励战斗

当前多个战斗 Beginner Guide 都会建议：

```text
先完成基础 Beginner Guide
并达到约 TL750
并准备一定资金
```

再认真进入 Combat Build。

原因不是游戏完全禁止低等级战斗。

而是：

低等级直接战斗时缺少：

```text
Pouch
Food
Drink
资金
装备
技能基础
Ability
```

体验效率很差。

这就是：

# Soft Gate。

---

# 20. Soft Gate 比 Hard Gate 更重要

MWI 很多内容实际上可以提前碰。

但最佳体验是：

```text
先准备
↓
再进入
```

这种设计的好处：

- 高手可以提前挑战
- 普通玩家有推荐路线
- 不需要所有系统全部锁死

我们的修仙版也应该大量使用：

```text
可提前尝试
但准备不足会明显低效
```

而不是：

```text
境界不到，按钮完全不存在
```

---

# 21. P3：TL500～750——新手毕业阶段

当前 Wiki 直接把：

# Reaching Total Level 750

称为：

# Beginner's Phase

这可能是整个 MWI 成长设计最值得重视的事实。

因为这说明：

> 游戏并不把“玩了几十分钟”视为新手结束。

而是让玩家完成一次真正的多系统学习后才毕业。

---

# 22. Giant Pouch 是早期最大的跨系统目标

```text
Giant Pouch
→ TL750
```

社区攻略通常把它视为：

# 第一个 Major Goal

尤其 Ironcow 攻略会建议：

```text
先攒 Giant Pouch
再考虑 Housing
```

部分攻略给出的制造 Coin 量级：

```text
5,000,000 Coin
```

其价值来自：

```text
更多 Food Slot
+
更多 Drink Slot
```

---

# 23. 为什么 Giant Pouch 比“新武器”更适合做新手毕业奖励

武器只提高：

```text
Combat
```

Giant Pouch 提高：

```text
Skilling
Combat
XP
生产效率
资源利用率
```

属于：

# Global Utility Upgrade。

因此玩家会感觉：

> 整个账号都升级了。

这是非常好的大节点奖励。

---

# 24. P3 的真正教学目标

到 TL750 左右，一个玩家理论上已经理解：

```text
Gathering
Production
Tool
Consumable
Action Queue
Marketplace / 自给自足
Total Level
Pouch
```

这时候游戏才可以把复杂度继续推高。

---

# 25. TL750 后：玩家开始从“学习所有系统”转为“选择自己是谁”

这一步是 MWI 的第二次重大变化。

TL750 前：

```text
广度成长
```

TL750 后：

```text
专业化
```

玩家会开始问：

```text
我主要赚钱练什么？
我要不要打 Combat？
我要做 Brewer？
Cook？
Gatherer？
Enhancer？
Trader？
```

---

# 26. Standard 模式下的专业化

因为有 Marketplace：

玩家不需要：

```text
所有东西自己做
```

所以会开始比较：

```text
自己生产的 Coin/h
vs
市场购买的机会成本
```

例如社区新手讨论中就会建议：

```text
Foraging
Brewing
Cooking
Tailoring
Alchemy
```

等不同赚钱路线。

也有玩家：

```text
先 Gathering Beans
↓
产生稳定现金
↓
之后转 Cooking
```

这说明：

# 职业切换也是成长内容。

---

# 27. “市场”什么时候才真正成为玩法

市场开局就可以存在。

但新手阶段市场主要是：

```text
买东西 / 卖东西
```

中期以后才变成：

```text
利润比较
成本计算
机会成本
专业分工
资本配置
```

这是一个很重要的设计规律：

> 一个系统可以从第一天出现，但它的“深层玩法”可以在很久以后才被玩家理解。

所以 UI 不一定需要强行隐藏市场。

而应该：

# 分阶段展示数据复杂度。

---

# 28. P4：TL750～1000——正式中期

这个阶段玩家的主要目标由：

```text
升级所有技能
```

逐渐变成：

```text
建立一个能长期运行的 Build
```

典型 Build：

```text
Skilling XP Build
Profit Build
Rare Find Build
Combat Build
Enhancing Build
Alchemy Build
```

---

# 29. Combat 在这里开始真正成立

当前战斗指南通常建议：

```text
TL750+
+
一定资金
```

再进入系统。

此时玩家已经拥有：

```text
更多 Consumable Slot
可以买 / 做装备
可以买 Ability Book
可以支持持续 Food / Coffee 消耗
```

因此战斗不再只是：

```text
打怪
```

而变成：

```text
装备
Ability
Charm
Food
Coffee
Combat Style
Training Focus
```

完整 Build 系统。

---

# 30. Ability 是战斗的第二条成长线

Ability Book 通过：

```text
Combat Drop
或 Marketplace
```

获得。

Ability 自身还能继续升级。

因此 Combat 玩家拥有：

```text
Combat Skill
+
Gear
+
Enhancing
+
Ability
+
Consumables
```

多个长期目标。

---

# 31. 为什么 Combat 不适合成为第一小时主循环

Combat 的信息复杂度远高于 Gathering：

```text
命中
闪避
伤害
抗性
Ability
Mana
Food
Coffee
Charm
Training
Monster Tier
```

如果玩家一开始就在这些数值里做选择：

极容易产生：

```text
不知道为什么输
```

MWI 的路线本质是：

# 先让玩家学经济，再让玩家学战斗。

---

# 32. P4 的多人玩法开始变得有意义

游戏的高阶 Combat：

```text
Party
Elite / Higher Tier Zones
Dungeon
```

会逐渐让多人合作有实际价值。

但 Party 并不是：

```text
越早越好
```

因为 XP 会分配。

早期低强度敌人：

Solo 往往更直接。

高阶敌人：

才开始体现：

```text
Build互补
生存
高阶掉落
```

价值。

---

# 33. 这是“弱同步 MMO”而不是传统 MMO

MWI 不要求：

```text
晚上8点集合
```

Party 可以：

```text
创建
等待人满
自动开始
```

后续更新甚至允许：

```text
Queue Party Ready
```

放到行动队列后面。

所以：

> 多人系统服务于 Idle，而不是破坏 Idle。

这是我们修仙版必须遵守的红线。

---

# 34. TL1000：当前最明确的高阶内容硬门槛

2026 年官方把：

# Labyrinth

首次进入门槛调整为：

```text
Total Level >= 1000
```

官方明确解释：

> 数据显示，TL1000 以下只有极少数玩家能合理成功体验；很多新玩家过早进入后感到困惑和挫败。

因此官方选择：

```text
Hard Gate
```

鼓励新玩家：

```text
先完成核心成长
↓
再进入 Labyrinth
```

这是极其重要的内容节奏案例。

---

# 35. 为什么 Labyrinth 必须放到 TL1000

Labyrinth 本身已经是：

```text
Skilling Challenge
+
Combat Encounter
+
Treasure
+
Supply Preparation
+
Room Path
+
Loadout
+
Automation
+
Permanent Upgrade
```

也就是说它不是一个单系统。

而是：

# 对前面全部知识的综合考试。

因此必须晚于：

```text
基础生产
工具
Build
Combat
```

---

# 36. Labyrinth 的真正作用

表面：

```text
新的 PvE 模式
```

实际上它解决的是中后期问题：

> 当玩家已经能自动挂机全部基础技能以后，还有什么内容需要重新做决策？

Labyrinth 把挂机玩家重新拉回：

```text
规划路线
准备 Loadout
设置自动化
提升永久 Buff
尝试更深层
```

---

# 37. Labyrinth 自己也会再次经历“手动→自动”的成长

这是 MWI 很聪明的一点。

玩家第一次进入：

```text
需要理解房间
需要规划
```

随着投资：

```text
Automation Upgrade
Loadout
Skip Threshold
Auto Path
```

越来越自动。

最终：

# 玩家通过成长获得“自动化权”。

这比单纯：

```text
伤害 +10%
```

有更强的长期价值。

---

# 38. 对我们修仙版的直接启示：高级系统应该奖励“少操作”

修仙后期玩家最合理的幻想不是：

> 境界越高，每天越忙。

而应该是：

```text
炼气：
很多事情亲自做

筑基：
可以排队

金丹：
自动补材料

元婴：
洞府管家

化神：
分身自动执行
```

即：

# 成长本身不断获得自动化。

这和修仙题材甚至比 MWI 更契合。

---

# 39. P5：TL1000～1250——综合系统阶段

这个阶段玩家已经不应该被单一 Skill Level 驱动。

而是开始同时追：

```text
高级装备
Enhancement
House
Dungeon
Labyrinth
Collection
Bestiary
Guild
市场资本
```

目标从：

```text
“再升一级”
```

转为：

```text
“完成一个项目”
```

---

# 40. 中后期目标单位发生变化

新手目标：

```text
Milking 10
```

中期目标：

```text
Giant Pouch
```

后期目标：

```text
某套 +X Gear
某个 House Lv
某个 Dungeon Refinement
某套 Labyrinth Upgrade
```

这叫：

# Goal Granularity Shift

玩家越成熟，目标越复杂。

---

# 41. TL1250：高级 Pouch

当前 Total Level 门槛包括：

```text
Gluttonous Pouch
TL1250

Guzzling Pouch
TL1250
```

这进一步强化：

```text
Food
Drink
```

系统。

说明 Consumable 并不是新手临时功能。

而是一直贯穿到长期游戏。

---

# 42. 为什么 Consumable 必须贯穿 Endgame

因为它承担整个经济中的：

# Recurring Sink

装备：

```text
买一次可以用很久
```

House：

```text
升级一次永久存在
```

Consumable：

```text
持续消耗
```

如果没有它：

高级玩家逐渐停止购买中低级资源。

市场会萎缩。

---

# 43. P6：TL1250+——长期元成长阶段

此时玩家进入真正的：

# Long-tail Progression

最重要的系统：

```text
Housing
Enhancing
Achievement
Collection
Bestiary
Guild
High-tier Combat
Marketplace
```

---

# 44. Housing 为什么必须后置

Housing：

```text
永久 Buff
+
巨量 Coin
+
巨量材料 Sink
```

如果玩家早期就把钱投进去：

可能反而拖慢：

```text
工具
Pouch
基础 Build
```

所以社区攻略会明确建议：

> 新手先完成 Giant Pouch 等核心全局升级，再考虑 Housing。

这是一个值得学习的资源优先级设计。

---

# 45. Housing 的玩家心理从“装备消费”升级为“资产投资”

装备：

```text
我今天更强
```

Housing：

```text
我的账号永久效率更高
```

这种反馈非常适合中后期。

因为玩家已经对游戏建立长期承诺。

---

# 46. Enhancing 为什么会成为 Endgame 核心

装备取得只是：

```text
第一阶段
```

接下来：

```text
+1
+2
...
+20
```

让同一件装备拥有巨大追加投资空间。

这解决：

> Boss 掉了毕业装备以后，我还有什么可做？

---

# 47. Refinement 再次给毕业装备延寿

2025 Combat Rework 后：

高级 Dungeon 装备还可以：

```text
Refinement
```

而且：

```text
保留 Enhancement Level
```

这非常重要。

因为玩家不会感觉：

> 我之前所有强化投资被新系统清零了。

正确长期游戏应该：

# 尽量承接旧投资。

---

# 48. Collection 是“横向内容”而不是纯战力内容

Collection 要求：

```text
1
10
100
1K
10K
...
```

不同物品的长期收集。

它让玩家有理由：

```text
回低级地图
做低级资源
尝试没做过的东西
```

从而防止全部玩家只集中在“当前最高级 Action”。

---

# 49. Bestiary 起同样作用

不同 Monster：

```text
1
10
100
1K
10K
...
```

持续提供 Bestiary Point。

高 Tier 还会给更高 Credit。

于是 Combat 玩家也不会只有：

```text
当前最高 XP/h
```

一个目标。

---

# 50. Achievement Tier 是“系统覆盖检查器”

73 个 Achievement、6 个 Tier。

完成整 Tier：

```text
Permanent Buff
```

这让玩家被激励：

```text
去做自己平时不会做的系统
```

因此 Achievement 不是：

```text
Steam 弹杯
```

而是：

# 广度成长系统。

---

# 51. 为什么后期必须增加横向目标

纯纵向成长：

```text
Lv150 →151
```

会越来越慢。

如果没有：

```text
Collection
Bestiary
Achievement
Guild
```

玩家会感觉：

> 几天没有任何新东西。

横向目标让同样 24 小时可以同时推进：

```text
XP
Coin
Collection
Bestiary
Achievement
Guild XP
```

玩家实际获得的“进度事件”数量变多。

---

# 52. Guild 在 2026 已经从社交系统变成长期成长系统

当前 Guild 每周：

```text
4 Skilling Trial
+
2 Combat Trial
```

成员报名：

```text
1 Skilling
+
1 Combat
```

Trial：

```text
不打断正常 Action
不消耗原 Consumable
使用 Loadout Snapshot
```

---

# 53. 为什么 Guild Trial 设计很适合 Endgame

因为它：

```text
要求 Build
要求 Guild
要求周目标
```

但不会：

```text
抢走玩家正常挂机时间
```

因此玩家不会觉得：

> “为了参加宗门活动，我必须停止自己原本的成长。”

这是 Idle MMO 非常关键的设计。

---

# 54. Guild Trial 的难度阶梯

当前：

```text
Lv100 起
每 Tier +10
最高 Lv300
```

形成：

```text
100
110
120
...
300
```

长期阶梯。

Guild 每周都可以重新验证：

> 我们现在能爬到哪里？

这是一个很稳定的周留存目标。

---

# 55. Guild Building 再提供长期组织成长

当前：

```text
23 Buildings
每栋最高 Lv20
```

Guild 产生：

```text
Guild Points
```

再投资：

```text
成员容量
Trial收益
Trial能力
Guild XP...
```

形成：

```text
个人成长
↓
贡献
↓
组织成长
↓
帮助个人
```

闭环。

---

# 56. Shrine 又把 Guild 成长连接回个人

5 个 Shrine：

```text
Force
Tempo
Spirit
Rarity
Scholar
```

提供永久个人 Buff。

因此：

```text
我帮助宗门
```

最终不是纯荣誉。

而是：

```text
我的长期角色也会更强
```

---

# 57. Guild 设计中的关键：个人进度不会被公会吞掉

Guild Buff：

```text
跟角色走
```

但：

```text
受到当前 Guild Shrine 等级上限限制
离开 Guild 后不生效
```

这种设计：

- 保留个人投入
- 同时保持组织价值

非常适合长期 MMO。

---

# 58. 市场是贯穿所有阶段的“动态内容生成器”

开发者不可能每天设计新配方。

但市场每天都可以发生：

```text
某材料涨价
某装备跌价
某 Consumable 缺货
某新内容推高旧材料
```

所以 Marketplace 本身就是：

# Procedural Meta Content

不需要开发者手工做关卡。

玩家经济自己制造目标。

---

# 59. 市场改变玩家每天登录的原因

纯 Idle：

```text
我回来看看数字涨了多少
```

MWI Standard：

```text
我的商品卖了吗？
价格变了吗？
现在最赚钱的 Action 是什么？
我要不要转职业？
新版本让什么东西涨价了？
```

这明显提高了 Daily Check-in 的信息价值。

---

# 60. 外部工具生态反过来证明系统已经足够深

截至 2026 年，社区已有：

```text
市场价格历史
Crafting Profit Calculator
Alchemy Calculator
Enhancing Calculator
Combat Simulator
Gear Compare
Guild Trial Sync
Item Time Cost
DPS Meter
```

这意味着 MWI 已经从：

```text
简单挂机
```

发展成：

# 可被玩家“研究”的游戏。

对于我们的项目，这是非常重要的目标。

---

# 61. 好的长期游戏应该允许玩家“研究”，但不能强迫新人研究

MWI 最明显的问题之一：

专业玩家会喜欢：

```text
利润计算
Build
市场
Simulation
```

但新玩家看到这些会害怕。

所以最合理的结构是：

```text
前期：
隐藏复杂度

中期：
展示比较

后期：
允许深度分析
```

这应该成为我们 UI 的核心原则。

---

# 62. MWI 的玩家目标结构

可以拆成六种时间尺度。

## 秒级

```text
Action Progress
```

## 分钟级

```text
Item / XP
```

## 小时级

```text
Skill Level
Queue Completed
Task
```

## 天级

```text
Tool
Gear
Pouch
Ability
```

## 周级

```text
House
Guild Trial
Enhancement Project
```

## 月级+

```text
Lv150+
High Enhancement
Collection
Bestiary
Shrine
Endgame Dungeon
```

---

# 63. 这是为什么 MWI 不需要“体力值”

普通手游通过：

```text
体力
每日任务
活动时间
```

控制节奏。

MWI 通过：

```text
真实时间
XP Curve
Action Time
材料投入
市场
```

自然控制。

玩家随时可以继续玩。

但主动点击并不能无限加速。

---

# 64. “低主动收益”是 MWI 留存设计的重要部分

官方和玩家都反复强调：

```text
VERY Idle
```

长时间盯着游戏：

不会获得巨大优势。

这会让玩家形成：

```text
安排好
↓
退出
↓
回来检查
```

健康循环。

---

# 65. 我们修仙版绝对不要做成“挂机 + 强迫点红点”

如果核心卖点是：

# 闭关

那么游戏就必须尊重：

```text
离线
```

不能出现：

```text
每小时领取
每两小时登录
必须手动点丹炉
错过世界Boss亏一天
```

否则题材和系统互相矛盾。

---

# 66. MWI 的 Day X 无法简单复制

这一点必须明确。

因为 Standard 玩家可以：

```text
市场直接购买
```

Ironcow：

```text
必须自己做
```

同时每个玩家选择技能不同。

因此：

```text
Day 3 = TLxxx
```

不是固定事实。

---

# 67. 更合理的时间轴：体验阶段，而不是日历阶段

我们应该把 MWI 逆向成：

```text
Experience Phase
```

而不是：

```text
Day Phase
```

然后再为自己的修仙版主动设定目标时间。

---

# 68. 观察到的现实时间样本

目前社区可看到：

### 样本 A

有玩家描述：

```text
前 1～2 天
Total Level 提升非常快
接近 TL500 后明显变慢
```

只能视为主观样本。

### 样本 B

Reddit 中有 Ironcow 玩家展示：

```text
约 1 年
TL1714
```

Ironcow 本身又明显比 Standard 更慢。

这些数据说明：

> MWI 的成长跨度确实是“天 → 月 → 年”，而不是 30 天毕业。

---

# 69. 逆向出的玩家心理变化

## Stage 1

```text
“我能做什么？”
```

## Stage 2

```text
“哪个技能应该先升级？”
```

## Stage 3

```text
“我怎样效率更高？”
```

## Stage 4

```text
“我要专精什么？”
```

## Stage 5

```text
“这个 Build 能打什么？”
```

## Stage 6

```text
“我的资源应该投哪里？”
```

## Stage 7

```text
“我们 Guild 能爬到哪里？”
```

这是一条非常成熟的认知成长曲线。

---

# 70. 对我们修仙版最重要的迁移：境界应该成为“体验阶段标签”

MWI 的一个弱点是：

```text
TL250
TL500
TL750
```

虽然功能有效，

但缺乏世界观意义。

修仙题材天然可以解决。

例如：

```text
凡人
炼气
筑基
金丹
元婴
化神
```

玩家一眼就知道：

# 我处于哪个人生阶段。

---

# 71. 建议我们的阶段映射

不是最终数值，仅作为系统结构建议：

| MWI阶段 | 修仙阶段 |
|---|---|
| Tutorial | 初入仙途 |
| TL0–250 | 炼气前期 |
| TL250–500 | 炼气中期 |
| TL500–750 | 炼气后期 / 大圆满 |
| TL750–1000 | 筑基 |
| TL1000–1250 | 金丹 |
| TL1250+ | 元婴及以后 |
| Endgame | 化神 / 更高境界 |

关键不是数字对应。

而是：

```text
一个境界
=
一组新的认知复杂度
```

---

# 72. 初入仙途：只开放三个核心概念

建议我们的前 30 分钟：

```text
修炼
采药
炼丹
```

不要同时开放：

```text
炼器
阵法
符箓
灵兽
坊市K线
宗门
秘境
淬炼
```

玩家需要先理解：

```text
时间
↓
材料
↓
加工
↓
成长
```

---

# 73. 炼气期的核心目标应该类似 Giant Pouch

我们也需要一个：

# 全账号、跨系统、强感知

的新手毕业奖励。

例如：

```text
正式建立洞府
```

或：

```text
开辟丹田
```

奖励：

```text
+1 闭关计划槽
+1 丹药 Buff 槽
+洞府功能
+坊市高级功能
```

这样比：

```text
送一把紫色剑
```

更有意义。

---

# 74. 修仙版的“Pouch”可以变成经脉 / 丹田 / 洞府槽位

MWI 用 Pouch 控制：

```text
Consumable Slot
```

我们的修仙版可以做：

```text
丹田容量
经脉
药力槽
洞府阵眼
```

例如：

炼气：

```text
同时维持 1 种丹药 Buff
```

筑基：

```text
2 种
```

金丹：

```text
3 种
```

通过世界观包装自然增加 Build 复杂度。

---

# 75. 新系统应该遵循“三步开放”

MWI 的经验说明，系统不要：

```text
解锁
=
马上要求玩家精通
```

建议我们采用：

## Step 1：看见

玩家知道系统存在。

## Step 2：体验

任务带玩家做一次。

## Step 3：优化

很久以后才展示：

```text
利润/h
成功率
高级配装
```

这样复杂游戏也可以很易上手。

---

# 76. 修仙版的高级秘境应该模仿 Labyrinth 的门槛逻辑

例如：

# 古修洞府

不应该玩家炼气期就可以进去看满屏：

```text
阵法
路线
Buff
机关
多 Loadout
```

应该在：

```text
筑基 / 金丹
```

并确保玩家已经理解：

```text
战斗
炼丹
装备
行动队列
```

以后再开放。

高级系统应该是：

# 前面知识的综合考试。

---

# 77. 修仙版高级成长也应该给予“自动化权”

建议：

```text
炼气：
手动安排闭关

筑基：
多行动队列

金丹：
自动补充丹药

元婴：
自动购买缺少材料

化神：
洞府管家 / 分身执行第二行动

大乘：
自动策略模板
```

玩家得到的不只是：

```text
数值更大
```

而是：

# 管理能力升级。

---

# 78. 生产职业何时开始专业化

不要开局要求：

```text
你选丹师 / 器师
```

MWI 的经验说明：

先让玩家体验各类技能。

然后再通过：

```text
技能投入
装备
市场利润
```

自然形成专业化。

我们的设计：

```text
人人都能炼丹
↓
有人投入炼丹技能 / 丹炉 / 洞府
↓
他的成本变低、珍品率变高
↓
自然成为丹师
```

比职业锁定更好。

---

# 79. 不要设置不可逆职业

MWI 的 Classless / Skill-based 结构的巨大优势：

```text
市场变了
Meta变了
玩家腻了
```

都可以：

```text
换装备
换 Action
换 Build
```

而不用：

```text
删号重练
```

对于一个运营数年的游戏非常重要。

---

# 80. 玩家市场的复杂数据应该分阶段出现

建议修仙版：

## 新手坊市

只展示：

```text
售价
买入
出售
```

## 筑基

增加：

```text
买一 / 卖一
成交量
```

## 金丹+

增加：

```text
历史价格
利润计算
制作成本
价格预警
```

让市场 UI 跟玩家认知一起成长。

---

# 81. 任务系统不应该变成每日打卡

MWI 的任务：

```text
不需要传统日常限时
```

这符合 Idle。

我们的修仙版也建议：

```text
修行目标
```

而不是：

```text
每日炼丹10次
每日登录1次
每日PVP3次
```

否则玩家从“规划人生”变成“上班”。

---

# 82. 推荐我们的目标系统结构

### 主目标

```text
突破筑基
```

### 系统自动拆解

```text
修为 82%
筑基丹 0/1
经脉 18/20
灵髓 2/3
```

### 点击材料

显示：

```text
自己采集
自己炼制
秘境掉落
坊市购买
```

这会天然替代大量繁琐 Quest。

---

# 83. 这是 MWI 最值得我们改进的地方

MWI 的长期目标很多来自：

```text
玩家自己研究
```

这是深度来源。

也是门槛来源。

修仙版有“突破境界”这个天然主线以后：

可以做到：

```text
系统负责告诉你“为什么”
玩家负责决定“怎么做”
```

这会比完全自由更容易留新人。

---

# 84. 我们自己的推荐体验节奏 V0.1

这不是 MWI 原始数据，而是基于逆向结论给我们项目的第一版建议。

## 前 10 分钟

```text
修炼
采药
基础行动队列
```

## 10～30 分钟

```text
炼丹
背包
装备
第一件工具
```

## 30～60 分钟

```text
第一场妖兽战斗
目标追踪
坊市基础交易
```

## Day 1

核心目标：

```text
炼气中期
第一次理解：
采药 → 丹药 → 修炼效率
```

## Day 3

```text
炼器
挖矿
更高级 Action Queue
装备强化初步
```

## Day 7

```text
炼气大圆满
准备第一次重大突破
```

## 第一次大节点

```text
筑基
```

奖励必须是机制型：

```text
新的 Buff 槽
新的地图
新的百艺 Tier
新的队列能力
秘境
```

而不是单纯：

```text
战力 +30%
```

---

# 85. Day 7～30：进入真正专业化

玩家开始决定：

```text
丹师
器师
剑修
符师
商人
采集型
```

但不做永久职业锁。

依赖：

```text
技能等级
装备
洞府设施
市场资产
```

形成。

---

# 86. Day 30+：进入异步 MMO

逐渐开放：

```text
宗门
宗门建设
宗门试炼
组队秘境
高阶坊市
排行榜
```

不要 Day 1 就把玩家拖进 Guild。

玩家需要先：

# 建立自己的角色身份

再去参与社会。

---

# 87. 90 天+：永久成长

重点：

```text
洞府
法宝淬炼
功法
收藏
妖兽图鉴
宗门神坛
高级秘境
市场资本
```

这一阶段必须同时存在：

```text
纵向目标
+
横向目标
```

---

# 88. 我们需要复制 MWI 的“多个终点”

一个长期玩家不能只有：

```text
最高境界
```

还应该可以追：

```text
炼丹第一
最有钱
装备最强
图鉴最多
妖兽击杀
宗门贡献
秘境深度
炼器等级
```

这会产生不同玩家身份。

---

# 89. 长期多人游戏的核心是“身份”

MWI 后期玩家会变成：

```text
Gatherer
Brewer
Combat Player
Market Trader
Ironcow
Guild Player
Collector
```

我们的修仙版更应该强化：

```text
剑修
丹师
器师
符师
阵师
商会玩家
散修
宗门长老
收藏党
```

身份越明确：

玩家越容易产生长期情感投入。

---

# 90. 逆向出的内容设计公式

一个新的中高阶内容最好同时满足：

```text
新需求
+
新资源
+
新 Sink
+
新 Build
+
旧资源重新有价值
```

例如 MWI 的 Guild Expansion：

```text
新增 Guild Trial
↓
需要角色 Build

新增 Buildings
↓
消耗 Guild Point

新增 Shrine
↓
消耗 Token / Credit

Guild Credit
↓
要求玩家上交大量旧物资
```

这是优秀版本更新的标准模板。

---

# 91. 新版本不能只添加“更高等级材料”

最差的更新：

```text
玄铁 T10
↓
玄铁 T11
```

好的更新：

```text
新秘境
↓
产生新资源
↓
可强化旧法宝
↓
旧材料成为门票 / 消耗
↓
新的市场需求
↓
新的宗门目标
```

让新系统重新连接旧经济。

---

# 92. 玩家回流设计

MWI 的 Collection / Bestiary / Achievement 等系统会让：

```text
过去做过的内容
```

重新拥有意义。

我们未来版本也应该：

尽量 Retroactive 或部分 Retroactive，

避免老玩家感觉：

> “我以前刷的所有东西都白刷了。”

但也要保留：

```text
新目标
```

让玩家重新参与。

---

# 93. MWI 暴露出的成长问题

我们不能只学优点。

## 问题 1：新人系统信息量大

早期开发者已经收到：

```text
技能很多
不知道为什么练
```

反馈。

### 我们的解决方案

境界主线 + 目标追踪。

---

## 问题 2：新手结束很慢

MWI 把：

```text
TL750
```

都视为 Beginner Phase。

对于核心玩家可以。

但更大众化的产品：

需要更早提供“大事件”。

### 我们的解决方案

```text
炼气小突破
```

频繁反馈，

同时保留：

```text
筑基
```

作为第一大节点。

---

## 问题 3：高阶多人可能让单人玩家产生压力

社区对 MWI 的一个争议：

```text
部分高阶 Combat / Dungeon
多人效率明显更高
```

有玩家因为不想 Guild / Party 而退出。

### 我们的解决方案

多人：

```text
效率更高 / 奖励更好
```

但核心内容尽可能：

```text
Solo 仍能完成
```

不要让社交成为强制上班。

---

## 问题 4：市场对 Standard 太重要

自由市场是优势。

但也意味着：

```text
价格波动
P2W担忧
工作室
市场操纵
```

都直接影响成长。

### 我们的解决方案

从第一天就设计：

```text
税
交易限制
反小号
价格历史
系统回收价
资源 Sink
```

而不是上线后再补。

---

# 94. 最终玩家成长骨架

Milky Way Idle 的实际成长可以浓缩为：

```text
【发现】
我可以让角色自己干活
↓
【理解】
资源之间是互相关联的
↓
【优化】
工具和 Buff 可以提高时间价值
↓
【毕业】
TL750 / Giant Pouch
↓
【身份】
我决定主要做什么
↓
【Build】
Gear + Consumable + Skill
↓
【挑战】
Combat / Dungeon / Labyrinth
↓
【资本】
House / Enhancing / Marketplace
↓
【社会】
Guild / Trial
↓
【长期身份】
Collector / Trader / Specialist / Endgame Player
```

---

# 95. 对修仙项目的最终迁移模型

建议我们做成：

```text
【初入仙途】
学会闭关
↓
【炼气】
学会采集和炼丹
↓
【炼气中后期】
学会炼器、装备、坊市
↓
【筑基】
第一次全账号机制升级
↓
【金丹】
专业化 + Build + 秘境
↓
【元婴】
高级自动化 + 宗门 + 多人
↓
【化神】
洞府资产 + 法宝长期强化
↓
【更高境界】
社会身份 + 经济身份 + 收藏身份
```

其中：

# 境界 = 内容复杂度门槛

而不仅是：

```text
攻击力倍率
```

---

# 96. 我们项目下一步应该做什么

完成：

```text
V1 系统骨架
V2 数值骨架
V3 玩家成长骨架
```

以后，现在已经不应该继续盲目研究 MWI。

下一步应该正式开始：

# 《修仙项目核心系统设计 GDD V0.1》

并建立以下 5 张母表：

## 表 1：Feature Unlock Matrix

```text
功能
首次看见
首次使用
正式开放
高级功能开放
```

## 表 2：Realm Progression

```text
境界
目标时间
主要系统
主要资源
Boss
突破条件
```

## 表 3：Player Goal Ladder

```text
10分钟
1小时
1天
3天
7天
30天
90天
180天
365天
```

## 表 4：Economy Dependency Graph

```text
采集
生产
消耗
装备
突破
市场
Sink
```

## 表 5：Complexity Budget

每个阶段限制：

```text
一级菜单数量
资源数量
Buff数量
装备槽数量
可同时追踪目标数量
```

防止系统越做越乱。

---

# 97. 我认为我们自己的第一个大节点应该是什么

不建议：

```text
角色 Lv10
```

建议：

# 筑基

因为它天然拥有：

```text
世界观意义
明确视觉反馈
长期期待
系统升级理由
```

第一次筑基应该相当于 MWI：

```text
TL750
+
Giant Pouch
+
Beginner Graduation
```

的组合价值。

---

# 98. 筑基应该解锁什么

建议：

```text
+1 丹药 Buff 槽
+1 行动队列槽
新的筑基地图
二阶灵药 / 灵矿
真正的秘境
法器系统升级
新的功法槽
更高级坊市信息
```

让玩家感觉：

> 不是数值变大，而是我真的进入了一个新的修仙阶段。

---

# 99. 最重要的设计原则总结

从 MWI 玩家成长体系中，可以提炼出 12 条原则：

1. **先让玩家理解时间，再让玩家理解战力。**
2. **先让玩家学一条生产链，再开放整个经济。**
3. **工具节点负责制造阶段性反馈。**
4. **总进度节点负责控制系统复杂度。**
5. **Consumable Slot 是很好的 Build 深度调节器。**
6. **新手阶段先广度成长，中期才鼓励专业化。**
7. **高级系统必须是前面知识的综合考试。**
8. **成长应该逐步奖励更多自动化能力。**
9. **多人系统不能打断挂机。**
10. **后期必须同时有纵向和横向目标。**
11. **市场本身就是动态内容生成器。**
12. **长期玩家最终追求的是身份，不只是等级。**

---

# 100. 最终结论

V1 逆向告诉我们：

```text
游戏有什么系统
```

V2 告诉我们：

```text
这些系统怎么算
```

而 V3 最重要的结论是：

# 不应该把整个游戏一次性交给玩家。

MWI 真正有效的成长方式是：

```text
简单决策
↓
建立理解
↓
增加一个变量
↓
建立新目标
↓
再增加系统
```

一个复杂 Idle MMO 的正确设计不是：

> “系统很多，所以耐玩。”

而是：

> **玩家每进入一个新阶段，才刚好有能力理解下一层复杂度。**

对于我们的修仙版来说：

# “境界”

正好可以成为比 Milky Way Idle 的 Total Level 更优秀的系统复杂度导航。

所以后续所有功能都应该先问：

```text
这个系统属于哪个境界？
玩家在此之前已经学会了什么？
这个系统新增了几个决策变量？
它解决玩家当前阶段的什么问题？
它会把玩家送往哪个下一目标？
```

只要这五个问题一直成立，我们的系统即使最终非常复杂，玩家也不会觉得一开始就像在看后台管理系统。

---

# 附录 A：关键成长门槛

| 节点 | 当前信息 | 设计意义 |
|---|---|---|
| Tutorial | 初步教学 | 理解 Idle / Action |
| Tool Lv1/10/20/35/50/65/80… | 工具 Tier | 连续 XP 中插入阶段奖励 |
| TL250 | Medium Pouch | Consumable Build 开始增长 |
| TL500 | Large Pouch | Buff 组合进一步增强 |
| TL750 | Giant Pouch | Wiki 定义的新手阶段终点 |
| TL750+ | 社区普遍推荐正式 Combat | 从广度成长进入 Build |
| TL1000 | Labyrinth | 官方复杂高阶系统硬门槛 |
| TL1250 | Gluttonous/Guzzling Pouch | 后期 Consumable Build |
| Skill Lv100+ | 高阶技能阶段 | 长周期成长 |
| Skill Lv150+ | 高等级聊天/成就等可见里程碑 | Endgame 身份反馈 |
| Skill Lv200 | 技能上限 | 超长期目标 |

---

# 附录 B：MWI → 修仙版建议映射

| Milky Way Idle | 修仙版 |
|---|---|
| Total Level | 境界 + 百艺总修为 |
| Action Queue | 闭关计划 |
| Tool | 采集法器 / 丹炉 / 器炉 |
| Food / Drink Slot | 丹药药力槽 / 状态槽 |
| Pouch | 丹田 / 经脉 / 洞府设施 |
| Gathering | 采药 / 挖矿 / 伐灵木 |
| Production | 炼丹 / 炼器 / 制符 |
| Marketplace | 坊市 |
| Combat | 历练 |
| Dungeon | 秘境 |
| Labyrinth | 上古遗迹 / 古修洞府 |
| Housing | 洞府 |
| Guild | 宗门 |
| Guild Trial | 宗门试炼 |
| Enhancing | 淬炼 |
| Refinement | 法宝升阶 |
| Collection | 天材地宝图鉴 |
| Bestiary | 妖兽志 |
| Achievement Tier | 天道成就 |
| Ability | 功法 / 神通 |
| Charm | 修炼法门 / 玉佩 / 道心侧重点 |

---

# 附录 C：建议我们的功能释放矩阵雏形

| 系统 | 初入仙途 | 炼气 | 筑基 | 金丹 | 元婴+ |
|---|---|---|---|---|---|
| 修炼 | ✓ | 深化 | 深化 | 深化 | 深化 |
| 采药 | ✓ | ✓ | 高阶资源 | 高阶资源 | 高阶资源 |
| 炼丹 | 基础 | ✓ | 二阶 | 高阶 | 稀有丹 |
| 挖矿 |  | ✓ | ✓ | 高阶 | 高阶 |
| 炼器 |  | 基础 | ✓ | 深化 | 法宝 |
| 行动队列 | 1槽 | 2槽 | 3槽 | 条件队列 | 自动策略 |
| 坊市 | 基础 | 基础 | 深度信息 | 价格历史 | 商业玩法 |
| 战斗 | 体验 | 基础 | Build | 高阶 | 多流派 |
| 秘境 |  | 小秘境 | ✓ | 高阶 | 遗迹 |
| 洞府 |  | 初建 | 升级 | 专精 | 自动化 |
| 宗门 |  | 看见 | 加入 | 试炼 | 建设 |
| 多人 |  |  | 弱多人 | 组队 | 宗门协作 |
| 收藏 |  |  | 开始 | 深化 | Endgame |
| 自动化 | 基础 | 队列 | 补给 | 策略 | 分身/管家 |

---

# 附录 D：资料来源

## 官方 / 一手来源

### [S1] Milky Way Idle Steam / 官方新闻
https://steamcommunity.com/app/3224420/allnews/

用于确认：

- 2026 Guild Expansion
- Guild Trial 结构
- 23 Buildings / 5 Shrines
- Trial 不打断正常 Action
- Labyrinth TL1000 门槛及官方设计原因
- Labyrinth Automation
- Combat Rework
- Marketplace 官方数据更新

### [S2] Milky Way Idle Steam 商店
https://store.steampowered.com/app/3224420/Milky_Way_Idle/

用于确认：

- Multiplayer Idle RPG 定位
- Action Queue
- Offline Progress
- Marketplace
- Party / Guild 等主要功能

---

## Wiki.gg

### [S3] Beginner Guide
https://milkywayidle.wiki.gg/wiki/Milkyway_Idle_Beginner_Guide

关键点：

- Beginner's Phase 明确以 TL750 为目标
- 早期技能路线
- Tool 等级节点
- Standard / Ironcow 差别
- Consumable / Combat 前置思路

### [S4] Guides
https://milkywayidle.wiki.gg/wiki/Guides

用于确认：

- Beginner Guide 是完整 TL750 路线
- 后续进入技能专业化和 Combat Guide

### [S5] Total Level
https://milkywayidle.wiki.gg/wiki/Total_Level

关键门槛：

- Medium Pouch TL250
- Large Pouch TL500
- Giant Pouch TL750
- Gluttonous / Guzzling Pouch TL1250

### [S6] Tools
https://milkywayidle.wiki.gg/wiki/Tools

用于确认：

- Tools 为非战斗技能提高 Action Speed
- 存在长期 Tier Progression
- 高阶工具继续延伸到 65 / 80 / 90 等级

### [S7] Nature Mage Beginner Guide
https://milkywayidle.wiki.gg/wiki/Nature_Mage_Beginners%27_Guide

关键点：

- 推荐先达到 TL750 + 一定资金，再正式投入 Combat Build

### [S8] Bow to the Milkyway
https://milkywayidle.wiki.gg/wiki/Bow_to_the_Milkyway

关键点：

- 同样建议 Combat 前先完成 TL750 Beginner Phase

### [S9] Items
https://milkywayidle.wiki.gg/wiki/Items

确认当前物品类别：

- Currencies
- Food
- Drink
- Equipment
- Tools
- Ability Books
- Resources 等

---

## 社区攻略 / 玩家样本

### [S10] GrindnStrat - Milky Way Idle Guide 2025
https://grindnstrat.com/milky-way-idle-guide/

关键观察：

- Pouch 250 / 500 / 750 阶梯
- Giant Pouch 被视为新手重大目标
- 建议核心全局升级优先于 House
- Tool 是时间效率的骨架

### [S11] Reddit - Early Tips
https://www.reddit.com/r/MilkyWayIdle/comments/1ktxzp4/early_tips/

用于观察：

- Standard 玩家早期专业化
- Foraging / Cooking 等实际市场路线
- “睡觉挂机”玩家如何选择 Action

### [S12] Reddit - Positive Review
https://www.reddit.com/r/incremental_games/comments/170wc3r/holy_cow_a_positive_review_of_milky_way_idle/

关键观察：

- 游戏目标是开放式、自定义目标
- Market 引入 Opportunity Cost / Comparative Advantage
- 玩家通过 Action 编排实现目标

### [S13] Reddit - Early Access Discussion
https://www.reddit.com/r/incremental_games/comments/1j5k2ev/milky_way_idle_has_released_in_early_access_on/

用于观察：

- 高阶多人内容对 Solo 玩家可能形成压力
- 游戏高度 Idle
- 多数内容可 Solo，高阶内容开始体现 Party

### [S14] Reddit - MWI 社区页
https://www.reddit.com/r/MilkyWayIdle/

用于观察：

- 有 Ironcow 玩家约一年 TL1714 的长期样本
- Endgame 玩家关注 Gear / Guild / Market / Collection 等长期系统

### [S15] MilkyWay Market
https://milkyway.market/

用于确认当前外部 Meta 工具生态：

- Market History
- Crafting Profit
- Enhancing Calculator
- Alchemy Calculator
- Rankings

---

# 附录 E：资料中必须注意的版本问题

MWI 仍处于持续更新。

尤其：

```text
Combat
Guild
Labyrinth
Marketplace
```

在 2025～2026 发生过重要改版。

因此：

- 2024 年以前的 Combat Guide 不应直接拿来作为当前公式依据。
- 某些旧攻略的 Pouch / Gear 成本可能发生变动。
- 社区“Day X 达到什么等级”不具有官方保证意义。
- 本文强调的是 **成长结构与解锁逻辑**，而不是把某个玩家的速度当固定时间表。

---

# 附录 F：下一份应该产出的内部设计文档

完成 V3 后，建议不再继续单纯逆向 Milky Way Idle。

下一步正式进入我们自己的：

# 《修仙 Idle MMO 核心游戏设计 GDD V0.1》

建议章节：

```text
1. 产品定位
2. 核心幻想
3. 玩家生命周期
4. 境界体系
5. Feature Unlock Matrix
6. 闭关 Action Queue
7. 修仙百艺
8. 生产资源树
9. 战斗 Build
10. 秘境
11. 坊市
12. 洞府
13. 宗门
14. 长期 Collection
15. 经济 Faucet / Sink
16. Day1 / Day7 / Day30 / Day90
17. UI 信息架构
18. MVP 范围
```

V1 + V2 + V3 目前已经足够作为这份正式 GDD 的竞品研究基础。
