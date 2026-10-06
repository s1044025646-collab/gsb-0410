// SQLite 持久化：保存原始观测、段表版本、候选快照、查询（歧义报告）。
// 追加观测生成新版本；旧版本及其歧义报告原样保留，可复查。
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Candidate, DecodeReport, Observation, filterCandidates, decodeQuery, explainPattern } from './core/solver';
import { SEGMENT_TABLE_VERSION } from './core/segments';
import { normalizeTraining } from './core/validate';

export interface ProblemVersion {
  version: number;
  createdAt: string;
  training: Observation[];
  candidateCount: number;
  status: 'unique' | 'multiple' | 'unsat';
  traceRemaining: number[];
}

export interface ProblemSummary {
  id: number;
  createdAt: string;
  latestVersion: number;
  latestStatus: string;
}

export interface QueryRecord {
  id: number;
  problemId: number;
  version: number;
  createdAt: string;
  patterns: string[];
  report: DecodeReport;
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS problems (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS versions (
        problem_id INTEGER NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        segment_table_version TEXT NOT NULL,
        training_json TEXT NOT NULL,
        candidate_count INTEGER NOT NULL,
        status TEXT NOT NULL,
        trace_json TEXT NOT NULL,
        candidates_json TEXT NOT NULL,
        PRIMARY KEY (problem_id, version),
        FOREIGN KEY (problem_id) REFERENCES problems(id)
      );
      CREATE TABLE IF NOT EXISTS queries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        problem_id INTEGER NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        patterns_json TEXT NOT NULL,
        report_json TEXT NOT NULL,
        FOREIGN KEY (problem_id) REFERENCES problems(id)
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  private computeVersion(training: Observation[]) {
    const { candidates, trace } = filterCandidates(training);
    const status: ProblemVersion['status'] =
      candidates.length === 0 ? 'unsat' : candidates.length === 1 ? 'unique' : 'multiple';
    return { candidates, trace, status };
  }

  createProblem(training: Observation[], now = new Date().toISOString()): ProblemVersion & { problemId: number } {
    const tx = this.db.prepare('INSERT INTO problems (created_at) VALUES (?)');
    const info = tx.run(now) as { lastInsertRowid: number | bigint };
    const problemId = Number(info.lastInsertRowid);
    return { problemId, ...this.insertVersion(problemId, 1, training, now) };
  }

  private insertVersion(problemId: number, version: number, training: Observation[], now: string): ProblemVersion {
    const { candidates, trace, status } = this.computeVersion(training);
    this.db.prepare(`
      INSERT INTO versions
        (problem_id, version, created_at, segment_table_version, training_json, candidate_count, status, trace_json, candidates_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      problemId, version, now, SEGMENT_TABLE_VERSION,
      JSON.stringify(training), candidates.length, status,
      JSON.stringify(trace.remainingAfterEach), JSON.stringify(candidates),
    );
    return {
      version,
      createdAt: now,
      training,
      candidateCount: candidates.length,
      status,
      traceRemaining: trace.remainingAfterEach,
    };
  }

  appendVersion(problemId: number, extraTraining: Observation[], now = new Date().toISOString()): ProblemVersion {
    const prev = this.getVersionRow(problemId, null);
    if (!prev) throw new Error('PROBLEM_NOT_FOUND');
    const prevVersion = prev.version as number;
    const prevTraining = JSON.parse(prev.training_json as string) as Observation[];
    const training = [...prevTraining, ...extraTraining];
    return this.insertVersion(problemId, prevVersion + 1, training, now);
  }

  private getVersionRow(problemId: number, version: number | null) {
    const rows = this.db.prepare(
      `SELECT * FROM versions WHERE problem_id = ? ${version === null ? '' : 'AND version = ?'} ORDER BY version DESC LIMIT 1`,
    ).all(...(version === null ? [problemId] : [problemId, version])) as Array<Record<string, unknown>>;
    return rows[0] ?? null;
  }

  listProblems(): ProblemSummary[] {
    const rows = this.db.prepare(`
      SELECT p.id AS id, p.created_at AS created_at, v.version AS latest_version, v.status AS latest_status
      FROM problems p
      JOIN versions v ON v.problem_id = p.id AND v.version = (
        SELECT MAX(version) FROM versions WHERE problem_id = p.id
      )
      ORDER BY p.id
    `).all() as unknown as Array<{ id: number; created_at: string; latest_version: number; latest_status: string }>;
    return rows.map((r) => ({ id: r.id, createdAt: r.created_at, latestVersion: r.latest_version, latestStatus: r.latest_status }));
  }

  getVersion(problemId: number, version: number | null): (ProblemVersion & { segmentTableVersion: string; candidates: Candidate[] }) | null {
    const row = this.getVersionRow(problemId, version);
    if (!row) return null;
    return {
      version: row.version as number,
      createdAt: row.created_at as string,
      segmentTableVersion: row.segment_table_version as string,
      training: JSON.parse(row.training_json as string),
      candidateCount: row.candidate_count as number,
      status: row.status as ProblemVersion['status'],
      traceRemaining: JSON.parse(row.trace_json as string),
      candidates: JSON.parse(row.candidates_json as string),
    };
  }

  listVersions(problemId: number): Array<{ version: number; createdAt: string; candidateCount: number; status: string }> {
    const rows = this.db.prepare(
      'SELECT version, created_at, candidate_count, status FROM versions WHERE problem_id = ? ORDER BY version',
    ).all(problemId) as unknown as Array<{ version: number; created_at: string; candidate_count: number; status: string }>;
    return rows.map((r) => ({ version: r.version, createdAt: r.created_at, candidateCount: r.candidate_count, status: r.status }));
  }

  // 分页查看候选；分页只影响展示，total 始终是候选总数。
  getCandidatesPage(problemId: number, version: number | null, page: number, pageSize: number) {
    const v = this.getVersion(problemId, version);
    if (!v) return null;
    const start = (page - 1) * pageSize;
    return {
      problemId,
      version: v.version,
      status: v.status,
      total: v.candidateCount,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(v.candidateCount / pageSize)),
      items: v.candidates.slice(start, start + pageSize),
    };
  }

  // 解码：查询图案只作为查询，不过滤候选；结果作为歧义报告持久化。
  decode(problemId: number, version: number | null, patterns: string[], now = new Date().toISOString()): QueryRecord | null {
    const v = this.getVersion(problemId, version);
    if (!v) return null;
    const report = decodeQuery(patterns, v.candidates);
    const info = this.db.prepare(
      'INSERT INTO queries (problem_id, version, created_at, patterns_json, report_json) VALUES (?, ?, ?, ?, ?)',
    ).run(problemId, v.version, now, JSON.stringify(patterns), JSON.stringify(report)) as { lastInsertRowid: number | bigint };
    return {
      id: Number(info.lastInsertRowid),
      problemId,
      version: v.version,
      createdAt: now,
      patterns,
      report,
    };
  }

  explain(problemId: number, version: number | null, pattern: string) {
    const v = this.getVersion(problemId, version);
    if (!v) return null;
    return { problemId, version: v.version, ...explainPattern(pattern, v.candidates) };
  }

  listQueries(problemId: number, version?: number): QueryRecord[] {
    const rows = version === undefined
      ? this.db.prepare('SELECT * FROM queries WHERE problem_id = ? ORDER BY id').all(problemId)
      : this.db.prepare('SELECT * FROM queries WHERE problem_id = ? AND version = ? ORDER BY id').all(problemId, version);
    return (rows as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as number,
      problemId: r.problem_id as number,
      version: r.version as number,
      createdAt: r.created_at as string,
      patterns: JSON.parse(r.patterns_json as string),
      report: JSON.parse(r.report_json as string),
    }));
  }

  exportProblem(problemId: number) {
    const versions = this.db.prepare('SELECT * FROM versions WHERE problem_id = ? ORDER BY version').all(problemId) as Array<Record<string, unknown>>;
    if (versions.length === 0) return null;
    return {
      format: 'segwire-export/1',
      segmentTableVersion: SEGMENT_TABLE_VERSION,
      problemId,
      versions: versions.map((r) => ({
        version: r.version,
        createdAt: r.created_at,
        training: JSON.parse(r.training_json as string),
        candidateCount: r.candidate_count,
        status: r.status,
        traceRemaining: JSON.parse(r.trace_json as string),
      })),
    };
  }

  // 原子导入：整个导入在一个事务里，非法导入不会创建任何题或覆盖已有题。
  importProblem(payload: unknown, now = new Date().toISOString()): number {
    if (payload === null || typeof payload !== 'object') throw new Error('IMPORT_INVALID: 载荷必须是对象');
    const p = payload as { format?: unknown; segmentTableVersion?: unknown; versions?: unknown };
    if (p.format !== 'segwire-export/1') throw new Error('IMPORT_INVALID: 缺少 format=segwire-export/1');
    if (p.segmentTableVersion !== SEGMENT_TABLE_VERSION) throw new Error('IMPORT_INVALID: 段表版本不兼容');
    if (!Array.isArray(p.versions) || p.versions.length === 0) throw new Error('IMPORT_INVALID: versions 必须是非空数组');

    const parsed: Array<{ training: Observation[]; createdAt?: string }> = p.versions.map((raw) => {
      const r = raw as { training?: unknown; createdAt?: unknown };
      // 复用同一套参数校验：空图案、未知字符、重复字符、非法标签都会让整个导入失败。
      const training = normalizeTraining(r.training);
      return { training, createdAt: typeof r.createdAt === 'string' ? r.createdAt : undefined };
    });

    this.db.exec('BEGIN');
    try {
      const info = this.db.prepare('INSERT INTO problems (created_at) VALUES (?)').run(now) as { lastInsertRowid: number | bigint };
      const problemId = Number(info.lastInsertRowid);
      parsed.forEach((v, i) => this.insertVersion(problemId, i + 1, v.training, v.createdAt ?? now));
      this.db.exec('COMMIT');
      return problemId;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}
