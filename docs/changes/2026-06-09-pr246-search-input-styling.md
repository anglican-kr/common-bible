---
date: 2026-06-09
pr: 246
branch: claude/search-input-styling-A9sE1
title: "feat: 검색 필터를 검색 필드 안 토큰으로 (HIG search tokens)"
---

# feat: 검색 필터를 검색 필드 안 토큰으로 (HIG search tokens)

## 배경

검색 결과 화면에서 별도 **필터 바**(책 선택 버튼 + 칩 줄 + "결과 내 검색" 입력)가 하단 모핑 검색 pill 과 함께 떠 **"검색창이 두 개"** 로 보이는 어색함이 있었다. Apple HIG(Search Fields)는 필터/추가어를 **검색 필드 안의 token** 으로 흡수하고 검색 표면을 한 곳으로 유지하라고 권한다.

→ ADR-033 의 **대안 A(검색어 필드 안 토큰)** 로 전환. 이 PR 은 option A("＋ 낱말 추가" 버튼, `49dbc27`)로 시작했다가 리뷰 후 **option B(in-field 토큰, `904b04c`)** 로 전환했고, 이후 시각 피드백·Bugbot 리뷰를 반영해 다듬었다.

## 최종 동작

- 필터가 **검색 필드 안의 칩**으로 표시 — 별도 필터 바 없음. 세 입력 지점(헤더 `#search-bar` · 모바일 in-page `#search-inpage-bar` · 하단 모핑 pill `#tab-search-dock`)에 `mountSearchField` 로 토큰 존을 끼우고 `syncSearchFields()` 가 매 route + 모핑 open 에서 URL 필터를 칩으로 다시 그린다.
- **책 스코프** = 좌측 깔때기 버튼(책 선택 시트 진입) + 책마다 제거 가능한 **축약명 칩**(요한, 창세 …).
- **결과 내 검색(AND)** = 제거 가능한 칩 + 쿼리 있을 때만 보이는 "＋ 좁히기" → 인라인 입력.
- **Backspace**(빈 필드·caret 0)로 마지막 토큰 제거, 칩 × 로 개별 제거.
- **`in:<별칭>` 흡수** — 예제·최근검색·직접 입력의 `in:요한` 연산자를 커밋 시 풀어 책 칩으로 옮기고 입력엔 낱말만 남김. 별칭 맵은 부팅 시 preload → `commitTopSearch` 는 **동기**(async 경합 표면 없음).
- **선두 아이콘** — 검색 활성 시 pill 좌측 돋보기는 숨기고 깔때기가 선두. 단 쿼리·스코프가 모두 빈 "빈 검색"에선 돋보기를 선두로(검색으로 읽히게).
- **책 선택 시트** = 한 줄 세로 리스트 → **칩 다중선택 그리드**(division 그룹 유지). 적용 후 검색 입력에 포커스(모바일 키보드 올림).
- **오버플로** — 토큰이 많으면 `.token-zone` 이 가로 스크롤, 메인 입력·clear 는 밖이라 항상 닿음.
- 탭타깃(깔때기·칩 ×·좁히기·책 칩)은 `--touch-target`(44px) 확보, 칩은 Sans·축약명.

## 변경 요약

| 파일 | 변경 |
| --- | --- |
| `js/app/search.js` | 토큰 시스템(`mountSearchField`/`syncOneField`/`syncSearchFields`/`buildFieldToken`), `in:` 흡수(`ensureAliasMap`/`extractInScope`), 책 시트 칩 그리드, `buildSearchFilterBar`/`buildFilterChip` 제거 |
| `css/style.css` | `.token-*`/`.field-token*` 추가, 헤더 flex 화, 책 시트 칩 그리드, 옛 `.search-filters`/`.search-scope-*`/`.search-refine-*`/`.search-chip*` 제거 |
| `js/app/routing.js` | route() 에서 `syncSearchFields()` |
| `js/app/tabbar.js` | 모핑 open·동기화 시 `syncSearchFields()`, pill clear 가 책 스코프 보존 |
| `docs/decisions/033-search-options.md` | 개정 블록(option B) |

> **워커·URL(`in=`/`and=`) 스키마 무변경** — 필터가 *어떻게 보이는지*만 바뀜.

## 리뷰 반영 (Bugbot 라운드)

- book-map id 깜빡임, dead CSS 제거, refine 입력 커밋 후 접기, Backspace 빈 필드 한정, 탭타깃 44px(토큰·책 칩·좁히기), 빈 쿼리 AND 칩 미렌더, async stale 가드 → **async 제거로 근본 해소**, aborted commit 최근검색 미저장, pill clear 스코프 보존, 데스크탑 빈 /search 헤더 토큰 숨김.

## 검증

- `node --test tests/unit/*.test.js` 통과(검색 78), `tsc --noEmit` 0.
- ⚠️ DOM·시트·모핑·iOS 키보드 상호작용은 로컬 e2e/실기기 책임 — **모바일 pill 레이아웃·적용 후 키보드 포커스는 디바이스 시각 검증 필요**.

https://claude.ai/code/session_019wtZXYjaAhneGBdFw9iWZz
