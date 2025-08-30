# PWA 빌더 사용 가이드

## 📋 개요

`pwa_builder.py` 모듈은 HTML 파일들을 완전한 PWA(Progressive Web App)로 변환하는 도구입니다. PWA 매니페스트, 서비스 워커, 목차 페이지를 생성하고 정적 자원을 최적화합니다.

---

## 🚀 기본 사용법

### 전체 PWA 빌드

```bash
# 기본 PWA 빌드 (모든 구성 요소 포함)
python src/pwa_builder.py build \
  --input-dir output/html \
  --output-dir output/pwa \
  --json output/parsed_bible.json \
  --include-manifest \
  --include-service-worker \
  --include-index
```

### 개별 구성 요소 생성

```bash
# PWA 매니페스트만 생성
python src/pwa_builder.py manifest \
  --output-file output/pwa/manifest.json \
  --app-name "공동번역성서" \
  --theme-color "#4CAF50"

# 서비스 워커만 생성
python src/pwa_builder.py service-worker \
  --output-file output/pwa/sw.js \
  --cache-strategy cache-first

# 목차 페이지만 생성
python src/pwa_builder.py index \
  --json output/parsed_bible.json \
  --template templates/index.html \
  --output output/pwa/index.html
```

---

## 🛠 고급 옵션

### 정적 자원 최적화

```bash
# CSS/JS 압축 및 이미지 최적화
python src/pwa_builder.py optimize \
  --minify-css \
  --minify-js \
  --optimize-images \
  --cache-bust
```

### 선택적 빌드

```bash
# 특정 책만 포함
python src/pwa_builder.py build \
  --input-dir output/html \
  --output-dir output/pwa \
  --books 창세,출애,마태 \
  --include-apocrypha

# 장 범위 제한
python src/pwa_builder.py build \
  --input-dir output/html \
  --output-dir output/pwa \
  --chapters 1-10
```

---

## 📁 출력 구조

PWA 빌드 후 다음과 같은 구조로 파일이 생성됩니다:

```
output/pwa/
├── index.html              # 목차 페이지 (PWA 시작점)
├── manifest.json           # PWA 매니페스트
├── sw.js                   # 서비스 워커
├── favicon.ico
├── icon-192x192.png
├── icon-512x512.png
├── static/                 # 정적 자원
│   ├── verse-style.css
│   ├── verse-navigator.js
│   └── search-worker.js
├── audio/                  # 오디오 파일 (존재하는 경우)
│   ├── genesis-1.mp3
│   └── ...
└── *.html                  # 각 장별 HTML 파일
    ├── genesis-1.html
    ├── genesis-2.html
    └── ...
```

---

## ⚙️ 환경 변수 설정

`.env` 파일에서 PWA 설정을 커스터마이즈할 수 있습니다:

```env
# PWA 기본 설정
PWA_APP_NAME="공동번역성서"
PWA_SHORT_NAME="공동번역성서"
PWA_THEME_COLOR="#4CAF50"
PWA_BACKGROUND_COLOR="#FFFFFF"
PWA_START_URL="index.html"
PWA_DISPLAY="standalone"

# 빌드 설정
BUILD_OUTPUT_DIR="output/pwa"
ENABLE_MINIFICATION=true
CACHE_BUST_ENABLED=true

# 디렉토리 경로
STATIC_DIR="static"
AUDIO_DIR="data/audio"
ICONS_DIR="static/icons"
```

---

## 🎯 PWA 매니페스트 커스터마이징

### 기본 매니페스트 속성

PWA 매니페스트는 다음 속성들을 포함합니다:

```json
{
  "name": "공동번역성서",
  "short_name": "공동번역성서",
  "description": "공동번역성서 전체 본문과 오디오를 제공하는 PWA",
  "start_url": "index.html",
  "display": "standalone",
  "theme_color": "#4CAF50",
  "background_color": "#FFFFFF",
  "orientation": "portrait-primary",
  "icons": [
    {
      "src": "icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "maskable any"
    },
    {
      "src": "icon-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable any"
    }
  ]
}
```

### 사용자 정의 아이콘

아이콘은 `static/icons/` 디렉토리에 다음 파일명으로 배치해야 합니다:

- `icon-192x192.png` (필수)
- `icon-512x512.png` (필수)
- `favicon.ico` (권장)

---

## 🔧 서비스 워커 설정

### 캐싱 전략

서비스 워커는 다음 캐싱 전략을 사용합니다:

1. **Cache First**: 정적 자원 (CSS, JS, 이미지, 오디오)
2. **Network First**: 검색 인덱스, HTML 콘텐츠
3. **Stale While Revalidate**: 매니페스트, 서비스 워커

### 미리 캐시할 파일 지정

```bash
python src/pwa_builder.py service-worker \
  --output-file output/pwa/sw.js \
  --precache-files "static/verse-style.css,static/verse-navigator.js,index.html"
```

---

## 📱 목차 페이지 생성

### 기본 목차 구조

목차 페이지는 3단 구조로 생성됩니다:

1. **구약** (39책)
2. **외경** (7책)
3. **신약** (27책)

### 검색 기능 포함

목차 페이지에는 다음 검색 기능이 포함됩니다:

- 전역 텍스트 검색
- 책별 필터링
- 장별 직접 이동

### 접근성 기능

- 키보드 네비게이션 지원
- 스크린리더 친화적 구조
- 적절한 제목 계층 (h1, h2, h3)

---

## 🔍 빌드 보고서

PWA 빌드 완료 후 다음 정보가 포함된 보고서가 생성됩니다:

```
===== PWA 빌드 보고서 =====

✅ 생성된 파일:
  - 총 74개 HTML 파일 (73장 + 목차)
  - manifest.json (2.1KB)
  - sw.js (15.3KB)
  - 정적 자원 12개 파일

🎵 오디오 파일:
  - 발견: 66개 장
  - 누락: 7개 장 (외경)

⚡ 최적화 결과:
  - CSS 압축: 45% 감소
  - JS 압축: 38% 감소
  - 총 빌드 시간: 3.2초

🚨 주의사항:
  - 외경 오디오 파일 누락
  - HTTPS 환경에서 테스트 필요
```

---

## 🧪 테스트 및 검증

### PWA 유효성 검사

Chrome DevTools의 Lighthouse를 사용하여 PWA 점수를 확인:

1. Chrome에서 PWA 열기
2. F12 → Lighthouse 탭
3. "Progressive Web App" 체크 후 분석 실행

### 오프라인 테스트

1. 개발자 도구에서 "Network" 탭 열기
2. "Offline" 체크박스 선택
3. 페이지 새로고침하여 오프라인 동작 확인

### 모바일 테스트

1. Chrome에서 `chrome://inspect` 접속
2. USB 디버깅으로 모바일 기기 연결
3. "홈 화면에 추가" 기능 테스트

---

## 🚨 문제 해결

### 일반적인 오류

**오류: PWA 매니페스트 파일을 찾을 수 없음**

```bash
# 해결: 매니페스트 파일 경로 확인
python src/pwa_builder.py manifest --output-file output/pwa/manifest.json
```

**오류: 서비스 워커 등록 실패**

```bash
# 해결: HTTPS 환경에서 테스트 (로컬은 localhost 예외)
python -m http.server 8000 --directory output/pwa
```

**경고: 아이콘 파일이 없음**

```bash
# 해결: 필수 아이콘 파일 복사
cp static/icons/* output/pwa/
```

### 빌드 실패 시 체크리스트

1. ✅ `output/parsed_bible.json` 파일 존재 여부
2. ✅ `templates/` 디렉토리의 템플릿 파일들
3. ✅ `static/icons/` 디렉토리의 아이콘 파일들
4. ✅ 출력 디렉토리 쓰기 권한
5. ✅ 환경 변수 설정 (.env 파일)

---

## 📚 관련 문서

- [요구사항](requirements.md) - PWA 요구사항 및 기능 명세
- [설계 명세서](design-specification.md) - PWA 아키텍처 및 설계
- [배포 가이드](deployment.md) - PWA 배포 및 호스팅 방법
- [HTML 생성기 가이드](html-generator-guide.md) - HTML 생성 과정
- [파서 사용 가이드](parser-usage-guide.md) - 텍스트 파싱 방법

---

## 💡 팁과 모범 사례

### 성능 최적화

1. **이미지 최적화**: `--optimize-images` 옵션 사용
2. **캐시 버스팅**: `--cache-bust` 옵션으로 브라우저 캐시 무효화
3. **선택적 빌드**: 필요한 책만 포함하여 용량 절약

### 접근성 강화

1. **키보드 네비게이션**: Tab 키로 모든 요소 접근 가능
2. **스크린리더 지원**: 적절한 ARIA 라벨 사용
3. **고대비 모드**: 시스템 설정에 따른 다크 모드 지원

### 오프라인 경험 개선

1. **핵심 콘텐츠 미리 캐시**: 주요 페이지들을 사전 캐싱
2. **오프라인 표시**: 네트워크 상태에 따른 적절한 UI 제공
3. **백그라운드 동기화**: 온라인 복원 시 자동 업데이트

---

이 가이드를 통해 공동번역성서 PWA를 성공적으로 빌드하고 배포할 수 있습니다. 추가 질문이나 문제가 있으면 이슈를 등록해 주세요.
