/** 标准七段数码管段命名与十个数字的段表（段表版本 v1）。
 *  空间命名：a=上横, b=右上, c=右下, d=下横, e=左下, f=左上, g=中横。
 */
export const SEGMENT_TABLE_VERSION = "v1";

export const SEGMENT_NAMES: Record<string, string> = {
  a: "上横",
  b: "右上竖",
  c: "右下竖",
  d: "下横",
  e: "左下竖",
  f: "左上竖",
  g: "中横",
};

export const LINES = ["a", "b", "c", "d", "e", "f", "g"] as const;
export type Line = (typeof LINES)[number];

/** 标准数字段表：数字 -> 点亮的标准段集合（有序字符串）。 */
export const DIGIT_SEGMENTS: Record<number, string> = {
  0: "abcdef",
  1: "bc",
  2: "abdeg",
  3: "abcdg",
  4: "bcfg",
  5: "acdfg",
  6: "acdefg",
  7: "abc",
  8: "abcdefg",
  9: "abcdfg",
};

const SEGMENT_TO_DIGIT = new Map<string, number>(
  Object.entries(DIGIT_SEGMENTS).map(([d, s]) => [s, Number(d)])
);

export function digitOfSegmentSet(sortedSegments: string): number | null {
  const d = SEGMENT_TO_DIGIT.get(sortedSegments);
  return d === undefined ? null : d;
}

export function sortChars(s: string): string {
  return s.split("").sort().join("");
}

/** 接线映射：输入线 -> 标准段。序列化为按输入线 a..g 排列的 7 字符字符串。 */
export type Wiring = string;

export function applyWiring(wiring: Wiring, pattern: string): string {
  const mapped = pattern
    .split("")
    .map((ch) => wiring[LINES.indexOf(ch as Line)])
    .sort()
    .join("");
  return mapped;
}

/** 枚举全部 7! 个线到段双射，按字典序稳定排序。 */
export function allWirings(): Wiring[] {
  const result: Wiring[] = [];
  const used = new Array(7).fill(false);
  const cur: string[] = [];
  function dfs(i: number) {
    if (i === 7) {
      result.push(cur.join(""));
      return;
    }
    for (let j = 0; j < 7; j++) {
      if (!used[j]) {
        used[j] = true;
        cur.push(LINES[j]);
        dfs(i + 1);
        cur.pop();
        used[j] = false;
      }
    }
  }
  dfs(0);
  return result.sort();
}

export interface Observation {
  lines: string; // 已排序、已校验
  label: number | null;
}

/** 用全部训练观测过滤候选接线。 */
export function filterCandidates(observations: Observation[], wirings?: Wiring[]): Wiring[] {
  const all = wirings ?? allWirings();
  return all.filter((w) =>
    observations.every((obs) => {
      const mapped = applyWiring(w, obs.lines);
      const digit = digitOfSegmentSet(mapped);
      if (digit === null) return false;
      if (obs.label !== null && digit !== obs.label) return false;
      return true;
    })
  );
}

export interface ExplainResult {
  pattern: string;
  totalCandidates: number;
  /** 每个候选下识别出的数字（无法识别为 null）。 */
  digits: (number | null)[];
  /** 不同候选下出现的可能数字（升序）。 */
  possibleDigits: number[];
  /** 无法识别为任何数字的候选数量。 */
  unrecognizedCount: number;
  /** 所有候选下都得到同一有效数字时为该数字，否则为 null。 */
  determined: number | null;
}

export function explainPattern(pattern: string, candidates: Wiring[]): ExplainResult {
  const digits = candidates.map((w) => digitOfSegmentSet(applyWiring(w, pattern)));
  const possible = [...new Set(digits.filter((d): d is number => d !== null))].sort((x, y) => x - y);
  const unrecognizedCount = digits.filter((d) => d === null).length;
  const determined =
    digits.length > 0 && digits.every((d) => d !== null && d === digits[0]) ? digits[0] : null;
  return {
    pattern,
    totalCandidates: candidates.length,
    digits,
    possibleDigits: possible,
    unrecognizedCount,
    determined,
  };
}

export interface DecodeResult {
  totalCandidates: number;
  /** 每个位置：所有候选下都确定为同一数字时为该数字，否则为 null。 */
  positions: (number | null)[];
  /** 每个位置在所有候选下可能出现的数字集合。 */
  possiblePerPosition: number[][];
  /** 至少有一个位置无法识别的候选数量。 */
  candidatesWithUnrecognized: number;
  /** 仅当所有候选都得到相同的完整有效数字串时为该串（保留前导零），否则为 null。 */
  determinedString: string | null;
}

export function decodeDisplay(patterns: string[], candidates: Wiring[]): DecodeResult {
  const perCandidate: (number | null)[][] = candidates.map((w) =>
    patterns.map((p) => digitOfSegmentSet(applyWiring(w, p)))
  );
  const positions: (number | null)[] = [];
  const possiblePerPosition: number[][] = [];
  for (let i = 0; i < patterns.length; i++) {
    const col = perCandidate.map((row) => row[i]);
    const poss = [...new Set(col.filter((d): d is number => d !== null))].sort((x, y) => x - y);
    possiblePerPosition.push(poss);
    positions.push(
      col.length > 0 && col.every((d) => d !== null && d === col[0]) ? col[0] : null
    );
  }
  const candidatesWithUnrecognized = perCandidate.filter((row) => row.includes(null)).length;
  let determinedString: string | null = null;
  if (perCandidate.length > 0 && perCandidate.every((row) => !row.includes(null))) {
    const first = (perCandidate[0] as number[]).join("");
    if (perCandidate.every((row) => (row as number[]).join("") === first)) {
      determinedString = first;
    }
  }
  return {
    totalCandidates: candidates.length,
    positions,
    possiblePerPosition,
    candidatesWithUnrecognized,
    determinedString,
  };
}
