import { DatabaseSync } from "node:sqlite";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import type { Policy } from "./config.js";
export type Calendar = { id: string; name: string; read_only: boolean };
export type Connection = {
  id: string;
  username: string;
  principal: string;
  calendars: Calendar[];
  policy: Policy;
  status: string;
};
export type Grant = {
  id: string;
  userId: string;
  clientId: string;
  connectionId: string;
  policy: Policy;
  scopes: string[];
  active: boolean;
  expires: number;
};
const emptyPolicy = (): Policy => ({
  read_calendars: [],
  write_calendars: [],
  write_operations: [],
});
export function sameSecret(a: string, b: string) {
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
}
export function intersect(a: Policy, b: Policy): Policy {
  const readable = a.read_calendars.filter(
    (x) => b.read_calendars.includes("*") || b.read_calendars.includes(x),
  );
  const writable = a.write_calendars.filter(
    (x) => readable.includes(x) && b.write_calendars.includes(x),
  );
  return {
    read_calendars: readable,
    write_calendars: writable,
    write_operations: writable.length
      ? a.write_operations.filter((x) => b.write_operations.includes(x))
      : [],
  };
}
export class Store {
  constructor(
    public db: DatabaseSync,
    private key: Buffer,
  ) {
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS personal_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS personal_connection (singleton INTEGER PRIMARY KEY CHECK(singleton=1), data TEXT NOT NULL, secret TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS personal_grant (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, client_id TEXT NOT NULL, connection_id TEXT NOT NULL, policy TEXT NOT NULL, scopes TEXT NOT NULL, active INTEGER NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS personal_flow (key TEXT PRIMARY KEY, grant_id TEXT NOT NULL, expires INTEGER NOT NULL);`);
    if (!this.meta("profile")) this.setMeta("profile", randomUUID());
  }
  meta(key: string): string | undefined {
    return (
      this.db
        .prepare("SELECT value FROM personal_meta WHERE key=?")
        .get(key) as { value: string } | undefined
    )?.value;
  }
  setMeta(key: string, value: string) {
    this.db
      .prepare("INSERT OR REPLACE INTO personal_meta VALUES (?,?)")
      .run(key, value);
  }
  owner(): string | undefined {
    return this.meta("owner");
  }
  bindOwner(userId: string) {
    this.db
      .prepare("INSERT OR IGNORE INTO personal_meta VALUES ('owner', ?)")
      .run(userId);
    if (this.owner() !== userId)
      throw new Error("This installation already has an owner.");
  }
  encrypt(password: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from("icloud-calendar-mcp:credential:v1"));
    const encrypted = Buffer.concat([
      cipher.update(password, "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
      "base64",
    );
  }
  decrypt(value: string): string {
    const data = Buffer.from(value, "base64");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      data.subarray(0, 12),
    );
    decipher.setAAD(Buffer.from("icloud-calendar-mcp:credential:v1"));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([
      decipher.update(data.subarray(28)),
      decipher.final(),
    ]).toString("utf8");
  }
  connection(): Connection | undefined {
    const row = this.db
      .prepare("SELECT data FROM personal_connection WHERE singleton=1")
      .get() as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  connect(
    username: string,
    password: string,
    principal: string,
    calendars: Calendar[],
  ) {
    const old = this.connection();
    const priorPrincipal = this.meta("principal");
    if (priorPrincipal && priorPrincipal !== principal)
      throw new Error(
        "This is a different iCloud account. Host reset is required.",
      );
    const c: Connection = {
      id: old?.id || randomUUID(),
      username,
      principal,
      calendars,
      policy: old?.policy || emptyPolicy(),
      status: "connected",
    };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.setMeta("principal", principal);
      this.db
        .prepare("INSERT OR REPLACE INTO personal_connection VALUES(1,?,?)")
        .run(JSON.stringify(c), this.encrypt(password));
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return c;
  }
  password(): string {
    const row = this.db
      .prepare("SELECT secret FROM personal_connection WHERE singleton=1")
      .get() as { secret: string } | undefined;
    if (!row) throw new Error("No iCloud connection.");
    return this.decrypt(row.secret);
  }
  setPolicy(policy: Policy) {
    const c = this.connection();
    if (!c || c.status !== "connected")
      throw new Error("Connect iCloud first.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const grant of this.grants(this.owner()!)) {
        const narrower = intersect(grant.policy, policy);
        this.db
          .prepare("UPDATE personal_grant SET policy=? WHERE id=?")
          .run(JSON.stringify(narrower), grant.id);
      }
      c.policy = policy;
      this.db
        .prepare("UPDATE personal_connection SET data=? WHERE singleton=1")
        .run(JSON.stringify(c));
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  draft(
    flow: string,
    userId: string,
    clientId: string,
    scopes: string[],
    policy: Policy,
  ): Grant {
    const c = this.connection();
    if (!c || c.status !== "connected")
      throw new Error("Connect iCloud first.");
    const grant: Grant = {
      id: randomUUID(),
      userId,
      clientId,
      connectionId: c.id,
      policy,
      scopes,
      active: false,
      expires: Date.now() + 15 * 60_000,
    };
    this.db
      .prepare("INSERT INTO personal_grant VALUES(?,?,?,?,?,?,0,?)")
      .run(
        grant.id,
        userId,
        clientId,
        c.id,
        JSON.stringify(policy),
        JSON.stringify(scopes),
        grant.expires,
      );
    this.db
      .prepare("INSERT OR REPLACE INTO personal_flow VALUES(?,?,?)")
      .run(flow, grant.id, grant.expires);
    return grant;
  }
  flow(key: string): Grant | undefined {
    const row = this.db
      .prepare("SELECT grant_id FROM personal_flow WHERE key=? AND expires>?")
      .get(key, Date.now()) as { grant_id: string } | undefined;
    return row ? this.grant(row.grant_id) : undefined;
  }
  grant(id: string): Grant | undefined {
    const row = this.db
      .prepare("SELECT * FROM personal_grant WHERE id=?")
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return;
    return {
      id: String(row.id),
      userId: String(row.user_id),
      clientId: String(row.client_id),
      connectionId: String(row.connection_id),
      policy: JSON.parse(String(row.policy)),
      scopes: JSON.parse(String(row.scopes)),
      active: row.active === 1,
      expires: Number(row.expires),
    };
  }
  latestGrant(userId: string, clientId: string): Grant | undefined {
    const row = this.db
      .prepare(
        "SELECT id FROM personal_grant WHERE user_id=? AND client_id=? AND active=1 ORDER BY rowid DESC LIMIT 1",
      )
      .get(userId, clientId) as { id: string } | undefined;
    return row ? this.grant(row.id) : undefined;
  }
  activate(id: string) {
    this.db
      .prepare("UPDATE personal_grant SET active=1 WHERE id=? AND expires>?")
      .run(id, Date.now());
  }
  revoke(id: string, userId: string) {
    this.db
      .prepare("UPDATE personal_grant SET active=0 WHERE id=? AND user_id=?")
      .run(id, userId);
  }
  grants(userId: string): Grant[] {
    return (
      this.db
        .prepare("SELECT id FROM personal_grant WHERE user_id=? AND active=1")
        .all(userId) as { id: string }[]
    ).map((x) => this.grant(x.id)!);
  }
  disconnect() {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec(
        "UPDATE personal_grant SET active=0; DELETE FROM personal_connection; DELETE FROM personal_flow; COMMIT",
      );
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  repair(id: string) {
    const c = this.connection();
    if (!c || c.id !== id) return;
    c.status = "repair";
    this.db
      .prepare("UPDATE personal_connection SET data=? WHERE singleton=1")
      .run(JSON.stringify(c));
    this.db
      .prepare("UPDATE personal_grant SET active=0 WHERE connection_id=?")
      .run(id);
  }
}
