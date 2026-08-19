"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  ApiError,
  GeocodedAddress,
  hospitalApi,
  HospitalProfile,
} from "../lib/api";
import {
  HOSPITAL_ADDRESS_MAX_LENGTH,
  HOSPITAL_CONTACT_PATTERN_SOURCE,
  HOSPITAL_DETAIL_ADDRESS_MAX_LENGTH,
  formatHospitalContactInput,
} from "../lib/hospital-signup-contract.js";
import {
  createHospitalProfileUpdateRequest,
  getHospitalProfileUpdateErrors,
} from "../lib/hospital-profile-contract.js";

type ProfileUpdate = Parameters<typeof hospitalApi.updateProfile>[0];

const PROFILE_ERROR_MESSAGES: Record<string, string> = {
  COMMON_001: "입력값을 확인한 뒤 다시 저장해 주세요.",
  AUTH_001: "로그인이 필요합니다.",
  AUTH_002: "로그인이 만료되었습니다. 다시 로그인해 주세요.",
  AUTH_003: "병원 관계자만 병원 정보를 수정할 수 있습니다.",
  COMMON_004: "계정과 병원 정보가 일치하지 않습니다. 운영 담당자에게 문의해 주세요.",
  HOSPITAL_001: "연결된 병원 프로필이 없습니다. 운영 담당자에게 문의해 주세요.",
  GEOCODING_NOT_CONFIGURED:
    "주소 검색이 아직 설정되지 않았습니다. 관리자에게 문의해 주세요.",
  GEOCODING_UPSTREAM_ERROR:
    "주소 검색을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
};

function ProfileErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  const apiError = error instanceof ApiError ? error : null;
  const message = apiError
    ? PROFILE_ERROR_MESSAGES[apiError.code] || apiError.message
    : error instanceof Error
      ? error.message
      : "요청을 처리하지 못했습니다.";

  return (
    <div className="notice notice-error profile-editor-notice" role="alert">
      <strong>{message}</strong>
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

export function HospitalProfileEditor({
  profile,
  loading,
  saving,
  disabled,
  onDirtyChange,
  onSave,
}: {
  profile: HospitalProfile | null;
  loading: boolean;
  saving: boolean;
  disabled: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onSave: (payload: ProfileUpdate) => Promise<HospitalProfile>;
}) {
  const [addressQuery, setAddressQuery] = useState(profile?.address || "");
  const [addressResults, setAddressResults] = useState<GeocodedAddress[]>([]);
  const [selectedAddress, setSelectedAddress] =
    useState<GeocodedAddress | null>(
      profile
        ? {
            roadAddress: profile.address,
            jibunAddress: "",
            latitude: profile.latitude,
            longitude: profile.longitude,
          }
        : null,
    );
  const [detailAddress, setDetailAddress] = useState(
    profile?.detailAddress || "",
  );
  const [contact, setContact] = useState(profile?.contact || "");
  const [searchingAddress, setSearchingAddress] = useState(false);
  const [addressError, setAddressError] = useState<unknown>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [savedMessage, setSavedMessage] = useState("");
  const [dirty, setDirty] = useState(false);

  const restoreProfile = (next: HospitalProfile) => {
    setAddressQuery(next.address);
    setAddressResults([]);
    setSelectedAddress({
      roadAddress: next.address,
      jibunAddress: "",
      latitude: next.latitude,
      longitude: next.longitude,
    });
    setDetailAddress(next.detailAddress || "");
    setContact(next.contact);
    setAddressError(null);
    setFieldErrors({});
    setSubmitError(null);
    setDirty(false);
    onDirtyChange(false);
  };

  useEffect(
    () => () => onDirtyChange(false),
    [onDirtyChange],
  );

  const values = {
    address: selectedAddress?.roadAddress || "",
    detailAddress,
    latitude: selectedAddress?.latitude ?? Number.NaN,
    longitude: selectedAddress?.longitude ?? Number.NaN,
    contact,
  };
  const validationErrors = getHospitalProfileUpdateErrors(values);
  const canSave =
    Boolean(profile) &&
    dirty &&
    !loading &&
    !saving &&
    !disabled &&
    Object.keys(validationErrors).length === 0;

  const markEdited = () => {
    setDirty(true);
    onDirtyChange(true);
    setSavedMessage("");
    setSubmitError(null);
  };

  const searchAddress = async () => {
    const query = addressQuery.trim();
    setAddressError(null);
    setAddressResults([]);

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

  const applyServerErrors = (error: unknown) => {
    if (!(error instanceof ApiError) || error.code !== "COMMON_001") return;

    const next: Record<string, string> = {};
    error.fieldErrors.forEach((fieldError) => {
      const sourceField = fieldError.field || fieldError.fieldName;
      const field = ["latitude", "longitude"].includes(sourceField || "")
        ? "address"
        : sourceField;
      if (field) next[field] = fieldError.message || "입력값을 확인해 주세요.";
    });
    setFieldErrors(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFieldErrors(validationErrors);
    setSubmitError(null);
    setSavedMessage("");
    if (!canSave) return;

    try {
      const request = createHospitalProfileUpdateRequest(values);
      const next = await onSave(request);
      restoreProfile(next);
      setSavedMessage("병원 위치와 연락처를 최신 정보로 저장했습니다.");
    } catch (nextError) {
      applyServerErrors(nextError);
      setSubmitError(nextError);
    }
  };

  if (loading && !profile) {
    return (
      <section className="account-profile-card" aria-busy="true">
        <span className="eyebrow">병원 정보</span>
        <h2>최신 프로필을 불러오는 중입니다</h2>
      </section>
    );
  }

  return (
    <section className="account-profile-card">
      <div className="profile-editor-head">
        <div>
          <span className="eyebrow">병원 정보</span>
          <h2>응급실 위치·연락처 수정</h2>
          <p>
            저장 후 새로 생성되는 병원 제안부터 변경된 정보가 적용됩니다.
          </p>
        </div>
        {profile?.updatedAt ? (
          <time dateTime={profile.updatedAt}>
            최근 변경 {new Date(profile.updatedAt).toLocaleString("ko-KR")}
          </time>
        ) : null}
      </div>

      <form className="profile-editor-form" onSubmit={submit} noValidate>
        <section className="address-field profile-address-field" aria-labelledby="profile-address-title">
          <span id="profile-address-title" className="field-label">응급실 기본주소</span>
          <div className="address-search">
            <input
              aria-invalid={Boolean(fieldErrors.address)}
              disabled={disabled || saving}
              maxLength={HOSPITAL_ADDRESS_MAX_LENGTH}
              placeholder="도로명, 건물명 또는 병원명"
              value={addressQuery}
              onChange={(event) => {
                setAddressQuery(event.target.value);
                setSelectedAddress(null);
                setAddressResults([]);
                setAddressError(null);
                setFieldErrors((current) => ({ ...current, address: "" }));
                markEdited();
              }}
            />
            <button
              className="button button-muted"
              disabled={disabled || saving || searchingAddress}
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
                  type="button"
                  onClick={() => {
                    setSelectedAddress(address);
                    setAddressQuery(address.roadAddress);
                    setAddressResults([]);
                    setFieldErrors((current) => ({ ...current, address: "" }));
                    markEdited();
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
            <div className="profile-location-preview" role="status">
              <span aria-hidden="true">⌖</span>
              <div>
                <strong>선택한 지도 위치</strong>
                <small>
                  위도 {selectedAddress.latitude.toFixed(6)} · 경도 {selectedAddress.longitude.toFixed(6)}
                </small>
              </div>
              <a
                href={`https://map.naver.com/p/search/${encodeURIComponent(selectedAddress.roadAddress)}`}
                rel="noreferrer"
                target="_blank"
              >
                지도에서 확인
              </a>
            </div>
          ) : null}
          {fieldErrors.address ? (
            <small className="field-error" role="alert">{fieldErrors.address}</small>
          ) : null}
          <ProfileErrorNotice error={addressError} />
        </section>

        <label>
          <span>상세주소 <small>선택</small></span>
          <input
            aria-invalid={Boolean(fieldErrors.detailAddress)}
            autoComplete="address-line2"
            disabled={disabled || saving || !selectedAddress}
            maxLength={HOSPITAL_DETAIL_ADDRESS_MAX_LENGTH}
            placeholder="예: 본관 1층 응급의료센터"
            value={detailAddress}
            onChange={(event) => {
              setDetailAddress(event.target.value);
              setFieldErrors((current) => ({ ...current, detailAddress: "" }));
              markEdited();
            }}
          />
          <small className="field-hint">비워서 저장하면 기존 상세주소가 삭제됩니다.</small>
          {fieldErrors.detailAddress ? (
            <small className="field-error" role="alert">{fieldErrors.detailAddress}</small>
          ) : null}
        </label>

        <label>
          <span>응급실 연락처</span>
          <input
            aria-invalid={Boolean(fieldErrors.contact)}
            autoComplete="tel"
            disabled={disabled || saving}
            inputMode="tel"
            maxLength={30}
            pattern={HOSPITAL_CONTACT_PATTERN_SOURCE}
            placeholder="02-1234-5678"
            required
            value={contact}
            onChange={(event) => {
              setContact(formatHospitalContactInput(event.target.value));
              setFieldErrors((current) => ({ ...current, contact: "" }));
              markEdited();
            }}
          />
          <small className="field-hint">숫자 또는 +로 시작하고 숫자와 하이픈만 입력할 수 있습니다.</small>
          {fieldErrors.contact ? (
            <small className="field-error" role="alert">{fieldErrors.contact}</small>
          ) : null}
        </label>

        <div className="profile-editor-actions">
          <div aria-live="polite">
            {savedMessage ? <span className="profile-save-success">{savedMessage}</span> : null}
          </div>
          <button
            className="button button-muted"
            disabled={!dirty || saving || disabled || !profile}
            type="button"
            onClick={() => profile && restoreProfile(profile)}
          >
            변경 취소
          </button>
          <button className="button button-primary" disabled={!canSave} type="submit">
            {saving ? "저장 중…" : "변경사항 저장"}
          </button>
        </div>
        <div className="profile-submit-error">
          <ProfileErrorNotice error={submitError} />
        </div>
      </form>
    </section>
  );
}
