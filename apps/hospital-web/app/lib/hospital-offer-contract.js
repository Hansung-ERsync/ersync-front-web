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
const DETAIL_BLOCKED_OFFER_STATUSES = new Set([
  "REJECTED",
  "ACCEPTANCE_WITHDRAWN",
]);

const TRANSPORT_REQUEST_STATUS_LABELS = Object.freeze({
  SEARCHING: "수용 병원 탐색 중",
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
 * ACTIVE에 유지되는 제안 상태입니다.
 *
 * @param {string | null | undefined} offerStatus
 */
export function isActiveHospitalOfferStatus(offerStatus) {
  return offerStatus === "PENDING" || offerStatus === "ACCEPTED";
}

/**
 * @param {string} offerStatus
 * @param {boolean} currentDestination
 * @param {string | null | undefined} transportRequestStatus
 */
export function canOpenFullHospitalOffer(
  offerStatus,
  currentDestination,
  transportRequestStatus = null,
) {
  void currentDestination;
  return (
    !TERMINAL_TRANSPORT_STATUSES.has(transportRequestStatus ?? "") &&
    isActiveHospitalOfferStatus(offerStatus)
  );
}

/**
 * 인계 요청 전의 PENDING 제안만 수락·거절할 수 있습니다.
 *
 * @param {string} offerStatus
 * @param {string | null | undefined} transportRequestStatus
 */
export function canRespondToHospitalOffer(
  offerStatus,
  transportRequestStatus = null,
) {
  return (
    isActiveHospitalOfferStatus(offerStatus) &&
    offerStatus === "PENDING" &&
    transportRequestStatus !== "HANDOFF_REQUESTED" &&
    !TERMINAL_TRANSPORT_STATUSES.has(transportRequestStatus ?? "")
  );
}

/**
 * 수락 철회 UI와 실행 방식을 최종 정책에 맞춰 구분합니다.
 * 목적지 병원은 이동 중에만 긴급 고지를 사용할 수 있습니다.
 *
 * @param {boolean} canWithdraw
 * @param {boolean} currentDestination
 * @param {string | null | undefined} transportRequestStatus
 * @returns {"STANDARD" | "EMERGENCY" | null}
 */
export function getHospitalWithdrawalMode(
  canWithdraw,
  currentDestination,
  transportRequestStatus = null,
) {
  if (!canWithdraw) return null;
  if (!currentDestination) return "STANDARD";
  return transportRequestStatus === "EN_ROUTE" ? "EMERGENCY" : null;
}

/**
 * 목적지 변경 전후의 병원별 목록을 비교해 명시적인 화면 알림을 만듭니다.
 *
 * @param {Array<{ offerId: string; currentDestination: boolean }>} previousOffers
 * @param {Array<{ offerId: string; currentDestination: boolean }>} nextOffers
 * @returns {{ tone: "warning" | "success" | "info"; message: string }}
 */
export function getDestinationChangeNotice(previousOffers, nextOffers) {
  const previousDestinationIds = new Set(
    previousOffers
      .filter((offer) => offer.currentDestination)
      .map((offer) => offer.offerId),
  );
  const nextDestinationIds = new Set(
    nextOffers
      .filter((offer) => offer.currentDestination)
      .map((offer) => offer.offerId),
  );

  if (
    [...previousDestinationIds].some(
      (offerId) => !nextDestinationIds.has(offerId),
    )
  ) {
    return {
      tone: "warning",
      message:
        "목적지가 다른 병원으로 변경되었습니다. 기존 수락은 유지되며 다시 선택될 수 있습니다.",
    };
  }
  if (
    [...nextDestinationIds].some(
      (offerId) => !previousDestinationIds.has(offerId),
    )
  ) {
    return {
      tone: "success",
      message: "우리 병원이 새로운 목적지로 선택되었습니다.",
    };
  }
  return {
    tone: "info",
    message: "이송 목적지가 변경되었습니다. 최신 병원 상태를 확인해 주세요.",
  };
}

/**
 * 다른 병원이 목적지로 선택된 뒤에도 ACTIVE에 남는 제안인지 판별합니다.
 * 이 상태에서는 공개 종료 시점까지의 임상정보만 보이고 동적 경로·위치는 숨깁니다.
 *
 * @param {string} offerStatus
 * @param {boolean} currentDestination
 * @param {string | null | undefined} transportRequestStatus
 */
export function isNonDestinationActiveHospitalOffer(
  offerStatus,
  currentDestination,
  transportRequestStatus = null,
) {
  return (
    isActiveHospitalOfferStatus(offerStatus) &&
    !currentDestination &&
    (transportRequestStatus === "EN_ROUTE" ||
      transportRequestStatus === "HANDOFF_REQUESTED")
  );
}

/**
 * offerStatus 하나만으로는 구분할 수 없는 목적지·인계 상태를 화면 문구로 변환합니다.
 *
 * @param {string} offerStatus
 * @param {boolean} currentDestination
 * @param {string | null | undefined} transportRequestStatus
 * @returns {{ label: string; description: string; tone: "pending" | "accepted" | "handoff" } | null}
 */
export function getActiveHospitalOfferContext(
  offerStatus,
  currentDestination,
  transportRequestStatus = null,
) {
  if (!isActiveHospitalOfferStatus(offerStatus)) return null;

  if (transportRequestStatus === "HANDOFF_REQUESTED") {
    return currentDestination
      ? {
          label: "인계 확인 대기",
          description: "우리 병원에서 환자 인계 확인을 기다리고 있습니다.",
          tone: "handoff",
        }
      : {
          label: "다른 병원 인계 진행 중",
          description: "다른 병원에서 인계를 진행 중이므로 추가 응답은 할 수 없습니다.",
          tone: "handoff",
        };
  }

  if (offerStatus === "ACCEPTED" && currentDestination) {
    return {
      label: "우리 병원으로 이동 중",
      description: "구급차가 우리 병원으로 이동 중입니다.",
      tone: "accepted",
    };
  }

  if (transportRequestStatus === "EN_ROUTE" && !currentDestination) {
    if (offerStatus === "PENDING") {
      return {
        label: "다른 병원으로 이동 중 · 응답 가능",
        description:
          "다른 병원으로 이동 중이지만 인계 요청 전까지 수락하거나 거절할 수 있습니다.",
        tone: "pending",
      };
    }
    if (offerStatus === "ACCEPTED") {
      return {
        label: "수락 완료 · 다른 병원으로 이동 중",
        description:
          "수락 상태는 유지되며 인계 요청 전까지 수락을 철회할 수 있습니다.",
        tone: "accepted",
      };
    }
  }

  return null;
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
        : ["lastRequestedAt", "offeredAt", "respondedAt"];

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
    pending: activeOffers.filter(
      (offer) =>
        isActiveHospitalOfferStatus(offer.offerStatus) &&
        offer.offerStatus === "PENDING",
    ).length,
    accepted: activeOffers.filter(
      (offer) =>
        isActiveHospitalOfferStatus(offer.offerStatus) &&
        offer.offerStatus === "ACCEPTED",
    ).length,
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
 * 거절·철회·종료 상태처럼 보호 데이터 API 접근이 차단된 제안인지 판별합니다.
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
    DETAIL_BLOCKED_OFFER_STATUSES.has(offerStatus) ||
    (view === "HISTORY" &&
      (offerStatus === "ACCEPTED" || !isActiveHospitalOfferStatus(offerStatus)))
  );
}

/**
 * 18 계약에서 상태·거절 사유·처리 시각만 노출하는 HISTORY 항목입니다.
 *
 * @param {"ACTIVE" | "HISTORY"} view
 * @param {string} offerStatus
 */
export function isRejectedHospitalOfferHistory(view, offerStatus) {
  return view === "HISTORY" && offerStatus === "REJECTED";
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
    isActiveHospitalOfferStatus(offerStatus)
  );
}

/**
 * 자기 병원 프로필 또는 제안 접근 범위가 사라진 경우 목록을 다시 읽어 복구합니다.
 *
 * @param {string | null | undefined} code
 */
export function shouldRecoverHospitalOfferRead(code) {
  return code === "HOSPITAL_001" || code === "TRANSPORT_005";
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
  if (type === "TRANSPORT_REQUEST_RECEIVED") {
    return aggregateId === selectedOfferId;
  }
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
