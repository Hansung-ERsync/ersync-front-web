import { NextResponse } from "next/server";

export const API_BASE_URL =
  process.env.ERSYNC_API_BASE_URL ??
  "http://ec2-13-124-194-249.ap-northeast-2.compute.amazonaws.com";

export const ACCESS_COOKIE = "ersync_admin_access";
export const REFRESH_COOKIE = "ersync_admin_refresh";
export const SESSION_COOKIE = "ersync_admin_session";

export type AuthPayload = {
  tokenType: "Bearer";
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  accountId: string;
  organizationId: string | null;
  role: "SUPER_ADMIN" | "HOSPITAL_STAFF" | "PARAMEDIC";
};

export type SessionPayload = Omit<
  AuthPayload,
  "accessToken" | "refreshToken" | "tokenType"
> & {
  loginId?: string;
};

export type BackendResult<T = unknown> = {
  status: number;
  data: T;
};

const refreshRequests = new Map<
  string,
  Promise<BackendResult<AuthPayload | Record<string, unknown>>>
>();

const cookieOptions = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

function secondsUntil(iso: string) {
  const remaining = Math.floor((new Date(iso).getTime() - Date.now()) / 1000);
  return Math.max(1, remaining);
}

function encodeSession(session: SessionPayload) {
  return btoa(JSON.stringify(session));
}

export function decodeSession(value?: string): SessionPayload | null {
  if (!value) return null;

  try {
    return JSON.parse(atob(value)) as SessionPayload;
  } catch {
    return null;
  }
}

export function publicSession(
  payload: AuthPayload,
  loginId?: string,
): SessionPayload {
  return {
    accountId: payload.accountId,
    organizationId: payload.organizationId,
    role: payload.role,
    accessTokenExpiresAt: payload.accessTokenExpiresAt,
    refreshTokenExpiresAt: payload.refreshTokenExpiresAt,
    ...(loginId ? { loginId } : {}),
  };
}

export function setAuthCookies(
  response: NextResponse,
  payload: AuthPayload,
  session: SessionPayload,
) {
  response.cookies.set(ACCESS_COOKIE, payload.accessToken, {
    ...cookieOptions,
    maxAge: secondsUntil(payload.accessTokenExpiresAt),
  });
  response.cookies.set(REFRESH_COOKIE, payload.refreshToken, {
    ...cookieOptions,
    maxAge: secondsUntil(payload.refreshTokenExpiresAt),
  });
  response.cookies.set(SESSION_COOKIE, encodeSession(session), {
    ...cookieOptions,
    maxAge: secondsUntil(payload.refreshTokenExpiresAt),
  });
}

export function clearAuthCookies(response: NextResponse) {
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, SESSION_COOKIE]) {
    response.cookies.set(name, "", { ...cookieOptions, maxAge: 0 });
  }
}

export async function backendRequest<T = unknown>(
  path: string,
  init: RequestInit,
): Promise<BackendResult<T>> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    const text = await response.text();
    let data: unknown = null;

    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = {
          code: "UPSTREAM_INVALID_RESPONSE",
          message: "백엔드 응답을 해석할 수 없습니다.",
          fieldErrors: [],
          traceId: null,
        };
      }
    }

    return { status: response.status, data: data as T };
  } catch {
    return {
      status: 502,
      data: {
        code: "BACKEND_UNAVAILABLE",
        message: "백엔드 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.",
        fieldErrors: [],
        traceId: null,
      } as T,
    };
  }
}

export function refreshAuth(refreshToken: string) {
  const existing = refreshRequests.get(refreshToken);
  if (existing) return existing;

  const pending = backendRequest<AuthPayload | Record<string, unknown>>(
    "/api/v1/auth/tokens/refresh",
    {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    },
  );
  refreshRequests.set(refreshToken, pending);
  void pending.finally(() => {
    setTimeout(() => refreshRequests.delete(refreshToken), 2_000);
  });
  return pending;
}
