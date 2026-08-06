import assert from "node:assert/strict";
import test from "node:test";

import {
  NAVER_GEOCODE_URL,
  createNaverGeocodeRequest,
} from "../app/lib/geocode-contract.js";

test("uses the current Naver Geocoding endpoint and server credentials", () => {
  const controller = new AbortController();
  const request = createNaverGeocodeRequest(
    "성북구",
    "test-naver-client-id",
    "test-naver-client-secret",
    controller.signal,
  );
  const url = new URL(request.url);

  assert.equal(
    NAVER_GEOCODE_URL,
    "https://maps.apigw.ntruss.com/map-geocode/v2/geocode",
  );
  assert.equal(url.origin, "https://maps.apigw.ntruss.com");
  assert.equal(url.pathname, "/map-geocode/v2/geocode");
  assert.equal(url.searchParams.get("query"), "성북구");
  assert.equal(url.searchParams.get("count"), "5");
  assert.equal(request.headers.get("accept"), "application/json");
  assert.equal(
    request.headers.get("x-ncp-apigw-api-key-id"),
    "test-naver-client-id",
  );
  assert.equal(
    request.headers.get("x-ncp-apigw-api-key"),
    "test-naver-client-secret",
  );
  assert.equal(request.cache, "no-store");
  assert.equal(request.signal.aborted, false);
});
