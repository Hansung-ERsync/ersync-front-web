# ERSync 병원 웹

병원 관계자를 위한 독립 React 웹입니다. Claude 디자인을 바탕으로 백엔드 기능 1
(`account-onboarding-auth`)의 병원 전용 API 계약만 연결했습니다.

## 현재 연결된 기능

- 병원 관계자 전용 로그인과 역할 차단
- Access Token 만료 전 갱신 및 Refresh Token 회전
- 인증 만료·비활성 계정 로그아웃
- 가입 코드를 사용한 병원 공용 계정 생성
- 병원 신규 요청 수신 상태 `ON/OFF` 변경

슈퍼 관리자 조직·가입 코드 관리는 별도 `admin-web` 프로젝트에서 운영합니다.
이송 요청, 수락·거절, 병상, 진료과 및 알림 기능은 해당 백엔드 계약이 전달되는
순서에 맞춰 추가합니다.

## 실행

Node.js 22.13 이상이 필요합니다.

```bash
npm install
npm run dev
```

기본 백엔드 주소는 `http://13.124.194.249`입니다. 다른 환경을 사용할 때는
`.env.example`을 참고해 `ERSYNC_API_BASE_URL`을 설정합니다.

## 검증

```bash
npm run build
npm test
```

토큰은 병원 웹 전용 `HttpOnly` 쿠키로 보관합니다. 보호 API에서 `AUTH_002`가
발생하면 Refresh 후 원래 요청을 한 번 재시도하며, `AUTH_005` 또는 `USER_002`가
발생하면 세션을 제거합니다.

