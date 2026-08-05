// @ts-check

/** @type {"CONTACT_SHARING_DEV_1.0"} */
export const CONTACT_SHARING_CONSENT_VERSION = "CONTACT_SHARING_DEV_1.0";

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
 * 백엔드 계약과 동일하게 연락처 앞뒤 공백만 제거합니다.
 * 국제번호의 선행 +와 사용자가 입력한 하이픈은 보존합니다.
 *
 * @param {string} value
 */
export function normalizeHospitalContact(value) {
  return value.trim();
}

/**
 * @param {string} value
 */
export function isValidHospitalContact(value) {
  return HOSPITAL_CONTACT_PATTERN.test(normalizeHospitalContact(value));
}

/**
 * @param {{
 *   invitationCode: string;
 *   organizationName: string;
 *   loginId: string;
 *   password: string;
 *   address: string;
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

  return {
    ...values,
    contact,
    contactSharingConsentAccepted: true,
    contactSharingConsentVersion: CONTACT_SHARING_CONSENT_VERSION,
  };
}
