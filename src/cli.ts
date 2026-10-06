import {
  createPuzzle,
  appendObservations,
  solve,
  getCandidatesPage,
  explain,
  decode,
  exportPuzzle,
  importPuzzle,
} from "./db";
import { validateObservationList, validatePattern, validatePatternList } from "./validate";
import { SEGMENT_NAMES, DIGIT_SEGMENTS, SEGMENT_TABLE_VERSION } from "./core";
import * as fs from "node:fs";

function print(x: unknown): void {
  console.log(JSON.stringify(x, null, 2));
}

function fail(e: unknown): never {
  if (e instanceof Error && "code" in e) {
    console.error(`错误 [${(e as any).code}] ${e.message}`);
  } else {
    console.error(String(e));
  }
  process.exit(1);
}

const HELP = `七段数码管乱序接线推断 CLI
用法: node dist/cli.js <命令> [参数]

命令:
  segments                                  查看标准段命名与数字段表
  create <名称> <观测JSON文件>               创建观测题，文件为 [{lines,label?},...]
  observe <题ID> <观测JSON文件>              追加观测（生成新版本）
  solve <题ID>                              计算/查看候选
  mappings <题ID> [limit] [offset]          分页查看候选映射
  explain <题ID> <图案>                     解释某个图案
  decode <题ID> <图案1,图案2,...>           解码显示串（保留前导零）
  export <题ID> [输出文件]                   导出题数据
  import <导出JSON文件>                      导入观测题（失败不影响已有数据）
`;

function main(): void {
  const [cmd, ...args] = process.argv.slice(2);
  try {
    switch (cmd) {
      case "segments":
        return print({ version: SEGMENT_TABLE_VERSION, names: SEGMENT_NAMES, digits: DIGIT_SEGMENTS });
      case "create": {
        const [name, file] = args;
        if (!name || !file) throw new Error("用法: create <名称> <观测JSON文件>");
        const observations = validateObservationList(JSON.parse(fs.readFileSync(file, "utf8")));
        return print(solve(createPuzzle(name, observations)));
      }
      case "observe": {
        const [id, file] = args;
        const observations = validateObservationList(JSON.parse(fs.readFileSync(file, "utf8")));
        const versionNo = appendObservations(Number(id), observations);
        return print({ ...solve(Number(id)), newVersion: versionNo });
      }
      case "solve":
        return print(solve(Number(args[0])));
      case "mappings": {
        const limit = args[1] ? Number(args[1]) : 50;
        const offset = args[2] ? Number(args[2]) : 0;
        return print(getCandidatesPage(Number(args[0]), limit, offset));
      }
      case "explain":
        return print(explain(Number(args[0]), validatePattern(args[1])));
      case "decode": {
        const patterns = validatePatternList(args[1].split(","));
        return print(decode(Number(args[0]), patterns));
      }
      case "export": {
        const data = exportPuzzle(Number(args[0]));
        if (args[1]) {
          fs.writeFileSync(args[1], JSON.stringify(data, null, 2));
          return console.log(`已导出到 ${args[1]}`);
        }
        return print(data);
      }
      case "import": {
        const payload = JSON.parse(fs.readFileSync(args[0], "utf8"));
        return print(solve(importPuzzle(payload)));
      }
      default:
        console.log(HELP);
    }
  } catch (e) {
    fail(e);
  }
}

main();
