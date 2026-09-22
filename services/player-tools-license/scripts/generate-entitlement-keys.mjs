import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const keyId = process.argv[2] || `p256-${new Date().toISOString().slice(0, 7)}`;
if (!/^[A-Za-z0-9._-]{1,128}$/.test(keyId)) throw new Error("Key ID must use letters, numbers, dot, underscore or dash.");
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
privateJwk.kid = keyId;
publicJwk.kid = keyId;
delete publicJwk.key_ops;
delete publicJwk.ext;
await writeFile(path.join(root, ".dev.vars.entitlement"),
  `ENTITLEMENT_KEY_ID=${keyId}\nENTITLEMENT_PRIVATE_JWK=${JSON.stringify(privateJwk)}\n`, { mode: 0o600 });
await writeFile(path.join(root, "entitlement-public.jwk.json"),
  `${JSON.stringify({ keys: [publicJwk] }, null, 2)}\n`);
console.log(`Generated ${keyId}: .dev.vars.entitlement (private, gitignored) and entitlement-public.jwk.json (public JWKS).`);
