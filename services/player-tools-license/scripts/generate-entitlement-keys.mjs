import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const keyId = process.argv[2] || `p256-${new Date().toISOString().slice(0, 7)}`;
const environment = process.argv[3] || "local";
if (!/^[A-Za-z0-9._-]{1,128}$/.test(keyId)) throw new Error("Key ID must use letters, numbers, dot, underscore or dash.");
if (!/^[a-z0-9._-]{1,32}$/.test(environment)) throw new Error("Environment must use lowercase letters, numbers, dot, underscore or dash.");
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
privateJwk.kid = keyId;
publicJwk.kid = keyId;
delete publicJwk.key_ops;
delete publicJwk.ext;
const privateFile = `.dev.vars.entitlement.${environment}`;
const publicFile = `entitlement-public.${environment}.jwk.json`;
await writeFile(path.join(root, privateFile),
  `ENTITLEMENT_KEY_ID=${keyId}\nENTITLEMENT_PRIVATE_JWK=${JSON.stringify(privateJwk)}\n`, { mode: 0o600 });
await writeFile(path.join(root, publicFile),
  `${JSON.stringify({ keys: [publicJwk] }, null, 2)}\n`);
console.log(`Generated ${keyId}: ${privateFile} (private, gitignored) and ${publicFile} (public JWKS).`);
