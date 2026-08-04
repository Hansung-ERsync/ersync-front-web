import assert from "node:assert/strict";
import test from "node:test";

import { hospitalBackendHeaders } from "../app/api/_lib/request-headers.js";

test("forwards authorization and the decision idempotency key", () => {
  const incoming = new Headers({
    "Idempotency-Key": "hospital-accept:test-key",
    Cookie: "private=value",
    "X-Untrusted": "do-not-forward",
  });

  const headers = hospitalBackendHeaders(incoming, "access-token");

  assert.equal(headers.get("Authorization"), "Bearer access-token");
  assert.equal(headers.get("Idempotency-Key"), "hospital-accept:test-key");
  assert.equal(headers.get("Cookie"), null);
  assert.equal(headers.get("X-Untrusted"), null);
});

test("does not invent optional headers", () => {
  const headers = hospitalBackendHeaders(new Headers(), undefined);

  assert.equal([...headers.entries()].length, 0);
});
