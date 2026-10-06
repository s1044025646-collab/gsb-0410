import { Service } from '../service';
import { DIGIT_SEGMENTS, SEGMENTS } from '../core/segments';

// 手写的乱序接线（夹具，与求解器枚举相互独立）：
// 输入线 -> 标准段。
const HAND_WIRING: Record<string, string> = {
  a: 'd', b: 'g', c: 'b', d: 'f', e: 'a', f: 'e', g: 'c',
};
const SEG_TO_WIRE: Record<string, string> = Object.fromEntries(
  Object.entries(HAND_WIRING).map(([w, s]) => [s, w]),
);

// 用手写接线生成某个数字被观测到的输入线集合（字符顺序故意打乱）。
function observeDigit(digit: number): string {
  const standard = DIGIT_SEGMENTS[digit];
  const wires = [...standard].map((s) => SEG_TO_WIRE[s]);
  // 反转顺序，证明输入字符次序不影响集合含义。
  return wires.reverse().join('');
}

export async function runDemo(service: Service, log: (s: string) => void): Promise<void> {
  log('=== 场景 1：完整十个数字经同一乱序接线训练，解码含前导零的显示串 ===');
  log(`手写接线 输入线->标准段: ${SEGMENTS.map((w) => `${w}->${HAND_WIRING[w]}`).join(' ')}`);
  const fullTraining = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => ({
    pattern: observeDigit(d),
    label: d,
  }));
  log('训练图案（字符顺序故意打乱）: ' + fullTraining.map((t) => `${t.pattern}=${t.label}`).join('  '));
  const p1 = service.create(fullTraining);
  log(`创建观测题 #${p1.problemId}，候选数=${p1.candidateCount}，状态=${p1.status}`);

  // 解码 "007"：0、0、7 三位，保留前导零。
  const queryPatterns = [observeDigit(0), observeDigit(0), observeDigit(7)];
  log('待解码显示串图案: ' + queryPatterns.join(' '));
  const dec = service.decode(p1.problemId, null, queryPatterns)!;
  log(`解码结果: displayString=${JSON.stringify(dec.report.displayString)} certain=${dec.report.certain}`);

  const page = service.candidatesPage(p1.problemId, null, 1, 5)!;
  log(`候选分页: total=${page.total} 第1页返回 ${page.items.length} 条，totalPages=${page.totalPages}`);

  log('');
  log('=== 场景 2：追加一条一致观测不能增加候选数，且生成新版本 ===');
  const before = p1.candidateCount;
  const v2 = service.append(p1.problemId, [{ pattern: observeDigit(4), label: 4 }])!;
  log(`追加前候选数=${before}，新版本 v${v2.version} 候选数=${v2.candidateCount}（未增加）`);
  const oldVersions = service.versions(p1.problemId)!;
  log(`历史版本保留: ${oldVersions.map((x) => `v${x.version}(${x.candidateCount})`).join(', ')}`);

  log('');
  log('=== 场景 3：只有两段亮的观测，仍有多套接线 ===');
  const p3 = service.create([{ pattern: 'bc' }]);
  log(`无标签 "bc"（两段亮）: 候选数=${p3.candidateCount} 状态=${p3.status}`);
  const ex = service.explain(p3.problemId, null, 'bc')!;
  log(`解释 "bc": 可能数字=${JSON.stringify(ex.possibleDigits)}，可识别候选=${ex.recognizableCount}/${ex.totalCandidates}`);

  log('');
  log('=== 场景 4：同一图案被标为不同数字 -> 无解 ===');
  const p4 = service.create([{ pattern: 'abc', label: 7 }, { pattern: 'abc', label: 1 }]);
  log(`"abc"=7 且 "abc"=1: 候选数=${p4.candidateCount} 状态=${p4.status}`);
  log('逐条观测过滤后剩余候选: ' + JSON.stringify(p4.filterTrace.remainingAfterEachObservation));

  log('');
  log('=== 场景 5：重复观测不被当作十种不同数字 ===');
  const p5 = service.create([
    { pattern: observeDigit(1), label: 1 },
    { pattern: observeDigit(1), label: 1 },
  ]);
  log(`重复观测同一数字两次: 候选数=${p5.candidateCount} 状态=${p5.status}`);

  log('');
  log('=== 导出/复查 ===');
  const exported = service.export(p1.problemId)!;
  const importedId = service.import(exported);
  log(`导出题 #${p1.problemId} 后原子导入为新题 #${importedId}，版本数=${exported.versions.length}`);
}
