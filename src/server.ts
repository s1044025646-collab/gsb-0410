import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { Service } from './service';
import {
  LIMITS, ValidationError, normalizeLabel, normalizePage, normalizePageSize,
  normalizePattern, normalizePatterns, normalizeTraining,
} from './core/validate';

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(json);
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new ValidationError('BODY_TOO_LARGE', '请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (data.length === 0) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new ValidationError('JSON_INVALID', '请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function parseId(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

function versionFromUrl(url: URL): number | null {
  const raw = url.searchParams.get('version');
  if (raw === null) return null;
  if (!/^\d+$/.test(raw)) throw new ValidationError('VERSION_INVALID', 'version 必须是正整数');
  return Number(raw);
}

export function createApp(service: Service): Server {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean);
      const method = req.method ?? 'GET';

      if (method === 'GET' && url.pathname === '/health') {
        return send(res, 200, { ok: true });
      }
      if (method === 'GET' && url.pathname === '/limits') {
        return send(res, 200, { ...LIMITS, maxPermutations: 5040 });
      }

      // POST /problems
      if (method === 'POST' && parts.length === 1 && parts[0] === 'problems') {
        const body = (await readJson(req)) as { training?: unknown };
        return send(res, 201, service.create(normalizeTraining(body.training)));
      }
      if (method === 'GET' && parts.length === 1 && parts[0] === 'problems') {
        return send(res, 200, { problems: service.list() });
      }

      if (parts[0] === 'problems') {
        const id = parseId(parts[1]);
        if (id === null) throw new ValidationError('PROBLEM_ID_INVALID', 'problemId 必须是正整数');

        // GET /problems/:id
        if (method === 'GET' && parts.length === 2) {
          const v = service.get(id, versionFromUrl(url));
          return v ? send(res, 200, v) : send(res, 404, { code: 'PROBLEM_NOT_FOUND', message: '观测题不存在' });
        }
        // POST /problems/:id/append
        if (method === 'POST' && parts.length === 3 && parts[2] === 'append') {
          const body = (await readJson(req)) as { training?: unknown };
          const v = service.append(id, normalizeTraining(body.training));
          return v ? send(res, 201, v) : send(res, 404, { code: 'PROBLEM_NOT_FOUND', message: '观测题不存在' });
        }
        // GET /problems/:id/versions
        if (method === 'GET' && parts.length === 3 && parts[2] === 'versions') {
          const v = service.versions(id);
          return v ? send(res, 200, { versions: v }) : send(res, 404, { code: 'PROBLEM_NOT_FOUND', message: '观测题不存在' });
        }
        // GET /problems/:id/candidates?page=&pageSize=&version=
        if (method === 'GET' && parts.length === 3 && parts[2] === 'candidates') {
          const page = normalizePage(url.searchParams.get('page') ?? undefined);
          const pageSize = normalizePageSize(url.searchParams.get('pageSize') ?? undefined);
          const r = service.candidatesPage(id, versionFromUrl(url), page, pageSize);
          return r ? send(res, 200, r) : send(res, 404, { code: 'PROBLEM_NOT_FOUND', message: '观测题不存在' });
        }
        // POST /problems/:id/decode
        if (method === 'POST' && parts.length === 3 && parts[2] === 'decode') {
          const body = (await readJson(req)) as { patterns?: unknown };
          const r = service.decode(id, versionFromUrl(url), normalizePatterns(body.patterns));
          return r ? send(res, 200, r) : send(res, 404, { code: 'PROBLEM_NOT_FOUND', message: '观测题不存在' });
        }
        // GET /problems/:id/explain?pattern=&version=
        if (method === 'GET' && parts.length === 3 && parts[2] === 'explain') {
          const rawPattern = url.searchParams.get('pattern');
          if (rawPattern === null) throw new ValidationError('PATTERN_MISSING', '需要 pattern 查询参数');
          const pattern = normalizePattern(rawPattern);
          const r = service.explain(id, versionFromUrl(url), pattern);
          return r ? send(res, 200, r) : send(res, 404, { code: 'PROBLEM_NOT_FOUND', message: '观测题不存在' });
        }
        // POST /problems/:id/explain
        if (method === 'POST' && parts.length === 3 && parts[2] === 'explain') {
          const body = (await readJson(req)) as { pattern?: unknown };
          if (typeof body.pattern !== 'string') throw new ValidationError('PATTERN_MISSING', '需要 pattern 字段');
          const pattern = normalizePattern(body.pattern);
          const r = service.explain(id, versionFromUrl(url), pattern);
          return r ? send(res, 200, r) : send(res, 404, { code: 'PROBLEM_NOT_FOUND', message: '观测题不存在' });
        }
        // GET /problems/:id/queries
        if (method === 'GET' && parts.length === 3 && parts[2] === 'queries') {
          const verRaw = url.searchParams.get('version');
          const r = service.queries(id, verRaw === null ? undefined : (() => {
            if (!/^\d+$/.test(verRaw)) throw new ValidationError('VERSION_INVALID', 'version 必须是正整数');
            return Number(verRaw);
          })());
          return send(res, 200, { queries: r });
        }
        // GET /problems/:id/export
        if (method === 'GET' && parts.length === 3 && parts[2] === 'export') {
          const r = service.export(id);
          return r ? send(res, 200, r) : send(res, 404, { code: 'PROBLEM_NOT_FOUND', message: '观测题不存在' });
        }
      }

      // POST /imports
      if (method === 'POST' && parts.length === 1 && parts[0] === 'imports') {
        const body = await readJson(req);
        try {
          const newId = service.import(body);
          return send(res, 201, { problemId: newId });
        } catch (err) {
          return send(res, 400, { code: 'IMPORT_INVALID', message: (err as Error).message });
        }
      }

      return send(res, 404, { code: 'ROUTE_NOT_FOUND', message: `未知路由: ${method} ${url.pathname}` });
    } catch (err) {
      if (err instanceof ValidationError) {
        return send(res, 400, { code: err.code, message: err.message });
      }
      if ((err as Error).message === 'PROBLEM_NOT_FOUND') {
        return send(res, 404, { code: 'PROBLEM_NOT_FOUND', message: '观测题不存在' });
      }
      if ((err as Error & { code?: string }).code === 'TRAINING_TOO_MANY') {
        return send(res, 400, { code: 'TRAINING_TOO_MANY', message: (err as Error).message });
      }
      return send(res, 500, { code: 'INTERNAL', message: (err as Error).message });
    }
  });
}

// 端口 0 = 由操作系统选择空闲端口（默认行为）。
export function startServer(service: Service, port: number): Promise<{ server: Server; port: number }> {
  const server = createApp(service);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const actual = (server.address() as AddressInfo).port;
      resolve({ server, port: actual });
    });
  });
}

export { normalizeLabel };
