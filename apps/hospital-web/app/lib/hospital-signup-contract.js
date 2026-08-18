// @ts-check

/** @type {"CONTACT_SHARING_DEV_1.0"} */
export const CONTACT_SHARING_CONSENT_VERSION = "CONTACT_SHARING_DEV_1.0";
export const HOSPITAL_ADDRESS_MAX_LENGTH = 255;
export const HOSPITAL_DETAIL_ADDRESS_MAX_LENGTH = 200;

export const HOSPITAL_CONTACT_PATTERN_SOURCE = "[0-9+][0-9-]{7,29}";

export const INVITATION_ERROR_MESSAGES = Object.freeze({
  INVITATION_001: "가입 코드를 찾을 수 없습니다. 코드를 다시 확인해 주세요.",
  INVITATION_002: "만료된 가입 코드입니다. 새 코드를 발급받아 주세요.",
  INVITATION_003:
    "이미 사용된 가입 코드입니다. 기존 계정으로 로그인하거나 관리자에게 문의해 주세요.",
  INVITATION_004: "폐기된 가입 코드입니다. 새 코드를 발급받아 주세요.",
});

const HOSPITAL_CONTACT_PATTERN = /^[0-9+][0-9-]{7,29}$/;

/**
 * 국내 전화번호는 입력 중 지역번호·국번 길이에 맞춰 하이픈을 붙입니다.
 * 국제번호는 선행 +와 사용자가 입력한 하이픈을 보존합니다.
 *
 * @param {string} value
 */
export function formatHospitalContactInput(value) {
  const input = value.trimStart();
  if (input.startsWith("+")) {
    return `+${input.slice(1).replace(/[^0-9-]/g, "")}`.slice(0, 30);
  }

  const digits = input.replace(/\D/g, "").slice(0, 11);
  if (digits.startsWith("02")) {
    if (digits.length <= 2) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
    if (digits.length <= 9) {
      return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
    }
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  if (digits.length <= 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

/**
 * 국내 번호는 화면과 동일한 하이픈 형식으로 정리하고, 국제번호의 선행 +와
 * 사용자가 입력한 하이픈은 보존합니다.
 *
 * @param {string} value
 */
export function normalizeHospitalContact(value) {
  return formatHospitalContactInput(value.trim());
}

/**
 * @param {string} value
 */
export function isValidHospitalContact(value) {
  const contact = normalizeHospitalContact(value);
  const digitCount = contact.replace(/\D/g, "").length;
  return digitCount >= 8 && HOSPITAL_CONTACT_PATTERN.test(contact);
}

/**
 * @param {{
 *   invitationCode: string;
 *   organizationName: string;
 *   loginId: string;
 *   password: string;
 *   address: string;
 *   detailAddress?: string;
 *   latitude: number;
 *   longitude: number;
 *   contact: string;
 * }} values
 * @param {boolean} contactSharingConsentAccepted
 * @returns {{
 *   invitationCode: string;
 *   organizationName: string;
 *   loginId: string;
 *   password: string;
 *   address: string;
 *   detailAddress?: string;
 *   latitude: number;
 *   longitude: number;
 *   contact: string;
 *   contactSharingConsentAccepted: true;
 *   contactSharingConsentVersion: "CONTACT_SHARING_DEV_1.0";
 * }}
 */
export function createHospitalSignupRequest(
  values,
  contactSharingConsentAccepted,
) {
  if (!contactSharingConsentAccepted) {
    throw new TypeError("연락처 제공 동의가 필요합니다.");
  }

  const contact = normalizeHospitalContact(values.contact);
  if (!isValidHospitalContact(contact)) {
    throw new TypeError("응급실 연락처 형식이 올바르지 않습니다.");
  }

  const address = values.address.trim();
  if (!address) {
    throw new TypeError("응급실 기본주소를 입력해 주세요.");
  }
  if (address.length > HOSPITAL_ADDRESS_MAX_LENGTH) {
    throw new TypeError("응급실 기본주소는 255자 이하로 입력해 주세요.");
  }

  const detailAddress = values.detailAddress?.trim();
  if (
    detailAddress &&
    detailAddress.length > HOSPITAL_DETAIL_ADDRESS_MAX_LENGTH
  ) {
    throw new TypeError("세부주소는 200자 이하로 입력해 주세요.");
  }

  const request = {
    ...values,
    address,
    contact,
    contactSharingConsentAccepted: true,
    contactSharingConsentVersion: CONTACT_SHARING_CONSENT_VERSION,
  };
  if (detailAddress) request.detailAddress = detailAddress;
  else delete request.detailAddress;

  return request;
}
