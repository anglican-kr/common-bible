---
date: 2026-05-30
pr: 160
branch: claude/ui-styling-updates-Pc47W
title: "style: 헤더 아이콘 확대·설정/배속 버튼 테마색·FAB 그림자 보강"
---

# style: 헤더 아이콘 확대·설정/배속 버튼 테마색·FAB 그림자 보강

## 요약

읽기 화면의 UI 디테일을 다듬고, 헤더 아이콘 크기 지정 방식을 일원화했습니다.

## 변경 내용

### 1. 설정 버튼 · 오디오 배속 버튼 아웃라인에 테마색 적용
- 설정 기어 아이콘을 `--text-secondary` → `--accent`(테마색)로 변경, hover는 opacity로 처리
- 배속(1x) 버튼 테두리·글자를 `--accent`로, hover 시 옅은 accent 배경

### 2. 헤더 아이콘 확대 + 크기 지정 방식 일원화
- 홈/뒤로·북마크·설정 기어 세 아이콘을 **rem 기반 CSS 한 곳**(`.title-back-icon` 그룹 규칙)으로 통합, `1.45rem`으로 통일
- 북마크·기어 SVG의 **인라인 px `width/height` 속성 제거** → 크기는 CSS가 담당, JS는 `viewBox`만 설정
- 효과: 설정에서 글자 크기를 바꾸면 세 아이콘이 **함께 스케일**됨 (이전엔 홈만 rem이라 따라 커지고 북마크·기어는 px 고정이라 어긋났음)

### 3. 검색 FAB 그림자 보강
- 단일 그림자 → 2단 elevation 그림자(`0 4px 8px` + `0 8px 20px`)로 아래쪽 입체감 강화, hover도 함께 강화

## 검증

- `node --test` 영향 모듈(settings-ui, bookmark, views-routing) 158 케이스 통과
- 순수 CSS/아이콘 크기 변경, 기능 로직 변화 없음

## 커밋

1. `style:` 헤더 아이콘 확대·설정/배속 버튼 테마색·FAB 그림자 보강
2. `refactor:` 헤더 아이콘 크기 지정 방식 rem 기반 CSS로 일원화

https://claude.ai/code/session_01RpVN4zEG9LX7Pxa2NhWLd8
