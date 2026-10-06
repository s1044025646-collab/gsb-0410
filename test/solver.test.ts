import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { DIGIT_SEGMENTS, SEGMENTS } from '../src/core/segments';
import {
  Candidate, decodeQuery, enumeratePermutations, filterCandidates, mapPattern,
} from '../src/core/solver';
import { Store } from '../src/db';
import { Service } from '../src/service';
import { ValidationError, normalizePattern } from '../src/core/validate';

// 独立手写接线（测试夹具，不经过枚举器）：输入线 -> 标准段。
const WIRING: Record<string, string> = {
  a: 'c', b: 'f', c: 'a', d: 'g', e: 'b', f: 'd', g: 'e',
};
const SEG_TO_WIRE = Object.fromEntries(Object.entries(WIRING).map(([w, s]) => [s, w]));

function wirePatternForDigit(digit: number, scramble: boolean): string {
  let wires = [...DIGIT_SEGMENTS[digit]].map((s) => SEG_TO_WIRE[s]);
  if (scramble) wires = wires.reverse();
  return wires.join('');
}

test('恰好枚举 7! 个互不相同的双射排列', () => {
  const perms = enumeratePermutations();
  assert.equal(perms.length, 5040);
  assert.equal(new Set(perms.map((p) => p.join(''))).size, 5040);
  for (const p of perms) {
    assert.equal(new Set(p).size, 7);
  }
});

test('完整十个数字（字符乱序）唯一确定接线，且每个输出候选满足全部观测', () => {
  const training = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d, i) => ({
    pattern: normalizePattern(wirePatternForDigit(d, i % 2 === 0)),
    label: d,
  }));
  const { candidates } = filterCandidates(training);
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].wireToSeg, WIRING);

  for (const cand of candidates) {
    for (const obs of training) {
      assert.equal(mapPattern(obs.pattern, cand.wireToSeg), DIGIT_SEGMENTS[obs.label!]);
    }
  }
});

test('所有候选都必须满足全部观测（抽查部分信息场景）', () => {
  const training = [
    { pattern: normalizePattern(wirePatternForDigit(8, false)), label: 8 },
    { pattern: normalizePattern(wirePatternForDigit(1, false)), label: 1 },
  ];
  const { candidates } = filterCandidates(training);
  assert.ok(candidates.length >= 1);
  for (const cand of candidates) {
    for (const obs of training) {
      assert.equal(mapPattern(obs.pattern, cand.wireToSeg), DIGIT_SEGMENTS[obs.label!]);
    }
  }
});

test('只有两段亮的无标签观测仍保留多套接线', () => {
  const { candidates } = filterCandidates([{ pattern: 'bc' }]);
  assert.ok(candidates.length > 1);
  for (const cand of candidates) {
    const seg = mapPattern('bc', cand.wireToSeg);
    assert.equal(seg.length, 2);
    assert.ok(Object.values(DIGIT_SEGMENTS).includes(seg));
  }
});

test('同一图案标为不同数字 => 无解，并暴露过滤轨迹', () => {
  const { candidates, trace } = filterCandidates([
    { pattern: 'abc', label: 7 },
    { pattern: 'abc', label: 1 },
  ]);
  assert.equal(candidates.length, 0);
  assert.deepEqual(trace.remainingAfterEach, [144, 0]);
});

test('重复观测不改变候选集合', () => {
  const once = filterCandidates([{ pattern: normalizePattern(wirePatternForDigit(3, false)), label: 3 }]).candidates;
  const twice = filterCandidates([
    { pattern: normalizePattern(wirePatternForDigit(3, false)), label: 3 },
    { pattern: normalizePattern(wirePatternForDigit(3, true)), label: 3 },
  ]).candidates;
  assert.equal(twice.length, once.length);
});

test('无标签观测只要求映射后是某个标准数字', () => {
  const { candidates } = filterCandidates([{ pattern: 'abg' }]);
  assert.ok(candidates.length > 0);
  for (const cand of candidates) {
    const seg = mapPattern('abg', cand.wireToSeg);
    assert.ok(Object.values(DIGIT_SEGMENTS).includes(seg));
  }
});

test('解码在歧义下不虚构共同接线不支持的串，保留前导零', () => {
  const training = [{ pattern: normalizePattern(wirePatternForDigit(8, false)), label: 8 }];
  const { candidates } = filterCandidates(training);
  const q = [wirePatternForDigit(0, false), wirePatternForDigit(0, false), wirePatternForDigit(7, false)]
    .map((p) => normalizePattern(p));
  const report = decodeQuery(q, candidates);
  // 标注数字 8 后有 72 套候选；"007" 只在其中部分候选下可识别，
  // 其余候选必须作为无法识别公开，而不是被悄悄丢弃。
  assert.ok(report.recognizableCandidateCount < candidates.length);
  assert.ok(report.partiallyUnrecognizableCount > 0);
  assert.equal(report.certain, false);
  assert.equal(report.displayString, null);
  assert.ok(report.positions[0].possibleDigits.length >= 1);
});

test('唯一候选时整串确定且保留前导零', () => {
  const training = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => ({
    pattern: normalizePattern(wirePatternForDigit(d, false)), label: d,
  }));
  const { candidates } = filterCandidates(training);
  const patterns = [0, 0, 7].map((d) => normalizePattern(wirePatternForDigit(d, false)));
  const report = decodeQuery(patterns, candidates);
  assert.equal(report.certain, true);
  assert.equal(report.displayString, '007');
});

test('稳定排序：候选顺序在重复计算间一致', () => {
  const training = [{ pattern: 'abc', label: 7 }];
  const a = filterCandidates(training).candidates.map((c: Candidate) => JSON.stringify(c.wireToSeg));
  const b = filterCandidates(training).candidates.map((c: Candidate) => JSON.stringify(c.wireToSeg));
  assert.deepEqual(a, b);
});

test('参数校验：空图案/未知字符/重复字符/非法标签', () => {
  assert.throws(() => normalizePattern(''), (e: Error) => (e as ValidationError).code === 'PATTERN_EMPTY');
  assert.throws(() => normalizePattern('ax'), (e: Error) => (e as ValidationError).code === 'PATTERN_UNKNOWN_CHAR');
  assert.throws(() => normalizePattern('aa'), (e: Error) => (e as ValidationError).code === 'PATTERN_DUPLICATE_CHAR');
});

test('段命名空间公开且段表覆盖十个不同数字', () => {
  assert.deepEqual([...SEGMENTS], ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  const sets = new Set(Object.values(DIGIT_SEGMENTS));
  assert.equal(sets.size, 10);
});

test('追加一致观测不会增加候选数，旧版本与歧义报告保留', () => {
  const dbPath = join(tmpdir(), `segwire-test-${Date.now()}-${Math.random()}.db`);
  const store = new Store(dbPath);
  const service = new Service(store);
  const created = service.create([3, 8].map((d) => ({
    pattern: normalizePattern(wirePatternForDigit(d, false)), label: d,
  })));
  const before = created.candidateCount;
  service.decode(created.problemId, null, [normalizePattern(wirePatternForDigit(0, false))]);
  const appended = service.append(created.problemId, [
    { pattern: normalizePattern(wirePatternForDigit(5, false)), label: 5 },
  ]);
  assert.ok(appended);
  assert.ok(appended.candidateCount <= before);
  const v1 = service.get(created.problemId, 1)!;
  assert.equal(v1.candidateCount, before);
  const oldQueries = service.queries(created.problemId, 1);
  assert.equal(oldQueries.length, 1);
  store.close();
  rmSync(dbPath, { force: true });
});
