// @ts-check

/**
 * 병원 웹에서 백엔드로 전달할 수 있는 헤더만 명시적으로 구성합니다.
 *
 * @param {Headers} incoming
 * @param {string | undefined} accessToken
 */
export function hospitalBackendHeaders(incoming, accessToken) {
  const headers = new Headers();
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  const idempotencyKey = incoming.get("Idempotency-Key");
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  return headers;
}
