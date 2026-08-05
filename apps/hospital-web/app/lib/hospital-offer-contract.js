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
