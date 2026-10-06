# 七段数码管乱序接线推断后端

纯本地后端（TypeScript + Node.js + SQLite，无 Docker / 外部服务）：给定若干"被点亮输入线集合"的训练图案（可带数字标签），枚举至多 7! = 5040 种输入线到标准段的双射，找出与全部观测一致的接线候选，并对查询图案 / 显示串做歧义解释。

## 环境要求

- Windows 本地，Node.js ≥ 22（使用内置 `node:sqlite`，无需编译原生模块）
- 首次运行 `npm install`（仅安装 TypeScript 开发依赖）

## 常用命令

```powershell
npm install        # 安装开发依赖
npm run build      # 编译 TypeScript 到 dist/
npm test           # 构建并运行全部测试
npm start          # 启动 HTTP 服务（默认自动选择空闲端口；PORT=8080 可指定）
npm run cli -- segments          # CLI：查看标准段表
npm run demo       # 运行内置演示（完整训练 + 前导零解码 / 两段歧义 / 矛盾无解）
```

数据保存在项目内 `data/sevenseg.db`，重启后结果可复查。

## 标准段命名（段表版本 v1）

空间命名：`a`=上横, `b`=右上竖, `c`=右下竖, `d`=下横, `e`=左下竖, `f`=左上竖, `g`=中横。
数字段表：`0=abcdef 1=bc 2=abdeg 3=abcdg 4=bcfg 5=acdfg 6=acdefg 7=abc 8=abcdefg 9=abcdfg`。
可通过 `GET /segments` 或 `cli segments` 查询。注意：不能只凭亮段数量判断数字（如 2/3/5 都是五段），因此推断始终基于完整段集合匹配。

## 核心规则

- **共同接线**：同一题中所有图案共用一套未知双射，候选必须同时满足全部训练观测；不会对每个图案各选一套接线。
- **训练观测**：`lines` 为 a-g 的非空、无重复子集（字符次序无关，重复观测允许且不当作不同数字）；`label` 可选，须为 0-9 整数。无标签图案映射后须恰好等于某个标准数字，有标签还须等于该数字。
- **候选**：按接线字符串字典序稳定排序；`GET /puzzles/:id/candidates?limit=&offset=` 分页查看，响应中的 `total` 始终是全部候选数，分页不影响存在性。
- **查询不反向约束**：待解码图案只作为查询，不会缩小训练候选集。
- **歧义解释**：`explain` 给出每个候选下的识别结果、可能数字集合、无法识别的候选数量；`decode` 逐位给出"所有候选下是否确定"，只有所有候选得到**相同的完整有效数字串**时 `determinedString` 才非空（保留前导零）。不会把各位置的可能数字自由组合成没有共同接线支持的串。
- **无解**：返回 `status: "none"`，并附输入观测与逐条过滤后的剩余候选数诊断（不实现最小冲突集合）。
- **版本**：追加观测生成新版本，旧版本的候选与查询报告保留；追加一致观测不会增加候选数。
- **导入导出**：`export` 输出完整 JSON；`import` 先全量校验（含段表版本），全部通过才在事务中写入新题，非法导入不会影响已有数据。

## 限制

- 训练观测总数 ≤ 64，单次查询图案数 ≤ 64，分页 limit ≤ 200。
- 仅处理理想显示：无坏段、无噪声；不做 OCR / 电路采集 / 颜色识别。
- 使用 Node 内置实验性 `node:sqlite`（启动时有一条 ExperimentalWarning，不影响功能）。

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/segments` | 标准段命名与数字段表 |
| POST | `/puzzles` | 创建观测题 `{name, observations:[{lines,label?}]}`，返回首个版本的求解结果 |
| POST | `/puzzles/:id/observations` | 追加观测，生成新版本 |
| POST | `/puzzles/:id/solve` | 计算/查看候选（结果缓存于 SQLite） |
| GET | `/puzzles/:id/candidates?limit=&offset=` | 分页查看候选映射 |
| POST | `/puzzles/:id/explain` | 解释单个图案 `{pattern}` |
| POST | `/puzzles/:id/decode` | 解码显示串 `{patterns:[...]}` |
| GET | `/puzzles/:id/export` | 导出题数据（含历史版本与查询记录） |
| POST | `/import` | 导入导出 JSON，创建新题 |

错误响应格式：`{"error":{"code":"...","message":"..."}}`，错误码包括
`EMPTY_PATTERN`、`DUPLICATE_CHAR`、`UNKNOWN_CHAR`、`PATTERN_TOO_LONG`、`INVALID_LABEL`、
`LABEL_OUT_OF_RANGE`、`TOO_MANY_OBSERVATIONS`、`TOO_MANY_PATTERNS`、`INVALID_LIMIT`、
`INVALID_OFFSET`、`PUZZLE_NOT_FOUND`、`INVALID_IMPORT`、`SEGMENT_VERSION_MISMATCH`、`INVALID_JSON` 等。

## CLI

```
node dist/src/cli.js segments
node dist/src/cli.js create <名称> <观测JSON文件>
node dist/src/cli.js observe <题ID> <观测JSON文件>
node dist/src/cli.js solve <题ID>
node dist/src/cli.js mappings <题ID> [limit] [offset]
node dist/src/cli.js explain <题ID> <图案>
node dist/src/cli.js decode <题ID> <图案1,图案2,...>
node dist/src/cli.js export <题ID> [输出文件]
node dist/src/cli.js import <导出JSON文件>
```

观测 JSON 文件示例：`[{"lines":"gce","label":1},{"lines":"ab","label":null}]`

## 项目结构

- `src/core.ts` — 段表、7! 接线枚举、候选过滤、图案解释与显示串解码
- `src/validate.ts` — 参数校验与错误码
- `src/db.ts` — SQLite 持久化（题、版本、观测、候选、查询记录）
- `src/server.ts` — HTTP API（可配置端口，默认空闲端口）
- `src/cli.ts` — 命令行入口
- `src/demo.ts` — 演示脚本
- `test/core.test.ts` — 测试（含手写接线夹具独立校验每个候选满足全部观测）
