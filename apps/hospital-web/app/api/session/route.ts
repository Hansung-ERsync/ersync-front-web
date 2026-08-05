import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  AuthPayload,
  backendRequest,
  clearAuthCookies,
  decodeSession,
  publicSession,
  REFRESH_COOKIE,
  refreshAuth,
  SESSION_COOKIE,
  setAuthCookies,
} from "../_lib/backend";

export async function GET() {
  const cookieStore = await cookies();
  const session = decodeSession(cookieStore.get(SESSION_COOKIE)?.value);

  if (session && session.role !== "HOSPITAL_STAFF") {
    const response = NextResponse.json({ session: null });
    clearAuthCookies(response);
    return response;
  }

  return NextResponse.json({ session });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { loginId?: string; password?: string };
  const result = await backendRequest<AuthPayload | Record<string, unknown>>(
    "/api/v1/auth/login",
    {
      method: "POST",
      body: JSON.stringify({
        loginId: body.loginId,
        password: body.password,
        role: "HOSPITAL_STAFF",
      }),
    },
  );

  if (result.status !== 200) {
    return NextResponse.json(result.data, { status: result.status });
  }

  const auth = result.data as AuthPayload;
  if (auth.role !== "HOSPITAL_STAFF") {
    return NextResponse.json(
      {
        code: "AUTH_ROLE_MISMATCH",
        message: "병원 관계자 계정으로 로그인해 주세요.",
        fieldErrors: [],
        traceId: null,
      },
      { status: 403 },
    );
  }
  const session = publicSession(auth, body.loginId?.trim());
  const response = NextResponse.json({ session });
  setAuthCookies(response, auth, session);
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  clearAuthCookies(response);
  return response;
}

export async function PUT() {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value;
  const previousSession = decodeSession(cookieStore.get(SESSION_COOKIE)?.value);

  if (!refreshToken) {
    const response = NextResponse.json(
      {
        code: "AUTH_005",
        message: "로그인이 만료되었습니다. 다시 로그인해 주세요.",
        fieldErrors: [],
        traceId: null,
      },
      { status: 401 },
    );
    clearAuthCookies(response);
    return response;
  }

  const result = await refreshAuth(refreshToken);

  if (result.status !== 200) {
    const response = NextResponse.json(result.data, { status: result.status });
    clearAuthCookies(response);
    return response;
  }

  const auth = result.data as AuthPayload;
  if (auth.role !== "HOSPITAL_STAFF") {
    const response = NextResponse.json(
      {
        code: "AUTH_ROLE_MISMATCH",
        message: "병원 관계자 계정으로 다시 로그인해 주세요.",
        fieldErrors: [],
        traceId: null,
      },
      { status: 403 },
    );
    clearAuthCookies(response);
    return response;
  }
  const session = publicSession(auth, previousSession?.loginId);
  const response = NextResponse.json({ session });
  setAuthCookies(response, auth, session);
  return response;
}
