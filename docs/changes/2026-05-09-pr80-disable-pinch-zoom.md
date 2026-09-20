---
date: 2026-05-09
pr: 80
branch: claude/disable-pinch-zoom-gq87D
title: "feat: 모바일 핀치 줌 비활성화"
---

# feat: 모바일 핀치 줌 비활성화

## Summary
- `index.html` viewport 메타 태그에 `maximum-scale=1.0, user-scalable=no` 추가
- 손가락 모으기로 화면 확대/축소 차단

## 적용 범위
| 환경 | 동작 |
|------|------|
| Android Chrome (브라우저/PWA) | ✅ 차단됨 |
| iOS standalone PWA (홈 화면 추가) | ✅ 차단됨 |
| iOS Safari 브라우저 | ⚠️ iOS 10+ 접근성 정책으로 viewport 무시 → 차단 안 됨 |
| 데스크톱 | n/a (핀치 줌 미지원) |

iOS Safari 브라우저에서는 OS 차원의 접근성 보호가 우선합니다. JS gesture 이벤트로 강제 차단할 수 있으나 본 PR 범위 밖. 주 사용자(설치된 PWA)는 정상 차단됩니다.

## 접근성 메모
WCAG 2.1 SC 1.4.4 (Resize Text)는 앱 내장 글자 크기 조절 UI(설정 메뉴)로 충족됨.

## Test plan
- [ ] Android Chrome에서 핀치 줌이 동작하지 않음
- [ ] iOS 홈 화면 추가(standalone) 모드에서 핀치 줌이 동작하지 않음
- [ ] 데스크톱 브라우저에서 레이아웃 회귀 없음

https://claude.ai/code/session_01Fszn1PsAxuXTi7Na59bZV5
