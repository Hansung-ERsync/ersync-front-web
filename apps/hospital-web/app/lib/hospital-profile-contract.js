// @ts-check

/**
 * 수신 상태 변경 중 전송 오류나 서버 오류가 나면 실제 반영 여부가 불명확하므로
 * 프로필 GET으로 서버의 최종 상태를 다시 확인해야 합니다.
 *
 * @param {number | null | undefined} status
 */
export function shouldReloadProfileAfterReceivingStatusError(status) {
  return status == null || status >= 500;
}
