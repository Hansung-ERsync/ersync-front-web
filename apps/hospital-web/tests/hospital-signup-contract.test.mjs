import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTACT_SHARING_CONSENT_VERSION,
  INVITATION_ERROR_MESSAGES,
  createHospitalSignupRequest,
  isValidHospitalContact,
  normalizeHospitalContact,
} from "../app/lib/hospital-signup-contract.js";

const validSignup = {
  invitationCode: "test-invitation-code",
  organizationName: "한성대학교병원",
  loginId: "hansung1",
  password: "safe-password",
  address: "서울특별시 성북구 삼선교로 16길",
  latitude: 37.5821,
  longitude: 127.0105,
  contact: "  +82-2-1234-5678  ",
};

test("uses the exact contact-sharing consent contract", () => {
  const request = createHospitalSignupRequest(validSignup, true);

  assert.equal(CONTACT_SHARING_CONSENT_VERSION, "CONTACT_SHARING_DEV_1.0");
  assert.equal(request.contact, "+82-2-1234-5678");
  assert.equal(request.contactSharingConsentAccepted, true);
  assert.equal(
    request.contactSharingConsentVersion,
    "CONTACT_SHARING_DEV_1.0",
  );
});

test("keeps valid plus and hyphen contact characters", () => {
  assert.equal(normalizeHospitalContact("  02-1234-5678  "), "02-1234-5678");
  assert.equal(isValidHospitalContact("02-1234-5678"), true);
  assert.equal(isValidHospitalContact("+82-2-1234-5678"), true);
});

test("rejects missing consent and out-of-contract contacts", () => {
  assert.throws(
    () => createHospitalSignupRequest(validSignup, false),
    /동의가 필요합니다/,
  );
  assert.equal(isValidHospitalContact("02 1234 5678"), false);
  assert.equal(isValidHospitalContact("1234567"), false);
  assert.equal(isValidHospitalContact("+82-2-1234-5678+"), false);
});

test("maps invitation lifecycle errors according to the backend contract", () => {
  assert.equal(
    INVITATION_ERROR_MESSAGES.INVITATION_002,
    "만료된 가입 코드입니다. 새 코드를 발급받아 주세요.",
  );
  assert.equal(
    INVITATION_ERROR_MESSAGES.INVITATION_003,
    "이미 사용된 가입 코드입니다. 기존 계정으로 로그인하거나 관리자에게 문의해 주세요.",
  );
  assert.equal(
    INVITATION_ERROR_MESSAGES.INVITATION_004,
    "폐기된 가입 코드입니다. 새 코드를 발급받아 주세요.",
  );
});
