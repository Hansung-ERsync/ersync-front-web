// @ts-check

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,100}$/;
export const WITHDRAWAL_REASONS = [
  "BED_SHORTAGE",
  "OPERATING_ROOM_SHORTAGE",
  "SPECIALIST_UNAVAILABLE",
  "EQUIPMENT_UNAVAILABLE",
  "OTHER",
];

const TERMINAL_TRANSPORT_STATUSES = new Set(["COMPLETED", "CANCELLED"]);

const TRANSPORT_REQUEST_STATUS_LABELS = Object.freeze({
  SEARCHING: "수용 병원 탐색 중",
  CANDIDATES_EXHAUSTED: "수용 가능 병원 없음",
  ACCEPTED_AVAILABLE: "목적지 선택 대기",
  EN_ROUTE: "이송 중",
  HANDOFF_REQUESTED: "인계 확인 대기",
  COMPLETED: "인계 완료",
  CANCELLED: "이송 취소",
});

/**
 * @param {string | null | undefined} status
 */
export function getTransportRequestStatusLabel(status) {
  if (!status) return "-";
  return TRANSPORT_REQUEST_STATUS_LABELS[status] || "확인 필요";
}

const HOSPITAL_OUTCOME_PRESENTATIONS = Object.freeze({
  AWAITING_RESPONSE: {
    label: "응답 대기",
    title: "응답 대기",
    description: "수용 가능 여부를 확인해 주세요.",
    tone: "pending",
  },
  ACCEPTED: {
    label: "수락",
    title: "수용 가능 응답",
    description: "구급대원의 병원 선택을 기다리는 중입니다.",
    tone: "accepted",
  },
  REJECTED: {
    label: "거절",
    title: "수용 거절",
    description: "수용 어려움으로 응답했습니다.",
    tone: "rejected",
  },
  NO_RESPONSE: {
    label: "무응답",
    title: "무응답 종료",
    description: "응답 없이 종료되었습니다.",
    tone: "no_response",
  },
  ACCEPTANCE_WITHDRAWN: {
    label: "수락 철회",
    title: "수락 철회",
    description: "수용 가능 응답을 철회했습니다.",
    tone: "acceptance_withdrawn",
  },
  NOT_SELECTED: {
    label: "타 병원 이송 결정",
    title: "타 병원으로 이송 결정",
    description: "다른 병원으로 이송이 결정되었습니다.",
    tone: "not_selected",
  },
  HANDOFF_COMPLETED_HERE: {
    label: "본원 인계 완료",
    title: "본원 인계 완료",
    description: "환자 인계가 완료되었습니다.",
    tone: "handoff_completed_here",
  },
  COMPLETED_ELSEWHERE: {
    label: "타 병원 이송 완료",
    title: "타 병원 이송 완료",
    description: "다른 병원에서 이송이 완료되었습니다.",
    tone: "completed_elsewhere",
  },
  TRANSPORT_CANCELLED: {
    label: "이송 취소",
    title: "이송 취소",
    description: "이송 요청이 취소되었습니다.",
    tone: "transport_cancelled",
  },
});

const OFFER_STATUS_OUTCOME_FALLBACK = Object.freeze({
  PENDING: "AWAITING_RESPONSE",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  NO_RESPONSE: "NO_RESPONSE",
  ACCEPTANCE_WITHDRAWN: "ACCEPTANCE_WITHDRAWN",
});

/**
 * 병원별 최종 결과를 카드와 상세 화면에서 일관되게 표시합니다.
 * 구버전 응답에는 hospitalOutcome이 없을 수 있어 offerStatus를 안전한 대체값으로 사용합니다.
 *
 * @param {string | null | undefined} hospitalOutcome
 * @param {string | null | undefined} offerStatus
 */
export function getHospitalOutcomePresentation(hospitalOutcome, offerStatus = null) {
  const resolved =
    hospitalOutcome || OFFER_STATUS_OUTCOME_FALLBACK[offerStatus ?? ""] || "AWAITING_RESPONSE";
  return (
    HOSPITAL_OUTCOME_PRESENTATIONS[resolved] || {
      label: "확인 필요",
      title: "확인 필요",
      description: "처리 결과를 확인해 주세요.",
      tone: "pending",
    }
  );
}

/**
 * 전체 환자정보는 구급대원이 이 병원을 최종 목적지로 선택한 동안에만 엽니다.
 *
 * @param {string} offerStatus
 * @param {boolean} currentDestination
 * @param {string | null | undefined} transportRequestStatus
 */
export function canOpenFullHospitalOffer(
  offerStatus,
  currentDestination,
  transportRequestStatus = null,
) {
  return (
    !TERMINAL_TRANSPORT_STATUSES.has(transportRequestStatus ?? "") &&
    offerStatus === "ACCEPTED" &&
    currentDestination
  );
}

/**
 * @param {Record<string, unknown>} offer
 * @param {"ACTIVE" | "HISTORY"} view
 * @param {"PENDING" | "ACCEPTED"} activeFilter
 */
export function getHospitalOfferActivityTime(offer, view, activeFilter = "PENDING") {
  const keys =
    view === "HISTORY"
      ? ["processedAt", "completedAt", "cancelledAt", "withdrawnAt", "respondedAt", "offeredAt"]
      : activeFilter === "ACCEPTED"
        ? ["respondedAt", "offeredAt"]
        : ["offeredAt", "respondedAt"];

  for (const key of keys) {
    const value = offer[key];
    if (typeof value !== "string" || !value) continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.NEGATIVE_INFINITY;
}

/**
 * @template {Record<string, unknown>} T
 * @param {T[]} offers
 * @param {"ACTIVE" | "HISTORY"} view
 * @param {"PENDING" | "ACCEPTED"} activeFilter
 * @returns {T[]}
 */
export function sortHospitalOffersNewestFirst(offers, view, activeFilter = "PENDING") {
  return [...offers].sort(
    (left, right) =>
      getHospitalOfferActivityTime(right, view, activeFilter) -
      getHospitalOfferActivityTime(left, view, activeFilter),
  );
}

/**
 * 탭별 개수는 현재 보고 있는 목록과 무관하게 각자의 원본 데이터에서 계산합니다.
 *
 * @param {Array<{ offerStatus?: string | null }>} activeOffers
 * @param {number | null | undefined} historyTotal
 */
export function getHospitalOfferQueueCounts(activeOffers, historyTotal = 0) {
  return {
    pending: activeOffers.filter((offer) => offer.offerStatus === "PENDING").length,
    accepted: activeOffers.filter((offer) => offer.offerStatus === "ACCEPTED").length,
    history: Math.max(0, Number(historyTotal) || 0),
  };
}

/**
 * 선택 중인 환자의 최신 상태에 맞춰 우측 목록 탭을 동기화합니다.
 * 종료 이력에서는 기존 활성 목록 필터를 보존할 수 있도록 null을 반환합니다.
 *
 * @param {"ACTIVE" | "HISTORY"} view
 * @param {string | null | undefined} offerStatus
 * @returns {{ view: "ACTIVE" | "HISTORY"; activeFilter: "PENDING" | "ACCEPTED" | null }}
 */
export function getHospitalOfferQueueTarget(view, offerStatus) {
  if (view === "HISTORY") {
    return { view: "HISTORY", activeFilter: null };
  }
  return {
    view: "ACTIVE",
    activeFilter: offerStatus === "ACCEPTED" ? "ACCEPTED" : "PENDING",
  };
}

/**
 * @param {string} reason
 * @param {string | null | undefined} detail
 */
export function createWithdrawalPayload(reason, detail) {
  if (!WITHDRAWAL_REASONS.includes(reason)) {
    throw new TypeError("수락 철회 사유를 선택해 주세요.");
  }
  const normalizedDetail = String(detail ?? "").trim();
  if (reason === "OTHER") {
    if (!normalizedDetail) {
      throw new TypeError("기타 상세 사유를 입력해 주세요.");
    }
    if (normalizedDetail.length > 200) {
      throw new TypeError("기타 상세 사유는 200자 이하로 입력해 주세요.");
    }
    return { reason, detail: normalizedDetail };
  }
  return { reason, detail: null };
}

/**
 * 목적지 선택 뒤 임상 상세 접근이 금지되는 최소 이력인지 판별합니다.
 *
 * @param {"ACTIVE" | "HISTORY"} view
 * @param {string} offerStatus
 * @param {string | null | undefined} transportRequestStatus
 */
export function isMinimalHospitalOffer(
  view,
  offerStatus,
  transportRequestStatus = null,
) {
  return (
    TERMINAL_TRANSPORT_STATUSES.has(transportRequestStatus ?? "") ||
    offerStatus === "ACCEPTANCE_WITHDRAWN" ||
    (view === "HISTORY" && offerStatus === "ACCEPTED")
  );
}

/**
 * @param {"ACTIVE" | "HISTORY"} view
 * @param {string} offerStatus
 * @param {string | null | undefined} transportRequestStatus
 */
export function canReadClinicalTimeline(
  view,
  offerStatus,
  transportRequestStatus = null,
) {
  return (
    !isMinimalHospitalOffer(view, offerStatus, transportRequestStatus) &&
    (offerStatus === "PENDING" || offerStatus === "ACCEPTED")
  );
}

/**
 * @param {string} offerStatus
 * @param {boolean} currentDestination
 * @param {string | null | undefined} transportRequestStatus
 */
export function canReadHospitalLocation(
  offerStatus,
  currentDestination,
  transportRequestStatus = null,
) {
  return (
    !TERMINAL_TRANSPORT_STATUSES.has(transportRequestStatus ?? "") &&
    offerStatus === "ACCEPTED" &&
    currentDestination
  );
}

const REALTIME_CLINICAL_TYPES = new Set([
  "VITAL_SIGNS_ADDED",
  "CONSCIOUSNESS_CHANGED",
  "PRE_KTAS_CHANGED",
  "TREATMENT_ADDED",
]);

const REALTIME_LIST_REFRESH_TYPES = new Set([
  "TRANSPORT_REQUEST_RECEIVED",
  "ETA_UPDATED",
  "DESTINATION_SELECTED",
  "DESTINATION_CHANGED",
  "HOSPITAL_ACCEPTANCE_WITHDRAWN",
  "TRANSPORT_CANCELLED",
  "HANDOFF_REQUESTED",
  "HANDOFF_COMPLETED",
  ...REALTIME_CLINICAL_TYPES,
]);
const REALTIME_DESTINATION_TYPES = new Set([
  "DESTINATION_SELECTED",
  "DESTINATION_CHANGED",
  "HOSPITAL_ACCEPTANCE_WITHDRAWN",
]);
const REALTIME_LIFECYCLE_TYPES = new Set([
  "TRANSPORT_CANCELLED",
  "HANDOFF_REQUESTED",
  "HANDOFF_COMPLETED",
]);

/**
 * @param {string} type
 */
export function shouldRefreshBothOfferLists(type) {
  return REALTIME_LIST_REFRESH_TYPES.has(type);
}

/**
 * @param {string} type
 */
export function isDestinationRealtimeType(type) {
  return REALTIME_DESTINATION_TYPES.has(type);
}

/**
 * @param {string} type
 */
export function isClinicalRealtimeType(type) {
  return REALTIME_CLINICAL_TYPES.has(type);
}

/**
 * @param {string} type
 */
export function isTransportLifecycleRealtimeType(type) {
  return REALTIME_LIFECYCLE_TYPES.has(type);
}

/**
 * @param {string} type
 * @param {string} aggregateId
 * @param {string | null} selectedOfferId
 * @param {string | null} selectedTransportRequestId
 */
export function shouldRefreshSelectedOffer(
  type,
  aggregateId,
  selectedOfferId,
  selectedTransportRequestId = null,
) {
  if (!selectedOfferId) return false;
  if (type === "ETA_UPDATED") return aggregateId === selectedOfferId;
  if (REALTIME_CLINICAL_TYPES.has(type)) {
    return aggregateId === selectedTransportRequestId;
  }
  return REALTIME_DESTINATION_TYPES.has(type);
}

/**
 * @param {string} type
 * @param {string} aggregateId
 * @param {string | null} selectedTransportRequestId
 */
export function shouldRefreshSelectedTimeline(
  type,
  aggregateId,
  selectedTransportRequestId,
) {
  return (
    Boolean(selectedTransportRequestId) &&
    REALTIME_CLINICAL_TYPES.has(type) &&
    aggregateId === selectedTransportRequestId
  );
}

/**
 * @param {string} type
 * @param {string} aggregateId
 * @param {string | null} selectedOfferId
 * @param {string | null} selectedTransportRequestId
 */
export function shouldRefreshSelectedLocation(
  type,
  aggregateId,
  selectedOfferId,
  selectedTransportRequestId,
) {
  if (type === "ETA_UPDATED") return aggregateId === selectedOfferId;
  return (
    type === "AMBULANCE_LOCATION_UPDATED" &&
    Boolean(selectedTransportRequestId) &&
    aggregateId === selectedTransportRequestId
  );
}

/**
 * @param {"accept" | "reject" | "withdraw" | "confirm-handoff"} action
 */
export function createOfferIdempotencyKey(action) {
  const key = `hospital-${action}:${crypto.randomUUID()}`;
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new TypeError("멱등성 키 형식이 올바르지 않습니다.");
  }
  return key;
}

/**
 * @param {Storage} storage
 * @param {string} offerId
 * @param {"accept" | "reject" | "withdraw" | "confirm-handoff"} action
 * @param {unknown} payload
 */
export function getOrCreateOfferCommand(storage, offerId, action, payload) {
  const storageKey = `ersync-offer-command:${offerId}`;
  const fingerprint = JSON.stringify({ action, payload });

  try {
    const saved = JSON.parse(storage.getItem(storageKey) || "null");
    if (
      saved &&
      saved.fingerprint === fingerprint &&
      IDEMPOTENCY_KEY_PATTERN.test(saved.idempotencyKey)
    ) {
      return saved;
    }
  } catch {
    storage.removeItem(storageKey);
  }

  const command = {
    action,
    payload,
    fingerprint,
    idempotencyKey: createOfferIdempotencyKey(action),
  };
  storage.setItem(storageKey, JSON.stringify(command));
  return command;
}

/**
 * @param {Storage} storage
 * @param {string} offerId
 * @param {string} idempotencyKey
 */
export function clearOfferCommand(storage, offerId, idempotencyKey) {
  const storageKey = `ersync-offer-command:${offerId}`;
  try {
    const saved = JSON.parse(storage.getItem(storageKey) || "null");
    if (!saved || saved.idempotencyKey === idempotencyKey) {
      storage.removeItem(storageKey);
    }
  } catch {
    storage.removeItem(storageKey);
  }
}
