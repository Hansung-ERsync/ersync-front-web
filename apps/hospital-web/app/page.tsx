"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  errorMessage,
  hospitalApi,
  HospitalProfile,
  Session,
  sessionApi,
} from "./lib/api";
import {
  CONTACT_SHARING_CONSENT_VERSION,
  HOSPITAL_CONTACT_PATTERN_SOURCE,
  createHospitalSignupRequest,
  isValidHospitalContact,
} from "./lib/hospital-signup-contract.js";
import { HospitalOffers } from "./components/HospitalOffers";

type AuthView = "login" | "signup";
type HospitalView = "dashboard" | "account";

function isCoordinateInRange(value: string, min: number, max: number) {
  if (!value.trim()) return false;
  const coordinate = Number(value);
  return Number.isFinite(coordinate) && coordinate >= min && coordinate <= max;
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
  const [contactSharingConsentAccepted, setContactSharingConsentAccepted] =
    useState(false);

  const update = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const canSubmit =
    form.invitationCode.trim().length > 0 &&
    form.organizationName.trim().length > 0 &&
    form.organizationName.trim().length <= 100 &&
    /^[a-z0-9]{4,30}$/.test(form.loginId.trim()) &&
    form.password.length >= 8 &&
    form.password.length <= 64 &&
    form.address.trim().length > 0 &&
    form.address.trim().length <= 255 &&
    isCoordinateInRange(form.latitude, -90, 90) &&
    isCoordinateInRange(form.longitude, -180, 180) &&
    isValidHospitalContact(form.contact) &&
    contactSharingConsentAccepted;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    void onSubmit(
      createHospitalSignupRequest(
        {
          invitationCode: form.invitationCode.trim(),
          organizationName: form.organizationName.trim(),
          loginId: form.loginId.trim().toLowerCase(),
          password: form.password,
          address: form.address.trim(),
          latitude: Number(form.latitude),
          longitude: Number(form.longitude),
          contact: form.contact,
        },
        contactSharingConsentAccepted,
      ),
    );
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
          <span>응급실 연락처</span>
          <input
            autoComplete="tel"
            inputMode="tel"
            maxLength={30}
            pattern={HOSPITAL_CONTACT_PATTERN_SOURCE}
            placeholder="02-1234-5678"
            required
            title="숫자 또는 +로 시작하고, 이후에는 숫자와 하이픈만 7~29자 입력해 주세요."
            value={form.contact}
            onChange={(event) => update("contact", event.target.value)}
          />
          <small className="field-hint">
            숫자 또는 +로 시작해 숫자와 하이픈만 입력해 주세요. 예: 02-1234-5678
          </small>
        </label>
        <section
          aria-labelledby="contact-sharing-consent-title"
          className="consent-panel field-span-2"
        >
          <div className="consent-panel-head">
            <div>
              <span className="consent-kicker">필수 동의</span>
              <h2 id="contact-sharing-consent-title">응급실 연락처 수집·제공</h2>
            </div>
            <code>{CONTACT_SHARING_CONSENT_VERSION}</code>
          </div>
          <p>
            ERSync는 병원 응급실 연락처를 수집하고, 이송 요청과 관련된 구급대원이
            병원에 연락할 수 있도록 해당 연락처를 제공합니다.
          </p>
          <p className="consent-dev-note">
            현재 문구는 개발 서버 연동 검증용이며 실제 운영 전 법적 검토를 거친
            문구와 새 버전으로 함께 변경됩니다.
          </p>
          <label className="consent-check">
            <input
              checked={contactSharingConsentAccepted}
              onChange={(event) =>
                setContactSharingConsentAccepted(event.target.checked)
              }
              required
              type="checkbox"
            />
            <span>위 연락처 수집 및 구급대원 제공에 동의합니다. (필수)</span>
          </label>
        </section>
        {error instanceof ApiError && error.code === "COMMON_001" ? (
          <p className="validation-help field-span-2" role="status">
            입력 항목과 연락처 형식, 동의 체크 및 문구 버전을 다시 확인해 주세요.
          </p>
        ) : null}
        <div className="form-actions field-span-2">
          <button className="button button-muted" type="button" onClick={onBack}>
            취소
          </button>
          <button
            className="button button-primary"
            disabled={busy || !canSubmit}
            type="submit"
          >
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
  const [profile, setProfile] = useState<HospitalProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [clock, setClock] = useState("");
  const expiredRef = useRef(onSessionExpired);
  const changingRef = useRef(false);
  const profileOperationRef = useRef(0);

  useEffect(() => {
    expiredRef.current = onSessionExpired;
  }, [onSessionExpired]);

  const loadProfile = useCallback(async () => {
    if (changingRef.current) return;
    const operation = ++profileOperationRef.current;
    setProfileLoading(true);
    setError(null);
    try {
      const next = await hospitalApi.profile();
      if (operation === profileOperationRef.current) {
        setProfile(next);
        setReceiving(next.receivingStatus);
      }
    } catch (nextError) {
      if (operation === profileOperationRef.current) setError(nextError);
      if (
        nextError instanceof ApiError &&
        ["AUTH_001", "AUTH_002", "AUTH_005", "USER_002"].includes(
          nextError.code,
        )
      ) {
        expiredRef.current();
      }
    } finally {
      if (operation === profileOperationRef.current) setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(
      () => setClock(new Date().toLocaleTimeString("ko-KR", { hour12: false })),
      1000,
    );
    const restoreTimer = window.setTimeout(() => {
      setClock(new Date().toLocaleTimeString("ko-KR", { hour12: false }));
      void loadProfile();
    }, 0);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(restoreTimer);
    };
  }, [loadProfile, session.accessTokenExpiresAt]);

  useEffect(() => {
    const refreshProfile = () => {
      if (document.visibilityState === "visible") void loadProfile();
    };
    window.addEventListener("focus", refreshProfile);
    document.addEventListener("visibilitychange", refreshProfile);
    return () => {
      window.removeEventListener("focus", refreshProfile);
      document.removeEventListener("visibilitychange", refreshProfile);
    };
  }, [loadProfile]);

  const setStatus = async (status: "ON" | "OFF") => {
    if (!profile || profileLoading || changingRef.current) return;
    let recoverServerState = false;
    const operation = ++profileOperationRef.current;
    changingRef.current = true;
    setChanging(true);
    setError(null);
    try {
      const result = await hospitalApi.setReceivingStatus(status);
      if (operation === profileOperationRef.current) {
        setReceiving(result.status);
        setProfile((current) =>
          current
            ? {
                ...current,
                receivingStatus: result.status,
                updatedAt: result.updatedAt,
              }
            : current,
        );
      }
    } catch (nextError) {
      if (operation === profileOperationRef.current) setError(nextError);
      recoverServerState = !(nextError instanceof ApiError);
      if (
        nextError instanceof ApiError &&
        ["AUTH_001", "AUTH_002", "AUTH_005", "USER_002"].includes(nextError.code)
      ) {
        onSessionExpired();
      }
    } finally {
      changingRef.current = false;
      setChanging(false);
      if (recoverServerState) void loadProfile();
    }
  };

  const live = receiving === "ON";

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="wordmark">ERSync</div>
        <div className="topbar-divider" />
        <div className="facility-title">
          {profile?.organizationName || "병원 공용 계정"} · 응급실
        </div>
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
          <span>{(profile?.loginId || session.loginId || "병").slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{profile?.loginId || session.loginId || "병원 계정"}</strong>
            <small>HOSPITAL STAFF</small>
          </div>
        </div>
      </header>

      {view === "dashboard" ? (
        <section className="dashboard-grid">
          <HospitalOffers onSessionExpired={onSessionExpired} />

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
              OFF로 변경해도 이미 수락했거나 이동 중인 요청은 유지됩니다. 현재
              표시는 서버에 저장된 실제 상태입니다.
            </p>
            <div className="status-selector" aria-label="수신 상태 변경">
              <button
                className={receiving === "ON" ? "selected status-on" : ""}
                disabled={changing || profileLoading || !profile}
                onClick={() => void setStatus("ON")}
              >
                <span>ON</span>
                <small>신규 요청 수신</small>
              </button>
              <button
                className={receiving === "OFF" ? "selected status-off" : ""}
                disabled={changing || profileLoading || !profile}
                onClick={() => void setStatus("OFF")}
              >
                <span>OFF</span>
                <small>신규 요청 제외</small>
              </button>
            </div>
            {profileLoading ? (
              <div className="inline-loading">서버 수신 상태 확인 중…</div>
            ) : changing ? (
              <div className="inline-loading">상태 변경 중…</div>
            ) : null}
            <ErrorNotice error={error} />
            <div className="status-footnote">
              <span className={`status-dot status-dot-${receiving.toLowerCase()}`} />
              {receiving === "UNKNOWN"
                ? "서버의 현재 수신 상태를 확인하지 못했습니다."
                : `서버 최종 상태 · 수신 ${receiving}`}
            </div>
          </aside>
        </section>
      ) : (
        <section className="account-layout">
          <div className="account-card">
            <div className="account-identity">
              <div>{(profile?.loginId || session.loginId || "병").slice(0, 1).toUpperCase()}</div>
              <span>
                <h1>{profile?.organizationName || "병원 공용 계정"}</h1>
                <p>{profile?.loginId || session.loginId || "로그인 계정"}</p>
              </span>
            </div>
            <dl className="detail-list">
              <div>
                <dt>역할</dt>
                <dd>병원 관계자</dd>
              </div>
              <div>
                <dt>응급실 주소</dt>
                <dd>{profile?.address || "-"}</dd>
              </div>
              <div>
                <dt>응급실 연락처</dt>
                <dd>{profile?.contact || "-"}</dd>
              </div>
              <div>
                <dt>응급실 좌표</dt>
                <dd>
                  {profile
                    ? `${profile.latitude.toFixed(6)}, ${profile.longitude.toFixed(6)}`
                    : "-"}
                </dd>
              </div>
              <div>
                <dt>서버 수신 상태</dt>
                <dd>{receiving === "UNKNOWN" ? "확인 필요" : receiving}</dd>
              </div>
              <div>
                <dt>프로필 갱신 시각</dt>
                <dd>{profile ? formatDate(profile.updatedAt) : "-"}</dd>
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
            <h2>기능 1~6 및 인증 보완 계약 연결 완료</h2>
            <ul className="check-list">
              <li>응급실 연락처와 필수 제공 동의가 포함된 병원 가입</li>
              <li>병원 로그인과 토큰 자동 교체</li>
              <li>인증된 병원의 수신 ON/OFF 변경</li>
              <li>병원 제안 목록·상세와 수락·거절 응답</li>
              <li>현재 목적지 표시와 병원 수락 철회</li>
              <li>실제 도로 거리·ETA와 실시간 상태 갱신</li>
              <li>인계 확인과 완료·취소 이력 보호</li>
              <li>서버 기준 병원 정보와 수신 상태 복구</li>
              <li>병원 역할이 고정된 로그인 요청</li>
              <li>인증 만료·비활성 계정 자동 로그아웃</li>
            </ul>
            <p>
              병상, 진료과와 이후 알림 기능은 해당 백엔드 문서가 전달될 때
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
