import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { Store } from '../src/db';
import { Service } from '../src/service';
import { createApp } from '../src/server';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';

const dbPath = join(tmpdir(), `segwire-api-${Date.now()}-${Math.random()}.db`);
const store = new Store(dbPath);
const service = new Service(store);
const server = createApp(service);
let port = 0;

test.after(() => {
  server.close();
  store.close();
  rmSync(dbPath, { force: true });
});

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

async function ensureListening(): Promise<void> {
  if (port > 0) return;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port;
      resolve();
    });
  });
}

test('HTTP: 创建、分页候选、解码、追加、查询、导出导入全流程', async () => {
  await ensureListening();
  const created = await api('POST', '/problems', {
    training: [
      { pattern: 'abc', label: 7 },
      { pattern: 'ab', },
    ],
  });
  assert.equal(created.status, 201);
  const id = created.json.problemId as number;
  assert.ok(created.json.candidateCount >= 1);

  const page1 = await api('GET', `/problems/${id}/candidates?page=1&pageSize=5`);
  assert.equal(page1.status, 200);
  assert.equal(page1.json.items.length, Math.min(5, page1.json.total));
  assert.ok(page1.json.totalPages >= 1);

  const decode = await api('POST', `/problems/${id}/decode`, { patterns: ['bc', 'abc'] });
  assert.equal(decode.status, 200);
  assert.equal(decode.json.report.totalCandidates, created.json.candidateCount);

  const explain = await api('GET', `/problems/${id}/explain?pattern=abc`);
  assert.equal(explain.status, 200);
  assert.ok(explain.json.possibleDigits.includes(7));

  const append = await api('POST', `/problems/${id}/append`, { training: [{ pattern: 'abcdefg', label: 8 }] });
  assert.equal(append.status, 201);
  assert.equal(append.json.version, 2);

  const versions = await api('GET', `/problems/${id}/versions`);
  assert.equal(versions.json.versions.length, 2);

  const oldReport = await api('GET', `/problems/${id}/queries?version=1`);
  assert.equal(oldReport.json.queries.length, 1);

  const exported = await api('GET', `/problems/${id}/export`);
  assert.equal(exported.status, 200);
  const imported = await api('POST', '/imports', exported.json);
  assert.equal(imported.status, 201);
});

test('HTTP: 无解状态与过滤数量可见', async () => {
  const r = await api('POST', '/problems', {
    training: [{ pattern: 'abc', label: 7 }, { pattern: 'abc', label: 1 }],
  });
  assert.equal(r.json.status, 'unsat');
  assert.equal(r.json.candidateCount, 0);
  assert.deepEqual(r.json.filterTrace.remainingAfterEachObservation, [144, 0]);
});

test('HTTP: 非法输入返回明确错误码', async () => {
  const empty = await api('POST', '/problems', { training: [{ pattern: '' }] });
  assert.equal(empty.status, 400);
  assert.equal(empty.json.code, 'PATTERN_EMPTY');

  const badChar = await api('POST', '/problems', { training: [{ pattern: 'ax' }] });
  assert.equal(badChar.json.code, 'PATTERN_UNKNOWN_CHAR');

  const dup = await api('POST', '/problems', { training: [{ pattern: 'aa' }] });
  assert.equal(dup.json.code, 'PATTERN_DUPLICATE_CHAR');

  const badLabel = await api('POST', '/problems', { training: [{ pattern: 'abc', label: 10 }] });
  assert.equal(badLabel.json.code, 'LABEL_OUT_OF_RANGE');

  const floatLabel = await api('POST', '/problems', { training: [{ pattern: 'abc', label: 1.5 }] });
  assert.equal(floatLabel.json.code, 'LABEL_NOT_INTEGER');

  const missing = await api('GET', '/problems/999999');
  assert.equal(missing.status, 404);
  assert.equal(missing.json.code, 'PROBLEM_NOT_FOUND');
});

test('HTTP: 非法导入不会覆盖已有题', async () => {
  const before = await api('GET', '/problems');
  const bad = await api('POST', '/imports', { format: 'segwire-export/1', versions: [] });
  assert.equal(bad.status, 400);
  const after = await api('GET', '/problems');
  assert.equal(after.json.problems.length, before.json.problems.length);
});

test('HTTP: 健康检查', async () => {
  const r = await api('GET', '/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
});

test('HTTP server 类型仅用于保持引用', () => {
  const s: Server = server;
  assert.ok(s.listening);
});
