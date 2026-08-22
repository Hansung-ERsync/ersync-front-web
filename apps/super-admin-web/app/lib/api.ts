export type Session = {
  accountId: string;
  organizationId: null;
  role: "SUPER_ADMIN";
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  loginId?: string;
};

export type OrganizationType = "HOSPITAL" | "EMS_UNIT";

export type Organization = {
  organizationId: string;
  name: string;
  type: OrganizationType;
  createdAt: string;
};

export type InvitationStatus =
  | "AVAILABLE"
  | "USED"
  | "EXPIRED"
  | "REVOKED";

export type Invitation = {
  invitationCodeId: string;
  organizationName: string;
  role: "HOSPITAL_STAFF" | "PARAMEDIC";
  status: InvitationStatus;
  expiresAt: string;
};

export type PageResult<T> = {
  items: T[];
  totalPages: number;
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
  const method = (init?.method || "GET").toUpperCase();
  const response = await fetch(url, {
    ...init,
    cache: init?.cache ?? (method === "GET" ? "no-store" : undefined),
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

export const adminApi = {
  organizations: (page = 0, size = 20) =>
    request<PageResult<Organization>>(
      `/api/ersync/admin/organizations?page=${page}&size=${size}`,
    ),
  createOrganization: (name: string, type: OrganizationType) =>
    request<Organization>("/api/ersync/admin/organizations", {
      method: "POST",
      body: JSON.stringify({ name, type }),
    }),
  invitations: (
    page = 0,
    size = 20,
    status?: InvitationStatus,
    organizationId?: string,
  ) => {
    const query = new URLSearchParams({ page: String(page), size: String(size) });
    if (status) query.set("status", status);
    if (organizationId) query.set("organizationId", organizationId);
    return request<PageResult<Invitation>>(
      `/api/ersync/admin/invitation-codes?${query.toString()}`,
    );
  },
  createInvitation: (payload: {
    organizationId: string;
    role: "HOSPITAL_STAFF" | "PARAMEDIC";
    expiryOption: "THREE_DAYS" | "SEVEN_DAYS" | "CUSTOM";
    customExpiresAt?: string | null;
  }) =>
    request<{ code: string }>(
      "/api/ersync/admin/invitation-codes",
      { method: "POST", body: JSON.stringify(payload) },
    ),
  revokeInvitation: (invitationCodeId: string) =>
    request<Invitation>(
      `/api/ersync/admin/invitation-codes/${invitationCodeId}/revoke`,
      { method: "POST", body: JSON.stringify({}) },
    ),
};

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
}
