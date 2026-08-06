// @ts-check

export const NAVER_GEOCODE_URL =
  "https://maps.apigw.ntruss.com/map-geocode/v2/geocode";

/**
 * @param {string} query
 * @param {string} clientId
 * @param {string} clientSecret
 * @param {AbortSignal} signal
 */
export function createNaverGeocodeRequest(
  query,
  clientId,
  clientSecret,
  signal,
) {
  const url = new URL(NAVER_GEOCODE_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("count", "5");

  return new Request(url, {
    headers: {
      accept: "application/json",
      "x-ncp-apigw-api-key-id": clientId,
      "x-ncp-apigw-api-key": clientSecret,
    },
    cache: "no-store",
    signal,
  });
}
