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
