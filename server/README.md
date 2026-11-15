# 전적 API (Cloudflare Workers + D1)

로컬 개발은 `tools/api_server.py`를 쓰고, 공개 배포 때 이 Worker를 올립니다.

## 준비

1. Cloudflare 계정에서 D1 데이터베이스 `kirafan` 생성
2. `wrangler.toml`의 `database_id` 교체
3. 시크릿 설정:

```bash
npx wrangler d1 execute kirafan --file=schema.sql
npx wrangler secret put SESSION_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler deploy
```

4. 구글 클라우드 콘솔에서 OAuth 웹 클라이언트 만들고, 승인된 JavaScript 원본에 웹/앱 주소를 넣습니다.
5. 클라이언트 `js/config.js` 또는 `localStorage`의 `apiBase` / `googleClientId`를 Worker URL과 클라이언트 아이디로 맞춥니다.
