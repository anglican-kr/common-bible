---
date: 2026-08-01
pr: 311
branch: fix/instance-keys-guard
title: "fix: instanceKeys 길이 가드 + chapter_ref JSDoc 타입 정정 (#310 후속)"
---

# fix: instanceKeys 길이 가드 + chapter_ref JSDoc 타입 정정 (#310 후속)

## 배경

PR #310 Copilot 재리뷰의 suppressed(참고) 의견 3건 후속.

## 변경

1. **`appendVerses` instanceKeys 길이 가드** — override 배열이 `verses` 와 길이가 다르면 무시하고 재계산으로 폴백. 어긋난 배열이 넘어와도 렌더 중 크래시 대신 안전한 기본 동작.
2. **`verseInstanceKey` JSDoc 정정** — `chapter_ref` 를 `types.d.ts` 의 `BibleVerse.chapter_ref`(string)와 일치시킴.
3. **known-issues §4 신설** — 전례 글리프(◯·¶·"(N)")가 본문 복사에 포함되는 건: `serializeVerseRange` 가 아직 세 클래스를 모르므로, 제외 여부는 제품 판단 대기로 기록(주보 제작 용도라면 오히려 필요할 수 있음).

## 검증

유닛 825 통과 · e2e 전례 렌더 10건 통과 · tsc 두 구성 통과.
