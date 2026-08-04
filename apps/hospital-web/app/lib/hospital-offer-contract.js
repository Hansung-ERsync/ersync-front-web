// @ts-check

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,100}$/;
export const WITHDRAWAL_REASONS = [
  "BED_SHORTAGE",
  "OPERATING_ROOM_SHORTAGE",
  "SPECIALIST_UNAVAILABLE",
  "EQUIPMENT_UNAVAILABLE",
  "OTHER",
];

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
 */
export function isMinimalHospitalOffer(view, offerStatus) {
  return (
    offerStatus === "ACCEPTANCE_WITHDRAWN" ||
    (view === "HISTORY" && offerStatus === "ACCEPTED")
  );
}

const REALTIME_LIST_REFRESH_TYPES = new Set([
  "TRANSPORT_REQUEST_RECEIVED",
  "ETA_UPDATED",
  "DESTINATION_SELECTED",
  "DESTINATION_CHANGED",
  "HOSPITAL_ACCEPTANCE_WITHDRAWN",
]);
const REALTIME_DESTINATION_TYPES = new Set([
  "DESTINATION_SELECTED",
  "DESTINATION_CHANGED",
  "HOSPITAL_ACCEPTANCE_WITHDRAWN",
]);

/**
 * @param {string} type
 */
export function shouldRefreshBothOfferLists(type) {
  return REALTIME_LIST_REFRESH_TYPES.has(type);
}

/**
 * @param {string} type
 * @param {string} aggregateId
 * @param {string | null} selectedOfferId
 */
export function shouldRefreshSelectedOffer(type, aggregateId, selectedOfferId) {
  if (!selectedOfferId) return false;
  if (type === "ETA_UPDATED") return aggregateId === selectedOfferId;
  return REALTIME_DESTINATION_TYPES.has(type);
}

/**
 * @param {"accept" | "reject" | "withdraw"} action
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
 * @param {"accept" | "reject" | "withdraw"} action
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
