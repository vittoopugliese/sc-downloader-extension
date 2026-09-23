import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const environment = option("--env", "test");
const configPath = path.resolve(root, option("--config", "wrangler.jsonc"));
if (!['test', 'production'].includes(environment)) throw new Error("--env must be test or production.");

const config = JSON.parse(await readFile(configPath, "utf8"));
const selected = environment === "production" ? config.env?.production : config;
if (!selected) throw new Error(`Missing ${environment} environment in ${configPath}.`);

const requiredSecrets = ["LEMON_API_KEY", "LEMON_WEBHOOK_SECRET", "ENTITLEMENT_PRIVATE_JWK", "ADMIN_TOKEN"];
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const binding = selected.d1_databases?.find((item) => item.binding === "LICENSE_DB");
const route = selected.routes?.[0]?.pattern || "";
const vars = selected.vars || {};
const origin = String(vars.ALLOWED_ORIGINS || "");
const requiredRateLimiters = ["TRIAL_RATE_LIMITER", "LICENSE_RATE_LIMITER", "CHECKOUT_RATE_LIMITER", "EVENT_RATE_LIMITER"];

check(typeof selected.name === "string" && selected.name.length > 0, `${environment}: Worker name is required.`);
check(Array.isArray(selected.routes) && selected.routes.length === 1 && /\/api\/player-tools\/\*$/.test(route),
  `${environment}: configure exactly one /api/player-tools/* route.`);
check(binding?.database_name && binding?.database_id, `${environment}: LICENSE_DB name and ID are required.`);
check(binding?.migrations_dir === "migrations", `${environment}: LICENSE_DB must use the migrations directory.`);
check(vars.LEMON_MODE === (environment === "production" ? "live" : "test"), `${environment}: LEMON_MODE is wrong.`);
for (const name of ["LEMON_STORE_ID", "LEMON_PRODUCT_ID", "LEMON_VARIANT_ID"]) {
  check(/^\d+$/.test(String(vars[name] || "")), `${environment}: ${name} must be the numeric Lemon ID.`);
}
check(/^[A-Za-z0-9._-]{1,128}$/.test(String(vars.ENTITLEMENT_KEY_ID || "")) && !String(vars.ENTITLEMENT_KEY_ID).includes("YYYY"),
  `${environment}: ENTITLEMENT_KEY_ID must match the generated signing key.`);
check(/^chrome-extension:\/\/[a-p]{32}$/.test(origin), `${environment}: ALLOWED_ORIGINS must be one explicit Chrome extension origin.`);
check(!/REPLACE_WITH|localhost|127\.0\.0\.1/.test(JSON.stringify(selected)), `${environment}: placeholders or local origins remain.`);
for (const name of requiredSecrets) check(selected.secrets?.required?.includes(name), `${environment}: declare required secret ${name}.`);
const rateLimiters = selected.ratelimits || [];
for (const name of requiredRateLimiters) {
  const limiter = rateLimiters.find((item) => item.name === name);
  check(limiter && /^\d+$/.test(String(limiter.namespace_id || "")) &&
    Number.isSafeInteger(limiter.simple?.limit) && limiter.simple.limit > 0 && [10, 60].includes(limiter.simple?.period),
    `${environment}: ${name} must have a unique numeric namespace and a supported simple limit.`);
}
check(new Set(rateLimiters.map((item) => item.namespace_id)).size === rateLimiters.length,
  `${environment}: rate-limit namespaces must be unique.`);

if (environment === "production") {
  const testBinding = config.d1_databases?.find((item) => item.binding === "LICENSE_DB");
  const testRoute = config.routes?.[0]?.pattern || "";
  check(config.name !== selected.name, "test and production Worker names must differ.");
  check(testRoute !== route, "test and production routes must differ.");
  check(testBinding?.database_id !== binding?.database_id, "test and production D1 database IDs must differ.");
  const testRateNamespaces = new Set((config.ratelimits || []).map((item) => item.namespace_id));
  check(!(selected.ratelimits || []).some((item) => testRateNamespaces.has(item.namespace_id)),
    "test and production rate-limit namespaces must differ.");
  check(config.vars?.LEMON_STORE_ID !== vars.LEMON_STORE_ID || config.vars?.LEMON_PRODUCT_ID !== vars.LEMON_PRODUCT_ID ||
    config.vars?.LEMON_VARIANT_ID !== vars.LEMON_VARIANT_ID, "test and production Lemon IDs must not all be identical.");
}

if (failures.length) {
  console.error(failures.map((message) => `- ${message}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`${environment} configuration is locally consistent: ${selected.name}, ${route}, ${binding.database_name}.`);
}
