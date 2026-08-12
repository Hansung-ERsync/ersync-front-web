# ERSync Front Web

ERSync의 병원 웹과 슈퍼 관리자 웹을 하나의 저장소에서 관리하는 모노레포입니다. 두 웹은 소스, 의존성, 실행 포트와 배포 설정을 서로 독립적으로 유지합니다.

## 프로젝트 구조

```text
apps/
├─ hospital-web/       # 병원 관계자용 웹
└─ super-admin-web/    # 슈퍼 관리자용 웹
```

### 병원 웹

- 가입 코드를 이용한 병원 공용 계정 생성
- 병원 관계자 로그인·로그아웃
- Access·Refresh Token 자동 갱신
- 신규 이송 요청 수신 상태 ON/OFF 변경

### 슈퍼 관리자 웹

- 슈퍼 관리자 로그인·로그아웃
- 병원·구급대 조직 등록 및 목록 조회
- 일회용 가입 코드 발급, 목록 조회, 필터 및 폐기
- 병원 가입 후 사용 완료 상태 자동 갱신

## 로컬 실행 준비

Node.js 22.13 이상이 필요합니다. 저장소 루트에서 두 앱의 의존성을 설치합니다.

```powershell
npm run install:all
```

백엔드 API 주소를 현재 PowerShell 세션에 설정합니다.

```powershell
$env:ERSYNC_API_BASE_URL="http://13.124.194.249"
```

## 로컬 실행

서로 다른 PowerShell 창에서 실행합니다.

병원 웹:

```powershell
npm run dev:hospital
```

- 접속 주소: http://localhost:3000

슈퍼 관리자 웹:

```powershell
npm run dev:admin
```

- 접속 주소: http://localhost:3001

## 검증

두 앱을 함께 빌드합니다.

```powershell
npm run build
```

두 앱의 테스트를 함께 실행합니다.

```powershell
npm test
```

## 환경변수와 보안

- 각 앱의 `.env.example`은 필요한 환경변수 이름과 개발용 기본 주소만 제공합니다.
- 실제 `.env`, 관리자 로그인 정보, 비밀번호, Access Token과 Refresh Token은 저장소에 커밋하지 않습니다.
- 현재 HTTP 백엔드는 로컬 시연용으로만 사용합니다.

## 현재 연동 범위

현재는 계정 온보딩·인증, 슈퍼 관리자 조직·가입 코드 관리, 병원 수신 상태 변경까지 연동되어 있습니다. 이송 요청, 환자 상세, 수락·거절, 병상·진료과와 알림 기능은 후속 백엔드 문서에 맞춰 순차적으로 추가합니다.

## 자동 배포

`main` 대상 PR에서는 두 앱을 설치·빌드·테스트만 합니다. `main`에 병합되면 검사를 다시 실행한 뒤 Cloudflare Workers에 자동 배포합니다.

| 웹 | 배포 주소 |
| --- | --- |
| 병원 | `https://ersync-hospital-web-dev.<workers-subdomain>.workers.dev` |
| 관리자 | `https://ersync-super-admin-web-dev.<workers-subdomain>.workers.dev` |

정확한 주소는 첫 배포 후 GitHub Actions 로그에서 확인합니다.
