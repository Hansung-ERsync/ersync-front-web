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
import { hospitalBackendHeaders } from "../../_lib/request-headers.js";

type RouteContext = { params: Promise<{ path: string[] }> };

const publicRoutes = new Set(["POST auth/signups/hospital"]);
const offerIdPattern =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

function isAllowed(method: string, path: string) {
  if (publicRoutes.has(`${method} ${path}`)) return true;
  if (method === "GET" && path === "hospitals/me") return true;
  if (method === "PUT" && path === "hospitals/me/receiving-status") return true;
  if (method === "GET" && path === "hospitals/me/offers") return true;
  if (
    method === "GET" &&
    new RegExp(`^hospitals/me/offers/${offerIdPattern}$`, "i").test(path)
  ) {
    return true;
  }
  if (
    method === "GET" &&
    new RegExp(
      `^hospitals/me/offers/${offerIdPattern}/(clinical-timeline|location)$`,
      "i",
    ).test(path)
  ) {
    return true;
  }
  return (
    method === "POST" &&
    new RegExp(
      `^hospitals/me/offers/${offerIdPattern}/(accept|reject|withdraw-acceptance|confirm-handoff)$`,
      "i",
    ).test(path)
  );
}

function authErrorResponse(status: number, data: Record<string, unknown>) {
  const response = NextResponse.json(data, { status });
  if (data.code === "AUTH_005" || data.code === "USER_002") {
    clearAuthCookies(response);
  }
  return response;
}

function hospitalRoleError() {
  const response = NextResponse.json(
    {
      code: "AUTH_003",
      message: "병원 계정만 이 기능을 사용할 수 있습니다.",
      fieldErrors: [],
      traceId: null,
    },
    { status: 403 },
  );
  clearAuthCookies(response);
  return response;
}

async function handler(request: NextRequest, context: RouteContext) {
  const { path: segments } = await context.params;
  const path = segments.join("/");
  const method = request.method.toUpperCase();

  if (!isAllowed(method, path)) {
    return NextResponse.json(
      { code: "COMMON_404", message: "지원하지 않는 API 경로입니다." },
      { status: 404 },
    );
  }

  const isPublic = publicRoutes.has(`${method} ${path}`);
  const cookieStore = await cookies();
  let accessToken = cookieStore.get(ACCESS_COOKIE)?.value;
  const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value;
  const previousSession = decodeSession(cookieStore.get(SESSION_COOKIE)?.value);
  const body = method === "GET" ? undefined : await request.text();
  const query = request.nextUrl.search;

  let rotatedAuth: AuthPayload | null = null;

  if (!isPublic && !accessToken && refreshToken) {
    const refreshed = await refreshAuth(refreshToken);
    if (refreshed.status !== 200) {
      return authErrorResponse(
        refreshed.status,
        refreshed.data as Record<string, unknown>,
      );
    }
    rotatedAuth = refreshed.data as AuthPayload;
    if (rotatedAuth.role !== "HOSPITAL_STAFF") return hospitalRoleError();
    accessToken = rotatedAuth.accessToken;
  }

  if (!isPublic && !accessToken) {
    return authErrorResponse(401, {
      code: "AUTH_001",
      message: "로그인이 필요합니다.",
      fieldErrors: [],
      traceId: null,
    });
  }

  const call = (token?: string) =>
    backendRequest<Record<string, unknown>>(`/api/v1/${path}${query}`, {
      method,
      body,
      headers: hospitalBackendHeaders(request.headers, token),
    });

  let result = await call(accessToken);

  if (
    !isPublic &&
    result.status === 401 &&
    result.data?.code === "AUTH_002" &&
    refreshToken
  ) {
    const refreshed = await refreshAuth(refreshToken);

    if (refreshed.status === 200) {
      rotatedAuth = refreshed.data as AuthPayload;
      if (rotatedAuth.role !== "HOSPITAL_STAFF") return hospitalRoleError();
      result = await call(rotatedAuth.accessToken);
    } else {
      result = refreshed as typeof result;
    }
  }

  const response = NextResponse.json(result.data, { status: result.status });

  if (rotatedAuth) {
    setAuthCookies(
      response,
      rotatedAuth,
      publicSession(rotatedAuth, previousSession?.loginId),
    );
  }

  if (
    result.data?.code === "AUTH_005" ||
    result.data?.code === "USER_002"
  ) {
    clearAuthCookies(response);
  }

  return response;
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
