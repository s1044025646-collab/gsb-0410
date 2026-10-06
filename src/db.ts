import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  Observation,
  Wiring,
  filterCandidates,
  explainPattern,
  decodeDisplay,
  ExplainResult,
  DecodeResult,
  SEGMENT_TABLE_VERSION,
} from "./core";
import { ApiError, ObservationInput, MAX_OBSERVATIONS } from "./validate";

export const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "sevenseg.db");

let db: DatabaseSync;

export function getDb(): DatabaseSync {
  if (!db) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    db = new DatabaseSync(DB_PATH);
    db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS puzzles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        segment_version TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        puzzle_id INTEGER NOT NULL REFERENCES puzzles(id),
        version_no INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(puzzle_id, version_no)
      );
      CREATE TABLE IF NOT EXISTS observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        puzzle_id INTEGER NOT NULL REFERENCES puzzles(id),
        version_no INTEGER NOT NULL,
        lines TEXT NOT NULL,
        label INTEGER
      );
      CREATE TABLE IF NOT EXISTS candidates (
        puzzle_id INTEGER NOT NULL,
        version_no INTEGER NOT NULL,
        wiring TEXT NOT NULL,
        PRIMARY KEY (puzzle_id, version_no, wiring)
      );
      CREATE TABLE IF NOT EXISTS queries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        puzzle_id INTEGER NOT NULL,
        version_no INTEGER NOT NULL,
        kind TEXT NOT NULL,
        input TEXT NOT NULL,
        result TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }
  return db;
}

export function resetDbForTest(): void {
  if (db) {
    db.close();
    db = undefined as any;
  }
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(DB_PATH + suffix); } catch {}
  }
}

export function getPuzzle(id: number): { id: number; name: string; segment_version: string } {
  const row = getDb()
    .prepare("SELECT id, name, segment_version FROM puzzles WHERE id = ?")
    .get(id) as any;
  if (!row) throw new ApiError("PUZZLE_NOT_FOUND", `观测题 ${id} 不存在`, 404);
  return row;
}

export function latestVersionNo(puzzleId: number): number {
  const row = getDb()
    .prepare("SELECT MAX(version_no) AS v FROM versions WHERE puzzle_id = ?")
    .get(puzzleId) as any;
  return row?.v ?? 0;
}

export function observationsAt(puzzleId: number, versionNo: number): Observation[] {
  const rows = getDb()
    .prepare(
      "SELECT lines, label FROM observations WHERE puzzle_id = ? AND version_no <= ? ORDER BY id"
    )
    .all(puzzleId, versionNo) as any[];
  return rows.map((r) => ({ lines: r.lines, label: r.label }));
}

export function createPuzzle(name: string, observations: ObservationInput[]): number {
  const d = getDb();
  d.exec("BEGIN");
  try {
    const info = d
      .prepare("INSERT INTO puzzles (name, segment_version) VALUES (?, ?)")
      .run(name, SEGMENT_TABLE_VERSION);
    const id = Number(info.lastInsertRowid);
    d.prepare("INSERT INTO versions (puzzle_id, version_no) VALUES (?, 1)").run(id);
    const ins = d.prepare(
      "INSERT INTO observations (puzzle_id, version_no, lines, label) VALUES (?, 1, ?, ?)"
    );
    for (const o of observations) ins.run(id, o.lines, o.label);
    d.exec("COMMIT");
    return id;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

/** 追加观测，生成新版本；旧版本候选与查询报告保留。 */
export function appendObservations(puzzleId: number, observations: ObservationInput[]): number {
  getPuzzle(puzzleId);
  const existing = observationsAt(puzzleId, latestVersionNo(puzzleId)).length;
  if (existing + observations.length > MAX_OBSERVATIONS) {
    throw new ApiError("TOO_MANY_OBSERVATIONS", `观测总数将超过上限 ${MAX_OBSERVATIONS}`);
  }
  const d = getDb();
  d.exec("BEGIN");
  try {
    const versionNo = latestVersionNo(puzzleId) + 1;
    d.prepare("INSERT INTO versions (puzzle_id, version_no) VALUES (?, ?)").run(puzzleId, versionNo);
    const ins = d.prepare(
      "INSERT INTO observations (puzzle_id, version_no, lines, label) VALUES (?, ?, ?, ?)"
    );
    for (const o of observations) ins.run(puzzleId, versionNo, o.lines, o.label);
    d.exec("COMMIT");
    return versionNo;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

export interface SolveResult {
  puzzleId: number;
  versionNo: number;
  segmentVersion: string;
  totalCandidates: number;
  status: "unique" | "multiple" | "none";
  observations: Observation[];
  /** 无解时提供过滤诊断。 */
  diagnostics?: { totalPermutations: number; remainingAfterEachObservation: number[] };
}

export function solve(puzzleId: number): SolveResult {
  const puzzle = getPuzzle(puzzleId);
  const versionNo = latestVersionNo(puzzleId);
  const observations = observationsAt(puzzleId, versionNo);
  const d = getDb();
  const cached = d
    .prepare("SELECT COUNT(*) AS c FROM candidates WHERE puzzle_id = ? AND version_no = ?")
    .get(puzzleId, versionNo) as any;
  let total = cached.c as number;
  if (total === 0) {
    // 重新计算并缓存（无解时也记录一次空结果需可区分，这里用重新计算保证一致）
    const { allWirings, applyWiring, digitOfSegmentSet } = require("./core");
    const all: Wiring[] = allWirings();
    const remaining: number[] = [];
    let current = all;
    for (const obs of observations) {
      current = current.filter((w: Wiring) => {
        const digit = digitOfSegmentSet(applyWiring(w, obs.lines));
        return digit !== null && (obs.label === null || digit === obs.label);
      });
      remaining.push(current.length);
    }
    d.exec("BEGIN");
    try {
      d.prepare("DELETE FROM candidates WHERE puzzle_id = ? AND version_no = ?").run(puzzleId, versionNo);
      const ins = d.prepare(
        "INSERT INTO candidates (puzzle_id, version_no, wiring) VALUES (?, ?, ?)"
      );
      for (const w of current) ins.run(puzzleId, versionNo, w);
      d.exec("COMMIT");
    } catch (e) {
      d.exec("ROLLBACK");
      throw e;
    }
    total = current.length;
    const status = total === 0 ? "none" : total === 1 ? "unique" : "multiple";
    const result: SolveResult = {
      puzzleId,
      versionNo,
      segmentVersion: puzzle.segment_version,
      totalCandidates: total,
      status,
      observations,
    };
    if (total === 0) {
      result.diagnostics = { totalPermutations: all.length, remainingAfterEachObservation: remaining };
    }
    return result;
  }
  const status = total === 1 ? "unique" : "multiple";
  return { puzzleId, versionNo, segmentVersion: puzzle.segment_version, totalCandidates: total, status, observations };
}

export function getCandidates(puzzleId: number, versionNo?: number): Wiring[] {
  const v = versionNo ?? latestVersionNo(puzzleId);
  const rows = getDb()
    .prepare(
      "SELECT wiring FROM candidates WHERE puzzle_id = ? AND version_no = ? ORDER BY wiring"
    )
    .all(puzzleId, v) as any[];
  return rows.map((r) => r.wiring);
}

export function getCandidatesPage(
  puzzleId: number,
  limit: number,
  offset: number
): { total: number; versionNo: number; items: { index: number; wiring: string; mapping: Record<string, string> }[] } {
  const versionNo = latestVersionNo(puzzleId);
  solve(puzzleId); // 确保已计算
  const d = getDb();
  const total = (
    d.prepare("SELECT COUNT(*) AS c FROM candidates WHERE puzzle_id = ? AND version_no = ?").get(
      puzzleId,
      versionNo
    ) as any
  ).c as number;
  const rows = d
    .prepare(
      "SELECT wiring FROM candidates WHERE puzzle_id = ? AND version_no = ? ORDER BY wiring LIMIT ? OFFSET ?"
    )
    .all(puzzleId, versionNo, limit, offset) as any[];
  const LINES = ["a", "b", "c", "d", "e", "f", "g"];
  return {
    total,
    versionNo,
    items: rows.map((r, i) => ({
      index: offset + i,
      wiring: r.wiring,
      mapping: Object.fromEntries(LINES.map((l, j) => [l, r.wiring[j]])),
    })),
  };
}

function recordQuery(puzzleId: number, kind: string, input: unknown, result: unknown): void {
  const versionNo = latestVersionNo(puzzleId);
  getDb()
    .prepare("INSERT INTO queries (puzzle_id, version_no, kind, input, result) VALUES (?, ?, ?, ?, ?)")
    .run(puzzleId, versionNo, kind, JSON.stringify(input), JSON.stringify(result));
}

export function explain(puzzleId: number, pattern: string): ExplainResult {
  solve(puzzleId);
  const candidates = getCandidates(puzzleId);
  const result = explainPattern(pattern, candidates);
  recordQuery(puzzleId, "explain", { pattern }, result);
  return result;
}

export function decode(puzzleId: number, patterns: string[]): DecodeResult {
  solve(puzzleId);
  const candidates = getCandidates(puzzleId);
  const result = decodeDisplay(patterns, candidates);
  recordQuery(puzzleId, "decode", { patterns }, result);
  return result;
}

export function exportPuzzle(puzzleId: number): unknown {
  const puzzle = getPuzzle(puzzleId);
  const versionNo = latestVersionNo(puzzleId);
  const observations = observationsAt(puzzleId, versionNo);
  const d = getDb();
  const versions = d
    .prepare("SELECT version_no, created_at FROM versions WHERE puzzle_id = ? ORDER BY version_no")
    .all(puzzleId);
  const queries = d
    .prepare("SELECT version_no, kind, input, result, created_at FROM queries WHERE puzzle_id = ? ORDER BY id")
    .all(puzzleId) as any[];
  return {
    format: "sevenseg-wiring-export",
    segmentVersion: puzzle.segment_version,
    puzzle: { id: puzzle.id, name: puzzle.name },
    currentVersion: versionNo,
    versions,
    observations,
    queries: queries.map((q) => ({ ...q, input: JSON.parse(q.input), result: JSON.parse(q.result) })),
  };
}

/** 导入观测题：全部校验通过后才写入，失败不影响已有数据。 */
export function importPuzzle(payload: unknown): number {
  if (typeof payload !== "object" || payload === null) {
    throw new ApiError("INVALID_IMPORT", "导入内容必须是对象");
  }
  const p = payload as any;
  if (p.format !== "sevenseg-wiring-export") {
    throw new ApiError("INVALID_IMPORT", "format 必须是 sevenseg-wiring-export");
  }
  if (p.segmentVersion !== SEGMENT_TABLE_VERSION) {
    throw new ApiError("SEGMENT_VERSION_MISMATCH", `段表版本不匹配：${p.segmentVersion}`);
  }
  const { validateObservationList } = require("./validate");
  const observations: ObservationInput[] = validateObservationList(p.observations);
  const name = typeof p.puzzle?.name === "string" && p.puzzle.name ? p.puzzle.name : "导入的观测题";
  return createPuzzle(`${name} (导入)`, observations);
}
