const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function response(status, body) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return response(503, {
        service: "sctd-license-worker",
        status: "not-configured",
        detail: "E5B is private until provider approval, D1 and Worker Secrets are configured.",
      });
    }

    return response(404, { error: "not_found" });
  },
};
