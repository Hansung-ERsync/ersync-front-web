import assert from "node:assert/strict";
import test from "node:test";

let requestSequence = 0;

async function requestApp(path = "/", init = {}, upstreamFetch = null) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set(
    "test",
    `${process.pid}-${Date.now()}-${requestSequence++}`,
  );
  const { default: worker } = await import(workerUrl.href);

  const originalFetch = globalThis.fetch;
  if (upstreamFetch) globalThis.fetch = upstreamFetch;
  try {
    return await worker.fetch(
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
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function hospitalCookies({
  accessToken = "hospital-access",
  refreshToken = "hospital-refresh",
  role = "HOSPITAL_STAFF",
} = {}) {
  const session = Buffer.from(
    JSON.stringify({
      accountId: "00112233-4455-6677-8899-aabbccddeeff",
      organizationId: "11223344-5566-7788-99aa-bbccddeeff00",
      role,
      accessTokenExpiresAt: "2099-08-04T03:09:00Z",
      refreshTokenExpiresAt: "2099-08-05T03:09:00Z",
      loginId: "testhospital",
    }),
  ).toString("base64");
  const cookies = [
    accessToken ? `ersync_hospital_access=${accessToken}` : null,
    refreshToken ? `ersync_hospital_refresh=${refreshToken}` : null,
    `ersync_hospital_session=${encodeURIComponent(session)}`,
  ].filter(Boolean);
  return cookies.join("; ");
}

function authPayload(accessToken = "rotated-access") {
  return {
    tokenType: "Bearer",
    accessToken,
    accessTokenExpiresAt: "2099-08-04T03:09:00Z",
    refreshToken: "rotated-refresh",
    refreshTokenExpiresAt: "2099-08-05T03:09:00Z",
    accountId: "00112233-4455-6677-8899-aabbccddeeff",
    organizationId: "11223344-5566-7788-99aa-bbccddeeff00",
    role: "HOSPITAL_STAFF",
  };
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

test("exposes hospital offer and realtime routes behind authentication", async () => {
  const offers = await requestApp(
    "/api/ersync/hospitals/me/offers?view=ACTIVE&page=0&size=20",
    { headers: { accept: "application/json" } },
  );
  assert.equal(offers.status, 401);
  assert.equal((await offers.json()).code, "AUTH_001");

  const accept = await requestApp(
    "/api/ersync/hospitals/me/offers/00112233-4455-6677-8899-aabbccddeeff/accept",
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "Idempotency-Key": "hospital-accept:test-key",
      },
    },
  );
  assert.equal(accept.status, 401);
  assert.equal((await accept.json()).code, "AUTH_001");

  const withdrawal = await requestApp(
    "/api/ersync/hospitals/me/offers/00112233-4455-6677-8899-aabbccddeeff/withdraw-acceptance",
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "Idempotency-Key": "hospital-withdraw:test-key",
      },
      body: JSON.stringify({ reason: "BED_SHORTAGE", detail: null }),
    },
  );
  assert.equal(withdrawal.status, 401);
  assert.equal((await withdrawal.json()).code, "AUTH_001");

  const realtime = await requestApp("/api/realtime/events", {
    headers: { accept: "text/event-stream" },
  });
  assert.equal(realtime.status, 401);
  assert.equal((await realtime.json()).code, "AUTH_001");
});

test("forwards authenticated ACTIVE/HISTORY offer reads without exposing tokens", async () => {
  const requestedViews = [];
  const upstreamFetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    assert.equal(url.pathname, "/api/v1/hospitals/me/offers");
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer hospital-access");
    requestedViews.push(url.searchParams.get("view"));
    return Response.json({
      items: [],
      page: 0,
      size: 20,
      totalElements: 0,
      totalPages: 0,
      serverNow: "2026-08-04T03:09:10Z",
    });
  };

  for (const view of ["ACTIVE", "HISTORY"]) {
    const response = await requestApp(
      `/api/ersync/hospitals/me/offers?view=${view}&page=0&size=20`,
      {
        headers: {
          accept: "application/json",
          cookie: hospitalCookies(),
        },
      },
      upstreamFetch,
    );
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).items, []);
  }
  assert.deepEqual(requestedViews, ["ACTIVE", "HISTORY"]);
});

test("forwards accept, reject, and withdrawal commands with exact keys and bodies", async () => {
  const offerId = "00112233-4455-6677-8899-aabbccddeeff";
  const scenarios = [
    {
      action: "accept",
      key: "hospital-accept:test-key",
      body: null,
      response: { offerStatus: "ACCEPTED" },
    },
    {
      action: "reject",
      key: "hospital-reject:test-key",
      body: { reason: "SPECIALIST_UNAVAILABLE", detail: null },
      response: { offerStatus: "REJECTED" },
    },
    {
      action: "withdraw-acceptance",
      key: "hospital-withdraw:test-key",
      body: { reason: "BED_SHORTAGE", detail: null },
      response: { offerStatus: "ACCEPTANCE_WITHDRAWN" },
    },
  ];

  for (const scenario of scenarios) {
    const upstreamFetch = async (input, init = {}) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      assert.equal(
        url.pathname,
        `/api/v1/hospitals/me/offers/${offerId}/${scenario.action}`,
      );
      const headers = new Headers(init.headers);
      assert.equal(headers.get("Authorization"), "Bearer hospital-access");
      assert.equal(headers.get("Idempotency-Key"), scenario.key);
      assert.equal(init.method, "POST");
      assert.deepEqual(init.body ? JSON.parse(init.body) : null, scenario.body);
      return Response.json({
        offerId,
        transportRequestId: "request-id",
        transportRequestStatus: "SEARCHING",
        idempotentReplay: false,
        ...scenario.response,
      });
    };

    const response = await requestApp(
      `/api/ersync/hospitals/me/offers/${offerId}/${scenario.action}`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          cookie: hospitalCookies(),
          "content-type": "application/json",
          "Idempotency-Key": scenario.key,
        },
        ...(scenario.body ? { body: JSON.stringify(scenario.body) } : {}),
      },
      upstreamFetch,
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).offerStatus, scenario.response.offerStatus);
  }
});

test("retries a lost decision with the same key and body after token rotation", async () => {
  const offerId = "00112233-4455-6677-8899-aabbccddeeff";
  const key = "hospital-withdraw:stable-key";
  const body = JSON.stringify({ reason: "OTHER", detail: "운영 사유" });
  const decisionCalls = [];
  let refreshCalls = 0;
  const upstreamFetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname === "/api/v1/auth/tokens/refresh") {
      refreshCalls += 1;
      assert.deepEqual(JSON.parse(init.body), { refreshToken: "hospital-refresh" });
      return Response.json(authPayload());
    }
    decisionCalls.push({
      authorization: new Headers(init.headers).get("Authorization"),
      key: new Headers(init.headers).get("Idempotency-Key"),
      body: init.body,
    });
    if (decisionCalls.length === 1) {
      return Response.json(
        { code: "AUTH_002", message: "토큰 만료", fieldErrors: [], traceId: "trace" },
        { status: 401 },
      );
    }
    return Response.json({
      offerId,
      offerStatus: "ACCEPTANCE_WITHDRAWN",
      transportRequestId: "request-id",
      transportRequestStatus: "SEARCHING",
      currentDestinationOfferId: null,
      reason: "OTHER",
      detail: "운영 사유",
      withdrawnAt: "2026-08-04T03:15:00Z",
      searchRestarted: true,
      idempotentReplay: false,
    });
  };

  const response = await requestApp(
    `/api/ersync/hospitals/me/offers/${offerId}/withdraw-acceptance`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        cookie: hospitalCookies(),
        "content-type": "application/json",
        "Idempotency-Key": key,
      },
      body,
    },
    upstreamFetch,
  );

  assert.equal(response.status, 200);
  assert.equal(refreshCalls, 1);
  assert.equal(decisionCalls.length, 2);
  assert.deepEqual(decisionCalls[0], {
    authorization: "Bearer hospital-access",
    key,
    body,
  });
  assert.deepEqual(decisionCalls[1], {
    authorization: "Bearer rotated-access",
    key,
    body,
  });
  assert.match(response.headers.get("set-cookie") ?? "", /ersync_hospital_access/);
});

test("streams authenticated realtime update signals through the same origin", async () => {
  const event = [
    "id: event-id",
    "event: update",
    'data: {"eventId":"event-id","type":"DESTINATION_CHANGED","aggregateType":"TRANSPORT_DESTINATION","aggregateId":"command-id","occurredAt":"2026-08-04T03:14:00Z"}',
    "",
    "",
  ].join("\n");
  const upstreamFetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    assert.equal(url.pathname, "/api/v1/realtime/events");
    const headers = new Headers(init.headers);
    assert.equal(headers.get("Authorization"), "Bearer hospital-access");
    assert.equal(headers.get("Accept"), "text/event-stream");
    return new Response(event, {
      headers: { "Content-Type": "text/event-stream" },
    });
  };

  const response = await requestApp(
    "/api/realtime/events",
    {
      headers: {
        accept: "text/event-stream",
        cookie: hospitalCookies(),
      },
    },
    upstreamFetch,
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/event-stream/i);
  assert.equal(response.headers.get("x-accel-buffering"), "no");
  assert.equal(await response.text(), event);
});

test("blocks super-admin sessions from the hospital realtime stream", async () => {
  let upstreamCalled = false;
  const response = await requestApp(
    "/api/realtime/events",
    {
      headers: {
        accept: "text/event-stream",
        cookie: hospitalCookies({ role: "SUPER_ADMIN" }),
      },
    },
    async () => {
      upstreamCalled = true;
      throw new Error("must not call upstream");
    },
  );

  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "AUTH_003");
  assert.equal(upstreamCalled, false);
});
