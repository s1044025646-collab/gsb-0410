import * as http from "node:http";
import {
  createPuzzle,
  appendObservations,
  solve,
  getCandidatesPage,
  explain,
  decode,
  exportPuzzle,
  importPuzzle,
} from "./db";
import {
  ApiError,
  validateObservationList,
  validatePattern,
  validatePatternList,
  validatePagination,
} from "./validate";
import { SEGMENT_NAMES, DIGIT_SEGMENTS, SEGMENT_TABLE_VERSION } from "./core";

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(json);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1_000_000) reject(new ApiError("BODY_TOO_LARGE", "请求体过大"));
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new ApiError("INVALID_JSON", "请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

function parseId(raw: string | undefined): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError("INVALID_ID", "id 必须是正整数");
  return id;
}

async function route(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  const m = req.method ?? "GET";
  const parts = url.pathname.split("/").filter(Boolean);
  const body = ["POST", "PUT"].includes(m) ? await readBody(req) : {};

  if (m === "GET" && url.pathname === "/segments") {
    return send(res, 200, { version: SEGMENT_TABLE_VERSION, names: SEGMENT_NAMES, digits: DIGIT_SEGMENTS });
  }
  if (m === "POST" && url.pathname === "/puzzles") {
    const b = body as any;
    const name = typeof b.name === "string" && b.name ? b.name : "未命名观测题";
    const observations = validateObservationList(b.observations);
    const id = createPuzzle(name, observations);
    return send(res, 201, solve(id));
  }
  if (m === "POST" && url.pathname === "/import") {
    const id = importPuzzle(body);
    return send(res, 201, solve(id));
  }
  if (parts[0] === "puzzles" && parts.length >= 2) {
    const id = parseId(parts[1]);
    const action = parts[2];
    if (m === "POST" && action === "observations" && parts.length === 3) {
      const observations = validateObservationList((body as any).observations);
      const versionNo = appendObservations(id, observations);
      const result = solve(id);
      return send(res, 200, { ...result, newVersion: versionNo });
    }
    if (m === "POST" && action === "solve" && parts.length === 3) {
      return send(res, 200, solve(id));
    }
    if (m === "GET" && action === "candidates" && parts.length === 3) {
      const { limit, offset } = validatePagination(url.searchParams);
      return send(res, 200, getCandidatesPage(id, limit, offset));
    }
    if (m === "POST" && action === "explain" && parts.length === 3) {
      const pattern = validatePattern((body as any).pattern);
      return send(res, 200, explain(id, pattern));
    }
    if (m === "POST" && action === "decode" && parts.length === 3) {
      const patterns = validatePatternList((body as any).patterns);
      return send(res, 200, decode(id, patterns));
    }
    if (m === "GET" && action === "export" && parts.length === 3) {
      return send(res, 200, exportPuzzle(id));
    }
  }
  throw new ApiError("NOT_FOUND", `路由不存在：${m} ${url.pathname}`, 404);
}

export function createServer(): http.Server {
  return http.createServer((req, res) => {
    route(req, res, new URL(req.url ?? "/", "http://localhost")).catch((e) => {
      if (e instanceof ApiError) {
        send(res, e.status, { error: { code: e.code, message: e.message } });
      } else {
        send(res, 500, { error: { code: "INTERNAL", message: String(e) } });
      }
    });
  });
}

if (require.main === module) {
  const portEnv = process.env.PORT;
  const port = portEnv ? Number(portEnv) : 0; // 默认选择空闲端口
  if (portEnv && (!Number.isInteger(port) || port < 0 || port > 65535)) {
    console.error("PORT 必须是 0-65535 的整数");
    process.exit(1);
  }
  const server = createServer();
  server.listen(port, () => {
    const addr = server.address();
    console.log(`七段数码管接线推断服务已启动: http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : port}`);
  });
}
