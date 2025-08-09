# 워드프레스 퍼블리셔 가이드

이 문서는 공동번역성서 게시 자동화를 위한 워드프레스 측 준비와 퍼블리셔 사용 방법을 간단히 정리합니다. 특히 CSS를 차일드 테마에 고정 등록하여, HTML 업로드 때마다 CSS를 따로 관리하지 않도록 구성합니다.

## 1) 차일드 테마에 CSS/JS 배치

- 경로 예시(차일드 테마):
  - `wp-content/themes/<your-child-theme>/assets/verse-style.css`
  - `wp-content/themes/<your-child-theme>/assets/verse-navigator.js` (선택)
  - `wp-content/themes/<your-child-theme>/assets/search-worker.js` (전역 검색 사용 시)

### functions.php에 추가할 코드

```php
<?php
/**
 * 공동번역성서 전용 CSS/JS 로드 (차일드 테마)
 */
add_action('wp_enqueue_scripts', function () {
  // 게시물 단일 화면 + 카테고리 '공동번역성서'에만 적용
  if (is_singular('post') && has_category('공동번역성서')) {
    // CSS
    $css_rel  = '/assets/verse-style.css';
    $css_path = get_stylesheet_directory() . $css_rel;
    $css_ver  = file_exists($css_path) ? filemtime($css_path) : null;
    wp_enqueue_style(
      'bible-verse-style',
      get_stylesheet_directory_uri() . $css_rel,
      [],
      $css_ver
    );

    // JS (선택: 테마에 verse-navigator.js를 두는 경우에만 로드)
    $js_rel  = '/assets/verse-navigator.js';
    $js_path = get_stylesheet_directory() . $js_rel;
    if (file_exists($js_path)) {
      wp_enqueue_script(
        'bible-verse-navigator',
        get_stylesheet_directory_uri() . $js_rel,
        [],
        filemtime($js_path),
        true
      );
    }
    // 전역 검색 Worker를 별도 파일로 둘 경우, 필요 시 등록
    $worker_rel  = '/assets/search-worker.js';
    $worker_path = get_stylesheet_directory() . $worker_rel;
    if (file_exists($worker_path)) {
      wp_register_script(
        'bible-search-worker',
        get_stylesheet_directory_uri() . $worker_rel,
        [],
        filemtime($worker_path),
        true
      );
    }
  }
});
```

- 위 코드는 카테고리가 `공동번역성서`인 게시물에서만 CSS/JS를 로드합니다.
- 캐시 무효화를 위해 파일 수정 시간을 버전으로 사용합니다.

## 2) 퍼블리셔 사용 시 권장 설정

- CSS는 차일드 테마에서 로드하므로, 퍼블리셔의 CSS 업로드는 생략합니다.
- 오디오는 필요 시 미디어로 업로드하여 본문에서 참조되도록 합니다.

### CSS/JS 로딩 전략

- 기본: 차일드 테마 enqueue(본문 링크 없음)
- 예외: 본문에 직접 링크가 필요한 경우, HTML 생성기 실행 시 옵션 사용
  - `--css-href <URL 또는 상대 경로>`
  - `--js-src <URL 또는 상대 경로>`
  - 로컬/정적 호스팅: `--copy-static` + `./static/...`
  - 워드프레스 게시: 절대 URL 또는 사이트 루트 경로(`/wp-content/themes/<child>/assets/...`)

### 예시

```bash
# (선택) 오디오만 보장: --css는 생략하거나 더미 경로로 두지 않습니다
python src/wordpress_api.py ensure-assets --audio-dir data/audio

# 단일 장 게시 (비공개)
python src/wordpress_api.py publish-chapter \
  --html output/html/genesis-1.html \
  --book-name 창세기 --book-abbr 창세 --english-name Genesis --division 구약 --chapter 1

# 상태 일괄 변경 (공개, 드라이런)
python src/wordpress_api.py bulk-status --to publish --division-tag 구약 --dry-run
```

#### 테마 모드(권장) 커맨드 블록

```bash
# 0) HTML 생성(본문에 CSS/JS 링크 미삽입)
python src/html_generator.py templates/chapter.html output/html \
  --json output/parsed_bible.json

# 1) 오디오만 보장(미디어 업로드/스킵 결정)
python src/wordpress_api.py ensure-assets --audio-dir data/audio

# 2) 단일 장 게시 (비공개)
python src/wordpress_api.py publish-chapter \
  --html output/html/genesis-1.html \
  --book-name 창세기 --book-abbr 창세 --english-name Genesis --division 구약 --chapter 1

# 2.5) (선택) 본문/테마에 전역 검색 설정 주입
# 본문 상단 또는 테마에서 아래 스니펫으로 Worker/Index 경로 지정
cat <<'EOF'
<script>
  window.BIBLE_SEARCH_CONFIG = {
    workerUrl: "/wp-content/themes/your-child/assets/search-worker.js",
    searchIndexUrl: "/wp-content/uploads/common-bible/search/search-index.json",
  };
</script>
EOF

# 3) 준비 완료 후 공개 전환(필요 시 예약 공개)
python src/wordpress_api.py bulk-status --to publish --division-tag 구약
# 예약 공개 예시(UTC)
python src/wordpress_api.py bulk-status --to publish --schedule 2025-12-24T09:00:00Z
```

#### 링크 주입 모드(본문에 링크 삽입) 커맨드 블록

```bash
# 0) HTML 생성(본문에 CSS/JS 링크 삽입)
# - 워드프레스 게시 시 절대 URL 또는 사이트 루트 경로 권장
python src/html_generator.py templates/chapter.html output/html \
  --json output/parsed_bible.json \
  --css-href /wp-content/themes/your-child/assets/verse-style.css \
  --js-src  /wp-content/themes/your-child/assets/verse-navigator.js

# 1) 오디오는 필요 시 미디어 업로드
python src/wordpress_api.py ensure-assets --audio-dir data/audio

# 2) 단일 장 게시 (비공개)
python src/wordpress_api.py publish-chapter \
  --html output/html/genesis-1.html \
  --book-name 창세기 --book-abbr 창세 --english-name Genesis --division 구약 --chapter 1

# 3) 공개 전환(드라이런으로 대상 확인)
python src/wordpress_api.py bulk-status --to publish --division-tag 구약 --dry-run
```

## 3) HTML 템플릿/본문 측 주의사항

- 테마에서 CSS를 로드하므로, 본문 HTML에 `<link rel="stylesheet" ...>`를 넣을 필요가 없습니다.
- `verse-navigator.js`를 테마에서 로드하는 경우, 본문에서 별도 `<script src=...>`가 없어도 됩니다.
- 오디오 파일은 퍼블리셔가 업로드/참조 URL을 재작성하도록 구성합니다(파일이 없으면 대체 문구 표시).
  - URL 재작성은 `src/wordpress_api.py`의 `Publisher.render_and_publish_chapter`에서 수행되며, 테마 모드에서는 CSS 링크 주입 없이 오디오만 갱신됩니다.

## 4) 점검 체크리스트

- 차일드 테마 경로에 `assets/verse-style.css`가 존재하는가?
- `functions.php` 코드가 반영되었는가?
- 카테고리 `공동번역성서`가 존재하고 해당 게시물에 적용되어 있는가?
- 게시물 화면에서 CSS가 정상 적용되는가(브라우저 DevTools 네트워크 탭으로 확인)?
- 오디오 `source_url`이 유효한가(404/권한 문제 없는지)?
- 전역 검색이 동작하는가(검색 패널, 페이지네이션, 다른 문서 링크 이동)?
- 공개 전환 시점이 맞는가(예약 공개 `date/date_gmt` 확인)?

## 5) 참고

- 테마 파일 배포는 Git/CI, SFTP 또는 서버 측 WP-CLI 등으로 처리하는 것을 권장합니다.
- 추가 커스텀 스크립트/스타일이 필요하면 동일한 방식으로 `assets/`에 배치 후 `wp_enqueue_*`로 등록하십시오.
