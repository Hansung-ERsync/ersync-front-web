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

test("hospital login always sends the fixed HOSPITAL_STAFF role", async () => {
  let upstreamBody = null;
  const response = await requestApp(
    "/api/session",
    {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ loginId: "shared01", password: "test-password" }),
    },
    async (input, init = {}) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      assert.equal(url.pathname, "/api/v1/auth/login");
      upstreamBody = JSON.parse(init.body);
      return Response.json(authPayload());
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(upstreamBody, {
    loginId: "shared01",
    password: "test-password",
    role: "HOSPITAL_STAFF",
  });
  assert.equal((await response.json()).session.role, "HOSPITAL_STAFF");
});

test("validates a hospital invitation before signup without requiring a session", async () => {
  let upstreamBody = null;
  const response = await requestApp(
    "/api/ersync/auth/invitations/validate",
    {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ invitationCode: "Hospital-Code-Aa01" }),
    },
    async (input, init = {}) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      assert.equal(url.pathname, "/api/v1/auth/invitations/validate");
      assert.equal(new Headers(init.headers).get("authorization"), null);
      upstreamBody = JSON.parse(init.body);
      return Response.json({
        organizationId: "11223344-5566-7788-99aa-bbccddeeff00",
        organizationName: "ERSync 테스트병원",
        role: "HOSPITAL_STAFF",
        expiresAt: "2099-08-05T03:09:00Z",
        requiredConsents: [],
      });
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(upstreamBody, { invitationCode: "Hospital-Code-Aa01" });
  assert.equal((await response.json()).role, "HOSPITAL_STAFF");
});

test("fails address search safely when server geocoding credentials are absent", async () => {
  const previousId = process.env.ERSYNC_NAVER_MAPS_CLIENT_ID;
  const previousSecret = process.env.ERSYNC_NAVER_MAPS_CLIENT_SECRET;
  delete process.env.ERSYNC_NAVER_MAPS_CLIENT_ID;
  delete process.env.ERSYNC_NAVER_MAPS_CLIENT_SECRET;

  try {
    const response = await requestApp("/api/geocode?query=서울대학교병원", {
      headers: { accept: "application/json" },
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "GEOCODING_NOT_CONFIGURED");
  } finally {
    if (previousId) process.env.ERSYNC_NAVER_MAPS_CLIENT_ID = previousId;
    if (previousSecret) process.env.ERSYNC_NAVER_MAPS_CLIENT_SECRET = previousSecret;
  }
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

  const clinicalUpdate = await requestApp(
    "/api/ersync/transport-requests/00112233-4455-6677-8899-aabbccddeeff/clinical-updates/vital-signs",
    {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: "{}",
    },
  );
  assert.equal(clinicalUpdate.status, 404);
  assert.equal((await clinicalUpdate.json()).code, "COMMON_404");

  const locationUpdate = await requestApp(
    "/api/ersync/transport-requests/00112233-4455-6677-8899-aabbccddeeff/location",
    {
      method: "PUT",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: "{}",
    },
  );
  assert.equal(locationUpdate.status, 404);
  assert.equal((await locationUpdate.json()).code, "COMMON_404");
});

test("exposes hospital offer and realtime routes behind authentication", async () => {
  const profile = await requestApp("/api/ersync/hospitals/me", {
    headers: { accept: "application/json" },
  });
  assert.equal(profile.status, 401);
  assert.equal((await profile.json()).code, "AUTH_001");

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

  const confirmHandoff = await requestApp(
    "/api/ersync/hospitals/me/offers/00112233-4455-6677-8899-aabbccddeeff/confirm-handoff",
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "Idempotency-Key": "hospital-confirm-handoff:test-key",
      },
    },
  );
  assert.equal(confirmHandoff.status, 401);
  assert.equal((await confirmHandoff.json()).code, "AUTH_001");

  for (const suffix of ["clinical-timeline?page=0&size=50", "location"]) {
    const protectedRead = await requestApp(
      `/api/ersync/hospitals/me/offers/00112233-4455-6677-8899-aabbccddeeff/${suffix}`,
      { headers: { accept: "application/json" } },
    );
    assert.equal(protectedRead.status, 401);
    assert.equal((await protectedRead.json()).code, "AUTH_001");
  }

  const realtime = await requestApp("/api/realtime/events", {
    headers: { accept: "text/event-stream" },
  });
  assert.equal(realtime.status, 401);
  assert.equal((await realtime.json()).code, "AUTH_001");
});

test("forwards the authenticated hospital profile read", async () => {
  const response = await requestApp(
    "/api/ersync/hospitals/me",
    {
      headers: { accept: "application/json", cookie: hospitalCookies() },
    },
    async (input, init = {}) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      assert.equal(url.pathname, "/api/v1/hospitals/me");
      assert.equal(init.method, "GET");
      assert.equal(
        new Headers(init.headers).get("Authorization"),
        "Bearer hospital-access",
      );
      return Response.json({
        accountId: "account-id",
        loginId: "testhospital",
        role: "HOSPITAL_STAFF",
        organizationId: "organization-id",
        organizationName: "테스트병원",
        hospitalId: "hospital-id",
        address: "테스트 주소",
        latitude: 37.5,
        longitude: 127.0,
        contact: "02-0000-0000",
        receivingStatus: "ON",
        updatedAt: "2026-08-05T05:00:00Z",
      });
    },
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).receivingStatus, "ON");
});

test("forwards the exact authenticated hospital self-profile update", async () => {
  const update = {
    address: "서울특별시 성북구 삼선교로 16길",
    detailAddress: null,
    latitude: 37.5821,
    longitude: 127.0105,
    contact: "02-1234-5678",
  };
  let upstreamBody = null;

  const response = await requestApp(
    "/api/ersync/hospitals/me",
    {
      method: "PUT",
      headers: {
        accept: "application/json",
        cookie: hospitalCookies(),
        "content-type": "application/json",
      },
      body: JSON.stringify(update),
    },
    async (input, init = {}) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      const headers = new Headers(init.headers);
      assert.equal(url.pathname, "/api/v1/hospitals/me");
      assert.equal(init.method, "PUT");
      assert.equal(headers.get("Authorization"), "Bearer hospital-access");
      assert.equal(headers.get("Idempotency-Key"), null);
      upstreamBody = JSON.parse(init.body);
      return Response.json({
        accountId: "account-id",
        loginId: "testhospital",
        role: "HOSPITAL_STAFF",
        organizationId: "organization-id",
        organizationName: "테스트병원",
        hospitalId: "hospital-id",
        ...update,
        receivingStatus: "ON",
        updatedAt: "2026-08-18T10:00:00Z",
      });
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(upstreamBody, update);
  const body = await response.json();
  assert.equal(body.receivingStatus, "ON");
  assert.equal(body.detailAddress, null);
});

test("clears hospital cookies when the profile relationship is invalid", async () => {
  const response = await requestApp(
    "/api/ersync/hospitals/me",
    {
      method: "PUT",
      headers: {
        accept: "application/json",
        cookie: hospitalCookies(),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        address: "테스트 주소",
        detailAddress: null,
        latitude: 37.5,
        longitude: 127,
        contact: "02-0000-0000",
      }),
    },
    async () =>
      Response.json(
        {
          code: "COMMON_004",
          message: "계정과 병원 정보가 일치하지 않습니다.",
          fieldErrors: [],
          traceId: "profile-trace",
        },
        { status: 403 },
      ),
  );

  assert.equal(response.status, 403);
  assert.match(response.headers.get("set-cookie") ?? "", /ersync_hospital_access=;/);
});

test("forwards authenticated 06 clinical timeline and current-destination location reads", async () => {
  const offerId = "00112233-4455-6677-8899-aabbccddeeff";
  const requested = [];
  const upstreamFetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const headers = new Headers(init.headers);
    assert.equal(headers.get("Authorization"), "Bearer hospital-access");
    assert.equal(headers.get("Idempotency-Key"), null);
    assert.equal(init.method, "GET");
    requested.push(`${url.pathname}${url.search}`);

    if (url.pathname.endsWith("/clinical-timeline")) {
      return Response.json({
        transportRequestId: "request-id",
        latestSnapshot: {},
        items: [],
        page: 1,
        size: 50,
        totalElements: 0,
        totalPages: 0,
        serverNow: "2026-08-04T10:14:00Z",
      });
    }
    return Response.json({
      transportRequestId: "request-id",
      latitude: null,
      longitude: null,
      freshness: "NOT_RECEIVED",
      ageSeconds: null,
      serverNow: "2026-08-04T10:15:09Z",
    });
  };

  const timeline = await requestApp(
    `/api/ersync/hospitals/me/offers/${offerId}/clinical-timeline?page=1&size=50`,
    {
      headers: {
        accept: "application/json",
        cookie: hospitalCookies(),
      },
    },
    upstreamFetch,
  );
  assert.equal(timeline.status, 200);
  assert.equal((await timeline.json()).page, 1);

  const location = await requestApp(
    `/api/ersync/hospitals/me/offers/${offerId}/location`,
    {
      headers: {
        accept: "application/json",
        cookie: hospitalCookies(),
      },
    },
    upstreamFetch,
  );
  assert.equal(location.status, 200);
  assert.equal((await location.json()).freshness, "NOT_RECEIVED");
  assert.deepEqual(requested, [
    `/api/v1/hospitals/me/offers/${offerId}/clinical-timeline?page=1&size=50`,
    `/api/v1/hospitals/me/offers/${offerId}/location`,
  ]);
});

test("passes through TRANSPORT_005 when 06 hospital read permission ends", async () => {
  const offerId = "00112233-4455-6677-8899-aabbccddeeff";
  const response = await requestApp(
    `/api/ersync/hospitals/me/offers/${offerId}/location`,
    {
      headers: {
        accept: "application/json",
        cookie: hospitalCookies(),
      },
    },
    async () =>
      Response.json(
        {
          code: "TRANSPORT_005",
          message: "조회할 수 없는 제안입니다.",
          fieldErrors: [],
          traceId: "trace-06",
        },
        { status: 404 },
      ),
  );

  assert.equal(response.status, 404);
  assert.equal((await response.json()).code, "TRANSPORT_005");
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

test("forwards handoff confirmation with the exact idempotency key and no body", async () => {
  const offerId = "00112233-4455-6677-8899-aabbccddeeff";
  const key = "hospital-confirm-handoff:test-key";
  const response = await requestApp(
    `/api/ersync/hospitals/me/offers/${offerId}/confirm-handoff`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        cookie: hospitalCookies(),
        "Idempotency-Key": key,
      },
    },
    async (input, init = {}) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      assert.equal(
        url.pathname,
        `/api/v1/hospitals/me/offers/${offerId}/confirm-handoff`,
      );
      const headers = new Headers(init.headers);
      assert.equal(headers.get("Authorization"), "Bearer hospital-access");
      assert.equal(headers.get("Idempotency-Key"), key);
      assert.equal(init.method, "POST");
      assert.ok(init.body == null || init.body === "");
      return Response.json({
        offerId,
        transportRequestId: "request-id",
        status: "COMPLETED",
        completedAt: "2026-08-05T05:10:00Z",
        idempotentReplay: false,
      });
    },
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "COMPLETED");
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
