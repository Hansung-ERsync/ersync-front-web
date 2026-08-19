// @ts-check

import {
  HOSPITAL_ADDRESS_MAX_LENGTH,
  HOSPITAL_DETAIL_ADDRESS_MAX_LENGTH,
  isValidHospitalContact,
  normalizeHospitalContact,
} from "./hospital-signup-contract.js";

/**
 * @typedef {Object} HospitalProfileUpdateValues
 * @property {string} address
 * @property {string | null | undefined} detailAddress
 * @property {number} latitude
 * @property {number} longitude
 * @property {string} contact
 */

/**
 * nullable 상세주소는 빈 줄이나 문자열 "null" 없이 기본주소 뒤에만 붙입니다.
 *
 * @param {string | null | undefined} address
 * @param {string | null | undefined} detailAddress
 */
export function formatHospitalProfileAddress(address, detailAddress) {
  const base = address?.trim();
  if (!base) return "-";
  const detail = detailAddress?.trim();
  return detail ? `${base} ${detail}` : base;
}

/**
 * 병원 자기 프로필 전체 수정 계약에 맞춰 필드별 오류를 반환합니다.
 * 주소와 좌표는 한 세트이므로 좌표 오류도 주소 입력 영역에 표시합니다.
 *
 * @param {HospitalProfileUpdateValues} values
 * @returns {Record<string, string>}
 */
export function getHospitalProfileUpdateErrors(values) {
  /** @type {Record<string, string>} */
  const errors = {};
  const address = values.address?.trim();
  const detailAddress = values.detailAddress?.trim();

  if (!address) {
    errors.address = "검색 결과에서 응급실 주소를 선택해 주세요.";
  } else if (address.length > HOSPITAL_ADDRESS_MAX_LENGTH) {
    errors.address = "응급실 기본주소는 255자 이하로 선택해 주세요.";
  }

  if (
    detailAddress &&
    detailAddress.length > HOSPITAL_DETAIL_ADDRESS_MAX_LENGTH
  ) {
    errors.detailAddress = "세부주소는 200자 이하로 입력해 주세요.";
  }

  if (
    !Number.isFinite(values.latitude) ||
    values.latitude < -90 ||
    values.latitude > 90 ||
    !Number.isFinite(values.longitude) ||
    values.longitude < -180 ||
    values.longitude > 180
  ) {
    errors.address = "검색 결과에서 유효한 지도 위치를 선택해 주세요.";
  }

  if (!isValidHospitalContact(values.contact)) {
    errors.contact = "연락처 형식을 확인해 주세요. 예: 02-1234-5678";
  }

  return errors;
}

/**
 * PUT /api/v1/hospitals/me 요청 본문을 정확히 다섯 필드로 만듭니다.
 * 공백 상세주소는 기존 값을 제거하도록 null로 보냅니다.
 *
 * @param {HospitalProfileUpdateValues} values
 */
export function createHospitalProfileUpdateRequest(values) {
  const errors = getHospitalProfileUpdateErrors(values);
  const firstError = Object.values(errors)[0];
  if (firstError) throw new TypeError(firstError);

  const detailAddress = values.detailAddress?.trim();
  return {
    address: values.address.trim(),
    detailAddress: detailAddress || null,
    latitude: values.latitude,
    longitude: values.longitude,
    contact: normalizeHospitalContact(values.contact),
  };
}

/**
 * 프로필 전체 수정 중 전송 오류나 서버 오류가 나면 실제 반영 여부가
 * 불명확하므로 GET으로 서버의 최종 프로필을 다시 확인합니다.
 *
 * @param {number | null | undefined} status
 */
export function shouldReloadProfileAfterUpdateError(status) {
  return status == null || status >= 500;
}

/**
 * 수신 상태 변경 중 전송 오류나 서버 오류가 나면 실제 반영 여부가 불명확하므로
 * 프로필 GET으로 서버의 최종 상태를 다시 확인해야 합니다.
 *
 * @param {number | null | undefined} status
 */
export function shouldReloadProfileAfterReceivingStatusError(status) {
  return status == null || status >= 500;
}

/**
 * 신규 요청 수신 설정과 기존 이송 SSE 연결을 같은 상태처럼 보이지 않도록
 * 병원 수신 상태를 기준으로 연결 표시 문구를 구분합니다.
 *
 * @param {"ON" | "OFF" | "UNKNOWN"} receivingStatus
 * @param {"CONNECTING" | "CONNECTED" | "RECONNECTING"} streamState
 */
export function getRealtimeConnectionPresentation(receivingStatus, streamState) {
  if (receivingStatus === "UNKNOWN") {
    return { label: "수신 상태 확인 중", tone: "checking" };
  }

  const receivesNewRequests = receivingStatus === "ON";
  if (streamState === "CONNECTED") {
    return receivesNewRequests
      ? { label: "실시간 연결", tone: "connected" }
      : { label: "요청 수신 OFF", tone: "paused" };
  }
  if (streamState === "RECONNECTING") {
    return {
      label: "재연결 중",
      tone: "reconnecting",
    };
  }
  return {
    label: "연결 중",
    tone: "connecting",
  };
}
