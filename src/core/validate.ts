import { Observation } from './solver';
import { WIRES } from './segments';

export class ValidationError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}

export const LIMITS = {
  MAX_TRAINING: 100,
  MAX_QUERY: 32,
  PAGE_SIZE_MAX: 5040,
} as const;

const WIRE_CHARS = new Set<string>(WIRES);

// 校验并归一化一个图案字符串：只允许 a-g，非空、字符不重复；次序无关。
export function normalizePattern(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new ValidationError('PATTERN_NOT_STRING', '图案必须是字符串（点亮的输入线字符集合）');
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new ValidationError('PATTERN_EMPTY', '拒绝空图案');
  }
  const chars = [...trimmed];
  for (const ch of chars) {
    if (!WIRE_CHARS.has(ch)) {
      throw new ValidationError('PATTERN_UNKNOWN_CHAR', `图案含未知字符: ${ch}（只允许 a-g）`);
    }
  }
  if (new Set(chars).size !== chars.length) {
    throw new ValidationError('PATTERN_DUPLICATE_CHAR', `图案内字符不能重复: ${raw}`);
  }
  return chars.sort().join('');
}

// 校验数字标签：必须是 0-9 的整数，拒绝 "1.5"、"10"、布尔等。
export function normalizeLabel(raw: unknown): number {
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw)) {
      throw new ValidationError('LABEL_NOT_INTEGER', `数字标签必须是 0-9 的整数，收到: ${raw}`);
    }
    if (raw < 0 || raw > 9) {
      throw new ValidationError('LABEL_OUT_OF_RANGE', `数字标签越界: ${raw}（只允许 0-9）`);
    }
    return raw;
  }
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
    const parsed = Number(raw.trim());
    if (parsed < 0 || parsed > 9) {
      throw new ValidationError('LABEL_OUT_OF_RANGE', `数字标签越界: ${parsed}（只允许 0-9）`);
    }
    return parsed;
  } else {
    throw new ValidationError('LABEL_NOT_INTEGER', `数字标签必须是 0-9 的整数，收到: ${String(raw)}`);
  }
}

export function normalizeTraining(raw: unknown): Observation[] {
  if (!Array.isArray(raw)) {
    throw new ValidationError('TRAINING_NOT_ARRAY', 'training 必须是观测数组');
  }
  if (raw.length === 0) {
    throw new ValidationError('TRAINING_EMPTY', '至少需要一条训练观测');
  }
  if (raw.length > LIMITS.MAX_TRAINING) {
    throw new ValidationError('TRAINING_TOO_MANY', `训练观测最多 ${LIMITS.MAX_TRAINING} 条`);
  }
  return raw.map((item) => {
    if (item === null || typeof item !== 'object' || typeof (item as { pattern?: unknown }).pattern !== 'string') {
      throw new ValidationError('OBSERVATION_INVALID', '每条训练观测必须是含 pattern 字段的对象');
    }
    const o = item as { pattern: string; label?: unknown };
    const pattern = normalizePattern(o.pattern);
    if (o.label === undefined || o.label === null) {
      return { pattern };
    }
    return { pattern, label: normalizeLabel(o.label) };
  });
}

export function normalizePatterns(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    throw new ValidationError('QUERY_NOT_ARRAY', '查询图案必须是字符串数组');
  }
  if (raw.length === 0) {
    throw new ValidationError('QUERY_EMPTY', '至少需要一个待解码图案');
  }
  if (raw.length > LIMITS.MAX_QUERY) {
    throw new ValidationError('QUERY_TOO_MANY', `待解码图案最多 ${LIMITS.MAX_QUERY} 个`);
  }
  return raw.map(normalizePattern);
}

export function normalizePage(raw: unknown, fallback = 1): number {
  if (raw === undefined || raw === null) return fallback;
  const n = typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : raw;
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) {
    throw new ValidationError('PAGE_INVALID', 'page 必须是正整数');
  }
  return n;
}

export function normalizePageSize(raw: unknown, fallback = 100): number {
  if (raw === undefined || raw === null) return fallback;
  const n = typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : raw;
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) {
    throw new ValidationError('PAGE_SIZE_INVALID', 'pageSize 必须是正整数');
  }
  if (n > LIMITS.PAGE_SIZE_MAX) {
    throw new ValidationError('PAGE_SIZE_INVALID', `pageSize 最大为 ${LIMITS.PAGE_SIZE_MAX}`);
  }
  return n;
}
