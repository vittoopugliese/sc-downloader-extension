const [action, licenseKey, installationId] = process.argv.slice(2);
const baseUrl = process.env.PLAYER_TOOLS_ADMIN_URL;
const token = process.env.PLAYER_TOOLS_ADMIN_TOKEN;
const paths = Object.freeze({ inspect: "inspect-license", reconcile: "reconcile-seat" });

if (!baseUrl || !token || !licenseKey || !Object.hasOwn(paths, action) || (action === "reconcile" && !installationId)) {
  console.error("Usage: PLAYER_TOOLS_ADMIN_URL=... PLAYER_TOOLS_ADMIN_TOKEN=... node scripts/license-admin.mjs <inspect|reconcile> LICENSE_KEY [INSTALLATION_ID]");
  process.exitCode = 2;
} else {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/admin/${paths[action]}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ licenseKey, ...(action === "reconcile" ? { installationId } : {}) }),
  });
  const result = await response.json().catch(() => ({ error: "invalid_response" }));
  if (!response.ok) {
    console.error(`License ${action} failed (${response.status}): ${result.error || "unknown_error"}`);
    process.exitCode = 1;
  } else console.log(JSON.stringify(result));
}
