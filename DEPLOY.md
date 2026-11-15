# 배포·공유 안내

다운로드·배포는 저장소 둘로 나눕니다. (모아 둔 폴더: `_upload/`)

| 종류 | 저장소 | 비고 |
|------|--------|------|
| 그림·사운드·data·루아 | [KirafanTCG](https://github.com/bcnsrui/KirafanTCG) | `pics/`, `sound/`, `web/data/`, `web/pics/small/`, `script/` |
| 웹 껍데기·API·Railway | [KirafanTCGWeb](https://github.com/bcnsrui/KirafanTCGWeb) (신규) | html/js/css + `tools/api_server.py` |

raw: data → `…/KirafanTCG/main/web` · pics/sound → `…/KirafanTCG/main`  
(예전 `KirafanTCGpics` / `KirafanTCGsound`는 더 이상 기본값이 아님)

## 저장 위치

| 실행 | 저장 | 다시 열 때 |
|------|------|------------|
| 브라우저 | 브라우저 전용 저장소 (웹은 `%AppData%`에 직접 쓸 수 없음) | 같은 브라우저·같은 사이트면 그대로 검사 |
| exe | 첫 실행에 **다운로드 폴더 선택** (기본값 = **exe가 있는 폴더**). 선택 경로는 AppData 설정에 저장 | **실행할 때마다** 깃허브 매니페스트와 해시 비교 → 다르면 덮어쓰기 |

웹 메뉴 Discord 옆 **Windows 설치** 아이콘은 `localStorage.exeDownloadUrl` 또는 `js/config.js`의 `EXE_DOWNLOAD_URL`로 링크를 넣습니다. 비어 있으면 “곧 추가” 안내만 뜹니다.

로컬 서버만 쓰려면 브라우저 콘솔:

```js
localStorage.setItem("updateUseLocal", "1");
```

## 깃허브에 올리는 것

첫 실행 때 **data + pics + sound** 을 받아 로컬 캐시에 둡니다 (약 48MB).

| 경로 | 저장소 |
|------|--------|
| `web/data/*` (매니페스트 포함) | KirafanTCG |
| `web/pics/small/*` (썸네일, ~1.3MB) | KirafanTCG — **풀 아트 pics에는 없음** |
| 풀 아트 `pics/*.jpg` | KirafanTCGpics (이미 있음) |
| `sound/**` | KirafanTCGsound (이미 있음) |

생성·갱신:

```powershell
KirafanAI\.venv\Scripts\python.exe KirafanWeb\tools\build_data.py
KirafanAI\.venv\Scripts\python.exe KirafanWeb\tools\build_ai.py
KirafanAI\.venv\Scripts\python.exe KirafanWeb\tools\build_manifest.py
```

푸시할 때: `KirafanWeb/data/` → `KirafanTCG/web/data/`,  
`KirafanWeb/pics/small/` → `KirafanTCG/web/pics/small/`

### 올리지 마세요

- `data/ai/test/` (검증용, 100MB+)
- `data/local_api.sqlite`
- 덱·리플레이·설정 (PC 로컬 전용)

### 선택

- 웹용 `pics/small/` 이 깃허브 pics에 없으면, 리사이즈본을 `KirafanTCGpics`에 같이 두거나 매니페스트에서 small만 제외
- 웹 껍데기(html/js/css/assets)는 Pages/별도 호스팅용. 데이터 자동 반영과는 별개
- [KirafanWindbotAi](https://github.com/bcnsrui/KirafanWindbotAi) · [KirafanTCGpuzzles](https://github.com/bcnsrui/KirafanTCGpuzzles) 원본은 PC(EDOPro)용. 웹은 이미 `data/puzzles.json` · `data/ai/*` 로 묶음

## 공개 호스팅 (Railway)

웹 껍데기 + 방/대전/전적 API를 **한 서비스**로 올립니다. 카드·그림·사운드는 계속 깃허브 raw.

### 1. 배포

1. [railway.app](https://railway.app) 가입 → **New Project** → **Deploy from GitHub**
2. 이 저장소(또는 `KirafanWeb`만 올린 저장소) 연결
3. **Root Directory** = `KirafanWeb` (모노레포일 때)
4. Dockerfile이 있으면 자동 빌드 (`railway.toml` 참고)

### 2. 볼륨·환경 변수

| 항목 | 값 |
|------|-----|
| Volume mount | `/data` (방·대전·전적 SQLite 유지) |
| `HOST` | `0.0.0.0` (Dockerfile 기본) |
| `SERVE_STATIC` | `1` |
| `DATA_DIR` | `/data` |
| `SESSION_SECRET` | 긴 랜덤 문자열 |
| `GOOGLE_CLIENT_ID` | (선택) OAuth 웹 클라이언트 ID |

`PORT`는 Railway가 넣습니다.

### 3. 도메인

Railway 서비스 → **Settings → Networking → Generate Domain** 후  
**Custom Domain**에 `kirafancardgame.com` / `www` 연결 → DNS에 Railway가 안내하는 CNAME(또는 A) 설정.

같은 출처라서 클라이언트 `API_BASE`는 비워 둡니다 (`js/config.js` 기본값). 로컬만 `127.0.0.1:8787`.

### 4. 로컬 API만

```powershell
KirafanAI\.venv\Scripts\python.exe KirafanWeb\tools\api_server.py
```

(정적 파일은 `tools/web_server.py` 8123과 따로.)

### 참고

- 예전 Cloudflare Worker 초안은 `server/`에 남아 있음. Railway 쓰면 필요 없음.
- Vercel은 정적만 가능해서 서버 대전과 맞지 않아 **쓰지 않음**.
