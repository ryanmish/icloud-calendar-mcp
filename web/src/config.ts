import { readFileSync, statSync } from "node:fs";

export type Policy = {
  read_calendars: string[];
  write_calendars: string[];
  write_operations: string[];
};
export type Config = {
  loginMethod: "password" | "apple";
  origin: string;
  database: string;
  authSecret: string;
  encryptionKey: Buffer;
  internalSecret: string;
  enrollmentCode: string;
  appleClientId: string;
  appleTeamId: string;
  appleKeyId: string;
  applePrivateKey: string;
  icloudAddress: string;
  calendarBackend: string;
  hostPolicy: Policy;
};
export function secretFile(path: string | undefined): string {
  if (!path)
    throw new Error("A secret file is required. See docs/personal-setup.md.");
  const stat = statSync(path);
  if (!stat.isFile() || stat.mode & 0o077)
    throw new Error("Secret files must have mode 0400 or 0600.");
  const value = readFileSync(path, "utf8").trim();
  if (value.length < 32 || value.length > 8192)
    throw new Error("Invalid secret file.");
  return value;
}
export function ids(value: string): string[] {
  const result: unknown = JSON.parse(value);
  if (
    !Array.isArray(result) ||
    result.some((v) => typeof v !== "string" || !v || v.length > 2048)
  )
    throw new Error("Calendar policy must contain calendar IDs.");
  return [...new Set(result)] as string[];
}
export function privateBackend(value: string): string {
  const u = new URL(value);
  if (
    u.protocol !== "http:" ||
    !["calendar", "localhost", "127.0.0.1", "[::1]"].includes(u.hostname) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== "/"
  )
    throw new Error("The calendar backend must be a private service URL.");
  return value.replace(/\/$/, "");
}
export function loadConfig(env = process.env): Config {
  const required = (name: string) => {
    const v = env[name];
    if (!v) throw new Error(`${name} is required.`);
    return v;
  };
  const origin = required("MCP_PUBLIC_URL").replace(/\/$/, "");
  const loginMethod = env.MCP_LOGIN_METHOD || "password";
  if (!["password", "apple"].includes(loginMethod))
    throw new Error("MCP_LOGIN_METHOD must be password or apple.");
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.origin !== origin)
    throw new Error("MCP_PUBLIC_URL must be an HTTPS origin.");
  const key = secretFile(env.CALENDAR_ENCRYPTION_KEY_FILE);
  if (!/^[a-f0-9]{64}$/i.test(key))
    throw new Error("The calendar encryption key must be 32 bytes in hex.");
  const hostPolicy = {
    read_calendars: ids(env.MCP_READ_CALENDARS || '["*"]'),
    write_calendars: ids(env.MCP_WRITE_CALENDARS || "[]"),
    write_operations: ids(env.MCP_WRITE_OPERATIONS || "[]"),
  };
  if (
    hostPolicy.write_calendars.includes("*") ||
    hostPolicy.write_operations.some(
      (v) => !["create", "update"].includes(v),
    ) ||
    (hostPolicy.write_operations.length && !hostPolicy.write_calendars.length)
  )
    throw new Error("Invalid write policy.");
  if (
    !hostPolicy.read_calendars.includes("*") &&
    hostPolicy.write_calendars.some(
      (v) => !hostPolicy.read_calendars.includes(v),
    )
  )
    throw new Error("Writable calendars must also be readable.");
  return {
    loginMethod: loginMethod as Config["loginMethod"],
    origin,
    database: env.CALENDAR_DATABASE || "/data/calendar.sqlite",
    authSecret: secretFile(env.BETTER_AUTH_SECRET_FILE),
    encryptionKey: Buffer.from(key, "hex"),
    internalSecret: secretFile(env.MCP_SETUP_SECRET_FILE),
    enrollmentCode: secretFile(env.OWNER_ENROLLMENT_CODE_FILE),
    appleClientId: loginMethod === "apple" ? required("APPLE_CLIENT_ID") : "",
    appleTeamId: loginMethod === "apple" ? required("APPLE_TEAM_ID") : "",
    appleKeyId: loginMethod === "apple" ? required("APPLE_KEY_ID") : "",
    applePrivateKey:
      loginMethod === "apple" ? secretFile(env.APPLE_PRIVATE_KEY_FILE) : "",
    icloudAddress: env.ICLOUD_USERNAME || "",
    calendarBackend: privateBackend(
      env.CALENDAR_BACKEND_URL || "http://calendar:8000",
    ),
    hostPolicy,
  };
}
