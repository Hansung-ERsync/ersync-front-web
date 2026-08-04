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
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the independent ERSync Admin shell", async () => {
  const response = await requestApp();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>ERSync Admin \| 슈퍼 관리자 운영 콘솔<\/title>/i);
  assert.match(html, /ERSync/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("does not expose hospital offer, withdrawal, or realtime routes", async () => {
  const offer = await requestApp("/api/ersync/hospitals/me/offers?view=ACTIVE", {
    headers: { accept: "application/json" },
  });
  assert.equal(offer.status, 404);
  assert.equal((await offer.json()).code, "COMMON_404");

  const withdrawal = await requestApp(
    "/api/ersync/hospitals/me/offers/00112233-4455-6677-8899-aabbccddeeff/withdraw-acceptance",
    {
      method: "POST",
      headers: { accept: "application/json" },
    },
  );
  assert.equal(withdrawal.status, 404);
  assert.equal((await withdrawal.json()).code, "COMMON_404");

  const realtime = await requestApp("/api/realtime/events", {
    headers: { accept: "text/event-stream" },
  });
  assert.equal(realtime.status, 404);
});
