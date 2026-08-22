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
export type TransportRequestStatus =
  | "SEARCHING"
  | "ACCEPTED_AVAILABLE"
  | "EN_ROUTE"
  | "HANDOFF_REQUESTED"
  | "COMPLETED"
  | "CANCELLED";
export type OfferStatus =
  | "PENDING"
  | "ACCEPTED"
  | "REJECTED"
  | "ACCEPTANCE_WITHDRAWN";
export type HospitalOutcome =
  | "AWAITING_RESPONSE"
  | "ACCEPTED"
  | "REJECTED"
  | "ACCEPTANCE_WITHDRAWN"
  | "NOT_SELECTED"
  | "HANDOFF_COMPLETED_HERE"
  | "COMPLETED_ELSEWHERE"
  | "TRANSPORT_CANCELLED";
export type RouteEstimateStatus = "CALCULATING" | "AVAILABLE" | "UNAVAILABLE";
export type LocationFreshness = "NOT_RECEIVED" | "CURRENT" | "STALE";
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
export type CancellationReason =
  | "PATIENT_REFUSED_TRANSPORT"
  | "GUARDIAN_SELF_TRANSPORT"
  | "SCENE_RESOLVED"
  | "OTHER";

export type PageResult<T> = {
  items: T[];
  totalElements: number;
  totalPages: number;
};

export type HospitalOfferListItem = {
  offerId: string;
  transportRequestId: string;
  dispatchAttemptNumber?: number | null;
  transportRequestStatus: TransportRequestStatus;
  offerStatus: OfferStatus;
  hospitalOutcome: HospitalOutcome;
  processedAt: string | null;
  currentDestination: boolean;
  canWithdraw: boolean;
  ageStatus?: "EXACT" | "ESTIMATED" | "UNKNOWN" | null;
  ageYears?: number | null;
  sex?: "MALE" | "FEMALE" | "UNKNOWN" | null;
  preKtasClassificationStatus?:
    | "COMPLETED"
    | "EMERGENCY_UNFINISHED"
    | null;
  preKtasLevel?: number | null;
  preKtasExceptionReason?: string | null;
  straightLineDistanceMeters?: number | null;
  routeEstimateStatus?: RouteEstimateStatus | null;
  routeDistanceMeters?: number | null;
  etaSeconds?: number | null;
  lastSuccessfulRouteDistanceMeters?: number | null;
  lastSuccessfulEtaSeconds?: number | null;
  lastSuccessfulEtaCalculatedAt?: string | null;
  lastClinicalUpdateAt?: string | null;
  offeredAt?: string | null;
  reRequested?: boolean;
  lastRequestedAt?: string | null;
  respondedAt: string | null;
  rejectionReason: RejectionReason | null;
  rejectionDetail: string | null;
  withdrawalReason?: WithdrawalReason | null;
  withdrawalDetail?: string | null;
  withdrawnAt?: string | null;
  handoffRequestedAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  cancellationReason?: CancellationReason | null;
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

export type PreKtasSnapshot = {
  classificationStatus: "COMPLETED" | "EMERGENCY_UNFINISHED";
  level: number | null;
  exceptionReason: string | null;
  exceptionDetail: string | null;
  assessedAt: string | null;
  standardVersion: string;
};

export type ConsciousnessSnapshot = {
  avpu: "A" | "V" | "P" | "U" | "UNASSESSABLE";
  unassessableReason: string | null;
  unassessableDetail: string | null;
  observedAt: string;
};

export type SupplementalAssessment = {
  assessedAt: string;
  enteredAt: string;
  serverReceivedAt: string;
  glucoseMgDl: number | null;
  leftPupil: string | null;
  rightPupil: string | null;
  medicalHistory: string | null;
  allergies: string | null;
  medications: string | null;
  isolationConcern: boolean | null;
};

export type VitalSignsSnapshot = {
  measuredAt: string;
  measurements: VitalSignMeasurement[];
};

export type TreatmentRecord = {
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
};

export type HospitalOfferDetail = {
  offerId: string;
  dispatchAttemptNumber: number;
  transportRequestStatus: TransportRequestStatus;
  offerStatus: OfferStatus;
  currentDestination: boolean;
  canWithdraw: boolean;
  canConfirmHandoff: boolean;
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
  };
  consciousness: {
    avpu: "A" | "V" | "P" | "U" | "UNASSESSABLE";
    unassessableReason: string | null;
  };
  vitalSigns: VitalSignsSnapshot;
  treatments: TreatmentRecord[];
  supplementalAssessment: SupplementalAssessment | null;
  requester: {
    organizationName: string;
    callbackContact: string;
  };
  route: {
    straightLineDistanceMeters: number;
    status: RouteEstimateStatus | null;
    routeDistanceMeters: number | null;
    etaSeconds: number | null;
    lastSuccessfulRouteDistanceMeters: number | null;
    lastSuccessfulEtaSeconds: number | null;
    lastSuccessfulCalculatedAt: string | null;
  };
  timing: {
    requestReceivedAt: string;
    reRequested: boolean;
    lastRequestedAt: string;
    lastClinicalUpdateAt: string;
  };
  rejectionReason: RejectionReason | null;
  rejectionDetail: string | null;
  withdrawalReason: WithdrawalReason | null;
  withdrawalDetail: string | null;
  withdrawnAt: string | null;
  respondedAt: string | null;
  handoffRequestedAt: string | null;
  serverNow: string;
};

export type ClinicalTimelineRecordType =
  | "VITAL_SIGNS"
  | "CONSCIOUSNESS"
  | "PRE_KTAS"
  | "TREATMENT";

export type ClinicalTimelineItem = {
  recordType: ClinicalTimelineRecordType;
  recordId: string;
  clinicalAt: string;
  enteredAt: string;
  serverReceivedAt: string;
  preKtas: PreKtasSnapshot | null;
  consciousness: ConsciousnessSnapshot | null;
  vitalSigns: VitalSignsSnapshot | null;
  treatment: TreatmentRecord | null;
};

export type HospitalClinicalTimeline = {
  transportRequestId: string;
  latestSnapshot: {
    preKtas: PreKtasSnapshot;
    consciousness: ConsciousnessSnapshot;
    vitalSigns: VitalSignsSnapshot;
    treatments: TreatmentRecord[];
    lastClinicalUpdateAt: string;
  };
  items: ClinicalTimelineItem[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  serverNow: string;
};

export type HospitalOfferLocation = {
  transportRequestId: string;
  latitude: number | null;
  longitude: number | null;
  capturedAt: string | null;
  lastReceivedAt: string | null;
  freshness: LocationFreshness;
  ageSeconds: number | null;
  serverNow: string;
  locationReplaced: boolean | null;
  routeEstimateStatus: RouteEstimateStatus | null;
  routeDistanceMeters: number | null;
  etaSeconds: number | null;
  etaCalculatedAt: string | null;
  lastSuccessfulRouteDistanceMeters: number | null;
  lastSuccessfulEtaSeconds: number | null;
  lastSuccessfulEtaCalculatedAt: string | null;
  idempotentReplay: boolean;
};

export type HospitalOfferDecision = {
  offerId: string;
  offerStatus: "ACCEPTED" | "REJECTED";
  transportRequestId: string;
  transportRequestStatus: TransportRequestStatus;
  respondedAt: string;
  idempotentReplay: boolean;
};

export type HospitalAcceptanceWithdrawal = {
  transportRequestStatus: TransportRequestStatus;
  reason: WithdrawalReason;
  detail: string | null;
  withdrawnAt: string;
  searchRestarted: boolean;
};

export type HospitalHandoffConfirmation = {
  offerId: string;
  transportRequestId: string;
  status: "COMPLETED";
  completedAt: string;
  idempotentReplay: boolean;
};

export type HospitalProfile = {
  loginId: string;
  organizationName: string;
  hospitalId: string;
  address: string;
  detailAddress: string | null;
  latitude: number;
  longitude: number;
  contact: string;
  receivingStatus: "ON" | "OFF";
  updatedAt: string;
};

export type InvitationValidation = {
  organizationId: string;
  organizationName: string;
  role: Role;
  expiresAt: string;
  requiredConsents: {
    type: string;
    policyVersion: string;
  }[];
};

export type GeocodedAddress = {
  roadAddress: string;
  jibunAddress: string;
  latitude: number;
  longitude: number;
};

export type FieldError = {
  field?: string;
  fieldName?: string;
  message?: string;
};

type ErrorBody = {
  code?: string;
  message?: string;
  fieldErrors?: FieldError[];
  traceId?: string | null;
};

export class ApiError extends Error {
  status: number;
  code: string;
  traceId: string | null;
  fieldErrors: FieldError[];

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
  validateInvitation: (invitationCode: string) =>
    request<InvitationValidation>("/api/ersync/auth/invitations/validate", {
      method: "POST",
      body: JSON.stringify({ invitationCode }),
    }),
  signup: (payload: {
    invitationCode: string;
    organizationName: string;
    loginId: string;
    password: string;
    address: string;
    detailAddress?: string;
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
  geocode: (query: string) =>
    request<{ items: GeocodedAddress[] }>(
      `/api/geocode?query=${encodeURIComponent(query)}`,
    ),
  profile: () => request<HospitalProfile>("/api/ersync/hospitals/me"),
  updateProfile: (payload: {
    address: string;
    detailAddress: string | null;
    latitude: number;
    longitude: number;
    contact: string;
  }) =>
    request<HospitalProfile>("/api/ersync/hospitals/me", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  setReceivingStatus: (status: "ON" | "OFF") =>
    request<{
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
  clinicalTimeline: (offerId: string, page = 0, size = 50) =>
    request<HospitalClinicalTimeline>(
      `/api/ersync/hospitals/me/offers/${encodeURIComponent(offerId)}/clinical-timeline?page=${page}&size=${size}`,
    ),
  offerLocation: (offerId: string) =>
    request<HospitalOfferLocation>(
      `/api/ersync/hospitals/me/offers/${encodeURIComponent(offerId)}/location`,
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
  confirmHandoff: (offerId: string, idempotencyKey: string) =>
    request<HospitalHandoffConfirmation>(
      `/api/ersync/hospitals/me/offers/${encodeURIComponent(offerId)}/confirm-handoff`,
      {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
      },
    ),
};

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
}
