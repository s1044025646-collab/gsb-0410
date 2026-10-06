# segwire — 七段数码管乱序接线推断与歧义解释后端

只做后端（HTTP API + CLI），TypeScript + Node.js + 内置 SQLite（`node:sqlite`，无需任何原生编译或外部服务）。
在 Windows 本地直接运行，不依赖 Docker、WSL 或在线 API。

## 它解决什么问题

七条输入线记为 `a`–`g`，但它们接到标准七段数码管哪一段是**未知的双射**（一一对应）。
同一题中的所有显示图案共用这一套接线。给定若干训练图案（被点亮的输入线集合，可附已知数字标签），
服务枚举全部 `7! = 5040` 套接线，用固定的标准 0–9 段集合逐一过滤，输出满足全部观测的候选，
并可基于候选对待解码图案做逐位/整串的歧义解释。

前提假设：**理想显示**——无坏段、无噪声；不做图片 OCR、电路采集、颜色识别或条码扫描。

## 标准段命名与段表

```
       aaa
      f   b
      f   b
       ggg
      e   c
      e   c
       ddd
```

| 数字 | 亮段 | 数字 | 亮段 |
| --- | --- | --- | --- |
| 0 | abcdef | 5 | acdfg |
| 1 | bc | 6 | acdefg |
| 2 | abdeg | 7 | abc |
| 3 | abcdg | 8 | abcdefg |
| 4 | bcfg | 9 | abcdfg |

段集合与数字一一对应（不是只按亮段数量判断：例如 1 与 7 都可以只凭数量区分，但 2/3、5/9 等必须看具体段组合）。
段表版本标识为 `std-1`，随每个版本与导出文件持久化。

## 关键语义（务必阅读）

- **一套接线贯穿全部图案**：过滤是对 5040 个排列逐个用所有训练观测求交集，绝不为每个图案单独选接线。
- **无标签观测**：映射后的段集合必须恰好等于十个标准数字之一；**有标签观测**还必须等于该标签对应段集合。
- **重复观测允许**：重复看到同一图案不会被当作十种不同数字，也不会改变候选集合。
- **三种状态**：`unsat`（0 个候选）、`unique`（1 个）、`multiple`（>1 个）。无解时返回每条观测应用后剩余候选数量的过滤轨迹（不做最小冲突集算法）。
- **稳定排序与分页**：候选按“输入线 a→g 各自映射到的段”拼接字符串字典序稳定编号；`page/pageSize` 只影响展示页，`total` 始终是候选总数，未展示的候选不会被当作不存在。
- **查询不反哺训练**：待解码图案只用于解释，不参与过滤，不会偷偷缩小训练候选。
- **逐位与整串歧义**：每个位置给出在所有候选下出现过的数字集合、是否所有候选都可识别且数字唯一；同时公开 `recognizableCandidateCount`（全部位置都能识别的候选数）与 `partiallyUnrecognizableCount`（至少一位无法识别的候选数）。
- **整串确定性**：`displayString` 仅当**所有候选**都得到同一个有效数字串时非空，保留前导零（如 `"007"`）。系统不会把各位置的可能数字自由拼成“没有任何一套共同接线支持”的串——串是按每个候选整体求出来再取交集的。
- **版本与复查**：追加观测生成新版本（候选数单调不增），旧版本及其查询歧义报告原样保留在 SQLite 中，重启后结果一致可复查。

## 参数限制与错误码

- 训练观测最多 100 条；待解码图案最多 32 个；`pageSize` 最大 5040。
- 图案：非空字符串，字符仅 `a-g`，图案内字符不可重复；输入次序无关（`"bca"` 等价 `"abc"`）。
- 标签：必须是 `0-9` 的整数，拒绝 `1.5`、`10`、布尔等。
- 错误码（HTTP 400/404，JSON 体含 `code` 与中文 `message`）：
  `PATTERN_EMPTY`、`PATTERN_NOT_STRING`、`PATTERN_UNKNOWN_CHAR`、`PATTERN_DUPLICATE_CHAR`、
  `PATTERN_MISSING`、`LABEL_NOT_INTEGER`、`LABEL_OUT_OF_RANGE`、`TRAINING_NOT_ARRAY`、
  `TRAINING_EMPTY`、`TRAINING_TOO_MANY`、`OBSERVATION_INVALID`、`QUERY_NOT_ARRAY`、
  `QUERY_EMPTY`、`QUERY_TOO_MANY`、`PAGE_INVALID`、`PAGE_SIZE_INVALID`、`VERSION_INVALID`、
  `PROBLEM_ID_INVALID`、`PROBLEM_NOT_FOUND`、`JSON_INVALID`、`BODY_TOO_LARGE`、
  `ROUTE_NOT_FOUND`、`IMPORT_INVALID`、`INTERNAL`。

## 构建、测试、启动、演示

前置：Node.js ≥ 22（开发环境为 Node 25，使用内置实验模块 `node:sqlite`；如你的 Node 隐藏了实验模块，可用 `node --experimental-sqlite` 运行）。

```powershell
npm install
npm run build     # tsc 编译到 dist/
npm test          # 编译 + node --test 运行全部单元与 HTTP 端到端测试
npm start         # 启动 HTTP API，默认端口 0 = 自动选择空闲端口，启动后打印实际地址
npm run demo      # 内置五个演示场景（见下）
```

自定义端口 / 数据文件：

```powershell
node dist/src/cli/index.js serve --port 8080 --db data/segwire.db
# 或环境变量
$env:PORT=8080; npm start
```

数据库默认位于项目内 `data/segwire.db`（目录自动创建）。

## HTTP API

| 方法与路径 | 说明 |
| --- | --- |
| `GET /health` | 健康检查 |
| `GET /limits` | 参数上限 |
| `POST /problems` | 创建观测题，体：`{"training":[{"pattern":"abc","label":7}, {"pattern":"bc"}]}` |
| `GET /problems` | 列出所有题及最新版本状态 |
| `GET /problems/:id?version=V` | 查看某版本（默认最新）：观测、候选总数、状态、过滤轨迹 |
| `GET /problems/:id/versions` | 列出版本历史 |
| `POST /problems/:id/append` | 追加训练观测，生成新版本 |
| `GET /problems/:id/candidates?page=1&pageSize=100&version=V` | 分页查看实际映射（线→段） |
| `GET/POST /problems/:id/explain?pattern=ab` | 解释单个图案在所有候选下的数字/无法识别数量 |
| `POST /problems/:id/decode?version=V` | 体：`{"patterns":["bc","cgb"]}`，返回逐位歧义与整串结论，并存为查询报告 |
| `GET /problems/:id/queries?version=V` | 复查持久化的歧义报告（不传 version 查全部） |
| `GET /problems/:id/export` | 导出（全部版本，不含派生候选快照） |
| `POST /imports` | 原子导入导出 JSON；非法载荷整体失败，不创建/覆盖任何题 |

解码响应示例（字段含义见“关键语义”）：

```json
{
  "patterns": ["dfagce", "dfagce", "gce"],
  "report": {
    "segmentTableVersion": "std-1",
    "totalCandidates": 1,
    "recognizableCandidateCount": 1,
    "partiallyUnrecognizableCount": 0,
    "positions": [
      { "position": 0, "pattern": "dfagce", "possibleDigits": [0], "certain": true, "digit": 0 }
    ],
    "displayString": "007",
    "certain": true
  }
}
```

## CLI

```powershell
node dist/src/cli/index.js create --train "gce=7;bdfagce=8"
node dist/src/cli/index.js list
node dist/src/cli/index.js show --id 1
node dist/src/cli/index.js candidates --id 1 --page 1 --pageSize 20
node dist/src/cli/index.js explain --id 1 --pattern bc
node dist/src/cli/index.js decode --id 1 --patterns "dfagce;dfagce;gce"
node dist/src/cli/index.js append --id 1 --train "bdgc=4"
node dist/src/cli/index.js queries --id 1
node dist/src/cli/index.js export --id 1 > data/export.json
node dist/src/cli/index.js import --file data/export.json
```

`--train` 中 `图案=数字` 表示有标签，只写 `图案` 表示无标签；多条用 `;` 分隔，也可重复多个 `--train`。

## 演示场景（`npm run demo`）

1. 用一套**手写乱序接线**独立生成完整 0–9 的训练图案（字符顺序故意打乱），唯一确定接线，并解码含前导零的 `"007"`。
2. 追加一条一致观测：候选数不增加，生成新版本，旧版本保留。
3. 只有两段亮的无标签观测：仍有 240 套接线，演示部分信息下的多候选。
4. 同一图案被标为 7 和 1：无解，过滤轨迹 `[144, 0]`。
5. 重复观测同一数字两次：候选数与只观测一次相同。

## 限制

- 仅处理理想无噪显示；坏段、时序抖动、物理电平问题不在范围内。
- 无解诊断只提供观测列表与逐条过滤剩余数量，不实现最小冲突集合。
- 枚举上限固定为 7!，不处理多于七条线或非双射故障。
- `node:sqlite` 在当前 Node 中带实验性警告，不影响数据正确性（普通表、事务与 JSON 持久化）。
