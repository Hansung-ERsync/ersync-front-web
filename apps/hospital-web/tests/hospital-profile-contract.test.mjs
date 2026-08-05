import assert from "node:assert/strict";
import test from "node:test";

import { shouldReloadProfileAfterReceivingStatusError } from "../app/lib/hospital-profile-contract.js";

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
