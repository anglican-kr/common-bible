---
pr: 385
date: 2026-10-23
branch: docs/prose-adr-batch4
title: "docs: ADR 021 023 024 025의 문장 정리"
---

## 요약

ADR과 설계서 문체 정리(known-issues §24)의 넷째 PR이다. ADR 021, 023, 024, 025를 고쳐 썼다. 기준은 `docs/writing.md`의 pitfalls §37과 §40, 그리고 「용어」와 「학술 · 법률 문체 낱말」 목록이다. 옛 개정 블록은 본문의 해당 자리에 반영하고 지웠다. 바뀌기 전의 선택은 「검토한 대안」이나 「대안」에 「채택 안 함 날짜 · 이유」로 남겼다.

| ADR | 본문에 반영한 것 | 대안으로 옮긴 것 |
| --- | --- | --- |
| 021 | 데이터 동기화와 릴리스 나누기(2026-05-23), 자동 커밋에서 `[skip ci]` 빼기(2026-05-23), 셸 미리 넣기의 캐시 우회와 서버 응답 헤더(2026-05-27), sync-data.yml의 PR 흐름(2026-05-30)과 배포 키(2026-08-29) | 자동 release.py patch, `[skip ci]`, main에 바로 올리기, 서브모듈용 PAT |
| 023 | 개정 블록 없음. 데스크톱 토글 모양과 Android Material 3 Expressive(2026-05-30, #153)를 코드에서 확인해 반영 | 처음의 OS 둘 구분과 Material 3 썸 크기 변화 |
| 024 | 탭 고정과 미끄러지는 인디케이터, 구약 소분류 제거(2026-05-29), 떠 있는 칩(2026-05-30), 홈 버튼이 읽던 책에 포커스(2026-06-07) | 활성 탭 accent 배경, 테마색 윤곽선 인디케이터, 구약 소분류 유지 |
| 025 | 표면 목록의 지금 상태(2026-06-21), 라이트 알파 `0.12`, hairline 되살림과 fade 제거(2026-05-30), 책 목록 그림자(2026-06-09) | hairline 지우기, 책 목록 그림자 생략 |

이 밖에 두 가지를 함께 넣었다.

- **squash 머지 메시지 규칙을 바로잡았다.** #384에서 「Co-Authored-By 줄을 넣지 않는다」로 적고 그 PR의 머지 메시지에서 그 줄을 모두 뺐다. 사용자의 뜻은 GitHub가 맨 끝에 한 번 더 붙이는 줄만 빼는 것이었다(2026-10-23 사용자 교정). 머지할 때 커밋 목록만 `commit_message`로 넘기면 커밋마다 붙은 줄은 남고, 겹친 마지막 줄만 빠진다. `CLAUDE.md`의 머지 명령과 `docs/workflow.md`를 고쳤다. #384의 머지 커밋은 force push가 금지라 그대로 둔다.
- **known-issues §26을 기록했다.** ADR-016은 캐시에서 지운 장을 오프라인에서 재생할 때 따로 안내하기로 했지만, 지금 앱은 이유와 상관없이 「오디오 파일을 준비 중입니다.」를 보인다. 사용자가 나중에 고치도록 기록해 두기로 했다(2026-10-23). 오디오 주제 문서의 「남은 일」에 적고, 번호 대장과 ADR-016 D4에서 가리킨다.

## 확정 · 근거

- **낡은 사실을 지금에 맞췄다.** 모두 저장소에서 확인했다.
  - ADR-021의 release.py: 처음에는 `git add version.json sw-version.js data`로 서브모듈 포인터와 sitemap.xml까지 담았지만, 2026-05-23(커밋 `3545226`)부터 `version.json`과 `sw-version.js`만 담는다(`scripts/release.py`).
  - ADR-021의 build.yml 입력: 지금은 `source/**`와 audio 말고도 교회력 데이터를 포함한 파이프라인 입력 전체를 본다(data 저장소 `.github/workflows/build.yml`).
  - ADR-021의 「ADR-020 §22」 「§73-74」: 옛 ADR-020의 줄 번호였다. ADR-020은 #384에서 다시 썼으므로 「세부 결정 3」과 「수동 두 단계」 흐름이라는 이름으로 바꿨다.
  - ADR-023의 OS 감지: `detectOS()`는 iOS, Android, 데스크톱의 셋을 돌려주고 `.os-desktop` 스타일이 있다. Android 썸은 두 상태 모두 22px이고, `--switch-m3-off-track`은 #153에서 지웠다(`js/app/settings-ui.js`, `css/style.css`, 커밋 `28e98a8`). 모바일 설정 탭 화면(ADR-029)도 같은 행을 그린다.
  - ADR-024의 모바일 헤더: ADR-029의 하단 탭 바(2026-06-04, #183)가 모바일 설정과 성서 목록을 맡아 `.title-settings-btn`과 `.title-home-btn`을 숨긴다. 데스크톱도 제목 헤더의 설정 버튼을 숨기므로, 지금은 어느 폭에서도 제목 헤더의 설정 버튼이 보이지 않는다. 모바일 북마크 버튼은 2026-06-05(#190)부터 `right: 0`이다. 인디케이터 그림자는 지금 `--shadow-1` 토큰이다.
  - ADR-024와 ADR-025의 코드 위치: `views-routing.js`의 화면 코드는 지금 `js/app/views.js`에 있다(ADR-034).
  - ADR-025의 그림자 값과 시간: `--shadow-3` 토큰(라이트 `0 4px 16px rgba(0, 0, 0, 0.12)`, 다크 `0 4px 20px rgba(0, 0, 0, 0.25)`)과 `--duration-fast` 토큰을 쓴다(`css/style.css`).
- **일부러 뺀 것.**
  - ADR-025의 `css/style.css:188-194`, `:168-177` 줄 링크: 지금 줄과 맞지 않아 선택자 이름과 파일 이름으로 바꿨다.
  - ADR-024의 사실 토큰 하나(「의 세 번째 인자로 책 id 를 받아, 클릭 시」): 옛 글에서 줄바꿈을 사이에 둔 백틱 짝을 비교 도구가 코드로 읽은 것이다. 실제 이름(`buildHomeBtn(target, ariaLabel, focusBookId)`)은 남아 있다.
- **공개 저장소라 서버 정보는 더하지 않았다.** ADR-021의 PAT와 배포 키 이름, 서버 응답 헤더 정책은 이미 있던 내용만 옮겼다.
- 그 밖의 사실은 바꾸지 않았다.

## 검증

- `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE --docs 'docs/decisions/02[1345]-*.md' --kinds general --strict-counts`에서 줄어든 토큰은 0이고, 사라진 토큰은 위에 적은 ADR-024의 하나뿐이다. 개정 블록을 합치며 덜 적은 것(`release.py patch`, 「1회」, `SYNC_DATA_PR_PAT`, `/${division}`, `_prevDivisionIdx`, `buildHomeBtn`, `#sticky-group::after`, `css/style.css`)은 되살렸다.
- `node --test tests/unit/docs-*.test.js`는 23개가 모두 통과했다.
- 네 ADR에 「꼴」이 없다. 물결표는 표에서 칸마다 하나씩 쓴 근삿값뿐이고, 본문의 근삿값은 「약」으로 바꿨다. 영어 단어를 술어로 쓴 곳(activate할 때, promote한다, `navigate(target)`한다 등)은 한국어 술어로 바꿨다.

## 갱신한 문서

- `docs/decisions/021-pwa-versioning-content-hash.md`, `023-settings-toggle-switches.md`, `024-book-list-tabs-and-header-nav.md`, `025-header-scroll-elevation.md`: 문장 정리와 개정 블록 반영.
- `CLAUDE.md` 「브랜치 보호 / 작업 흐름」의 머지 명령, `docs/workflow.md` 「커밋과 PR」: squash 머지 메시지는 커밋 목록만 넘겨 겹친 마지막 줄을 뺀다.
- `docs/topics/audio.md` 「남은 일」, `docs/known-issues.md`(§26, 다음 번호 §27), `docs/decisions/016-audio-cache-lru.md` D4: 지운 장을 오프라인에서 재생할 때의 안내.
