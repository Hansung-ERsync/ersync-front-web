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

const publicRoutes = new Set(["POST auth/signups/hospital"]);

function isAllowed(method: string, path: string) {
  if (publicRoutes.has(`${method} ${path}`)) return true;
  return method === "PUT" && path === "hospitals/me/receiving-status";
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
  const accessToken = cookieStore.get(ACCESS_COOKIE)?.value;
  const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value;
  const previousSession = decodeSession(cookieStore.get(SESSION_COOKIE)?.value);
  const body = method === "GET" ? undefined : await request.text();
  const query = request.nextUrl.search;

  if (!isPublic && !accessToken) {
    return NextResponse.json(
      {
        code: "AUTH_001",
        message: "로그인이 필요합니다.",
        fieldErrors: [],
        traceId: null,
      },
      { status: 401 },
    );
  }

  const call = (token?: string) =>
    backendRequest<Record<string, unknown>>(`/api/v1/${path}${query}`, {
      method,
      body,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });

  let result = await call(accessToken);
  let rotatedAuth: AuthPayload | null = null;

  if (
    !isPublic &&
    result.status === 401 &&
    result.data?.code === "AUTH_002" &&
    refreshToken
  ) {
    const refreshed = await refreshAuth(refreshToken);

    if (refreshed.status === 200) {
      rotatedAuth = refreshed.data as AuthPayload;
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
