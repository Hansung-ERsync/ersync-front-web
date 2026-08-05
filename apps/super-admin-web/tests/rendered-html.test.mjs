import assert from "node:assert/strict";
import test from "node:test";

async function requestApp(path = "/", init = {}, upstreamFetch = null) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const originalFetch = globalThis.fetch;
  if (upstreamFetch) globalThis.fetch = upstreamFetch;
  try {
    return await worker.fetch(
      new Request(`http://localhost${path}`, {
        ...init,
        headers: { accept: "text/html", ...init.headers },
      }),
      { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
      { waitUntil() {}, passThroughOnException() {} },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function adminAuthPayload() {
  return {
    tokenType: "Bearer",
    accessToken: "admin-access",
    accessTokenExpiresAt: "2099-08-04T03:09:00Z",
    refreshToken: "admin-refresh",
    refreshTokenExpiresAt: "2099-08-05T03:09:00Z",
    accountId: "00112233-4455-6677-8899-aabbccddeeff",
    organizationId: null,
    role: "SUPER_ADMIN",
  };
}

test("server-renders the independent ERSync Admin shell", async () => {
  const response = await requestApp();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>ERSync Admin \| 슈퍼 관리자 운영 콘솔<\/title>/i);
  assert.match(html, /ERSync/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("admin login always sends the fixed SUPER_ADMIN role", async () => {
  let upstreamBody = null;
  const response = await requestApp(
    "/api/session",
    {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ loginId: "admin", password: "test-password" }),
    },
    async (input, init = {}) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      assert.equal(url.pathname, "/api/v1/auth/login");
      upstreamBody = JSON.parse(init.body);
      return Response.json(adminAuthPayload());
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(upstreamBody, {
    loginId: "admin",
    password: "test-password",
    role: "SUPER_ADMIN",
  });
  assert.equal((await response.json()).session.role, "SUPER_ADMIN");
});

test("does not expose hospital offer, withdrawal, or realtime routes", async () => {
  const profile = await requestApp("/api/ersync/hospitals/me", {
    headers: { accept: "application/json" },
  });
  assert.equal(profile.status, 404);
  assert.equal((await profile.json()).code, "COMMON_404");

  const offer = await requestApp("/api/ersync/hospitals/me/offers?view=ACTIVE", {
    headers: { accept: "application/json" },
  });
  assert.equal(offer.status, 404);
  assert.equal((await offer.json()).code, "COMMON_404");

  for (const suffix of ["clinical-timeline?page=0&size=50", "location"]) {
    const protectedRead = await requestApp(
      `/api/ersync/hospitals/me/offers/00112233-4455-6677-8899-aabbccddeeff/${suffix}`,
      { headers: { accept: "application/json" } },
    );
    assert.equal(protectedRead.status, 404);
    assert.equal((await protectedRead.json()).code, "COMMON_404");
  }

  const withdrawal = await requestApp(
    "/api/ersync/hospitals/me/offers/00112233-4455-6677-8899-aabbccddeeff/withdraw-acceptance",
    {
      method: "POST",
      headers: { accept: "application/json" },
    },
  );
  assert.equal(withdrawal.status, 404);
  assert.equal((await withdrawal.json()).code, "COMMON_404");

  const confirmHandoff = await requestApp(
    "/api/ersync/hospitals/me/offers/00112233-4455-6677-8899-aabbccddeeff/confirm-handoff",
    {
      method: "POST",
      headers: { accept: "application/json" },
    },
  );
  assert.equal(confirmHandoff.status, 404);
  assert.equal((await confirmHandoff.json()).code, "COMMON_404");

  const realtime = await requestApp("/api/realtime/events", {
    headers: { accept: "text/event-stream" },
  });
  assert.equal(realtime.status, 404);
});
