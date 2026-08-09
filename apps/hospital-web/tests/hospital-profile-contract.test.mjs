import assert from "node:assert/strict";
import test from "node:test";

import {
  getRealtimeConnectionPresentation,
  shouldReloadProfileAfterReceivingStatusError,
} from "../app/lib/hospital-profile-contract.js";

test("reloads the hospital profile after ambiguous receiving-status failures", () => {
  assert.equal(shouldReloadProfileAfterReceivingStatusError(undefined), true);
  assert.equal(shouldReloadProfileAfterReceivingStatusError(null), true);
  assert.equal(shouldReloadProfileAfterReceivingStatusError(500), true);
  assert.equal(shouldReloadProfileAfterReceivingStatusError(503), true);
});

test("keeps the current profile after deterministic client errors", () => {
  assert.equal(shouldReloadProfileAfterReceivingStatusError(400), false);
  assert.equal(shouldReloadProfileAfterReceivingStatusError(401), false);
  assert.equal(shouldReloadProfileAfterReceivingStatusError(403), false);
  assert.equal(shouldReloadProfileAfterReceivingStatusError(409), false);
});

test("distinguishes new-request receiving from the existing-request stream", () => {
  assert.deepEqual(getRealtimeConnectionPresentation("ON", "CONNECTED"), {
    label: "실시간 연결",
    tone: "connected",
  });
  assert.deepEqual(getRealtimeConnectionPresentation("OFF", "CONNECTED"), {
    label: "요청 수신 OFF",
    tone: "paused",
  });
  assert.deepEqual(getRealtimeConnectionPresentation("OFF", "RECONNECTING"), {
    label: "재연결 중",
    tone: "reconnecting",
  });
});
