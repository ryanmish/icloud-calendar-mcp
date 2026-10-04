import { DatabaseSync } from "node:sqlite";
import { loadConfig } from "./config.js";
import { Store } from "./store.js";
import { resetOwnerPassword } from "./password.js";
process.umask(0o077);
let input = "";
for await (const chunk of process.stdin) {
  input += chunk.toString();
  if (Buffer.byteLength(input) > 1024)
    throw new Error("Password input is too long.");
}
const config = loadConfig();
const db = new DatabaseSync(config.database);
try {
  await resetOwnerPassword(
    config,
    new Store(db, config.encryptionKey),
    input.replace(/\n$/, ""),
  );
  console.info(
    "Owner password changed. Sessions and client grants were revoked.",
  );
} finally {
  db.close();
}
