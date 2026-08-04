import assert from "node:assert/strict";
import test from "node:test";

import {
  IDEMPOTENCY_KEY_PATTERN,
  clearOfferCommand,
  createOfferIdempotencyKey,
  createWithdrawalPayload,
  getOrCreateOfferCommand,
  isMinimalHospitalOffer,
  shouldRefreshBothOfferLists,
  shouldRefreshSelectedOffer,
} from "../app/lib/hospital-offer-contract.js";

class MemoryStorage {
  #values = new Map();

  getItem(key) {
    return this.#values.get(key) ?? null;
  }

  setItem(key, value) {
    this.#values.set(key, String(value));
  }

  removeItem(key) {
    this.#values.delete(key);
  }
}

test("creates an idempotency key that exactly matches the 04 contract", () => {
  const acceptKey = createOfferIdempotencyKey("accept");
  const rejectKey = createOfferIdempotencyKey("reject");

  assert.match(acceptKey, IDEMPOTENCY_KEY_PATTERN);
  assert.match(rejectKey, IDEMPOTENCY_KEY_PATTERN);
  assert.ok(acceptKey.length >= 8 && acceptKey.length <= 100);
  assert.notEqual(acceptKey, rejectKey);
});

test("reuses the same key for an unchanged retry command", () => {
  const storage = new MemoryStorage();
  const first = getOrCreateOfferCommand(storage, "offer-1", "accept", null);
  const retry = getOrCreateOfferCommand(storage, "offer-1", "accept", null);

  assert.equal(retry.idempotencyKey, first.idempotencyKey);
});

test("creates a new key when a rejection command changes", () => {
  const storage = new MemoryStorage();
  const first = getOrCreateOfferCommand(storage, "offer-2", "reject", {
    reason: "OTHER",
    detail: "첫 사유",
  });
  const changed = getOrCreateOfferCommand(storage, "offer-2", "reject", {
    reason: "OTHER",
    detail: "수정된 사유",
  });

  assert.notEqual(changed.idempotencyKey, first.idempotencyKey);
});

test("only clears the command that produced the matching response", () => {
  const storage = new MemoryStorage();
  const command = getOrCreateOfferCommand(storage, "offer-3", "accept", null);

  clearOfferCommand(storage, "offer-3", "different-key");
  assert.equal(
    getOrCreateOfferCommand(storage, "offer-3", "accept", null).idempotencyKey,
    command.idempotencyKey,
  );

  clearOfferCommand(storage, "offer-3", command.idempotencyKey);
  assert.notEqual(
    getOrCreateOfferCommand(storage, "offer-3", "accept", null).idempotencyKey,
    command.idempotencyKey,
  );
});

test("reuses a withdrawal key only while the withdrawal command is unchanged", () => {
  const storage = new MemoryStorage();
  const first = getOrCreateOfferCommand(storage, "offer-4", "withdraw", {
    reason: "OTHER",
    detail: "병상 운영 변경",
  });
  const retry = getOrCreateOfferCommand(storage, "offer-4", "withdraw", {
    reason: "OTHER",
    detail: "병상 운영 변경",
  });
  const changed = getOrCreateOfferCommand(storage, "offer-4", "withdraw", {
    reason: "BED_SHORTAGE",
    detail: null,
  });

  assert.equal(retry.idempotencyKey, first.idempotencyKey);
  assert.notEqual(changed.idempotencyKey, first.idempotencyKey);
});

test("blocks clinical detail for hidden accepted and withdrawn history", () => {
  assert.equal(isMinimalHospitalOffer("HISTORY", "ACCEPTED"), true);
  assert.equal(isMinimalHospitalOffer("HISTORY", "ACCEPTANCE_WITHDRAWN"), true);
  assert.equal(isMinimalHospitalOffer("ACTIVE", "ACCEPTANCE_WITHDRAWN"), true);
  assert.equal(isMinimalHospitalOffer("ACTIVE", "ACCEPTED"), false);
  assert.equal(isMinimalHospitalOffer("HISTORY", "REJECTED"), false);
});

test("normalizes every withdrawal reason and validates OTHER detail", () => {
  for (const reason of [
    "BED_SHORTAGE",
    "OPERATING_ROOM_SHORTAGE",
    "SPECIALIST_UNAVAILABLE",
    "EQUIPMENT_UNAVAILABLE",
  ]) {
    assert.deepEqual(createWithdrawalPayload(reason, "ignored"), {
      reason,
      detail: null,
    });
  }
  assert.deepEqual(createWithdrawalPayload("OTHER", "  운영 사유  "), {
    reason: "OTHER",
    detail: "운영 사유",
  });
  assert.throws(() => createWithdrawalPayload("OTHER", "   "), /상세 사유/);
  assert.throws(() => createWithdrawalPayload("OTHER", "가".repeat(201)), /200자/);
  assert.throws(() => createWithdrawalPayload("INVALID", null), /사유를 선택/);
});

test("maps every 04 and 05 realtime signal to authoritative REST refreshes", () => {
  for (const type of [
    "TRANSPORT_REQUEST_RECEIVED",
    "ETA_UPDATED",
    "DESTINATION_SELECTED",
    "DESTINATION_CHANGED",
    "HOSPITAL_ACCEPTANCE_WITHDRAWN",
  ]) {
    assert.equal(shouldRefreshBothOfferLists(type), true);
  }
  assert.equal(shouldRefreshBothOfferLists("connected"), false);
  assert.equal(shouldRefreshBothOfferLists("heartbeat"), false);

  assert.equal(shouldRefreshSelectedOffer("ETA_UPDATED", "offer-1", "offer-1"), true);
  assert.equal(shouldRefreshSelectedOffer("ETA_UPDATED", "offer-2", "offer-1"), false);
  assert.equal(
    shouldRefreshSelectedOffer("DESTINATION_SELECTED", "command-id", "offer-1"),
    true,
  );
  assert.equal(
    shouldRefreshSelectedOffer("HOSPITAL_ACCEPTANCE_WITHDRAWN", "offer-1", null),
    false,
  );
});
