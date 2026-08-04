import assert from "node:assert/strict";
import test from "node:test";

async function requestApp(path = "/", init = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      ...init,
      headers: { accept: "text/html", ...init.headers },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the ERSync application shell", async () => {
  const response = await requestApp();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(
    html,
    /<title>ERSync 병원 웹 \| 응급환자 이송 연계 시스템<\/title>/i,
  );
  assert.match(html, /ERSync/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("does not expose paramedic assessment or transport APIs", async () => {
  const assessment = await requestApp("/api/ersync/assessment-protocols/active", {
    headers: { accept: "application/json" },
  });
  assert.equal(assessment.status, 404);
  assert.equal((await assessment.json()).code, "COMMON_404");

  const transport = await requestApp("/api/ersync/transport-requests", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(transport.status, 404);
  assert.equal((await transport.json()).code, "COMMON_404");
});
