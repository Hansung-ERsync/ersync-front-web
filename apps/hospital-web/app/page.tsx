"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  ApiError,
  errorMessage,
  hospitalApi,
  Session,
  sessionApi,
} from "./lib/api";

type AuthView = "login" | "signup";
type HospitalView = "dashboard" | "account";

function formatPhoneNumber(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);

  if (digits.startsWith("02")) {
    if (digits.length <= 2) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
    if (digits.length <= 9) {
      return `${digits.slice(0, 2)}-${digits.slice(2, -4)}-${digits.slice(-4)}`;
    }
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  if (digits.length <= 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, -4)}-${digits.slice(-4)}`;
  }
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  const apiError = error instanceof ApiError ? error : null;

  return (
    <div className="notice notice-error" role="alert">
      <strong>{errorMessage(error)}</strong>
      {apiError?.traceId ? (
        <span>
          오류 코드 {apiError.code} · 문의용 traceId {apiError.traceId}
        </span>
      ) : apiError?.code ? (
        <span>오류 코드 {apiError.code}</span>
      ) : null}
    </div>
  );
}

function LoadingScreen() {
  return (
    <main className="loading-screen">
      <div className="brand-mark">ER</div>
      <strong>ERSync를 준비하고 있어요</strong>
      <span>계정 상태를 안전하게 확인하는 중입니다.</span>
    </main>
  );
}

function AuthScreen({
  onAuthenticated,
}: {
  onAuthenticated: (session: Session) => void;
}) {
  const [view, setView] = useState<AuthView>("login");
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [signupComplete, setSignupComplete] = useState<string | null>(null);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await sessionApi.login(loginId.trim(), password);
      onAuthenticated(result.session);
    } catch (nextError) {
      setError(nextError);
    } finally {
      setBusy(false);
    }
  };

  const signup = async (
    payload: Parameters<typeof hospitalApi.signup>[0],
  ) => {
    setError(null);
    setBusy(true);
    try {
      const result = await hospitalApi.signup(payload);
      setLoginId(payload.loginId);
      setPassword("");
      setSignupComplete(
        `${result.organizationName} 계정이 생성되었습니다. 최초 수신 상태는 OFF입니다.`,
      );
      setView("login");
    } catch (nextError) {
      setError(nextError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className={`auth-card ${view === "signup" ? "auth-card-wide" : ""}`}>
        <div className="auth-brand">ERSync</div>
        {view === "login" ? (
          <>
            <h1>
              이송 요청을
              <br />
              바로 받아보세요
            </h1>
            <p className="auth-subtitle">병원 관계자 전용 계정 로그인</p>

            {signupComplete ? (
              <div className="notice notice-success" role="status">
                <strong>병원 계정 생성 완료</strong>
                <span>{signupComplete}</span>
              </div>
            ) : null}
            <ErrorNotice error={error} />

            <form className="form-stack auth-form" onSubmit={login}>
              <label>
                <span>아이디</span>
                <input
                  autoComplete="username"
                  maxLength={30}
                  pattern="[a-z0-9]{4,30}"
                  placeholder="영문 소문자·숫자 4~30자"
                  required
                  value={loginId}
                  onChange={(event) => setLoginId(event.target.value.toLowerCase())}
                />
              </label>
              <label>
                <span>비밀번호</span>
                <input
                  autoComplete="current-password"
                  minLength={8}
                  maxLength={64}
                  placeholder="비밀번호 8~64자"
                  required
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <button className="button button-primary button-large" disabled={busy}>
                {busy ? "로그인 중…" : "로그인"}
              </button>
            </form>

            <div className="auth-footer">
              <span>기관 계정은 담당 관리자에게 문의해 주세요.</span>
              <button className="text-button" onClick={() => setView("signup")}>
                가입 코드로 병원 계정 만들기
              </button>
            </div>
          </>
        ) : (
          <HospitalSignup
            busy={busy}
            error={error}
            onBack={() => {
              setError(null);
              setView("login");
            }}
            onSubmit={signup}
          />
        )}
      </section>
    </main>
  );
}

function HospitalSignup({
  busy,
  error,
  onBack,
  onSubmit,
}: {
  busy: boolean;
  error: unknown;
  onBack: () => void;
  onSubmit: (payload: Parameters<typeof hospitalApi.signup>[0]) => Promise<void>;
}) {
  const [form, setForm] = useState({
    invitationCode: "",
    organizationName: "",
    loginId: "",
    password: "",
    address: "",
    latitude: "",
    longitude: "",
    contact: "",
  });

  const update = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSubmit({
      invitationCode: form.invitationCode.trim(),
      organizationName: form.organizationName.trim(),
      loginId: form.loginId.trim().toLowerCase(),
      password: form.password,
      address: form.address.trim(),
      latitude: Number(form.latitude),
      longitude: Number(form.longitude),
      contact: form.contact.trim(),
    });
  };

  return (
    <>
      <button className="back-button" type="button" onClick={onBack}>
        ← 로그인으로
      </button>
      <h1 className="signup-title">병원 공용 계정 만들기</h1>
      <p className="auth-subtitle">
        관리자가 발급한 일회용 가입 코드와 응급실 정보를 입력해 주세요.
      </p>
      <ErrorNotice error={error} />

      <form className="signup-grid" onSubmit={submit}>
        <label className="field-span-2">
          <span>가입 코드</span>
          <input
            autoComplete="off"
            required
            value={form.invitationCode}
            onChange={(event) => update("invitationCode", event.target.value)}
          />
        </label>
        <label className="field-span-2">
          <span>조직명</span>
          <input
            maxLength={100}
            placeholder="가입 코드에 연결된 병원명과 정확히 일치해야 합니다."
            required
            value={form.organizationName}
            onChange={(event) => update("organizationName", event.target.value)}
          />
        </label>
        <label>
          <span>로그인 아이디</span>
          <input
            autoCapitalize="none"
            autoComplete="username"
            maxLength={30}
            pattern="[a-z0-9]{4,30}"
            placeholder="영문 소문자·숫자"
            required
            value={form.loginId}
            onChange={(event) => update("loginId", event.target.value.toLowerCase())}
          />
          <small className="field-hint">
            아이디는 영문 소문자와 숫자만 가능하며, 대문자는 자동으로 소문자로 바뀝니다.
          </small>
        </label>
        <label>
          <span>비밀번호</span>
          <input
            autoComplete="new-password"
            minLength={8}
            maxLength={64}
            placeholder="8~64자"
            required
            type="password"
            value={form.password}
            onChange={(event) => update("password", event.target.value)}
          />
          <small className="field-hint">
            8~64자로 입력해 주세요. 영문 대·소문자, 숫자와 특수문자를 사용할 수 있습니다.
          </small>
        </label>
        <label className="field-span-2">
          <span>주소</span>
          <input
            maxLength={255}
            required
            value={form.address}
            onChange={(event) => update("address", event.target.value)}
          />
        </label>
        <label>
          <span>위도</span>
          <input
            max="90"
            min="-90"
            required
            step="any"
            type="number"
            value={form.latitude}
            onChange={(event) => update("latitude", event.target.value)}
          />
        </label>
        <label>
          <span>경도</span>
          <input
            max="180"
            min="-180"
            required
            step="any"
            type="number"
            value={form.longitude}
            onChange={(event) => update("longitude", event.target.value)}
          />
        </label>
        <div className="location-help field-span-2">
          <strong>위도와 경도는 왜 필요한가요?</strong>
          <span>
            병원 응급실의 위치를 저장하는 필수 정보입니다. 향후 가까운 병원 검색과
            지도 표시, 이송 거리 계산에 사용됩니다.
          </span>
        </div>
        <label className="field-span-2">
          <span>대표 연락처</span>
          <input
            autoComplete="tel"
            inputMode="tel"
            maxLength={13}
            placeholder="02-1234-5678"
            required
            value={form.contact}
            onChange={(event) => update("contact", formatPhoneNumber(event.target.value))}
          />
          <small className="field-hint">숫자만 입력하면 하이픈이 자동으로 추가됩니다.</small>
        </label>
        <div className="form-actions field-span-2">
          <button className="button button-muted" type="button" onClick={onBack}>
            취소
          </button>
          <button className="button button-primary" disabled={busy}>
            {busy ? "계정 생성 중…" : "병원 계정 만들기"}
          </button>
        </div>
      </form>
    </>
  );
}

function HospitalApp({
  session,
  onLogout,
  onSessionExpired,
}: {
  session: Session;
  onLogout: () => void;
  onSessionExpired: () => void;
}) {
  const [view, setView] = useState<HospitalView>("dashboard");
  const [receiving, setReceiving] = useState<"ON" | "OFF" | "UNKNOWN">(
    "UNKNOWN",
  );
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [clock, setClock] = useState("");

  useEffect(() => {
    const timer = window.setInterval(
      () => setClock(new Date().toLocaleTimeString("ko-KR", { hour12: false })),
      1000,
    );
    setClock(new Date().toLocaleTimeString("ko-KR", { hour12: false }));
    const saved = window.localStorage.getItem(
      `ersync-receiving-${session.accountId}`,
    );
    if (saved === "ON" || saved === "OFF") setReceiving(saved);
    return () => window.clearInterval(timer);
  }, [session.accountId]);

  const setStatus = async (status: "ON" | "OFF") => {
    setChanging(true);
    setError(null);
    try {
      const result = await hospitalApi.setReceivingStatus(status);
      setReceiving(result.status);
      window.localStorage.setItem(
        `ersync-receiving-${session.accountId}`,
        result.status,
      );
    } catch (nextError) {
      setError(nextError);
      if (
        nextError instanceof ApiError &&
        ["AUTH_005", "USER_002", "AUTH_001"].includes(nextError.code)
      ) {
        onSessionExpired();
      }
    } finally {
      setChanging(false);
    }
  };

  const live = receiving === "ON";

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="wordmark">ERSync</div>
        <div className="topbar-divider" />
        <div className="facility-title">병원 공용 계정 · 응급실</div>
        <div className={`live-chip live-chip-${receiving.toLowerCase()}`}>
          <span />
          {live
            ? "실시간 수신 중"
            : receiving === "OFF"
              ? "수신 일시 중지"
              : "수신 상태 확인 필요"}
        </div>
        <nav className="topnav" aria-label="병원 메뉴">
          <button
            className={view === "dashboard" ? "active" : ""}
            onClick={() => setView("dashboard")}
          >
            이송 요청
          </button>
          <button
            className={view === "account" ? "active" : ""}
            onClick={() => setView("account")}
          >
            계정 정보
          </button>
        </nav>
        <div className="topbar-divider" />
        <time className="clock">{clock}</time>
        <div className="account-mini">
          <span>{(session.loginId || "병").slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{session.loginId || "병원 계정"}</strong>
            <small>HOSPITAL STAFF</small>
          </div>
        </div>
      </header>

      {view === "dashboard" ? (
        <section className="dashboard-grid">
          <div className="request-panel">
            <div className="request-panel-head">
              <div>
                <span className="eyebrow">이송 요청</span>
                <h1>새로운 요청을 기다리고 있어요</h1>
                <p>
                  이송 요청 API가 전달되면 이 영역에 환자 상세와 수락·거절 기능이
                  연결됩니다.
                </p>
              </div>
              <span className="count-pill">0건 대기</span>
            </div>
            <div className="empty-stage">
              <div className="empty-symbol">ER</div>
              <strong>현재 연결된 이송 요청이 없습니다</strong>
              <span>
                이번 단계에서는 인증과 병원 수신 상태 기능만 실제 서버에 연결되어
                있습니다.
              </span>
            </div>
          </div>

          <aside className="receiving-card">
            <span className="eyebrow">신규 요청 수신</span>
            <h2>
              {live
                ? "구급대 요청을 받고 있어요"
                : receiving === "OFF"
                  ? "현재 요청을 받지 않아요"
                  : "수신 상태를 선택해 주세요"}
            </h2>
            <p>
              OFF로 변경해도 이미 생성된 요청은 철회되지 않습니다. 이 브라우저에는
              마지막 설정값이 표시됩니다.
            </p>
            <div className="status-selector" aria-label="수신 상태 변경">
              <button
                className={receiving === "ON" ? "selected status-on" : ""}
                disabled={changing}
                onClick={() => void setStatus("ON")}
              >
                <span>ON</span>
                <small>신규 요청 수신</small>
              </button>
              <button
                className={receiving === "OFF" ? "selected status-off" : ""}
                disabled={changing}
                onClick={() => void setStatus("OFF")}
              >
                <span>OFF</span>
                <small>신규 요청 제외</small>
              </button>
            </div>
            {changing ? <div className="inline-loading">상태 변경 중…</div> : null}
            <ErrorNotice error={error} />
            <div className="status-footnote">
              <span className={`status-dot status-dot-${receiving.toLowerCase()}`} />
              {receiving === "UNKNOWN"
                ? "백엔드에 현재 상태 조회 API가 없어 최초 접속 시 확인이 필요합니다."
                : `최근 설정 기준 · 수신 ${receiving}`}
            </div>
          </aside>
        </section>
      ) : (
        <section className="account-layout">
          <div className="account-card">
            <div className="account-identity">
              <div>{(session.loginId || "병").slice(0, 1).toUpperCase()}</div>
              <span>
                <h1>병원 공용 계정</h1>
                <p>{session.loginId || "로그인 계정"}</p>
              </span>
            </div>
            <dl className="detail-list">
              <div>
                <dt>역할</dt>
                <dd>병원 관계자</dd>
              </div>
              <div>
                <dt>조직 ID</dt>
                <dd>{session.organizationId || "-"}</dd>
              </div>
              <div>
                <dt>계정 ID</dt>
                <dd>{session.accountId}</dd>
              </div>
              <div>
                <dt>Access Token 만료</dt>
                <dd>{formatDate(session.accessTokenExpiresAt)}</dd>
              </div>
            </dl>
            <button className="button button-danger button-full" onClick={onLogout}>
              로그아웃
            </button>
          </div>
          <div className="info-card">
            <span className="eyebrow">연동 상태</span>
            <h2>기능 1 연결 완료</h2>
            <ul className="check-list">
              <li>병원 로그인과 토큰 자동 교체</li>
              <li>인증된 병원의 수신 ON/OFF 변경</li>
              <li>인증 만료·비활성 계정 자동 로그아웃</li>
            </ul>
            <p>
              환자 요청, 병상, 진료과, 알림 기능은 해당 백엔드 문서가 전달될 때
              순차적으로 연결됩니다.
            </p>
          </div>
        </section>
      )}
    </main>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    sessionApi
      .get()
      .then((result) => setSession(result.session))
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!session) return;
    const expiresAt = new Date(session.accessTokenExpiresAt).getTime();
    const delay = Math.max(5_000, expiresAt - Date.now() - 60_000);
    const timer = window.setTimeout(() => {
      sessionApi
        .refresh()
        .then((result) => setSession(result.session))
        .catch(() => setSession(null));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [session]);

  const logout = async () => {
    try {
      await sessionApi.logout();
    } finally {
      setSession(null);
    }
  };

  if (loading) return <LoadingScreen />;
  if (!session) return <AuthScreen onAuthenticated={setSession} />;
  if (session.role === "HOSPITAL_STAFF") {
    return (
      <HospitalApp
        session={session}
        onLogout={() => void logout()}
        onSessionExpired={() => setSession(null)}
      />
    );
  }

  return (
    <main className="role-blocked">
      <div className="brand-mark">ER</div>
      <h1>병원 관계자 전용 웹입니다</h1>
      <p>관리자와 구급대원 계정은 각 전용 서비스에서 로그인해 주세요.</p>
      <button className="button button-primary" onClick={() => void logout()}>
        로그아웃
      </button>
    </main>
  );
}
