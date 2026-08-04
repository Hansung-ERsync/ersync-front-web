export type Role = "SUPER_ADMIN" | "HOSPITAL_STAFF" | "PARAMEDIC";

export type Session = {
  accountId: string;
  organizationId: string | null;
  role: Role;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  loginId?: string;
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
};

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
}
