"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  errorMessage,
  GeocodedAddress,
  hospitalApi,
  HospitalProfile,
  InvitationValidation,
  Session,
  sessionApi,
} from "./lib/api";
import {
  HOSPITAL_CONTACT_PATTERN_SOURCE,
  HOSPITAL_ADDRESS_MAX_LENGTH,
  HOSPITAL_DETAIL_ADDRESS_MAX_LENGTH,
  INVITATION_ERROR_MESSAGES,
  createHospitalSignupRequest,
  formatHospitalContactInput,
  isValidHospitalContact,
} from "./lib/hospital-signup-contract.js";
import {
  formatHospitalProfileAddress,
  shouldReloadProfileAfterUpdateError,
  shouldReloadProfileAfterReceivingStatusError,
} from "./lib/hospital-profile-contract.js";
import { HospitalOffers } from "./components/HospitalOffers";
import { HospitalProfileEditor } from "./components/HospitalProfileEditor";

type AuthView = "login" | "signup";
type HospitalView = "dashboard" | "account";

function friendlyErrorMessage(error: unknown) {
  if (!(error instanceof ApiError)) return errorMessage(error);

  const messages: Record<string, string> = {
    AUTH_004: "아이디 또는 비밀번호가 올바르지 않습니다.",
    USER_002: "사용할 수 없는 계정입니다. 관리자에게 문의해 주세요.",
    USER_003: "이미 사용 중인 아이디입니다.",
    ...INVITATION_ERROR_MESSAGES,
    GEOCODING_NOT_CONFIGURED:
      "주소 검색이 아직 설정되지 않았습니다. 관리자에게 문의해 주세요.",
    GEOCODING_UPSTREAM_ERROR:
      "주소 검색을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  };

  return messages[error.code] || error.message || "요청을 처리하지 못했습니다.";
}

function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  const apiError = error instanceof ApiError ? error : null;

  return (
    <div className="notice notice-error" role="alert">
      <strong>{friendlyErrorMessage(error)}</strong>
      {apiError?.code ? (
        <details className="support-details">
          <summary>문의 정보</summary>
          <span>오류 코드 {apiError.code}</span>
          {apiError.traceId ? <span>traceId {apiError.traceId}</span> : null}
        </details>
      ) : null}
    </div>
  );
}

function LoadingScreen() {
  return (
    <main className="loading-screen">
      <div className="brand-mark">ER</div>
      <strong>로그인 정보 확인 중</strong>
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
        `${result.organizationName} 계정이 생성되었습니다. 처음에는 요청 수신이 꺼져 있습니다.`,
      );
      setView("login");
    } catch (nextError) {
      setError(nextError);
      throw nextError;
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
              병원 응급실
              <br />
              로그인
            </h1>
            <p className="auth-subtitle">병원 관계자 전용 계정 로그인</p>

            {signupComplete ? (
              <div className="notice notice-success" role="status">
                <strong>병원 계정 생성 완료</strong>
                <span>{signupComplete}</span>
              </div>
            ) : null}
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
              <ErrorNotice error={error} />
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
  onBack,
  onSubmit,
}: {
  busy: boolean;
  onBack: () => void;
  onSubmit: (payload: Parameters<typeof hospitalApi.signup>[0]) => Promise<void>;
}) {
  const [step, setStep] = useState<"code" | "details">("code");
  const [validation, setValidation] = useState<InvitationValidation | null>(null);
  const [checkingCode, setCheckingCode] = useState(false);
  const [codeError, setCodeError] = useState<unknown>(null);
  const [form, setForm] = useState({
    invitationCode: "",
    loginId: "",
    password: "",
    detailAddress: "",
    contact: "",
  });
  const [addressQuery, setAddressQuery] = useState("");
  const [addressResults, setAddressResults] = useState<GeocodedAddress[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<GeocodedAddress | null>(
    null,
  );
  const [searchingAddress, setSearchingAddress] = useState(false);
  const [addressError, setAddressError] = useState<unknown>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [contactSharingConsentAccepted, setContactSharingConsentAccepted] =
    useState(false);

  const update = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const applySignupError = (nextError: unknown) => {
    if (!(nextError instanceof ApiError)) {
      setSubmitError(nextError);
      return;
    }

    if (nextError.code === "USER_003") {
      setFieldErrors((current) => ({
        ...current,
        loginId: "이미 사용 중인 아이디입니다.",
      }));
      return;
    }

    if (nextError.code.startsWith("INVITATION_")) {
      setValidation(null);
      setStep("code");
      setCodeError(nextError);
      return;
    }

    if (nextError.code === "COMMON_001") {
      const next: Record<string, string> = {};
      nextError.fieldErrors.forEach((fieldError) => {
        const field = fieldError.field || fieldError.fieldName;
        if (field) next[field] = fieldError.message || "입력값을 확인해 주세요.";
      });
      setFieldErrors(next);
      if (Object.keys(next).length === 0) setSubmitError(nextError);
      return;
    }

    setSubmitError(nextError);
  };

  const checkInvitation = async (event: FormEvent) => {
    event.preventDefault();
    const invitationCode = form.invitationCode.trim();
    setCodeError(null);

    if (!invitationCode) {
      setCodeError(new Error("가입 코드를 입력해 주세요."));
      return;
    }

    setCheckingCode(true);
    try {
      const result = await hospitalApi.validateInvitation(invitationCode);
      if (result.role !== "HOSPITAL_STAFF") {
        setCodeError(
          new Error("병원 계정용 가입 코드가 아닙니다. 발급처에 확인해 주세요."),
        );
        return;
      }
      setValidation(result);
      setForm((current) => ({ ...current, invitationCode }));
      setStep("details");
    } catch (nextError) {
      setCodeError(nextError);
    } finally {
      setCheckingCode(false);
    }
  };

  const searchAddress = async () => {
    const query = addressQuery.trim();
    setAddressError(null);
    setAddressResults([]);
    setSelectedAddress(null);

    if (query.length < 2) {
      setAddressError(new Error("주소를 두 글자 이상 입력해 주세요."));
      return;
    }

    setSearchingAddress(true);
    try {
      const result = await hospitalApi.geocode(query);
      setAddressResults(result.items);
      if (result.items.length === 0) {
        setAddressError(
          new Error("검색 결과가 없습니다. 도로명이나 건물명을 다시 확인해 주세요."),
        );
      }
    } catch (nextError) {
      setAddressError(nextError);
    } finally {
      setSearchingAddress(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!/^[a-z0-9]{4,30}$/.test(form.loginId.trim())) {
      nextErrors.loginId = "영문 소문자와 숫자로 4~30자 입력해 주세요.";
    }
    if (form.password.length < 8 || form.password.length > 64) {
      nextErrors.password = "비밀번호를 8~64자로 입력해 주세요.";
    }
    if (!selectedAddress) {
      nextErrors.address = "검색 결과에서 응급실 주소를 선택해 주세요.";
    } else if (
      selectedAddress.roadAddress.trim().length > HOSPITAL_ADDRESS_MAX_LENGTH
    ) {
      nextErrors.address = "응급실 기본주소는 255자 이하로 선택해 주세요.";
    }
    if (
      form.detailAddress.trim().length > HOSPITAL_DETAIL_ADDRESS_MAX_LENGTH
    ) {
      nextErrors.detailAddress = "세부주소는 200자 이하로 입력해 주세요.";
    }
    if (!isValidHospitalContact(form.contact)) {
      nextErrors.contact = "연락처 형식을 확인해 주세요. 예: 02-1234-5678";
    }
    if (!contactSharingConsentAccepted) {
      nextErrors.consent = "필수 동의 내용을 확인하고 체크해 주세요.";
    }
    setFieldErrors(nextErrors);
    setSubmitError(null);

    if (Object.keys(nextErrors).length > 0 || !validation || !selectedAddress) {
      return;
    }

    try {
      await onSubmit(
        createHospitalSignupRequest(
        {
          invitationCode: form.invitationCode,
          organizationName: validation.organizationName,
          loginId: form.loginId.trim().toLowerCase(),
          password: form.password,
          address: selectedAddress.roadAddress,
          detailAddress: form.detailAddress,
          latitude: selectedAddress.latitude,
          longitude: selectedAddress.longitude,
          contact: form.contact,
        },
          contactSharingConsentAccepted,
        ),
      );
    } catch (nextError) {
      applySignupError(nextError);
    }
  };

  return (
    <>
      <button className="back-button" type="button" onClick={onBack}>
        ← 로그인으로
      </button>
      <h1 className="signup-title">병원 공용 계정 만들기</h1>
      <p className="auth-subtitle">
        {step === "code"
          ? "관리자가 발급한 가입 코드를 입력해 주세요."
          : "응급실 정보와 로그인 정보를 입력해 주세요."}
      </p>

      <div className="signup-progress" aria-label="회원가입 단계">
        <span className={step === "code" ? "active" : "complete"}>1 가입 코드</span>
        <i />
        <span className={step === "details" ? "active" : ""}>2 계정 정보</span>
      </div>

      {step === "code" ? (
        <form className="invitation-form" onSubmit={checkInvitation}>
          <label>
            <span>가입 코드</span>
            <input
              autoComplete="off"
              autoFocus
              placeholder="대소문자를 구분해 입력해 주세요"
              value={form.invitationCode}
              onChange={(event) => update("invitationCode", event.target.value)}
            />
            <small className="field-hint">
              가입 코드는 계정 생성 시 사용됩니다.
            </small>
          </label>
          <ErrorNotice error={codeError} />
          <button
            className="button button-primary button-large"
            disabled={checkingCode}
            type="submit"
          >
            {checkingCode ? "가입 코드 확인 중…" : "가입 코드 확인"}
          </button>
        </form>
      ) : (
      <form className="signup-grid" onSubmit={submit} noValidate>
        <section className="verified-organization field-span-2">
          <span>가입할 병원</span>
          <strong>{validation?.organizationName}</strong>
          <button
            className="text-button"
            type="button"
            onClick={() => {
              setStep("code");
              setValidation(null);
              setCodeError(null);
            }}
          >
            다른 코드 확인
          </button>
        </section>
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
            aria-invalid={Boolean(fieldErrors.loginId)}
            onChange={(event) => {
              update("loginId", event.target.value.toLowerCase());
              setFieldErrors((current) => ({ ...current, loginId: "" }));
            }}
          />
          <small className="field-hint">
            아이디는 영문 소문자와 숫자만 가능하며, 대문자는 자동으로 소문자로 바뀝니다.
          </small>
          {fieldErrors.loginId ? (
            <small className="field-error" role="alert">{fieldErrors.loginId}</small>
          ) : null}
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
            aria-invalid={Boolean(fieldErrors.password)}
            onChange={(event) => {
              update("password", event.target.value);
              setFieldErrors((current) => ({ ...current, password: "" }));
            }}
          />
          <small className="field-hint">
            8~64자로 입력해 주세요. 영문 대·소문자, 숫자와 특수문자를 사용할 수 있습니다.
          </small>
          {fieldErrors.password ? (
            <small className="field-error" role="alert">{fieldErrors.password}</small>
          ) : null}
        </label>
        <section className="address-field field-span-2" aria-labelledby="address-title">
          <span id="address-title" className="field-label">응급실 주소</span>
          <div className="address-search">
            <input
              aria-invalid={Boolean(fieldErrors.address)}
              maxLength={HOSPITAL_ADDRESS_MAX_LENGTH}
              placeholder="도로명, 건물명 또는 병원명"
              value={addressQuery}
              onChange={(event) => {
                setAddressQuery(event.target.value);
                setSelectedAddress(null);
                setAddressResults([]);
                setAddressError(null);
                update("detailAddress", "");
                setFieldErrors((current) => ({ ...current, address: "" }));
              }}
            />
            <button
              className="button button-muted"
              disabled={searchingAddress}
              type="button"
              onClick={() => void searchAddress()}
            >
              {searchingAddress ? "검색 중…" : "주소 검색"}
            </button>
          </div>
          {addressResults.length > 0 ? (
            <div className="address-results" role="listbox" aria-label="주소 검색 결과">
              {addressResults.map((address) => (
                <button
                  key={`${address.roadAddress}-${address.latitude}-${address.longitude}`}
                  className={selectedAddress === address ? "selected" : ""}
                  type="button"
                  onClick={() => {
                    setSelectedAddress(address);
                    setAddressQuery(address.roadAddress);
                    setAddressResults([]);
                    setFieldErrors((current) => ({ ...current, address: "" }));
                  }}
                >
                  <strong>{address.roadAddress}</strong>
                  {address.jibunAddress && address.jibunAddress !== address.roadAddress ? (
                    <span>{address.jibunAddress}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
          {selectedAddress ? (
            <div className="selected-address" role="status">
              <span>선택한 응급실 위치</span>
              <strong>{selectedAddress.roadAddress}</strong>
            </div>
          ) : null}
          <label className="address-detail">
            <span>세부주소 <small>선택</small></span>
            <input
              autoComplete="address-line2"
              disabled={!selectedAddress}
              maxLength={HOSPITAL_DETAIL_ADDRESS_MAX_LENGTH}
              value={form.detailAddress}
              aria-invalid={Boolean(fieldErrors.detailAddress)}
              onChange={(event) => {
                update("detailAddress", event.target.value);
                setFieldErrors((current) => ({ ...current, detailAddress: "" }));
              }}
            />
            {fieldErrors.detailAddress ? (
              <small className="field-error" role="alert">
                {fieldErrors.detailAddress}
              </small>
            ) : null}
          </label>
          {fieldErrors.address ? (
            <small className="field-error" role="alert">{fieldErrors.address}</small>
          ) : null}
          <ErrorNotice error={addressError} />
        </section>
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
            aria-invalid={Boolean(fieldErrors.contact)}
            onChange={(event) => {
              update("contact", formatHospitalContactInput(event.target.value));
              setFieldErrors((current) => ({ ...current, contact: "" }));
            }}
          />
          <small className="field-hint">
            숫자를 입력하면 하이픈이 자동으로 붙습니다. 예: 010-1234-5678,
            02-1234-5678
          </small>
          {fieldErrors.contact ? (
            <small className="field-error" role="alert">{fieldErrors.contact}</small>
          ) : null}
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
          </div>
          <p>
            ERSync는 병원 응급실 연락처를 수집하고, 이송 요청과 관련된 구급대원이
            병원에 연락할 수 있도록 해당 연락처를 제공합니다.
          </p>
          <label className="consent-check">
            <input
              checked={contactSharingConsentAccepted}
              onChange={(event) => {
                setContactSharingConsentAccepted(event.target.checked);
                setFieldErrors((current) => ({ ...current, consent: "" }));
              }}
              required
              type="checkbox"
            />
            <span>위 연락처 수집 및 구급대원 제공에 동의합니다. (필수)</span>
          </label>
          {fieldErrors.consent ? (
            <small className="field-error" role="alert">{fieldErrors.consent}</small>
          ) : null}
        </section>
        <div className="form-actions field-span-2">
          <button className="button button-muted" type="button" onClick={onBack}>
            취소
          </button>
          <button
            className="button button-primary"
            disabled={busy}
            type="submit"
          >
            {busy ? "계정 생성 중…" : "병원 계정 만들기"}
          </button>
          <div className="form-submit-error">
            <ErrorNotice error={submitError} />
          </div>
        </div>
      </form>
      )}
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
  const [profileRevision, setProfileRevision] = useState(0);
  const [profileLoading, setProfileLoading] = useState(true);
  const [changing, setChanging] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [clock, setClock] = useState("");
  const expiredRef = useRef(onSessionExpired);
  const changingRef = useRef(false);
  const profileEditingRef = useRef(false);
  const profileSavingRef = useRef(false);
  const profileOperationRef = useRef(0);

  useEffect(() => {
    expiredRef.current = onSessionExpired;
  }, [onSessionExpired]);

  const loadProfile = useCallback(async (force = false, resetEditor = true) => {
    if (
      changingRef.current ||
      (!force && profileEditingRef.current) ||
      profileSavingRef.current
    ) return;
    const operation = ++profileOperationRef.current;
    setProfileLoading(true);
    setError(null);
    try {
      const next = await hospitalApi.profile();
      if (operation === profileOperationRef.current) {
        setProfile(next);
        setReceiving(next.receivingStatus);
        if (resetEditor) setProfileRevision((current) => current + 1);
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

  const setProfileEditing = useCallback((editing: boolean) => {
    profileEditingRef.current = editing;
  }, []);

  useEffect(() => {
    const timer = window.setInterval(
      () => setClock(new Date().toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })),
      1000,
    );
    const restoreTimer = window.setTimeout(() => {
      setClock(new Date().toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }));
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
    if (
      !profile ||
      profileLoading ||
      changingRef.current ||
      profileSavingRef.current
    ) return;
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
      recoverServerState = shouldReloadProfileAfterReceivingStatusError(
        nextError instanceof ApiError ? nextError.status : undefined,
      );
      if (
        nextError instanceof ApiError &&
        ["AUTH_001", "AUTH_002", "AUTH_005", "USER_002"].includes(nextError.code)
      ) {
        onSessionExpired();
      }
    } finally {
      changingRef.current = false;
      setChanging(false);
      if (recoverServerState) void loadProfile(true, false);
    }
  };

  const saveProfile = async (
    payload: Parameters<typeof hospitalApi.updateProfile>[0],
  ) => {
    if (
      !profile ||
      profileLoading ||
      changingRef.current ||
      profileSavingRef.current
    ) {
      throw new Error("병원 프로필을 불러온 뒤 다시 시도해 주세요.");
    }

    let recoverServerState = false;
    const operation = ++profileOperationRef.current;
    profileSavingRef.current = true;
    setProfileSaving(true);
    setError(null);

    try {
      const result = await hospitalApi.updateProfile(payload);
      if (operation === profileOperationRef.current) {
        setProfile(result);
        setReceiving(result.receivingStatus);
      }
      return result;
    } catch (nextError) {
      recoverServerState = shouldReloadProfileAfterUpdateError(
        nextError instanceof ApiError ? nextError.status : undefined,
      );
      if (
        nextError instanceof ApiError &&
        ["AUTH_001", "AUTH_002", "AUTH_005", "USER_002", "COMMON_004"].includes(
          nextError.code,
        )
      ) {
        expiredRef.current();
      }
      throw nextError;
    } finally {
      profileSavingRef.current = false;
      setProfileSaving(false);
      if (recoverServerState) void loadProfile(true);
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
        <button
          aria-label={live ? "신규 요청 수신 끄기" : "신규 요청 수신 켜기"}
          aria-pressed={live}
          className={`receiving-toggle ${live ? "on" : "off"}`}
          disabled={changing || profileSaving || profileLoading || !profile}
          onClick={() => void setStatus(live ? "OFF" : "ON")}
          type="button"
        >
          <span><i /></span>
          <small>{changing ? "변경 중" : `요청 수신 ${live ? "ON" : "OFF"}`}</small>
        </button>
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
            <small>병원 공용 계정</small>
          </div>
        </div>
      </header>

      {error ? <div className="app-notice"><ErrorNotice error={error} /></div> : null}

      {view === "dashboard" ? (
        <section className="hospital-dashboard">
          <HospitalOffers
            onSessionExpired={onSessionExpired}
            receivingStatus={receiving}
          />
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
                <dt>계정 유형</dt>
                <dd>병원 공용 계정</dd>
              </div>
              <div>
                <dt>응급실 주소</dt>
                <dd>
                  {formatHospitalProfileAddress(
                    profile?.address,
                    profile?.detailAddress,
                  )}
                </dd>
              </div>
              <div>
                <dt>응급실 연락처</dt>
                <dd>{profile?.contact || "-"}</dd>
              </div>
              <div>
                <dt>현재 업무 상태</dt>
                <dd>{live ? "신규 이송 요청 수신 중" : "신규 요청 수신 일시 중지"}</dd>
              </div>
            </dl>
            <button className="button button-danger button-full" onClick={onLogout}>
              로그아웃
            </button>
          </div>
          <div className="account-settings-card">
            <span className="eyebrow">업무 설정</span>
            <h2>신규 이송 요청 수신</h2>
            <p>
              수신을 꺼도 진행 중인 이송은 유지됩니다.
            </p>
            <button
              aria-pressed={live}
              className={`account-receiving-control ${live ? "on" : "off"}`}
              disabled={changing || profileSaving || profileLoading || !profile}
              onClick={() => void setStatus(live ? "OFF" : "ON")}
              type="button"
            >
              <span>
                <strong>{live ? "수신 중" : "수신 안 함"}</strong>
                <small>현재 설정</small>
              </span>
              <i><b /></i>
            </button>
            <div className="account-status-note">
              <span className={`status-dot status-dot-${receiving.toLowerCase()}`} />
              {profileLoading
                ? "수신 상태 확인 중"
                : changing
                  ? "변경 중"
                  : live
                    ? "새 이송 요청을 받고 있습니다."
                    : "새 이송 요청을 받지 않습니다."}
            </div>
          </div>
          <HospitalProfileEditor
            disabled={changing}
            key={profile ? `${profile.hospitalId}:${profileRevision}` : "loading"}
            loading={profileLoading}
            onDirtyChange={setProfileEditing}
            onSave={saveProfile}
            profile={profile}
            saving={profileSaving}
          />
        </section>
      )}
    </main>
  );
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
