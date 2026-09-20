---
date: 2026-09-01
pr: 317
branch: fix/deploy-keys-clean
title: "fix: 서브모듈 클론을 읽기 전용 배포 키로 — 만료되는 계정 PAT 를 걷어낸다"
---

# fix: 서브모듈 클론을 읽기 전용 배포 키로 — 만료되는 계정 PAT 를 걷어낸다

> 종전 #316 을 대체한다 — 그 PR 은 실수로 `docs/liturgical-data-sync`(#314)에서 브랜치를 따 전례 문서 커밋 18개가 딸려 들어갔다. 리뷰 지적대로 **`main` 에서 다시 따 배포 키 변경만** 담는다.

## 문제

`sync-data.yml` 이 계정 PAT 로 비공개 서브모듈을 클론했다.

**① 만료된다.** 2026-08 에 만료돼 이 워크플로가 조용히 실패했다. 같은 이름의 시크릿(`SUBMODULE_AND_DISPATCH_PAT`)이 **data 저장소에도 따로** 있어서, data 쪽만 갈았을 때 「CI 복구됐다」고 판단했다가 앱 쪽은 그대로 죽어 있었다.

**② 계정 권한 범위를 통째로 들고 다닌다.** 필요한 건 비공개 저장소 둘의 읽기뿐이다.

## 배포 키로 바꾼다

| | PAT | 배포 키 |
|---|---|---|
| 범위 | 계정 단위 | **저장소 하나** |
| 읽기 전용 | 설정으로 지정 | **GitHub 가 강제** |
| 만료 | 있음 — 이번 사고 원인 | **없음** |

조직 정책에서 배포 키가 꺼져 있어 먼저 켰다(사용자 확정). 이 워크플로는 `workflow_dispatch` 전용에 `permissions: contents: read` 라 포크 PR 이 시크릿에 닿지 못한다.

키가 둘인데 호스트가 하나라 **호스트 별칭**을 두고 URL 을 돌린다 — 종전 PAT 방식이 쓰던 `insteadOf` 와 같은 수법이라 개념이 늘지 않고 **서드파티 액션을 들이지 않는다**.

## 호스트 키를 TLS 경로에서 받는다 (리뷰 반영)

`ssh-keyscan` 은 그때 네트워크가 주는 키를 그대로 신뢰한다(TOFU) — 경로가 가로채이면 공격자 키가 `known_hosts` 에 박히고 그 뒤로 서브모듈을 통째로 신뢰하게 된다. `https://api.github.com/meta` 에서 받는다(인증서로 검증된 경로). 지문을 코드에 박지 않는 이유는 GitHub 가 실제로 키를 교체하기 때문이다(2023 RSA 교체).

## 문서도 함께 (리뷰 반영)

파일 머리 주석과 `ADR-021` 이 여전히 「`SUBMODULE_AND_DISPATCH_PAT` 으로 서브모듈을 클론한다」고 적고 있었다 — 그대로 두면 **운영자가 폐기할 PAT 를 다시 만든다.** 둘 다 현재 구성(배포 키 2 + `SYNC_DATA_PR_PAT`)으로 갱신했다.

## 검증 — 실제 인증까지 확인했다

```
github-data  → common-bible-data  : 422ac3e… HEAD
github-audio → common-bible-audio : b5477b2… HEAD
(StrictHostKeyChecking=yes 로 호스트 키 검증 통과)
```

워크플로의 셸 스니펫을 가짜 HOME 에서 실행해 키·설정을 만든 뒤 그것으로 실제 `git ls-remote` 까지 돌렸다 — YAML 블록 스칼라 안의 heredoc 들여쓰기가 어긋나기 쉬운 자리다.

## 남겨 둔 것

`SUBMODULE_AND_DISPATCH_PAT` 은 아직 지우지 않았다 — data 저장소 `build.yml` 이 같은 이름으로 쓰고 있고(디스패치에 `Actions:Write` 가 필요해 배포 키로 못 바꾼다), 앱 쪽 사본이 더 안 쓰이는지 확인한 뒤 지우는 게 안전하다.
