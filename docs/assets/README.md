# 资产 Manifest 说明

这里提供 `DT-M6-004` 的机器可读资产清单样例和校验规则。

## 文件

- `assets/manifest.json`: 当前样例清单。
- `assets/manifest.schema.json`: 对应 JSON Schema。
- `assets/localization/zh-CN.json`: 样例本地化表。

## 约定

- `content_id` 使用稳定 ID 风格。
- `name_key` / `description_key` 只存本地化 key，不直接存中文。
- `resource.relative_path` 必须是相对路径，且不能越出 `assets/` 根目录。
- `resource.file_name` 必须和路径 basename 一致。
- `resource.format` 与扩展名一致，且只允许 `svg/png/webp/wav/ogg/mp3`。
- `resource.placeholder=true` 表示开发占位。
- `resource.placeholder=true` 的 P0 条目在发布模式下必须阻断。

## 校验模式

- `pnpm asset:validate:dev`: 允许占位资源，但会返回 `degraded=true` 并保留告警。
- `pnpm asset:validate`: 默认发布模式，任何 P0 占位或缺失真实资源都会失败。

## 当前样例状态

当前清单只放了结构、路径、元数据和本地化 key，所有资源都还是占位态。发布门禁会因此失败，这是预期行为。
