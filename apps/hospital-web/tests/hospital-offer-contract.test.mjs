import assert from "node:assert/strict";
import test from "node:test";

import {
  IDEMPOTENCY_KEY_PATTERN,
  clearOfferCommand,
  createOfferIdempotencyKey,
  getOrCreateOfferCommand,
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
