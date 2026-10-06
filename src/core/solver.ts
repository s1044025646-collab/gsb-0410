import { DIGIT_SEGMENTS, SEGMENTS, SEGMENTS_TO_DIGIT, SEGMENT_TABLE_VERSION, Wire } from './segments';

// 一个候选接线：wireToSeg[输入线] = 实际标准段。
export interface Mapping {
  wireToSeg: Record<string, string>;
}

export interface Observation {
  pattern: string; // 排序后的输入线集合，如 "abcf"
  label?: number;   // 可选已知数字 0-9
}

export interface Candidate extends Mapping {
  index: number; // 稳定序号（从 0 开始，按稳定排序后的顺序）
}

export interface PositionResult {
  position: number;
  pattern: string;
  // 所有“可识别”候选下出现过的数字（排序去重）；空表示没有任何候选可识别
  possibleDigits: number[];
  certain: boolean;     // 所有候选都可识别且数字唯一
  digit: number | null; // certain 时为该数字，否则 null
}

export interface DecodeReport {
  segmentTableVersion: string;
  totalCandidates: number;
  recognizableCandidateCount: number;   // 全部查询位置都能识别成数字的候选数
  partiallyUnrecognizableCount: number; // 至少一个位置无法识别的候选数
  positions: PositionResult[];
  displayString: string | null; // 仅当所有候选得到相同有效数字串（保留前导零）
  certain: boolean;
}

// 枚举 7! = 5040 个输入线 -> 标准段的双射。
// 以 [a,b,c,d,e,f,g] 七条输入线的段分配数组表示，字典序生成。
export function enumeratePermutations(): string[][] {
  const items = [...SEGMENTS];
  const result: string[][] = [];
  const used = new Array(items.length).fill(false);
  const cur: string[] = [];
  const walk = () => {
    if (cur.length === items.length) {
      result.push([...cur]);
      return;
    }
    for (let i = 0; i < items.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      cur.push(items[i]);
      walk();
      cur.pop();
      used[i] = false;
    }
  };
  walk();
  return result;
}

function toWireToSeg(perm: string[]): Record<string, string> {
  const m: Record<string, string> = {};
  SEGMENTS.forEach((wire, i) => {
    m[wire] = perm[i];
  });
  return m;
}

// 把输入线集合按接线映射到标准段集合（排序字符串）。
export function mapPattern(pattern: string, wireToSeg: Record<string, string>): string {
  return [...pattern].map((w) => wireToSeg[w]).sort().join('');
}

// 返回映射后的数字；映射结果不是任何标准数字时返回 null。
export function decodeDigit(pattern: string, wireToSeg: Record<string, string>): number | null {
  const seg = mapPattern(pattern, wireToSeg);
  return SEGMENTS_TO_DIGIT.has(seg) ? (SEGMENTS_TO_DIGIT.get(seg) as number) : null;
}

function permMatchesObservation(perm: string[], obs: Observation): boolean {
  const mapped = [...obs.pattern].map((w, idx) => {
    void idx;
    return perm[SEGMENTS.indexOf(w as Wire)];
  }).sort().join('');
  if (obs.label === undefined) {
    return SEGMENTS_TO_DIGIT.has(mapped);
  }
  return mapped === DIGIT_SEGMENTS[obs.label];
}

// 稳定排序键：按输入线 a,b,c,d,e,f,g 映射到的段依次拼接。
function sortKey(wireToSeg: Record<string, string>): string {
  return SEGMENTS.map((w) => wireToSeg[w]).join('');
}

export interface FilterTrace {
  totalPermutations: number;
  // 每条观测过滤后剩余多少候选（含重复观测，重复观测不改变集合）
  remainingAfterEach: number[];
}

// 核心：用训练观测过滤全部排列。所有观测共用同一套接线，
// 不会对每个图案分别选择接线。
export function filterCandidates(observations: Observation[]): { candidates: Candidate[]; trace: FilterTrace } {
  let perms = enumeratePermutations();
  const remainingAfterEach: number[] = [];
  for (const obs of observations) {
    perms = perms.filter((p) => permMatchesObservation(p, obs));
    remainingAfterEach.push(perms.length);
  }
  const sorted = perms
    .map(toWireToSeg)
    .sort((x, y) => (sortKey(x) < sortKey(y) ? -1 : sortKey(x) > sortKey(y) ? 1 : 0));
  const candidates: Candidate[] = sorted.map((wireToSeg, index) => ({ index, wireToSeg }));
  return {
    candidates,
    trace: { totalPermutations: 5040, remainingAfterEach },
  };
}

// 对待解码图案应用同一候选集，汇总逐位确定性与整串确定性。
// 查询图案不参与过滤，不会反向缩小训练候选。
export function decodeQuery(patterns: string[], candidates: Candidate[]): DecodeReport {
  let fullyRecognizable = 0;
  const positionDigits: Set<number>[] = patterns.map(() => new Set<number>());
  const allStrings = new Set<string>();

  for (const cand of candidates) {
    const digits: number[] = [];
    let allOk = true;
    patterns.forEach((pattern, pos) => {
      const digit = decodeDigit(pattern, cand.wireToSeg);
      if (digit === null) {
        allOk = false;
      } else {
        digits[pos] = digit;
        positionDigits[pos].add(digit);
      }
    });
    if (allOk) {
      fullyRecognizable++;
      allStrings.add(digits.map((d) => String(d)).join(''));
    }
  }

  const positions: PositionResult[] = patterns.map((pattern, pos) => {
    const possibleDigits = [...positionDigits[pos]].sort((x, y) => x - y);
    const certain = candidates.length > 0 && possibleDigits.length === 1 &&
      fullyRecognizable === candidates.length;
    return {
      position: pos,
      pattern,
      possibleDigits,
      certain,
      digit: certain ? possibleDigits[0] : null,
    };
  });

  const stringCertain = candidates.length > 0 &&
    fullyRecognizable === candidates.length && allStrings.size === 1;

  return {
    segmentTableVersion: SEGMENT_TABLE_VERSION,
    totalCandidates: candidates.length,
    recognizableCandidateCount: fullyRecognizable,
    partiallyUnrecognizableCount: candidates.length - fullyRecognizable,
    positions,
    displayString: stringCertain ? [...allStrings][0] : null,
    certain: stringCertain,
  };
}

// 解释单个图案：在每个候选下它是什么数字（或无法识别）。
export function explainPattern(pattern: string, candidates: Candidate[]): {
  pattern: string;
  totalCandidates: number;
  recognizableCount: number;
  unrecognizableCount: number;
  possibleDigits: number[];
  certain: boolean;
  digit: number | null;
} {
  const digits = new Set<number>();
  let recognizable = 0;
  for (const cand of candidates) {
    const d = decodeDigit(pattern, cand.wireToSeg);
    if (d === null) continue;
    recognizable++;
    digits.add(d);
  }
  const possibleDigits = [...digits].sort((x, y) => x - y);
  const certain = candidates.length > 0 && recognizable === candidates.length && possibleDigits.length === 1;
  return {
    pattern,
    totalCandidates: candidates.length,
    recognizableCount: recognizable,
    unrecognizableCount: candidates.length - recognizable,
    possibleDigits,
    certain,
    digit: certain ? possibleDigits[0] : null,
  };
}
