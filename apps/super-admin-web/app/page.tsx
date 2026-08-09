"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  adminApi,
  ApiError,
  errorMessage,
  Invitation,
  InvitationStatus,
  Organization,
  OrganizationType,
  Session,
  sessionApi,
} from "./lib/api";

const statusLabel: Record<InvitationStatus, string> = {
  AVAILABLE: "사용 가능",
  USED: "사용 완료",
  EXPIRED: "만료",
  REVOKED: "폐기",
};

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
      <strong>관리자 콘솔을 준비하고 있어요</strong>
      <span>슈퍼 관리자 세션을 확인하는 중입니다.</span>
    </main>
  );
}

function AdminLogin({ onAuthenticated }: { onAuthenticated: (session: Session) => void }) {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await sessionApi.login(loginId.trim(), password);
      onAuthenticated(result.session);
    } catch (nextError) {
      setError(nextError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-shell admin-auth-shell">
      <section className="auth-card">
        <div className="auth-brand">ERSync Admin</div>
        <h1>
          운영 관리를
          <br />
          시작하세요
        </h1>
        <p className="auth-subtitle">슈퍼 관리자 전용 로그인</p>
        <div className="admin-security-note">
          조직과 가입 코드만 관리하며 환자·위치정보에는 접근하지 않습니다.
        </div>
        <ErrorNotice error={error} />
        <form className="form-stack auth-form" onSubmit={submit}>
          <label>
            <span>관리자 아이디</span>
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
            {busy ? "확인 중…" : "슈퍼 관리자 로그인"}
          </button>
        </form>
        <div className="auth-footer">
          <span>Bootstrap 관리자 계정은 백엔드 운영 담당자에게 문의해 주세요.</span>
        </div>
      </section>
    </main>
  );
}

function AdminApp({
  session,
  onLogout,
  onSessionExpired,
}: {
  session: Session;
  onLogout: () => void;
  onSessionExpired: () => void;
}) {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [organizationPage, setOrganizationPage] = useState(0);
  const [organizationPages, setOrganizationPages] = useState(1);
  const [invitationPage, setInvitationPage] = useState(0);
  const [invitationPages, setInvitationPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState<InvitationStatus | "">("");
  const [organizationFilter, setOrganizationFilter] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [orgForm, setOrgForm] = useState<{
    name: string;
    type: OrganizationType;
  }>({ name: "", type: "HOSPITAL" });
  const [inviteForm, setInviteForm] = useState({
    organizationId: "",
    expiryOption: "THREE_DAYS" as "THREE_DAYS" | "SEVEN_DAYS" | "CUSTOM",
    customExpiresAt: "",
  });
  const organizationLoadRef = useRef(0);
  const invitationLoadRef = useRef(0);

  const handleError = useCallback(
    (nextError: unknown) => {
      setError(nextError);
      if (
        nextError instanceof ApiError &&
        ["AUTH_005", "USER_002", "AUTH_001", "AUTH_ROLE_MISMATCH"].includes(
          nextError.code,
        )
      ) {
        onSessionExpired();
      }
    },
    [onSessionExpired],
  );

  const loadOrganizations = useCallback(async (targetPage = organizationPage) => {
    const operation = ++organizationLoadRef.current;
    try {
      const result = await adminApi.organizations(targetPage, 20);
      if (operation !== organizationLoadRef.current) return;

      const totalPages = Math.max(1, result.totalPages);
      if (targetPage >= totalPages && targetPage > 0) {
        setOrganizationPage(totalPages - 1);
        return;
      }

      setOrganizations(result.items);
      setOrganizationPages(totalPages);
      setInviteForm((current) => ({
        ...current,
        organizationId:
          result.items.some(
            (organization) =>
              organization.organizationId === current.organizationId,
          )
            ? current.organizationId
            : result.items[0]?.organizationId || "",
      }));
    } catch (nextError) {
      if (operation === organizationLoadRef.current) handleError(nextError);
    }
  }, [handleError, organizationPage]);

  const loadInvitations = useCallback(async (targetPage = invitationPage) => {
    const operation = ++invitationLoadRef.current;
    try {
      const result = await adminApi.invitations(
        targetPage,
        20,
        statusFilter || undefined,
        organizationFilter || undefined,
      );
      if (operation !== invitationLoadRef.current) return;

      const totalPages = Math.max(1, result.totalPages);
      if (targetPage >= totalPages && targetPage > 0) {
        setInvitationPage(totalPages - 1);
        return;
      }

      setInvitations(result.items);
      setInvitationPages(totalPages);
    } catch (nextError) {
      if (operation === invitationLoadRef.current) handleError(nextError);
    }
  }, [handleError, invitationPage, organizationFilter, statusFilter]);

  useEffect(() => {
    const refreshAdminData = () => {
      if (document.visibilityState !== "visible") return;
      void Promise.all([loadOrganizations(), loadInvitations()]);
    };
    const initialLoadTimer = window.setTimeout(refreshAdminData, 0);
    const pollingTimer = window.setInterval(refreshAdminData, 10_000);

    window.addEventListener("focus", refreshAdminData);
    document.addEventListener("visibilitychange", refreshAdminData);

    return () => {
      window.clearTimeout(initialLoadTimer);
      window.clearInterval(pollingTimer);
      window.removeEventListener("focus", refreshAdminData);
      document.removeEventListener("visibilitychange", refreshAdminData);
    };
  }, [loadInvitations, loadOrganizations]);

  useEffect(() => {
    const updateCurrentTime = () => setCurrentTime(Date.now());
    const initialClockTimer = window.setTimeout(updateCurrentTime, 0);
    const clockTimer = window.setInterval(updateCurrentTime, 10_000);
    return () => {
      window.clearTimeout(initialClockTimer);
      window.clearInterval(clockTimer);
    };
  }, []);

  const selectedOrganization = useMemo(
    () =>
      organizations.find(
        (organization) => organization.organizationId === inviteForm.organizationId,
      ),
    [inviteForm.organizationId, organizations],
  );

  const createOrganization = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await adminApi.createOrganization(
        orgForm.name.trim(),
        orgForm.type,
      );
      setOrgForm((current) => ({ ...current, name: "" }));
      setOrganizationPage(0);
      setOrganizations((current) => [
        created,
        ...current.filter(
          (organization) =>
            organization.organizationId !== created.organizationId,
        ),
      ].slice(0, 20));
      setInviteForm((current) => ({
        ...current,
        organizationId: created.organizationId,
      }));
      await loadOrganizations(0);
    } catch (nextError) {
      handleError(nextError);
    } finally {
      setBusy(false);
    }
  };

  const createInvitation = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedOrganization) return;
    setBusy(true);
    setError(null);
    setNewCode(null);
    setCopied(false);
    try {
      const result = await adminApi.createInvitation({
        organizationId: selectedOrganization.organizationId,
        role:
          selectedOrganization.type === "HOSPITAL"
            ? "HOSPITAL_STAFF"
            : "PARAMEDIC",
        expiryOption: inviteForm.expiryOption,
        customExpiresAt:
          inviteForm.expiryOption === "CUSTOM"
            ? new Date(inviteForm.customExpiresAt).toISOString()
            : null,
      });
      setNewCode(result.code);
      setInvitationPage(0);
      await loadInvitations(0);
    } catch (nextError) {
      handleError(nextError);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    if (!window.confirm("이 가입 코드를 폐기할까요? 폐기 후에는 복구할 수 없습니다.")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const revoked = await adminApi.revokeInvitation(id);
      setInvitations((current) =>
        current.map((invitation) =>
          invitation.invitationCodeId === revoked.invitationCodeId
            ? revoked
            : invitation,
        ),
      );
      await loadInvitations(invitationPage);
    } catch (nextError) {
      handleError(nextError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <div>
          <div className="wordmark">ERSync Admin</div>
          <span>SUPER ADMIN</span>
        </div>
        <div className="admin-account">
          <span>{session.loginId || "슈퍼 관리자"}</span>
          <button className="button button-muted" onClick={onLogout}>
            로그아웃
          </button>
        </div>
      </header>

      <section className="admin-heading">
        <span className="eyebrow">조직 및 가입 관리</span>
        <h1>ERSync 운영 콘솔</h1>
        <p>병원·구급대 조직을 등록하고 일회용 가입 코드를 관리합니다.</p>
      </section>
      <ErrorNotice error={error} />

      <section className="admin-grid">
        <div className="admin-card">
          <div className="section-heading">
            <div>
              <span className="step-number">01</span>
              <h2>조직 등록</h2>
            </div>
            <span>{organizations.length}개 표시 중</span>
          </div>
          <form className="inline-form" onSubmit={createOrganization}>
            <input
              aria-label="조직 이름"
              maxLength={100}
              placeholder="조직 이름"
              required
              value={orgForm.name}
              onChange={(event) =>
                setOrgForm((current) => ({ ...current, name: event.target.value }))
              }
            />
            <select
              aria-label="조직 유형"
              value={orgForm.type}
              onChange={(event) =>
                setOrgForm((current) => ({
                  ...current,
                  type: event.target.value as OrganizationType,
                }))
              }
            >
              <option value="HOSPITAL">병원</option>
              <option value="EMS_UNIT">구급대</option>
            </select>
            <button className="button button-primary" disabled={busy}>
              등록
            </button>
          </form>
          <div className="table-list">
            {organizations.map((organization) => (
              <div className="table-row" key={organization.organizationId}>
                <span className={`org-icon org-icon-${organization.type.toLowerCase()}`}>
                  {organization.type === "HOSPITAL" ? "H" : "E"}
                </span>
                <div className="row-main">
                  <strong>{organization.name}</strong>
                  <span>{organization.organizationId}</span>
                </div>
                <span className="soft-badge">
                  {organization.type === "HOSPITAL" ? "병원" : "구급대"}
                </span>
                <time>{formatDate(organization.createdAt)}</time>
              </div>
            ))}
            {!organizations.length ? (
              <div className="table-empty">등록된 조직이 없습니다.</div>
            ) : null}
          </div>
          <Pagination
            page={organizationPage}
            totalPages={organizationPages}
            onChange={setOrganizationPage}
          />
        </div>

        <div className="admin-card">
          <div className="section-heading">
            <div>
              <span className="step-number">02</span>
              <h2>가입 코드 발급</h2>
            </div>
            <span>원문은 한 번만 표시됩니다</span>
          </div>
          {newCode ? (
            <div className="one-time-code" role="status">
              <span>지금 가입 코드를 복사해 주세요</span>
              <strong>{newCode}</strong>
              <button
                className="button button-light"
                onClick={() => {
                  void navigator.clipboard.writeText(newCode);
                  setCopied(true);
                }}
              >
                {copied ? "복사 완료" : "코드 복사"}
              </button>
            </div>
          ) : null}
          <form className="invite-form" onSubmit={createInvitation}>
            <label>
              <span>조직</span>
              <select
                required
                value={inviteForm.organizationId}
                onChange={(event) =>
                  setInviteForm((current) => ({
                    ...current,
                    organizationId: event.target.value,
                  }))
                }
              >
                <option value="">조직 선택</option>
                {organizations.map((organization) => (
                  <option key={organization.organizationId} value={organization.organizationId}>
                    {organization.name} · {organization.type === "HOSPITAL" ? "병원" : "구급대"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>발급 역할</span>
              <input
                disabled
                value={
                  selectedOrganization?.type === "EMS_UNIT"
                    ? "PARAMEDIC"
                    : "HOSPITAL_STAFF"
                }
              />
            </label>
            <label>
              <span>유효 기간</span>
              <select
                value={inviteForm.expiryOption}
                onChange={(event) =>
                  setInviteForm((current) => ({
                    ...current,
                    expiryOption: event.target.value as typeof current.expiryOption,
                  }))
                }
              >
                <option value="THREE_DAYS">3일</option>
                <option value="SEVEN_DAYS">7일</option>
                <option value="CUSTOM">직접 지정</option>
              </select>
            </label>
            {inviteForm.expiryOption === "CUSTOM" ? (
              <label>
                <span>만료 시각</span>
                <input
                  min={
                    currentTime
                      ? toLocalDateTime(new Date(currentTime + 60_000))
                      : undefined
                  }
                  required
                  type="datetime-local"
                  value={inviteForm.customExpiresAt}
                  onChange={(event) =>
                    setInviteForm((current) => ({
                      ...current,
                      customExpiresAt: event.target.value,
                    }))
                  }
                />
              </label>
            ) : null}
            <button
              className="button button-primary invite-submit"
              disabled={busy || !selectedOrganization}
            >
              일회용 코드 발급
            </button>
          </form>
        </div>
      </section>

      <section className="admin-card invitation-section">
        <div className="section-heading invitation-heading">
          <div>
            <span className="step-number">03</span>
            <h2>가입 코드 목록</h2>
          </div>
          <div className="filters">
            <select
              aria-label="조직 필터"
              value={organizationFilter}
              onChange={(event) => {
                setOrganizationFilter(event.target.value);
                setInvitationPage(0);
              }}
            >
              <option value="">전체 조직</option>
              {organizations.map((organization) => (
                <option key={organization.organizationId} value={organization.organizationId}>
                  {organization.name}
                </option>
              ))}
            </select>
            <select
              aria-label="가입 코드 상태 필터"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value as InvitationStatus | "");
                setInvitationPage(0);
              }}
            >
              <option value="">전체 상태</option>
              {(Object.keys(statusLabel) as InvitationStatus[]).map((status) => (
                <option key={status} value={status}>
                  {statusLabel[status]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="table-list invitation-list">
          {invitations.map((invitation) => {
            const canRevoke =
              invitation.status === "AVAILABLE" &&
              currentTime > 0 &&
              new Date(invitation.expiresAt).getTime() > currentTime;
            return (
              <div className="table-row" key={invitation.invitationCodeId}>
                <span className={`status-badge status-${invitation.status.toLowerCase()}`}>
                  {statusLabel[invitation.status]}
                </span>
                <div className="row-main">
                  <strong>{invitation.organizationName}</strong>
                  <span>{invitation.invitationCodeId}</span>
                </div>
                <div className="row-meta">
                  <span>{invitation.role}</span>
                  <small>{formatDate(invitation.expiresAt)} 만료</small>
                </div>
                <button
                  className="button button-danger-light"
                  disabled={!canRevoke || busy}
                  onClick={() => void revoke(invitation.invitationCodeId)}
                >
                  폐기
                </button>
              </div>
            );
          })}
          {!invitations.length ? (
            <div className="table-empty">조건에 맞는 가입 코드가 없습니다.</div>
          ) : null}
        </div>
        <Pagination
          page={invitationPage}
          totalPages={invitationPages}
          onChange={setInvitationPage}
        />
      </section>
    </main>
  );
}

function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="pagination">
      <button disabled={page <= 0} onClick={() => onChange(page - 1)}>
        이전
      </button>
      <span>
        {page + 1} / {totalPages}
      </span>
      <button disabled={page + 1 >= totalPages} onClick={() => onChange(page + 1)}>
        다음
      </button>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function toLocalDateTime(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
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
  if (!session) return <AdminLogin onAuthenticated={setSession} />;
  return (
    <AdminApp
      session={session}
      onLogout={() => void logout()}
      onSessionExpired={() => setSession(null)}
    />
  );
}
