import { LINES, sortChars } from "./core";

export const MAX_OBSERVATIONS = 64;
export const MAX_QUERY_PATTERNS = 64;
export const MAX_PAGE_LIMIT = 200;

export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

/** 校验并规范化图案：非空、仅 a-g、无重复；返回排序后的字符串。 */
export function validatePattern(input: unknown, field = "pattern"): string {
  if (typeof input !== "string") throw new ApiError("PATTERN_NOT_STRING", `${field} 必须是字符串`);
  if (input.length === 0) throw new ApiError("EMPTY_PATTERN", `${field} 不能为空`);
  if (input.length > 7) throw new ApiError("PATTERN_TOO_LONG", `${field} 长度不能超过 7`);
  const seen = new Set<string>();
  for (const ch of input) {
    if (!LINES.includes(ch as any)) {
      throw new ApiError("UNKNOWN_CHAR", `${field} 含未知字符 '${ch}'，只允许 a-g`);
    }
    if (seen.has(ch)) throw new ApiError("DUPLICATE_CHAR", `${field} 含重复字符 '${ch}'`);
    seen.add(ch);
  }
  return sortChars(input);
}

/** 校验标签：整数 0-9 或 null/undefined。 */
export function validateLabel(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== "number" || !Number.isInteger(input)) {
    throw new ApiError("INVALID_LABEL", "label 必须是 0-9 的整数");
  }
  if (input < 0 || input > 9) throw new ApiError("LABEL_OUT_OF_RANGE", "label 必须在 0-9 之间");
  return input;
}

export interface ObservationInput {
  lines: string;
  label: number | null;
}

export function validateObservation(input: unknown): ObservationInput {
  if (typeof input !== "object" || input === null) {
    throw new ApiError("INVALID_OBSERVATION", "观测必须是对象 { lines, label? }");
  }
  const o = input as Record<string, unknown>;
  return { lines: validatePattern(o.lines, "lines"), label: validateLabel(o.label) };
}

export function validateObservationList(input: unknown): ObservationInput[] {
  if (!Array.isArray(input)) throw new ApiError("OBSERVATIONS_NOT_ARRAY", "observations 必须是数组");
  if (input.length === 0) throw new ApiError("EMPTY_OBSERVATIONS", "observations 不能为空");
  if (input.length > MAX_OBSERVATIONS) {
    throw new ApiError("TOO_MANY_OBSERVATIONS", `观测条数超过上限 ${MAX_OBSERVATIONS}`);
  }
  return input.map(validateObservation);
}

export function validatePatternList(input: unknown): string[] {
  if (!Array.isArray(input)) throw new ApiError("PATTERNS_NOT_ARRAY", "patterns 必须是数组");
  if (input.length === 0) throw new ApiError("EMPTY_PATTERNS", "patterns 不能为空");
  if (input.length > MAX_QUERY_PATTERNS) {
    throw new ApiError("TOO_MANY_PATTERNS", `查询图案数超过上限 ${MAX_QUERY_PATTERNS}`);
  }
  return input.map((p) => validatePattern(p));
}

export function validatePagination(query: URLSearchParams): { limit: number; offset: number } {
  const rawLimit = query.get("limit");
  const rawOffset = query.get("offset");
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  const offset = rawOffset === null ? 0 : Number(rawOffset);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new ApiError("INVALID_LIMIT", `limit 必须是 1-${MAX_PAGE_LIMIT} 的整数`);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new ApiError("INVALID_OFFSET", "offset 必须是非负整数");
  }
  return { limit, offset };
}
