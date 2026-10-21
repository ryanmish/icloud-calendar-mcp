// Compatibility with @better-auth/oauth-provider 1.7.6 signed-query format.
// Uses the library's supported signing primitive; the provider verifies again on POST.
// Better Auth is MIT licensed. See THIRD_PARTY_NOTICES.md.
import { makeSignature } from "better-auth/crypto";
import { sameSecret } from "./store.js";
export async function verifyOAuthQueryParams(
  query: string,
  secret: string,
): Promise<boolean> {
  const p = new URLSearchParams(query);
  const sigs = p.getAll("sig");
  const exp = Number(p.get("exp"));
  p.delete("sig");
  const canonical = new URLSearchParams();
  for (const [k, v] of [...p.entries()].sort(([a, b], [c, d]) =>
    a < c ? -1 : a > c ? 1 : b < d ? -1 : b > d ? 1 : 0,
  ))
    canonical.append(k, v);
  return (
    sigs.length === 1 &&
    !!sigs[0] &&
    Number.isFinite(exp) &&
    exp * 1000 > Date.now() &&
    sameSecret(sigs[0], await makeSignature(canonical.toString(), secret))
  );
}
