import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";

test("default password mode starts without Apple developer settings or a signing key", () => {
  const directory = mkdtempSync(join(tmpdir(), "calendar-config-test-"));
  try {
    const secret = join(directory, "test-key");
    writeFileSync(secret, "a".repeat(64), { mode: 0o600 });
    const config = loadConfig({
      MCP_PUBLIC_URL: "https://cal.ryanmish.com",
      CALENDAR_ENCRYPTION_KEY_FILE: secret,
      BETTER_AUTH_SECRET_FILE: secret,
      MCP_SETUP_SECRET_FILE: secret,
      OWNER_ENROLLMENT_CODE_FILE: secret,
    });
    assert.equal(config.loginMethod, "password");
    assert.equal(config.applePrivateKey, "");
    assert.deepEqual(config.hostPolicy.write_operations, []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
