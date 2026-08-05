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
  CancellationReason,
  ClinicalTimelineItem,
  errorMessage,
  HospitalClinicalTimeline,
  HospitalOfferDetail,
  HospitalOfferListItem,
  HospitalOfferLocation,
  hospitalApi,
  OfferStatus,
  OfferView,
  PageResult,
  RejectionReason,
  sessionApi,
  VitalSignMeasurement,
  WithdrawalReason,
} from "../lib/api";
import {
  canReadClinicalTimeline,
  canReadHospitalLocation,
  clearOfferCommand,
  createWithdrawalPayload,
  getOrCreateOfferCommand,
  isClinicalRealtimeType,
  isDestinationRealtimeType,
  isMinimalHospitalOffer,
  isTransportLifecycleRealtimeType,
  shouldRefreshBothOfferLists,
  shouldRefreshSelectedLocation,
  shouldRefreshSelectedOffer,
  shouldRefreshSelectedTimeline,
} from "../lib/hospital-offer-contract.js";

type StreamState = "CONNECTING" | "CONNECTED" | "RECONNECTING";

type RealtimeUpdate = {
  eventId: string;
  type: "TRANSPORT_REQUEST_RECEIVED" | "ETA_UPDATED" | string;
  aggregateType: string;
  aggregateId: string;
  occurredAt: string;
};

type DecisionAction = "accept" | "reject" | "withdraw" | "confirm-handoff";
type OfferSelection = { offer: HospitalOfferListItem; view: OfferView };

const offerStatusLabel: Record<OfferStatus, string> = {
  PENDING: "응답 대기",
  ACCEPTED: "수락",
  REJECTED: "거절",
  NO_RESPONSE: "무응답 종료",
  ACCEPTANCE_WITHDRAWN: "수락 철회",
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

const withdrawalReasonLabel: Record<WithdrawalReason, string> = {
  BED_SHORTAGE: "병상 부족",
  OPERATING_ROOM_SHORTAGE: "수술실 부족",
  SPECIALIST_UNAVAILABLE: "전문의 부재",
  EQUIPMENT_UNAVAILABLE: "장비 사용 불가",
  OTHER: "기타",
};

const cancellationReasonLabel: Record<CancellationReason, string> = {
  PATIENT_REFUSED_TRANSPORT: "환자 이송 거부",
  GUARDIAN_SELF_TRANSPORT: "보호자 직접 이송",
  SCENE_RESOLVED: "현장 상황 해소",
  OTHER: "기타",
};

const enumLabels: Record<string, string> = {
  EXACT: "확인",
  ESTIMATED: "추정",
  UNKNOWN: "미상",
  HANDOFF_REQUESTED: "인계 확인 대기",
  COMPLETED: "인계 완료",
  CANCELLED: "이송 취소",
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

function formatElapsed(start: string | null | undefined, end: string | null | undefined) {
  if (!start || !end) return "-";
  const seconds = Math.max(0, Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return "1분 미만";
  if (minutes < 60) return `${minutes}분`;
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
}

function formatAge(seconds: number | null | undefined) {
  if (seconds == null) return "-";
  if (seconds < 60) return `${Math.max(0, Math.floor(seconds))}초 전`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}분 ${Math.floor(seconds % 60)}초 전`;
}

function formatCoordinate(value: number | null | undefined) {
  return value == null ? "-" : value.toFixed(7);
}

function lastSuccessfulRouteSummary(
  distanceMeters: number | null | undefined,
  etaSeconds: number | null | undefined,
  calculatedAt: string | null | undefined,
) {
  if (distanceMeters == null || etaSeconds == null || !calculatedAt) return null;
  return `${formatDistance(distanceMeters)} · ${formatEta(etaSeconds)} · ${formatDate(calculatedAt)}`;
}

function patientSummary(
  offer: Pick<HospitalOfferListItem, "ageStatus" | "ageYears" | "sex">,
) {
  if (!offer.ageStatus || !offer.sex) return "임상정보 비공개";
  const age =
    offer.ageStatus === "UNKNOWN" || offer.ageYears == null
      ? "나이 미상"
      : `${offer.ageYears}세${offer.ageStatus === "ESTIMATED" ? " 추정" : ""}`;
  return `${age} · ${label(offer.sex)}`;
}

function triageSummary(offer: HospitalOfferListItem) {
  if (!offer.preKtasClassificationStatus) return "최소 응답 이력";
  return offer.preKtasClassificationStatus === "COMPLETED"
    ? `Pre-KTAS ${offer.preKtasLevel ?? "-"}`
    : `긴급 미완료 · ${label(offer.preKtasExceptionReason)}`;
}

function routeSummary(offer: HospitalOfferListItem) {
  if (!offer.routeEstimateStatus) return "거리·ETA 비공개";
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
        <details className="support-details">
          <summary>문의 정보</summary>
          <span>오류 코드 {apiError.code}</span>
          {apiError.traceId ? <span>traceId {apiError.traceId}</span> : null}
        </details>
      ) : null}
    </div>
  );
}

function OfferCard({
  offer,
  view,
  selected,
  onSelect,
}: {
  offer: HospitalOfferListItem;
  view: OfferView;
  selected: boolean;
  onSelect: () => void;
}) {
  const restricted = isMinimalHospitalOffer(
    view,
    offer.offerStatus,
    offer.transportRequestStatus,
  );
  const lastSuccessfulRoute = lastSuccessfulRouteSummary(
    offer.lastSuccessfulRouteDistanceMeters,
    offer.lastSuccessfulEtaSeconds,
    offer.lastSuccessfulEtaCalculatedAt,
  );

  return (
    <button
      aria-pressed={selected}
      className={`offer-card ${selected ? "selected" : ""}`}
      onClick={onSelect}
      type="button"
    >
      <div className="offer-card-statuses">
        <span className={`offer-status offer-status-${offer.offerStatus.toLowerCase()}`}>
          {offerStatusLabel[offer.offerStatus]}
        </span>
        {offer.currentDestination ? (
          <span className="destination-badge">현재 목적지</span>
        ) : null}
        {offer.transportRequestStatus === "HANDOFF_REQUESTED" ? (
          <span className="handoff-badge">인계 확인 대기</span>
        ) : null}
        {offer.transportRequestStatus === "COMPLETED" ? (
          <span className="completed-badge">인계 완료</span>
        ) : null}
        {offer.transportRequestStatus === "CANCELLED" ? (
          <span className="cancelled-badge">이송 취소</span>
        ) : null}
      </div>
      <div className="offer-card-main">
        <strong>
          {restricted
            ? offer.transportRequestStatus === "COMPLETED"
              ? "인계 완료 이력"
              : offer.transportRequestStatus === "CANCELLED"
                ? "이송 취소 이력"
                : offer.offerStatus === "ACCEPTANCE_WITHDRAWN"
              ? "수락 철회 이력"
              : "비목적지 수락 이력"
            : patientSummary(offer)}
        </strong>
        <span>
          {restricted
            ? "환자 임상정보와 회신 정보가 제한됩니다."
            : triageSummary(offer)}
        </span>
      </div>
      <div className="offer-card-route">
        <strong>{restricted ? "최소 응답 이력" : routeSummary(offer)}</strong>
        <span>
          {restricted
            ? offer.canWithdraw
              ? "수락 철회 가능"
              : "임상·연락처·거리 비공개"
            : offer.routeEstimateStatus === "UNAVAILABLE" && lastSuccessfulRoute
              ? `마지막 성공 ${lastSuccessfulRoute}`
            : `직선 ${formatDistance(offer.straightLineDistanceMeters)}`}
        </span>
      </div>
      <div className="offer-card-meta">
        <span>
          {offer.offeredAt
            ? `제안 ${formatDate(offer.offeredAt)}`
            : `응답 ${formatDate(offer.respondedAt)}`}
        </span>
        <span>
          {offer.dispatchAttemptNumber != null
            ? `탐색 ${offer.dispatchAttemptNumber}차`
            : offer.withdrawnAt
              ? `철회 ${formatDate(offer.withdrawnAt)}`
              : "최소 이력"}
        </span>
        {!restricted && offer.lastClinicalUpdateAt ? (
          <span>임상 갱신 {formatDate(offer.lastClinicalUpdateAt)}</span>
        ) : null}
        {offer.handoffRequestedAt ? (
          <span>인계 요청 {formatDate(offer.handoffRequestedAt)}</span>
        ) : null}
        {offer.completedAt ? <span>완료 {formatDate(offer.completedAt)}</span> : null}
        {offer.cancelledAt ? <span>취소 {formatDate(offer.cancelledAt)}</span> : null}
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

const timelineRecordLabel: Record<ClinicalTimelineItem["recordType"], string> = {
  VITAL_SIGNS: "활력징후",
  CONSCIOUSNESS: "의식 상태",
  PRE_KTAS: "Pre-KTAS",
  TREATMENT: "처치",
};

function TimelineRecordContent({ item }: { item: ClinicalTimelineItem }) {
  if (item.recordType === "VITAL_SIGNS" && item.vitalSigns) {
    return (
      <div className="timeline-vitals">
        {item.vitalSigns.measurements.map((measurement) => (
          <span key={measurement.type}>
            <strong>{vitalLabels[measurement.type]}</strong>{" "}
            <VitalValue measurement={measurement} />
          </span>
        ))}
      </div>
    );
  }
  if (item.recordType === "CONSCIOUSNESS" && item.consciousness) {
    return (
      <p>
        {item.consciousness.avpu === "UNASSESSABLE"
          ? `평가 불가 · ${label(item.consciousness.unassessableReason)}`
          : `AVPU ${item.consciousness.avpu}`}
        {item.consciousness.unassessableDetail
          ? ` · ${item.consciousness.unassessableDetail}`
          : ""}
      </p>
    );
  }
  if (item.recordType === "PRE_KTAS" && item.preKtas) {
    return (
      <p>
        {item.preKtas.classificationStatus === "COMPLETED"
          ? `Pre-KTAS ${item.preKtas.level ?? "-"}단계`
          : `긴급 미완료 · ${label(item.preKtas.exceptionReason)}`}
        {item.preKtas.exceptionDetail ? ` · ${item.preKtas.exceptionDetail}` : ""}
        {` · ${item.preKtas.standardVersion}`}
      </p>
    );
  }
  if (item.recordType === "TREATMENT" && item.treatment) {
    return <TreatmentDetails treatment={item.treatment} />;
  }
  return <p>표시할 임상 원본이 없습니다.</p>;
}

function ClinicalTimelinePanel({
  timeline,
  loading,
  error,
  onPage,
}: {
  timeline: HospitalClinicalTimeline | null;
  loading: boolean;
  error: unknown;
  onPage: (page: number) => void;
}) {
  const latest = timeline?.latestSnapshot;
  const totalPages = Math.max(1, timeline?.totalPages ?? 1);

  return (
    <section className="detail-section clinical-timeline-section">
      <div className="detail-section-title">
        <div>
          <h3>이송 중 임상 이력</h3>
          <span>의료 발생 시각 순으로 보존된 원본 기록입니다.</span>
        </div>
        {latest ? <time>최근 수신 {formatDate(latest.lastClinicalUpdateAt)}</time> : null}
      </div>
      {loading ? <div className="inline-loading">임상 이력을 불러오고 있어요…</div> : null}
      <OfferError error={error} />
      {latest ? (
        <div className="clinical-snapshot-summary">
          <div>
            <small>최신 Pre-KTAS</small>
            <strong>
              {latest.preKtas.classificationStatus === "COMPLETED"
                ? `${latest.preKtas.level ?? "-"}단계`
                : "긴급 미완료"}
            </strong>
          </div>
          <div>
            <small>최신 의식</small>
            <strong>
              {latest.consciousness.avpu === "UNASSESSABLE"
                ? "평가 불가"
                : `AVPU ${latest.consciousness.avpu}`}
            </strong>
          </div>
          <div>
            <small>최신 활력 측정</small>
            <strong>{formatDate(latest.vitalSigns.measuredAt)}</strong>
          </div>
          <div>
            <small>현재 처치 기록</small>
            <strong>{latest.treatments.length}건</strong>
          </div>
        </div>
      ) : null}
      {timeline && !timeline.items.length ? (
        <div className="timeline-empty">추가된 이송 중 임상 기록이 없습니다.</div>
      ) : null}
      {timeline?.items.length ? (
        <ol className="clinical-timeline-list">
          {timeline.items.map((item) => (
            <li key={item.recordId}>
              <div className="timeline-marker" aria-hidden="true" />
              <article>
                <header>
                  <strong>{timelineRecordLabel[item.recordType]}</strong>
                  <time>의료 발생 {formatDate(item.clinicalAt)}</time>
                </header>
                <TimelineRecordContent item={item} />
                <small>
                  입력 {formatDate(item.enteredAt)} · 서버 수신 {formatDate(item.serverReceivedAt)}
                </small>
              </article>
            </li>
          ))}
        </ol>
      ) : null}
      {timeline && timeline.totalPages > 1 ? (
        <div className="offer-pagination timeline-pagination">
          <button
            disabled={loading || timeline.page <= 0}
            onClick={() => onPage(timeline.page - 1)}
            type="button"
          >
            이전
          </button>
          <span>{timeline.page + 1} / {totalPages}</span>
          <button
            disabled={loading || timeline.page + 1 >= totalPages}
            onClick={() => onPage(timeline.page + 1)}
            type="button"
          >
            다음
          </button>
        </div>
      ) : null}
    </section>
  );
}

function AmbulanceLocationPanel({
  location,
  loading,
  error,
}: {
  location: HospitalOfferLocation | null;
  loading: boolean;
  error: unknown;
}) {
  const lastSuccessful = location
    ? lastSuccessfulRouteSummary(
        location.lastSuccessfulRouteDistanceMeters,
        location.lastSuccessfulEtaSeconds,
        location.lastSuccessfulEtaCalculatedAt,
      )
    : null;

  return (
    <section className="detail-section ambulance-location-section">
      <div className="detail-section-title">
        <div>
          <h3>현재 구급차 위치</h3>
          <span>현재 목적지 병원에만 공개되는 정확한 위치입니다.</span>
        </div>
        <span className="location-auto-refresh">10초마다 서버 상태 확인</span>
      </div>
      {loading && !location ? (
        <div className="inline-loading">최신 위치를 확인하고 있어요…</div>
      ) : null}
      <OfferError error={error} />
      {location?.freshness === "NOT_RECEIVED" ? (
        <div className="location-empty">
          <strong>아직 수신된 위치가 없습니다.</strong>
          <span>위치 갱신 신호가 오거나 다음 서버 확인 때 다시 조회합니다.</span>
        </div>
      ) : null}
      {location && location.freshness !== "NOT_RECEIVED" ? (
        <>
          <div className={`location-freshness location-${location.freshness.toLowerCase()}`}>
            <strong>{location.freshness === "CURRENT" ? "최신 위치" : "오래된 위치"}</strong>
            <span>서버 수신 {formatAge(location.ageSeconds)}</span>
          </div>
          <dl className="location-grid">
            <div><dt>위도</dt><dd>{formatCoordinate(location.latitude)}</dd></div>
            <div><dt>경도</dt><dd>{formatCoordinate(location.longitude)}</dd></div>
            <div><dt>GPS 측정</dt><dd>{formatDate(location.capturedAt)}</dd></div>
            <div><dt>서버 수신</dt><dd>{formatDate(location.lastReceivedAt)}</dd></div>
          </dl>
          {location.freshness === "STALE" ? (
            <p className="location-warning">
              30초 이상 새 위치가 수신되지 않았습니다. 마지막 좌표는 유지하되 현재 위치로 단정하지 않습니다.
            </p>
          ) : null}
        </>
      ) : null}
      {location && location.routeEstimateStatus ? (
        <div className="location-route-card">
          <div>
            <small>현재 ETA 상태</small>
            <strong>
              {location.routeEstimateStatus === "CALCULATING"
                ? "계산 중"
                : location.routeEstimateStatus === "UNAVAILABLE"
                  ? "계산할 수 없음"
                  : `${formatDistance(location.routeDistanceMeters)} · ${formatEta(location.etaSeconds)}`}
            </strong>
          </div>
          {location.routeEstimateStatus === "AVAILABLE" ? (
            <time>계산 {formatDate(location.etaCalculatedAt)}</time>
          ) : null}
          {location.routeEstimateStatus !== "AVAILABLE" && lastSuccessful ? (
            <div className="last-successful-route">
              <small>마지막 성공 계산</small>
              <strong>{lastSuccessful}</strong>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function WithdrawalForm({
  decisionBusy,
  reason,
  detail,
  onCancel,
  onReason,
  onDetail,
  onSubmit,
}: {
  decisionBusy: DecisionAction | null;
  reason: WithdrawalReason | "";
  detail: string;
  onCancel: () => void;
  onReason: (reason: WithdrawalReason | "") => void;
  onDetail: (detail: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form className="reject-form withdrawal-form" onSubmit={onSubmit}>
      <div className="detail-section-title">
        <h3>수락 철회 사유</h3>
      </div>
      <p className="withdrawal-warning">
        현재 목적지 병원이 철회하면 목적지가 해제되고 병원 탐색이 다시 시작될 수
        있습니다.
      </p>
      <label>
        <span>사유</span>
        <select
          onChange={(event) =>
            onReason(event.target.value as WithdrawalReason | "")
          }
          required
          value={reason}
        >
          <option value="">선택해 주세요</option>
          {(Object.keys(withdrawalReasonLabel) as WithdrawalReason[]).map(
            (withdrawalReason) => (
              <option key={withdrawalReason} value={withdrawalReason}>
                {withdrawalReasonLabel[withdrawalReason]}
              </option>
            ),
          )}
        </select>
      </label>
      {reason === "OTHER" ? (
        <label>
          <span>기타 상세 사유</span>
          <textarea
            maxLength={200}
            onChange={(event) => onDetail(event.target.value)}
            placeholder="공백이 아닌 상세 사유를 입력해 주세요."
            required
            value={detail}
          />
          <small>{detail.length}/200</small>
        </label>
      ) : null}
      <div className="decision-actions">
        <button
          className="button button-muted"
          disabled={decisionBusy !== null}
          onClick={onCancel}
          type="button"
        >
          취소
        </button>
        <button
          className="button button-danger"
          disabled={
            decisionBusy !== null ||
            !reason ||
            (reason === "OTHER" && !detail.trim())
          }
          type="submit"
        >
          {decisionBusy === "withdraw" ? "철회 처리 중…" : "수락 철회 확정"}
        </button>
      </div>
    </form>
  );
}

function MinimalHistoryModal({
  offer,
  decisionBusy,
  decisionError,
  decisionNotice,
  showWithdrawal,
  withdrawalReason,
  withdrawalDetail,
  onClose,
  onShowWithdrawal,
  onCancelWithdrawal,
  onWithdrawalReason,
  onWithdrawalDetail,
  onWithdraw,
}: {
  offer: HospitalOfferListItem;
  decisionBusy: DecisionAction | null;
  decisionError: unknown;
  decisionNotice: string | null;
  showWithdrawal: boolean;
  withdrawalReason: WithdrawalReason | "";
  withdrawalDetail: string;
  onClose: () => void;
  onShowWithdrawal: () => void;
  onCancelWithdrawal: () => void;
  onWithdrawalReason: (reason: WithdrawalReason | "") => void;
  onWithdrawalDetail: (detail: string) => void;
  onWithdraw: (event: FormEvent) => void;
}) {
  const transportEnded =
    offer.transportRequestStatus === "COMPLETED" ||
    offer.transportRequestStatus === "CANCELLED";
  const historyTitle =
    offer.transportRequestStatus === "COMPLETED"
      ? "인계 완료 이력"
      : offer.transportRequestStatus === "CANCELLED"
        ? "이송 취소 이력"
        : offer.offerStatus === "ACCEPTANCE_WITHDRAWN"
          ? "수락 철회 이력"
          : "비목적지 수락 이력";

  return (
    <div className="offer-modal-backdrop" onMouseDown={onClose}>
      <section
        aria-labelledby="minimal-history-title"
        aria-modal="true"
        className="offer-modal offer-modal-compact"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="offer-modal-header">
          <div>
            <span className="eyebrow">병원 응답 최소 이력</span>
            <h2 id="minimal-history-title">{historyTitle}</h2>
          </div>
          <button
            aria-label="이력 닫기"
            className="modal-close"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>
        <div className="offer-detail-body">
          <div className="minimal-history-summary">
            <span className={`offer-status offer-status-${offer.offerStatus.toLowerCase()}`}>
              {offerStatusLabel[offer.offerStatus]}
            </span>
            <dl>
              <div>
                <dt>요청 상태</dt>
                <dd>{label(offer.transportRequestStatus)}</dd>
              </div>
              <div>
                <dt>응답 시각</dt>
                <dd>{formatDate(offer.respondedAt)}</dd>
              </div>
              {offer.withdrawnAt ? (
                <div>
                  <dt>철회 시각</dt>
                  <dd>{formatDate(offer.withdrawnAt)}</dd>
                </div>
              ) : null}
              {offer.handoffRequestedAt ? (
                <div>
                  <dt>인계 요청 시각</dt>
                  <dd>{formatDate(offer.handoffRequestedAt)}</dd>
                </div>
              ) : null}
              {offer.completedAt ? (
                <div>
                  <dt>인계 완료 시각</dt>
                  <dd>{formatDate(offer.completedAt)}</dd>
                </div>
              ) : null}
              {offer.cancelledAt ? (
                <div>
                  <dt>이송 취소 시각</dt>
                  <dd>{formatDate(offer.cancelledAt)}</dd>
                </div>
              ) : null}
              {offer.cancellationReason ? (
                <div>
                  <dt>취소 사유</dt>
                  <dd>{cancellationReasonLabel[offer.cancellationReason]}</dd>
                </div>
              ) : null}
            </dl>
          </div>

          <div className="privacy-restriction-card">
            <strong>
              {transportEnded
                ? "종료된 이송은 최소 상태 이력만 제공됩니다."
                : "목적지 병원이 아닌 조직에는 최소 이력만 제공됩니다."}
            </strong>
            <span>
              환자 임상정보, 구급대원 연락처, 거리·ETA와 정확한 위치는 조회하지
              않습니다.
            </span>
          </div>

          {offer.withdrawalReason ? (
            <section className="detail-section rejection-result">
              <div className="detail-section-title">
                <h3>수락 철회 사유</h3>
              </div>
              <strong>{withdrawalReasonLabel[offer.withdrawalReason]}</strong>
              {offer.withdrawalDetail ? <p>{offer.withdrawalDetail}</p> : null}
            </section>
          ) : null}

          {decisionNotice ? (
            <div className="decision-notice" role="status">
              {decisionNotice}
            </div>
          ) : null}
          <OfferError error={decisionError} />

          {offer.canWithdraw && !transportEnded ? (
            showWithdrawal ? (
              <WithdrawalForm
                decisionBusy={decisionBusy}
                detail={withdrawalDetail}
                onCancel={onCancelWithdrawal}
                onDetail={onWithdrawalDetail}
                onReason={onWithdrawalReason}
                onSubmit={onWithdraw}
                reason={withdrawalReason}
              />
            ) : (
              <div className="decision-actions decision-actions-primary">
                <button
                  className="button button-danger"
                  disabled={decisionBusy !== null}
                  onClick={onShowWithdrawal}
                  type="button"
                >
                  수락 철회
                </button>
              </div>
            )
          ) : null}
        </div>
      </section>
    </div>
  );
}

function OfferDetailModal({
  detail,
  loading,
  error,
  timeline,
  timelineLoading,
  timelineError,
  location,
  locationLoading,
  locationError,
  decisionBusy,
  decisionError,
  decisionNotice,
  showReject,
  showWithdrawal,
  rejectReason,
  rejectDetail,
  withdrawalReason,
  withdrawalDetail,
  onClose,
  onAccept,
  onConfirmHandoff,
  onShowReject,
  onCancelReject,
  onRejectReason,
  onRejectDetail,
  onReject,
  onShowWithdrawal,
  onCancelWithdrawal,
  onWithdrawalReason,
  onWithdrawalDetail,
  onWithdraw,
  onTimelinePage,
}: {
  detail: HospitalOfferDetail | null;
  loading: boolean;
  error: unknown;
  timeline: HospitalClinicalTimeline | null;
  timelineLoading: boolean;
  timelineError: unknown;
  location: HospitalOfferLocation | null;
  locationLoading: boolean;
  locationError: unknown;
  decisionBusy: DecisionAction | null;
  decisionError: unknown;
  decisionNotice: string | null;
  showReject: boolean;
  showWithdrawal: boolean;
  rejectReason: RejectionReason | "";
  rejectDetail: string;
  withdrawalReason: WithdrawalReason | "";
  withdrawalDetail: string;
  onClose: () => void;
  onAccept: () => void;
  onConfirmHandoff: () => void;
  onShowReject: () => void;
  onCancelReject: () => void;
  onRejectReason: (reason: RejectionReason | "") => void;
  onRejectDetail: (detail: string) => void;
  onReject: (event: FormEvent) => void;
  onShowWithdrawal: () => void;
  onCancelWithdrawal: () => void;
  onWithdrawalReason: (reason: WithdrawalReason | "") => void;
  onWithdrawalDetail: (detail: string) => void;
  onWithdraw: (event: FormEvent) => void;
  onTimelinePage: (page: number) => void;
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
              <div className="offer-detail-statuses">
                <span className={`offer-status offer-status-${detail.offerStatus.toLowerCase()}`}>
                  {offerStatusLabel[detail.offerStatus]}
                </span>
                {detail.currentDestination ? (
                  <span className="destination-badge">현재 목적지</span>
                ) : null}
              </div>
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

            {detail.handoffRequestedAt ? (
              <section className="detail-section handoff-confirmation-section">
                <div className="detail-section-title">
                  <h3>환자 인계 요청</h3>
                  <time>요청 {formatDate(detail.handoffRequestedAt)}</time>
                </div>
                <p>
                  구급대원이 현재 목적지 병원에 환자 인계를 요청했습니다. 실제
                  인계가 끝난 뒤에만 확인해 주세요.
                </p>
              </section>
            ) : null}

            <section className="detail-section">
              <div className="detail-section-title">
                <h3>환자·발생 정보</h3>
                <div className="detail-times">
                  <time>접수 {formatDate(detail.timing.requestReceivedAt)}</time>
                  <time>임상 갱신 {formatDate(detail.timing.lastClinicalUpdateAt)}</time>
                </div>
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

            {detail.offerStatus === "PENDING" || detail.offerStatus === "ACCEPTED" ? (
              <ClinicalTimelinePanel
                error={timelineError}
                loading={timelineLoading}
                onPage={onTimelinePage}
                timeline={timeline}
              />
            ) : null}

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
              {detail.route.status !== "AVAILABLE" &&
              detail.route.lastSuccessfulRouteDistanceMeters != null &&
              detail.route.lastSuccessfulEtaSeconds != null &&
              detail.route.lastSuccessfulCalculatedAt ? (
                <div className="last-successful-route detail-last-successful-route">
                  <small>마지막 성공 계산</small>
                  <strong>
                    {lastSuccessfulRouteSummary(
                      detail.route.lastSuccessfulRouteDistanceMeters,
                      detail.route.lastSuccessfulEtaSeconds,
                      detail.route.lastSuccessfulCalculatedAt,
                    )}
                  </strong>
                </div>
              ) : null}
            </section>

            {detail.offerStatus === "ACCEPTED" && detail.currentDestination ? (
              <AmbulanceLocationPanel
                error={locationError}
                loading={locationLoading}
                location={location}
              />
            ) : null}

            {detail.rejectionReason ? (
              <section className="detail-section rejection-result">
                <div className="detail-section-title"><h3>거절 사유</h3></div>
                <strong>{rejectionReasonLabel[detail.rejectionReason]}</strong>
                {detail.rejectionDetail ? <p>{detail.rejectionDetail}</p> : null}
                <time>응답 {formatDate(detail.respondedAt)}</time>
              </section>
            ) : null}

            {detail.withdrawalReason ? (
              <section className="detail-section rejection-result">
                <div className="detail-section-title">
                  <h3>수락 철회 사유</h3>
                </div>
                <strong>{withdrawalReasonLabel[detail.withdrawalReason]}</strong>
                {detail.withdrawalDetail ? <p>{detail.withdrawalDetail}</p> : null}
                <time>철회 {formatDate(detail.withdrawnAt)}</time>
              </section>
            ) : null}

            {decisionNotice ? <div className="decision-notice" role="status">{decisionNotice}</div> : null}
            <OfferError error={decisionError} />

            {detail.canConfirmHandoff ? (
              <div className="decision-actions decision-actions-primary handoff-actions">
                <button
                  className="button button-primary"
                  disabled={decisionBusy !== null}
                  onClick={onConfirmHandoff}
                  type="button"
                >
                  {decisionBusy === "confirm-handoff"
                    ? "인계 확인 중…"
                    : decisionError
                      ? "같은 인계 확인 다시 시도"
                      : "환자 인계 완료 확인"}
                </button>
              </div>
            ) : detail.canWithdraw ? (
              showWithdrawal ? (
                <WithdrawalForm
                  decisionBusy={decisionBusy}
                  detail={withdrawalDetail}
                  onCancel={onCancelWithdrawal}
                  onDetail={onWithdrawalDetail}
                  onReason={onWithdrawalReason}
                  onSubmit={onWithdraw}
                  reason={withdrawalReason}
                />
              ) : (
                <div className="decision-actions decision-actions-primary">
                  <button
                    className="button button-danger"
                    disabled={decisionBusy !== null}
                    onClick={onShowWithdrawal}
                    type="button"
                  >
                    수락 철회
                  </button>
                </div>
              )
            ) : detail.offerStatus === "PENDING" ? (
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

function DashboardOfferDetail({
  selectedOffer,
  detail,
  loading,
  error,
  decisionBusy,
  decisionError,
  decisionNotice,
  onAccept,
  onReject,
  onOpenFull,
}: {
  selectedOffer: HospitalOfferListItem | null;
  detail: HospitalOfferDetail | null;
  loading: boolean;
  error: unknown;
  decisionBusy: DecisionAction | null;
  decisionError: unknown;
  decisionNotice: string | null;
  onAccept: () => void;
  onReject: () => void;
  onOpenFull: () => void;
}) {
  if (!selectedOffer) {
    return (
      <section className="offer-primary offer-primary-empty">
        <div className="empty-symbol">ER</div>
        <strong>확인할 이송 요청을 선택해 주세요</strong>
        <span>오른쪽 목록에서 요청을 선택하면 환자 상태와 예상 도착 시간을 볼 수 있습니다.</span>
      </section>
    );
  }

  const restricted = !detail && !loading && !error;

  return (
    <section className="offer-primary">
      {loading ? (
        <div className="offer-primary-loading">환자 정보를 안전하게 불러오고 있어요…</div>
      ) : null}
      <OfferError error={error} />

      {restricted ? (
        <div className="offer-history-summary">
          <span className={`offer-status offer-status-${selectedOffer.offerStatus.toLowerCase()}`}>
            {offerStatusLabel[selectedOffer.offerStatus]}
          </span>
          <h1>
            {selectedOffer.transportRequestStatus === "COMPLETED"
              ? "인계 완료 이력"
              : selectedOffer.transportRequestStatus === "CANCELLED"
                ? "이송 취소 이력"
                : "종료된 병원 응답"}
          </h1>
          <p>종료된 요청은 환자 임상정보와 회신 연락처가 보호되어 최소 정보만 표시됩니다.</p>
          <dl>
            <div><dt>응답 상태</dt><dd>{offerStatusLabel[selectedOffer.offerStatus]}</dd></div>
            <div><dt>이송 상태</dt><dd>{label(selectedOffer.transportRequestStatus)}</dd></div>
            <div><dt>처리 시각</dt><dd>{formatDate(selectedOffer.completedAt || selectedOffer.cancelledAt || selectedOffer.respondedAt)}</dd></div>
          </dl>
          {selectedOffer.canWithdraw ? (
            <button className="button button-danger" onClick={onOpenFull} type="button">
              수락 철회 검토
            </button>
          ) : null}
        </div>
      ) : null}

      {detail ? (
        <>
          <header className="patient-hero">
            <div className={`ktas-badge ktas-${detail.preKtas.level ?? "unknown"}`}>
              <small>Pre-KTAS</small>
              <strong>{detail.preKtas.level ?? "-"}</strong>
            </div>
            <div className="patient-hero-copy">
              <div className="patient-status-row">
                <span className={`offer-status offer-status-${detail.offerStatus.toLowerCase()}`}>
                  {offerStatusLabel[detail.offerStatus]}
                </span>
                {detail.currentDestination ? <span className="destination-badge">현재 목적지</span> : null}
                {detail.canConfirmHandoff ? <span className="handoff-badge">인계 확인 필요</span> : null}
              </div>
              <h1>{label(detail.incident.primarySymptom)}</h1>
              <p>
                {detail.incident.primarySymptomDetail || label(detail.incident.occurrenceType)}
              </p>
            </div>
            <div className="patient-hero-meta">
              <span>접수 {formatDate(detail.timing.requestReceivedAt)}</span>
              <strong>{patientSummary(detail.patient)}</strong>
            </div>
          </header>

          <div className="transport-metrics">
            <div>
              <small>예상 도착</small>
              <strong>{formatEta(detail.route.etaSeconds)}</strong>
              <span>{detail.route.status === "CALCULATING" ? "경로 계산 중" : "도로 기준"}</span>
            </div>
            <div>
              <small>요청 경과</small>
              <strong>{formatElapsed(detail.timing.requestReceivedAt, detail.serverNow)}</strong>
              <span>서버 시각 기준</span>
            </div>
            <div>
              <small>이송 거리</small>
              <strong>{formatDistance(detail.route.routeDistanceMeters ?? detail.route.straightLineDistanceMeters)}</strong>
              <span>{detail.route.routeDistanceMeters != null ? "도로 기준" : "직선 기준"}</span>
            </div>
          </div>

          <section className="dashboard-clinical-section">
            <div className="dashboard-section-title">
              <div><span>최신 환자 상태</span><h2>활력징후</h2></div>
              <time>{formatDate(detail.vitalSigns.measuredAt)}</time>
            </div>
            <div className="dashboard-vitals">
              {detail.vitalSigns.measurements.map((measurement) => (
                <div className={`dashboard-vital vital-state-${measurement.state.toLowerCase()}`} key={measurement.type}>
                  <span>{vitalLabels[measurement.type]}</span>
                  <strong><VitalValue measurement={measurement} /></strong>
                </div>
              ))}
              <div className="dashboard-vital">
                <span>의식 상태</span>
                <strong>{detail.consciousness.avpu === "UNASSESSABLE" ? "평가 불가" : `AVPU ${detail.consciousness.avpu}`}</strong>
              </div>
            </div>
          </section>

          <div className="dashboard-detail-grid">
            <section>
              <div className="dashboard-section-title"><div><span>현장 기록</span><h2>시행 처치</h2></div></div>
              <div className="dashboard-treatment-list">
                {detail.treatments.length ? detail.treatments.map((treatment, index) => (
                  <span key={`${treatment.type}-${index}`}>{label(treatment.type)}</span>
                )) : <p>기록된 처치가 없습니다.</p>}
              </div>
            </section>
            <section>
              <div className="dashboard-section-title"><div><span>요청 기관</span><h2>구급대 회신 정보</h2></div></div>
              <dl className="requester-summary">
                <div><dt>소속</dt><dd>{detail.requester.organizationName}</dd></div>
                <div><dt>연락처</dt><dd>{detail.requester.callbackContact}</dd></div>
              </dl>
            </section>
          </div>

          {decisionNotice ? <div className="decision-notice" role="status">{decisionNotice}</div> : null}
          <OfferError error={decisionError} />

          <div className="dashboard-decision-bar">
            <button className="button button-muted" onClick={onOpenFull} type="button">
              전체 정보 보기
            </button>
            {detail.offerStatus === "PENDING" ? (
              <>
                <button className="button button-danger" disabled={decisionBusy !== null} onClick={onReject} type="button">
                  수용 어려움
                </button>
                <button className="button button-primary" disabled={decisionBusy !== null} onClick={onAccept} type="button">
                  수용 가능
                </button>
              </>
            ) : detail.canConfirmHandoff ? (
              <button className="button button-primary" onClick={onOpenFull} type="button">환자 인계 확인</button>
            ) : detail.canWithdraw ? (
              <button className="button button-danger" onClick={onOpenFull} type="button">수락 철회 검토</button>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

export function HospitalOffers({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [view, setView] = useState<OfferView>("ACTIVE");
  const [activeFilter, setActiveFilter] = useState<"PENDING" | "ACCEPTED">("PENDING");
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<PageResult<HospitalOfferListItem> | null>(null);
  const [activeTotal, setActiveTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [selectedOffer, setSelectedOffer] =
    useState<HospitalOfferListItem | null>(null);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [detail, setDetail] = useState<HospitalOfferDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<unknown>(null);
  const [timelinePage, setTimelinePage] = useState(0);
  const [timeline, setTimeline] = useState<HospitalClinicalTimeline | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<unknown>(null);
  const [location, setLocation] = useState<HospitalOfferLocation | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState<unknown>(null);
  const [selectedOfferView, setSelectedOfferView] = useState<OfferView | null>(null);
  const [decisionBusy, setDecisionBusy] = useState<DecisionAction | null>(null);
  const [decisionError, setDecisionError] = useState<unknown>(null);
  const [decisionNotice, setDecisionNotice] = useState<string | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [showWithdrawal, setShowWithdrawal] = useState(false);
  const [showFullDetail, setShowFullDetail] = useState(false);
  const [showAcceptConfirm, setShowAcceptConfirm] = useState(false);
  const [rejectReason, setRejectReason] = useState<RejectionReason | "">("");
  const [rejectDetail, setRejectDetail] = useState("");
  const [withdrawalReason, setWithdrawalReason] = useState<
    WithdrawalReason | ""
  >("");
  const [withdrawalDetail, setWithdrawalDetail] = useState("");
  const [streamState, setStreamState] = useState<StreamState>("CONNECTING");
  const protectedDataGenerationRef = useRef(0);
  const locationRequestInFlightRef = useRef(false);
  const realtimeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const currentRef = useRef({
    view,
    page,
    timelinePage,
    selectedOfferId,
    selectedOfferKey: selectedOffer?.offerId ?? null,
    selectedOfferView,
    selectedTransportRequestId: selectedOffer?.transportRequestId ?? null,
    selectedOfferStatus: selectedOffer?.offerStatus ?? null,
    selectedCurrentDestination: selectedOffer?.currentDestination ?? false,
  });
  const expiredRef = useRef(onSessionExpired);

  useEffect(() => {
    currentRef.current = {
      view,
      page,
      timelinePage,
      selectedOfferId,
      selectedOfferKey: selectedOffer?.offerId ?? null,
      selectedOfferView,
      selectedTransportRequestId: selectedOffer?.transportRequestId ?? null,
      selectedOfferStatus: selectedOffer?.offerStatus ?? null,
      selectedCurrentDestination: selectedOffer?.currentDestination ?? false,
    };
    expiredRef.current = onSessionExpired;
  }, [
    onSessionExpired,
    page,
    selectedOffer?.currentDestination,
    selectedOffer?.offerId,
    selectedOffer?.offerStatus,
    selectedOffer?.transportRequestId,
    selectedOfferId,
    selectedOfferView,
    timelinePage,
    view,
  ]);

  const clearProtectedData = useCallback(() => {
    protectedDataGenerationRef.current += 1;
    locationRequestInFlightRef.current = false;
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
    setTimeline(null);
    setTimelineError(null);
    setTimelineLoading(false);
    setLocation(null);
    setLocationError(null);
    setLocationLoading(false);
  }, []);

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

  const refreshBoth = useCallback(async (): Promise<OfferSelection | null> => {
    setLoading(true);
    setError(null);
    try {
      const [active, history] = await Promise.all([
        hospitalApi.offers("ACTIVE", 0, 20),
        hospitalApi.offers("HISTORY", 0, 20),
      ]);
      setActiveTotal(active.totalElements);
      setResult(currentRef.current.view === "ACTIVE" ? active : history);
      const selectedOfferKey = currentRef.current.selectedOfferKey;
      if (selectedOfferKey) {
        const activeOffer = active.items.find(
          (offer) => offer.offerId === selectedOfferKey,
        );
        const historyOffer = history.items.find(
          (offer) => offer.offerId === selectedOfferKey,
        );
        const refreshedSelection = activeOffer
          ? { offer: activeOffer, view: "ACTIVE" as const }
          : historyOffer
            ? { offer: historyOffer, view: "HISTORY" as const }
            : null;
        setSelectedOffer(refreshedSelection?.offer ?? null);
        setSelectedOfferView(refreshedSelection?.view ?? null);
        setPage(0);
        return refreshedSelection;
      }
      setPage(0);
      return null;
    } catch (nextError) {
      setError(nextError);
      if (isSessionError(nextError)) expiredRef.current();
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (offerId: string) => {
    const generation = protectedDataGenerationRef.current;
    setDetailLoading(true);
    setDetailError(null);
    try {
      const next = await hospitalApi.offerDetail(offerId);
      if (generation === protectedDataGenerationRef.current) setDetail(next);
    } catch (nextError) {
      if (generation === protectedDataGenerationRef.current) {
        setDetailError(nextError);
      }
      if (isSessionError(nextError)) expiredRef.current();
      if (nextError instanceof ApiError && nextError.code === "TRANSPORT_005") {
        setSelectedOffer(null);
        setSelectedOfferView(null);
        setSelectedOfferId(null);
        clearProtectedData();
        await refreshBoth();
      }
    } finally {
      if (generation === protectedDataGenerationRef.current) {
        setDetailLoading(false);
      }
    }
  }, [clearProtectedData, refreshBoth]);

  const loadTimeline = useCallback(async (offerId: string, targetPage: number) => {
    const generation = protectedDataGenerationRef.current;
    setTimelineLoading(true);
    setTimelineError(null);
    try {
      const next = await hospitalApi.clinicalTimeline(offerId, targetPage, 50);
      if (generation === protectedDataGenerationRef.current) {
        setTimeline(next);
        setTimelinePage(next.page);
      }
    } catch (nextError) {
      if (generation === protectedDataGenerationRef.current) {
        setTimelineError(nextError);
        setTimeline(null);
      }
      if (isSessionError(nextError)) expiredRef.current();
      if (nextError instanceof ApiError && nextError.code === "TRANSPORT_005") {
        setSelectedOffer(null);
        setSelectedOfferView(null);
        setSelectedOfferId(null);
        clearProtectedData();
        await refreshBoth();
      }
    } finally {
      if (generation === protectedDataGenerationRef.current) {
        setTimelineLoading(false);
      }
    }
  }, [clearProtectedData, refreshBoth]);

  const loadLocation = useCallback(async (offerId: string) => {
    if (locationRequestInFlightRef.current) return;
    const generation = protectedDataGenerationRef.current;
    locationRequestInFlightRef.current = true;
    setLocationLoading(true);
    setLocationError(null);
    try {
      const next = await hospitalApi.offerLocation(offerId);
      if (generation === protectedDataGenerationRef.current) setLocation(next);
    } catch (nextError) {
      if (generation === protectedDataGenerationRef.current) {
        setLocationError(nextError);
        setLocation(null);
      }
      if (isSessionError(nextError)) expiredRef.current();
      if (nextError instanceof ApiError && nextError.code === "TRANSPORT_005") {
        setSelectedOffer(null);
        setSelectedOfferView(null);
        setSelectedOfferId(null);
        clearProtectedData();
        await refreshBoth();
      }
    } finally {
      if (generation === protectedDataGenerationRef.current) {
        locationRequestInFlightRef.current = false;
        setLocationLoading(false);
      }
    }
  }, [clearProtectedData, refreshBoth]);

  const loadSelectedResources = useCallback(async (
    selection: OfferSelection,
    targetTimelinePage = 0,
  ) => {
    const { offer, view: offerView } = selection;
    setSelectedOffer(offer);
    setSelectedOfferView(offerView);
    if (
      isMinimalHospitalOffer(
        offerView,
        offer.offerStatus,
        offer.transportRequestStatus,
      )
    ) {
      setSelectedOfferId(null);
      clearProtectedData();
      return;
    }

    setSelectedOfferId(offer.offerId);
    const tasks: Promise<void>[] = [loadDetail(offer.offerId)];
    if (
      canReadClinicalTimeline(
        offerView,
        offer.offerStatus,
        offer.transportRequestStatus,
      )
    ) {
      tasks.push(loadTimeline(offer.offerId, targetTimelinePage));
    } else {
      setTimeline(null);
      setTimelineError(null);
    }
    if (
      canReadHospitalLocation(
        offer.offerStatus,
        offer.currentDestination,
        offer.transportRequestStatus,
      )
    ) {
      tasks.push(loadLocation(offer.offerId));
    } else {
      setLocation(null);
      setLocationError(null);
    }
    await Promise.all(tasks);
  }, [clearProtectedData, loadDetail, loadLocation, loadTimeline]);

  const refreshVisibleSelection = useCallback(async () => {
    const hadSelection = Boolean(currentRef.current.selectedOfferKey);
    if (hadSelection) clearProtectedData();
    const refreshedSelection = await refreshBoth();
    if (!hadSelection) return;
    if (!refreshedSelection) {
      setSelectedOffer(null);
      setSelectedOfferView(null);
      setSelectedOfferId(null);
      clearProtectedData();
      return;
    }
    await loadSelectedResources(
      refreshedSelection,
      currentRef.current.timelinePage,
    );
  }, [clearProtectedData, loadSelectedResources, refreshBoth]);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => void loadOffers(view, page), 0);
    return () => window.clearTimeout(loadTimer);
  }, [loadOffers, page, view]);

  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState !== "visible") return;
      void refreshVisibleSelection();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refreshVisibleSelection]);

  const handleRealtimeUpdate = useCallback(async (update: RealtimeUpdate) => {
    if (
      isDestinationRealtimeType(update.type) ||
      isTransportLifecycleRealtimeType(update.type)
    ) {
      await refreshVisibleSelection();
      return;
    }

    const beforeRefresh = currentRef.current;
    let refreshedSelection: OfferSelection | null = null;
    if (shouldRefreshBothOfferLists(update.type)) {
      refreshedSelection = await refreshBoth();
      if (beforeRefresh.selectedOfferKey && !refreshedSelection) {
        setSelectedOfferId(null);
        clearProtectedData();
        return;
      }
    }

    const selectedOfferId =
      refreshedSelection?.offer.offerId ?? beforeRefresh.selectedOfferKey;
    const selectedRequestId =
      refreshedSelection?.offer.transportRequestId ??
      beforeRefresh.selectedTransportRequestId;

    if (
      isClinicalRealtimeType(update.type) &&
      refreshedSelection &&
      shouldRefreshSelectedOffer(
        update.type,
        update.aggregateId,
        selectedOfferId,
        selectedRequestId,
      )
    ) {
      await loadSelectedResources(
        refreshedSelection,
        currentRef.current.timelinePage,
      );
      return;
    }

    if (
      update.type === "ETA_UPDATED" &&
      refreshedSelection &&
      shouldRefreshSelectedOffer(
        update.type,
        update.aggregateId,
        selectedOfferId,
        selectedRequestId,
      )
    ) {
      setSelectedOffer(refreshedSelection.offer);
      setSelectedOfferView(refreshedSelection.view);
      await loadDetail(refreshedSelection.offer.offerId);
      if (
        canReadHospitalLocation(
          refreshedSelection.offer.offerStatus,
          refreshedSelection.offer.currentDestination,
          refreshedSelection.offer.transportRequestStatus,
        )
      ) {
        await loadLocation(refreshedSelection.offer.offerId);
      }
      return;
    }

    if (
      selectedOfferId &&
      beforeRefresh.selectedCurrentDestination &&
      shouldRefreshSelectedLocation(
        update.type,
        update.aggregateId,
        selectedOfferId,
        selectedRequestId,
      )
    ) {
      await loadLocation(selectedOfferId);
    }

    if (
      selectedOfferId &&
      shouldRefreshSelectedTimeline(
        update.type,
        update.aggregateId,
        selectedRequestId,
      )
    ) {
      await loadTimeline(selectedOfferId, currentRef.current.timelinePage);
    }
  }, [
    clearProtectedData,
    loadDetail,
    loadLocation,
    loadSelectedResources,
    loadTimeline,
    refreshBoth,
    refreshVisibleSelection,
  ]);

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
        void refreshVisibleSelection();
      };
      source.addEventListener("update", (event) => {
        let update: RealtimeUpdate | null = null;
        try {
          update = JSON.parse((event as MessageEvent<string>).data) as RealtimeUpdate;
        } catch {
          return;
        }
        realtimeQueueRef.current = realtimeQueueRef.current
          .then(() => handleRealtimeUpdate(update))
          .catch(() => undefined);
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
          await refreshVisibleSelection();
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
  }, [handleRealtimeUpdate, refreshVisibleSelection]);

  useEffect(() => {
    if (
      !selectedOffer ||
      !canReadHospitalLocation(
        selectedOffer.offerStatus,
        selectedOffer.currentDestination,
        selectedOffer.transportRequestStatus,
      )
    ) {
      return;
    }
    const offerId = selectedOffer.offerId;
    const pollTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadLocation(offerId);
    }, 10_000);
    return () => window.clearInterval(pollTimer);
  }, [
    loadLocation,
    selectedOffer,
  ]);

  const selectOffer = useCallback((offer: HospitalOfferListItem) => {
    clearProtectedData();
    setTimelinePage(0);
    setDecisionError(null);
    setDecisionNotice(null);
    setShowReject(false);
    setShowWithdrawal(false);
    setRejectReason("");
    setRejectDetail("");
    setWithdrawalReason("");
    setWithdrawalDetail("");
    setShowFullDetail(false);
    setShowAcceptConfirm(false);
    void loadSelectedResources({ offer, view }, 0);
  }, [clearProtectedData, loadSelectedResources, view]);

  const closeDetail = () => {
    setSelectedOffer(null);
    setSelectedOfferView(null);
    setSelectedOfferId(null);
    setTimelinePage(0);
    clearProtectedData();
    setDecisionError(null);
    setDecisionNotice(null);
    setShowReject(false);
    setShowWithdrawal(false);
    setRejectReason("");
    setRejectDetail("");
    setWithdrawalReason("");
    setWithdrawalDetail("");
    setShowFullDetail(false);
    setShowAcceptConfirm(false);
  };

  const closeFullDetail = () => {
    setShowFullDetail(false);
    setShowReject(false);
    setShowWithdrawal(false);
    setDecisionError(null);
  };

  const refreshAfterDecision = async () => {
    await refreshVisibleSelection();
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
      await refreshAfterDecision();
    } catch (nextError) {
      setDecisionError(nextError);
      if (isSessionError(nextError)) expiredRef.current();
      if (
        nextError instanceof ApiError &&
        ["TRANSPORT_005", "TRANSPORT_006", "COMMON_005"].includes(nextError.code)
      ) {
        clearOfferCommand(window.sessionStorage, detail.offerId, command.idempotencyKey);
        await refreshAfterDecision();
      }
      if (nextError instanceof ApiError && nextError.code === "COMMON_001") {
        clearOfferCommand(window.sessionStorage, detail.offerId, command.idempotencyKey);
      }
    } finally {
      setDecisionBusy(null);
    }
  };

  const confirmHandoff = async () => {
    if (!detail?.canConfirmHandoff) return;
    const command = getOrCreateOfferCommand(
      window.sessionStorage,
      detail.offerId,
      "confirm-handoff",
      null,
    );
    setDecisionBusy("confirm-handoff");
    setDecisionError(null);
    setDecisionNotice(null);
    try {
      const response = await hospitalApi.confirmHandoff(
        detail.offerId,
        command.idempotencyKey,
      );
      clearOfferCommand(
        window.sessionStorage,
        detail.offerId,
        command.idempotencyKey,
      );
      setDecisionNotice(
        response.idempotentReplay
          ? "이전에 처리된 인계 완료 결과를 복구했습니다."
          : "환자 인계를 완료 처리했습니다.",
      );
      await refreshAfterDecision();
    } catch (nextError) {
      setDecisionError(nextError);
      if (isSessionError(nextError)) expiredRef.current();
      if (
        nextError instanceof ApiError &&
        ["COMMON_001", "TRANSPORT_004", "TRANSPORT_005", "COMMON_005"].includes(
          nextError.code,
        )
      ) {
        clearOfferCommand(
          window.sessionStorage,
          detail.offerId,
          command.idempotencyKey,
        );
      }
      if (
        nextError instanceof ApiError &&
        ["TRANSPORT_004", "TRANSPORT_005", "COMMON_005"].includes(nextError.code)
      ) {
        await refreshAfterDecision();
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
      await refreshAfterDecision();
    } catch (nextError) {
      setDecisionError(nextError);
      if (isSessionError(nextError)) expiredRef.current();
      if (
        nextError instanceof ApiError &&
        ["TRANSPORT_005", "TRANSPORT_006", "COMMON_005"].includes(nextError.code)
      ) {
        clearOfferCommand(window.sessionStorage, detail.offerId, command.idempotencyKey);
        await refreshAfterDecision();
      }
      if (nextError instanceof ApiError && nextError.code === "COMMON_001") {
        clearOfferCommand(window.sessionStorage, detail.offerId, command.idempotencyKey);
      }
    } finally {
      setDecisionBusy(null);
    }
  };

  const withdrawAcceptance = async (event: FormEvent) => {
    event.preventDefault();
    const offerId = detail?.offerId ?? selectedOffer?.offerId;
    const canWithdraw = detail?.canWithdraw ?? selectedOffer?.canWithdraw;
    if (!offerId || !canWithdraw || !withdrawalReason) return;

    let payload: { reason: WithdrawalReason; detail: string | null };
    try {
      payload = createWithdrawalPayload(
        withdrawalReason,
        withdrawalDetail,
      ) as { reason: WithdrawalReason; detail: string | null };
    } catch (payloadError) {
      setDecisionError(payloadError);
      return;
    }

    const command = getOrCreateOfferCommand(
      window.sessionStorage,
      offerId,
      "withdraw",
      payload,
    );
    setDecisionBusy("withdraw");
    setDecisionError(null);
    setDecisionNotice(null);
    try {
      const response = await hospitalApi.withdrawAcceptance(
        offerId,
        payload,
        command.idempotencyKey,
      );
      clearOfferCommand(window.sessionStorage, offerId, command.idempotencyKey);
      setDecisionNotice(
        response.idempotentReplay
          ? "이전에 처리된 수락 철회 결과를 복구했습니다."
          : response.searchRestarted
            ? "수락을 철회했습니다. 서버가 목적지 상태를 정리하고 병원 탐색을 다시 확인합니다."
            : "수락을 철회했습니다. 현재 목적지는 유지됩니다.",
      );
      setShowWithdrawal(false);
      setSelectedOffer((current) =>
        current
          ? {
              ...current,
              transportRequestStatus: response.transportRequestStatus,
              offerStatus: "ACCEPTANCE_WITHDRAWN",
              currentDestination: false,
              canWithdraw: false,
              dispatchAttemptNumber: null,
              ageStatus: null,
              ageYears: null,
              sex: null,
              preKtasClassificationStatus: null,
              preKtasLevel: null,
              preKtasExceptionReason: null,
              straightLineDistanceMeters: null,
              routeEstimateStatus: null,
              routeDistanceMeters: null,
              etaSeconds: null,
              lastSuccessfulRouteDistanceMeters: null,
              lastSuccessfulEtaSeconds: null,
              lastSuccessfulEtaCalculatedAt: null,
              lastClinicalUpdateAt: null,
              offeredAt: null,
              withdrawalReason: response.reason,
              withdrawalDetail: response.detail,
              withdrawnAt: response.withdrawnAt,
            }
          : current,
      );
      setSelectedOfferView("HISTORY");
      setSelectedOfferId(null);
      clearProtectedData();
      await refreshBoth();
    } catch (nextError) {
      setDecisionError(nextError);
      if (isSessionError(nextError)) expiredRef.current();
      if (nextError instanceof ApiError && nextError.code === "COMMON_001") {
        clearOfferCommand(window.sessionStorage, offerId, command.idempotencyKey);
      }
      if (
        nextError instanceof ApiError &&
        ["TRANSPORT_004", "TRANSPORT_005", "TRANSPORT_006", "COMMON_005"].includes(
          nextError.code,
        )
      ) {
        clearOfferCommand(window.sessionStorage, offerId, command.idempotencyKey);
        setSelectedOffer(null);
        setSelectedOfferView(null);
        setSelectedOfferId(null);
        clearProtectedData();
        await refreshBoth();
        setError(nextError);
      }
    } finally {
      setDecisionBusy(null);
    }
  };

  const sourceItems = result?.items ?? [];
  const items =
    view === "HISTORY"
      ? sourceItems
      : sourceItems.filter((offer) =>
          activeFilter === "PENDING"
            ? offer.offerStatus === "PENDING"
            : offer.offerStatus === "ACCEPTED",
        );
  const pendingCount = sourceItems.filter((offer) => offer.offerStatus === "PENDING").length;
  const acceptedCount = sourceItems.filter((offer) => offer.offerStatus === "ACCEPTED").length;
  const totalPages = Math.max(1, result?.totalPages ?? 1);

  useEffect(() => {
    if (loading || selectedOffer || items.length === 0) return;
    const timer = window.setTimeout(() => selectOffer(items[0]), 0);
    return () => window.clearTimeout(timer);
  }, [items, loading, selectOffer, selectedOffer]);

  const changeQueue = (nextView: OfferView, nextFilter: "PENDING" | "ACCEPTED") => {
    closeDetail();
    setView(nextView);
    setActiveFilter(nextFilter);
    setPage(0);
  };

  return (
    <>
      <div className="offer-workspace">
        <DashboardOfferDetail
          decisionBusy={decisionBusy}
          decisionError={decisionError}
          decisionNotice={decisionNotice}
          detail={detail}
          error={detailError}
          loading={detailLoading}
          onAccept={() => setShowAcceptConfirm(true)}
          onOpenFull={() => setShowFullDetail(true)}
          onReject={() => {
            setShowFullDetail(true);
            setShowReject(true);
            setDecisionError(null);
          }}
          selectedOffer={selectedOffer}
        />

      <aside className="request-panel offer-panel offer-queue">
        <div className="request-panel-head offer-panel-head offer-queue-head">
          <div>
            <span className="eyebrow">이송 요청</span>
            <h1>{view === "HISTORY" ? "종료 이력" : activeFilter === "PENDING" ? "응답 대기" : "수용 응답"}</h1>
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
            aria-selected={view === "ACTIVE" && activeFilter === "PENDING"}
            className={view === "ACTIVE" && activeFilter === "PENDING" ? "active" : ""}
            onClick={() => changeQueue("ACTIVE", "PENDING")}
            role="tab"
            type="button"
          >
            요청 대기 <span>{view === "ACTIVE" ? pendingCount : activeTotal}</span>
          </button>
          <button
            aria-selected={view === "ACTIVE" && activeFilter === "ACCEPTED"}
            className={view === "ACTIVE" && activeFilter === "ACCEPTED" ? "active" : ""}
            onClick={() => changeQueue("ACTIVE", "ACCEPTED")}
            role="tab"
            type="button"
          >
            수용 응답 <span>{acceptedCount}</span>
          </button>
          <button
            aria-selected={view === "HISTORY"}
            className={view === "HISTORY" ? "active" : ""}
            onClick={() => changeQueue("HISTORY", activeFilter)}
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
            <strong>
              {view === "HISTORY"
                ? "종료된 응답 이력이 없습니다"
                : activeFilter === "PENDING"
                  ? "현재 응답할 요청이 없습니다"
                  : "수용 응답한 요청이 없습니다"}
            </strong>
            <span>
              {view === "ACTIVE" && activeFilter === "PENDING"
                ? "수신 ON 상태에서 새 제안이 오면 실시간으로 목록을 다시 조회합니다."
                : view === "ACTIVE"
                  ? "수용 가능으로 응답한 요청과 현재 이송 상태가 이곳에 표시됩니다."
                  : "완료·취소·거절·무응답·수락 철회 이력이 이곳에 표시됩니다."}
            </span>
          </div>
        ) : null}
        {items.length ? (
          <div className="offer-list">
            {items.map((offer) => (
              <OfferCard
                key={offer.offerId}
                offer={offer}
                onSelect={() => selectOffer(offer)}
                selected={selectedOffer?.offerId === offer.offerId}
                view={view}
              />
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
      </aside>
      </div>

      {selectedOfferId && showFullDetail ? (
        <OfferDetailModal
          decisionBusy={decisionBusy}
          decisionError={decisionError}
          decisionNotice={decisionNotice}
          detail={detail}
          error={detailError}
          loading={detailLoading}
          location={location}
          locationError={locationError}
          locationLoading={locationLoading}
          onAccept={() => setShowAcceptConfirm(true)}
          onConfirmHandoff={() => void confirmHandoff()}
          onCancelReject={() => { setShowReject(false); setDecisionError(null); }}
          onCancelWithdrawal={() => { setShowWithdrawal(false); setDecisionError(null); }}
          onClose={closeFullDetail}
          onReject={(event) => void reject(event)}
          onRejectDetail={setRejectDetail}
          onRejectReason={setRejectReason}
          onShowReject={() => { setShowReject(true); setDecisionError(null); }}
          onShowWithdrawal={() => { setShowWithdrawal(true); setDecisionError(null); }}
          onTimelinePage={(targetPage) => {
            setTimelinePage(targetPage);
            void loadTimeline(selectedOfferId, targetPage);
          }}
          onWithdrawalDetail={setWithdrawalDetail}
          onWithdrawalReason={setWithdrawalReason}
          onWithdraw={(event) => void withdrawAcceptance(event)}
          rejectDetail={rejectDetail}
          rejectReason={rejectReason}
          showReject={showReject}
          showWithdrawal={showWithdrawal}
          timeline={timeline}
          timelineError={timelineError}
          timelineLoading={timelineLoading}
          withdrawalDetail={withdrawalDetail}
          withdrawalReason={withdrawalReason}
        />
      ) : null}

      {showAcceptConfirm && detail ? (
        <div className="offer-modal-backdrop confirmation-backdrop" onMouseDown={() => setShowAcceptConfirm(false)}>
          <section
            aria-labelledby="accept-confirm-title"
            aria-modal="true"
            className="confirmation-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            role="alertdialog"
          >
            <span className="eyebrow">수용 응답 확인</span>
            <h2 id="accept-confirm-title">이 환자를 수용할 수 있나요?</h2>
            <p>
              수용 가능 응답을 보내도 최종 목적지는 구급대원이 선택합니다. 현재 병상과
              진료 가능 여부를 다시 확인해 주세요.
            </p>
            <div className="confirmation-actions">
              <button className="button button-muted" onClick={() => setShowAcceptConfirm(false)} type="button">취소</button>
              <button
                className="button button-primary"
                disabled={decisionBusy !== null}
                onClick={() => {
                  setShowAcceptConfirm(false);
                  void accept();
                }}
                type="button"
              >
                {decisionBusy === "accept" ? "응답 중…" : "수용 가능으로 응답"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {selectedOffer && !selectedOfferId && showFullDetail ? (
        <MinimalHistoryModal
          decisionBusy={decisionBusy}
          decisionError={decisionError}
          decisionNotice={decisionNotice}
          offer={selectedOffer}
          onCancelWithdrawal={() => { setShowWithdrawal(false); setDecisionError(null); }}
          onClose={closeFullDetail}
          onShowWithdrawal={() => { setShowWithdrawal(true); setDecisionError(null); }}
          onWithdrawalDetail={setWithdrawalDetail}
          onWithdrawalReason={setWithdrawalReason}
          onWithdraw={(event) => void withdrawAcceptance(event)}
          showWithdrawal={showWithdrawal}
          withdrawalDetail={withdrawalDetail}
          withdrawalReason={withdrawalReason}
        />
      ) : null}
    </>
  );
}
