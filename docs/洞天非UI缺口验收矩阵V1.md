# 《洞天》非 UI 缺口验收矩阵 V1

## 2026-08-26 增量：用户目标玩法对照审计

- 用户目标与当前实现并非全部一致：单槽行动、基础炼丹/炼器、斩妖、灵田逐块 vertical slice 和突破链路已有；功法选择属性成长、采药、挖矿、可选丹方/器方和技能榜单仍是缺口，灵田正式种子内容/成本也待冻结。
- 当前前端仍是 Mock，页面结构与目标的“洞府/历练/背包/角色”不一致；本轮只审计，不修改 UI。
- 详细证据和产品冻结项见 `docs/洞天玩法设定对照审计V1.md`。

## 2026-08-26 增量：用户玩法服务端 MVP vertical slice

- 功法挂机、采药、挖矿、可选丹方/器方、逐块灵田和技能榜单已实现服务端 MVP；统一单槽、自动入库、CAS/幂等和 PostgreSQL 持久化。
- 正式技能等级曲线、地图/丹方/器方对象池、灵物成本/产出和 UI 联调仍待后续冻结与实现。
- 验收：`npm test` 357（335 通过、22 环境跳过、0 失败）；typecheck/build/lint/release audit 通过。

## 2026-08-26 增量：全局单行动序列文档一致性同步

- 已同步架构、核心数据结构、API/数据库契约、战斗系统、统一状态模拟、首发内容、建筑生产 proposal、新手引导和 UI 开发规划。
- 文档统一以 `global_single_slot_v1` 为当前 runtime：主动序列单槽、切换先结算、生产自动入库、灵田显式种植不占槽、legacy 队列仅兼容读取/回放。
- 历史并行经济分析没有删除，只标注为 `proposal_v1`/历史验证，不得被 agent 当作当前 API 或玩法依据。
- 新增统一入口文档 `docs/洞天当前运行时口径V1.md`，后续实现和 UI 联调先以该文档、API 契约和服务端代码为准。

## 2026-08-26 增量：global_single_slot_v1 玩法验收

- 全局主动序列已落地：炼气、普通地图、炼丹、炼器、功法研究、法宝研究共用 `primaryAction` 单槽；启动新序列会在同一 CAS/结算链路先结算并结束旧序列，再启动新序列。
- 炼丹/炼器序列按完整批次直接写入资源或装备状态，不经过手动领取；输入不足时不扣半批、不负库存，并在结算后结束生产序列。
- 灵田通过 `POST /v1/buildings/spirit_farm/plant` 显式种植，持久化 `planted_plots/planted_at/mature_at`，不占主动槽；成熟在下一次离线结算事务中自动入库并清空批次。旧安装 `NULL` 状态继续兼容连续灵田模式。
- global model 下 legacy `building_job` 创建与被动结算均关闭，历史队列只保留读取/回放兼容；秘境和高阶 Boss attempt 与主动序列互斥。
- 验收：`single-slot-action.test.ts` 12/12；全量 `npm test` 352 项（330 通过、22 环境跳过、0 失败）；`npm run typecheck:server`、`npm run build`、`npm run lint -- --quiet` 通过。
- 尚未实现：生产动作的正式 `quantity/remainingQuantity` DTO、丹道/炼器技能 XP/等级/排行榜，以及旧 building job 的取消/返还/冻结迁移语义；这些不阻断当前 vertical slice，但需在 UI 最终接入前冻结。

## 2026-08-26 增量：生产验收与部署边界审计

- 只读复核 `deployment-preflight.ts`、`production-acceptance.ts`、认证/JWKS、告警 webhook、durable metrics 和 PostgreSQL runtime：静态配置门禁与真实环境验收边界明确，均保持 fail-closed。
- acceptance harness 已增加每实例认证探针：复用通过 JWKS 验证的 sample JWT 调用只读 leaderboard route；实例认证失败时 readiness 项 fail，不再把匿名探针结果当成完整 IdP 验收。
- 定向服务端回归 336 项（314 通过、22 个无 `DATABASE_URL` 的真实 PostgreSQL/外部环境用例按约定跳过、0 失败）；覆盖 JWKS rotation、webhook 可达性/降级/有界停机、metrics durable fallback、PostgreSQL TLS/timeout/pool、scanner 与容量 SLO 输入校验。
- 未发现可在不依赖生产现场语义下安全补齐的缺口；不得把本机或 fixture 证据写成真实 IdP/JWKS、证书链、外部 webhook、生产拓扑、多实例 scanner 或容量 SLO 通过。该项仍为生产发布阻断，未修改正式参数、release hash、迁移、UI/CSS/素材。

## 2026-08-26 增量：批准方案非 UI MVP vertical slice 验收

- FI-01：三张普通地图正式生成 92 个模板（90 个六部位模板 + 2 个 legacy replay 模板），Schema 1.1、binding、registry、content hash 通过；UI 素材仍未设计。
- FI-03：策略/周期 mutation route 已实现，含显式目标、重复件匹配、资源 reserve、全批次原子、CAS、审计和 replay；正式 enable 参数仍为 proposal，调用保持 `CONTENT_LOCKED`。
- FI-05：兑换 route、分池余额、旧 marks 迁移兼容、PostgreSQL repository 读写已实现；真实 PostgreSQL 集成测试已加入，当前无 `DATABASE_URL` 因此 skip。
- 随机事件：合法 runtime state 已接入离线生产结算和 current route；旧 opaque state 原样保留，空状态不自动激活 proposal。
- 验收证据：`npm test` 331（309 通过、22 跳过、0 失败）；focused promotion/exchange/schema 21/21、random 8/8；typecheck、build、release audit、Ruby 61/61 通过。
- 判定：工程 vertical slice 已交付，但 FI-02 清风正式参数、FI-04 full_v1 正式输入/平衡、随机事件正式参数，以及真实生产外部依赖证据仍阻断 active release；UI/CSS/素材继续冻结。

## 2026-08-26 增量：FI-03/FI-05 vertical slice

- FI-03：已完成 Memory/PostgreSQL/API vertical slice，但正式 enable 参数仍未进入 frozen release，发布前保持 fail-closed。
- FI-05：已完成 Memory/API 兑换和 PostgreSQL 分池余额读写；真实 PostgreSQL integration 尚待本轮复跑。
- 本轮未修改 UI/CSS/素材或 frozen CSV；focused `21/21`、`typecheck:server` 通过。

## 2026-08-26（Luna：非 FI/随机事件 runtime API 交叉审计）

- 交叉核对 service/http/repository/types 与正式契约：主行动、离线结算、后台生产、库存、装备成长/出口、秘境/高阶战斗、突破、收藏研究/升星、回放、排行榜、配置发布、CAS/幂等和 pending lease 均有实现与测试；未发现可脱离产品输入安全补齐的 runtime/API 行为。
- 本轮无代码变更；随机事件仍为 opaque JSONB，FI-01..FI-05、正式随机事件契约和真实生产现场证据继续 fail-closed，UI/CSS/素材与正式参数未改。
- 验证：`npm test` 313 项（292 通过、21 跳过、0 失败）；`typecheck:server`、build、release-input audit 通过，release `1.0.0-frozen` / 1143 rows / `signature_only_v1`。

## 2026-08-26 最终验收：collection action DTO 互斥字段

- HTTP `/v1/collection/actions` 对 research/treasure_upgrade 的字段集合做 action-specific fail-closed 校验，避免交叉字段被静默忽略；HTTP focused `26/26`。
- 最终 `npm test` 310 项（289 通过、21 环境跳过、0 失败）；typecheck/build/release audit 通过，lint 仅既有 3 条 warning。
- 该修复不解除 FI-01..FI-05、随机事件正式契约或真实生产环境阻断；UI/CSS/素材继续冻结。

## 2026-08-26 最终验收：release provenance 与 pending settlement 幂等

- release 生命周期与 PostgreSQL 发布路径现在拒绝普通参数的非正式 `status/source`；运行时 `GameService` 的结构合法 full_v1 fixture 不受发布 provenance 门禁误伤。config-release、PostgreSQL release、full_v1 focused `60/60`。
- 同一 pending `settlement_id` 的玩家、时间区间、expected revision 或 config version 任一不一致时，Memory/PostgreSQL 均 fail-closed，不覆盖既有 reservation；新增 pending-to-pending 回归。
- 最终证据：`npm test` 310 项（289 通过、21 环境跳过、0 失败）；typecheck/build/release audit 通过；lint 仅既有 3 条 warning；真实 PostgreSQL integration `20/20`；Ruby 全量审计 61/61。
- 五项正式输入阻断（FI-01..FI-05）、真实生产身份/告警/拓扑/容量现场证据均未解除；UI/CSS/素材继续冻结，总体 `active / partial / infrastructure_and_feature_gaps`。

## 2026-08-26 CAS 与旧安装数据库 invariant 复验

- 旧安装迁移现在补齐库存容量、生产 carry、库存 overflow、所有状态 revision、settlement expected/committed revision、audit 前后 revision 的非负/容量约束；违反历史数据时 fail-closed，不隐式修正状态。
- schema/migration focused `16/16`，最终 `npm test` 306 项（285 通过、21 环境跳过、0 失败），真实 PostgreSQL integration `20/20`，typecheck/build/lint/release audit 和 Ruby `61/61` 通过。该工程收口不解除正式内容输入或真实生产环境阻断。

## 2026-08-26 FI-05 与生产验收边界复验

- `collection_state.collection_marks` 已有新建表非负约束，并通过幂等 DO 块覆盖旧安装；schema contract `14/14`。正式兑换 route/DTO、境界池/目标/池满/幂等/CAS/replay/迁移语义仍缺，FI-05 继续阻断。
- 生产验收 Webhook HEAD 仅接受 `2xx`；PostgreSQL Metrics durable store 采用完整事件类型白名单，未知事件 fail-closed，不污染聚合指标。focused 合并 `14/14`。
- 合并证据：`npm test` 306 项（285 通过、21 环境跳过、0 失败）；真实 PostgreSQL integration `20/20`；typecheck/build/release-input audit/lint 通过；Ruby 全量审计 `61/61`。真实 IdP、Webhook、生产拓扑、scanner 和容量现场证据仍未提供。

## 2026-08-26 最终回归证据（自动升品边界修复后）

- 自动升品仍为只读规划：输入 `enabled`、requests、availableResources、成本乘积均 fail-closed；focused `8/8`，不实现正式 mutation。
- `npm test`：305 项，284 通过、21 环境跳过、0 失败；`typecheck:server`、lint（既有 3 条 warning）、build、`audit:release-inputs` 通过。
- 真实 PostgreSQL integration：20/20（PG 11、routing 1、reliability 7、process 1）；Ruby 全量审计：61/61；版本 `1.0.0-frozen`、参数/内容 SHA 未变。
- 总体判定保持 `partial / infrastructure_and_feature_gaps`；FI-01 至 FI-05、真实生产外部依赖与容量现场证据仍是阻断；UI/CSS/素材继续冻结。

## 2026-08-26（Luna：库存表无物理删除契约收口）

- PostgreSQL 资源持久化已从每次事务 `DELETE`/重建改为 `(player_id, resource_id)` 无损 upsert，保留库存行物理身份，符合数据库契约的“库存不得物理删除”要求。
- focused repository 回归和全量服务端回归通过（302 项，281 通过、21 环境跳过、0 失败）；该修复不涉及正式数值、UI 或尚未冻结的随机事件/支援路线/兑换语义。

## 2026-08-26（Luna：随机事件正式语义审计）

- `progress_state.random_event_state` 已有 Memory/PostgreSQL opaque JSONB 无损读写，但没有 runtime 消费、事件抽取、HTTP route/DTO 或离线逐窗状态迁移；API/DB 字段存在不等于随机事件玩法已实现。
- 《洞天随机事件与离线结算V1》仍为 `proposal_v1`，离线方案明确将离线随机事件处理列为尚未定案。CSV/生成参数表中的 `frozen_v1` 数值不足以冻结窗口游标、服务器时间抽取、生产倍率作用范围、跨窗口离线结算和 replay/CAS 语义，存在正式来源不一致。
- 判定：随机事件正式玩法/API 继续阻断，待产品冻结完整契约后实现；本轮未改代码、UI、素材或正式参数。

## 2026-08-26（普通地图失败终止状态收口）

- 普通地图战斗失败现在在离线结算同一事务内清空 `primaryAction`、写入 `failureCooldownUntil` 并提交失败 settlement；后续离线请求不会重复模拟已失败地图。
- `stopAction` 兼容“失败结算已清 action”的预期终态，仍对其他 action mismatch 返回 `STALE_REVISION`。
- 新增 service 回归 2 项；全量 `npm test` 当前 296 项（275 通过、21 跳过、0 失败），真实 PostgreSQL integration 20/20 通过。
- 该修复闭合普通地图失败停止边界，但不解除正式地图装备 binding、清风 30 天参数、自动升品、`full_v1`、法宝印记兑换和真实生产环境阻断。

## 2026-08-26（HTTP/Schema 工程边界最终复验）

- HTTP body parser 现在有 bounded 输入上限：默认 1 MiB、部署可配置 1..10 MiB，Content-Length 和 chunked 请求均有超限回归，413 不进入业务 mutation。
- HTTP graceful shutdown 现在有 bounded timeout，正常请求先排空；挂起 keep-alive 与 upgraded/connect sockets 在超时或正常 drain 后均被清理，避免进程泄漏。
- 数据库契约文档已与可执行迁移同步：resource enum、numeric 资源/carry、player-scoped equipment composite key、dungeon snapshot、pending claim、audit payload 等字段均有 schema-contract 断言。
- 验收证据：全量 `npm test` 289 项（268 通过、21 环境跳过、0 失败）；typecheck/build/lint 通过；串行真实 PostgreSQL integration 20/20 通过。
- 总状态保持 `partial / infrastructure_and_feature_gaps`。本轮未修改 UI/CSS/素材/正式参数；正式地图内容、清风/自动升品/full_v1 输入、法宝兑换协议和真实生产环境仍是阻断。

## 2026-08-26（运维可靠性与 API 契约复验）

- 告警 webhook 具备 bounded 停机排空：in-flight 请求可等待，内置 fetch 可 abort，自定义不可取消 publisher 超时只记录 pending，不阻塞其他资源关闭；主进程按超时继续 graceful shutdown。配置和 focused 回归通过。
- pending scanner lease 时长已显式配置并通过 deployment preflight；readiness 不再永久依赖历史成功扫描，超 freshness 窗口后 fail-closed；状态接口不泄露底层错误。
- API 详细契约与实际 HTTP adapter 已统一为 camelCase；只读 health/metrics envelope 例外、combat preview/start 白名单、服务端生成 attempt/seed 及 snake_case 拒绝均已记录并有回归。
- 验收证据：全量 `npm test` 282 项（261 通过、21 环境跳过、0 失败）；lint/typecheck/build 通过；串行真实 PostgreSQL integration 20/20 通过。
- 总状态保持 `partial / infrastructure_and_feature_gaps`。本轮未修改 UI/CSS/素材/正式参数；内容包、清风/自动升品/full_v1 正式输入、法宝兑换协议和真实生产环境仍未关闭。

## 2026-08-26（Luna 并行开发与主代理最终验收）

- API 工程闭合：`POST /v1/settlements/offline` 现在与其他状态写路由一致，强制 `Idempotency-Key`；缺少 header 在 mutation 前返回 `VALIDATION_FAILED`，`settlementId` durable replay 语义不变。HTTP focused 23/23 通过。
- 自然玩法边界复核：已有 stop/switch 可完成训练结算后切换地图，突破 transition map 与原子资源检查已存在；训练房升级、自动突破、法宝印记兑换没有正式字段/对象池/数值契约，本轮保持未实现并记录为产品输入阻断。
- 验收证据：全量 `npm test` 275 项（254 通过、21 环境跳过、0 失败）；lint/typecheck/build 通过；串行真实 PostgreSQL integration 20/20 通过。
- 总状态保持 `partial / infrastructure_and_feature_gaps`。本轮未修改 UI/CSS/素材/正式参数；普通地图装备正式 binding、清风 30 天参数、自动升品策略、full_v1 正式战斗参数/平衡、真实生产依赖和目标拓扑 SLO 仍未关闭。

## 2026-08-26（权威输入完成性审计）

- 权威参数包验证通过 1143 行/12 列、版本 `1.0.0-frozen`、SHA-256 `7113fe...`，Ruby 全量验证器通过；该证据只覆盖现有冻结参数，不覆盖缺失的清风装备、自动升品和 full_v1 字段。
- content/API 审计确认普通地图正式装备仍无三张地图 binding，首发六部位模板仍为待制作；清风 30 天和自动升品参数不存在；当前高阶正式模式仍为 `signature_only_v1`。
- 定向内容、高阶契约、长期经济和 HTTP 测试 54/54 通过；门禁继续正确返回锁定/缺参，而不是用 proposal 或 fixture 发布。
- 法宝阁兑换 API 缺少正式路由/目标字段/境界对象池定义，暂不实现，不将 proposal 文档计为完成。
- 总状态仍为 `partial / infrastructure_and_feature_gaps`。

## 2026-08-26（独立验收复跑）

- 独立复跑 `npm test`：275 项，254 通过、21 项因未设置 `DATABASE_URL`/外部依赖而跳过，无失败、无取消；`build`、`typecheck:server`、`lint` 通过，lint 仍只有 3 条既有测试 warning。
- 串行真实 PostgreSQL integration 20/20 通过（PostgreSQL 11、routing 1、reliability 7、process 1）。
- 容量 harness 64 x 24 = 1536 settlements，1536/1536 成功；当前复跑吞吐 1083.003/s，P50/P95/P99/max = 39.849/53.234/61.620/63.695ms。报告位于 `docs/capacity-baseline-20260826.json`，仅作为本机 bounded smoke，不替代正式生产 SLO。
- 本轮没有新增代码改动；UI/CSS/素材继续冻结。总判定仍为 `partial / infrastructure_and_feature_gaps`。

## 2026-08-26（scanner lease 与生产连接边界）

- pending settlement scanner 已具备多实例 claim/lease：PostgreSQL `FOR UPDATE SKIP LOCKED` + `claim_until` 过期恢复，Memory 路径保留同等 lease 语义；真实 PG integration 新增跨实例防重复和过期 lease 用例。
- production PostgreSQL runtime contract 已显式校验 pool max、连接/语句/查询/空闲超时、TLS 模式和 CA；deployment preflight 要求显式值且生产 `verify-full`。`main.ts` 增加 SIGTERM/SIGINT 优雅停机，关闭 scanner、HTTP 和 pool。
- 验证：全量 `npm test` 275 项（254 通过、21 环境跳过），真实 PostgreSQL integration 20/20，build/typecheck/lint 通过；容量基线 1536/1536 成功，指标写入 `docs/capacity-baseline-20260826.json`。
- 法宝阁未拥有对象兑换暂不计完成：文档仍是 proposal，API 契约没有目标字段和境界池隔离定义，不能从全局 `collectionMarks` 安全推导；需产品冻结协议后再实现。
- 总状态仍为 `partial / infrastructure_and_feature_gaps`，正式地图装备、清风路线、自动升品、full_v1 数值和真实生产外部依赖仍是发布阻断。

## 2026-08-26（Luna：pending settlement 多实例 claim/lease）

- 原 scanner 仅分页读取 pending rows，存在多实例重复领取窗口；现已新增可选 `claimPendingSettlements` 仓储契约。
- PostgreSQL 使用事务 CTE + `FOR UPDATE SKIP LOCKED` + `claim_token/claim_until` bounded lease；Memory 使用等价 lease。scanner 自动优先 claim，结算提交/拒绝清理 claim，lease 到期可接管。
- 迁移新增 claim 字段和索引；focused scanner/repository/schema 31/31，真实 PostgreSQL integration 11/11，覆盖 lease 内互斥和过期恢复。
- 该项从“仍缺多实例 scanner claim/lease”更新为“工程已实现；生产拓扑和正式 SLO 仍需环境验收”。

## 2026-08-26（最终回归与容量证据）

- 全量 `npm test` 稳定通过 247 项、跳过 20 项环境依赖用例（共 267 项）；无失败/取消。`build`、`typecheck:server`、`lint` 通过，lint 仅 3 条既有测试 warning。
- 真实 PostgreSQL 串行 integration 19/19 通过（10+1+7+1），覆盖 attempt 配置快照跨重启、配置路由、CAS/幂等、故障回滚、scanner、metrics 和进程重启。
- `docs/capacity-baseline-20260826.json` 固化 64×24 bounded smoke：1536 settlements 全部成功，吞吐 1128.393/s，P50/P95/P99/max = 38.098/50.617/58.678/63.435ms。本机 smoke 不能替代目标生产拓扑 SLO。
- 虚拟生产 preflight `PASS`；真实 IdP/JWKS 证书部署、外部 webhook、生产拓扑和多实例 scanner claim/lease 仍需环境验收。
- 总判定继续为 `partial / infrastructure_and_feature_gaps`；正式地图装备内容、清风参数、自动升品策略、full_v1 正式数值/平衡仍是发布阻断，UI 继续延后。

## 2026-08-26（主行动切换与运行健康）

- 新增 action stop/switch API 和 CAS/幂等回归；停止 action 会先完成离线结算并清空 `primaryAction`，可自然串联训练、地图、掉落和后续突破。
- 新增 `/healthz`、`/readyz`；`readyz` 对数据库、active config、pending scanner 缺失/异常/超时均 fail-closed，响应不泄露诊断细节。
- 新增独立 `benchmark:capacity` 报告 harness，integration smoke floor 为 64×24=1536 settlements；正式容量基线仍需在目标拓扑采集并固化 P50/P95/P99、吞吐和错误率 SLO。

## 2026-08-26（秘境/高阶 attempt 配置快照）

- 秘境与高阶 Boss start 现在持久化开战时 `configVersion` 与完整配置快照；settle 通过 attempt 快照运行，配置 activate/rollback 不会用新公式重算旧战斗。秘境 PostgreSQL 表新增 `config_version/config_snapshot`，高阶快照随 gate JSONB round-trip。
- 旧记录缺失快照时显式返回 `CONFIG_VERSION_MISMATCH`，拒绝用当前运行时重算；新 attempt 强制写入完整快照。服务端全量 260 项测试 241 通过/19 跳过，typecheck 通过。
- 专用 PostgreSQL integration 已执行 19/19（10+1+7+1），新增秘境 attempt 配置快照跨 Repository 重启 round-trip，包含高阶状态恢复、秘境战斗事件 round-trip、跨实例配置路由和进程重启；正式内容阻断和 UI 延后不变。

## 2026-08-26（并行 Luna 审计最终验收）

- 工程收口：PostgreSQL metrics snapshot 按 `event_at <= at` 过滤；生产 preflight 强制启用 pending settlement scanner；配置发布命令在 provider/repository boundary 统一校验审计元数据；action idempotency key 按目标命名空间隔离，并对旧 key 做严格目标匹配兼容回读；秘境/高阶 preview 使用只读配置读取并拒绝 stale 迁移副作用。
- 验证：`npm test` 259 项（240 通过、19 个无 `DATABASE_URL` 的真实 PG/外部用例跳过）；`npm run typecheck:server`、`npm run build`、虚拟生产 preflight PASS；`npm run lint` 通过，仅既有 3 条 warning；真实 PostgreSQL 串行 integration 18/18（9+1+7+1）通过。
- 验收结论不变：总体 `partial / infrastructure_and_feature_gaps`；普通地图正式装备 content binding、清风 30 天参数、自动升品策略、六境界 `full_v1` 正式参数/平衡、真实 IdP/证书/外部告警/生产拓扑和更大规模容量基线仍是发布阻断；UI/CSS/素材未开展。

## 文档目的

本矩阵把《洞天非 UI 正式实现计划 V1》、MVP 技术架构、API/数据库契约和工程验收标准映射到当前非 UI 代码证据。它用于决定 MVP 是否可以进入下一阶段开发，不替代真实 PostgreSQL、部署、压测和安全环境验收。

验收口径：计划中的“完成”必须同时满足版本化配置/参数引用、领域类型与状态迁移、成功/失败/重复/边界/资源守恒测试、可回放摘要或事件日志、且不依赖 React UI。状态分为：

- `已实现`：当前代码和自动化证据基本覆盖计划项；不代表已完成生产部署验收。
- `部分实现`：已有可运行的领域/服务端切片，但仍缺契约面、真实基础设施、覆盖面或关键边界。
- `未实现`：当前没有可接受的运行时实现，只有文档、参数、类型或数据库预留不能计为完成。

## 当前总判定

| 层级 | 判定 | 结论 |
| --- | --- | --- |
| P0 配置与基础状态 | 部分实现 | 冻结配置、内容包、基础状态、资源、随机、结算和审计骨架已存在；统一 schema/DTO、完整状态覆盖和所有契约测试尚未闭合。 |
| P1 核心玩法引擎 | 部分实现 | 普通地图、训练、炼丹/炼器/灵田/功法阁/法宝阁后台生产、秘境三档、六境界高阶 Boss signature-only 运行时与远征供给、完整突破链、装备成长、战斗属性结算和 12 本功法对象池已有服务端切片；正式 full_v1、清风长期经济与地图装备内容闭环仍缺。 |
| P2 结算与权威状态 | 部分实现 | MemoryRepository 与 PostgreSQL SQL adapter/fake 契约测试已存在；真实 PostgreSQL 已验证迁移、状态 round-trip、启动、同 revision CAS、隔离级别、连接池重连、bounded 长时压力和进程重启恢复；更大规模容量基线与完整生产拓扑仍未验收。 |
| P3 接口与运营可靠性 | 部分实现 | 主要 HTTP 路由、错误 envelope、审计、Bearer/JWT 认证边界、只读 replay、分页排行榜、Prometheus 文本端点和 admin 配置发布操作已有；外部监控后端、生产身份映射和跨实例运维仍缺。 |
| 发布阻断 | 未解除（正式内容/环境仍缺） | equip/unequip、replay、分页排行榜、Prometheus 指标、普通/秘境/高阶战斗快照结算、六境界高阶小时级远征供给、收藏对象池、收藏独立 append-only 事件流、最小跨版本迁移运行时、真实 PostgreSQL 配置发布审计和高阶远征重启恢复已补齐；高阶六境界 signature skill 摘要、确定性压制窗口、技能压制秒数持久化、90 天长期消费切片、长期装备只读生成/自动出口/资源账本 contract slice 与玩家绑定 HTTP 只读 endpoint、真实服务进程 kill/restart 后新 Pool 恢复已补齐；pending settlement 故障恢复、ambiguous commit 幂等、多实例 32 路 CAS、PostgreSQL 持久化指标事件和后台 scanner 恢复/拒绝 worker 已补齐；法宝重复掉落自动升星和可配置 HTTPS webhook 告警投递已补齐；真实 PostgreSQL 串行 integration 已通过。本地无 DB 时仍有 19 个真实 PG/外部用例按环境跳过。高阶完整 Boss 多技能/逐秒攻击与受击状态机（所需参数仍未正式冻结）、清风 30 天完整消费参数、普通地图正式装备内容与地图 binding、自动升品正式策略参数、真实告警端点部署验收仍是独立发布门槛。 |

## 验收矩阵

| 领域/验收项 | 计划与契约要求 | 状态 | 代码/文档证据 | 已有测试证据 | 缺口、风险与下一步 |
| --- | --- | --- | --- | --- | --- |
| 冻结配置版本与参数引用 | 启动校验 `1.0.0-frozen`、参数 SHA、内容 SHA；内容 ID 和参数引用唯一有效 | 已实现（运行时切片） | `demo/src/game/frozen-parameters.ts`、`parameter-manifest.ts`；`demo/src/content/content-schema.ts`；`demo/src/content/manifest.json` | `content-schema.test.ts`、配置发布测试；manifest 文件清单、`content_pending` 可达性、发布前快照复核、当前 1143 行/12 列参数表一致性、构建和 lint 通过；`ruby docs/验证洞天数值版本V1.rb` 和只读全量审计 `61/61` 通过 | 正式发布流水线仍需在真实环境执行；当前数值包本身已闭合。优先级 P0。 |
| 玩家状态、资源、revision、随机与 settlement 类型 | 非负资源、容量/预留、CAS、随机状态、结算摘要和配置版本必须可持久化、可回放 | 部分实现 | `demo/src/server/types.ts`、`repository.ts`、`service.ts`；`V1_001_core.sql` | `service.test.ts` 覆盖成功、旧 revision、重复 settlement、collection/high-tier、迁移、回滚、资源边界；领域测试 10 项通过 | 最小跨版本迁移已支持 identity/forward-compatible 策略并写审计 hash；完整事件摘要、灰度路由和生产级恢复仍未闭合。P0/P2。 |
| 训练/普通地图主行动 | 单一主行动、固定 seed、逐场结算、掉落/保底、失败停止、资源守恒 | 已实现（普通地图范围） | `demo/src/game/engine.ts`、`demo/src/server/service.ts` 的 `startAction/offlineSettlement/simulate` | `engine.test.ts`、`service.test.ts` 覆盖地图门槛、失败冷却、固定随机、24h/重叠、资源溢出 | 仍需补全三张地图的长时分布样本、真实配置快照引用和跨进程回放。P1。 |
| 后台建筑生产与队列 | 炼丹/炼器序列、灵田种植成熟、建筑倍率与批次结算 | 部分实现（global single slot vertical slice） | `service.ts` `startAction/offlineSettlement/plantSpiritFarm`；`single-slot-action.test.ts`；`building_state` SQL | 单槽切换先结算旧动作、产出直入资源/装备、资源不足原子性、显式种植幂等/CAS、成熟自动入库、旧队列不再产出 | 正式生产数量 DTO、技能 XP/等级/榜单，以及旧 building job 的取消/返还/冻结迁移语义仍未冻结；旧队列仅为兼容读取/回放，不是新玩法入口。P1/P2。 |
| 秘境 Boss 三档状态机 | 预览/开始/结算、护盾、阶段、眩晕、持续伤害、失败冷却、四类保底、固定 seed | 已实现（三档秘境切片） | `service.ts` `previewDungeon/startDungeon/settleDungeon/simulateDungeon`；`DungeonAttempt.combatSnapshot`；`dungeon_attempt.combat_snapshot` JSONB | 三档 preview、固定 seed、成功奖励/保底、玩家快照驱动输出/受击、开战后换装不影响结果、失败不发奖、回滚和 HTTP 路由测试 | “三档秘境”不能等同“高阶远征完整实现”；仍需真实重启恢复和高并发 attempt 测试。P1/P2。 |
| 高阶远征与高阶 Boss | 六高阶境界入口、独立门槛/供给/Boss 奖励状态机 | 部分实现（signature-only 正式运行时 + 有界事件审计 + full_v1 schema/引擎门禁） | `service.ts` 的 `previewHighTier/startHighTier/settleHighTier/highTierClearTime/highTierSurvivalSeconds/highTierSkill/highTierSkillSimulation/startAction/simulate/longTermEconomy`；`high-tier-signature-combat.ts`；`high-tier-contract.ts`；`high-tier-full-combat.ts`；`HighTierAttempt.fullCombat/combatEvents` JSONB；`/v1/high-tier/*`；冻结参数独立掉落/失败恢复/六类 hourly supply/signature skill 配置 | `high-tier-signature-combat.test.ts` 覆盖 signature-only start/settle/失败/提前结算/幂等/replay/rollback、seed/快照绑定和超长 horizon 固定 7 条事件；既有六境界 signature-only 验收；`high-tier-full-combat.test.ts` 6 项覆盖 synthetic contract 下 full_v1 确定性逐秒攻击/受击、控制/DoT/输出压制抗性、自动丹药、快照冻结/重放、bounded trace 和 GameService start/settle 持久化；新增 `high-tier-contract.test.ts` 权威 CSV + `FROZEN_PARAMETERS` 审计，确认六境界 full_v1 字段不存在且 `combat_mode=signature_only_v1` | `collectionMarks >= 10` 仍是 `collected_p10` 的明确 MVP 代理；30 天清风支援普通装备参数缺失，运行时严格门禁；正式六境界 full_v1 offense/defence/accuracy、攻击间隔、技能、抗性和自动丹药数值尚未冻结，不能激活该模式或宣称正式平衡完成。测试 fixture 数值不是正式参数证据。P1/P2。 |
| 突破 | 材料/修为全量校验，100% 成功，失败不扣，原子迁移 | 部分实现（链路已接通） | `service.ts breakthrough` 的完整 transition map；冻结 `breakthrough.*` 成本和 `economy.inventory.cap_multiplier.*`；领域 `engine.ts` | 炼气 -> 筑基、筑基 -> 金丹、金丹 -> 元婴、高阶容量倍率、幂等、资源不足和提交失败回滚测试 | API 已可按当前境界一路迁移到渡劫；仍缺长线小境界修为/资源供给、飞升事件和真实经济基线。P1。 |
| 功法研究与法宝星级/生产 | `collection_state`、研究队列、层数/星级、重复转换、生产 modifier 顺序 | 部分实现（对象池与战斗 modifier 已接入） | `types.ts`/`repository.ts`/`postgres-repository.ts` collection state；`service.ts techniquePool/applyCollectionDrops/applyTreasureDrop/combatStats/highTierClearTime/highTierSurvivalSeconds/simulateBuildings`；`/v1/collection/actions`、`/v1/buildings/{building_id}/upgrade`；`growth.technique.pool.*` 与 `growth.technique.*_per_layer` 参数；`collection_marks >= 0` SQL invariant | 12 本功法按品质和同品质权重抽取、具体 `techniqueId` 回放、研究 ID/品质绑定、层数对 attack/defence/health、普通/秘境/高阶快照和强弱构筑结算、秘境/高阶重复法宝自动升星、历史重复余额消化、满星印记、资源不足、幂等、CAS、回滚、HTTP 和 SQL 契约测试；schema contract 14/14 | 高阶完整 Boss 技能/状态、法宝阁对象兑换专用 API、长期经济分布和高阶扩展池全量闭环仍缺。冻结/提案文档未定义兑换专用路由、请求字段、当前对象池判定或高阶池隔离，不能安全猜测补实现；旧全局印记无法安全迁移到分池，需先冻结 API/池/迁移语义。P1。 |
| 装备实例与成长 | 六部位、品质、强化、升品、洗练、锁槽、觉醒、出口、库存/溢出 | 部分实现 | `service.ts equipmentAction`；`types.ts EquipmentInstance`；`equipment_instance` SQL；`equipment-instance-writer.ts`（纯 deterministic writer）；`long-term-equipment-consumption.ts`（只读生成/出口/资源账本/升品门禁）；`equipment-exit.ts`；`content-schema.ts diagnoseMapEquipmentReleaseReadiness`；`config-release.ts validateOrdinaryMapEquipmentRelease` | 强化、升品、洗练、锁槽、觉醒、equip/unequip、salvage/sell、溢出和回滚测试；writer 确定性/预算/词条槽/空模板测试；长期消费 helper 确定性生成、库存边界、普通/精良分解、稀有以上出售、资源守恒、坏策略和升品缺参测试；完整 binding synthetic fixture 下普通地图固定 seed 入库/`retain_rare` 出口/幂等 replay 测试；绑定品质/槽位类别覆盖门禁；显式 release readiness gate 测试 | 普通地图运行时已闭合：仅对 versioned content 中合法的 `map.equipment_drop.template_ids` 且通过 content/readiness/`retain_rare` 校验的快照，使用现有 content-backed deterministic writer；库存未满入库，满库存普通/精良自动分解、稀有及以上出售，结算摘要返回实例和出口动作，均在同一 settlement transaction 内提交并可幂等 replay。只读长期 helper 复用同一 writer/出口资源路径，但不写状态、不能替代 service endpoint。当前冻结包仍没有三张地图的正式 binding，结算命中仍返回 `CONTENT_LOCKED` 和 `MISSING_CONTENT_BINDING`；发布工具 gate 不再报告已闭合的 `RUNTIME_NOT_IMPLEMENTED`，但仍阻断内容缺口。自动升品当前因缺少正式 `schedule.equipment.auto_promotion.enabled` 保持 `MISSING_PARAMETER` 门禁，不使用 proposal。正式开放仍需补齐首发规格要求的六部位模板名称/图标/外观/属性内容和三张地图 binding，更新 content hash 后才可启用。P1/P3。 |
| 离线结算 | 最多 24h、60s 批处理、carry、时间回拨/重叠、失败分支、摘要 | 已实现（Memory 运行时） | `service.ts offlineSettlement/simulate/simulateBuildings`；settlement SQL | 24h 裁剪、重叠、回拨、失败、资源守恒、提交失败回滚、重复 ID | 真实 DB 事务和跨进程重试未验收；settlement ID 在真实 PostgreSQL 上的并发冲突需 integration test。P2。 |
| PostgreSQL 权威状态 | PostgreSQL 唯一权威源、行锁、事务、CAS、迁移、重启恢复 | 部分实现（真实 smoke 与 CI workflow 已补） | `postgres-repository.ts`；`migrations.ts`；`V1_001_core.sql`/`V1_002_config_release.sql`/`V1_003_observability.sql`；`high_tier_gate_state` round-trip；`inventory_resource` numeric migration；`.github/workflows/server-validation.yml` | fake SQL client 验证 `FOR UPDATE`、CAS、写表、ROLLBACK；真实 PostgreSQL 迁移/启动、fractional resource round-trip、配置发布、high-tier expedition 状态重启恢复、故障注入、隔离级别矩阵、同 revision 并发 CAS、Pool backend termination 后恢复、24 玩家×12 轮（288 settlements）长时压力；CI workflow 固定 PostgreSQL service 执行 test/typecheck/lint/build/integration | 基础事务、进程 kill/restart、连接池断线恢复、bounded 长时多玩家压力和隔离级别矩阵已有真实证据；仍缺更大规模容量基线、完整生产部署拓扑和外部依赖演练。P2。 |
| Redis 边界 | Redis 只能缓存/队列，丢失不影响最终状态和重发 | MVP 明确排除 | 架构文档定义 PostgreSQL 唯一权威源；代码和依赖均未接 Redis | 不适用：当前运行时无 Redis 读写或队列路径；PostgreSQL settlement/CAS/replay/后台 scanner 独立闭环测试 | MVP 不依赖 Redis，因此不宣称 Redis 故障边界已实现；未来接入缓存/队列时必须新增丢失、重复消费和回源测试。P2。 |
| 配置发布、灰度、回滚与历史 replay | 发布状态机、active 唯一、写入 configVersion/seed/response，不重算历史结算 | 部分实现（运行时运维闭环 + 请求级灰度路由 + 发布操作持久化幂等） | `config-release.ts` 的 `getSnapshotForPlayer/getSnapshot/runOperation`、`migrationPolicy`/audit；`config-release-postgres.ts` 的 durable operation transaction/advisory lock 与稳定 bucket 查询；`GameService.forPlayer/forConfigVersion/configReleaseOperation()`；`http.ts` admin route；`V1_002_config_release.sql` 的 `config_release_operation` | 内存 Registry/PG repository operation replay、单 audit、不同 retry reason 不重放；真实 PostgreSQL 双连接池/双 HTTP 实例灰度、两个独立 Provider/Service 并发 activate、进程重建 replay、旧 settlement replay；旧 settlement/pending scanner 按记录版本历史快照重放 | 配置操作跨进程幂等的代码契约已闭合：响应、状态转移和 audit 同事务，重启 replay 不依赖进程 Map；真实 PostgreSQL integration 9/9 已通过，两个独立 Provider/Service 并发同 key 只生成一条 audit，随后进程重建 replay 确认新 migration/物理 advisory lock。仍缺 canary 版本正式数值/迁移策略需由发布包提供。P2/P3。 |
| API 路由与 envelope | bootstrap、主行动、离线、建筑、突破、装备、combat preview、排行榜；统一 request/config/revision/time | 部分实现 | `demo/src/server/http.ts`；`types.ts` | bootstrap/start/offline/building/equipment/collection/dungeon/combat preview/breakthrough/replay/leaderboard 路由测试；统一错误 envelope 测试 | `/v1/leaderboards/{type}` 已支持 `realm/cultivation_xp/combat_power`、匿名条目和分页边界；认证仍需生产身份映射，统一 runtime schema 仍需扩展。P3。 |
| DTO/Schema/错误边界 | 所有请求 runtime schema 校验，统一错误码，拒绝客户端结果字段 | 部分实现（主要 HTTP 已覆盖） | `http.ts` 的 `requiredString/requiredInteger/enumString/revision` helpers；`ApiErrorCode` 在 `types.ts` | 跨路由非法 DTO、缺字段、非有限数、越界、非法枚举和 revision 不变测试 | HTTP 写路由已拒绝 `NaN`、`Infinity`、`null`、缺字段和非法枚举；仍需把 schema 契约扩展到更完整的 request 类型，并补真实部署边界。P3。 |
| 认证、授权、审计操作者信息 | Bearer token、操作者/原因/前后 revision、管理员独立权限 | 部分实现（provider 边界） | `auth.ts` 可注入 `AuthProvider`：默认 HS256；可配置 HTTPS JWKS/RS256、`kid`、issuer/audience、缓存/超时；`http.ts` admin role gate；`config_release_audit` 与 `audit_event` 契约 | HS256/JWT 签名、issuer/audience、角色边界、admin 403/200、RSA JWKS 签名/缓存/缺参拒绝测试；`typecheck:server`、HTTP 定向回归 | JWKS provider 已有可运行契约但尚未接入真实生产 IdP 映射；真实证书、密钥轮换、外部身份服务部署和普通玩家审计明文 operator/reason 仍未验收。P3。 |
| 可回放事件与审计 | settlement/动作摘要哈希、配置版本、seed、前后 revision、历史结果可回放 | 部分实现（collection 与 signature-only 高阶事件流已实现） | `repository.ts`/`postgres-repository.ts`；`collection_event` migration；`service.ts collectionEvents`；`high-tier-signature-combat.ts`；`GET /v1/collection/events`；`settlement_record`；`dungeon_attempt.response_payload/combat_events`；`HighTierAttempt.combatEvents`；配置 replay repository；`GET /v1/replays/{settlementId}` | audit 写入、固定 seed、重复响应、配置 rollback replay、秘境/高阶 bounded combat trace round-trip、signature-only start/settle/失败/幂等/回滚、collection before/after diff、Memory/PostgreSQL cursor 分页与 hash round-trip、HTTP replay/collection 只读和越权测试；真实 PostgreSQL collection event round-trip/cursor | collection 与 signature-only 高阶事件均由事务状态保存并可重放；signature trace 固定 7 条以内，包含开始、压制窗口/摘要、玩家输出、成功/失败和 `combat_end`；仍缺真实跨版本全量 replay，配置 replay 目前独立于 GameService。P2/P3。 |
| 运营指标与告警 | 结算成功率、重复/过期 revision、经济异常、掉落偏差、pending 监控 | 部分实现（运行时切片 + 可配置 webhook 投递） | `metrics.ts`；`metrics-postgres.ts`；`metrics-alerts.ts`；`V1_003_observability.sql`；`main.ts` 的 `DONGTIAN_ALERT_BACKEND`/`DONGTIAN_ALERT_INTERVAL_MS`；`GameService.metricsPrometheusAsync()`；HTTP `/metrics` | metrics 聚合/有限采样/阈值测试；drop deviation、pending、economic anomaly 聚合和 Prometheus 文本输出；PostgresMetricsStore 跨实例/重启 round-trip；runtime sink 非阻塞/降级/admin gating；默认 HTTPS webhook JSON/Bearer/timeout/fallback；main 进程显式 webhook 轮询接入 | pending 当前是 settlement 观测并由 scanner 另行恢复；drop deviation 是期望概率与实际 0/1 的观测偏差，不含置信区间；webhook 传输和主进程轮询已实现，但真实外部告警端点、证书和部署级验收仍缺。P3。 |
| 并发、故障和恢复 | 相同 settlement 并发只提交一次、同 revision 单成功、每步故障回滚、服务重启恢复 | 部分实现 | Repository transaction/CAS；SQL `FOR UPDATE`；Memory fail-next-commit；真实 integration restart/replay；多实例压力 harness；FaultInjectingPool；真实 `main.ts` 子进程 smoke；`PendingSettlementScanner` | 单线程 fake CAS、提交失败回滚、重复 settlement、pending reservation 重试；Memory scanner 的恢复/拒绝/retryable/minAge/start-stop 测试；真实 PostgreSQL 4 连接池 32 路 CAS（1 成功/31 stale）、多步骤 SQL 故障回滚、ambiguous COMMIT 幂等、配置发布、高阶远征重启恢复、metrics store round-trip、真实 PG scanner 恢复/拒绝、48 条 batchSize=7 长批量 drain、24 玩家×12 轮长时压力、隔离级别矩阵、Pool backend termination 后恢复、真实进程 `SIGKILL` 后新进程/新 Pool 恢复，integration 串行回归；CI workflow 固化基础回归 | 基础事务、隔离级别、连接池断线恢复、bounded 长时多玩家压力、长批量 scanner 和进程重启已有真实证据；仍缺更大规模容量基线、完整生产部署拓扑和外部依赖演练。P2。 |
| UI 与非 UI 解耦 | React 不计算公式/掉落/库存/最终结算；最终验收可脱离 UI 完成闭环 | 部分实现 | 领域和 `demo/src/server` 可单独测试；计划明确 UI 冻结 | `test:game`、`test:server` 不启动 React | UI 与 server 联调尚未完成；应在非 UI 发布阻断项关闭后，以 HTTP contract test 验收显示值与摘要一致。P3。 |

## 验证记录（2026-08-25）

## 验证记录（2026-08-26 本轮）

| 命令/检查 | 结果 |
| --- | --- |
| `npm test` | 通过，294 项：273 pass、21 skip、0 fail。 |
| `npm run typecheck:server` | 通过。 |
| `npm run build` | 通过。 |
| `npm run lint` | 通过；仅既有 `src/server/service.test.ts` 3 条 optional-chaining warning。 |
| `node --experimental-strip-types --test src/server/production-acceptance.test.ts` | 通过，4/4；仅验证工具 fail-closed 逻辑，不代表真实生产环境已验收。 |
| `npm run test:config-tools` | 通过，2/2。 |
| `npm run audit:release-inputs` | 通过；只读校验 1143 行/12 列、版本/hash、生成物漂移、content_pending 和 full_v1 provenance。 |
| `DATABASE_URL=postgresql:///dongtian_integration_20260825 npm run test:integration` | 通过，20/20：PostgreSQL 11、routing 1、reliability 7、process 1。 |

本轮新增的生产验收工具、release input audit 和参数解析 fail-fast 校验已完成工程实现；真实生产 IdP、Webhook、拓扑、容量报告和 scanner 多实例现场证据未提供，因此相关矩阵项仍保持“未验收/阻断”，不得写成生产已通过。

## 验证记录（2026-08-26 六部位门禁复验）

- `diagnoseMapEquipmentReleaseReadiness` 现对每张普通地图逐项检查六个实际槽位，缺任一槽位返回 `MISSING_TEMPLATE_FOR_SLOT`；content schema focused 14/14 通过。
- synthetic 普通地图服务 fixture 已补齐六槽位后，三项 deterministic writer/retain_rare service tests 恢复通过；没有修改正式地图或装备内容。
- `npm test` 294 项（273 pass、21 skip、0 fail）；`npm run typecheck:server`、`npm run build`、`npm run audit:release-inputs` 通过；真实 PostgreSQL integration 20/20 通过。
- `ruby docs/洞天全量审计V1.rb` 通过，`full_audit_passed validators=61 parameter_table=read_only node_release_inputs=read_only`。
- 架构文档 `/v1/buildings/{id}/queue` 已更正为实际 `/v1/buildings/{buildingId}/jobs`；取消和资源返还语义仍待正式协议，不计为缺口已完成。

以下命令在 `demo` 目录执行：

| 命令 | 结果 |
| --- | --- |
| `npm run test:game` | 通过，10/10。 |
| `npm run test:server` | 无 DB 时 148 通过/10 跳过；设置 `DATABASE_URL` 时 158/158。 |
| `npm run typecheck:server` | 通过。 |
| `npm run lint` | 通过。 |
| `npm run build` | 通过。 |

本轮追加验收：

| 项目 | 结果 |
| --- | --- |
| 内容 hash canonical 回归 | 通过，5/5。 |
| `npm test` | 通过，游戏 10/10、服务端 102/102。 |
| `DATABASE_URL=postgresql:///dongtian_integration_20260825 npm run test:integration` | 通过，1/1。 |
| 真实 PostgreSQL active release 启动 + HS256 JWT `/v1/bootstrap` | 通过，返回 `configVersion=1.0.0-frozen`。 |
| 真实 PostgreSQL 临时库排行榜 smoke | 通过，分页和空页 `total` 正确；临时库已清理。 |
| 认证 `/metrics` | 通过，返回 Prometheus 文本格式。 |
| 真实 PostgreSQL 配置 active 切换 | 通过：`1.0.0-frozen -> 1.0.1-runtime`，新参数生效，旧玩家拒绝，历史 replay 仍为旧版本。 |

| 战斗属性与收藏对象池复核 | 通过（仍为服务端切片）：`combatStats` 已用于普通地图击杀/受击和秘境 Boss 输出/受击；秘境 attempt 在 start 时持久化 `combatSnapshot`；12 本功法按 `growth.technique.pool.*` 抽取，六件首发法宝支持重复兑换。 |
| 前序完整回归 | `npm test` 游戏 10/10、服务端 111/111（无 DB 时 integration 2 项跳过）；`npm run typecheck:server`、`npm run lint`、`npm run build` 通过；`DATABASE_URL=postgresql:///dongtian_integration_20260825 npm run test:integration` 通过 2/2。 |

| 2026-08-25 admin 发布闭环复验 | `npm test` 游戏 10/10、服务端 119 项（117 通过、2 个真实 PG 用例在无 `DATABASE_URL` 时跳过）；`npm run typecheck:server`、`npm run lint`、`npm run build` 均通过；`DATABASE_URL=postgresql:///dongtian_integration_20260825 npm run test:integration` 通过 2/2。HTTP admin canary/activate/rollback 覆盖角色、reason、版本、幂等和响应脱敏；PG fake 覆盖同事务运营审计。 |
| 2026-08-25 功法 modifier 复验 | `npm test` 游戏 10/10、服务端 120 项（118 通过、2 个真实 PG 用例在无 `DATABASE_URL` 时跳过）；`npm run typecheck:server`、`npm run lint`、`npm run build` 均通过；真实 PostgreSQL integration 2/2。普通地图/秘境使用功法层数 modifier，秘境/高阶 start 保存快照；高阶实际 clear/survival 结算随后补齐。 |
| 2026-08-25 高阶战斗快照结算复验 | `npm test` 游戏 10/10、服务端 121 项（119 通过、2 个真实 PG 用例在无 `DATABASE_URL` 时跳过）；`npm run typecheck:server`、`npm run lint`、`npm run build` 均通过；真实 PostgreSQL integration 2/2。弱构筑在基准时间失败、强构筑缩短目标时间并成功，开战后研究/换装不改变结果。 |
| 2026-08-25 高阶远征供给独立验收 | `npm test` 游戏 10/10、服务端 125 项通过（2 个真实 PG 用例在无 `DATABASE_URL` 时跳过）；`npm run typecheck:server`、`npm run lint`、`npm run build` 均通过；`DATABASE_URL=postgresql:///dongtian_integration_20260825 npm run test:integration` 2/2 通过。六境界六类资源按冻结小时率结算，覆盖容量解锁、overflow、fractional carry、Boss 活跃时阻断远征、settlement 幂等和提交失败回滚。 |
| 2026-08-25 高阶远征供给独立验收 | `npm test` 游戏 10/10、服务端 125 项通过（2 个真实 PG 用例在无 `DATABASE_URL` 时跳过）；`npm run typecheck:server`、`npm run lint`、`npm run build` 均通过；`DATABASE_URL=postgresql:///dongtian_integration_20260825 npm run test:integration` 2/2 通过。六境界六类资源按冻结小时率结算，覆盖容量解锁、overflow、fractional carry、Boss 活跃时阻断远征、settlement 幂等和提交失败回滚。 |
| 2026-08-25 真实 PostgreSQL 配置发布 harness | `DATABASE_URL=postgresql:///dongtian_integration_20260825 npm run test:integration` 通过 3/3：随机版本的 canary/activate/rollback 状态、active 快照切换、前后版本状态、operator/reason/from/to 审计和 activate 幂等均通过；测试前后清理 release 表。全量 `npm test` 服务端 128 项（125 通过、3 跳过）。 |
| 2026-08-25 真实 PostgreSQL 多实例 HTTP 灰度 harness | `DATABASE_URL=postgresql:///dongtian_integration_20260825 node --experimental-strip-types --test src/server/config-release-routing.integration.test.ts` 通过 1/1；两个独立 Pool/Provider/HTTP 实例验证同一玩家稳定 canary、不同玩家稳定 bucket、activate 后跨实例切换，以及旧 settlement replay 保留原 `configVersion`。该测试已纳入 `npm run test:integration` 串行入口。 |
| 2026-08-25 真实 PostgreSQL 重启恢复与分数资源 | `DATABASE_URL=postgresql:///dongtian_integration_20260825 npm run test:integration` 通过 4/4：高阶远征启动后重建 Repository/Service，恢复容量、建筑小数 carry，完成离线结算并验证重复 settlement/replay 不重算；`inventory_resource.amount/capacity/reserved_amount` numeric 迁移已覆盖旧表兼容。全量服务端 129 项（125 通过、4 跳过）。 |
| 2026-08-25 高阶 signature skill 运行时验收 | 服务端新增六境界技能摘要和冻结参数驱动的确定性压制窗口；`npm run test:server` 130 项（126 通过、4 个真实 PG 用例跳过）通过。测试覆盖六境界参数映射、技能窗口对 `targetClearTime` 的影响、start/settle 快照一致和 replay。 |
| 2026-08-25 高阶远征 30/90 天运行时验收 | `npm run test:server` 131 项（127 通过、4 个真实 PG 用例跳过）通过；Node service harness 按 24h 分片验证元婴远征 30 天/90 天总秒数、首段 24h clipping、六类资源与冻结 hourly rate 守恒，并设高容量排除 overflow 干扰。该测试验证供给切片，不等同活动轮换、Boss 多技能或完整长期消费经济。 |
| 2026-08-25 高阶技能逐秒窗口验收 | `npm test` 游戏 10/10、服务端 133 项（129 通过、4 个真实 PG 用例跳过）；真实 PostgreSQL integration 4/4。高阶 settle 按 attempt 冻结技能周期计算 `skillSuppressedSeconds`，测试覆盖成功、技能压制导致 timeout、运行时配置变化后的快照稳定、幂等和字段持久化；周期计算已优化为 O(1)，避免超长请求线性 CPU。 |
| 2026-08-25 故障恢复与并发最终验收 | `npm test` 游戏 10/10、服务端 148 通过/10 跳过；设置 `DATABASE_URL` 时 `npm run test:server` 158/158；真实 PostgreSQL integration 9/9（含进程级 kill/restart 1/1），runtime metrics 4/4；typecheck/lint/build 通过。新增 pending settlement 重试恢复、SQL 多步骤故障回滚、ambiguous COMMIT 幂等、4 连接池 32 路 CAS（1 成功/31 stale）、metrics_event 跨实例重放和真实进程新 Pool 恢复。 |
| 2026-08-25 长期消费经济 Node 切片验收 | `long-term-economy.test.ts` 7/7；90 天固定 seed 路线和 10-500 样本确定性 99% 置信区间只读接口通过；新增 `long-term-equipment-consumption.test.ts`，正式绑定 fixture 下确定性生成 -> `retain_rare` 库存出口 -> 普通/精良分解、稀有以上出售资源账本通过，当前内容缺绑定和自动升品正式策略缺参均严格门禁；30 天因清风装备参数未冻结而返回 `VALIDATION_FAILED`。正式长期 service settlement/自动升品参数和 full_v1 战斗仍未完成；法宝重复掉落自动升星已在实时结算闭环。 |
| 2026-08-25 bounded 战斗事件审计验收 | 秘境和 synthetic `full_v1` 战斗生成有界逐秒事件（含截断标记和最终 `combat_end`）；signature-only 高阶按冻结 attempt 快照/seed 生成固定不超过 7 条的开始、技能压制、玩家输出、成功/失败和 `combat_end` 摘要；Memory/PostgreSQL JSONB round-trip、提前结算原子拒绝、提交失败回滚与 settlement replay 保持不变。正式 full_v1 参数仍未冻结。 |

| 2026-08-25 collection 事件流、装备 writer 与部署 preflight 最终验收 | collection 独立事件流已完成：Memory/PostgreSQL 自动记录 committed collection diff，payload 包含 `action/before/after`，采用 `createdAt + eventId` 结构化 cursor，HTTP 非法 cursor 统一 `VALIDATION_FAILED`；真实 PostgreSQL round-trip/cursor 通过。装备 deterministic writer 契约 5/5 通过，但正式六部位模板、地图 binding、词条与 `retain_rare` 地图出口仍缺，继续保持 `CONTENT_LOCKED`。部署 preflight 在完整虚拟生产配置下 `PASS`；这只验证配置形状，不代表真实 IdP、证书、告警端点或生产拓扑已部署。 |

| 2026-08-25 最终串行回归 | `npm test`：游戏 10/10，服务端 210 通过、19 个真实 PG/外部用例按无 DB 环境跳过（共 229 项）；`npm run typecheck:server`、`npm run lint`（仅保留既有 3 条 optional-chaining warning）、`npm run build` 均通过；完整虚拟生产配置 `npm run preflight:deployment` 为 `PASS`。`DATABASE_URL=postgresql:///dongtian_integration_20260825 npm run test:integration`：PostgreSQL 9/9、灰度 routing 1/1、reliability 7/7、process restart 1/1，共 18/18 通过。追加 signature-only 事件 3/3、长期装备 contract 4/4、长期装备 service/HTTP 13 项、地图装备/配置/服务定向测试通过，typecheck 通过。 |
| 2026-08-25 配置/内容/只读接口并行审计收口 | `npm test`：游戏 10/10，服务端 215 通过、19 跳过（共 234 项）；`npm run typecheck:server`、`npm run build` 通过，lint 仅既有 3 条测试 warning；完整虚拟生产配置 preflight 为 `PASS`；真实 PostgreSQL 串行 integration 18/18（PG 9、routing 1、reliability 7、process 1）通过。配置 release 生命周期在内存/PostgreSQL 路径统一复核快照；content manifest 文件清单与 `content_pending` 可达性门禁已接入；长期装备只读 endpoint 对 stale player 不再自动迁移。正式阻断未改变：普通地图装备模板/binding、清风 30 天参数、自动升品策略、`full_v1` 正式数值、真实 IdP/告警/生产拓扑和更大规模容量基线仍缺。 |
| 2026-08-25 配置发布生命周期门禁一致性复核 | `config-release-postgres.ts` 的 validate/canary/activate/rollback 在事务写入前统一执行完整 `validateConfigReleaseSnapshot`；直连仓储补齐 canary 百分比边界，内存 Registry 生命周期也补充快照复核。篡改持久化 manifest 时四条路径均拒绝且不改变状态/active 指针；定向配置测试 19/19，`npm run typecheck:server` 通过，lint 仅既有 3 条 warning。普通地图装备 readiness 仍是独立显式 gate，正式模板/binding/掉率缺口未伪造；`full_v1` 正式参数缺失仍保持 `signature_only_v1`。总体仍为 `partial / infrastructure_and_feature_gaps`。 |

本轮另在独立本机 PostgreSQL 数据库执行了最新迁移和真实 round-trip：两个玩家可共存同名初始装备；功法阁等级 2 离线 1 小时产出 4620 研究修为；灵田 123.5 秒小数 carry 可持久化并在离线结算后保持精确。该 smoke 尚未固化进 CI。

| 2026-08-25 参数包恢复与最终验收 | 历史冻结 CSV 恢复后 SHA-256 `7113fe72dd40ed36869408551f5f20a9e72e83af519b4a03d657296ed4987f75`，版本校验通过，全量审计只读执行 `61/61` 通过；`npm test` 游戏 10/10、服务端 220 通过/19 跳过，`typecheck:server`/构建通过，lint 仅既有 3 条 warning；虚拟生产 preflight 通过；本机 PostgreSQL 串行 integration 18/18 通过。参数表与运行时冻结包一致，正式非 UI 阻断仍不变。

## 2026-08-26 API 契约复核

- 幂等作用域已补齐：服务端 action key 绑定操作类型及目标（主行动、建筑配方、装备动作、收藏目标、秘境/高阶 realm），避免同一玩家复用 key 时跨操作错误 replay；对旧版本持久化 key 保留目标匹配兼容回读；service focused test 覆盖主行动和装备动作隔离。
- 只读预览边界已补齐：秘境/高阶 preview 不再隐式迁移 stale player 配置，直接返回 `CONFIG_VERSION_MISMATCH`，revision/audit 保持不变；`combat/preview` 继续强制 expected revision 且兼容迁移时不写状态。
- HTTP `Idempotency-Key` 已增加 512 字符/非控制字符 DTO 边界，非法值在 mutation 前返回 `VALIDATION_FAILED`。本轮证据：service 88/88、HTTP 22/22、`npm run typecheck:server` 通过，完整 `npm test` 为 240 通过/19 跳过（共 259 项），lint 仅既有 3 条 warning。当前公开战斗 start 已由 HTTP 生成 seed/attemptId；正式内容与生产外部环境阻断不变。
- 未闭合但不擅改：combat preview 装备/功法选择字段、建筑 `collection_id` 语义、snake_case/camelCase 线协议统一；现有契约没有足够字段定义，需产品/协议确认。

## 2026-08-26 当前非 UI 收口复验

- 普通地图装备 readiness 现在要求六个实际槽位：`weapon`、`armor_1`、`armor_2`、`armor_3`、`armor_4`、`accessory`；缺槽位返回 `MISSING_TEMPLATE_FOR_SLOT`。synthetic fixture 已补齐，正式地图仍因缺 `template_ids` binding 保持 `CONTENT_LOCKED`。
- 配置发布 payload Schema 已 fail-closed：冻结数值必须为有限 `number`，冻结字符串必须为非空 `string`；扩展参数拒绝空值、空字符串、`NaN`/无穷值。非法地图掉率在 service 启动前拒绝 release。
- CI 已加入 `npm run audit:release-inputs`、根目录 `ruby docs/洞天全量审计V1.rb`，并启用 pending settlement scanner preflight；Ruby 步骤使用 `working-directory: .`。
- 最终证据：本轮边界修复后 `npm test` 296 项（275 通过、21 跳过、0 失败）；lint/typecheck/build/release-input audit/preflight 通过（lint 仅既有 3 条 warning）；串行真实 PostgreSQL integration 20/20；Ruby 全量审计 61/61，参数表与 Node release inputs 均只读。
- 总体仍为 `partial / infrastructure_and_feature_gaps`。正式阻断：普通地图装备内容 binding、清风 30 天参数、自动升品正式协议、六境界 `full_v1` 参数/平衡、法宝印记兑换协议、真实生产外部依赖与目标容量 SLO；UI/CSS/素材继续冻结。

- 建筑 jobs 服务层补充缺失建筑状态的 fail-closed 校验，返回 `CONTENT_LOCKED` 而不是 TypeError/500；架构文档装备路由同步为 `/v1/equipment/{instanceId}/actions`，与 HTTP 实现和 API 详细契约一致。

## 发布阻断与推荐顺序

1. 冻结并发布三张普通地图的正式装备模板/部位/品质/词条 binding，更新 content hash 并执行 release readiness；运行时实例与 `retain_rare` 出口 writer 已闭合，只读长期 contract slice 已具备，但在此之前继续保持 `CONTENT_LOCKED`。
2. 补齐清风 30 天装备消费参数和正式自动升品策略参数，再接入长期 service 消费并用长时随机置信区间验证最终经济闭环；不使用 proposal 参数，法宝重复自动升星已完成，仍需纳入长期经济分布验证。
3. 冻结六境界 `full_v1` Boss 正式数值，接入完整多技能逐秒状态机；当前 `signature_only_v1` 仍是唯一可运行正式模式。
4. 接入真实外部告警/指标投递和生产身份服务，补长时压力、collection 状态日志与生产部署拓扑演练。

在以上阻断项完成前，不得把 fake PostgreSQL、内存 MetricsCollector、配置发布 repository 或三档秘境实现表述为生产级全量完成。

状态：`non_ui_gap_matrix_v1`，当前总体为 `partial / infrastructure_and_feature_gaps`；当前服务端测试与真实 PostgreSQL 集成结果以本轮工作记录为准；真实 PostgreSQL 多实例灰度请求路由已纳入串行 integration harness。90 天长期消费只读切片、确定性 99% 置信区间、长期装备只读生成/自动出口/资源账本 contract slice、玩家绑定 service/HTTP 只读 endpoint、可配置 pending scanner、bounded 战斗事件持久化/replay、collection 独立事件流、signature-only 高阶完整事件、法宝重复掉落自动升星和普通地图装备实例/出口运行时已接入，30 天清风路线因参数缺失严格门禁。外部告警部署、高阶正式 full_v1 多技能/逐秒参数、普通地图正式装备 content binding、自动升品正式策略参数、长时高规模容量基线和生产身份映射仍未完成。CI workflow 已加入 PostgreSQL service 与串行 integration 命令。

## 2026-08-26（Codex/Luna：正式输入设计阶段启动）

- 已完成 FI-01/FI-02、FI-03/FI-05、FI-04/随机事件专项产品决策草案，并合并为 `docs/洞天正式输入设计总草案V1.md`。
- 草案只作为评审输入，全部保持 `proposal_v1`；没有将候选掉率、full_v1 数值、自动升品 mutation、印记兑换或随机事件 runtime 写入正式包。
- 下一步等待产品确认最小决策集；确认后按 Schema/参数/内容、runtime/API/迁移、回归/release gate 顺序实现。当前 FI-01..FI-05 与随机事件仍为正式输入阻断，UI/CSS/素材继续冻结。

## 2026-08-26（Codex/Luna：非 UI MVP 本轮验收）

- 并行审计确认 runtime/API、数据库迁移、CAS/幂等和 release gate 均已有契约与回归证据；没有在不猜产品语义的前提下新增玩法实现。随机事件仍是 `proposal_v1` + opaque JSONB，FI-01..FI-05 继续阻断。
- `npm test` 已纳入 `scripts/audit-release-inputs.test.mjs`，并新增迁移执行顺序与文档一致性断言；未放宽正式 provenance/hash/content reachability 门禁。
- 最终证据：`npm test` 313 项（292 通过、21 跳过、0 失败）；真实 PostgreSQL integration 20/20；typecheck/build/release-input audit/Ruby 全量审计 61/61 通过。总体仍为 `active / partial / infrastructure_and_feature_gaps`，UI/CSS/素材继续延后。

## 2026-08-26（Codex：非 UI 权威边界与最终回归）

- 公开战斗 start 路由不再接受客户端 seed/attemptId，服务端生成并持久化；`combat/preview` 强制 expected revision，并保证兼容配置迁移时纯只读。
- 配置发布跨进程幂等已闭合：状态、operator audit 与原始响应在同一 PostgreSQL 事务内提交，同 key advisory lock，独立 Provider/Service 并发和进程重建 replay 均通过。

## 2026-08-26（Luna：自动升品只读输入边界审计）

- FI-03 对照审计确认自动升品当前只有只读长期消费规划，HTTP DTO 严格限制为 `horizonHours`/`seed`，服务层不写状态；正式目标/重复件/顺序/资源预留/继承/周期幂等-CAS/审计语义未冻结，继续禁止 mutation 猜测实现。
- 只补运行时 fail-closed：`enabled` 必须 boolean，requests 必须为数组和对象项，availableResources 仅允许已知资源且为非负安全整数，成本乘法必须保持安全整数；focused 8/8、typecheck/lint 通过。
- 本轮不修改 UI/CSS/素材、正式参数或内容 binding；FI-03 仍是正式发布阻断。

## 2026-08-26 本轮发布/运行时审计

- 复核 `main.ts` active release 启动门禁、PostgreSQL provider 快照 refresh、HTTP `x-config-version` 路由、durable operation replay 与多实例边界；未发现可安全修复的快照竞态，生产启动仍要求 active release，player 路由仍从共享 PostgreSQL 状态实时选择 canary/active。
- 新增 provider boundary command 校验：Memory/PostgreSQL `runOperation` 统一拒绝非法 operation/version、空或超长 idempotency key/requestId、空/超长 operatorSubject、非法 reason/timestamp；非法命令在事务前拒绝。配置 release focused 27/27，typecheck 通过。
- 正式阻断不变：普通地图装备 binding、清风 30 天参数、自动升品策略、`full_v1` 正式数值/平衡、真实 IdP/告警/生产拓扑和更大规模容量基线仍未满足；总体 `partial / infrastructure_and_feature_gaps`。
- migration advisory lock、metrics 全量输入校验/Prometheus label 转义、pending scanner 后台错误上报已完成并有 focused 回归。
- 验收证据：`npm test` 253 项，234 通过/19 跳过；HTTP 22/22；typecheck/build 通过；lint 仅既有 3 条 warning；虚拟生产 preflight PASS；真实 PostgreSQL integration 18/18；参数版本校验 1143 行/12 列、SHA-256 `7113fe...`；Ruby 全量审计 61/61。
- 总判定继续为 `partial / infrastructure_and_feature_gaps`。正式地图装备内容、清风 30 天参数、自动升品策略、full_v1 正式战斗参数/平衡、真实生产外部依赖和更大规模容量基线仍未完成；UI 继续延后。

| 2026-08-25 清风/自动升品 provenance 审计 | 复核 CSV 与相关文档确认清风装备掉率/六档品质池不存在，装备进阶文档为 `proposal_v1`；30 天清风路线和自动升品均继续硬门禁，不复用黑风或 proposal 数值。长期经济清风参数与长期装备自动升品 enable/成本/成功率/继承参数现在要求 `status=frozen_v1` 且有非空 `source`；数值合法但 provenance 不正式时分别返回 `UNSUPPORTED_POLICY`/`MISSING_PARAMETER`。新增 proposal provenance 回归通过；正式阻断未改变。 |
| 2026-08-25 full_v1 Boss provenance 与发布门禁审计 | 权威 CSV/生成产物仍无六境界 full_v1 的 attack/defence/accuracy/攻击间隔/完整 skills/resistances/auto_pill 字段；高阶 Boss 技能、掉落和失败文档仍为 `proposal_v1`，当前正式模式仍为 `signature_only_v1`。新增 `diagnoseHighTierCombatFormalProvenance`：内存 registry、PostgreSQL lifecycle 和 provider active/canary/historical snapshot 对 full_v1 要求每境界八类参数均 `status=frozen_v1` 且 `source` 非空；缺 provenance、proposal 或明显 synthetic/fixture source 的结构合法 fixture 不能进入发布。高阶 contract/config-release/PG 定向 29/29，typecheck 通过；正式 full_v1 数值/平衡仍需产品冻结，未伪造参数。另发现参数重建脚本会历史性地将 proposal 自动标成 frozen，需后续单独做版本迁移，本轮未改变 1.0.0 hash。 |
| 2026-08-25 长期只读投影一致性与装备正式来源审计 | `longTermEconomy`、`longTermEconomyConfidence`、长期装备消费统一拒绝 stale player 的隐式配置迁移；`long-term-economy.test.ts` 10/10 覆盖 revision/audit 不变。装备审计确认首发规格把六部位名称池、图标、外观和属性模板列为 `content_pending`，现有 `equipment.json` 仅两个精良武器且三张普通地图无 `template_ids`；继续保持 `CONTENT_LOCKED`，不使用 proposal 或 UI 静态配置补齐。 |
| 2026-08-25 生产 preflight 与 JWKS 轮换边界审计 | preflight 现在拒绝显式 `unconfigured` auth、生产 `memory` 告警 backend 和非法 `DONGTIAN_ALERT_*_THRESHOLD`；JWKS 新 `kid` rotation 在缓存未过期时触发刷新并通过回归。真实 IdP/证书/外部轮换仍未验收。配置 operator audit 已在发布事务内持久化，但 service idempotency response 仍为进程内 Map，跨进程幂等未闭合。 |
# 2026-08-25（Codex：MVP 非 UI 契约与生产边界收口）

- HTTP 写入契约已统一收口：body 字段白名单、header/body `expectedRevision` 一致性、畸形 URI 解码均有服务端门禁和回归；新增 `POST /v1/combat/start` 统一路由，真实覆盖秘境与六境界 start，普通未开放活动仍为 `CONTENT_LOCKED`。
- 认证/运营边界补强：生产 preflight 拒绝 `unconfigured` auth、`memory` alert backend、非法告警阈值；JWKS 新 `kid` 轮换已有契约测试。完整虚拟生产配置 PASS，但真实 IdP、证书、外部告警端点和生产拓扑仍未验收。
- 验证证据：`npm test` 游戏 10/10、服务端 228 通过/19 跳过；typecheck/build 通过；lint 通过（既有 3 条 warning）；真实 PostgreSQL integration 串行 18/18（9+1+7+1）通过。
- 总状态仍为 `partial / infrastructure_and_feature_gaps`。普通地图正式装备 binding、清风 30 天参数、自动升品策略、六境界 `full_v1` 正式参数/平衡、更大规模容量基线和配置发布跨进程持久化幂等继续阻断发布；UI 仍按用户要求延后。

## 2026-08-25（Luna：迁移互斥与 observability 输入完整性）

- migration 启动事务新增固定 `pg_advisory_xact_lock`，避免多副本并发执行 DDL/ALTER；成功顺序、失败 rollback 和连接 release 均有 focused test。
- metrics collector 先验证完整事件再落聚合，畸形 telemetry 不会部分污染 counters/samples；Prometheus drop/anomaly labels 做反斜杠、引号、换行转义。
- pending scanner 定时入口捕获查询异常并通过 `onError` 上报，避免后台数据库瞬断触发未处理 rejection；直接扫描仍返回原始错误供 worker 调度处理。
- PostgreSQL metrics snapshot 现在按请求时间过滤 `event_at <= at`，与内存快照时间语义一致；未来事件不会进入当前 Prometheus/alert 读数。
- 生产 deployment preflight 强制启用 pending settlement scanner；未启用时拒绝启动配置，防止 durable pending reservation 无 worker 恢复。
- 离线结算完全重叠的 0 秒分支现在也生成并持久化 `summaryHash`，与正常结算及 replay 契约一致；overlap response/record 一致性已有回归。
- 定向 migration/metrics/metrics-postgres/runtime tests 12 通过、1 个真实 PostgreSQL metrics 用例无数据库时跳过；`npm run typecheck:server` 通过。该工程切片不改变正式内容阻断；配置发布操作跨进程持久化幂等仍未闭合。

## 2026-08-25（Codex：最终验收更正）

- 持久化/迁移改动后的真实 PostgreSQL integration 已重新通过 18/18（PostgreSQL 9/9、routing 1/1、reliability 7/7、process 1/1）；此前“未执行”的旧记录仅反映当时尚未注入 `DATABASE_URL`，不代表最终结果。
- 参数版本校验为 1143 行、12 列、`1.0.0-frozen`、SHA-256 `7113fe72dd40ed36869408551f5f20a9e72e83af519b4a03d657296ed4987f75`；只读全量审计 `61/61` 通过。总体仍为 `partial / infrastructure_and_feature_gaps`。

## 2026-08-26 正式内容与自然突破链只读复核

- 普通地图装备仍由三张 `maps.json` 缺失 `equipment_drop.template_ids` 触发 `CONTENT_LOCKED/MISSING_CONTENT_BINDING`；两把精良武器不足以覆盖首发六部位/品质/属性内容，需产品内容包和 content hash。
- 清风 720h 路线缺少 `dungeon.qing_feng.equipment_drop_chance` 与六档品质池，运行时已严格诊断，不能借用黑风参数；自动升品缺少 `schedule.equipment.auto_promotion.enabled` 及正式策略 provenance。两项需正式产品输入。
- 当前高阶模式为 `signature_only_v1`，full_v1 八类六境界参数未进入冻结表；需正式战斗数值、技能/抗性/自动丹药和平衡证据后才能发布。
- 突破 transition map、`stopAction` 与 `switchAction` 已接通；训练可先结算并切换到地图，随后以新 revision 执行突破，HTTP 与 service 均有自然链路回归。离线结算仍按主行动契约保留活动，不隐式清空未结束行动。

## 2026-08-26 HTTP 写入幂等边界复核

- 依契约公共请求头，HTTP 状态写路由统一要求 `Idempotency-Key` 与 `X-Expected-Revision`；幂等 key 继续只做长度/控制字符校验，不擅自增加 UUID 格式限制。离线 settlement 以 `settlementId` 作为例外唯一幂等标识。
- 该轮仅收紧 HTTP DTO 边界；service 内部 optional idempotency 参数和秘境/高阶 attemptId replay 语义未改。缺失 header 在 mutation 前返回 `VALIDATION_FAILED`，revision/审计保持不变。
- 验证：`http.test.ts` 22/22 通过。该边界收口不解除普通地图装备 binding、清风 30 天参数、自动升品策略、full_v1 正式数值等正式阻断。

## 2026-08-26 SQL 契约字段无损持久化收口

- `equipment_instance.created_at` 已接入 runtime 可选 `createdAt` 与 PostgreSQL read/write；写回使用 `COALESCE($12, now())`，历史实例不再因任意玩家事务重写而改变创建时间，新实例仍由数据库生成时间。
- `building_state.carry_quantity`、`progress_state.random_event_state`、`progress_state.support_route_state` 已完成 Memory 默认和 PostgreSQL SELECT/map/INSERT/ON CONFLICT UPDATE；这些字段保持 opaque，仅解决非空旧值被覆盖的问题，不定义随机事件、支援路线或生产数量公式。
- 回归证据：PostgreSQL/schema focused 26/26；服务端 302 项（281 通过、21 跳过、0 失败）；typecheck/build 通过；真实 PostgreSQL integration 20/20；`npm run audit:release-inputs` 与 `ruby docs/洞天全量审计V1.rb` 通过。新增改动未触碰 UI/CSS/素材或正式参数。

## 2026-08-26 库存容量约束旧安装迁移复核

- 数据库契约要求 `amount + reserved_amount <= capacity`；此前该 check 只在 `CREATE TABLE` 中，旧安装迁移路径缺失。
- V1.001 已增加幂等约束迁移 `inventory_resource_amount_reserved_capacity`，违反历史数据时 fail-closed，避免余额被隐式修正。
- 证据：`schema-contract.test.ts` 14/14、`migrations.test.ts` 2/2、server typecheck 通过。该项工程契约已收口；FI-01..FI-05、真实生产环境证据和 UI 仍未完成。

- 配置 release 参数 provenance 门禁已补齐：生命周期对显式参数元数据拒绝 proposal/synthetic/fixture/test 来源、空 source 和非 `confirmed`/`frozen_v1` status；保留已知冻结参数的历史 value-only override 兼容路径。配置 focused 29/29、server typecheck/lint 通过。该工程修复不补 FI-01..FI-05 正式输入。

- HTTP collection action DTO 已补交叉字段门禁：research 不接受 `treasureId`，treasure_upgrade 不接受 `techniqueId/quality`；新增回归后 HTTP focused 26/26、server typecheck/lint 通过。该修复只收紧输入边界，不实现 FI-05 兑换协议。

- equipment action 幂等 key 已绑定 `lockSlots`、`slotIndex`、`target`、`targetAffix` canonical hash；同 key 不同参数在 Memory/PostgreSQL 路径均 fail-closed 为 `DUPLICATE_REQUEST`，service focused 96/96、repository focused 14/14 通过。该修复不实现自动升品或其他未冻结玩法。

- equipment 幂等 prefix guard 已移入事务：PG 在 player `FOR UPDATE` 后同连接执行冲突查询，解决并发预检查竞态；PG fake 验证 guard 在锁之后、冲突 rollback 且无 state write。service/repository focused 111/111，未修改正式玩法/UI。

## 2026-08-26（Codex：非 UI MVP 完整回归验收）

- 装备 action 幂等边界已验收：canonical fingerprint 绑定四个 mutation 参数；前缀按玩家、装备实例和 action 隔离，Memory/PostgreSQL 对参数漂移 fail-closed，旧格式 replay 保持兼容。
- 证据：`npm test` 312 项（291 通过、21 跳过、0 失败）；真实 PostgreSQL integration 20/20；typecheck/build/release-input audit 通过；Ruby `full_audit_passed validators=61`；lint 仅既有 3 条 warning。
- 该工程收口不解除 FI-01 普通地图装备 binding、FI-02 清风 30 天参数、FI-03 自动升品正式策略、FI-04 `full_v1` 正式数值/平衡、FI-05 法宝兑换协议/对象池/迁移，以及真实生产身份、告警、拓扑和容量现场证据；UI/CSS/素材继续冻结，总体保持 `active / partial / infrastructure_and_feature_gaps`。

## 2026-08-26（Codex：API 契约与最终非 UI 回归）

- API 详细契约已覆盖当前 HTTP route family，并以 `schema-contract.test.ts` `15/15` 校验文档未落后于实现；未登记未实现的随机事件、自动升品 mutation 或法宝兑换。
- 最终证据：`npm test` 313 项（292 通过、21 跳过、0 失败）；真实 PostgreSQL integration `20/20`；typecheck/build/release-input audit 通过；Ruby `full_audit_passed validators=61`。
- 随机事件因 `proposal_v1`、opaque runtime state、窗口/抽取/倍率/replay 语义缺失且脚本与文档公式口径不一致，继续作为产品输入阻断。FI-01..FI-05 和真实生产现场证据未闭合，UI/CSS/素材继续冻结。

## 2026-08-26（Codex/Luna：FI-05 与随机事件 active-release completion audit）

- active release 门禁、content reachability、HTTP/service 入口复核通过：FI-05 没有兑换 route/DTO/池入口，随机事件没有 runtime 消费入口；两者不会因现有参数或 opaque 字段而被隐式激活。
- 不新增“禁止所有未知参数”的规则，以免破坏当前结构化扩展参数契约；继续依赖正式 provenance、hash、Schema 和 content reachability 门禁。
- FI-01..FI-05 与随机事件正式契约仍未闭合，真实生产现场证据仍缺；总体保持 `active / partial / infrastructure_and_feature_gaps`。

## 2026-08-26（Luna：release input audit 纳入配置工具回归）

- 发现 `npm test` 原先没有自动触发 `audit:release-inputs`；新增 `demo/scripts/audit-release-inputs.test.mjs`，在 `test:config-tools` 通配集合中执行既有发布输入审计，校验版本、行数、参数/内容 hash、pending 数和高阶模式输出。
- 验证：配置工具 3/3、游戏 10/10、服务端 292 通过/21 跳过；该测试不扩展 unknown-parameter gate，也不解除 FI-01..FI-05、随机事件或真实生产现场阻断。
## 2026-08-26（Luna：迁移执行序列与数据库契约漂移复核）

- PostgreSQL 迁移/repository/schema-contract 复核完成：约束、父行锁/CAS、幂等、pending lease 和旧安装 invariant 有实现与测试证据；未新增玩法语义。
- 修复数据库契约迁移列表漏记 `V1_003_observability`，并用 schema-contract 断言 `V1_001` -> `V1_002` -> `V1_003` 与执行器一致。
- 全量 `npm test` 313 项（292 通过、21 跳过、0 失败）；FI-01..FI-05、随机事件正式输入、UI 和真实生产证据状态不变。

## 2026-08-26（Codex：非 UI MVP 最终主线验收）

| 范围 | 工程验收 | 正式发布状态 |
|---|---|---|
| FI-01 普通地图装备 | 三张地图、92 模板、六部位 binding、Schema 1.1、manifest/content hash、确定性 writer 与出口通过测试 | 内容包工程完成；正式发布仍需产品签收内容/外观/属性 provenance |
| FI-02 清风参数 | candidate validator 通过，候选 CSV 与中央冻结表隔离 | `proposal_v1`，不得激活或写入 frozen CSV |
| FI-03 自动升品 | 显式目标、重复件匹配/排除、资源 reserve、全批次事务、CAS、审计、cycle replay、真实 PG 重启验证通过 | 正式 enable 参数缺失，route 保持 `CONTENT_LOCKED` |
| FI-04 高阶战斗 | 当前 `signature_only_v1`、bounded combat trace 与 replay 通过 | 六境界 `full_v1` 字段、provenance 和平衡证据未冻结 |
| FI-05 印记兑换 | starter/境界池隔离、10 印记成本、0 星目标、池满、CAS/幂等/replay、legacy starter 迁移、真实 PG 重启验证通过 | 工程切片可验收；正式对象池/迁移语义需产品签收后进入 release contract |
| 随机事件 | 显式合法 runtime state 可做 UTC 窗口、确定性抽取、离线倍率结算和 replay；空状态不自动初始化 proposal | 文档/参数仍 `proposal_v1`，公式口径、provenance 和正式迁移未冻结 |

- 最终自动回归：`npm test` 335 项（313 pass、22 skip、0 fail）；真实 PostgreSQL integration `21/21`；typecheck/build/release audit 通过；Ruby 全量审计 `61/61`。
- release 基线：`1.0.0-frozen`、1143 参数行、parameter SHA `7113fe72dd40ed36869408551f5f20a9e72e83af519b4a03d657296ed4987f75`、content SHA `463e0e839708aec0ac1b3f3d808ad4210799a8b60be94962611e4b0322fef264`、`signature_only_v1`、pending objects=0。
- 总体判定仍为 `active / partial / infrastructure_and_feature_gaps`；正式阻断为 FI-02、FI-03 enable、FI-04 full_v1、随机事件正式输入和生产外部现场证据。UI/CSS/素材按用户要求最后处理。

## 2026-08-26（Luna：随机事件抽取游标持久化）

- 工程修复：随机事件离线结算跨 UTC 窗口时，`randomState.draws` 与 runtime 新窗口的 `drawIndex` 现在在同一事务内持久化；新增回归覆盖 `[0,1]` 游标和跨结算状态。
- 该项只修复 replay/audit 持久化，不定义事件概率、公式或迁移；随机事件正式输入仍为 `proposal_v1`，空状态不自动激活，FI 阻断和 UI 延后状态不变。

## 2026-08-26（Codex：继续阶段验收增量）

- 随机事件工程完整性：跨窗口 `nextDrawIndex` 已与 runtime state 同事务持久化，解决跨重启游标复用；不激活空状态或 proposal 参数。
- 生产验收完整性：sample JWT 除 JWKS/claims 验证外，还必须通过每个实例的认证只读 route；匿名 health/readiness 不再被当作实例 IdP 一致性证据。
- 候选输入质量：FI-04/随机事件 61 行 proposal 通过严格 CSV、中央隔离、来源、状态和结构化 JSON 门禁；仍不构成正式 provenance 或平衡证据。
- 最终证据：`npm test` 337（315 pass/22 skip/0 fail）、真实 PostgreSQL 21/21、typecheck/build/lint/release audit、Ruby 61/61 全部通过。正式 release 和剩余阻断不变，UI 继续延后。

## 2026-08-26（Codex：非 UI 剩余工作盘点）

| 类别 | 剩余事项 | 判定 |
|---|---|---|
| 产品正式输入 | FI-01 provenance/签收、FI-02 清风参数、FI-03 自动升品 enable/策略、FI-04 full_v1 48 字段/平衡、FI-05 对象池/迁移、随机事件参数/公式/迁移 | 不是可安全猜测的代码缺口，当前继续 fail-closed |
| Release 激活 | 新 config/content version、参数与内容 hash、迁移、canary/rollback、全量回归 | 依赖上列输入冻结后执行 |
| 生产验收 | 真实 IdP/JWKS/证书轮换、Webhook、拓扑、多实例 scanner/lease、容量 SLO | 需要部署现场证据，本地 fixture 不可替代 |
| UI | 移动端单页视觉与交互 | 按用户要求最后处理 |

## 2026-08-26 可选炼丹/炼器目标 vertical slice

| 项目 | 状态 | 验收证据 |
|---|---|---|
| 炼丹选择丹方 | 已实现 vertical slice | `POST /v1/actions/start` 的 `alchemy + recipeId`；结算读取目标 recipe、原子扣料、丹药直接入库 |
| 炼器选择装备 | 已实现 vertical slice | `forge + recipeId + equipmentTemplateId`；正式 writer 生成 `EquipmentInstance`，未知模板 `CONTENT_LOCKED` |
| 单槽切换与持久化 | 已实现 | `primary_action_target` + `targetId`，action/target 改变会先结算旧序列 |
| 多丹方/多器方正式内容 | 部分实现 | 当前冻结内容仍只有 `alchemy_basic/forge_basic`；后续需产品补充 recipe/template 对象池 |

## 2026-08-26（Luna：FI-04/随机事件候选输入门禁）

- FI-04/随机事件 proposal CSV 已有只读候选门禁：61 行完整性、来源文档存在、中央冻结表隔离、结构化 JSON 合法性和 `proposal_v1` 保持均有 focused 测试（9/9）；同步修正 RFC4180 引号和错误 reference 路径。
- 该门禁不改变 `1.0.0-frozen`、不重算正式 hash、不验证有争议的随机事件期望公式、不激活 `full_v1` 或随机事件 runtime。正式 provenance、平衡 artifact、公式和迁移语义继续阻断 release。

## 2026-08-26（Luna：global_single_slot_v1 行动序列 vertical slice）

| 范围 | 工程状态 | 验收边界 |
|---|---|---|
| 全局主动槽 | `primaryAction.modelVersion=global_single_slot_v1` 已持久化，炼气/地图/炼丹/炼器/研究序列可切换；切换先结算旧序列 | 新序列收益自动写入背包；无预排队实现 |
| 炼丹/炼器 | `alchemy_basic` / `forge_basic` 作为序列动作直接消费输入并产出 pill/equipment | 旧 `building_job` 仍兼容读写，不能视为最终单槽产品语义；迁移处理待冻结 |
| 灵田 | 不占主动槽，逐块种植、离线成熟产出保持可用 | 新增 `POST /v1/buildings/spirit_farm/plots/{plotId}/plant`，独立表持久化逐块状态；旧批次接口保留兼容，`plantId` 暂沿用统一冻结灵药产量，正式种子成本/差异产出仍待内容输入 |
| 回归 | focused 7/7；服务端 345（322 pass/22 skip，1 条旧 HTTP queue 断言待更新）；typecheck PASS | 未修改 frozen 参数、UI/CSS/素材 |

## 2026-08-26（Luna：显式灵田种植 vertical slice）

| 项目 | 本轮证据 | 剩余边界 |
|---|---|---|
| 种植状态 | `building_state` 新增 nullable `planted_plots/planted_at/mature_at`，旧 NULL 行保持兼容连续模式 | 旧存量没有显式种植历史，不做静默补种 |
| Plant route | 批次兼容 route + `POST /v1/buildings/spirit_farm/plots/{plotId}/plant` 逐块写入，幂等/CAS，成熟自动入库并清理 | 同一 plotId 重叠种植 fail-closed；`plantId` 的正式资源成本与差异化产出仍需产品冻结 |
| 成熟结算 | 显式批次沿用冻结成熟时间/速度/产量，离线结算成熟后自动入库并清空，不占主动槽 | 服务器无后台 scheduler，自动入库发生在下一次结算请求事务 |

## 2026-08-26（Luna：global_single_slot_v1 第二轮并发审计）

- 修复功法阁被动 XP 绕过：global model 下 `simulateBuildings` 不再在 active/idle settlement 被动研究，只有 `technique_research` 主动序列产生研究 XP。
- legacy 炼丹/炼器 queue route 在 global model 下即使 idle 也拒绝；历史 queue 只读/回放，不参与 global settlement 产出。现有旧 queue 测试需迁移到新动作 API。
- 秘境和高阶 Boss attempt 增加全局槽对称互斥，且 `startAction` 对 active attempt 做事务内外检查；不能在 attempt 期间启动主行动或另一 attempt。
- focused `single-slot-action.test.ts` 12/12 通过；未修改 frozen 参数、UI/CSS/素材。全量旧测试的 queue/高阶流程断言需后续按新契约更新。
# 2026-08-26 增量：主动功法与采集

| 项目 | 当前状态 | 证据/边界 |
|---|---|---|
| 功法选择挂机 | MVP vertical slice | `technique_training + techniqueId`；同时增长 cultivation 与功法 XP/属性；正式技能等级/平衡仍 proposal |
| 采药 | MVP vertical slice | `herbalism + herb_grove`，60 秒产出 `spirit_herb` 与 herbalism XP |
| 挖矿 | MVP vertical slice | `mining + ore_mine`，60 秒产出 `spirit_ore` 与 mining XP |
| 单槽/幂等/持久化 | 已复用既有契约 | `global_single_slot_v1`、settlement replay/CAS；PG 技能状态放入兼容 JSON |

## 2026-08-26 增量：技能等级/经验派生

| 范围 | 工程状态 | 验收边界 |
|---|---|---|
| 统一技能曲线 | MVP 已实现 | `levelFromXp` 使用 proposal-v1 累计门槛 `100 * (level - 1)^2`；XP 唯一持久化事实 |
| 可读技能等级 | MVP 已实现 | Bootstrap `player.skillLevels`；排行榜技能条目返回 `skillXp` 与 `skillLevel` |
| 技能覆盖 | MVP 已实现 | technique/herbalism/mining/alchemy/forge；功法按 techniqueId 分开派生等级 |
| Memory/PostgreSQL | 已兼容 | Memory 交易和 PG JSON 状态均从 XP 派生，未新增迁移列 |
| 正式平衡 | 待产品冻结 | 等级上限、XP 速率、属性/产出加成仍为 proposal，不得视为 frozen |
