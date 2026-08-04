import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_COOKIE,
  API_BASE_URL,
  AuthPayload,
  clearAuthCookies,
  decodeSession,
  publicSession,
  REFRESH_COOKIE,
  refreshAuth,
  SESSION_COOKIE,
  setAuthCookies,
} from "../../_lib/backend";

type ErrorPayload = {
  code?: string;
  message?: string;
  fieldErrors?: unknown[];
  traceId?: string | null;
};

async function readError(response: Response): Promise<ErrorPayload> {
  try {
    return (await response.json()) as ErrorPayload;
  } catch {
    return {
      code: "UPSTREAM_INVALID_RESPONSE",
      message: "실시간 연결 응답을 해석할 수 없습니다.",
      fieldErrors: [],
      traceId: null,
    };
  }
}

function errorResponse(status: number, data: ErrorPayload) {
  return NextResponse.json(data, { status });
}

function shouldClearAuth(data: ErrorPayload) {
  return data.code === "AUTH_005" || data.code === "USER_002";
}

async function openRealtime(accessToken: string, signal: AbortSignal) {
  return fetch(`${API_BASE_URL}/api/v1/realtime/events`, {
    method: "GET",
    headers: {
      Accept: "text/event-stream",
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
    signal,
  });
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  let accessToken = cookieStore.get(ACCESS_COOKIE)?.value;
  let refreshToken = cookieStore.get(REFRESH_COOKIE)?.value;
  const previousSession = decodeSession(cookieStore.get(SESSION_COOKIE)?.value);
  let rotatedAuth: AuthPayload | null = null;

  if (previousSession && previousSession.role !== "HOSPITAL_STAFF") {
    return errorResponse(403, {
      code: "AUTH_003",
      message: "병원 계정만 실시간 요청을 받을 수 있습니다.",
      fieldErrors: [],
      traceId: null,
    });
  }

  if (!accessToken && refreshToken) {
    const refreshed = await refreshAuth(refreshToken);
    if (refreshed.status === 200) {
      rotatedAuth = refreshed.data as AuthPayload;
      if (rotatedAuth.role !== "HOSPITAL_STAFF") {
        const response = errorResponse(403, {
          code: "AUTH_003",
          message: "병원 계정으로 다시 로그인해 주세요.",
          fieldErrors: [],
          traceId: null,
        });
        clearAuthCookies(response);
        return response;
      }
      accessToken = rotatedAuth.accessToken;
      refreshToken = rotatedAuth.refreshToken;
    } else {
      const data = refreshed.data as ErrorPayload;
      const response = errorResponse(refreshed.status, data);
      if (shouldClearAuth(data)) clearAuthCookies(response);
      return response;
    }
  }

  if (!accessToken) {
    return errorResponse(401, {
      code: "AUTH_001",
      message: "로그인이 필요합니다.",
      fieldErrors: [],
      traceId: null,
    });
  }

  let upstream: Response;
  try {
    upstream = await openRealtime(accessToken, request.signal);
  } catch {
    return errorResponse(502, {
      code: "BACKEND_UNAVAILABLE",
      message: "실시간 서버에 연결할 수 없습니다.",
      fieldErrors: [],
      traceId: null,
    });
  }

  if (upstream.status === 401 && refreshToken) {
    const authError = await readError(upstream);
    if (authError.code === "AUTH_002") {
      const refreshed = await refreshAuth(refreshToken);
      if (refreshed.status === 200) {
        rotatedAuth = refreshed.data as AuthPayload;
        if (rotatedAuth.role !== "HOSPITAL_STAFF") {
          const response = errorResponse(403, {
            code: "AUTH_003",
            message: "병원 계정으로 다시 로그인해 주세요.",
            fieldErrors: [],
            traceId: null,
          });
          clearAuthCookies(response);
          return response;
        }
        try {
          upstream = await openRealtime(rotatedAuth.accessToken, request.signal);
        } catch {
          return errorResponse(502, {
            code: "BACKEND_UNAVAILABLE",
            message: "실시간 서버에 다시 연결할 수 없습니다.",
            fieldErrors: [],
            traceId: null,
          });
        }
      } else {
        const data = refreshed.data as ErrorPayload;
        const response = errorResponse(refreshed.status, data);
        if (shouldClearAuth(data)) clearAuthCookies(response);
        return response;
      }
    } else {
      return errorResponse(upstream.status, authError);
    }
  }

  if (!upstream.ok || !upstream.body) {
    const data = await readError(upstream);
    const response = errorResponse(upstream.status || 502, data);
    if (shouldClearAuth(data)) clearAuthCookies(response);
    return response;
  }

  const response = new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });

  if (rotatedAuth) {
    setAuthCookies(
      response,
      rotatedAuth,
      publicSession(rotatedAuth, previousSession?.loginId),
    );
  }
  return response;
}
