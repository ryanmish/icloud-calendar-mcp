import { hashPassword } from "better-auth/crypto";
import type { Config } from "./config.js";
import type { Store } from "./store.js";

export async function resetOwnerPassword(
  config: Config,
  store: Store,
  password: string,
) {
  const owner = store.owner();
  if (
    config.loginMethod !== "password" ||
    !owner ||
    password.length < 12 ||
    password.length > 128
  )
    throw new Error(
      "Password recovery requires an enrolled password account and 12 to 128 characters.",
    );
  const hash = await hashPassword(password);
  store.db.exec("BEGIN IMMEDIATE");
  try {
    const changed = store.db
      .prepare(
        "UPDATE account SET password=?, updatedAt=? WHERE userId=? AND providerId=?",
      )
      .run(hash, Date.now(), owner, "credential");
    if (changed.changes !== 1)
      throw new Error("The owner password account could not be found.");
    store.db
      .prepare("UPDATE personal_grant SET active=0 WHERE user_id=?")
      .run(owner);
    store.db.prepare("DELETE FROM oauthRefreshToken WHERE userId=?").run(owner);
    store.db.prepare("DELETE FROM session WHERE userId=?").run(owner);
    store.db.exec("COMMIT");
  } catch (error) {
    store.db.exec("ROLLBACK");
    throw error;
  }
}
