import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTACT_SHARING_CONSENT_VERSION,
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
