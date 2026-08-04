export type Role = "SUPER_ADMIN" | "HOSPITAL_STAFF" | "PARAMEDIC";

export type Session = {
  accountId: string;
  organizationId: string | null;
  role: Role;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  loginId?: string;
};

export type OfferView = "ACTIVE" | "HISTORY";
export type OfferStatus =
  | "PENDING"
  | "ACCEPTED"
  | "REJECTED"
  | "NO_RESPONSE"
  | "ACCEPTANCE_WITHDRAWN";
export type RouteEstimateStatus = "CALCULATING" | "AVAILABLE" | "UNAVAILABLE";
export type RejectionReason =
  | "ER_GENERAL_BED_SHORTAGE"
  | "ISOLATION_BED_SHORTAGE"
  | "OPERATING_ROOM_SHORTAGE"
  | "ICU_SHORTAGE"
  | "SPECIALIST_UNAVAILABLE"
  | "EQUIPMENT_UNAVAILABLE"
  | "OTHER";
export type WithdrawalReason =
  | "BED_SHORTAGE"
  | "OPERATING_ROOM_SHORTAGE"
  | "SPECIALIST_UNAVAILABLE"
  | "EQUIPMENT_UNAVAILABLE"
  | "OTHER";

export type PageResult<T> = {
  items: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  serverNow: string;
};

export type HospitalOfferListItem = {
  offerId: string;
  transportRequestId: string;
  dispatchAttemptNumber: number | null;
  transportRequestStatus: string;
  offerStatus: OfferStatus;
  currentDestination: boolean;
  canWithdraw: boolean;
  ageStatus: "EXACT" | "ESTIMATED" | "UNKNOWN" | null;
  ageYears: number | null;
  sex: "MALE" | "FEMALE" | "UNKNOWN" | null;
  preKtasClassificationStatus:
    | "COMPLETED"
    | "EMERGENCY_UNFINISHED"
    | null;
  preKtasLevel: number | null;
  preKtasExceptionReason: string | null;
  straightLineDistanceMeters: number | null;
  routeEstimateStatus: RouteEstimateStatus | null;
  routeDistanceMeters: number | null;
  etaSeconds: number | null;
  offeredAt: string | null;
  respondedAt: string | null;
  withdrawalReason: WithdrawalReason | null;
  withdrawalDetail: string | null;
  withdrawnAt: string | null;
};

export type VitalSignMeasurement = {
  type:
    | "BLOOD_PRESSURE"
    | "PULSE"
    | "RESPIRATORY_RATE"
    | "TEMPERATURE"
    | "SPO2";
  state: "VALUE" | "MEASUREMENT_UNAVAILABLE" | "PATIENT_REFUSED";
  primaryValue: number | null;
  secondaryValue: number | null;
  unavailableReason: string | null;
  unavailableDetail: string | null;
};

export type HospitalOfferDetail = {
  offerId: string;
  transportRequestId: string;
  dispatchAttemptNumber: number;
  transportRequestStatus: string;
  offerStatus: OfferStatus;
  currentDestination: boolean;
  canWithdraw: boolean;
  patient: {
    ageStatus: "EXACT" | "ESTIMATED" | "UNKNOWN";
    ageYears: number | null;
    sex: "MALE" | "FEMALE" | "UNKNOWN";
  };
  incident: {
    occurrenceType: string;
    injuryMechanism: string | null;
    injurySites: string[];
    primarySymptom: string;
    primarySymptomDetail: string | null;
    secondarySymptoms: string[];
    onsetTimeStatus: "EXACT" | "ESTIMATED" | "UNKNOWN";
    onsetAt: string | null;
  };
  preKtas: {
    classificationStatus: "COMPLETED" | "EMERGENCY_UNFINISHED";
    level: number | null;
    exceptionReason: string | null;
    exceptionDetail: string | null;
    assessedAt: string | null;
    standardVersion: string;
  };
  consciousness: {
    avpu: "A" | "V" | "P" | "U" | "UNASSESSABLE";
    unassessableReason: string | null;
    unassessableDetail: string | null;
    observedAt: string;
  };
  vitalSigns: {
    measuredAt: string;
    measurements: VitalSignMeasurement[];
  };
  treatments: Array<{
    type: string;
    attemptResult: string | null;
    performedAt: string | null;
    method: string | null;
    device: string | null;
    flowRateLpm: number | null;
    currentStatus: string | null;
    medicationName: string | null;
    dose: string | null;
    route: string | null;
    site: string | null;
    detail: string | null;
  }>;
  requester: {
    organizationName: string;
    callbackContact: string;
  };
  route: {
    straightLineDistanceMeters: number;
    status: RouteEstimateStatus;
    routeDistanceMeters: number | null;
    etaSeconds: number | null;
    calculatedAt: string | null;
  };
  timing: {
    requestReceivedAt: string;
    offeredAt: string;
    lastClinicalUpdateAt: string;
  };
  rejectionReason: RejectionReason | null;
  rejectionDetail: string | null;
  withdrawalReason: WithdrawalReason | null;
  withdrawalDetail: string | null;
  withdrawnAt: string | null;
  respondedAt: string | null;
  serverNow: string;
};

export type HospitalOfferDecision = {
  offerId: string;
  offerStatus: "ACCEPTED" | "REJECTED";
  transportRequestId: string;
  transportRequestStatus: string;
  respondedAt: string;
  idempotentReplay: boolean;
};

export type HospitalAcceptanceWithdrawal = {
  offerId: string;
  offerStatus: "ACCEPTANCE_WITHDRAWN";
  transportRequestId: string;
  transportRequestStatus: string;
  currentDestinationOfferId: string | null;
  reason: WithdrawalReason;
  detail: string | null;
  withdrawnAt: string;
  searchRestarted: boolean;
  idempotentReplay: boolean;
};

type ErrorBody = {
  code?: string;
  message?: string;
  fieldErrors?: unknown[];
  traceId?: string | null;
};

export class ApiError extends Error {
  status: number;
  code: string;
  traceId: string | null;
  fieldErrors: unknown[];

  constructor(status: number, body: ErrorBody) {
    super(body.message || "요청을 처리하지 못했습니다.");
    this.name = "ApiError";
    this.status = status;
    this.code = body.code || "UNKNOWN_ERROR";
    this.traceId = body.traceId || null;
    this.fieldErrors = body.fieldErrors || [];
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    credentials: "same-origin",
  });

  const text = await response.text();
  const body = text ? (JSON.parse(text) as T & ErrorBody) : ({} as T & ErrorBody);

  if (!response.ok) throw new ApiError(response.status, body);
  return body;
}

export const sessionApi = {
  get: () => request<{ session: Session | null }>("/api/session"),
  login: (loginId: string, password: string) =>
    request<{ session: Session }>("/api/session", {
      method: "POST",
      body: JSON.stringify({ loginId, password }),
    }),
  refresh: () =>
    request<{ session: Session }>("/api/session", { method: "PUT" }),
  logout: () => request<{ ok: true }>("/api/session", { method: "DELETE" }),
};

export const hospitalApi = {
  signup: (payload: {
    invitationCode: string;
    organizationName: string;
    loginId: string;
    password: string;
    address: string;
    latitude: number;
    longitude: number;
    contact: string;
    contactSharingConsentAccepted: true;
    contactSharingConsentVersion: "CONTACT_SHARING_DEV_1.0";
  }) =>
    request<{
      accountId: string;
      organizationId: string;
      organizationName: string;
      role: "HOSPITAL_STAFF";
      hospitalId: string;
      receivingStatus: "OFF";
    }>("/api/ersync/auth/signups/hospital", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  setReceivingStatus: (status: "ON" | "OFF") =>
    request<{
      hospitalId: string;
      organizationId: string;
      status: "ON" | "OFF";
      updatedAt: string;
    }>("/api/ersync/hospitals/me/receiving-status", {
      method: "PUT",
      body: JSON.stringify({ status }),
    }),
  offers: (view: OfferView, page = 0, size = 20) =>
    request<PageResult<HospitalOfferListItem>>(
      `/api/ersync/hospitals/me/offers?view=${view}&page=${page}&size=${size}`,
    ),
  offerDetail: (offerId: string) =>
    request<HospitalOfferDetail>(
      `/api/ersync/hospitals/me/offers/${encodeURIComponent(offerId)}`,
    ),
  acceptOffer: (offerId: string, idempotencyKey: string) =>
    request<HospitalOfferDecision>(
      `/api/ersync/hospitals/me/offers/${encodeURIComponent(offerId)}/accept`,
      {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
      },
    ),
  rejectOffer: (
    offerId: string,
    payload: { reason: RejectionReason; detail: string | null },
    idempotencyKey: string,
  ) =>
    request<HospitalOfferDecision>(
      `/api/ersync/hospitals/me/offers/${encodeURIComponent(offerId)}/reject`,
      {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(payload),
      },
    ),
  withdrawAcceptance: (
    offerId: string,
    payload: { reason: WithdrawalReason; detail: string | null },
    idempotencyKey: string,
  ) =>
    request<HospitalAcceptanceWithdrawal>(
      `/api/ersync/hospitals/me/offers/${encodeURIComponent(offerId)}/withdraw-acceptance`,
      {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(payload),
      },
    ),
};

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
}
