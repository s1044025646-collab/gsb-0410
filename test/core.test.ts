import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allWirings,
  applyWiring,
  filterCandidates,
  explainPattern,
  decodeDisplay,
  digitOfSegmentSet,
  DIGIT_SEGMENTS,
  LINES,
} from "../src/core";
import { validatePattern, validateLabel, ApiError } from "../src/validate";
import {
  resetDbForTest,
  createPuzzle,
  appendObservations,
  solve,
  getCandidates,
  decode,
  importPuzzle,
  exportPuzzle,
} from "../src/db";

// 手写接线（夹具）：输入线 a..g -> 标准段
const WIRING = "gcfaebd";
const inv = new Map<string, string>();
LINES.forEach((l, i) => inv.set(WIRING[i], l));
const encode = (d: number) => DIGIT_SEGMENTS[d].split("").map((s) => inv.get(s)!).sort().join("");

test("标准段表自洽", () => {
  for (let d = 0; d <= 9; d++) assert.equal(digitOfSegmentSet(DIGIT_SEGMENTS[d]), d);
  assert.equal(digitOfSegmentSet("ab"), null);
});

test("枚举 5040 个接线且稳定排序", () => {
  const all = allWirings();
  assert.equal(all.length, 5040);
  const sorted = [...all].sort();
  assert.deepEqual(all, sorted);
  assert.equal(new Set(all).size, 5040);
});

test("图案校验：乱序等价、拒绝空/未知/重复字符", () => {
  assert.equal(validatePattern("cba"), "abc");
  assert.throws(() => validatePattern(""), (e: ApiError) => e.code === "EMPTY_PATTERN");
  assert.throws(() => validatePattern("abz"), (e: ApiError) => e.code === "UNKNOWN_CHAR");
  assert.throws(() => validatePattern("aab"), (e: ApiError) => e.code === "DUPLICATE_CHAR");
  assert.throws(() => validateLabel(1.5), (e: ApiError) => e.code === "INVALID_LABEL");
  assert.throws(() => validateLabel(10), (e: ApiError) => e.code === "LABEL_OUT_OF_RANGE");
  assert.equal(validateLabel(null), null);
});

test("完整十个数字训练 -> 唯一候选且等于手写接线", () => {
  const training = Array.from({ length: 10 }, (_, d) => ({ lines: encode(d), label: d }));
  const candidates = filterCandidates(training);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0], WIRING);
});

test("每个输出候选都满足全部观测（独立校验）", () => {
  const training = [
    { lines: encode(3), label: 3 },
    { lines: encode(7), label: null },
    { lines: encode(7), label: 7 }, // 重复观测
  ];
  const candidates = filterCandidates(training);
  assert.ok(candidates.length >= 1);
  for (const w of candidates) {
    for (const obs of training) {
      const digit = digitOfSegmentSet(applyWiring(w, obs.lines));
      assert.notEqual(digit, null);
      if (obs.label !== null) assert.equal(digit, obs.label);
    }
  }
});

test("重复观测不当作不同数字", () => {
  const a = filterCandidates([{ lines: encode(4), label: 4 }]);
  const b = filterCandidates([
    { lines: encode(4), label: 4 },
    { lines: encode(4), label: 4 },
  ]);
  assert.equal(a.length, b.length);
});

test("部分信息：两段亮仍有多套接线", () => {
  const candidates = filterCandidates([{ lines: "ab", label: null }]);
  assert.ok(candidates.length > 1);
  const ex = explainPattern("ab", candidates);
  // 两段亮只可能是数字 1，但接线候选仍有多套
  assert.deepEqual(ex.possibleDigits, [1]);
  assert.equal(ex.determined, 1);
});

test("同一图案标为不同数字 -> 无解", () => {
  const candidates = filterCandidates([
    { lines: "abc", label: 1 },
    { lines: "abc", label: 7 },
  ]);
  assert.equal(candidates.length, 0);
});

test("解码保留前导零且整串确定", () => {
  const training = Array.from({ length: 10 }, (_, d) => ({ lines: encode(d), label: d }));
  const candidates = filterCandidates(training);
  const result = decodeDisplay([0, 1, 2].map(encode), candidates);
  assert.equal(result.determinedString, "012");
  assert.deepEqual(result.positions, [0, 1, 2]);
});

test("歧义位置不做自由组合：整串不确定时 determinedString 为 null", () => {
  // 只训练 0 和 1，查询图案在部分候选下无法识别
  const training = [
    { lines: encode(0), label: 0 },
    { lines: encode(1), label: 1 },
  ];
  const candidates = filterCandidates(training);
  assert.ok(candidates.length > 1);
  // 查询未训练的图案：不同候选下得到不同数字或无法识别
  const result = decodeDisplay([encode(0), encode(2)], candidates);
  assert.equal(result.determinedString, null);
  assert.ok(
    result.possiblePerPosition[1].length > 1 || result.candidatesWithUnrecognized > 0,
    "第二位置应存在歧义或无法识别的候选"
  );
});

test("数据库：创建、追加版本、候选不增、导出导入", () => {
  resetDbForTest();
  const training = Array.from({ length: 10 }, (_, d) => ({ lines: encode(d), label: d }));
  const id = createPuzzle("测试题", training);
  const s1 = solve(id);
  assert.equal(s1.totalCandidates, 1);
  assert.equal(s1.status, "unique");

  const v2 = appendObservations(id, [{ lines: encode(9), label: 9 }]);
  assert.equal(v2, 2);
  const s2 = solve(id);
  assert.ok(s2.totalCandidates <= s1.totalCandidates, "追加一致观测不能增加候选数");

  const dec = decode(id, [encode(0), encode(7)]);
  assert.equal(dec.determinedString, "07");

  const exported = exportPuzzle(id) as any;
  assert.equal(exported.format, "sevenseg-wiring-export");
  const newId = importPuzzle(exported);
  assert.notEqual(newId, id);
  assert.equal(solve(newId).totalCandidates, 1);
});

test("非法导入不覆盖已有观测题", () => {
  resetDbForTest();
  const id = createPuzzle("保留题", [{ lines: "abc", label: 7 }]);
  assert.throws(
    () => importPuzzle({ format: "sevenseg-wiring-export", segmentVersion: "v1", observations: [{ lines: "abz" }] }),
    (e: ApiError) => e.code === "UNKNOWN_CHAR"
  );
  assert.equal(solve(id).totalCandidates > 0, true);
  assert.equal(getCandidates(id).length > 0, true);
});

test("无解时提供输入观测与过滤诊断", () => {
  resetDbForTest();
  const id = createPuzzle("矛盾题", [
    { lines: "abc", label: 1 },
    { lines: "abc", label: 7 },
  ]);
  const s = solve(id);
  assert.equal(s.status, "none");
  assert.equal(s.totalCandidates, 0);
  assert.ok(s.diagnostics);
  assert.equal(s.diagnostics!.totalPermutations, 5040);
  assert.equal(s.observations.length, 2);
});
