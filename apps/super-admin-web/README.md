# ERSync 슈퍼 관리자 웹

병원 웹과 완전히 분리된 슈퍼 관리자 전용 React 프로젝트입니다.

## 기능

- `SUPER_ADMIN` 역할 전용 로그인과 역할 차단
- Access/Refresh Token 자동 교체 및 만료 처리
- 병원·구급대 조직 등록과 목록·페이징
- 조직 유형에 맞는 일회용 가입 코드 발급
- 가입 코드 상태·조직 필터, 페이징 및 폐기
- 가입 코드 원문 발급 직후 1회 표시와 복사

## 실행과 검증

```bash
npm install
npm run dev -- --port 3001
npm run build
npm test
```

기본 백엔드 주소는 `http://ec2-13-124-194-249.ap-northeast-2.compute.amazonaws.com`입니다. 토큰은 관리자 웹 전용
`HttpOnly` 쿠키로 보관하며 병원·구급대원 역할의 로그인은 서버에서 거부합니다.
