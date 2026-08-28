# 《洞天》内容包 Schema 扩展规格 V1（草药品种 / 丹方绑定 / 怪物实例）

> 立项目的：为物品系统扩展提供内容包层面的字段与校验规格。本文档为**产品确认前的草案**，确认后按"运行时口径 → API 契约 → 实现"顺序落地；未确认前不修改任何代码。
>
> 上位约束：冻结参数表（DT-NUM-20260827-01）、内容包发布审计（content SHA）、单行动规则 `global_single_slot_v1` 均不变。

## 一、草药品种（herb varieties）

### 内容字段

`maps.json` 普通地图新增 `herb_varieties` 字段（可选数组，仅产草药的地图配置）：

```json
"herb_varieties": [
  { "herb_id": "herb.zi_yun_hua", "display_name": "紫云花", "weight": 60 },
  { "herb_id": "herb.ning_lu_cao", "display_name": "凝露草", "weight": 40 }
]
```

校验规则：weight 合计 100、herb_id 全局唯一、`display_name` 非空。百草谷绑定以上两种；黑风谷/赤炎洞随扩展再增（金环蛇信/赤炎芝等，字段同构）。

### 结算语义（提案）

采药挂机结算时按 weight 随机产出对应品种——**品种作为独立资源 ID 进入背包**（`herb.zi_yun_hua` 等），或作为 `spirit_herb` 的子类型标记（见"开放问题"）。

## 二、丹方↔草药绑定（recipes.json）

`RecipeContent` 新增可选 `herb_varieties` 字段（仅 alchemy_room 配方）：

```json
"herb_varieties": [{ "herb_id": "herb.zi_yun_hua" }]
```

校验：引用的 herb_id 必须在某张地图的产出列表中（可达性校验，同 equipment_drop 模式）。**未声明该字段的丹方维持现状**（接受任意 `spirit_herb`），兼容旧存档。

### 新丹方（随本扩展首发，status=content_pending 走发布流程）

| 丹方 | 绑定草药 | 产出 | 数值待冻结 |
| --- | --- | --- | --- |
| 紫云丹 | 紫云花 | 丹药（突破材料，同聚气丹定位） | 是 |
| 凝露散 | 凝露草 | 战斗用丹（挂机中自动使用，机制待冻结） | 是 |

## 三、怪物实例（monster instances）

`maps.json` 每张普通地图新增 `monsters` 字段：

```json
"monsters": [
  { "monster_id": "monster.bai_cao_valley.yao_lang", "display_name": "妖狼", "weight": 70 },
  { "monster_id": "monster.bai_cao_valley.du_xie", "display_name": "毒蝎", "weight": 30 }
]
```

结算语义（提案）：击杀结算时按 weight 选怪，仅影响战报文案与图鉴收集；**战斗数值仍走地图级 enemy 参数**（不改战斗平衡）。图鉴收集状态入 collection 域。

## 四、需要同步的实装清单（确认后执行）

1. `content-schema.ts`：canonical 白名单 + 校验规则（上述三字段）
2. `service.ts`：采药/结算产出的品种判定；collection 新增 monsterSeen 集合
3. 前端：采集地图卡显示品种列表；炼丹房按草药过滤丹方；图鉴页加怪物收集区
4. Ruby 验证器：新增品种可达性验证器（1 个）
5. 品种资源 ID 方案二选一（开放问题，见下）

## 五、开放问题（需产品拍板）

1. **品种资源方案**：独立资源 ID（背包分格显示，改动大、UI 自洽）vs `spirit_herb` 子类型标记（改动小、背包仍合并计数）
2. 炼丹消耗是否区分品种单价（紫云花 2/批 vs 凝露草 3/批），还是统一价
3. 怪物图鉴是否计入排行榜"收藏榜"

## 六、不做在本次扩展

- 装备命名池扩展（独立内容批次）
- 怪物独立战斗数值（战斗平衡另立变更号）
- 丹方品种单价差异（依赖开放问题 1）

## 七、产品拍板结论（2026-08-28）

1. 品种资源方案：**独立资源 ID**（每个草药品种/每种丹药均为独立 ResourceId，背包分格）
2. 丹方↔草药：**严格一对一**（不同草药不能炼同一丹药）
3. 丹药产出品质：**随机**，受炼丹等级影响——炼丹等级越高高品质权重越大（权重表待冻结，作为本扩展的配套数值变更）
4. 怪物图鉴：**不进入收藏榜**（仅图鉴展示）

状态更新为 `confirmed_pending_implementation`，按第四节清单一批实装。新增冻结参数（品质权重表、炼丹等级权重曲线、新品种库存上限）需同步 CSV/frozen-parameters/manifest/Ruby 验证器，随实装一并提交。
