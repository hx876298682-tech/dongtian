# 《洞天》API 契约、状态码与幂等规范 V1.0

## 1. 协议基线

- HTTPS + JSON，路径前缀 `/api/v1`。
- 时间使用 ISO 8601 UTC，例如 `2026-08-15T14:00:00.000Z`。
- 数量、等级、槽位使用整数；高精度修为 / XP / 价格在 JSON 中使用十进制字符串，避免客户端浮点误差。
- 响应包含 `request_id`、`server_time`、`state_version`（涉及角色时）和 `config_version`。
- 写操作使用 `Idempotency-Key` 请求头；资源编辑同时带预期版本。
- API 不接受客户端结算结果、当前时间、掉落结果或余额。

## 2. 通用响应

成功：

```json
{
  "data": {},
  "meta": {
    "request_id": "0198...",
    "server_time": "2026-08-15T14:00:00.000Z",
    "state_version": 42,
    "config_version": "2026.08.15.1"
  }
}
```

失败：

```json
{
  "error": {
    "code": "QUEUE_VERSION_CONFLICT",
    "message_key": "error.queue_version_conflict",
    "details": {
      "expected": 7,
      "actual": 8
    },
    "retryable": false
  },
  "meta": {
    "request_id": "0198...",
    "server_time": "2026-08-15T14:00:00.000Z"
  }
}
```

`message_key` 供客户端本地化；`details` 只能包含可安全展示或诊断的结构化信息。

## 3. HTTP 语义

| 状态 | 用途 |
|---:|---|
| 200 | 成功读取、幂等重放原响应 |
| 201 | 新实例创建成功 |
| 202 | 后台继续处理，例如超大结算 |
| 400 | 参数 / Schema 错误 |
| 401 | 未认证或会话失效 |
| 403 | 已认证但未解锁 / 无权限 |
| 404 | 资源不存在或不属于当前账号 |
| 409 | 版本冲突、状态冲突、幂等键复用 |
| 422 | 业务前置不足，如材料或机会不足 |
| 429 | 请求过快 |
| 503 | 维护或依赖暂不可用，可按 `Retry-After` 重试 |

## 4. 幂等规则

以下端点必须携带 `Idempotency-Key`：

- 队列保存 / 暂停 / 恢复。
- 使用丹药、换装预设。
- 秘境进入、选择、领取已完成结果。
- 突破开始 / 确认。
- 洞府建造 / 升级。
- 教程或目标产生资产奖励的领取。

服务端用账号、操作类型、键建立唯一约束。相同键与相同规范化请求体返回第一次的完整稳定响应；相同键与不同请求体返回 409 `IDEMPOTENCY_KEY_REUSED`。

## 5. 认证与账号 API

### `POST /auth/anonymous`

创建受控匿名测试账号和默认角色，设置安全会话 Cookie。设备已有匿名会话时幂等返回原账号。

### `POST /auth/register`

使用邮箱 / 用户名与密码创建正式账号；密码只传输给认证模块并使用强密码哈希存储。账号创建不直接信任客户端给出的角色资产。

### `POST /auth/login`

成功后轮换会话 ID 和 CSRF Token；失败使用统一错误，避免泄露账号是否存在。

### `POST /auth/anonymous/upgrade`

将当前匿名账号升级为正式账号，角色归属在单事务内迁移。若目标身份已有角色，MVP 拒绝自动合并并要求用户选择账号。

### `POST /auth/logout`

撤销当前会话并清除 Cookie；不删除角色或停止服务端时间推进。

### `GET /auth/session`

返回登录状态、账号摘要、CSRF Token 轮换信息和会话到期时间，不返回密码哈希或内部权限细节。

## 6. 启动与读取 API

### `GET /bootstrap`

客户端启动的最小聚合响应：账号摘要、角色摘要、功能权限、导航、配置清单版本、未读结算摘要 ID、维护和强制更新状态。不返回完整物品 / 配方配置。

### `GET /characters/{character_id}/dashboard`

返回：境界、修为、当前行动、队列摘要、今日 / 最近结算、目标追踪、洞府状态、灵石、秘境机会。读取前可触发轻量统一结算。

查询参数：`settle=true|false`，生产环境客户端通常使用 `true`；频繁轮询由服务端节流。

### `GET /characters/{character_id}/settlements/{settlement_id}`

返回完整离线摘要分段。只读，不再次产出。

### `GET /config/manifest`

返回公开配置版本、内容哈希、最小客户端版本和分包 URL / ETag。敏感风控配置不下发。

## 7. 闭关队列 API

### `POST /characters/{id}/queue/preview`

只做预测，不修改状态。请求：

```json
{
  "expected_queue_version": 7,
  "entries": [
    {
      "client_entry_id": "tmp-1",
      "action_id": "action.t1.herb_baicao_valley",
      "mode": "DURATION",
      "target_value": 7200,
      "on_blocked": "FALLBACK"
    },
    {
      "client_entry_id": "tmp-2",
      "action_id": "recipe.t1.qi_gathering_pill",
      "mode": "COUNT",
      "target_value": 100,
      "on_blocked": "FALLBACK"
    }
  ],
  "fallback": {
    "action_id": "action.cultivation.qi",
    "mode": "INFINITE"
  }
}
```

响应：预计总时长、每项可完成数量、材料缺口、预计产出、阻塞警告和快照假设。预测不构成收益承诺。

### `PUT /characters/{id}/queue`

请求体与预览相同，必须有幂等键。成功返回新 `queue_version`、当前周期接管时刻和标准化队列。

### `POST /characters/{id}/queue/pause`

暂停在当前周期边界生效；响应返回精确生效状态。MVP 不通过暂停绕过离线容量。

### `POST /characters/{id}/queue/resume`

恢复暂停或 `FALLBACK` 阻塞的队列。服务端先统一结算，重新校验被阻塞项输入；可用库存仍不足时返回 `ACTION_BLOCKED`，不停止当前保底行动。

### `GET /characters/{id}/queue`

返回当前项、周期进度、队列项、保底行动、阻塞原因、`queue_version` 和 `as_of`。

## 8. 库存、装备与丹药

### `GET /characters/{id}/inventory`

支持 `category`、`cursor`、`limit`；返回总数量、预留数量、可用数量和装备实例。不能依赖客户端本地缓存作为余额。

### `PUT /characters/{id}/loadouts/{preset_id}`

保存武器、防具、饰品和战斗补给预设；带 `expected_state_version`。装备合法性由服务端校验。

### `POST /characters/{id}/loadouts/{preset_id}/equip`

装备预设。当前闭关周期和已进入秘境使用旧快照；响应明确 `effective_next_cycle=true`。

### `POST /characters/{id}/buffs/use`

请求：`item_id`、数量、目标槽位、预期状态版本。响应返回实际 Buff、到期时间、被替换 Buff 和下周期生效信息。

### `POST /characters/{id}/equipment/{instance_id}/temper`

请求目标下一强化等级、是否使用保护材料。响应含随机审计引用、消耗、成功 / 失败、装备新状态；禁止客户端提交成功率结果。

## 9. 内容与计算预览

### `GET /actions`

返回当前角色可见行动及锁定原因；可按技能、境界和区域筛选。

### `GET /recipes`

返回可见配方、库存满足情况、当前耗时 / 产量预估和来源链接。

### `GET /characters/{id}/progression`

返回修为、境界阶段、百艺等级 / XP、下一等级与解锁预览。

所有预估响应必须返回 `calculation_as_of`、`config_version` 和主要修正明细。

## 10. 未来市场 API 命名预留（MVP 不实现）

以下路径仅用于锁定未来命名，MVP 不注册路由、不生成 Controller / Service、不创建数据库表，也不在 OpenAPI active document 中公开：

### `GET /market/quotes?item_ids=...`

未来用于报价读取；具体字段、价格模型和权限必须在市场专项 PRD 中重新批准。

### `POST /market/trades/preview`

未来用于交易预览；MVP 禁止调用。

### `POST /market/trades`

未来用于交易提交；幂等、报价保护和资产账本规则在专项立项时定义，MVP 禁止调用。

### `GET /characters/{id}/market-transactions`

未来用于个人交易历史；MVP 禁止调用。

## 11. 秘境 API

### `GET /characters/{id}/dungeon-opportunities`

返回当前次数、上限、下次恢复时间、封顶状态和教学赠送来源。

### `POST /dungeons/{dungeon_id}/preview`

请求角色和预设 ID；返回解锁、入场成本、推荐战力、成功率展示区间、节点预览、核心掉落和主要差距。

### `POST /characters/{id}/dungeon-runs`

创建并提交入场事务。请求：

```json
{
  "dungeon_id": "dungeon.t1.xuantie_cavern",
  "loadout_preset_id": "0198...",
  "strategy_preset_id": "strategy.safe",
  "initial_route_id": "route.left",
  "expected_state_version": 42,
  "config_version": "2026.08.15.1"
}
```

成功返回 201、`run_id`、状态、已扣成本、当前节点和运行快照摘要。

### `GET /dungeon-runs/{run_id}`

返回当前节点、战斗事件摘要、等待选择、截止时间或最终结果。重复读取不改变资产。

### `POST /dungeon-runs/{run_id}/choices`

提交 `choice_id` 与 `expected_run_version`。同一节点只能成功选择一次；重复相同幂等请求返回原结果。

### `POST /dungeon-runs/{run_id}/abandon`

只在允许节点放弃，返回已结算阶段奖励。机会和入场物不退。

### `GET /dungeon-runs/{run_id}/result`

返回胜负、耗时、节点、奖励、消耗、装备比较所需数据和账本事务 ID。结果在运行完成事务中已经入账，不需要额外“领取”才能继续游戏。

## 12. 境界与洞府 API

### `GET /characters/{id}/breakthroughs/next`

返回每个条件的当前值、要求、状态、来源入口和预计时间；只以服务端资产为准。

### `POST /characters/{id}/breakthroughs/preview`

返回将消耗的物品 / 灵石、试炼、成功率和解锁包，不修改资产。

### `POST /characters/{id}/breakthroughs`

创建 15 分钟突破试炼并预留条件资产，返回 `breakthrough_run_id` 和当前节点。若已有进行中试炼，返回现有运行；不得创建第二份预留。

### `GET /breakthrough-runs/{run_id}`

返回试炼节点、等待选择、预留资产、截止时间或最终结果。断线后以此恢复。

### `POST /breakthrough-runs/{run_id}/choices`

提交试炼选择，要求幂等键和 `expected_run_version`。MVP 的选择影响表现、临时战斗状态或额外评价，不把准备充分后的最终突破成功率降到 100%。

### `POST /breakthrough-runs/{run_id}/finalize`

在同一事务中永久扣除预留资产、提升境界、应用解锁包并写账本。若客户端重复提交且已完成，返回原成功响应；不重复扣除和解锁。

### `POST /breakthrough-runs/{run_id}/abandon`

释放预留资产并回到 `READY`。主动放弃不提升境界，不产生重复费用。

### `GET /characters/{id}/cave`

返回设施等级、建造状态、加成和下一等级成本。

### `POST /characters/{id}/cave/builds`

请求设施 ID、目标等级、预期版本；开始时扣除成本，返回完成时间。已在建造同一设施返回冲突。

## 13. 教程、目标与日志

- `GET /characters/{id}/goals`
- `PUT /characters/{id}/goals/tracked/{goal_id}`
- `GET /characters/{id}/tutorials/current`
- `POST /characters/{id}/tutorials/{tutorial_id}/steps/{step_id}/complete`
- `GET /characters/{id}/activity-log`

教程完成端点只记录可由服务端验证的动作结果；发奖型步骤必须幂等并写账本。

## 14. 错误码

| 错误码 | HTTP | 客户端处理 |
|---|---:|---|
| `VALIDATION_ERROR` | 400 | 标记具体字段 |
| `AUTH_REQUIRED` | 401 | 重新登录 |
| `CLIENT_VERSION_UNSUPPORTED` | 403 | 强制更新页 |
| `FEATURE_LOCKED` | 403 | 展示解锁条件 |
| `RESOURCE_NOT_FOUND` | 404 | 返回安全上级页 |
| `STATE_VERSION_CONFLICT` | 409 | 刷新后让玩家确认 |
| `QUEUE_VERSION_CONFLICT` | 409 | 展示本地 / 服务端差异 |
| `IDEMPOTENCY_KEY_REUSED` | 409 | 停止重试并记录诊断 |
| `ALREADY_ACTIVE_DUNGEON` | 409 | 恢复现有运行 |
| `DUNGEON_RUN_FINALIZED` | 409 | 打开最终结果 |
| `INSUFFICIENT_ITEM` | 422 | 显示物品、缺口和来源 |
| `INSUFFICIENT_CURRENCY` | 422 | 显示灵石缺口 |
| `INSUFFICIENT_OPPORTUNITY` | 422 | 显示下次恢复 |
| `BREAKTHROUGH_REQUIREMENTS_UNMET` | 422 | 跳到缺口追踪 |
| `QUOTE_CHANGED` | 422 | 未来市场保留错误码；MVP 不返回 |
| `ACTION_BLOCKED` | 422 | 显示阻塞原因 |
| `SETTLEMENT_SEGMENT_LIMIT` | 202 | 显示处理中并轮询状态 |
| `RATE_LIMITED` | 429 | 按 Retry-After 重试 |
| `MAINTENANCE` | 503 | 展示维护页，保留本地未提交编辑 |
| `INTERNAL_ERROR` | 500 | 可安全重试读；写请求仅用同幂等键重试 |

## 15. 重试规则

- GET：网络失败使用指数退避，最多自动重试 3 次。
- 写请求：只有携带同一幂等键才能自动重试；不得生成新键。
- 409 / 422 默认不自动重试。
- 429 / 503 遵循 `Retry-After` 并加入随机抖动。
- 客户端超时不代表写入失败；先使用同键重试或查询资源状态。

## 16. 实时更新

MVP 不依赖 WebSocket 才能正确运行。当前行动进度可在客户端依据 `as_of` 和快照平滑显示，并定期读取服务端状态。

可选 SSE 只推送：维护、配置更新、秘境等待选择、后台结算完成。推送是提示，客户端收到后仍通过 GET 读取权威状态。

## 17. 管理与诊断 API

管理接口使用独立 `/admin/v1`、独立域名 / 网关、MFA 和角色权限：

- `GET /characters/{id}/summary`：只读角色状态与当前配置版本。
- `GET /characters/{id}/ledger`：按事务查询资产变化。
- `GET /settlements/{id}`：结算分段、快照和错误，不向普通客服权限暴露敏感随机种子。
- `GET /dungeon-runs/{id}`：运行状态与恢复信息。
- `GET /config-releases`：版本、灰度、校验和回滚状态。
- `POST /compensation-requests`：创建补偿申请；审批与执行由不同权限端点完成。

管理端禁止提供任意 SQL、直接改余额或绕过账本的通用接口。

## 18. 契约测试

- OpenAPI 为接口 Schema 唯一来源，客户端类型由其生成。
- 每个错误码至少有一个契约测试。
- 服务端 CI 验证新增字段向后兼容、必填字段变更和枚举扩展。
- 黄金 E2E 覆盖：登录结算、保存队列、材料不足、秘境断线、淬炼重试、筑基重复提交。
