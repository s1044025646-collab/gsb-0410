#!/usr/bin/env node
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { Store } from '../db';
import { Service } from '../service';
import { startServer } from '../server';
import {
  normalizePage, normalizePageSize, normalizePattern, normalizePatterns, normalizeTraining, ValidationError,
} from '../core/validate';
import { runDemo } from './demo';

const DEFAULT_DB = resolve(process.cwd(), 'data', 'segwire.db');

function parseTrainingArg(raw: string): Array<{ pattern: string; label?: number }> {
  // 形如 "abc=7"（带标签）或 "abc"（无标签），多个用分号或重复 --train 分隔。
  return raw.split(';').filter(Boolean).map((part) => {
    const [pattern, label] = part.split('=');
    const item: { pattern: string; label?: number } = { pattern: normalizePattern(pattern) };
    if (label !== undefined) item.label = Number(label); // = 后需为 0-9，normalizeTraining 会校验
    return item;
  });
}

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

function collectTrain(args: string[]) {
  const out: Array<{ pattern: string; label?: number }> = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--train') out.push(...parseTrainingArg(args[++i]));
  }
  return out;
}

function print(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

async function main(): Promise<void> {
  const [cmd = '', ...rest] = process.argv.slice(2);
  const dbPath = arg(rest, 'db') ?? DEFAULT_DB;

  if (cmd === 'serve') {
    const port = Number(arg(rest, 'port') ?? process.env.PORT ?? 0);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      process.stderr.write('端口必须是 0-65535 的整数（0 表示自动选择空闲端口，默认）\n');
      process.exitCode = 1;
      return;
    }
    mkdirSync(resolve(dbPath, '..'), { recursive: true });
    const service = new Service(new Store(dbPath));
    const { port: actual } = await startServer(service, port);
    process.stdout.write(`segwire 服务已启动: http://127.0.0.1:${actual}  (数据库: ${dbPath})\n`);
    return;
  }

  if (cmd === 'demo') {
    mkdirSync(resolve(dbPath, '..'), { recursive: true });
    const store = new Store(dbPath);
    try {
      await runDemo(new Service(store), (s) => process.stdout.write(s + '\n'));
    } finally {
      store.close();
    }
    return;
  }

  const store = new Store(dbPath);
  const service = new Service(store);
  try {
    switch (cmd) {
      case 'create': {
        const training = normalizeTraining(collectTrain(rest));
        print(service.create(training));
        break;
      }
      case 'show': {
        const id = Number(arg(rest, 'id'));
        const ver = arg(rest, 'version');
        const v = service.get(id, ver ? Number(ver) : null);
        if (!v) { print({ code: 'PROBLEM_NOT_FOUND' }); process.exitCode = 1; break; }
        print(v);
        break;
      }
      case 'list': {
        print({ problems: service.list() });
        break;
      }
      case 'append': {
        const id = Number(arg(rest, 'id'));
        const v = service.append(id, normalizeTraining(collectTrain(rest)));
        if (!v) { print({ code: 'PROBLEM_NOT_FOUND' }); process.exitCode = 1; break; }
        print(v);
        break;
      }
      case 'candidates': {
        const id = Number(arg(rest, 'id'));
        const ver = arg(rest, 'version');
        const page = normalizePage(arg(rest, 'page'));
        const pageSize = normalizePageSize(arg(rest, 'pageSize'), 20);
        const r = service.candidatesPage(id, ver ? Number(ver) : null, page, pageSize);
        if (!r) { print({ code: 'PROBLEM_NOT_FOUND' }); process.exitCode = 1; break; }
        print(r);
        break;
      }
      case 'explain': {
        const id = Number(arg(rest, 'id'));
        const pattern = normalizePattern(arg(rest, 'pattern') ?? '');
        const ver = arg(rest, 'version');
        const r = service.explain(id, ver ? Number(ver) : null, pattern);
        if (!r) { print({ code: 'PROBLEM_NOT_FOUND' }); process.exitCode = 1; break; }
        print(r);
        break;
      }
      case 'decode': {
        const id = Number(arg(rest, 'id'));
        const ver = arg(rest, 'version');
        const patternsRaw = arg(rest, 'patterns') ?? '';
        const patterns = normalizePatterns(patternsRaw.split(';').filter(Boolean));
        const r = service.decode(id, ver ? Number(ver) : null, patterns);
        if (!r) { print({ code: 'PROBLEM_NOT_FOUND' }); process.exitCode = 1; break; }
        print(r);
        break;
      }
      case 'queries': {
        const id = Number(arg(rest, 'id'));
        const ver = arg(rest, 'version');
        print({ queries: service.queries(id, ver ? Number(ver) : undefined) });
        break;
      }
      case 'export': {
        const id = Number(arg(rest, 'id'));
        const r = service.export(id);
        if (!r) { print({ code: 'PROBLEM_NOT_FOUND' }); process.exitCode = 1; break; }
        print(r);
        break;
      }
      case 'import': {
        const file = arg(rest, 'file');
        if (!file) throw new ValidationError('FILE_MISSING', 'import 需要 --file <导出json文件>');
        const payload = JSON.parse(require('node:fs').readFileSync(file, 'utf8'));
        const newId = service.import(payload);
        print({ importedProblemId: newId });
        break;
      }
      default:
        process.stdout.write([
          '用法: segwire <命令> [参数] [--db data/segwire.db]',
          '命令:',
          '  serve   [--port 0]                 启动 HTTP API（默认自动选择空闲端口）',
          '  create  --train "abc=7" ...        创建观测题（; 分隔多条，可重复 --train）',
          '  list                               列出所有观测题',
          '  show    --id N [--version V]       查看某版本状态与过滤轨迹',
          '  append  --id N --train "..."       追加训练观测，生成新版本',
          '  candidates --id N [--page 1] [--pageSize 20] [--version V]',
          '  explain --id N --pattern "ab" [--version V]',
          '  decode  --id N --patterns "ab;cde" [--version V]',
          '  queries --id N [--version V]      复查持久化的歧义报告',
          '  export  --id N                     导出 JSON',
          '  import  --file export.json         原子导入（非法载荷不影响已有题）',
          '  demo                               运行内置演示场景',
        ].join('\n') + '\n');
    }
  } catch (err) {
    if (err instanceof ValidationError) {
      print({ code: err.code, message: err.message });
    } else {
      print({ code: 'INTERNAL', message: (err as Error).message });
    }
    process.exitCode = 1;
  } finally {
    store.close();
  }
}

main().catch((err) => {
  process.stderr.write(String(err) + '\n');
  process.exitCode = 1;
});
