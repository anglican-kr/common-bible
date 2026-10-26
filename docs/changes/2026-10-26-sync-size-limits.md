---
pr: 441
date: 2026-10-26
branch: docs/sync-size-limits
title: "docs: 동기화 자료의 크기 한도를 남은 일에 적음"
---

## 요약

구글 드라이브 동기화가 넘을 수 있는 한도를 조사해 `docs/topics/sync.md` 「남은 일」에 known-issues §33으로 적었다. §32는 먼저 열린 PR #438이 쓰고 있다. 파일 하나를 한 번에 올리는 크기(5MB), 기기 저장소, 사용자의 구글 저장 공간, 요청량의 네 가지다. 지금 쓰는 양은 모두 한도보다 훨씬 작아, 고칠 것은 없고 자료가 커질 때 다시 볼 곳을 남겼다.

## 확정 · 근거

- 사용자가 드라이브에 저장할 수 있는 크기에 제한이 있는지 묻고, 조사한 내용을 남은 일에 적어 달라고 했다(2026-10-26).
- 한도는 구글 문서(업로드 안내, 숨은 폴더 안내, 사용량 한도, 오류 처리 안내, Google One 도움말)에서 2026-10-26에 확인했다. 숨은 폴더 안내에는 저장 공간에 세는지가 없고, Google One 도움말이 「hidden app data」도 센다고 적는다.
- 확인하지 못한 것은 문서에도 그렇게 적었다. 5MB를 넘는 파일을 한 번에 올릴 때의 오류, 저장 공간이 꽉 찼을 때 사용자에게 보이는 것, 이 앱의 Google Cloud 프로젝트에 옛 한도와 새 한도 가운데 무엇이 적용되는지다.
- 북마크 하나의 크기는 앱이 만드는 필드(`bookmark-modals.js commitSaveBookmark`)와 식별자(`storage.js generateId`)로 임의의 북마크를 1,000개와 2,000개 만들어 그 차이로 쟀다. 처음 답에서는 UUID와 다른 필드로 재어 약 300바이트라고 했는데, 실제 필드로 다시 재니 약 230바이트였다.
- 403의 처리는 `state-machine.js`에서 확인했다. 다섯 번 다시 시도한 뒤 기다리는 상태(`IDLE`)로 돌아가고, 다음 동기화 요청 때 처음부터 다시 시도한다.

## 검증

- 문서 검사(`node --test tests/unit/docs-*.test.js tests/unit/liturgical-fixtures.test.js`): 31개 통과.
- 문장 검사(`python3 tools/prose/prose.py lint`)를 고친 두 문서에 돌렸다. 새로 쓴 줄에서는 영어 낱말 셋이 나왔다. 「id」는 「식별자」로 고쳤고, Gmail과 Google Cloud는 제품 이름이라 그대로 두었다.
- 유닛 전체와 e2e는 돌리지 않았다. 문서만 바꿨다.

## 갱신한 문서

- `docs/topics/sync.md` 「남은 일」: known-issues §33.
- `docs/known-issues.md`: §33 대장 줄, 다음 번호를 §34로.
