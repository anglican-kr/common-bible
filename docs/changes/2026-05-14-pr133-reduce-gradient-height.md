---
date: 2026-05-14
pr: 133
branch: claude/reduce-gradient-height-uxj4Y
title: "style: 헤더 아래 그라데이션 높이 축소 (2rem → 0.5rem)"
---

# style: 헤더 아래 그라데이션 높이 축소 (2rem → 0.5rem)

## Summary
- `#sticky-group::after`의 페이드 그라데이션 높이를 `2rem` → `0.5rem`로 축소

## Test plan
- [ ] 헤더 아래 페이드 영역이 기존 대비 얇아진 것 시각 확인
- [ ] 스크롤 시 본문이 헤더 경계에서 자연스럽게 페이드되는지 확인
