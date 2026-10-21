import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { Readable } from "node:stream";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { loadConfig } from "./config.js";
import { Store } from "./store.js";
import { createAuth } from "./auth.js";
import { App } from "./app.js";
process.umask(0o077);
const config = loadConfig();
mkdirSync(dirname(config.database), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(config.database);
const store = new Store(db, config.encryptionKey);
const auth = createAuth(config, store);
const app = new App(config, store, auth, async (username, password) => {
  const response = await fetch(config.calendarBackend + "/internal/discover", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + config.internalSecret,
    },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(90_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error("Calendar discovery failed.");
  return response.json();
});
function listener(internal: boolean) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const parts: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1024 * 1024) {
          res.writeHead(413);
          res.end();
          return;
        }
        parts.push(chunk);
      }
      const headers = new Headers();
      for (const [key, val] of Object.entries(req.headers)) {
        if (val !== undefined)
          headers.set(key, Array.isArray(val) ? val.join(",") : val);
      }
      const request = new Request(config.origin + (req.url || "/"), {
        method: req.method,
        headers,
        body: ["GET", "HEAD"].includes(req.method || "GET")
          ? undefined
          : Buffer.concat(parts),
      });
      const response = await (internal
        ? app.internal(request)
        : app.handle(request));
      const out: Record<string, string | string[]> = {};
      response.headers.forEach((v, k) => {
        if (k !== "set-cookie") out[k] = v;
      });
      if (response.headers.getSetCookie().length)
        out["set-cookie"] = response.headers.getSetCookie();
      res.writeHead(response.status, out);
      if (response.body) Readable.fromWeb(response.body as never).pipe(res);
      else res.end();
    } catch {
      if (!res.headersSent) res.writeHead(400, { "Cache-Control": "no-store" });
      res.end("The request could not be processed.");
    }
  };
}
const publicServer = createServer({ maxHeaderSize: 16384 }, listener(false));
const privateServer = createServer({ maxHeaderSize: 16384 }, listener(true));
publicServer.listen(
  Number(process.env.WEB_PORT || 3000),
  process.env.WEB_BIND_HOST || "127.0.0.1",
);
privateServer.listen(
  Number(process.env.SETUP_PORT || 3001),
  process.env.SETUP_BIND_HOST || "127.0.0.1",
);
console.info("Calendar web service started. Account setup is required.");
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    publicServer.close();
    privateServer.close();
    setTimeout(() => {
      db.close();
      process.exit(0);
    }, 1000).unref();
  });
