import assert from "node:assert/strict";
import test from "node:test";

import {
  createHospitalProfileUpdateRequest,
  formatHospitalProfileAddress,
  getHospitalProfileUpdateErrors,
  getRealtimeConnectionPresentation,
  shouldReloadProfileAfterUpdateError,
  shouldReloadProfileAfterReceivingStatusError,
} from "../app/lib/hospital-profile-contract.js";

const validProfileUpdate = {
  address: "  서울특별시 성북구 삼선교로 16길  ",
  detailAddress: "  본관 1층 응급의료센터  ",
  latitude: 37.5821,
  longitude: 127.0105,
  contact: " 02 1234 5678 ",
  receivingStatus: "OFF",
};

test("shows nullable detail addresses without blank or null text", () => {
  assert.equal(
    formatHospitalProfileAddress("서울특별시 성북구", " 본관 1층 "),
    "서울특별시 성북구 본관 1층",
  );
  assert.equal(
    formatHospitalProfileAddress("서울특별시 성북구", null),
    "서울특별시 성북구",
  );
  assert.equal(
    formatHospitalProfileAddress("서울특별시 성북구", "   "),
    "서울특별시 성북구",
  );
});

test("creates the exact five-field self-profile update body", () => {
  const request = createHospitalProfileUpdateRequest(validProfileUpdate);

  assert.deepEqual(request, {
    address: "서울특별시 성북구 삼선교로 16길",
    detailAddress: "본관 1층 응급의료센터",
    latitude: 37.5821,
    longitude: 127.0105,
    contact: "02-1234-5678",
  });
  assert.equal("receivingStatus" in request, false);
});

test("sends a blank detail address as null to remove the saved value", () => {
  assert.equal(
    createHospitalProfileUpdateRequest({
      ...validProfileUpdate,
      detailAddress: "   ",
    }).detailAddress,
    null,
  );
});

test("validates profile address, coordinates, and contact before save", () => {
  assert.deepEqual(
    getHospitalProfileUpdateErrors({
      ...validProfileUpdate,
      address: "",
      latitude: 91,
      longitude: -181,
      contact: "1234567",
    }),
    {
      address: "검색 결과에서 유효한 지도 위치를 선택해 주세요.",
      contact: "연락처 형식을 확인해 주세요. 예: 02-1234-5678",
    },
  );
  assert.throws(
    () =>
      createHospitalProfileUpdateRequest({
        ...validProfileUpdate,
        detailAddress: "가".repeat(201),
      }),
    /세부주소는 200자 이하/,
  );
});

test("reloads the full profile after an ambiguous update failure", () => {
  assert.equal(shouldReloadProfileAfterUpdateError(undefined), true);
  assert.equal(shouldReloadProfileAfterUpdateError(502), true);
  assert.equal(shouldReloadProfileAfterUpdateError(400), false);
  assert.equal(shouldReloadProfileAfterUpdateError(403), false);
});

test("reloads the hospital profile after ambiguous receiving-status failures", () => {
  assert.equal(shouldReloadProfileAfterReceivingStatusError(undefined), true);
  assert.equal(shouldReloadProfileAfterReceivingStatusError(null), true);
  assert.equal(shouldReloadProfileAfterReceivingStatusError(500), true);
  assert.equal(shouldReloadProfileAfterReceivingStatusError(503), true);
});

test("keeps the current profile after deterministic client errors", () => {
  assert.equal(shouldReloadProfileAfterReceivingStatusError(400), false);
  assert.equal(shouldReloadProfileAfterReceivingStatusError(401), false);
  assert.equal(shouldReloadProfileAfterReceivingStatusError(403), false);
  assert.equal(shouldReloadProfileAfterReceivingStatusError(409), false);
});

test("distinguishes new-request receiving from the existing-request stream", () => {
  assert.deepEqual(getRealtimeConnectionPresentation("ON", "CONNECTED"), {
    label: "실시간 연결",
    tone: "connected",
  });
  assert.deepEqual(getRealtimeConnectionPresentation("OFF", "CONNECTED"), {
    label: "요청 수신 OFF",
    tone: "paused",
  });
  assert.deepEqual(getRealtimeConnectionPresentation("OFF", "RECONNECTING"), {
    label: "재연결 중",
    tone: "reconnecting",
  });
});
