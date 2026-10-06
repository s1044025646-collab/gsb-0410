import { Store, ProblemVersion } from './db';
import { Observation } from './core/solver';
import { LIMITS } from './core/validate';

// 组装版本视图：无解时至少给出输入观测与逐条过滤后的候选剩余数量。
function versionView(problemId: number, v: ProblemVersion & { candidates?: unknown; segmentTableVersion?: string }) {
  return {
    problemId,
    version: v.version,
    createdAt: v.createdAt,
    training: v.training,
    candidateCount: v.candidateCount,
    status: v.status,
    interpretation:
      v.status === 'unsat' ? '无解：没有任何一套接线能同时满足全部观测'
        : v.status === 'unique' ? '唯一候选：接线已唯一确定'
          : `多个候选：仍有 ${v.candidateCount} 套接线满足全部观测`,
    filterTrace: {
      totalPermutations: 5040,
      // 第 i 条观测应用后剩余候选数；重复观测不改变集合，故数值可能不变。
      remainingAfterEachObservation: v.traceRemaining,
    },
  };
}

export class Service {
  constructor(private store: Store) {}

  create(training: Observation[]) {
    const r = this.store.createProblem(training);
    return versionView(r.problemId, r);
  }

  get(problemId: number, version: number | null) {
    const v = this.store.getVersion(problemId, version);
    return v ? versionView(problemId, v) : null;
  }

  list() {
    return this.store.listProblems();
  }

  versions(problemId: number) {
    const versions = this.store.listVersions(problemId);
    return versions.length === 0 ? null : versions;
  }

  append(problemId: number, extra: Observation[]) {
    const cur = this.store.getVersion(problemId, null);
    if (!cur) return null;
    if (cur.training.length + extra.length > LIMITS.MAX_TRAINING) {
      const e = new Error(`追加后训练观测总数不能超过 ${LIMITS.MAX_TRAINING}`);
      (e as Error & { code?: string }).code = 'TRAINING_TOO_MANY';
      throw e;
    }
    const v = this.store.appendVersion(problemId, extra);
    return versionView(problemId, v);
  }

  candidatesPage(problemId: number, version: number | null, page: number, pageSize: number) {
    return this.store.getCandidatesPage(problemId, version, page, pageSize);
  }

  decode(problemId: number, version: number | null, patterns: string[]) {
    return this.store.decode(problemId, version, patterns);
  }

  explain(problemId: number, version: number | null, pattern: string) {
    return this.store.explain(problemId, version, pattern);
  }

  queries(problemId: number, version?: number) {
    return this.store.listQueries(problemId, version);
  }

  export(problemId: number) {
    return this.store.exportProblem(problemId);
  }

  import(payload: unknown) {
    return this.store.importProblem(payload);
  }
}
