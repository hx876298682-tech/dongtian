# 工作记录

## 2026-08-28（ZCode：settlement_committed 集合事件实装，洞府"最近入库"接通真实数据流）

- 根因：集合事件只在 collection 快照变化时写入，而普通挂机/离线结算不动 collection 字段，导致洞府"最近入库"恒为空。
- 修复：内存与 PostgreSQL 双仓库在**结算类事务**（meta.settlementId 存在）提交时追加一条 `settlement_committed` 集合事件；载荷为 结算ID/资源增项/修为增量/完成次数/失败标记。摘要读取兼容 offline_settlement 事务的 `{response, record}` 返回形（record.responsePayload.data 优先）。
- 端到端验证：start 训练 → 9 秒 → stop，`collection/events` 返回 `settlement_committed | cultivationDelta +7, completedActions 1`，前端 JournalList 已原生支持该载荷（修为 +N · 完成 N 次）。`npm test` 361 项 0 失败、build/lint 全绿。未改 API 契约形状（事件类型为新增枚举值）。

## 2026-08-28（ZCode：秘境全链路 + 排行榜 + 突破清单实装；发现并修复进度条/点击两处回归）

- 秘境完整链路：历练·秘境分段「探入」→ `GET /v1/dungeons/{id}/preview` 战前整备（Boss 血量/护盾/阶段阈值/攻击/五行、入口与自动丹药成本、可用丹药、保底计数、自身三维、门禁状态）→ `POST start` → `POST settle`（服务端确定性模拟）→ 全屏时刻型战斗回放层（逐秒事件流、BOSS 血条、×1/×2/×4 变速与跳过、成功/失败两态结算：用时/目标/资源增项/千年灵药·天外陨铁·功法·法宝掉落/BOSS 五行，失败文案明确"本场奖励 0，丹药未扣除"）。
- 排行榜实装：`GET /v1/leaderboards/{type}`，历练页🏆入口进入英雄榜页；8 类榜（战力/修为/境界/采药/挖矿/丹道/炼器/功法）chips 切换、前三奖牌、自己高亮。
- 突破清单实装：突破页按公开冻结参数（breakthrough.qi_to_foundation.* / foundation_to_core.*）逐项显示 当前值/需要值/缺口（✓✗ 清单），保留"以服务端实时校验为准"。
- 回归发现两处真实问题并修复：① 行动进度条不实时刷新——AppRoot 无秒级驱动，补 useTicker；② 引入每秒 ticker 后，IAB 自动化环境里 React 每秒全树重渲染会吞掉合成点击（playwright/cua/dom_cua 全通道点击失效，连 git stash 回滚到正常版本也无法点击，二分证明非代码回归）。修复：ticker 从 AppRoot 下沉到 ActionBar 的进度条叶子组件，冷路径（Track/CooldownCount 局部 tick），应用壳不再每秒重渲染。真实用户浏览器不受此前问题影响（合成点击为自动化特有路径），但修复后稳定性更好。
- 另发现并清理：历史遗留的第二个 vite 实例（--open）与当前实例并存造成模块竞争，已杀掉；离线层按钮补充 autoFocus。
- 验收：`tsc -b`、oxlint 0 警告、`vite build`、`npm test` 361 项（339 pass、22 skip、0 fail）、`audit:release-inputs` 通过。本轮未改服务端逻辑与冻结参数；秘境战斗回放事件结构（CombatEvent）与 `DungeonSettlementData` 全部按服务端契约透传。
- 遗留：IAB 自动化点击通道在长会话后失效（工具侧），后续回归建议重启浏览器会话或使用真实浏览器操作。

## 2026-08-27（ZCode：物品/功法/装备详情信息实装）

- 装备详情完整化：从实例 `affixes` 渲染攻击/防御/生命三维属性块、强化进度（0/10 级、每级 +6%，冻结参数）、三格词条槽（身法 +N / 五行印 / 特殊词条破甲·护体·生机·回春含品级与效果说明 / 未激活灰格）、来源地图与品质倍率；旧格式空 affixes（初始器物）容错为"属性在首次淬炼后生成"。实际属性仍标注由服务端结算取用。
- 功法详情：练功房卡片副行与确认面板、功法阁卡片展示每层成长——直接展示冻结参数因子（每层 攻+0.5 防+0.25 血+5、修炼速率 +0.02%/层、品阶倍率 ×N），不在前端做结算乘法。新增 `src/ui/content/growth.ts` 展示助手（冻结参数只读翻译）与共享 `ElementTag` 组件。
- 行囊资源格改为可点击，弹出资源详情（现有/上限/用途/来源文案，文案按运行时规则整理，属内容占位口径）；炼器预览新增基础属性预算行（slot budget 冻结值）。
- 契约观察项：`action-catalog` 的 technique 对象仍不带每层数值（当前前端读冻结参数展示，长期应由 catalog 下发）；`collection/events` 不记录 settlement 事件的问题维持待定。
- 验收：`tsc -b`、oxlint（0 警告）、`vite build`、`npm test` 361 项（339 pass、22 skip、0 fail）全绿；浏览器实测掉落装备详情（防御 56/生命 240、三空词条槽、来源百草谷）与离线修行录（27 分钟 27 次 +1890 修为）渲染正确。本轮未改服务端接口与冻结参数。

## 2026-08-27（ZCode：DT-NUM-20260827-01 练功房行动节拍 60s→6s，速率不变）

- 依产品确认（方案 A）执行冻结数值变更：`building.training_room.base_interval` 60→6s、`base_cultivation_xp` 70→7、`base_actions_per_hour` 60→600；`base_cultivation_rate=4200/h` 与 GDD"第一天炼气圆满"节奏完全不变。同步 CSV、`generate:game-config` 重生成 frozen-parameters/manifest、内容包 `parameter_sha256` 更新（944c1655…），`generate-content-package` 重跑后 content SHA 不变。
- 服务端一处语义解耦：`technique_training` 的技能 XP 由"每行动 +1"改为按累计时长每 60 秒 +1（proposal 速率不变，避免技能升级 ×10）；修为仍按 6s 行动节拍结算。地图击杀时长（30/90/240s，战斗语义）与炼丹 30s 批次间隔因整数经济约束不在本次范围。
- 引擎测试期望值同步（9870→9807、carry 用例改 6s 语境）；文档哈希汰换（数值版本 V1、架构、内容规格、FI 草案、验收矩阵等，历史工作记录保持原样）。`洞天数值版本V1.md` 记录变更号与新旧 SHA。
- 验收：`npm run generate:game-config`+`audit:release-inputs` 通过（rows=1143, sha=944c…）；`npm test` 361 项（339 pass、22 skip、0 fail）；`ruby docs/洞天全量审计V1.rb` 61/61 `full_audit_passed`；UI 行动条/离线结算均经 FROZEN_PARAMETERS 派生，无需改动即按 6s 节拍渲染。

## 2026-08-27（ZCode：按用户反馈落地 10 项交互改版；1 项冻结数值冲突待拍板）

- 洞府页：移除突破按钮与下方入库记录（突破入口移至道途页，流水入口移至行囊）；新增「洞天卡」——洞天等级、当前加成（灵田 Lv 与生长速度倍率）与升级按钮。升级弹窗按 fail-closed 呈现：服务端 `buildingIds` 暂无 cave、冻结表无洞天参数，属契约增补项，弹窗明确标注"通道尚未开启"。
- 练功房/炼丹房/炼器室改两列卡片墙：功法卡显示名称、品阶、当前等级（skillLevels.technique）；丹方卡显示消耗（库存不足红标）、产出、单批耗时；器方卡显示器名、部位、品质。点击卡片出既有 ConfirmSheet 确认流。
- 新增功法阁预览页（洞府揭幕卡可点击进入）：品阶筛选 chips、已研习 Lv 徽章、未获得功法显示获取条件（凡黄=练功房入门、玄/地=秘境、天/仙=待开放）。解锁门禁仍由服务端把守。
- 修复灵田种植弹窗"不断弹出关闭"：ConfirmSheet 增加开层 350ms 内忽略遮罩关闭的守卫（地块按钮与遮罩的点击竞态）。种子选项新增"可用途"说明（从 catalog 反查以灵草为输入的丹方名，当前为聚气丹）。
- 行动条"已完成 N 次"替换为"最近收获"（灵石+15 等），数据来自 stop/switch 响应内嵌的服务端结算摘要，不经客户端推算。
- 历练页：斩妖地图改两列紧凑卡（新增 map-grid/compact 样式，去 flavor 段落），秘境与野外斩妖改为段内二级分段切换，不再同页下滑；采集两页维持各自分段。
- 行囊改格子式（5 列物品格）：顶部 全部/装备/资源 筛选 chips；资源格显示数量（近满朱砂提示），装备格显示器物剪影+品质色+已穿角标，点击进详情。
- 道途页："战斗底蕴"更名"属性"；移除境界路线长列表，改为「叩问玄关·境界突破」仪式按钮直达突破页。
- 待拍板：用户提出"行动 6 秒一次"。核查全部文档与冻结表均无 6 秒设定；现值（修炼 60s/炼丹 30s/地图 30-240s）与 GDD"第一天炼气圆满"精确咬合（70 修为 × 60 次/小时 × 24h ≈ 10 万）。若改 6 秒且收获同比例重算（70→7），节奏不变仅反馈更频繁，需按规则走冻结数值变更（CSV+ts+manifest+Ruby 全量审计）；若收获不变则经济 ×10 且违背 GDD 节奏。等待产品确认后再动。
- 验收：`tsc -b` 通过、oxlint 0 警告、`vite build` 通过、`npm test` 361 项（339 pass、22 skip、0 fail）与基线一致；浏览器回归截图确认洞府/练功房卡片/灵田弹窗/历练两列+二级分段/行囊格子/道途/功法阁全部生效（旧标签页存在 HMR 残留的截图拼接伪影，新开标签验证正常）。本轮未改服务端代码、冻结参数、内容包。

## 2026-08-27（ZCode：修复底部确认面板缺失外壳导致布局被顶起）

- 用户反馈：功法研习与装备详情的底部面板会把底部导航顶起，缺少独立弹层。定位为重构时四处面板（练功房 TechniqueSheet、炼丹房 openAlchemyConfirm、炼器室模板预览、历练 PrepSheet）丢失了 `ConfirmSheet` 外壳，裸 fragment 作为 `.device` 的 flex 流内子项排在导航之后，挤压 `page-scroll`（457=860-146-58-199 完全吻合）并把面板渲染到导航下方。
- 修复：统一将上述四处内容包回 `<ConfirmSheet>`（遮罩+圆角底板+标题栏+关闭），灵田种植与行囊装备详情原本已有外壳未动；同时清理炼丹/炼器确认按钮里残留的无效 try/catch 包装（runMutation 内部已吞错并 toast）。
- 浏览器回归：研习面板 dialog=true、dim=true、sheet 覆盖 y605-860、nav 回到贴底 y802；行囊装备详情同样验证通过（分解按钮对已佩戴件正确禁用）。`tsc -b`、oxlint（仍仅 1 条既有提示）通过。
- 本轮仅修 UI 层弹层容器，未动服务端契约、冻结参数或业务语义。

## 2026-08-27（ZCode：前端 UI 按方案 V2 推翻重建 P0+P1 完成并通过端到端冒烟）

- 新建 `src/ui/` 全新前端：tokens/theme.css 设计令牌（玄墨青玉色板、品质/五行功能色、动效 token）、api/client.ts 类型化客户端（对齐全部服务端路由含 combat/preview、equipment actions、collection events、leaderboards）、store/GameStore.tsx 全局快照+60s 轮询+时钟校正、flows/useActionFlow 共享行动编排（STALE_REVISION 重同步、错误码→玩家话术）、components/ 框架层（身份区、资源栏、行动条 idle/running/settling/cooldown 四态渲染）、页面：洞府/练功房(12 部功法目录)/炼丹房/炼器室/灵田四格田契/历练三分段+战前整备(combat preview 只读预览+切换警告组件)/行囊(资源容量+装备实例详情 equip/unequip/reinforce/lock/salvage 全走服务端校验)/道途(六槽+真实战斗底蕴+境界路线+技艺等级)/突破页；layers/OfflineLayer 离线回归层按 SettlementData 真实分组呈现且拒绝态不提供二次获利路径。
- 删除旧 `src/App.tsx`、`src/App.css`、`src/client/api.ts`；main.tsx 指向 `ui/app/AppRoot.tsx`；index.css 移除外网 Google Fonts（遵循设计规范离线友好原则）。UI 不再在浏览器内推算任何收益，旧行为结算完全交还服务端。
- 浏览器端到端冒烟（memory 服务端 + Vite 代理）：洞府渲染→练功房选《青木长生诀》确认面板→开始修炼行动条 running→历练页百草谷战前整备展示真实战斗属性(生命1000/攻120/战力250)→开始挂机完成序列切换→挂机计数 2 场→收功后回到 idle 且修为 0→70、灵石 +15、灵矿 +3 全部来自服务端结算；行囊装备"玄铁剑·已佩戴·精良"、道途六槽/战力/境界路线正常。冒烟中发现并修复：洞府横幅缺场景渐变导致白字不可读（补 scene-dongtian）、功法品阶直出英文词表（补 mortal/yellow/xuan/earth/heaven→凡黄玄地天译表）、五行标签空值孤字。
- 验收：`tsc -b` 通过；`vite build` 通过（js 95KB gzip）；oxlint 仅剩 1 条 only-export-components 提示（context Provider+hook 同文件的标准模式）；`npm test` 361 项（339 pass、22 skip、0 fail）与基线一致。
- 契约观察项（后续与 API 契约同步）：① memory 服务端 `/v1/collection/events` 不产生 settlement 事件，洞府"最近入库"目前只能显示空态——需服务端在 settlement 落库时发事件，或前端改用 stop/switch 响应内嵌的 settlement envelope 渲染近期收益；② 收功按钮暂未加设计稿要求的二次确认面板（P5 打磨项）；③ 时刻型秘境战斗回放字段仍待 API 契约补充。
- 本地运行方式：`DONGTIAN_ALLOW_MEMORY=1 DONGTIAN_ALLOW_INSECURE_PLAYER_HEADER=1 DONGTIAN_BOOTSTRAP_PLAYER=demo-player npm run server`（端口 8787），另开 `npx vite`；未修改 `启动游戏.command` 与冻结参数。

## 2026-08-27（ZCode：前端 UI 交互与美术重设计方案 V2）

- 应用户"前端 demo 推翻重做"的要求，通读 GDD、运行时口径、解锁流程、战斗设计与现有 App.tsx 后，产出 `docs/洞天_Web版UI交互与美术重设计方案V2.md`，取代 Stitch V2 提示词文档的方案定稿地位。
- 方案要点：保留"顶部固定行动条 + 底部四页导航"框架并深化为行动条五态；导航定稿为 洞府/历练/行囊/道途；补齐 功法阁、法宝阁、秘境准备页、时刻型战斗结算四态、装备详情成长操作、离线修行录层、排行榜与设置；美术收敛为「玄墨青玉·山水为幕」方向并给出色彩/品质/五行令牌表、字体阶梯、材质语言、动效 token 与响应式规格。
- 明确两项服务端契约增补需求：离线结算结构化 summary 分组、秘境战斗回放数据字段，建议先行写入 API 契约再进入 P2/P4 实施。
- 本轮仅新增设计文档与工作记录，未修改代码、冻结参数、内容包或 runtime。

## 2026-08-27（Codex：项目历史资料归档与维护边界）

- 新增 `docs/项目结构与维护边界V1.md`、`docs/历史研究归档索引V1.md`，规定后续 agent 以当前运行时口径、API/数据库契约、服务端代码和冻结参数表为准。
- 将整个 `melvor_reverse/`、旧根目录逆向/UI 原型、历史数值/经济推演文档和参数表重建脚本移动到 `../洞天-archive-20260827/`，保留原目录层级并附归档 README。
- 保留运行时依赖的冻结 CSV、候选输入包及来源草案、内容/架构/API 文档和 Ruby 全量审计验证器；未修改 UI、runtime、内容包或冻结参数。
- 修正离线结算、FI-03/FI-05 草案和数值版本文档中的归档引用，避免路径漂移。
- 验收通过：`npm test` 361 项（339 pass、22 skip、0 fail）；`npm run typecheck:server`、lint、build、`npm run audit:release-inputs` 和 `ruby docs/洞天全量审计V1.rb`（61/61）均通过。

## 2026-08-26（Luna：生产验收与部署边界审计）

- 审计部署 preflight 与 environment acceptance：配置门禁和真实现场验收边界清晰分离，静态命令不连接外部系统；acceptance harness 对 HTTPS JWKS/JWT、双实例 readiness、scanner 跨实例 claim/过期 lease、容量报告与显式 SLO 做 bounded/fail-closed 校验。
- 收紧 acceptance harness：将已验证 sample JWT 发给每个实例的只读 leaderboard probe，避免仅凭匿名 health/readiness 错判实例认证配置已生效；新增实例认证失败回归。
- 定向服务端回归 336 项（314 pass、22 skip、0 fail）；覆盖 JWKS key rotation、webhook HTTPS/失败降级/有界停机、durable metrics scrape/fallback、PostgreSQL runtime TLS/timeout/pool 配置和 acceptance 输入校验。
- 未实施代码改动：当前剩余 IdP/JWKS/证书链、外部告警端点、生产拓扑、多实例现场和目标容量 SLO 均必须由部署环境提供，不能用本机或 fixture 代替。

## 2026-08-26（随机事件 candidate 契约门禁）

- 新增 `src/server/random-event-contract.ts`，把冻结 CSV 的随机事件行与 UTC deterministic runtime 做结构/数值一致性校验，并接入 config release 门禁；不把 proposal rows 或期望公式激活为正式玩法。
- 新增随机事件契约回归 3/3；runtime/config-release 联合 focused 25/25，server typecheck 与 release audit 通过。当前仍保持 `1.0.0-frozen`、1143 rows、`signature_only_v1`，等待正式 random-event provenance/公式冻结。

## 2026-08-26（FI-02 清风候选参数门禁）

- 新增 `scripts/validate-fi02-candidate.mjs` 与 focused 回归，校验 7 行清风候选参数的 ID 隔离、来源/状态、概率范围和品质池总和；候选值为 5% 与 `50/30/15/4/1/0`。
- 校验输出：`quality_total=100`、`expected_quality_multiplier=1.227`、`thirty_day_clears=4320`、`expected_equipment_drops=216`；focused 2/2 通过。
- 修正 proposal CSV 的 RFC4180 引号，未修改 frozen CSV、生成文件、release version、content 或 UI。正式合并仍被 `proposal_v1` 状态、版本/hash 重生成和全量平衡/provenance 门禁阻断。

## 2026-08-26（FI-03/FI-05 vertical slice）

- 新增 collection exchange 与 auto-promotion policy/cycle API；Memory/PostgreSQL 状态接线、CAS、幂等/replay、审计和 fail-closed 校验已覆盖。
- FI-05 成本固定 10，目标仅 0 星，池独立；FI-03 仅显式目标，同模板/部位/品质重复件，排除装备中/锁定实例，并执行资源保留线与全批次提交。
- 缺正式 `schedule.equipment.auto_promotion.enabled=1` 时自动升品返回 `CONTENT_LOCKED`；参数候选仅记录到 docs/fi03-parameter-rows.proposal.csv。
- focused `21/21`，server typecheck 通过；真实 PostgreSQL integration 尚待验收。

## 2026-08-26（Luna：FI-03/FI-05 产品输入设计草案）

- 只读对照 `long-term-equipment-consumption.ts`、`service.ts`、`http.ts`、`types.ts`、`V1_001_core.sql` 和正式输入缺口清单，确认自动升品仅有手动 mutation/只读规划，兑换仍只有 `research`/`treasure_upgrade`，全局 `collection_marks` 尚无安全分池迁移。
- 产出 `docs/洞天正式输入设计草案_FI03_FI05.md`（`proposal_v1`），覆盖 FI-03 调度与事务语义、FI-05 分池兑换与 legacy 迁移候选；未改代码、冻结参数、内容包或 UI。

## 2026-08-26（Luna：FI-01/FI-02 正式输入设计草案）

- 新增上层产品草案 `docs/洞天正式输入设计草案_FI01_FI02.md`，仅记录 proposal：普通地图装备模板覆盖矩阵、清风 720h/180h 支援口径、7 个参数候选、内容 binding 和验收门槛。
- 本轮未修改 demo 的冻结参数、内容包、manifest、Schema 或 runtime；清风长期经济继续保持缺参 fail-closed，普通地图装备继续等待正式 binding。

## 2026-08-26（Codex 最终验收：collection action DTO 互斥字段）

- `/v1/collection/actions` 现在按 action 拒绝交叉字段：research 不接受 `treasureId`，treasure_upgrade 不接受 `techniqueId/quality`；HTTP focused `26/26`。
- 全量 `npm test` 310 项（289 pass、21 skip、0 fail），typecheck/build/release audit 通过，lint 仅既有 3 条 warning。
- 未修改正式 collection/兑换语义、参数、内容或 UI；FI-01..FI-05 继续阻断。

## 2026-08-26（Codex 最终验收：发布来源与 pending 幂等边界）

- release provenance 校验限定在 release 生命周期与 PostgreSQL 持久化发布路径；运行时允许结构合法的 full_v1 engine fixture。config-release、config-release-postgres、full-tier focused `60/60` 通过。
- Memory/PostgreSQL 对 pending reservation 的同 settlement_id 字段不一致重试（含 pending -> pending）返回 `DUPLICATE_REQUEST`，不覆盖原 reservation；新增回归覆盖两条路径。
- 最终回归：`npm test` 310 项（289 pass、21 skip、0 fail）；typecheck/build/release audit 通过；lint 仅既有 3 条 warning；真实 PostgreSQL integration 20/20；Ruby 全量审计 61/61。
- 未修改 UI/CSS/素材、正式参数或 FI-01..FI-05 产品语义；总体仍为 `active / partial / infrastructure_and_feature_gaps`。

## 2026-08-26（Codex/Luna：CAS 与旧安装数据库 invariant 最终收口）

- 为旧安装补齐库存容量约束、carry/overflow 非负约束、玩家/建筑/库存/收藏/进度/高阶 attempt revision 非负约束，以及 settlement/audit revision 边界；迁移发现历史违反数据时 fail-closed。
- schema/migration focused `16/16`，最新全量 `npm test` 306 项（285 pass、21 skip、0 fail），真实 PostgreSQL integration `20/20`，typecheck/build/lint/release audit/Ruby `61/61` 通过；正式玩法语义、UI、素材和参数未修改。

## 2026-08-26（Codex/Luna：FI-05 与生产验收边界收口）

- FI-05 仍缺正式兑换协议，未实现 mutation；`collection_marks` 增加非负 SQL invariant 和旧安装幂等迁移，schema contract `14/14`。
- `production-acceptance` 的 Webhook HEAD 只接受 `2xx`；PostgreSQL Metrics snapshot/record 通过完整事件类型白名单拒绝未知事件。focused 合并 `14/14`，typecheck 通过。
- 合并验证：`npm test` 306 项（285 pass、21 skip、0 fail），真实 PostgreSQL integration `20/20`，build/lint/release audit/Ruby `61/61` 通过；未修改 UI 或正式参数。

## 2026-08-26（Luna：FI-05 印记兑换边界审计与计数 invariant）

- FI-05 正式兑换 route/DTO、境界池隔离、目标选择、池满、幂等/CAS/replay 和旧全局印记迁移仍未冻结；保持兑换 mutation 未实现，现有对象池外 `treasure_upgrade` 请求继续 fail-closed。
- `collection_state.collection_marks` 新增非负数据库约束及旧安装幂等补约束；同步 API/数据库契约文档和 schema contract 断言。focused schema contract 14/14 通过。
- 本轮未修改 UI/CSS/素材或正式参数，FI-05 仍阻断。

## 2026-08-26（Codex：自动升品边界修复最终回归）

- 验收 Luna 的自动升品只读输入校验：`enabled`、requests、availableResources 和成本乘积均严格校验；focused `8/8`，仍无自动升品 mutation，未修改 UI/CSS/素材。
- 全量证据：`npm test` 305 项（284 pass、21 skip、0 fail）；typecheck/build/release-input audit 通过，lint 仅既有 3 条测试 warning；真实 PostgreSQL integration `20/20`；Ruby 全量审计 `61/61`。
- 正式输入缺口不变：地图装备 binding、清风 30 天参数、自动升品正式调度策略、六境界 `full_v1` 参数/平衡、法宝印记兑换及真实生产外部依赖仍未闭合。总体 `partial / infrastructure_and_feature_gaps`，UI 延后。

## 2026-08-26（Luna：自动升品只读输入边界审计）

- FI-03 审计确认自动升品仍仅为只读长期消费规划：HTTP 只接受 `horizonHours`/`seed`，服务不写玩家状态、不做隐式配置迁移；正式调度契约缺失，因此没有实现自动升品 mutation。
- `long-term-equipment-consumption.ts` 新增 fail-closed 输入校验：`enabled` 类型、requests 数组/对象形状、可用资源 ID 与非负安全整数、成本乘法安全范围；focused 8/8，typecheck/lint 通过。
- 正式目标选择、重复件消费、执行顺序、资源预留、状态继承、周期幂等/CAS 和审计仍需产品冻结；本轮未修改 UI、正式参数或内容包。

## 2026-08-26（Luna：库存表无物理删除契约收口）

- PostgreSQL `writeChildren` 不再删除并重建 `inventory_resource`；改为按 `(player_id, resource_id)` 执行 `INSERT ... ON CONFLICT DO UPDATE`，符合库存不得物理删除的数据库契约。
- 资源数值、容量、预留、溢出和 `state_revision` 写入语义保持不变；队列/装备实例删除未改，因为存在明确完成出队或 salvage/sell 语义。
- repository focused 回归覆盖 no-DELETE/upsert，`npm test` 服务端 302 项（281 通过、21 环境跳过、0 失败）。

## 2026-08-26（Luna：random_event_state 正式语义审计）

- 随机事件文档仍为 `proposal_v1`，离线方案把离线期间随机事件处理列为尚未定案；API 没有事件 route/DTO/状态迁移协议，runtime 仅做 `random_event_state` opaque JSONB round-trip，生产模拟未消费事件状态。
- CSV/生成冻结参数表虽列出 168h、互斥、灵潮/妖兽袭扰概率与倍率，但这些参数不能替代窗口游标、服务器时间抽取、跨窗口离线结算、生产倍率作用范围、幂等/CAS/replay 等正式语义，当前存在参数 provenance 与玩法契约不一致。
- 结论：随机事件正式玩法仍保持产品输入阻断；本轮不猜测实现，不修改代码、UI、素材或正式参数。已有 Memory/PostgreSQL opaque 持久化回归继续作为工程基础。

## 2026-08-26（Codex：SQL 契约字段无损持久化收口）

- 补齐 `equipment_instance.created_at` 的 PostgreSQL 读取与写回；历史装备保留原创建时间，新实例由数据库生成时间，Memory/PostgreSQL round-trip 已覆盖。
- 补齐 `building_state.carry_quantity`、`progress_state.random_event_state`、`progress_state.support_route_state` 的 Memory 默认与 PostgreSQL 读写；三项仅作为 opaque 持久化字段，不接入未冻结的随机事件、支援路线或生产数量玩法。
- 验证：服务端 302 项（281 通过、21 环境跳过、0 失败）；typecheck/build 通过；lint 通过，仅既有 3 条 `service.test.ts` warning；真实 PostgreSQL integration 20/20；release input audit 与 Ruby 全量审计通过。总体仍为 `partial / infrastructure_and_feature_gaps`，UI/CSS/素材继续冻结。

## 2026-08-26（普通地图失败终止状态收口）

- 普通地图失败结算在同一事务内清空 `primaryAction`、写入失败冷却并保留 settlement；`stopAction` 对该预期终态兼容，避免失败后 action 卡死。
- 新增 2 条 service 回归；最终 `npm test` 为 296 项（275 通过、21 跳过、0 失败），真实 PostgreSQL integration 20/20 通过。总体仍为 `partial / infrastructure_and_feature_gaps`。

## 2026-08-26（当前回归：建筑状态 fail-closed 与契约文档同步）

- 建筑 jobs 服务层对缺失建筑状态返回 `CONTENT_LOCKED`，新增回归确认 revision/资源不变；取消、资源返还、部分完成仍按正式 MVP 契约保持未定义。
- 架构文档装备接口同步为 `POST /v1/equipment/{instanceId}/actions`。
- 最新验收：`npm test` 296 项（275 通过、21 跳过、0 失败）；lint/typecheck/build/release-input audit 通过，串行真实 PostgreSQL integration 20/20 通过；lint 仅既有三条 warning。总体仍为 `partial / infrastructure_and_feature_gaps`。

## 2026-08-26（当前非 UI MVP 收口复验）

- 普通地图装备发布门禁检查六个实际槽位：`weapon`、`armor_1`、`armor_2`、`armor_3`、`armor_4`、`accessory`；缺失返回 `MISSING_TEMPLATE_FOR_SLOT`。synthetic fixture 已同步，正式内容包仍未改动。
- 配置发布 payload Schema 现为 fail-closed：冻结数值要求有限 `number`，冻结字符串要求非空 `string`；扩展参数拒绝 `null`/`undefined`、空字符串、`NaN`/无穷值。非法地图掉率在 service 启动前拒绝 release。
- CI 增加 `npm run audit:release-inputs` 与根目录 Ruby 全量审计，preflight 注入 pending scanner 开关，Ruby 步骤固定从仓库根目录执行。
- 最终验收：`npm test` 295 项（274 通过、21 跳过、0 失败）；`npm run lint` 通过，仅既有 `service.test.ts` 三条 warning；typecheck/build/release-input audit/preflight 通过；真实 PostgreSQL integration 20/20；Ruby 全量审计 61/61。总体仍为 `partial / infrastructure_and_feature_gaps`，UI 最后处理。
- 建筑 jobs 服务层对缺失建筑状态增加 `CONTENT_LOCKED` fail-closed 门禁及回归测试；架构文档装备路由同步为 `/v1/equipment/{instanceId}/actions`，与实际 HTTP/API 契约一致。


## 2026-08-26（当前非 UI 收口复验）

- 普通地图装备发布门禁新增六实际槽位检查：每张地图必须绑定 `weapon`、`armor_1`、`armor_2`、`armor_3`、`armor_4`、`accessory`，否则返回 `MISSING_TEMPLATE_FOR_SLOT`；synthetic service fixture 已同步补齐，正式内容未改。
- 架构文档建筑任务路由纠正为 `/v1/buildings/{buildingId}/jobs`；取消/返还/部分完成语义未冻结，保持未实现。
- `npm test` 294 项（273 通过、21 跳过、0 失败）；`npm run typecheck:server`、`npm run build`、`npm run audit:release-inputs` 通过；真实 PostgreSQL integration 20/20。
- `ruby docs/洞天全量审计V1.rb` 通过，61 个验证器通过，参数表和 Node release input 阶段均只读。
- 五项正式输入/协议阻断（地图装备内容、清风 30 天、自动升品、full_v1、法宝印记兑换）仍未猜测实现；总体保持 `partial / infrastructure_and_feature_gaps`。

## 2026-08-25

- 生产验收切片：新增 `src/server/deployment-preflight.ts`，提供不连接外部系统的部署前配置闸门。
- 检查范围：PostgreSQL URL、生产认证与 JWT 强度、禁止内存/静态配置/不安全回退、PostgreSQL 指标后端、HTTPS 告警 webhook、定时器/端口边界。
- 新增 `npm run preflight:deployment`，失败时输出配置键和原因，不输出 secret/token 值。
- 新增 3 个配置契约测试，并在 `src/server/README.md` 记录真实 PostgreSQL、IdP、证书链、告警端点仍需环境验收。
- 验证：`npm run lint -- --deny-warnings` 通过；部署 preflight 测试通过。
- CLI 验证：完整的虚拟生产环境输出 `deployment preflight: PASS`；空环境输出 `FAIL` 且返回非零。
- `npm run typecheck:server` 最终通过；真实 PostgreSQL/JWKS/证书/告警端点未在本地伪造或连接，仍需部署环境验收。
- 全量回归本次新增 preflight 测试通过；`npm test` 当前另有 2 个既有失败（HTTP collection route 返回 404、collection event 测试资源不足），未改动其业务/UI范围。

### 高阶 Boss signature-only 事件审计

- 新增 `src/server/high-tier-signature-combat.ts`，按 attempt 冻结快照与 seed 生成固定不超过 7 条的 `combatEvents`：开始、首个技能压制窗口、压制摘要、玩家输出阶段、成功/失败结果和最终 `combat_end`。长时只做 O(1) 周期统计，不按 targetClearTime 扩展数组；未增加正式参数，也未启用 `full_v1`。
- `startHighTier` 写入起始事件，`settleHighTier` 只对 signature-only attempt 重建确定性摘要；Memory/PostgreSQL 通过整体事务 JSONB 保存，提前 settle、失败、幂等 replay、提交失败回滚均不留下半状态。
- 新增 `high-tier-signature-combat.test.ts`。定向 signature/full/contract 15/15、service 高阶 82/82、HTTP/PG/schema 40/40 通过；`npm run typecheck:server` 通过；lint 仅既有 `service.test.ts` 3 条 warning。根工作记录和非 UI 验收矩阵已同步，正式 `full_v1` 数值仍保持独立门槛。

### 持久化与 pending settlement 验收

- PostgreSQL config release 空 `parameter_payload` 不再静默使用进程内冻结参数，改为 `RELEASE_INVALID`；migration runner 统一事务执行并在半失败时 rollback。
- pending settlement 支持兼容旧 `Date` 的复合 cursor `{ createdAt, settlementId }`，Memory/PostgreSQL 对同时间戳记录使用稳定 tie-break。
- 定向测试 27/27；全量 `npm test` 247 项中 228 通过、19 跳过；`npm run typecheck:server`、`npm run build` 通过。真实 PG integration 因未设置 `DATABASE_URL` 未执行，UI/CSS/素材/正式参数未改。

## 2026-08-26（Luna：库存容量约束旧安装迁移补齐）

- `inventory_resource` 的 `amount + reserved_amount <= capacity` 原先仅在新表创建时声明，旧安装不会补齐；V1.001 现通过幂等 DO 块增加命名约束 `inventory_resource_amount_reserved_capacity`。
- 迁移对违反历史不变量的数据保持 fail-closed；没有自动调整 amount、reserved 或 capacity。
- 验证：`schema-contract.test.ts` 14/14、`migrations.test.ts` 2/2、`npm run typecheck:server` 通过。UI/CSS/素材、正式参数和 FI-01..FI-05 未修改。

## 2026-08-26（Luna：配置 release 参数 provenance 门禁）

- 配置 release 生命周期新增普通参数 provenance 校验：显式 status 仅允许 `confirmed`/`frozen_v1`，source 必须非空且拒绝 proposal/synthetic/fixture/test 来源；保留已知冻结 ID 的历史 value-only override 兼容性。
- 新增普通参数 status/source focused 回归；`config-release` 定向测试 29/29、`npm run typecheck:server`、`npm run lint -- --quiet` 通过。正式产品输入与 UI 未修改，FI-01..FI-05 和真实生产验收仍保持阻断。

## 2026-08-26（Luna：collection HTTP DTO 交叉字段拒绝）

- collection action DTO 现在拒绝 research 的 `treasureId` 和 treasure_upgrade 的 `techniqueId/quality` 交叉字段，避免 service 忽略字段导致幂等与审计语义歧义。

## 2026-08-26（Luna：装备操作幂等参数绑定）

- equipment action 的幂等 key 现在绑定 `lockSlots`、`slotIndex`、`target`、`targetAffix` 的 canonical hash；同 equipment action 前缀已存在不同请求 fingerprint 时返回 `DUPLICATE_REQUEST`，避免同 key 参数漂移导致 replay 或重复 mutation。
- Memory/PostgreSQL 均支持前缀查询；PG 使用 `left(action_key, length($1)) = $1`。service focused 96/96、repository focused 14/14、typecheck/lint 通过，未改正式玩法数值。

## 2026-08-26（Luna：装备幂等 prefix 并发竞态收口）

- 幂等 prefix 冲突检查移入 repository transaction guard：PostgreSQL 在 player `FOR UPDATE` 和 exact replay recheck 后，使用同一 SQL client 查询 prefix；Memory 保持相同事务回调顺序。
- PG fake 回归确认冲突 `DUPLICATE_REQUEST` 只 rollback、不执行 mutation；service/repository focused 合计 111/111，typecheck/lint 通过。旧格式 action key replay 兼容保留。
- HTTP focused `26/26`、server typecheck/lint 通过；未修改兑换、随机事件或其他正式产品语义，FI-01..FI-05 仍未解除。

## 2026-08-26（Codex：非 UI MVP 完整回归验收）

- 完成装备 action 幂等参数绑定验收：fingerprint 覆盖 `lockSlots`、`slotIndex`、`target`、`targetAffix`；同一玩家/实例/action 的不同 fingerprint 返回 `DUPLICATE_REQUEST`，revision、资源与审计保持不变；旧 key replay 兼容保留。
- `npm test`：312 项，291 通过、21 跳过、0 失败；`typecheck:server`、build、release input audit 通过；lint 仅既有 3 条 warning。
- 真实 PostgreSQL integration：20/20（PostgreSQL 11、routing 1、reliability 7、process 1）；Ruby 全量审计：61 个 validator 通过，参数与 Node release inputs 只读。
- 未修改 UI/CSS/素材、正式参数或未冻结玩法。FI-01..FI-05 与真实生产环境证据继续阻断发布，总体 `partial / infrastructure_and_feature_gaps`。

## 2026-08-26（Codex：API 契约与最终非 UI 回归）

- API/数据库契约文档已登记当前 HTTP adapter 的全部 route family，并明确随机事件、自动升品 mutation、法宝印记兑换仍未实现；新增文档-route 一致性测试，schema focused `15/15`。
- 最终 `npm test`：313 项，292 通过、21 跳过、0 失败；真实 PostgreSQL integration `20/20`；typecheck/build/release audit 通过；Ruby 61 validators 全部通过；lint 仅既有 3 条 warning。
- 随机事件继续保持 opaque persistence/fail-closed；proposal 文档与验证脚本存在公式/统计口径差异，未猜测接入。FI-01..FI-05、真实生产环境证据和 UI 仍未完成。

## 2026-08-26（Codex/Luna：FI-05 与随机事件 active-release completion audit）

- 复核 release hash/schema/provenance/content reachability 和 HTTP/service 入口：兑换、随机事件没有可达 mutation；未知 collection action 与未登记内容继续 fail-closed。
- 随机事件仅 opaque JSONB 持久化，缺正式窗口/抽取/倍率/离线/replay 契约；文档 `proposal_v1` 与验证脚本统计口径不一致，未改公式或接入 runtime。
- 本轮未修改代码、正式参数、内容包或 UI；FI-01..FI-05、真实生产 IdP/Webhook/拓扑/容量证据继续阻断。

## 2026-08-26（Luna：release input audit 纳入配置工具回归）

- `npm test` 原先未自动执行 `audit:release-inputs`；新增 `scripts/audit-release-inputs.test.mjs`，执行既有审计脚本并校验 release audit 输出的版本、行数、参数/内容 SHA、pending 数和高阶模式字段。
- 配置工具 3/3、游戏 10/10、服务端 292 通过/21 跳过；未增加未知参数 gate 或任何未冻结玩法语义。FI-01..FI-05、随机事件正式契约和 UI 继续冻结。
## 2026-08-26（Luna：迁移执行序列与数据库契约漂移复核）

- 审计迁移、PostgreSQL repository 与 schema-contract，确认核心约束、父行锁/CAS、幂等、pending claim/lease 及旧安装 invariant 补齐；未发现能脱离产品输入安全新增的玩法状态逻辑。
- 修复契约文档漏记 `V1_003_observability`：文档同步三段迁移顺序，schema-contract 绑定 `migrationFiles` 与文档顺序，防止启动执行器和书面契约再次漂移。
- `npm test`：313 项，292 pass、21 skip、0 fail；未修改 FI-01..FI-05、随机事件、UI/CSS/素材或冻结参数。

## 2026-08-26（Luna：非 FI/随机事件 runtime API 交叉审计）

- 交叉核对 `service/http/repository/types` 与正式 API/数据库契约：主行动、离线结算、后台生产、库存、装备成长/出口、秘境与高阶战斗、突破、收藏研究/升星、回放、排行榜、配置发布、CAS/幂等和 pending lease 均有实现与回归；没有发现可不猜产品语义而安全实现的缺口。
- 本轮无代码变更；继续保持随机事件 opaque JSONB、FI-01..FI-05 与真实生产现场证据的 fail-closed 边界，UI/CSS/素材和正式参数未改。
- 验证：`npm test` 313 项（292 pass、21 skip、0 fail）；`typecheck:server`、build、release-input audit 通过，release `1.0.0-frozen` / 1143 rows / `signature_only_v1`。
## 2026-08-26（Codex/Luna：非 UI MVP 本轮验收）

- 并行审计 runtime/API、迁移和 release gate；没有发现可脱离正式产品输入安全补齐的玩法 mutation，随机事件和 FI-01..FI-05 保持 fail-closed。
- 新增 `scripts/audit-release-inputs.test.mjs`，把 release input 版本/hash/行数/pending/high-tier 模式校验纳入 `npm test`；同步 API/数据库契约中的 `V1_003_observability` 迁移顺序，并以 schema contract 防漂移。
- 最终验证：`npm test` 313 项（292 pass、21 skip、0 fail）；真实 PostgreSQL integration 20/20；typecheck、build、release-input audit、Ruby 61 validators 全部通过。冻结 release 为 `1.0.0-frozen` / 1143 rows / `signature_only_v1`。
- 未修改 UI/CSS/素材、正式参数或未冻结玩法；剩余产品输入与真实生产证据阻断保持不变。
## 2026-08-26（Codex/Luna：正式输入设计阶段启动）

- 并行完成三份产品输入专项草案，并合并为 `docs/洞天正式输入设计总草案V1.md`；草案均为 `proposal_v1`，不驱动 runtime。
- 评审范围覆盖普通地图装备内容/清风 30 天、自动升品/法宝印记兑换、六境界 full_v1/随机事件；冻结参数、内容包、Schema、SQL、runtime 和 UI 均未修改。
- 已把候选默认与必须拍板的决策分开记录；产品确认后才进入 Schema、参数 hash、API/迁移、测试和 release gate 实现。

## 2026-08-26（Luna：FI-05 PostgreSQL 分池余额持久化）

- `postgres-repository.ts` 已将 `collection_state.mark_balances` 纳入读写；读取旧安装时将正值 legacy `collection_marks` 一次性投影为 `starter`，并保留旧计数兼容。
- 新增 focused 仓储回归：分池读取、legacy fallback、事务写入参数，`postgres-repository.test.ts` 17/17 通过；`typecheck:server` 通过。
- 新增真实 PostgreSQL FI-05 兑换重启集成测试，验证 starter/nascent_soul 隔离和 repository restart round-trip。当前环境未设置 `DATABASE_URL`，该集成测试按约定 skip，待有数据库环境复跑。
- 追加 schema-contract 与 collection-exchange focused 回归，合计 19/19 通过。
## 2026-08-26（Codex/Luna：批准方案非 UI MVP vertical slice 验收）

- 完成 FI-01 正式内容包生成：三张地图 92 个模板（含 2 个 legacy replay 模板）、六部位 binding、Schema 1.1 注册表与内容 hash；保留旧实例模板 ID 兼容。
- 完成 FI-03 自动升品策略/周期 route：显式目标、重复件匹配与排除、资源 reserve、全批次事务、CAS、审计、cycle 幂等 replay；缺正式 frozen enable 参数时 fail-closed。
- 完成 FI-05 兑换与 PostgreSQL 分池余额持久化；完成随机事件合法 runtime state 的离线生产倍率结算与 current route，opaque legacy state 不迁移。
- 验证：`npm test` 331（309 pass/22 skip/0 fail）；focused 21/21 + random 8/8；typecheck、build、release audit、Ruby 61 validators 全部通过。真实 PG 集成因 `DATABASE_URL` 未配置按约定跳过。
- UI/CSS/素材和 frozen CSV 未修改；FI-02、FI-04、随机事件正式输入及真实生产现场证据继续阻断发布。

## 2026-08-26（Codex：非 UI MVP 最终主线验收）

- 主线 `npm test` 335 项（313 pass、22 skip、0 fail）；config-tools 5/5、game 10/10，服务端和 release gate 均通过。
- 真实 PostgreSQL integration `21/21`：核心 12/12、routing 1/1、reliability 7/7、process restart 1/1；覆盖 FI-05 分池兑换重启、自动升品 cycle replay、CAS/幂等、pending scanner、配置发布和多实例路由。
- `npm run typecheck:server`、`npm run build`、`npm run audit:release-inputs` 通过；Ruby 全量审计输出 `full_audit_passed validators=61 parameter_table=read_only node_release_inputs=read_only`。
- release 基线未变：`1.0.0-frozen` / 1143 rows / parameter SHA `7113fe...` / content SHA `463e0e...` / `signature_only_v1` / pending=0。
- FI-01、FI-03、FI-05 的工程 vertical slice 已验收，但 FI-02 清风、FI-03 正式 enable、FI-04 full_v1、随机事件正式参数/provenance 和生产外部依赖仍保持 fail-closed；UI/CSS/素材未改。

## 2026-08-26（Luna：随机事件抽取游标持久化）

- 随机事件 settlement 现在把 `settleRandomEventRange` 返回的 `nextDrawIndex` 写回 `randomState.draws`，避免跨窗口/跨进程重启复用旧抽取游标。
- 新增跨窗口回归：窗口 drawIndex `[0,1]`、持久化 draws=2；服务端全量 `336`（314 pass、22 skip、0 fail）。未激活 proposal 参数或修改 UI。

## 2026-08-26（Codex：继续阶段最终验收）

- 随机事件 settlement 同事务持久化 `nextDrawIndex`；生产 acceptance 使用已验证 JWT 探测每个实例认证只读 route；两项均有 fail-closed 回归。
- FI-04/随机事件 candidate gate 校验 61 行 proposal 的完整性、隔离、来源和 JSON 结构；RFC4180 CSV 已修复，未合并 frozen 参数。
- `service.test.ts` 的 3 条 lint warning 已清零；focused service 96/96。
- 最终 `npm test` 337（315 pass/22 skip/0 fail），config-tools 9/9；真实 PG 21/21；typecheck/build/lint/release audit 和 Ruby 61 validators 通过。
- release 基线不变，未改 UI/CSS/素材；FI-02、FI-03 enable、FI-04 full_v1、随机事件正式输入和生产现场证据继续阻断。

## 2026-08-26（Codex：非 UI 剩余工作盘点）

- 代码层没有发现新的大块玩法缺口；剩余事项主要是正式输入签收、release 激活和生产现场验收。
- 待冻结输入：FI-01 provenance、FI-02 清风参数、FI-03 正式 enable/策略、FI-04 full_v1 48 字段/平衡、FI-05 对象池/迁移语义、随机事件参数/公式/迁移。
- 输入冻结后再做版本/hash/manifest 重生成、迁移与 canary release；当前 proposal 不直接驱动 runtime。真实 IdP/JWKS/Webhook/拓扑/scanner/SLO 仍需部署现场验收，UI 延后。

## 2026-08-26（Codex：用户玩法设定对照复验）

- 只读复核最新玩法设定与 `global_single_slot_v1` 服务端：单行动切换、自动结算入库、灵田独立成熟、斩妖与突破链路有代码/测试证据；未修改 UI、CSS、素材、冻结参数或 runtime。
- 玩法缺口仍为：功法选择后的功法属性/修为双增长与专精功法、丹方/器方选择、逐块灵田作物、采药、挖矿、技能等级/榜单和正式装备实例产出。
- `npm test` 352（330 pass、22 skip、0 fail）；`npm run typecheck:server` 与 `npm run audit:release-inputs` 通过。前端仍是本地 Mock，不能据此宣称已支持真实联机游玩。
# 2026-08-26（Luna：FI-04/随机事件候选输入门禁）

- 新增 `scripts/validate-fi04-candidate.mjs` 与测试，对 61 行 FI-04/随机事件 proposal 包做完整性、来源文件存在、中央表隔离和 `proposal_v1` 状态校验；允许高阶 mode 行显式替换冻结 `signature_only_v1` 作为候选，但禁止其他 ID 重叠。
- 修复候选 CSV 严格 RFC4180 解析问题和一个不存在的 reference 文档路径；未触碰 frozen CSV、生成参数、manifest、runtime 或 UI。
- focused config-tools 9/9 通过；正式 `full_v1`、随机事件公式/provenance/迁移语义仍未激活。

## 2026-08-26（Luna：global_single_slot_v1 第二轮并发审计）

- global model 下关闭功法阁被动 XP，避免训练/战斗或 idle settlement 继续增长研究等级；研究主动序列仍正常结算。
- global model 下 legacy `queueBuildingJob` 在 idle 也拒绝，旧队列只读不结算，避免两条后台生产线绕过单槽；停止动作保留 modelVersion。
- 秘境/高阶 attempt 与 action slot 做对称互斥，startAction、startDungeon、startHighTier 都有事务门禁，避免活动 attempt 与主行动并存。
- focused `single-slot-action.test.ts` 12/12 通过。旧后台队列测试及一个高阶旧流程需按新 action contract 迁移。

## 2026-08-26（Luna：全局行动序列玩法审计）

- 当前实现确认是一个 `primaryAction` 加多条独立 `building_job`/被动建筑结算；离线 settlement 同时调用主行动模拟和 `simulateBuildings`，炼丹/炼器等并非只在 UI 自动运行。
- 现有榜单类型只有 `realm`、`cultivation_xp`、`combat_power`，没有丹道/炼器技能等级字段；若改为 Melvor 式行动竞争，需要新增技能状态、动作 XP、榜单读模型和排序契约。
- 全局单行动序列是跨模块玩法迁移，不能仅在 `primaryAction` 或前端加互斥。最小方案应版本化 `active_action`（类型/目标/开始/余数/技能快照），把生产和研究动作纳入同一结算槽位；旧 building job 的完成/取消返还/冻结、资源预留和离线边界必须先冻结。
- 本轮只完成审计和工作记录，没有改 runtime、冻结参数、内容包或 UI。

## 2026-08-26（Luna：global_single_slot_v1 行动序列 vertical slice）

- `primaryAction` 增加 `modelVersion`，PG `player_state` 增加 `primary_action_model_version`；旧安装默认迁移到 `global_single_slot_v1`。
- `startAction` 新增炼丹、炼器、功法研究、法宝研究序列；启动不同序列自动结算旧序列，生产收益直接进入资源/装备/研究状态。
- 灵田仍作为非序列成熟产出；focused `single-slot-action.test.ts` 7/7 通过。旧建筑队列在活动序列期间拒绝，历史数据仍可读/结算；取消/返还/冻结语义待产品确认。

## 2026-08-26（Luna：单行动 focused 回归补充）

- `single-slot-action.test.ts` 新增切换结算、炼丹/炼器互斥切换、资源不足原子性、settlement replay 与 action 幂等/CAS 断言；focused 6/6 通过。
- `http.test.ts` 新增生产序列 start/switch 路由回归；focused HTTP route 通过。现有旧 HTTP 测试仍断言 active action 时 legacy building job 可排队，与当前 guard（400、要求 stop_action）冲突，需主线更新断言。
- 未新增数量 DTO；`PrimaryAction` 当前没有有限生产 `quantity/remaining` 字段，资源耗尽后的动作自动停止语义仍待产品/契约冻结。

## 2026-08-26（Luna：显式灵田种植 vertical slice）

- 新增 `POST /v1/buildings/spirit_farm/plant`（`plots`、`expectedRevision`、幂等键），写入可持久化 `planted_plots/planted_at/mature_at`；不占主动序列，不引入未冻结种子成本。
- 显式批次沿用冻结成熟时间、建筑速度倍率和每 plot 产量；离线结算成熟后自动入库并清空批次。旧安装 `planted_plots=NULL` 保持连续灵田兼容模式，避免静默改变旧经济。
- SQL migration、PostgreSQL round-trip 映射、HTTP/service/schema focused 回归已补；typecheck 通过。显式作物重叠种植 fail-closed，需先完成成熟结算。
# 2026-08-26（Codex：global_single_slot_v1 玩法验收）

- 全局主动槽已统一炼气、普通地图、炼丹、炼器、功法研究和法宝研究；启动新序列先完成旧序列结算，再替换 `primaryAction`。
- 炼丹/炼器序列输出直接写入资源/装备，完整批次扣料，短缺不会部分扣款；不再通过领取动作收取。
- 新增显式灵田种植 route `POST /v1/buildings/spirit_farm/plant`，种植状态持久化并在成熟后的下一次离线结算自动入库；灵田不占主动槽。
- global model 下 legacy building queues 不再创建或被动产出，秘境/高阶 Boss attempt 与主动序列互斥；旧队列仅保留兼容读取/回放。
- 验收：`single-slot-action.test.ts` 12/12；`npm test` 352（330 pass、22 skip、0 fail）；typecheck、build、lint 通过。
- 待冻结边界：正式生产数量 DTO、丹道/炼器技能等级与排行榜、旧 building job 取消/返还/冻结迁移；未修改 UI、素材或 frozen 参数。
# 2026-08-26（Codex：全局单行动序列文档一致性同步）

- 同步架构、数据结构、API/数据库契约、战斗系统、统一状态模拟、首发内容、建筑生产/调度 proposal、新手引导、UI 规格和 MVP 开发规划。
- 所有权威入口明确 `global_single_slot_v1`：主动序列只能有一个，启动新序列先结算旧序列；炼丹/炼器自动入库；灵田显式种植不占槽；legacy building job 不作为当前玩法入口。
- proposal 文档保留历史并行经济计算，但增加“仅用于未来平衡研究，不得指导当前 API/UI/runtime”的口径说明。
- 新增 `docs/洞天当前运行时口径V1.md` 作为统一阅读入口，避免后续 agent 把历史 proposal 并行模型当成当前玩法。
- 更新文档没有改动 frozen 参数、content manifest、数据库迁移、服务端代码或 UI 代码。
# 2026-08-26（Codex：用户目标玩法对照审计）

- 对照用户提出的 Melvor 风格四页面和行动序列设定审计服务端、数据结构、API、内容包及当前 Mock UI。
- 单槽行动切换、基础炼丹/炼器、斩妖地图、灵田批次成熟、背包和突破服务端链路已有；功法选择属性成长、逐块灵田作物、采药、挖矿、可选丹方/器方、完整炼器实例和技能榜单尚未闭合。
- 当前 UI 仍是本地 Mock：洞天/历练/成长/背包，角色为弹窗，未接服务端；本轮未改 UI。
- 详细矩阵见 `docs/洞天玩法设定对照审计V1.md`。
## 2026-08-26 灵田逐块 vertical slice

- 新增独立灵田地块状态 `spiritFarmPlots` 与 SQL 表 `spirit_farm_plot_state`，保存 `plotId/plantId/plantedAt/matureAt/stateRevision`。
- 新增 `POST /v1/buildings/spirit_farm/plots/{plotId}/plant`；支持并行地块、幂等/CAS、重叠种植拒绝。
- 离线结算逐块成熟自动入库并清除，不占 global single action slot；旧批次种植状态继续兼容。
- focused tests 与 server typecheck 通过；未修改 UI/frozen 参数。
## 2026-08-26（Luna：可选炼丹/炼器目标 vertical slice）

- 新增 `alchemy`/`forge` 主行动 DTO；生产目标持久化到 `primary_action_target`，旧基础 action id 保持兼容。
- 炼丹按 recipe 结算材料与丹药；炼器选择正式装备模板并通过 writer 生成实例，未知目标拒绝，不改变 frozen 内容包。
- focused 单槽测试覆盖目标持久化、实例生成和未知模板 fail-closed；server typecheck 通过。
# 2026-08-26（Luna：主动功法与采集玩法 vertical slice）

- `startAction`/`switchAction` 增加 `technique_training`、`herbalism`、`mining` 目标；全局槽切换先结算旧序列。
- 练功结算双增长：cultivation + `skillProgress.techniqueXp/techniqueAttributes`；采集直接入库 `spirit_herb`/`spirit_ore` 并增加技能 XP。
- HTTP DTO 新增 `techniqueId`、`mapId`，PostgreSQL 兼容保存 `skillProgress`；未改 UI/frozen 输入。
- 验收：server typecheck 通过；focused single-slot 16/16；功法/采集手工结算验证通过。

## 2026-08-26（Codex：用户玩法服务端 MVP 收口）

- 验收功法/采集、可选丹方/器方、逐块灵田和技能榜单组合行为；当前可测试单行动切换、功法挂机双增长、采药、挖矿、指定丹方、指定器方生成装备实例、逐块灵田成熟自动入库。
- 正式平衡、内容对象池、种子成本/产出仍待冻结；UI 未改。
- 最终验证：`npm test` 357（335 pass、22 skip、0 fail）、typecheck/build/lint/release audit 通过。

## 2026-08-26（Codex：持续目标本轮收口）

- 本轮只做验收收口：已完成的 global single slot、功法/采集、生产目标、逐块灵田、技能 XP/榜单及持久化边界保持不变，UI 未修改。
- 技能等级和行动目录子任务仍待最终回报；全量回归需在这些变更落地后重新执行。
- 未冻结的正式内容、数值、随机事件和 FI 输入继续 fail-closed。

## 2026-08-26（Codex：手游式 UI 交互重构）

- 重写 `src/App.tsx` / `src/App.css` / `src/index.css`，固定四项手游导航、顶部角色/行动条、底部安全区导航和抽屉式二级流程；移除领取收益、第五导航和旧队列表现。
- 本地演示状态支持单行动切换结算、功法/采药/挖矿 XP 资源演示、炼丹扣料产出、炼器扣料生成装备、逐块灵田种植与成熟自动入库；采药/挖矿使用独立目标选择抽屉。
- 320×568、375×667、390×844 均验证 body/root 不滚动，四个主页面内容不进入底部导航；背包使用资源/装备分段，避免短屏溢出；无数据表格布局。
- 当前 UI 尚未接入真实服务端 bootstrap/catalog/auth/mutation，仍明确是本地可玩 Demo；不把本地假数据宣称为线上状态。
- 验证：`npm run build`、`npm run lint -- --quiet`、`npm test` 通过；全量服务端回归 361（339 pass、22 skip、0 fail）。

## 2026-08-26（Luna：行动目标目录只读契约）

- 新增 `GET /v1/action-catalog`；目录返回功法、丹方、器方/装备模板、斩妖地图及采药/挖矿地图，附带选择字段、来源、解锁状态和 `released/proposal_v1/content_pending` 状态。
- 采集目标和 `focus_cultivation` 明确标记 `proposal_v1`；目录读取不结算、不迁移、不修改玩家 revision，保持 `global_single_slot_v1`。
- HTTP focused catalog 回归与 server typecheck 通过；同步 API/schema contract，未修改 UI 或 frozen 输入。

## 2026-08-26（Luna：技能等级派生 MVP）

- 新增统一 `levelFromXp`（proposal-v1：累计门槛 `100 * (level - 1)^2`），XP 为唯一事实，不新增 PG 列。
- Bootstrap/player 读取暴露 `skillLevels`；Memory/PostgreSQL 技能排行榜同时返回 `skillXp` 与 `skillLevel`。
- 炼丹/炼器 settlement response 增加对应 `skillXpDelta`；focused skill tests 3/3，server typecheck PASS。
- 未修改 UI、frozen 参数、内容包；正式技能平衡仍待冻结。

## 2026-08-26（Codex：手游式 UI 远程联调收口）

- 四项主导航和固定手游壳层完成：顶部角色/资源/单行动进度条，底部洞府/历练/背包/角色，主内容一屏显示且不使用页面滚动。
- 二级玩法完成抽屉交互：功法、丹方、器方、采药、挖矿目标分页选择；斩妖地图目录切换；灵田四块地逐块种植；角色突破和装备详情。
- 远程模式接入 `/v1/bootstrap`、`/v1/action-catalog`、行动 start/switch/stop、突破和灵田 plot planting；修复远程地图 ID 和 `plot_1`/植物内容 ID 映射。
- 真实服务端联调成功：功法启动、采集切换自动结算旧序列、灵田种植持久化；本地 fallback 仍可试玩。
- 验证：`npm run build`、lint、`npm test` 全部通过；361 项测试 339 通过、22 跳过、0 失败。
