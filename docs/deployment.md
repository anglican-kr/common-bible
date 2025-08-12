# 공동번역성서 프로젝트 배포 가이드

## 🎯 배포 개요

이 가이드는 공동번역성서 프로젝트를 개발 환경에서 프로덕션 환경으로 배포하는 과정을 설명합니다.

---

## 📋 사전 요구사항

### 시스템 요구사항

- Python 3.8+
- WordPress 5.0+ (REST API 지원)
- 최소 2GB RAM, 10GB 디스크 공간
- HTTPS 지원 웹서버

### 필수 소프트웨어

```bash
# 프로젝트 의존성 설치 (requirements.txt에 정의됨)
pip install -r requirements.txt

# 주요 패키지:
# - python-dotenv: 환경변수 관리
# - requests: HTTP 요청 처리
# - beautifulsoup4: HTML 파싱
# - lxml: XML/HTML 처리
# - PyYAML: YAML 파일 처리
# - jinja2: 템플릿 엔진
# - rich: 터미널 출력 포맷팅
# - pytest: 테스트 프레임워크 (개발용)
```

---

## 🔧 환경 설정

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

### 2. 환경변수 설정

```bash
# 환경변수 파일 생성
cp env.example .env
```

**.env 파일 편집:**

```env
# 워드프레스 설정 (필수)
WP_SITE_URL=https://seoul.anglican.kr
WP_USERNAME=your_username
WP_PASSWORD=your_application_password
WP_DEFAULT_STATUS=private
WP_TIMEOUT=30
WP_RETRY_COUNT=3

# 카테고리/태그 자동 생성 설정 (선택사항)
WP_BASE_CATEGORY=공동번역성서
WP_BASE_TAG=공동번역성서

# 파일 경로 설정 (선택사항 - 기본값 사용 가능)
BIBLE_TEXT_PATH=data/common-bible-kr.txt
BOOK_MAPPINGS_PATH=data/book_mappings.json
TEMPLATE_PATH=templates/chapter.html
OUTPUT_DIR=output
LOG_DIR=logs
AUDIO_BASE_URL=data/audio

# 로깅 설정
LOG_LEVEL=INFO
LOG_TO_CONSOLE=true
LOG_COLOR=true

# 보안 설정
VERIFY_SSL=true

# 성능 설정
MAX_WORKERS=4

# 개발/운영 환경 설정
ENVIRONMENT=development
DEBUG=false
```

### 3. 디렉터리 생성

```bash
# 필요한 디렉터리 생성
mkdir -p logs data/output config audio
chmod 755 logs data/output audio
```

---

## 🔐 워드프레스 설정

### 1. REST API 활성화

워드프레스 관리자 패널에서:

1. **설정 > 고유주소** 에서 기본값이 아닌 구조 선택
2. **사용자 > 프로필** 에서 Application Password 생성

### 2. 필수 플러그인 설치

```bash
# JWT Authentication (선택적)
# 또는 Application Password 사용 (권장)
```

### 3. 사용자 권한 설정

```bash
# 전용 계정 생성 (권장)
# 역할: Editor
# 권한: 포스트 작성, 편집, 게시
```

### 4. 보안 설정

```php
// wp-config.php에 추가
define('WP_REST_API_DEBUG', false);

// .htaccess에 IP 제한 (선택적)
<RequireAll>
    Require ip YOUR_SERVER_IP
    Require ssl
</RequireAll>
```

---

## 🚀 배포 프로세스

### 1. 개발 환경 테스트

```bash
# 전체 테스트 실행
python -m pytest tests/ -v

# 통합 테스트
python tests/integration_test.py

# 인증 테스트
python src/wp_publisher.py --test-auth
```

### 2. 데이터 검증

```bash
# 입력 파일 검증
python scripts/validate_input.py data/common-bible-kr.txt

# 매핑 데이터 검증
python scripts/validate_mappings.py data/bible_book_mappings.json
```

### 3. 단계별 배포

#### Stage 1: 파싱 및 HTML 생성

```bash
# 백업 생성
cp data/common-bible-kr.txt data/backup/$(date +%Y%m%d)_common-bible-kr.txt

# 파싱 실행
python src/parser.py --input data/common-bible-kr.txt --output data/parsed_chapters.json

# 오디오 매핑 검증
python src/audio_manager.py --validate-mappings

# HTML 생성 (오디오 포함)
python src/html_generator.py --input data/parsed_chapters.json --output data/output/ --with-audio
```

#### Stage 2: 미리보기 배포 (비공개)

```bash
# 비공개 상태로 업로드 (서울교구 사이트)
python src/wp_publisher.py --upload-all --status=private --url=https://seoul.anglican.kr --author=YOUR_USERNAME --publish-date=2025-07-01 --dry-run=false

# 업로드 로그 확인
tail -f logs/bible_converter.log
```

#### Stage 3: 검토 및 테스트

```bash
# 생성된 포스트 확인
python scripts/verify_posts.py --check-all

# 접근성 테스트
python scripts/accessibility_test.py --url=https://your-site.com
```

#### Stage 4: 공개 배포

```bash
# 모든 포스트 공개
python src/wp_publisher.py --publish-all --confirm

# 배포 완료 확인
python scripts/deployment_check.py
```

---

## 📊 모니터링 및 유지보수

### 1. 로그 모니터링

```bash
# 실시간 로그 모니터링
tail -f logs/bible_converter.log

# 오류 로그 필터링
grep "ERROR" logs/bible_converter.log

# 로그 로테이션 설정
logrotate config/logrotate.conf
```

### 2. 백업 전략

```bash
# 일일 백업 스크립트 (crontab)
0 2 * * * /path/to/backup_script.sh

# 백업 스크립트 예시
#!/bin/bash
DATE=$(date +%Y%m%d)
mysqldump -u user -p wordpress > backup/wp_${DATE}.sql
tar -czf backup/files_${DATE}.tar.gz data/ config/ logs/
```

### 3. 성능 모니터링

```python
# scripts/performance_monitor.py
import time
import psutil

def monitor_system():
    cpu_usage = psutil.cpu_percent()
    memory_usage = psutil.virtual_memory().percent
    disk_usage = psutil.disk_usage('/').percent

    print(f"CPU: {cpu_usage}%, Memory: {memory_usage}%, Disk: {disk_usage}%")
```

---

## 🔧 트러블슈팅

### 자주 발생하는 문제들

#### 1. 인증 실패

```bash
# 해결 방법
1. Application Password 재생성
2. URL 확인 (https:// 포함)
3. 네트워크 방화벽 확인
```

#### 2. 메모리 부족

```bash
# 해결 방법
1. 배치 크기 줄이기 (--batch-size=10)
2. 메모리 증설
3. 스왑 파일 설정
```

#### 3. API 레이트 리미팅

```bash
# 해결 방법
1. WP_API_RATE_LIMIT 값 조정
2. 요청 간 지연 시간 증가
3. 배치 처리 크기 감소
```

#### 4. 오디오 파일 문제

```bash
# 해결 방법
1. 오디오 파일 경로 확인
2. 파일 형식 및 인코딩 확인 (MP3 형식)
3. audio_mappings.json 파일 검증
4. 수동으로 오디오 파일 업로드 및 연결
```

### 로그 분석

```bash
# 오류 패턴 분석
awk '/ERROR/ {print $0}' logs/bible_converter.log | sort | uniq -c

# 성공률 계산
grep -c "SUCCESS" logs/bible_converter.log
grep -c "ERROR" logs/bible_converter.log
```

---

## 🚦 배포 체크리스트

### 배포 전 확인사항

- [ ] 모든 테스트 통과
- [ ] 환경변수 설정 완료
- [ ] 워드프레스 인증 테스트 통과
- [ ] 오디오 파일 매핑 검증
- [ ] 접근성 요소 검증
- [ ] 백업 생성 완료
- [ ] 로그 디렉터리 권한 설정

### 배포 중 확인사항

- [ ] 파싱 과정 오류 없음
- [ ] HTML 생성 정상 완료
- [ ] 비공개 업로드 성공
- [ ] 생성된 포스트 샘플 확인

### 배포 후 확인사항

- [ ] 모든 장 업로드 완료
- [ ] 검색 기능 정상 작동 (전역 검색 패널/페이지네이션/정렬 포함)
- [ ] 오디오 플레이어 정상 작동
- [ ] 접근성 테스트 통과 (스크린리더 테스트)
- [ ] 단어/문구 검색 기능 정상 작동
- [ ] 성능 모니터링 정상
- [ ] 메타데이터 정확성 확인
- [ ] 백업 및 로그 확인

---

## 📞 문의

배포 과정에서 문제가 발생하면:

1. 로그 파일 확인 (`logs/bible_converter.log`)
2. 트러블슈팅 가이드 참조
3. GitHub Issues 등록

---

**배포 버전**: 1.0.0  
**최종 업데이트**: 2025년 6월 20일  
**지원 환경**: Ubuntu 20.04+, CentOS 8+, Windows 10+
