"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ApiError,
  errorMessage,
  HospitalOfferDetail,
  HospitalOfferListItem,
  hospitalApi,
  OfferStatus,
  OfferView,
  PageResult,
  RejectionReason,
  sessionApi,
  VitalSignMeasurement,
} from "../lib/api";
import {
  clearOfferCommand,
  getOrCreateOfferCommand,
} from "../lib/hospital-offer-contract.js";

type StreamState = "CONNECTING" | "CONNECTED" | "RECONNECTING";

type RealtimeUpdate = {
  eventId: string;
  type: "TRANSPORT_REQUEST_RECEIVED" | "ETA_UPDATED" | string;
  aggregateType: string;
  aggregateId: string;
  occurredAt: string;
};

const offerStatusLabel: Record<OfferStatus, string> = {
  PENDING: "응답 대기",
  ACCEPTED: "수락",
  REJECTED: "거절",
  NO_RESPONSE: "무응답 종료",
};

const rejectionReasonLabel: Record<RejectionReason, string> = {
  ER_GENERAL_BED_SHORTAGE: "일반 응급실 병상 부족",
  ISOLATION_BED_SHORTAGE: "격리 병상 부족",
  OPERATING_ROOM_SHORTAGE: "수술실 부족",
  ICU_SHORTAGE: "중환자실 부족",
  SPECIALIST_UNAVAILABLE: "전문의 부재",
  EQUIPMENT_UNAVAILABLE: "장비 사용 불가",
  OTHER: "기타",
};

const enumLabels: Record<string, string> = {
  EXACT: "확인",
  ESTIMATED: "추정",
  UNKNOWN: "미상",
  MALE: "남성",
  FEMALE: "여성",
  DISEASE: "질병",
  NON_DISEASE: "비질병",
  OTHER: "기타",
  TRAFFIC: "교통사고",
  FALL: "넘어짐",
  FALL_FROM_HEIGHT: "추락",
  BLUNT: "둔상",
  PENETRATING: "관통상",
  BURN: "화상",
  POISONING: "중독",
  DROWNING_ASPHYXIA: "익수·질식",
  ASSAULT_SELF_HARM: "폭행·자해",
  MACHINERY_AGRICULTURAL: "기계·농업 사고",
  HEAD_FACE: "머리·얼굴",
  NECK: "목",
  CHEST: "가슴",
  ABDOMEN_PELVIS: "복부·골반",
  SPINE: "척추",
  UPPER_LIMB: "상지",
  LOWER_LIMB: "하지",
  MULTIPLE: "다발성",
  ALTERED_CONSCIOUSNESS: "의식 변화",
  DYSPNEA: "호흡곤란",
  RESPIRATORY_ARREST: "호흡정지",
  CHEST_PAIN: "흉통",
  CARDIAC_ARREST: "심정지",
  SUSPECTED_STROKE: "뇌졸중 의심",
  SEIZURE_SYNCOPE: "경련·실신",
  TRAUMA: "외상",
  BLEEDING: "출혈",
  GASTROINTESTINAL: "위장관 증상",
  PREGNANCY_DELIVERY: "임신·분만",
  BEHAVIORAL_SELF_HARM: "행동 이상·자해",
  FEVER_INFECTION: "발열·감염",
  CPR_IN_PROGRESS: "심폐소생술 진행",
  SCENE_DANGER: "현장 위험",
  INSUFFICIENT_ASSESSMENT_TIME: "평가 시간 부족",
  PATIENT_INACCESSIBLE: "환자 접근 불가",
  PATIENT_CONDITION: "환자 상태",
  INJURY_SITE: "손상 부위",
  DEVICE_ERROR: "장비 오류",
  NONE: "처치 없음",
  OXYGEN: "산소 투여",
  AIRWAY: "기도 확보",
  CPR: "심폐소생술",
  DEFIBRILLATION_AED: "제세동·AED",
  IV_FLUID: "정맥로·수액",
  MEDICATION: "약물 투여",
  BLEEDING_WOUND: "출혈·상처 처치",
  IMMOBILIZATION: "고정",
  ECG: "심전도",
  WARMING_COOLING: "보온·냉각",
  DELIVERY: "분만 처치",
  SUCCESS: "성공",
  FAILURE: "실패",
  ONGOING: "진행 중",
  NOT_APPLICABLE: "해당 없음",
};

const vitalLabels: Record<VitalSignMeasurement["type"], string> = {
  BLOOD_PRESSURE: "혈압",
  PULSE: "맥박",
  RESPIRATORY_RATE: "호흡수",
  TEMPERATURE: "체온",
  SPO2: "산소포화도",
};

const vitalUnits: Record<VitalSignMeasurement["type"], string> = {
  BLOOD_PRESSURE: "mmHg",
  PULSE: "회/분",
  RESPIRATORY_RATE: "회/분",
  TEMPERATURE: "℃",
  SPO2: "%",
};

function label(value: string | null | undefined) {
  if (!value) return "-";
  return enumLabels[value] || value.replaceAll("_", " ");
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatDistance(meters: number | null | undefined) {
  if (meters == null) return "-";
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

function formatEta(seconds: number | null | undefined) {
  if (seconds == null) return "-";
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `약 ${minutes}분`;
}

function patientSummary(offer: Pick<HospitalOfferListItem, "ageStatus" | "ageYears" | "sex">) {
  const age =
    offer.ageStatus === "UNKNOWN" || offer.ageYears == null
      ? "나이 미상"
      : `${offer.ageYears}세${offer.ageStatus === "ESTIMATED" ? " 추정" : ""}`;
  return `${age} · ${label(offer.sex)}`;
}

function triageSummary(offer: HospitalOfferListItem) {
  return offer.preKtasClassificationStatus === "COMPLETED"
    ? `Pre-KTAS ${offer.preKtasLevel ?? "-"}`
    : `긴급 미완료 · ${label(offer.preKtasExceptionReason)}`;
}

function routeSummary(offer: HospitalOfferListItem) {
  if (offer.routeEstimateStatus === "CALCULATING") return "도로 거리·ETA 계산 중";
  if (offer.routeEstimateStatus === "UNAVAILABLE") return "경로 계산 실패";
  return `${formatDistance(offer.routeDistanceMeters)} · ${formatEta(offer.etaSeconds)}`;
}

function isSessionError(error: unknown) {
  return (
    error instanceof ApiError &&
    ["AUTH_001", "AUTH_002", "AUTH_005", "USER_002"].includes(error.code)
  );
}

function OfferError({ error }: { error: unknown }) {
  if (!error) return null;
  const apiError = error instanceof ApiError ? error : null;
  return (
    <div className="offer-error" role="alert">
      <strong>{errorMessage(error)}</strong>
      {apiError?.code ? (
        <span>
          오류 코드 {apiError.code}
          {apiError.traceId ? ` · 문의용 traceId ${apiError.traceId}` : ""}
        </span>
      ) : null}
    </div>
  );
}

function OfferCard({
  offer,
  onSelect,
}: {
  offer: HospitalOfferListItem;
  onSelect: () => void;
}) {
  return (
    <button className="offer-card" onClick={onSelect} type="button">
      <span className={`offer-status offer-status-${offer.offerStatus.toLowerCase()}`}>
        {offerStatusLabel[offer.offerStatus]}
      </span>
      <div className="offer-card-main">
        <strong>{patientSummary(offer)}</strong>
        <span>{triageSummary(offer)}</span>
      </div>
      <div className="offer-card-route">
        <strong>{routeSummary(offer)}</strong>
        <span>직선 {formatDistance(offer.straightLineDistanceMeters)}</span>
      </div>
      <div className="offer-card-meta">
        <span>제안 {formatDate(offer.offeredAt)}</span>
        <span>탐색 {offer.dispatchAttemptNumber}차</span>
      </div>
      <span className="offer-card-arrow" aria-hidden="true">→</span>
    </button>
  );
}

function VitalValue({ measurement }: { measurement: VitalSignMeasurement }) {
  if (measurement.state === "PATIENT_REFUSED") return <>환자 거부</>;
  if (measurement.state === "MEASUREMENT_UNAVAILABLE") {
    return (
      <>
        측정 불가 · {label(measurement.unavailableReason)}
        {measurement.unavailableDetail ? ` (${measurement.unavailableDetail})` : ""}
      </>
    );
  }
  if (measurement.type === "BLOOD_PRESSURE") {
    return (
      <>
        {measurement.primaryValue ?? "-"}/{measurement.secondaryValue ?? "-"}{" "}
        {vitalUnits[measurement.type]}
      </>
    );
  }
  return (
    <>
      {measurement.primaryValue ?? "-"} {vitalUnits[measurement.type]}
    </>
  );
}

function TreatmentDetails({ treatment }: { treatment: HospitalOfferDetail["treatments"][number] }) {
  const details = [
    treatment.method,
    treatment.device,
    treatment.flowRateLpm != null ? `${treatment.flowRateLpm}L/min` : null,
    treatment.currentStatus,
    treatment.medicationName,
    treatment.dose,
    treatment.route,
    treatment.site,
    treatment.detail,
  ].filter(Boolean);

  return (
    <div className="treatment-row">
      <strong>{label(treatment.type)}</strong>
      <span>
        {[treatment.attemptResult ? label(treatment.attemptResult) : null, ...details]
          .filter(Boolean)
          .join(" · ") || "추가 정보 없음"}
      </span>
      <time>{formatDate(treatment.performedAt)}</time>
    </div>
  );
}

function OfferDetailModal({
  detail,
  loading,
  error,
  decisionBusy,
  decisionError,
  decisionNotice,
  showReject,
  rejectReason,
  rejectDetail,
  onClose,
  onAccept,
  onShowReject,
  onCancelReject,
  onRejectReason,
  onRejectDetail,
  onReject,
}: {
  detail: HospitalOfferDetail | null;
  loading: boolean;
  error: unknown;
  decisionBusy: "accept" | "reject" | null;
  decisionError: unknown;
  decisionNotice: string | null;
  showReject: boolean;
  rejectReason: RejectionReason | "";
  rejectDetail: string;
  onClose: () => void;
  onAccept: () => void;
  onShowReject: () => void;
  onCancelReject: () => void;
  onRejectReason: (reason: RejectionReason | "") => void;
  onRejectDetail: (detail: string) => void;
  onReject: (event: FormEvent) => void;
}) {
  return (
    <div className="offer-modal-backdrop" onMouseDown={onClose}>
      <section
        aria-labelledby="offer-detail-title"
        aria-modal="true"
        className="offer-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="offer-modal-header">
          <div>
            <span className="eyebrow">병원 제안 상세</span>
            <h2 id="offer-detail-title">
              {detail ? patientSummary(detail.patient) : "요청 상세 확인 중"}
            </h2>
          </div>
          <button aria-label="상세 닫기" className="modal-close" onClick={onClose} type="button">
            ×
          </button>
        </header>

        {loading ? <div className="offer-modal-loading">상세 정보를 불러오고 있어요…</div> : null}
        <OfferError error={error} />

        {detail ? (
          <div className="offer-detail-body">
            <div className="offer-detail-summary">
              <span className={`offer-status offer-status-${detail.offerStatus.toLowerCase()}`}>
                {offerStatusLabel[detail.offerStatus]}
              </span>
              <div>
                <small>Pre-KTAS</small>
                <strong>
                  {detail.preKtas.classificationStatus === "COMPLETED"
                    ? `${detail.preKtas.level ?? "-"}단계`
                    : `긴급 미완료 · ${label(detail.preKtas.exceptionReason)}`}
                </strong>
              </div>
              <div>
                <small>요청 상태</small>
                <strong>{label(detail.transportRequestStatus)}</strong>
              </div>
              <div>
                <small>탐색 회차</small>
                <strong>{detail.dispatchAttemptNumber}차</strong>
              </div>
            </div>

            <section className="detail-section">
              <div className="detail-section-title">
                <h3>환자·발생 정보</h3>
                <time>접수 {formatDate(detail.timing.requestReceivedAt)}</time>
              </div>
              <dl className="clinical-grid">
                <div><dt>환자</dt><dd>{patientSummary(detail.patient)}</dd></div>
                <div><dt>발생 유형</dt><dd>{label(detail.incident.occurrenceType)}</dd></div>
                <div><dt>주증상</dt><dd>{label(detail.incident.primarySymptom)}{detail.incident.primarySymptomDetail ? ` · ${detail.incident.primarySymptomDetail}` : ""}</dd></div>
                <div><dt>부증상</dt><dd>{detail.incident.secondarySymptoms.length ? detail.incident.secondarySymptoms.map(label).join(", ") : "없음"}</dd></div>
                <div><dt>손상 기전</dt><dd>{label(detail.incident.injuryMechanism)}</dd></div>
                <div><dt>손상 부위</dt><dd>{detail.incident.injurySites.length ? detail.incident.injurySites.map(label).join(", ") : "없음"}</dd></div>
                <div><dt>발생 시각</dt><dd>{detail.incident.onsetTimeStatus === "UNKNOWN" ? "미상" : `${formatDate(detail.incident.onsetAt)} · ${label(detail.incident.onsetTimeStatus)}`}</dd></div>
                <div><dt>의식 상태</dt><dd>{detail.consciousness.avpu === "UNASSESSABLE" ? `평가 불가 · ${label(detail.consciousness.unassessableReason)}` : `AVPU ${detail.consciousness.avpu}`}</dd></div>
              </dl>
            </section>

            <section className="detail-section">
              <div className="detail-section-title">
                <h3>활력징후</h3>
                <time>측정 {formatDate(detail.vitalSigns.measuredAt)}</time>
              </div>
              <div className="vital-grid">
                {detail.vitalSigns.measurements.map((measurement) => (
                  <div className={`vital-card vital-state-${measurement.state.toLowerCase()}`} key={measurement.type}>
                    <span>{vitalLabels[measurement.type]}</span>
                    <strong><VitalValue measurement={measurement} /></strong>
                  </div>
                ))}
              </div>
            </section>

            <section className="detail-section">
              <div className="detail-section-title"><h3>현장 처치</h3></div>
              <div className="treatment-list">
                {detail.treatments.map((treatment, index) => (
                  <TreatmentDetails key={`${treatment.type}-${index}`} treatment={treatment} />
                ))}
              </div>
            </section>

            <section className="detail-section response-contact-section">
              <div className="detail-section-title"><h3>구급대 회신 정보</h3></div>
              <div className="requester-card">
                <div><small>소속 구급대</small><strong>{detail.requester.organizationName}</strong></div>
                <div><small>회신 연락처</small><strong>{detail.requester.callbackContact}</strong></div>
              </div>
              <p>
                {detail.offerStatus === "PENDING" || detail.offerStatus === "ACCEPTED"
                  ? "응답 진행을 위해 제공된 연락처입니다. 콘솔·오류 보고에 남기지 마세요."
                  : "종료된 제안의 연락처는 서버에서 마지막 네 자리만 남겨 마스킹합니다."}
              </p>
            </section>

            <section className="detail-section">
              <div className="detail-section-title"><h3>이송 거리·ETA</h3></div>
              <div className={`route-detail route-detail-${detail.route.status.toLowerCase()}`}>
                <div><small>직선거리</small><strong>{formatDistance(detail.route.straightLineDistanceMeters)}</strong></div>
                {detail.route.status === "AVAILABLE" ? (
                  <>
                    <div><small>도로거리</small><strong>{formatDistance(detail.route.routeDistanceMeters)}</strong></div>
                    <div><small>예상 도착</small><strong>{formatEta(detail.route.etaSeconds)}</strong></div>
                  </>
                ) : (
                  <div className="route-status-message">
                    <small>경로 상태</small>
                    <strong>{detail.route.status === "CALCULATING" ? "계산 중" : "계산할 수 없음"}</strong>
                  </div>
                )}
              </div>
              {detail.route.status === "UNAVAILABLE" ? (
                <p>경로 계산 실패와 관계없이 수락·거절할 수 있습니다.</p>
              ) : null}
            </section>

            {detail.rejectionReason ? (
              <section className="detail-section rejection-result">
                <div className="detail-section-title"><h3>거절 사유</h3></div>
                <strong>{rejectionReasonLabel[detail.rejectionReason]}</strong>
                {detail.rejectionDetail ? <p>{detail.rejectionDetail}</p> : null}
                <time>응답 {formatDate(detail.respondedAt)}</time>
              </section>
            ) : null}

            {decisionNotice ? <div className="decision-notice" role="status">{decisionNotice}</div> : null}
            <OfferError error={decisionError} />

            {detail.offerStatus === "PENDING" ? (
              showReject ? (
                <form className="reject-form" onSubmit={onReject}>
                  <div className="detail-section-title"><h3>거절 사유 선택</h3></div>
                  <label>
                    <span>사유</span>
                    <select
                      onChange={(event) => onRejectReason(event.target.value as RejectionReason | "")}
                      required
                      value={rejectReason}
                    >
                      <option value="">선택해 주세요</option>
                      {(Object.keys(rejectionReasonLabel) as RejectionReason[]).map((reason) => (
                        <option key={reason} value={reason}>{rejectionReasonLabel[reason]}</option>
                      ))}
                    </select>
                  </label>
                  {rejectReason === "OTHER" ? (
                    <label>
                      <span>기타 상세 사유</span>
                      <textarea
                        maxLength={200}
                        onChange={(event) => onRejectDetail(event.target.value)}
                        placeholder="공백이 아닌 상세 사유를 입력해 주세요."
                        required
                        value={rejectDetail}
                      />
                      <small>{rejectDetail.length}/200</small>
                    </label>
                  ) : null}
                  <div className="decision-actions">
                    <button className="button button-muted" disabled={decisionBusy !== null} onClick={onCancelReject} type="button">취소</button>
                    <button className="button button-danger" disabled={decisionBusy !== null || !rejectReason || (rejectReason === "OTHER" && !rejectDetail.trim())} type="submit">
                      {decisionBusy === "reject" ? "거절 처리 중…" : decisionError ? "같은 요청 다시 시도" : "거절 확정"}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="decision-actions decision-actions-primary">
                  <button className="button button-danger" disabled={decisionBusy !== null} onClick={onShowReject} type="button">거절</button>
                  <button className="button button-primary" disabled={decisionBusy !== null} onClick={onAccept} type="button">
                    {decisionBusy === "accept" ? "수락 처리 중…" : decisionError ? "같은 요청 다시 시도" : "수용 가능으로 응답"}
                  </button>
                </div>
              )
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

export function HospitalOffers({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [view, setView] = useState<OfferView>("ACTIVE");
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<PageResult<HospitalOfferListItem> | null>(null);
  const [activeTotal, setActiveTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [detail, setDetail] = useState<HospitalOfferDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<unknown>(null);
  const [decisionBusy, setDecisionBusy] = useState<"accept" | "reject" | null>(null);
  const [decisionError, setDecisionError] = useState<unknown>(null);
  const [decisionNotice, setDecisionNotice] = useState<string | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState<RejectionReason | "">("");
  const [rejectDetail, setRejectDetail] = useState("");
  const [streamState, setStreamState] = useState<StreamState>("CONNECTING");
  const currentRef = useRef({ view, page, selectedOfferId });
  const expiredRef = useRef(onSessionExpired);

  useEffect(() => {
    currentRef.current = { view, page, selectedOfferId };
    expiredRef.current = onSessionExpired;
  }, [onSessionExpired, page, selectedOfferId, view]);

  const loadOffers = useCallback(async (targetView: OfferView, targetPage: number) => {
    setLoading(true);
    setError(null);
    try {
      const next = await hospitalApi.offers(targetView, targetPage, 20);
      setResult(next);
      if (targetView === "ACTIVE") setActiveTotal(next.totalElements);
    } catch (nextError) {
      setError(nextError);
      if (isSessionError(nextError)) expiredRef.current();
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshActive = useCallback(async () => {
    const current = currentRef.current;
    if (current.view === "ACTIVE") {
      await loadOffers("ACTIVE", current.page);
      return;
    }
    try {
      const active = await hospitalApi.offers("ACTIVE", 0, 20);
      setActiveTotal(active.totalElements);
    } catch (nextError) {
      if (isSessionError(nextError)) expiredRef.current();
    }
  }, [loadOffers]);

  const loadDetail = useCallback(async (offerId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const next = await hospitalApi.offerDetail(offerId);
      setDetail(next);
    } catch (nextError) {
      setDetailError(nextError);
      if (isSessionError(nextError)) expiredRef.current();
      if (nextError instanceof ApiError && nextError.code === "TRANSPORT_005") {
        setSelectedOfferId(null);
        setDetail(null);
        await loadOffers(currentRef.current.view, currentRef.current.page);
      }
    } finally {
      setDetailLoading(false);
    }
  }, [loadOffers]);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => void loadOffers(view, page), 0);
    return () => window.clearTimeout(loadTimer);
  }, [loadOffers, page, view]);

  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState !== "visible") return;
      void refreshActive();
      const currentOfferId = currentRef.current.selectedOfferId;
      if (currentOfferId) void loadDetail(currentOfferId);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [loadDetail, refreshActive]);

  useEffect(() => {
    let source: EventSource | null = null;
    let retryTimer: number | null = null;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      setStreamState("CONNECTING");
      source = new EventSource("/api/realtime/events");
      source.onopen = () => {
        setStreamState("CONNECTED");
        void refreshActive();
      };
      source.addEventListener("update", (event) => {
        let update: RealtimeUpdate | null = null;
        try {
          update = JSON.parse((event as MessageEvent<string>).data) as RealtimeUpdate;
        } catch {
          return;
        }
        if (update.type === "TRANSPORT_REQUEST_RECEIVED" || update.type === "ETA_UPDATED") {
          void refreshActive();
        }
        if (
          update.type === "ETA_UPDATED" &&
          update.aggregateId === currentRef.current.selectedOfferId
        ) {
          void loadDetail(update.aggregateId);
        }
      });
      source.onerror = () => {
        if (stopped) return;
        source?.close();
        setStreamState("RECONNECTING");
        retryTimer = window.setTimeout(async () => {
          try {
            const session = await sessionApi.get();
            if (!session.session) {
              expiredRef.current();
              return;
            }
          } catch {
            // 일시적인 네트워크 오류는 SSE 재연결로 복구합니다.
          }
          void refreshActive();
          connect();
        }, 2_000);
      };
    };

    connect();
    return () => {
      stopped = true;
      source?.close();
      if (retryTimer != null) window.clearTimeout(retryTimer);
    };
  }, [loadDetail, refreshActive]);

  const selectOffer = (offerId: string) => {
    setSelectedOfferId(offerId);
    setDetail(null);
    setDecisionError(null);
    setDecisionNotice(null);
    setShowReject(false);
    setRejectReason("");
    setRejectDetail("");
    void loadDetail(offerId);
  };

  const closeDetail = () => {
    setSelectedOfferId(null);
    setDetail(null);
    setDetailError(null);
    setDecisionError(null);
    setDecisionNotice(null);
    setShowReject(false);
  };

  const refreshAfterDecision = async (offerId: string) => {
    await Promise.all([
      loadOffers(currentRef.current.view, currentRef.current.page),
      loadDetail(offerId),
    ]);
  };

  const accept = async () => {
    if (!detail || detail.offerStatus !== "PENDING") return;
    const command = getOrCreateOfferCommand(
      window.sessionStorage,
      detail.offerId,
      "accept",
      null,
    );
    setDecisionBusy("accept");
    setDecisionError(null);
    setDecisionNotice(null);
    try {
      const response = await hospitalApi.acceptOffer(detail.offerId, command.idempotencyKey);
      clearOfferCommand(window.sessionStorage, detail.offerId, command.idempotencyKey);
      setDecisionNotice(
        response.idempotentReplay
          ? "이전에 처리된 수락 결과를 복구했습니다."
          : "수용 가능으로 응답했습니다. 최종 목적지는 아직 확정되지 않았습니다.",
      );
      await refreshAfterDecision(detail.offerId);
    } catch (nextError) {
      setDecisionError(nextError);
      if (isSessionError(nextError)) expiredRef.current();
      if (
        nextError instanceof ApiError &&
        ["TRANSPORT_005", "TRANSPORT_006", "COMMON_005"].includes(nextError.code)
      ) {
        clearOfferCommand(window.sessionStorage, detail.offerId, command.idempotencyKey);
        await refreshAfterDecision(detail.offerId);
      }
      if (nextError instanceof ApiError && nextError.code === "COMMON_001") {
        clearOfferCommand(window.sessionStorage, detail.offerId, command.idempotencyKey);
      }
    } finally {
      setDecisionBusy(null);
    }
  };

  const reject = async (event: FormEvent) => {
    event.preventDefault();
    if (!detail || detail.offerStatus !== "PENDING" || !rejectReason) return;
    const payload = {
      reason: rejectReason,
      detail: rejectReason === "OTHER" ? rejectDetail.trim() : null,
    };
    if (rejectReason === "OTHER" && !payload.detail) return;
    const command = getOrCreateOfferCommand(
      window.sessionStorage,
      detail.offerId,
      "reject",
      payload,
    );
    setDecisionBusy("reject");
    setDecisionError(null);
    setDecisionNotice(null);
    try {
      const response = await hospitalApi.rejectOffer(
        detail.offerId,
        payload,
        command.idempotencyKey,
      );
      clearOfferCommand(window.sessionStorage, detail.offerId, command.idempotencyKey);
      setDecisionNotice(
        response.idempotentReplay
          ? "이전에 처리된 거절 결과를 복구했습니다."
          : "거절 응답을 전송했습니다.",
      );
      setShowReject(false);
      await refreshAfterDecision(detail.offerId);
    } catch (nextError) {
      setDecisionError(nextError);
      if (isSessionError(nextError)) expiredRef.current();
      if (
        nextError instanceof ApiError &&
        ["TRANSPORT_005", "TRANSPORT_006", "COMMON_005"].includes(nextError.code)
      ) {
        clearOfferCommand(window.sessionStorage, detail.offerId, command.idempotencyKey);
        await refreshAfterDecision(detail.offerId);
      }
      if (nextError instanceof ApiError && nextError.code === "COMMON_001") {
        clearOfferCommand(window.sessionStorage, detail.offerId, command.idempotencyKey);
      }
    } finally {
      setDecisionBusy(null);
    }
  };

  const items = result?.items ?? [];
  const totalPages = Math.max(1, result?.totalPages ?? 1);

  return (
    <>
      <div className="request-panel offer-panel">
        <div className="request-panel-head offer-panel-head">
          <div>
            <span className="eyebrow">이송 요청</span>
            <h1>{view === "ACTIVE" ? "병원 응답이 필요한 요청" : "종료된 응답 이력"}</h1>
            <p>
              {view === "ACTIVE"
                ? "상세 임상정보와 예상 거리를 확인한 뒤 현재 수용 가능 여부를 응답해 주세요."
                : "거절·무응답으로 종료된 제안과 마스킹된 회신 정보를 확인합니다."}
            </p>
          </div>
          <div className={`stream-chip stream-${streamState.toLowerCase()}`}>
            <span />
            {streamState === "CONNECTED"
              ? "실시간 연결"
              : streamState === "RECONNECTING"
                ? "재연결 중"
                : "연결 중"}
          </div>
        </div>

        <div className="offer-tabs" role="tablist">
          <button
            aria-selected={view === "ACTIVE"}
            className={view === "ACTIVE" ? "active" : ""}
            onClick={() => { setView("ACTIVE"); setPage(0); }}
            role="tab"
            type="button"
          >
            활성 요청 <span>{activeTotal}</span>
          </button>
          <button
            aria-selected={view === "HISTORY"}
            className={view === "HISTORY" ? "active" : ""}
            onClick={() => { setView("HISTORY"); setPage(0); }}
            role="tab"
            type="button"
          >
            종료 이력
          </button>
          <button
            aria-label="목록 새로고침"
            className="offer-refresh"
            disabled={loading}
            onClick={() => void loadOffers(view, page)}
            type="button"
          >
            ↻ 새로고침
          </button>
        </div>

        <OfferError error={error} />
        {loading ? <div className="offer-list-loading">요청 목록을 확인하고 있어요…</div> : null}
        {!loading && !items.length ? (
          <div className="empty-stage offer-empty">
            <div className="empty-symbol">ER</div>
            <strong>{view === "ACTIVE" ? "현재 응답할 요청이 없습니다" : "종료된 응답 이력이 없습니다"}</strong>
            <span>
              {view === "ACTIVE"
                ? "수신 ON 상태에서 새 제안이 오면 실시간으로 목록을 다시 조회합니다."
                : "거절 또는 무응답으로 종료된 제안이 이곳에 표시됩니다."}
            </span>
          </div>
        ) : null}
        {items.length ? (
          <div className="offer-list">
            {items.map((offer) => (
              <OfferCard key={offer.offerId} offer={offer} onSelect={() => selectOffer(offer.offerId)} />
            ))}
          </div>
        ) : null}

        {result && result.totalPages > 1 ? (
          <div className="offer-pagination">
            <button disabled={page <= 0 || loading} onClick={() => setPage((current) => current - 1)} type="button">이전</button>
            <span>{page + 1} / {totalPages}</span>
            <button disabled={page + 1 >= totalPages || loading} onClick={() => setPage((current) => current + 1)} type="button">다음</button>
          </div>
        ) : null}
      </div>

      {selectedOfferId ? (
        <OfferDetailModal
          decisionBusy={decisionBusy}
          decisionError={decisionError}
          decisionNotice={decisionNotice}
          detail={detail}
          error={detailError}
          loading={detailLoading}
          onAccept={() => void accept()}
          onCancelReject={() => { setShowReject(false); setDecisionError(null); }}
          onClose={closeDetail}
          onReject={(event) => void reject(event)}
          onRejectDetail={setRejectDetail}
          onRejectReason={setRejectReason}
          onShowReject={() => { setShowReject(true); setDecisionError(null); }}
          rejectDetail={rejectDetail}
          rejectReason={rejectReason}
          showReject={showReject}
        />
      ) : null}
    </>
  );
}
