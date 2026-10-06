/** 演示脚本：
 *  1) 用一套手写乱序接线生成完整十个数字的训练图案，解码含前导零的显示串；
 *  2) 只有两段亮的观测 -> 仍有多套接线；
 *  3) 同一图案被标为不同数字 -> 无解，并输出过滤诊断。
 */
import { resetDbForTest, createPuzzle, solve, explain, decode, appendObservations } from "./db";
import { DIGIT_SEGMENTS, LINES } from "./core";

resetDbForTest();

// 手写接线：输入线 a..g -> 标准段（打乱的排列）
const WIRING = "gcfaebd"; // a->g, b->c, c->f, d->a, e->e, f->b, g->d
const inv = new Map<string, string>();
LINES.forEach((l, i) => inv.set(WIRING[i], l));
function encode(digit: number): string {
  return DIGIT_SEGMENTS[digit].split("").map((s) => inv.get(s)!).sort().join("");
}

console.log("=== 演示 1：完整十个数字训练 + 解码含前导零的显示串 ===");
const training = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => ({ lines: encode(d), label: d }));
const p1 = createPuzzle("演示-完整训练", training);
const s1 = solve(p1);
console.log(`候选数: ${s1.totalCandidates}，状态: ${s1.status}`);
const display = [0, 1, 2, 3].map(encode); // 显示串 "0123"（含前导零）
const dec = decode(p1, display);
console.log(`解码显示串: ${dec.determinedString}`);

console.log("\n=== 演示 2：只有两段亮的观测 -> 多套接线 ===");
const p2 = createPuzzle("演示-两段", [{ lines: "ab", label: null }]);
const s2 = solve(p2);
console.log(`观测 {ab}（无标签），候选数: ${s2.totalCandidates}，状态: ${s2.status}`);
const ex = explain(p2, "ab");
console.log(`图案 ab 可能为数字: ${ex.possibleDigits.join(",")}`);

console.log("\n=== 演示 3：同一图案标为不同数字 -> 无解 ===");
const p3 = createPuzzle("演示-矛盾", [
  { lines: "abc", label: 1 },
  { lines: "abc", label: 7 },
]);
const s3 = solve(p3);
console.log(`候选数: ${s3.totalCandidates}，状态: ${s3.status}`);
console.log("诊断:", JSON.stringify(s3.diagnostics));

console.log("\n=== 附加：追加一致观测不增加候选 ===");
const v2 = appendObservations(p1, [{ lines: encode(5), label: 5 }]);
const s1b = solve(p1);
console.log(`追加后版本: ${v2}，候选数: ${s1b.totalCandidates}（追加前: ${s1.totalCandidates}）`);
