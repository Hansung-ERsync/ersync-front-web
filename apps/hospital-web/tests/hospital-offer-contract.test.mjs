import assert from "node:assert/strict";
import test from "node:test";

import {
  IDEMPOTENCY_KEY_PATTERN,
  canOpenFullHospitalOffer,
  canReadClinicalTimeline,
  canReadHospitalLocation,
  canRespondToHospitalOffer,
  clearOfferCommand,
  createOfferIdempotencyKey,
  createWithdrawalPayload,
  getDestinationChangeNotice,
  getActiveHospitalOfferContext,
  getOrCreateOfferCommand,
  getHospitalOfferQueueCounts,
  getHospitalOfferQueueTarget,
  getHospitalOutcomePresentation,
  getHospitalWithdrawalMode,
  getTransportRequestStatusLabel,
  isActiveHospitalOfferStatus,
  isClinicalRealtimeType,
  isDestinationRealtimeType,
  isMinimalHospitalOffer,
  isNonDestinationActiveHospitalOffer,
  isRejectedHospitalOfferHistory,
  isTransportLifecycleRealtimeType,
  shouldRefreshBothOfferLists,
  shouldRecoverHospitalOfferRead,
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

test("blocks protected reads for rejected and every closed hospital offer", () => {
  assert.equal(isMinimalHospitalOffer("HISTORY", "ACCEPTED"), true);
  assert.equal(isMinimalHospitalOffer("HISTORY", "ACCEPTANCE_WITHDRAWN"), true);
  assert.equal(isMinimalHospitalOffer("ACTIVE", "ACCEPTANCE_WITHDRAWN"), true);
  assert.equal(isMinimalHospitalOffer("ACTIVE", "ACCEPTED"), false);
  assert.equal(isMinimalHospitalOffer("HISTORY", "REJECTED"), true);
  assert.equal(isMinimalHospitalOffer("ACTIVE", "REJECTED"), true);
  assert.equal(isMinimalHospitalOffer("HISTORY", "UNKNOWN_CLOSED"), true);
  assert.equal(
    isMinimalHospitalOffer("HISTORY", "REJECTED", "CANCELLED"),
    true,
  );
  assert.equal(
    isMinimalHospitalOffer("HISTORY", "ACCEPTED", "COMPLETED"),
    true,
  );
});

test("identifies only rejected HISTORY cards for the 18 minimal presentation", () => {
  assert.equal(isRejectedHospitalOfferHistory("HISTORY", "REJECTED"), true);
  assert.equal(isRejectedHospitalOfferHistory("ACTIVE", "REJECTED"), false);
  assert.equal(isRejectedHospitalOfferHistory("HISTORY", "UNKNOWN_CLOSED"), false);
  assert.equal(isRejectedHospitalOfferHistory("HISTORY", "ACCEPTED"), false);
});

test("only exposes 06 timeline and exact location to contract-authorized offers", () => {
  assert.equal(canReadClinicalTimeline("ACTIVE", "PENDING"), true);
  assert.equal(canReadClinicalTimeline("ACTIVE", "ACCEPTED"), true);
  assert.equal(canReadClinicalTimeline("HISTORY", "ACCEPTED"), false);
  assert.equal(canReadClinicalTimeline("HISTORY", "REJECTED"), false);
  assert.equal(canReadClinicalTimeline("HISTORY", "ACCEPTANCE_WITHDRAWN"), false);

  assert.equal(canReadHospitalLocation("ACCEPTED", true), true);
  assert.equal(canReadHospitalLocation("ACCEPTED", false), false);
  assert.equal(canReadHospitalLocation("PENDING", false), false);
  assert.equal(canReadHospitalLocation("ACCEPTANCE_WITHDRAWN", false), false);
  assert.equal(canReadClinicalTimeline("HISTORY", "REJECTED", "CANCELLED"), false);
  assert.equal(canReadHospitalLocation("ACCEPTED", true, "COMPLETED"), false);
});

test("keeps full detail available for active pending and accepted offers", () => {
  assert.equal(canOpenFullHospitalOffer("PENDING", false), true);
  assert.equal(canOpenFullHospitalOffer("ACCEPTED", false), true);
  assert.equal(canOpenFullHospitalOffer("ACCEPTED", true), true);
  assert.equal(canOpenFullHospitalOffer("REJECTED", false), false);
  assert.equal(canOpenFullHospitalOffer("ACCEPTED", true, "COMPLETED"), false);
  assert.equal(canOpenFullHospitalOffer("ACCEPTED", true, "CANCELLED"), false);
});

test("allows pending decisions only before handoff is requested", () => {
  assert.equal(canRespondToHospitalOffer("PENDING", "SEARCHING"), true);
  assert.equal(canRespondToHospitalOffer("PENDING", "EN_ROUTE"), true);
  assert.equal(canRespondToHospitalOffer("PENDING", "HANDOFF_REQUESTED"), false);
  assert.equal(canRespondToHospitalOffer("PENDING", "COMPLETED"), false);
  assert.equal(canRespondToHospitalOffer("ACCEPTED", "EN_ROUTE"), false);
});

test("uses emergency withdrawal only for the current destination in transit", () => {
  assert.equal(
    getHospitalWithdrawalMode(true, true, "EN_ROUTE"),
    "EMERGENCY",
  );
  assert.equal(
    getHospitalWithdrawalMode(true, false, "EN_ROUTE"),
    "STANDARD",
  );
  assert.equal(
    getHospitalWithdrawalMode(true, true, "HANDOFF_REQUESTED"),
    null,
  );
  assert.equal(getHospitalWithdrawalMode(true, true, "COMPLETED"), null);
  assert.equal(getHospitalWithdrawalMode(false, false, "SEARCHING"), null);
});

test("announces destination changes to both the previous and new destination", () => {
  assert.deepEqual(
    getDestinationChangeNotice(
      [{ offerId: "offer-a", currentDestination: true }],
      [{ offerId: "offer-a", currentDestination: false }],
    ),
    {
      tone: "warning",
      message:
        "목적지가 다른 병원으로 변경되었습니다. 기존 수락은 유지되며 다시 선택될 수 있습니다.",
    },
  );
  assert.deepEqual(
    getDestinationChangeNotice(
      [{ offerId: "offer-b", currentDestination: false }],
      [{ offerId: "offer-b", currentDestination: true }],
    ),
    {
      tone: "success",
      message: "우리 병원이 새로운 목적지로 선택되었습니다.",
    },
  );
});

test("keeps only pending and accepted offers in the new ACTIVE flow", () => {
  assert.equal(isActiveHospitalOfferStatus("PENDING"), true);
  assert.equal(isActiveHospitalOfferStatus("ACCEPTED"), true);
  assert.equal(isActiveHospitalOfferStatus("REJECTED"), false);
  assert.equal(isActiveHospitalOfferStatus("ACCEPTANCE_WITHDRAWN"), false);
  assert.equal(isActiveHospitalOfferStatus(null), false);
});

test("presents every active destination state from the 15 contract", () => {
  assert.deepEqual(
    getActiveHospitalOfferContext("PENDING", false, "EN_ROUTE"),
    {
      label: "다른 병원으로 이동 중 · 응답 가능",
      description:
        "다른 병원으로 이동 중이지만 인계 요청 전까지 수락하거나 거절할 수 있습니다.",
      tone: "pending",
    },
  );
  assert.deepEqual(
    getActiveHospitalOfferContext("ACCEPTED", false, "EN_ROUTE"),
    {
      label: "수락 완료 · 다른 병원으로 이동 중",
      description:
        "수락 상태는 유지되며 인계 요청 전까지 수락을 철회할 수 있습니다.",
      tone: "accepted",
    },
  );
  assert.equal(
    getActiveHospitalOfferContext("ACCEPTED", true, "EN_ROUTE")?.label,
    "우리 병원으로 이동 중",
  );
  assert.equal(
    getActiveHospitalOfferContext("ACCEPTED", true, "HANDOFF_REQUESTED")
      ?.label,
    "인계 확인 대기",
  );
  assert.equal(
    getActiveHospitalOfferContext("PENDING", false, "HANDOFF_REQUESTED")
      ?.label,
    "다른 병원 인계 진행 중",
  );
  assert.equal(
    getActiveHospitalOfferContext("PENDING", false, "SEARCHING"),
    null,
  );
  assert.equal(
    getActiveHospitalOfferContext("REJECTED", false, "HANDOFF_REQUESTED"),
    null,
  );
});

test("freezes clinical presentation and hides dynamic route for non-destinations", () => {
  assert.equal(
    isNonDestinationActiveHospitalOffer("PENDING", false, "EN_ROUTE"),
    true,
  );
  assert.equal(
    isNonDestinationActiveHospitalOffer("ACCEPTED", false, "HANDOFF_REQUESTED"),
    true,
  );
  assert.equal(
    isNonDestinationActiveHospitalOffer("ACCEPTED", true, "EN_ROUTE"),
    false,
  );
  assert.equal(
    isNonDestinationActiveHospitalOffer("REJECTED", false, "EN_ROUTE"),
    false,
  );
  assert.equal(canReadClinicalTimeline("ACTIVE", "PENDING", "EN_ROUTE"), true);
  assert.equal(canReadClinicalTimeline("ACTIVE", "ACCEPTED", "EN_ROUTE"), true);
  assert.equal(canReadHospitalLocation("PENDING", false, "EN_ROUTE"), false);
  assert.equal(canReadHospitalLocation("ACCEPTED", false, "EN_ROUTE"), false);
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
      "ACCEPTED_AVAILABLE",
      "EN_ROUTE",
      "HANDOFF_REQUESTED",
      "COMPLETED",
      "CANCELLED",
    ].map(getTransportRequestStatusLabel),
    [
      "수용 병원 탐색 중",
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

  const reRequestedPending = sortHospitalOffersNewestFirst(
    [
      {
        offerId: "new-offer",
        offeredAt: "2026-08-09T10:00:02+09:00",
        lastRequestedAt: "2026-08-09T10:00:02+09:00",
      },
      {
        offerId: "re-requested",
        offeredAt: "2026-08-09T09:00:00+09:00",
        lastRequestedAt: "2026-08-09T10:00:03+09:00",
      },
    ],
    "ACTIVE",
    "PENDING",
  );
  assert.deepEqual(reRequestedPending.map((offer) => offer.offerId), [
    "re-requested",
    "new-offer",
  ]);

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
    { offerStatus: "REJECTED" },
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

test("maps current realtime signals to authoritative REST refreshes", () => {
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
  assert.equal(shouldRefreshBothOfferLists("UNKNOWN_EVENT"), false);

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
    shouldRefreshSelectedOffer(
      "TRANSPORT_REQUEST_RECEIVED",
      "offer-1",
      "offer-1",
    ),
    true,
  );
  assert.equal(
    shouldRefreshSelectedOffer(
      "TRANSPORT_REQUEST_RECEIVED",
      "offer-2",
      "offer-1",
    ),
    false,
  );
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

test("recovers offer reads without inferring another organization's data", () => {
  assert.equal(shouldRecoverHospitalOfferRead("HOSPITAL_001"), true);
  assert.equal(shouldRecoverHospitalOfferRead("TRANSPORT_005"), true);
  assert.equal(shouldRecoverHospitalOfferRead("AUTH_003"), false);
  assert.equal(shouldRecoverHospitalOfferRead("COMMON_001"), false);
});
