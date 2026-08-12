import assert from "node:assert/strict";
import test from "node:test";

import {
  IDEMPOTENCY_KEY_PATTERN,
  canOpenFullHospitalOffer,
  canReadClinicalTimeline,
  canReadHospitalLocation,
  clearOfferCommand,
  createOfferIdempotencyKey,
  createWithdrawalPayload,
  getOrCreateOfferCommand,
  getHospitalOfferQueueCounts,
  getHospitalOfferQueueTarget,
  getHospitalOutcomePresentation,
  getTransportRequestStatusLabel,
  isClinicalRealtimeType,
  isDestinationRealtimeType,
  isMinimalHospitalOffer,
  isTransportLifecycleRealtimeType,
  shouldRefreshBothOfferLists,
  shouldRefreshSelectedLocation,
  shouldRefreshSelectedOffer,
  shouldRefreshSelectedTimeline,
  sortHospitalOffersNewestFirst,
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

test("reuses the same handoff confirmation key after a lost response", () => {
  const storage = new MemoryStorage();
  const first = getOrCreateOfferCommand(
    storage,
    "offer-handoff",
    "confirm-handoff",
    null,
  );
  const retry = getOrCreateOfferCommand(
    storage,
    "offer-handoff",
    "confirm-handoff",
    null,
  );

  assert.equal(retry.idempotencyKey, first.idempotencyKey);
  assert.match(first.idempotencyKey, IDEMPOTENCY_KEY_PATTERN);
});

test("blocks clinical detail for hidden accepted and withdrawn history", () => {
  assert.equal(isMinimalHospitalOffer("HISTORY", "ACCEPTED"), true);
  assert.equal(isMinimalHospitalOffer("HISTORY", "ACCEPTANCE_WITHDRAWN"), true);
  assert.equal(isMinimalHospitalOffer("ACTIVE", "ACCEPTANCE_WITHDRAWN"), true);
  assert.equal(isMinimalHospitalOffer("ACTIVE", "ACCEPTED"), false);
  assert.equal(isMinimalHospitalOffer("HISTORY", "REJECTED"), false);
  assert.equal(
    isMinimalHospitalOffer("HISTORY", "REJECTED", "CANCELLED"),
    true,
  );
  assert.equal(
    isMinimalHospitalOffer("HISTORY", "ACCEPTED", "COMPLETED"),
    true,
  );
});

test("only exposes 06 timeline and exact location to contract-authorized offers", () => {
  assert.equal(canReadClinicalTimeline("ACTIVE", "PENDING"), true);
  assert.equal(canReadClinicalTimeline("ACTIVE", "ACCEPTED"), true);
  assert.equal(canReadClinicalTimeline("HISTORY", "ACCEPTED"), false);
  assert.equal(canReadClinicalTimeline("HISTORY", "REJECTED"), false);
  assert.equal(canReadClinicalTimeline("HISTORY", "NO_RESPONSE"), false);
  assert.equal(canReadClinicalTimeline("HISTORY", "ACCEPTANCE_WITHDRAWN"), false);

  assert.equal(canReadHospitalLocation("ACCEPTED", true), true);
  assert.equal(canReadHospitalLocation("ACCEPTED", false), false);
  assert.equal(canReadHospitalLocation("PENDING", false), false);
  assert.equal(canReadHospitalLocation("ACCEPTANCE_WITHDRAWN", false), false);
  assert.equal(canReadClinicalTimeline("HISTORY", "REJECTED", "CANCELLED"), false);
  assert.equal(canReadHospitalLocation("ACCEPTED", true, "COMPLETED"), false);
});

test("only opens the full patient view after this hospital becomes the destination", () => {
  assert.equal(canOpenFullHospitalOffer("PENDING", false), false);
  assert.equal(canOpenFullHospitalOffer("ACCEPTED", false), false);
  assert.equal(canOpenFullHospitalOffer("ACCEPTED", true), true);
  assert.equal(canOpenFullHospitalOffer("ACCEPTED", true, "COMPLETED"), false);
  assert.equal(canOpenFullHospitalOffer("ACCEPTED", true, "CANCELLED"), false);
});

test("clearly identifies a request that was assigned to another hospital", () => {
  const presentation = getHospitalOutcomePresentation("NOT_SELECTED", "ACCEPTED");

  assert.equal(presentation.label, "타 병원 이송 결정");
  assert.equal(presentation.title, "타 병원으로 이송 결정");
  assert.match(presentation.description, /다른 병원으로 이송이 결정/);
  assert.equal(
    getHospitalOutcomePresentation("FUTURE_OUTCOME").label,
    "확인 필요",
  );
});

test("translates every transport status without exposing backend enum codes", () => {
  assert.deepEqual(
    [
      "SEARCHING",
      "CANDIDATES_EXHAUSTED",
      "ACCEPTED_AVAILABLE",
      "EN_ROUTE",
      "HANDOFF_REQUESTED",
      "COMPLETED",
      "CANCELLED",
    ].map(getTransportRequestStatusLabel),
    [
      "수용 병원 탐색 중",
      "수용 가능 병원 없음",
      "목적지 선택 대기",
      "이송 중",
      "인계 확인 대기",
      "인계 완료",
      "이송 취소",
    ],
  );
  assert.equal(getTransportRequestStatusLabel("FUTURE_STATUS"), "확인 필요");
});

test("sorts every queue newest first using its authoritative activity time", () => {
  const pending = sortHospitalOffersNewestFirst(
    [
      { offerId: "old", offeredAt: "2026-08-09T10:00:00+09:00" },
      { offerId: "new", offeredAt: "2026-08-09T10:00:02+09:00" },
    ],
    "ACTIVE",
    "PENDING",
  );
  assert.deepEqual(pending.map((offer) => offer.offerId), ["new", "old"]);

  const accepted = sortHospitalOffersNewestFirst(
    [
      { offerId: "old", respondedAt: "2026-08-09T10:00:01+09:00" },
      { offerId: "new", respondedAt: "2026-08-09T10:00:03+09:00" },
    ],
    "ACTIVE",
    "ACCEPTED",
  );
  assert.deepEqual(accepted.map((offer) => offer.offerId), ["new", "old"]);

  const history = sortHospitalOffersNewestFirst(
    [
      { offerId: "old", processedAt: "2026-08-09T10:00:04+09:00" },
      {
        offerId: "new",
        processedAt: "2026-08-09T10:00:05+09:00",
        respondedAt: "2026-08-09T09:00:00+09:00",
      },
    ],
    "HISTORY",
    "PENDING",
  );
  assert.deepEqual(history.map((offer) => offer.offerId), ["new", "old"]);
});

test("keeps pending, accepted, and history counts independent of the selected tab", () => {
  const activeOffers = [
    { offerStatus: "PENDING" },
    { offerStatus: "PENDING" },
    { offerStatus: "ACCEPTED" },
  ];

  assert.deepEqual(getHospitalOfferQueueCounts(activeOffers, 4), {
    pending: 2,
    accepted: 1,
    history: 4,
  });
  assert.deepEqual(getHospitalOfferQueueCounts([], 0), {
    pending: 0,
    accepted: 0,
    history: 0,
  });
});

test("moves the visible queue with the selected patient's lifecycle", () => {
  assert.deepEqual(getHospitalOfferQueueTarget("ACTIVE", "PENDING"), {
    view: "ACTIVE",
    activeFilter: "PENDING",
  });
  assert.deepEqual(getHospitalOfferQueueTarget("ACTIVE", "ACCEPTED"), {
    view: "ACTIVE",
    activeFilter: "ACCEPTED",
  });
  assert.deepEqual(getHospitalOfferQueueTarget("HISTORY", "ACCEPTED"), {
    view: "HISTORY",
    activeFilter: null,
  });
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

test("maps every 04 through 08 realtime signal to authoritative REST refreshes", () => {
  for (const type of [
    "TRANSPORT_REQUEST_RECEIVED",
    "ETA_UPDATED",
    "DESTINATION_SELECTED",
    "DESTINATION_CHANGED",
    "HOSPITAL_ACCEPTANCE_WITHDRAWN",
    "VITAL_SIGNS_ADDED",
    "CONSCIOUSNESS_CHANGED",
    "PRE_KTAS_CHANGED",
    "TREATMENT_ADDED",
    "TRANSPORT_CANCELLED",
    "HANDOFF_REQUESTED",
    "HANDOFF_COMPLETED",
  ]) {
    assert.equal(shouldRefreshBothOfferLists(type), true);
  }
  assert.equal(shouldRefreshBothOfferLists("connected"), false);
  assert.equal(shouldRefreshBothOfferLists("heartbeat"), false);
  assert.equal(shouldRefreshBothOfferLists("AMBULANCE_LOCATION_UPDATED"), false);

  for (const type of [
    "TRANSPORT_CANCELLED",
    "HANDOFF_REQUESTED",
    "HANDOFF_COMPLETED",
  ]) {
    assert.equal(isTransportLifecycleRealtimeType(type), true);
  }
  assert.equal(isTransportLifecycleRealtimeType("ETA_UPDATED"), false);

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

  for (const type of [
    "VITAL_SIGNS_ADDED",
    "CONSCIOUSNESS_CHANGED",
    "PRE_KTAS_CHANGED",
    "TREATMENT_ADDED",
  ]) {
    assert.equal(isClinicalRealtimeType(type), true);
    assert.equal(
      shouldRefreshSelectedOffer(type, "request-1", "offer-1", "request-1"),
      true,
    );
    assert.equal(
      shouldRefreshSelectedTimeline(type, "request-1", "request-1"),
      true,
    );
    assert.equal(
      shouldRefreshSelectedTimeline(type, "request-2", "request-1"),
      false,
    );
  }

  assert.equal(isDestinationRealtimeType("DESTINATION_CHANGED"), true);
  assert.equal(isDestinationRealtimeType("VITAL_SIGNS_ADDED"), false);
  assert.equal(
    shouldRefreshSelectedLocation(
      "AMBULANCE_LOCATION_UPDATED",
      "request-1",
      "offer-1",
      "request-1",
    ),
    true,
  );
  assert.equal(
    shouldRefreshSelectedLocation(
      "AMBULANCE_LOCATION_UPDATED",
      "request-2",
      "offer-1",
      "request-1",
    ),
    false,
  );
  assert.equal(
    shouldRefreshSelectedLocation("ETA_UPDATED", "offer-1", "offer-1", "request-1"),
    true,
  );
});
