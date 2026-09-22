const [installationId, licenseKey, mode = "preview"] = process.argv.slice(2);
const baseUrl = process.env.PLAYER_TOOLS_ADMIN_URL;
const token = process.env.PLAYER_TOOLS_ADMIN_TOKEN;
if (!baseUrl || !token || !installationId || !licenseKey || !["preview", "apply"].includes(mode)) {
  console.error("Usage: PLAYER_TOOLS_ADMIN_URL=... PLAYER_TOOLS_ADMIN_TOKEN=... node scripts/release-seat.mjs INSTALLATION_ID LICENSE_KEY [preview|apply]");
  process.exitCode = 2;
} else {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/admin/release-seat`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ installationId, licenseKey, dryRun: mode !== "apply" }),
  });
  const result = await response.json().catch(() => ({ error: "invalid_response" }));
  if (!response.ok) {
    console.error(`Seat release failed (${response.status}): ${result.error || "unknown_error"}`);
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(result));
  }
}
