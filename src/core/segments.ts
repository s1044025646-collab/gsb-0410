// 标准七段数码管段命名（空间命名，公开给调用方）：
//
//       aaa
//      f   b
//      f   b
//       ggg
//      e   c
//      e   c
//       ddd

export const SEGMENTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const;
export type Segment = (typeof SEGMENTS)[number];

export const WIRES = ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const;
export type Wire = (typeof WIRES)[number];

// 标准段表版本标识：同一套固定的 0-9 段集合。
export const SEGMENT_TABLE_VERSION = 'std-1';

// 数字 -> 点亮的标准段集合（以排序后的字符串表示）。
export const DIGIT_SEGMENTS: Readonly<Record<number, string>> = {
  0: 'abcdef',
  1: 'bc',
  2: 'abdeg',
  3: 'abcdg',
  4: 'bcfg',
  5: 'acdfg',
  6: 'acdefg',
  7: 'abc',
  8: 'abcdefg',
  9: 'abcdfg',
};

// 段集合 -> 数字的反查表。段集合与数字在标准表中一一对应，
// 因此解码结果是“映射后是否恰好等于某个标准数字”，而非只数亮段数量。
export const SEGMENTS_TO_DIGIT: ReadonlyMap<string, number> = new Map(
  Object.entries(DIGIT_SEGMENTS).map(([digit, segs]) => [segs, Number(digit)]),
);

export function sortedSet(chars: readonly string[]): string {
  return [...chars].sort().join('');
}
