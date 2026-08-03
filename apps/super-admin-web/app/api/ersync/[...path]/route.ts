import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_COOKIE,
  AuthPayload,
  backendRequest,
  clearAuthCookies,
  decodeSession,
  publicSession,
  REFRESH_COOKIE,
  refreshAuth,
  SESSION_COOKIE,
  setAuthCookies,
} from "../../_lib/backend";

type RouteContext = { params: Promise<{ path: string[] }> };

function isAllowed(method: string, path: string) {
  if (path === "admin/organizations" && ["GET", "POST"].includes(method)) {
    return true;
  }
  if (path === "admin/invitation-codes" && ["GET", "POST"].includes(method)) {
    return true;
  }
  return (
    method === "POST" &&
    /^admin\/invitation-codes\/[0-9a-f-]+\/revoke$/i.test(path)
  );
}

async function handler(request: NextRequest, context: RouteContext) {
  const { path: segments } = await context.params;
  const path = segments.join("/");
  const method = request.method.toUpperCase();

  if (!isAllowed(method, path)) {
    return NextResponse.json(
      { code: "COMMON_404", message: "지원하지 않는 관리자 API 경로입니다." },
      { status: 404 },
    );
  }

  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_COOKIE)?.value;
  const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value;
  const previousSession = decodeSession(cookieStore.get(SESSION_COOKIE)?.value);
  const body = method === "GET" ? undefined : await request.text();
  const query = request.nextUrl.search;

  if (!accessToken || previousSession?.role !== "SUPER_ADMIN") {
    const response = NextResponse.json(
      {
        code: "AUTH_001",
        message: "슈퍼 관리자 로그인이 필요합니다.",
        fieldErrors: [],
        traceId: null,
      },
      { status: 401 },
    );
    clearAuthCookies(response);
    return response;
  }

  const call = (token: string) =>
    backendRequest<Record<string, unknown>>(`/api/v1/${path}${query}`, {
      method,
      body,
      headers: { Authorization: `Bearer ${token}` },
    });

  let result = await call(accessToken);
  let rotatedAuth: AuthPayload | null = null;

  if (
    result.status === 401 &&
    result.data?.code === "AUTH_002" &&
    refreshToken
  ) {
    const refreshed = await refreshAuth(refreshToken);
    if (refreshed.status === 200) {
      rotatedAuth = refreshed.data as AuthPayload;
      if (rotatedAuth.role === "SUPER_ADMIN") {
        result = await call(rotatedAuth.accessToken);
      } else {
        result = {
          status: 403,
          data: {
            code: "AUTH_ROLE_MISMATCH",
            message: "슈퍼 관리자 계정으로 다시 로그인해 주세요.",
          },
        };
      }
    } else {
      result = refreshed as typeof result;
    }
  }

  const response = NextResponse.json(result.data, { status: result.status });

  if (rotatedAuth?.role === "SUPER_ADMIN") {
    setAuthCookies(
      response,
      rotatedAuth,
      publicSession(rotatedAuth, previousSession.loginId),
    );
  }

  if (
    result.data?.code === "AUTH_005" ||
    result.data?.code === "USER_002" ||
    result.data?.code === "AUTH_ROLE_MISMATCH"
  ) {
    clearAuthCookies(response);
  }

  return response;
}

export const GET = handler;
export const POST = handler;

