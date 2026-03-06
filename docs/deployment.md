# 공동번역성서 PWA 배포 가이드

## 🎯 배포 개요

이 가이드는 공동번역성서 PWA를 정적 파일 호스팅 서비스나 웹 서버에 배포하는 과정을 설명합니다.

---

## 📋 사전 요구사항

### 시스템 요구사항

- Python 3.8+
- 웹 서버 (Apache, Nginx) 또는 정적 파일 호스팅 서비스
- HTTPS 지원 (PWA 필수 요구사항)
- 최소 1GB 디스크 공간

### 필수 소프트웨어

```bash
# 프로젝트 의존성 설치
pip install -r requirements.txt

# 주요 패키지:
# - python-dotenv: 환경변수 관리
# - beautifulsoup4: HTML 파싱
# - lxml: XML/HTML 처리
# - jinja2: 템플릿 엔진
# - Pillow: 이미지 처리 (아이콘 최적화)
# - pytest: 테스트 프레임워크 (개발용)
```

---

## 🔧 로컬 개발 환경 설정

### 1. 프로젝트 클론 및 설정

```bash
# 프로젝트 클론
git clone git@github.com:joshua-in-boots/common-bible.git
cd common-bible

# 가상환경 생성
python -m venv venv
source venv/bin/activate  # Linux/Mac
# venv\Scripts\activate   # Windows

# 의존성 설치
pip install -r requirements.txt
```

### 2. 환경 변수 설정

```bash
# .env 파일 생성
cp .env.example .env

# .env 파일 내용 편집
nano .env
```

### 3. PWA 환경 변수 설정

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
CACHE_BUST_ENABLED=false

# 디렉토리 경로
STATIC_DIR="static"
AUDIO_DIR="data/audio"
ICONS_DIR="static/icons"

# 로그 설정
LOG_LEVEL=INFO
LOG_FILE="logs/pwa_build.log"
```

---

## 🚀 PWA 빌드 프로세스

### 1. 텍스트 파싱

```bash
# 성경 텍스트 파싱
python src/parser.py data/common-bible-kr.txt \
  --save-json output/parsed_bible.json \
  --book-mappings data/book_mappings.json \
  --log-level INFO
```

### 2. HTML 생성

```bash
# 장별 HTML 파일 생성
python src/html_generator.py templates/chapter.html output/html/ \
  --json output/parsed_bible.json \
  --copy-static --copy-audio \
  --css-href "static/verse-style.css" \
  --js-src "static/verse-navigator.js"
```

### 3. PWA 빌드

```bash
# 완전한 PWA 빌드
python src/pwa_builder.py build \
  --input-dir output/html \
  --output-dir output/pwa \
  --json output/parsed_bible.json \
  --include-manifest \
  --include-service-worker \
  --include-index \
  --minify-css \
  --optimize-images
```

### 4. 빌드 검증

```bash
# PWA 필수 요소 확인
ls -la output/pwa/
# 확인 항목:
# - index.html (목차 페이지)
# - manifest.json (PWA 매니페스트)
# - sw.js (서비스 워커)
# - icon-*.png (PWA 아이콘)
# - static/ (CSS, JS 파일들)
# - *.html (장별 HTML 파일들)

# PWA 유효성 검사
python scripts/validate_pwa.py output/pwa/
```

---

## 🌐 정적 파일 호스팅 배포

### GitHub Pages

```bash
# 1. gh-pages 브랜치 생성
git checkout -b gh-pages

# 2. PWA 파일들을 루트로 복사
cp -r output/pwa/* .
git add .
git commit -m "Deploy PWA to GitHub Pages"

# 3. GitHub Pages에 푸시
git push origin gh-pages

# 4. GitHub 저장소 설정에서 Pages 활성화
# Settings → Pages → Source: Deploy from branch → gh-pages
```

### Netlify

```bash
# 1. netlify.toml 설정 파일 생성
cat > netlify.toml << EOF
[build]
  publish = "output/pwa"
  command = "python src/pwa_builder.py build --input-dir output/html --output-dir output/pwa --json output/parsed_bible.json --include-manifest --include-service-worker --include-index"

[[headers]]
  for = "/sw.js"
  [headers.values]
    Cache-Control = "public, max-age=0, must-revalidate"
    Service-Worker-Allowed = "/"

[[headers]]
  for = "/manifest.json"
  [headers.values]
    Content-Type = "application/manifest+json"

[[headers]]
  for = "*.html"
  [headers.values]
    Cache-Control = "public, max-age=3600"

[[headers]]
  for = "/static/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000"
EOF

# 2. Netlify CLI로 배포
npm install -g netlify-cli
netlify deploy --prod --dir=output/pwa
```

### Vercel

```bash
# 1. vercel.json 설정 파일 생성
cat > vercel.json << EOF
{
  "version": 2,
  "builds": [
    {
      "src": "src/pwa_builder.py",
      "use": "@vercel/python"
    }
  ],
  "routes": [
    {
      "src": "/sw.js",
      "headers": {
        "Cache-Control": "public, max-age=0, must-revalidate",
        "Service-Worker-Allowed": "/"
      }
    },
    {
      "src": "/manifest.json",
      "headers": {
        "Content-Type": "application/manifest+json"
      }
    },
    {
      "src": "/static/(.*)",
      "headers": {
        "Cache-Control": "public, max-age=31536000"
      }
    }
  ],
  "outputDirectory": "output/pwa"
}
EOF

# 2. Vercel CLI로 배포
npm install -g vercel
vercel --prod
```

---

## 🖥️ 웹 서버 배포

### Apache 설정

```apache
# /etc/apache2/sites-available/common-bible.conf

<VirtualHost *:443>
    ServerName bible.example.com
    DocumentRoot /var/www/common-bible

    # SSL 설정 (PWA 필수)
    SSLEngine on
    SSLCertificateFile /path/to/certificate.crt
    SSLCertificateKeyFile /path/to/private.key

    # PWA 최적화 헤더
    <Files "sw.js">
        Header set Cache-Control "public, max-age=0, must-revalidate"
        Header set Service-Worker-Allowed "/"
    </Files>

    <Files "manifest.json">
        Header set Content-Type "application/manifest+json"
    </Files>

    # 정적 자원 캐싱
    <Directory "/var/www/common-bible/static">
        Header set Cache-Control "public, max-age=31536000"
    </Directory>

    # 오디오 파일 캐싱
    <Directory "/var/www/common-bible/audio">
        Header set Cache-Control "public, max-age=2592000"
    </Directory>

    # Gzip 압축
    <IfModule mod_deflate.c>
        AddOutputFilterByType DEFLATE text/html text/css application/javascript application/json
    </IfModule>

    # HTTPS 리다이렉트
    <IfModule mod_rewrite.c>
        RewriteEngine On
        RewriteCond %{HTTPS} off
        RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
    </IfModule>
</VirtualHost>
```

### Nginx 설정

```nginx
# /etc/nginx/sites-available/common-bible

server {
    listen 443 ssl http2;
    server_name bible.example.com;
    root /var/www/common-bible;
    index index.html;

    # SSL 설정 (PWA 필수)
    ssl_certificate /path/to/certificate.crt;
    ssl_certificate_key /path/to/private.key;
    ssl_protocols TLSv1.2 TLSv1.3;

    # PWA 서비스 워커 헤더
    location = /sw.js {
        add_header Cache-Control "public, max-age=0, must-revalidate";
        add_header Service-Worker-Allowed "/";
    }

    # PWA 매니페스트
    location = /manifest.json {
        add_header Content-Type "application/manifest+json";
    }

    # 정적 자원 캐싱
    location /static/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # 오디오 파일 캐싱
    location /audio/ {
        expires 30d;
        add_header Cache-Control "public";
    }

    # HTML 파일 캐싱
    location ~* \.html$ {
        expires 1h;
        add_header Cache-Control "public";
    }

    # Gzip 압축
    gzip on;
    gzip_types text/css application/javascript application/json text/html;

    # 보안 헤더
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
}

# HTTP → HTTPS 리다이렉트
server {
    listen 80;
    server_name bible.example.com;
    return 301 https://$server_name$request_uri;
}
```

---

## 📱 PWA 기능 검증

### 로컬 테스트

```bash
# 로컬 HTTPS 서버 실행 (PWA 테스트용)
python scripts/serve_https.py output/pwa --port 8443

# 또는 간단한 HTTP 서버 (localhost는 PWA 예외)
python -m http.server 8000 --directory output/pwa
```

### PWA 점검 항목

1. **Lighthouse 점검**: Chrome DevTools → Lighthouse → PWA 점수 확인
2. **매니페스트 검증**: Chrome DevTools → Application → Manifest
3. **서비스 워커 확인**: Chrome DevTools → Application → Service Workers
4. **오프라인 동작**: Network 탭에서 Offline 모드 테스트
5. **홈 화면 추가**: 모바일에서 "홈 화면에 추가" 기능 테스트

### 성능 측정

```bash
# PageSpeed Insights 점수 확인
curl "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://bible.example.com&category=PERFORMANCE&category=PWA"

# 또는 Lighthouse CI 사용
npm install -g @lhci/cli
lhci autorun --upload.target=temporary-public-storage
```

---

## 🔒 보안 및 최적화

### HTTPS 설정

```bash
# Let's Encrypt 인증서 발급 (Ubuntu)
sudo apt install certbot python3-certbot-apache
sudo certbot --apache -d bible.example.com

# 자동 갱신 설정
sudo crontab -e
# 다음 줄 추가:
# 0 12 * * * /usr/bin/certbot renew --quiet
```

### 보안 헤더

```nginx
# 추가 보안 헤더 (nginx)
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self';" always;
add_header Permissions-Policy "geolocation=(), microphone=(), camera=()";
```

### 성능 최적화

```bash
# 이미지 최적화 (WebP 변환)
find output/pwa -name "*.png" -exec cwebp {} -o {}.webp \;

# CSS/JS 압축 검증
du -sh output/pwa/static/

# 캐시 무효화 해시 생성
python scripts/generate_cache_bust.py output/pwa/
```

---

## 📊 모니터링 및 분석

### 기본 분석

```html
<!-- Google Analytics 4 (선택사항) -->
<script
  async
  src="https://www.googletagmanager.com/gtag/js?id=GA_MEASUREMENT_ID"
></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag() {
    dataLayer.push(arguments);
  }
  gtag("js", new Date());
  gtag("config", "GA_MEASUREMENT_ID", {
    page_title: document.title,
    page_location: window.location.href,
  });
</script>
```

### PWA 사용 통계

```javascript
// PWA 설치 추적
window.addEventListener("beforeinstallprompt", (e) => {
  gtag("event", "pwa_install_prompt_shown");
});

window.addEventListener("appinstalled", (e) => {
  gtag("event", "pwa_installed");
});

// 오프라인 사용 추적
window.addEventListener("online", () => {
  gtag("event", "online_status", { status: "online" });
});

window.addEventListener("offline", () => {
  gtag("event", "online_status", { status: "offline" });
});
```

---

## 🚨 문제 해결

### 일반적인 문제

**문제: PWA가 홈 화면에 추가되지 않음**

- 해결: HTTPS 확인, 매니페스트 파일 유효성 검사, 192x192, 512x512 아이콘 존재 확인

**문제: 서비스 워커가 등록되지 않음**

- 해결: HTTPS 환경 확인, 서비스 워커 파일 경로 확인, 브라우저 콘솔 오류 메시지 확인

**문제: 오프라인에서 페이지가 로드되지 않음**

- 해결: 서비스 워커의 캐시 전략 확인, 캐시된 파일 목록 검증

### 로그 분석

```bash
# 빌드 로그 확인
tail -f logs/pwa_build.log

# 서버 로그 확인 (Apache)
sudo tail -f /var/log/apache2/access.log
sudo tail -f /var/log/apache2/error.log

# 서버 로그 확인 (Nginx)
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

---

## 📚 추가 자료

- [PWA 빌더 가이드](pwa-builder-guide.md) - 상세한 PWA 빌드 과정
- [요구사항](prd.md) - PWA 기능 요구사항
- [설계 명세서](technical-design.md) - 시스템 아키텍처
- [HTML 생성기 가이드](html-generator-guide.md) - HTML 생성 프로세스

---

## 🎉 배포 완료 체크리스트

- [ ] 📁 PWA 빌드 완료 (`output/pwa/` 디렉토리)
- [ ] 🔒 HTTPS 설정 완료
- [ ] 📱 PWA 매니페스트 검증 완료
- [ ] ⚙️ 서비스 워커 동작 확인
- [ ] 🌐 정적 파일 호스팅 또는 웹서버 배포 완료
- [ ] 📊 Lighthouse PWA 점수 90+ 확인
- [ ] 📱 모바일에서 "홈 화면에 추가" 테스트 완료
- [ ] 🔌 오프라인 모드 동작 확인
- [ ] 🎵 오디오 파일 재생 테스트 완료
- [ ] 🔍 검색 기능 동작 확인

축하합니다! 공동번역성서 PWA가 성공적으로 배포되었습니다. 🎊
