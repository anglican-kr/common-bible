# 기준 사본을 두는 상태 기반 동기화(세 방향 병합)와 이 기기의 변경 알아내기

조사일 2026-10-30. 표시: **[1차]** 이번 조사에서 1차 출처(소스 코드, 공식 설명서, RFC, 제작사의 기술 블로그)를 직접 읽고 확인, **[2차]** 2차 출처(초록, 도서 목록, 다른 사람의 제품을 설명한 글), **[미확인]** 이번 조사에서 다시 읽지 않은 기억. 추론은 인용한 사실에서 조사자가 이끌어 낸 것이라 따로 적는다. 출처의 인용은 한국어로 옮겨 낫표(「」)로 묶었고, 원문은 각 링크에 있다. 이 노트는 영어로 썼다가 2026-10-31에 한국어로 옮겼다.

조사할 때 주어진 앱의 상황(조사하지 않고 받은 전제): Google Drive appDataFolder의 JSON 파일 하나에 북마크(id마다 `parentId`, 순서 값 등을 담은 평평한 목록), 설정, 읽던 위치를 둔다. 기록마다 `_u`는 고친 기기의 `Date.now()`다. 병합은 `_u`가 큰 쪽을 남기고, 같으면 기기 id로 정한다. 삭제 기록은 id마다 시각이다. 올릴 때 ETag로 `If-Match`를 보낸다. 내려받기가 304이면 이 기기의 가장 큰 `_u`가 지난 동기화 때 캐시한 값과 다를 때만 올린다. 저장소는 localStorage다(Safari 약 5 MiB, 글자는 UTF-16). 북마크는 이미 두 벌 저장한다. 기준 사본이 없는 옛 버전 앱이 계속 쓰인다. 기기는 1-4대다.

## 1. Unison, git, Dropbox, Firefox Sync(dogear), Joplin은 기준을 어떻게 저장하고 쓰는가, 양쪽이 모두 바뀌면 어떻게 하는가

### 요점
오래 쓰인 상태 기반 동기화 도구는 모두 「마지막으로 맞춘 상태」를 저장하거나 이끌어 내고, 양쪽을 저마다 그 상태와 비교해 어느 쪽이 바뀌었는지 판단한다. 두 기기의 시계를 서로 비교하지는 않는다. Unison은 같은 컴퓨터에서 잰 시각끼리만 비교한다고 밝힌다. 다른 점은 둘이다. 하나는 기준에 담는 것이다. 지문을 단 전체 보관 파일, 서버를 그대로 비춘 전체 트리, 항목마다의 표시와 서버가 매긴 시각, 항목마다의 동기화 시각과 저장해 둔 노트 본문이 있다. 다른 하나는 양쪽이 모두 바뀌었을 때의 방침이다. Unison은 사용자에게 묻고, Dropbox와 Joplin은 두 사본을 모두 남기며, Firefox는 서로 다른 시계로 잰 「고친 지 지난 시간」을 견주어 더 최근에 고친 쪽을 남긴다.

### 출처가 있는 사실

**Unison(보관 파일)**
- [1차] Unison은 컴퓨터마다 보관 파일을 두고, 이 파일은 「마지막으로 동기화했을 때 복제본의 각 경로 상태를 기록한다」. 지금의 복제본과 이를 비교해 「어느 경로가 바뀌었는지 알아낸다」. 단계는 보관 파일과 비교해 변경을 찾고, 가짜 충돌을 걸러 내고, 변경을 보여 주고, 실행한 뒤, 마지막에 「복제본의 새 상태를 반영하도록 보관 파일을 고친다」. ([Unison 설명서 원문, src/strings.ml](https://github.com/bcpierce00/unison/blob/master/src/strings.ml))
- [1차] 충돌의 정의: 경로가 충돌하는 것은 「(1) 한 복제본에서 바뀌었고, (2) 그 경로나 그 아래의 무엇이든 다른 복제본에서 바뀌었으며, (3) 두 복제본의 내용이 같지 않을 때」다. ([Unison 설명서, strings.ml](https://github.com/bcpierce00/unison/blob/master/src/strings.ml))
- [1차] 가짜 충돌: 「양쪽 복제본에서 모두 바뀌었지만 지금 값이 같은 경로는 … 두 복제본의 보관 파일에 말없이 동기화된 것으로 표시된다.」 ([Unison 설명서](https://github.com/bcpierce00/unison/blob/master/src/strings.ml))
- [1차] 충돌 방침: 「충돌하는 변경은 보여 주기만 한다.」 사용자가 정한다. 자동으로 정하는 옵션도 있다. `-prefer xxx`(「충돌하는 변경에는 이 복제본의 것을 쓴다」)와 `-copyonconflict`(「충돌한 파일의 사본을 남긴다」)다. ([Unison 설명서](https://github.com/bcpierce00/unison/blob/master/src/strings.ml))
- [1차] 변경을 찾는 비용: `fastcheck`를 쓰면 「Unison은 파일의 수정 시각으로 확실히 바뀌지 않은 파일을 먼저 빠르게 거른다. 그다음 바뀌었을 수 있는 파일마다 내용의 지문을 계산해 마지막으로 동기화한 내용과 비교한다.」 내용을 바꾸지 않고 파일의 수정 시각만 바꾸는 일은 「Unison이 갱신할지 말지에 결코 영향을 주지 않아야 한다.」 ([Unison 설명서](https://github.com/bcpierce00/unison/blob/master/src/strings.ml))
- [1차] 시계: 「Unison은 실행되는 여러 컴퓨터 사이의 시계 차이에 영향을 받지 않는다. 같은 컴퓨터에서 얻은 시각끼리만 비교하고, 그 시각에 대해 가정하는 것은 각 시스템의 시계가 늘 앞으로만 간다는 것뿐이다.」 ([Unison 설명서](https://github.com/bcpierce00/unison/blob/master/src/strings.ml))
- [1차] 「각 복제본의 보관 파일은 그 복제본이 있는 컴퓨터의 .unison 폴더에 있다」, 그리고 「Unison은 루트 한 쌍마다 완전히 다른 보관 파일 묶음을 둔다」. 그래서 기준은 복제본 한 쌍마다 따로 있고, 양쪽 컴퓨터에 저장된다. ([Unison 설명서](https://github.com/bcpierce00/unison/blob/master/src/strings.ml))

**git**
- [미확인] git은 기준 사본을 따로 저장하지 않는다. 커밋 그래프에서 공통 조상을 계산하고(`git merge-base`) 그것과 세 방향 병합을 한다. 그래서 기준을 두는 데 어차피 남기는 이력 말고는 비용이 들지 않는다. ([git-merge-base 문서](https://git-scm.com/docs/git-merge-base), 이번 조사에서 다시 읽지 않음)

**Dropbox(Nucleus)**
- [1차] Nucleus는 트리 셋을 둔다. 「Remote Tree는 클라우드에 있는 사용자 Dropbox의 최신 상태다」, 「Local Tree는 디스크에 있는 사용자 Dropbox를 마지막으로 관찰한 상태다」, 「Synced Tree는 Remote Tree와 Local Tree 사이에서 마지막으로 알려진, 완전히 동기화된 상태를 나타낸다.」 ([Dropbox, Testing sync at Dropbox](https://dropbox.tech/infrastructure/-testing-our-new-sync-engine))
- [1차] 「Synced Tree의 각 노드를 병합 기준으로 생각할 수 있다」, 「병합 기준이 있으면 변경의 방향을 알아낼 수 있다.」 Synced Tree가 없으면 원격에서 더한 파일과 사용자가 이 기기에서 지운 파일을 구별할 수 없다. 목표는 「세 트리를 모두 같은 상태로 모으는 것」이다. ([Dropbox, Testing sync at Dropbox](https://dropbox.tech/infrastructure/-testing-our-new-sync-engine))
- [1차] Nucleus는 파일과 폴더에 「전역에서 유일한 식별자」를 준다. 옛 엔진은 옮기기를 「지우기와 더하기」로 나타내서, 「지우기는 반영됐는데 그에 맞는 더하기는 반영되지 않으면」 옮긴 파일을 잃을 수 있었다. 오프라인에서 동시에 옮겨 고리가 생기는 경우, 옛 엔진(Classic)은 폴더를 복제했고, Nucleus에서는 「최종 순서는 어느 동기화 엔진이 먼저 옮기기를 올리느냐에 달렸다」. 서버가 쓰기를 받은 순서가 정한다. ([Dropbox, Rewriting the heart of our sync engine](https://dropbox.tech/infrastructure/rewriting-the-heart-of-our-sync-engine))
- [2차] 사용자에게 보이는 Dropbox의 충돌 방침은 「충돌 사본」이고, 「사용자가 … 손으로 합쳐야 한다」. ([Kleppmann 외, Local-first software(2019)](https://www.inkandswitch.com/essay/local-first/))

**Firefox Sync 북마크(SyncedBookmarksMirror와 dogear)**
- [1차] 서버 사본(mirror)은 「Sync 서버에 저장된 트리 전체와 같고, 지난 동기화 뒤 서버에서 바뀐 북마크를 새로 들여 둔다. 병합기는 Places의 로컬 트리와 서버를 비춘 원격 트리를 돌며 새 병합 트리를 만들고, 그다음 로컬 트리를 고친다.」 병합과 적용은 「한 트랜잭션 안에서 … 이 시점의 실패는 병합을 취소하고 Places를 그대로 둔다.」 ([SyncedBookmarksMirror.sys.mjs 머리 주석](https://github.com/mozilla-firefox/firefox/blob/main/toolkit/components/places/SyncedBookmarksMirror.sys.mjs))
- [1차] 소스는 dogear를 「양방향 병합기」라고 적는다. dogear는 「iOS에서 거의 그대로 옮겨 왔고」, iOS의 `ThreeWayMerger`는 「지난 동기화 뒤의 서버 상태를 담은 완전한 사본 트리를 받는다」. 그러나 「dogear는 바뀐 항목의 공통 조상을 저장하지 않으므로 양방향 병합만 할 수 있다.」 대신 「`needs_merge` 표시는 북마크가 바뀌었다는 것만 알려 주고, 어떻게 바뀌었는지는 알려 주지 않는다. 그래서 iOS라면 깔끔하게 합칠 수 있는 경우에도 충돌로 알아보고 한쪽의 변경을 되돌릴 수 있다.」 만든 사람들은 대부분의 사용자가 「여러 기기에서 동시에 충돌하는 변경을 하지」 않으므로 이것이 「정확성과 복잡도 사이의 좋은 균형」이라고 본다. ([dogear src/merge.rs](https://github.com/mozilla/dogear/blob/master/src/merge.rs))
- [1차] 「바뀌었다」를 계산하는 법: 이 기기 쪽은 `needs_merge = syncChangeCounter > 0`이다(`moz_bookmarks`의 줄마다 있는 횟수 값). 원격 쪽 `needs_merge`는 서버 사본 줄의 `needsMerge` 표시이고, 새로 내려받은 기록을 저장할 때 켜고 병합한 뒤 끈다. ([Firefox bookmark_sync/src/store.rs](https://github.com/mozilla-firefox/firefox/blob/main/toolkit/components/places/bookmark_sync/src/store.rs))
- [1차] 값 충돌 방침(`resolve_value_conflict`): 양쪽이 모두 바뀌었으면, 올바른 항목은 「시각을 비교해 어느 쪽이 더 새로운지 정한다」(`local_node.age < remote_node.age`이면 이 기기 쪽). 이 기기 쪽만 바뀌었으면 이 기기 쪽, 원격만 바뀌었으면 원격이 남는다. 기본으로 있는 맨 위 폴더는 늘 이 기기 쪽을 둔다. 한쪽이 올바르지 않으면 다른 쪽을 쓴다. 양쪽이 모두 바뀐 자식 순서는 「늘 더 새로운 쪽을 쓴다」. ([dogear src/merge.rs](https://github.com/mozilla/dogear/blob/master/src/merge.rs))
- [1차] 「고친 지 지난 시간(age)」은 한 시계 안에서 잰 길이다. 이 기기 쪽은 `age = local_time_millis - localModified`, 원격은 `age = remote_time_millis - serverModified`이고, `serverModified`는 서버가 기록에 매긴 시각이다. ([Firefox store.rs](https://github.com/mozilla-firefox/firefox/blob/main/toolkit/components/places/bookmark_sync/src/store.rs)) [미확인] `remote_time_millis`가 응답에 담긴 서버의 「지금」인지는 이번 조사에서 확인하지 못했다.
- [1차] 구조 충돌 방침(`resolve_structure_conflict`, 자식을 어느 부모 아래 둘지): 한쪽의 부모만 바뀌었으면 「자식을 새 부모에 둔다」. 양쪽의 부모가 모두 바뀌었으면 양쪽마다 자식과 부모 가운데 더 최근에 고친 쪽의 「지난 시간」을 견준다. ([dogear src/merge.rs](https://github.com/mozilla/dogear/blob/master/src/merge.rs))
- [1차] 지우기와 고치기가 부딪칠 때: 「폴더가 아닌 자식이 이 기기에서 지워지고 원격에서 바뀌었으면, 이 기기의 삭제를 무시하고 원격의 자식을 받는다」(되살림). 「폴더는 늘 이 기기의 삭제를 받고, 원격에서 바뀐 손자 항목은 병합된 노드로 옮긴다.」 원격에서 지운 경우도 같은 규칙이다. 지웠고 다른 쪽에서 바뀌지 않았으면 지운 것이 남는다. ([dogear src/merge.rs](https://github.com/mozilla/dogear/blob/master/src/merge.rs))

**Joplin**
- [1차] Joplin은 항목마다, 동기화 대상마다 `sync_items`에 정보(`sync_time`, `force_sync`)를 둔다. 올린 뒤에는 `sync_time`을 그 항목의 `updated_time`으로 쓴다(`saveSyncTime(syncTargetId, local, local.updated_time, ...)`). 동기화가 필요한 항목은 이렇게 처리한다. 원격이 없고 `sync_time`도 없으면 원격에 만든다. 원격이 없는데 `sync_time`이 있으면 충돌이다(「원격은 지워졌지만 이 기기에 변경이 있다」). 원격이 있고 `remoteContent.updated_time > local.sync_time`이면 충돌이고(「원격과 이 기기 모두 변경이 있다」), 아니면 원격을 고친다. ([Joplin Synchronizer.ts](https://github.com/laurent22/joplin/blob/dev/packages/lib/Synchronizer.ts))
- [1차] Joplin은 `updated_time`을 얻으려고 원격 항목 전체를 읽는다. 동기화 대상의 파일 시각을 믿을 수 없기 때문이다(「OneDrive는 시각이 정확하지 않은 듯하다. `lastModifiedDateTime`이 가끔 몇 초 앞선다」). 원격 항목의 `updated_time`이 하루보다 더 미래이면 예외를 던진다. ([Joplin Synchronizer.ts](https://github.com/laurent22/joplin/blob/dev/packages/lib/Synchronizer.ts))
- [1차] 노트가 양쪽에서 모두 바뀌면 충돌 노트(사본)를 만든다. 충돌 자동 병합 작업(사양 커밋 2026-10-05)부터 Joplin은 동기화 대상마다 **기준**을 `sync_items.base_body`와 `base_title`에 저장하고, 이 값은 「올린 뒤, 내려받은 뒤, 충돌 뒤에 기록한다」. 병합은 줄 단위 diff3다. 겹치지 않는 편집은 합치고, 겹치는 편집은 여전히 충돌 노트를 만든다. 「기록된 기준이 없을」 때, 항목이 잠겼거나 읽기 전용일 때, 복호화에 실패할 때, 차이가 한도를 넘을 때는 그냥 충돌 노트를 만든다. ([Joplin conflict_auto_merge.md](https://github.com/laurent22/joplin/blob/dev/readme/dev/spec/conflict_auto_merge.md))
- [1차] Joplin 동기화 대상의 `info.json` 속성은 `updatedTime`을 담고, 이는 「두 클라이언트가 같은 속성에 같은 동작을 할 때 충돌을 정하는 데」 쓰인다. ([Joplin 동기화 사양](https://joplinapp.org/help/dev/spec/sync))

### 추론
- 공통 방식은 이렇다. 기준과 비교해 판단하면 쉬운 세 경우(이 기기만 바뀜, 원격만 바뀜, 둘 다 그대로)에서 시계가 빠진다. 시계(또는 사용자에게 묻기, 또는 정해진 규칙)는 실제로 동시에 고친 경우에만 쓴다. Firefox는 그 경우에도 두 기기의 시계를 서로 비교하지 않는다. 이 기기의 편집은 이 기기 시계로, 원격 기록은 서버 시계로 잰 「지난 시간」을 견주기 때문이다. Google Drive에 파일 하나를 두는 설계에는 기록마다의 서버 시각이 없어 이 방법을 그대로 쓸 수 없다. 파일 단위의 서버 `modifiedTime`만 있다.
- Joplin은 조심할 중간 사례다. 「원격이 바뀌었다」의 판단이 `remote.updated_time > sync_time`이라, 한 기록에 기기가 매긴 시각을 같은 기록의 지난번 값과 견준다. 사실상 버전 확인이지만 기기 시계로 `>`를 쓰므로, 시계가 지난번 값보다 느린 기기의 편집은 「바뀌지 않음」으로 판단된다. 기준(또는 해시)과 같은지 다른지만 보면 이 빈틈이 없다.
- dogear는 기준 값을 저장하지 않는 비용을 보여 준다. 「바뀜」 표시만 있으면 한 기기에서 제목을 고치고 다른 기기에서 옮긴 것이 기록 단위의 충돌이 되어 한쪽이 되돌려진다. iOS처럼 기준의 필드 값을 저장하면 필드 단위로 합칠 수 있다.

### 빈 곳
- git 문서와 Benjamin Pierce의 「What's in Unison?」 논문은 이번 조사에서 다시 읽지 않았다.
- Firefox의 `remote_time_millis`가 무엇인지(서버의 「지금」인지 이 기기의 「지금」인지) 확인하지 못했다.
- 고리 예 말고 Dropbox Nucleus의 노드별 충돌 방침은 읽은 두 글에 나오지 않는다.

## 2. 기록마다 세 방향으로 판단하는 데 필요한 가장 작은 정보와 저장 비용

### 요점
마지막으로 맞춘 문서에서 「id마다 기록의 정규 표기 해시」를 담은 목록이, 기록마다 「이 기기가 바뀌었나」와 「원격이 바뀌었나」를 함께 답하는 가장 작은 기준이다. 키가 있는지로 「지난 동기화 때 있었다」도 알 수 있어, 지운 것인지 알아내는 데도 쓴다. 기록마다의 고침 표시는 이 기기 쪽 절반만 답한다. 기준 사본 전체는 양쪽에서 모두 바뀐 기록을 필드 단위로 합치고 싶을 때만 필요하다(예: 한 기기에서 제목을 고치고 다른 기기에서 옮긴 경우).

### 출처가 있는 사실
- [1차] Unison은 내용 지문을 「마지막으로 동기화한 내용」과 비교하고, 수정 시각은 같은 컴퓨터 안에서 빨리 거르는 데만 쓴다. 그래서 보관 파일에는 내용 전체가 아니라 지문이 있으면 된다. ([Unison 설명서](https://github.com/bcpierce00/unison/blob/master/src/strings.ml))
- [1차] 표시만 두는 dogear의 방식(「북마크가 바뀌었다는 것만 알려 주고, 어떻게 바뀌었는지는 알려 주지 않는다」)은 「iOS라면 깔끔하게 합칠 수 있는 경우」에도 충돌을 내고 한쪽을 되돌린다. iOS는 서버 상태의 전체 사본을 두었다. ([dogear src/merge.rs](https://github.com/mozilla/dogear/blob/master/src/merge.rs))
- [1차] Joplin은 합치는 필드인 노트 제목과 본문만 기준 전체를 저장한다. 다른 종류의 항목은 `sync_time`만 둔다. ([Joplin conflict_auto_merge.md](https://github.com/laurent22/joplin/blob/dev/readme/dev/spec/conflict_auto_merge.md))
- [1차] Dropbox의 병합 기준은 노드마다의 Synced Tree이고, 이것이 「원격에서 더함」과 「이 기기에서 지움」을 구별한다. ([Dropbox, Testing sync](https://dropbox.tech/infrastructure/-testing-our-new-sync-engine))

### 추론
- **해시 기준으로 판단하는 표.** B는 그 id의 기준 해시(없을 수 있음), L은 이 기기 기록의 해시(없을 수 있음), R은 원격 기록의 해시(없을 수 있음)다.
  - L = B이고 R = B: 둘 다 그대로다.
  - L ≠ B이고 R = B: 이 기기만 바뀌었다. 이 기기 것을 두고 올린다.
  - L = B이고 R ≠ B: 원격만 바뀌었다. 원격 것을 받는다(B가 있는데 R이 없으면 원격에서 지운 것도 받는다).
  - L ≠ B, R ≠ B, L = R: 양쪽이 같게 바뀌었다(Unison의 가짜 충돌). 충돌이 아니고, 맞춘 것으로 기록한다.
  - L ≠ B, R ≠ B, L ≠ R: 진짜 충돌이다. 방침이 필요하다(5절).
  - B가 없고 L이 있고 R이 없으면 이 기기에서 만든 것이라 올린다. B가 없고 R이 있고 L이 없으면 원격에서 만든 것이라 받는다. B가 있고 L이 없고 R = B이면 이 기기에서 지운 것이라 지운 채로 둔다(삭제 기록을 남기거나 빼고 올린다). B가 있고 L이 없고 R ≠ B이면 지우기와 고치기의 충돌이다(dogear는 폴더가 아닌 항목은 고친 쪽을, 폴더는 지운 쪽을 남긴다).
- **정보마다 답할 수 있는 것.**
  - 전체에 하나뿐인 「올릴 것 있음」 표시: 「이 기기에서 무언가 바뀌었나」만 답한다. 기록마다 어느 쪽이 바뀌었는지도, 지운 것인지도 알 수 없다.
  - 기록마다의 고침 표시(또는 변경 횟수 값): 이 기기 쪽만 답한다. 이 기기가 고쳤고 원격이 다르면, 원격 쪽 기준 값 없이는 「지난 동기화 뒤 원격은 그대로」(올려도 안전)와 「원격도 바뀜」(충돌)을 구별할 수 없다.
  - 공유 파일에 기록마다 기준 버전을 넣기(CouchDB의 `rev` 같은 값): 원격 쪽은 `remote.rev != base.rev`로 안다. 이 기기 쪽은 고침 표시나 이 기기의 버전 올리기가 필요하다. 두 기기가 같은 3을 각자 4로 올리면 버전에 기기 id나 내용 해시가 없는 한 부딪친다. [미확인] CouchDB의 버전은 「번호-해시」 형식이다. 이번 조사에서 다시 읽지 않았다.
  - 기록마다의 기준 해시: 양쪽과 있는지 여부를 모두 답한다. 해시 충돌은 고친 기록의 해시가 기준과 같아질 때만 문제가 되고(변경을 놓침), 53비트나 64비트 해시면 이 규모에서는 무시할 만하다.
  - 기준 사본 전체: 위의 모든 것에 더해 필드 단위 병합(제목, `parentId`, 순서 값을 따로)과, 서버 사본을 잠시 읽을 수 없을 때 「원격」을 다시 만드는 일이 된다.
- **정규 표기는 정확성의 조건이다.** 해시는 정규 표기(키 정렬, 숫자 표기 통일, 이 기기에만 두는 필드 제외, 병합에서 `_u`를 다시 쓴다면 `_u`도 제외)로 계산해야 한다. `JSON.stringify`의 키 순서는 넣은 순서를 따르므로, 같은 기록이 다르게 적혀 「바뀜」으로 보일 수 있다. 그러면 쓸데없이 올리거나 가짜 충돌이 생긴다(데이터를 잃지는 않는다).
- **저장 크기 어림.** 전제: id는 약 20자, 북마크 기록은 JSON으로 약 150-250자, localStorage는 UTF-16이라 한 글자에 약 2바이트.
  - 해시 목록의 항목(`"<id>":"<11자 base36 53비트 해시>",`)은 약 20 + 11 + 6 = 37자, 약 74바이트다. 북마크 500개면 약 37 KB, 2,000개면 약 148 KB다.
  - 기준 사본 전체: 맞춘 문서와 같은 크기다. 북마크 500개 × 200자 = 100,000자로 약 200 KB, 2,000개면 약 800 KB다. Safari의 약 5 MiB를 나눠 쓰는 세 번째 전체 사본이 된다.
  - 기록마다의 고침 목록(고친 동안만 id를 둔다): 고친 id마다 약 23자이고, 고친 것이 없으면 거의 0이다.
  - 마지막으로 맞춘 문서 전체의 해시: 글자열 하나, 약 20-70자다.
  - 여전히 작은 섞은 방식: 모든 기록의 해시 목록에 더해, 필드 단위로 합칠 만한 몇 필드(북마크라면 제목, `parentId`, 순서 값)만 전체 사본으로 두면 전체 사본의 대략 40-60 %다. 이 규모에서는 복잡도만큼의 값어치가 없어 보인다.
- 설정과 읽던 위치는 기록이 하나씩이다. 이것들은 해시 기준과 기록 단위 판단으로 잃는 것이 없다.

### 빈 곳
- 조사한 시스템 어디에서도 기록마다의 정보 크기를 잰 1차 출처(Unison 보관 파일 크기, Firefox 서버 사본 크기)를 찾지 못했다. 위 숫자는 전제한 기록 크기에서 어림한 것이다.
- 사양을 공개하고 꾸준히 관리되는, 널리 쓰이는 JavaScript의 JSON 목록 세 방향 병합 라이브러리를 찾지 못했다. Joplin은 글자 비교에 `node-diff3`의 갈래를 쓰는데, 기록에는 맞지 않는다.

## 3. 기준을 잃었거나 믿을 수 없을 때 안전한 대체 동작은 무엇인가

### 요점
기준이 없을 때의 안전한 기본값은 「기준이 비어 있었다고 본다」이다. 한쪽에만 있는 기록은 다른 쪽으로 옮겨지고, 양쪽이 다른 기록은 충돌이 되어 지금 방침(여기서는 옛 `_u` 규칙)으로 정한다. 지운 것은 알아낼 수 없으므로 공유 파일의 삭제 기록은 계속 필요하다. 정말 위험한 것은 기준이 없거나 오래된 경우가 아니라, 서버가 받은 적 없는 변경을 기준이 담고 있는 경우다. 그러면 올리지 못한 이 기기의 편집이 말없이 「원격이 바뀜, 원격 것을 받음」으로 판단된다.

### 출처가 있는 사실
- [1차] Unison: 보관 파일을 지웠거나, 형식이 바뀌어 읽을 수 없거나, 처음 실행이라 없으면 「보수적으로 동작한다. 마지막 동기화 시점에 두 복제본이 모두 완전히 비어 있었던 것처럼 행동한다. 그래서 첫 실행에서 한 복제본에만 있는 파일은 다른 쪽으로 옮겨지고, 양쪽에 있지만 서로 다른 파일은 충돌로 표시된다.」 ([Unison 설명서](https://github.com/bcpierce00/unison/blob/master/src/strings.ml))
- [1차] 「양쪽 복제본의 보관 파일을 지워 Unison을 초기화해도 안전하다. 다음 실행에서는 복제본에 보이는 모든 파일을 새것으로 본다.」 버전을 올려 보관 파일 형식이 바뀌면 「옛 보관 파일은 무시된다(지우지는 않는다)」, 그리고 차이는 「충돌로 나타난다」. ([Unison 설명서](https://github.com/bcpierce00/unison/blob/master/src/strings.ml))
- [1차] Unison은 보관 파일을 읽거나 쓰다가 멈춰 남은 잠금 파일이 있으면 멈추고, `ignorelocks`를 켜지 않는 한 사람이 손보기를 요구한다. ([Unison 설명서](https://github.com/bcpierce00/unison/blob/master/src/strings.ml))
- [1차] Unison의 불변 조건: 「어느 순간에도 Unison의 내부 상태에 대해 디스크에 저장된 정보는 (1) 그대로이거나, (2) 성공적으로 동기화된 경로를 반영하도록 갱신된 것이다.」 ([Unison 설명서](https://github.com/bcpierce00/unison/blob/master/src/strings.ml))
- [1차] Firefox: 「올리기가 성공하면 올린 기록으로 서버 사본을 고쳐, 서버 사본이 다시 서버와 같아지게 한다.」 ([SyncedBookmarksMirror.sys.mjs](https://github.com/mozilla-firefox/firefox/blob/main/toolkit/components/places/SyncedBookmarksMirror.sys.mjs))
- [1차] Firefox와 dogear의 첫 동기화 대체 동작: 내용 정보는 `SYNC_STATUS_NORMAL`이 아닌(한 번도 올리거나 병합하지 않은) 이 기기 항목에만 붙인다. dogear는 「내용 정보가 있는 이 기기 항목을, 내용이 비슷하고 GUID가 다른 원격의 바뀐 항목과 맞춰 중복을 없앤다」(북마크는 제목과 URL이 같을 때, 폴더는 제목이 같을 때, 구분선은 자리가 같을 때). ([Firefox store.rs](https://github.com/mozilla-firefox/firefox/blob/main/toolkit/components/places/bookmark_sync/src/store.rs), [dogear src/tree.rs](https://github.com/mozilla/dogear/blob/master/src/tree.rs))
- [1차] Joplin은 「기록된 기준이 없으면」 자동 병합을 건너뛰고 그냥 충돌 사본을 만든다. 암호화된 채 내려받으면 복호화할 때까지 기준을 비운다. ([Joplin conflict_auto_merge.md](https://github.com/laurent22/joplin/blob/dev/readme/dev/spec/conflict_auto_merge.md))

### 추론
- **이 앱에서 기준이 없을 때의 대체 동작**(기기의 첫 동기화, 저장소를 지운 경우, 기준 저장에 실패한 경우, 기준이 검사를 통과하지 못한 경우): 지금처럼 삭제 기록을 쓰고 `_u`가 큰 쪽을 남기는 병합을 한다. 옛 버전 앱이 지금 하는 일과 같으므로 안전하다는 것을 알고, 새 코드 경로도 필요 없다. 그 한 번의 동기화에서만 시계에서 벗어나지 못할 뿐이다. 한 번 동기화에 성공하면 기준이 생기고, 그 뒤로는 시계 없이 동기화한다.
- **「기준이 원격보다 오래됨」은 오류가 아니라 보통의 경우다.** 기준은 서버의 어떤 예전 버전이고, 원격은 여러 버전 앞서 있을 수 있다. 정확하려면 기준이 서버가 실제로 가졌던 버전(조상)이고, 이 기기의 데이터가 그것에서 나왔으면 된다.
- **믿을 수 없는 기준을 거르는 검사**로 기준과 함께 저장할 만한 것: Drive 파일 id(파일을 지우고 다시 만들었으면 기준을 버린다), 기준이 나타내는 버전의 ETag, 계정 id, 그리고 이 기기의 데이터와 함께 쓰는 세대 번호(데이터를 쓰지 못한 채 기준만 쓴 경우를 알아낸다). 검사 하나라도 실패하면 기준이 없는 것으로 본다(위의 대체 동작).
- **위험한 경우는 기준이 서버보다 「앞선」 때다.** 올리기가 성공했는지 확인하기 전에 기준을 올리고 그 올리기가 실패하면, 다음 동기화는 이 기기 = 기준, 원격 ≠ 기준을 보고 「원격만 바뀜」으로 판단해, 충돌 없이 이 기기의 편집을 덮어쓴다. 규칙: 기준은 쓰기가 성공했다고 확인한 뒤(새 ETag를 담은 2xx)나, 내려받은 것을 모두 적용해 이 기기에 저장한 뒤에만 올린다.
- **기준 없는 삭제**: 기준이 비어 있으면, 원격에는 있고 이 기기에는 없는 기록이 「원격에서 만듦」으로 읽혀 이 기기에서 지운 것을 되살린다. 이를 막는 것은 삭제 기록뿐이다. 그래서 기준을 두는 앱끼리는 필요 없더라도 삭제 기록은 파일 형식에 남아야 하고, 기준이 없는 앱(옛 버전, 새로 설치한 앱)이 있을 수 있는 동안은 지울 수 없다.

### 빈 곳
- 「빈 기준」과 「시각으로 돌아가기」를 수치로 비교한 1차 출처는 찾지 못했다. 위 권장은 추론이다.
- 저장한 기준 ETag가 실제로 서버의 버전이었는지 확인할 만큼 Google Drive가 수정 이력(`headRevisionId`나 revisions API)을 내주는지는 확인하지 않았다. 맡은 범위 밖이다.

## 4. 올릴 것이 있다고 판단하는 법: 고침 표시, 보낼 목록, 마지막으로 올린 문서의 해시, 기록마다의 기준

### 요점
「고침」은 따로 저장한 표시보다 이끌어 낸 값(지금 이 기기의 상태 ≠ 기준)일 때 가장 안전하다. 이끌어 낸 차이는 「이 기기에 저장」과 「올리기」 사이에 앱이 멈춰도 사라지지 않는다. 그리고 기준을 실제로 올린 그 문서로 정한다면, 올리는 도중에 한 편집도 저절로 남는다. 저장한 표시가 제대로 동작하려면 세 가지가 필요하다. 데이터와 같은 한 번의 쓰기에 표시를 쓰고, 올리기를 확인한 뒤에만 지우며, 0으로 되돌리지 않고 올린 시점의 양만큼 빼야 한다(횟수 값).

### 출처가 있는 사실
- [1차] Firefox는 `moz_bookmarks`의 줄마다 `syncChangeCounter`를 둔다. 곧 편집과 같은 줄, 같은 트랜잭션에 있다. 끝나면 `pushChanges`가 올리기에 성공한 기록에만 `SET syncChangeCounter = MAX(syncChangeCounter - :syncChangeDelta, 0)`을 실행한다. 「올리기가 실패했으면 이 변경을 무시한다. 다음 동기화에서 다시 시도한다.」, 「동기화 중에 북마크가 바뀌었으면, 다음 동기화 때도 변경 횟수 값이 0보다 크다.」 ([PlacesSyncUtils.sys.mjs](https://github.com/mozilla-firefox/firefox/blob/main/toolkit/components/places/PlacesSyncUtils.sys.mjs))
- [1차] Firefox: 「Places의 변경 횟수 값은 올려야 할 항목의 영구 기록이다. 그래서 올리기가 중단되거나 실패하면 다음 동기화에서 그 항목을 다시 준비한다.」 올릴 항목은 「Places에 바뀐 것으로 표시된 채 남아, 올리기가 중단되거나 실패해도 다음 동기화가 깔끔하게 이어 간다」. 올린 뒤 서버 사본을 고치기 전에 멈추면 「다음 동기화에서 다시 병합한다. 쓸데없는 일이지만 문제를 일으키지는 않을 것이다.」 ([Firefox store.rs](https://github.com/mozilla-firefox/firefox/blob/main/toolkit/components/places/bookmark_sync/src/store.rs), [SyncedBookmarksMirror.sys.mjs](https://github.com/mozilla-firefox/firefox/blob/main/toolkit/components/places/SyncedBookmarksMirror.sys.mjs))
- [1차] Joplin은 시각을 「맞춤」 표시로 쓸 때의 함정을 적어 두었다. t0에 시작한 올리기 도중 t0에 한 편집은 `sync_time`이 t0가 되므로 영영 알아내지 못한다. 「해법은 etag 같은 것(변경마다 하나씩 올리는 단순한 횟수 값)을 써서 변경마다 고유하게 식별하는 것이다. 지금은 이대로 둔다.」 ([Joplin Synchronizer.ts](https://github.com/laurent22/joplin/blob/dev/packages/lib/Synchronizer.ts))
- [1차] Unison: 「Unison이 일하는 동안 파일을 고쳐도 안전하다. Unison이 오래된 변경을 옮겼거나, 갱신하려는 파일이 대상 복제본에서 바뀐 것을 알아내면 그 파일에 대해 실패를 알린다.」 옮기다 멈추면 경로는 바뀌었지만 맞춘 것으로 표시되지 않은 채 남고, 다음 실행은 「두 복제본 모두에서 이 경로의 변경을 알아내고, 내용이 이제 같다는 것을 보고, 경로를 성공적으로 갱신된 것으로 표시한다.」 ([Unison 설명서](https://github.com/bcpierce00/unison/blob/master/src/strings.ml))
- [1차] `localStorage.setItem`은 「저장소의 디스크 할당량이 다 찼거나 사용자가 공간을 더 주기를 거절했을 때」 `QuotaExceededError`를 던진다. ([MDN Storage.setItem](https://developer.mozilla.org/en-US/docs/Web/API/Storage/setItem))
- [1차] Web Locks API로 한 탭의 스크립트는 「잠금을 얻고, 일하는 동안 들고 있다가 놓을 수 있다. 들고 있는 동안 같은 출처에서 실행되는 다른 스크립트는 같은 잠금을 얻을 수 없다.」 MDN의 예가 바로 「한 탭만 데이터를 동기화하게 하는 것」이다. 2022년 3월부터 주요 브라우저가 모두 지원하고, 보안 컨텍스트에서만 쓸 수 있다. ([MDN Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API))

### 추론
- **마지막으로 맞춘 문서 전체의 해시**는 지금의 「시계가 느린 기기」 결함을 바로 고친다. 304이면 `hash(이 기기 문서의 정규 표기) != 저장한 해시`일 때만 올린다(저장한 해시는 마지막으로 올렸거나, 내려받아 적용한 문서의 해시). 「가장 큰 `_u`가 다름」과 달리, 캐시한 가장 큰 값보다 `_u`가 작은 편집도 알아낸다. 비용은 글자열 하나다. 어느 기록이 바뀌었는지는 알려 주지 않으므로, 병합 기준이 아니라 올리기를 시작하는 신호다.
- **저장과 올리기 사이에 멈추면**: 고침을 이끌어 내면(이 기기 ≠ 기준, 또는 해시가 다름) 잃는 것이 없다. 다시 시작해도 차이가 남아 다음 동기화가 올린다. localStorage에 표시 키를 따로 두고 데이터를 쓴 뒤 표시를 쓰면, 그 사이에 멈출 때 다음 편집까지 「올릴 것 있음」을 잃는다. 표시를 먼저 쓰면 안전하다(나빠야 할 일 없는 올리기 한 번). 보낼 목록(outbox, 남은 작업의 줄)도 같은 순서가 필요하고, 오프라인 동안 끝없이 커진다. 파일 전체를 동기화하는 방식에서는 상태 차이보다 나은 점이 거의 없다.
- **올리는 도중의 편집**: 올릴 문서 S를 떠 두고, 성공하면 기준 := S(와 그 ETag)로 한다. 기준 := 지금 이 기기 상태로 하지 않는다. 요청 동안 한 편집은 이 기기 ≠ 기준으로 남아 다음에 올라간다. Firefox의 「올린 시점의 양만큼 빼기」를 상태 기반으로 옮긴 것이다.
- **올리기를 확인하기 전에 표시를 지우기**: 기준을 일찍 올리는 것과 같다(3절). 2xx를 확인한 뒤에만 지워야 한다.
- **이 기기 저장이 실패할 때(저장 공간이 참)**:
  - 병합한 문서를 이 기기에 저장하지 못하면 기준을 올리지 않는다. 그래도 병합한 문서를 올리는 것은 안전하다. 다시 시작하면 이 기기는 옛 이 기기, 기준은 옛 기준, 원격은 병합 결과다. 다른 기기가 바꾼 기록은 「원격만 바뀜」이라 적용되고, 이 기기가 바꾼 것은 양쪽에 있어 「같게 바뀜」으로 정리된다.
  - 이 기기의 데이터 쓰기가 실패했는데 기준을 올리면 안전하지 않다. 다시 시작하면 옛 이 기기 ≠ 새 기준이 이 기기의 편집처럼 보여 원격을 되돌리고, 되돌린 것이 올라간다.
  - localStorage에서 쓰는 순서(여러 키를 한 트랜잭션으로 쓸 수 없다): 데이터를 먼저, 기준을 다음에 쓰고, 둘이 함께 쓰는 세대 번호를 둔다. 읽을 때 세대가 다르면 기준이 없는 것으로 본다. 저장 공간 때문에 기준을 저장하지 못하면 다음에는 「기준 없음」일 뿐이다(안전한 대체 동작, 3절).
  - 기준도 저장 공간을 쓴다. 기준을 빼야 데이터를 쓸 수 있다면 데이터가 아니라 기준을 뺀다.
- **localStorage 하나를 여러 탭이 쓸 때**: 탭 B가 메모리에 든 상태는 탭 A가 동기화해 저장한 것보다 오래되었을 수 있다. B가 나중에 그 오래된 상태를 쓰면, B의 데이터가 (새) 기준과 달라 A의 동기화를 되돌리는 이 기기의 편집처럼 보인다. 줄이는 법: 동기화 전체(이 기기 읽기, 기준 읽기, 내려받기, 병합, 저장, 올리기, 기준 저장)를 `navigator.locks.request("sync", ...)` 하나 안에서 실행한다. 메모리를 믿지 말고 잠금 안에서 localStorage를 다시 읽는다. 사용자 편집은 메모리의 문서 전체를 쓰지 말고, 저장된 값을 읽어 고친 뒤 쓴다. `storage` 이벤트를 받아 다른 탭을 새로 고친다. [미확인] localStorage가 바뀌면 같은 출처의 다른 탭에 `storage` 이벤트가 온다(이번 조사에서 다시 읽지 않음).

### 빈 곳
- 널리 쓰이는 웹 앱이 localStorage에서 고침 상태를 어떻게 추적하는지 다룬 1차 출처는 찾지 못했다. 여러 탭에 대한 분석은 추론과 Web Locks 문서다.
- localStorage 쓰기가 도중에 실패할 때 Safari가 옛 값을 온전히 남기는지 다룬 문서를 찾지 못했다. `setItem`이 예외를 던지는 것은 문서에 있지만, 일부만 쓰이는 경우는 없다.

## 5. 기준과 조건부 쓰기(ETag `If-Match`)를 함께 쓰기: 시계 없이 「다른 기기의 편집을 본 뒤 한 편집이 남는다」

### 요점
`If-Match`는 파일 하나를 한 줄로 이어지는 버전들로 만든다. 지금 버전에서 계산한 쓰기만 성공하기 때문이다. 기준이 늘 실제로 있었던 예전 버전이면, 기기가 다른 기기의 편집을 본 뒤 한 편집은 그 뒤의 모든 병합에서 「이쪽만 바뀜」으로 판단되므로 남는다. 시계는 끼어들지 않는다. 시계나 다른 방침이 필요한 것은 엄밀한 뜻에서 동시에 고친 편집(두 기기 모두 그 기록에 대한 상대의 편집을 보지 못한 경우)뿐이다.

### 출처가 있는 사실
- [1차] `If-Match`는 「여러 사용자 에이전트가 같은 자원에 동시에 작업할 수 있을 때 실수로 덮어쓰는 일(곧 「잃어버린 갱신」 문제)을 막으려고, 상태를 바꾸는 메서드(POST, PUT, DELETE 등)와 함께 가장 자주 쓰인다.」 서버는 「강한 비교 함수를 반드시 써야 하고」, 「조건이 거짓이면 요청한 메서드를 실행해서는 안 되며」, 412로 답할 수 있다. 변경이 「이미 적용된 것으로 보이면」(예: 「앞선 응답을 잃었기 때문에」) 2xx로 답해도 된다. ([RFC 9110 §13.1.1](https://www.rfc-editor.org/rfc/rfc9110#section-13.1.1))
- [1차] Dropbox Nucleus: 동시에 부딪치는 옮기기에서 「최종 순서는 어느 동기화 엔진이 먼저 옮기기를 올리느냐에 달렸다.」 곧 서버가 받은 쓰기 순서가 정한다. ([Dropbox, Rewriting the heart of our sync engine](https://dropbox.tech/infrastructure/rewriting-the-heart-of-our-sync-engine))
- [1차] dogear는 양쪽이 모두 바뀌면 「지난 시간」으로 「어느 쪽이 최근인가」를 본다. 한쪽만 바뀐 경우의 규칙은 시각을 전혀 보지 않는다. ([dogear src/merge.rs](https://github.com/mozilla/dogear/blob/master/src/merge.rs))
- [2차] Kleppmann 외는 서버가 중앙 권한이 되지 않고도 CRDT 기반 앱의 통신 순서를 정할 수 있다고 적는다(「통신에 서버를 쓰는 것은 CRDT에 문제가 없다」, 서버는 「클라우드에 있는 또 하나의 동료 기기」). ([Local-first software](https://www.inkandswitch.com/essay/local-first/))

### 추론
- **논증(기록 r, 기기 A와 B, 서버 버전 V1, V2, ...)**:
  1. B가 V1에 r = b를 쓴다. A가 V1을 내려받아 병합하고 저장한 뒤 기준_A = V1(r = b)로 둔다.
  2. A가 r = a로 고친다. 이 기기에서는 hash(a) ≠ 기준_A[r]이다.
  3. A의 `If-Match` V1이 성공해 r = a인 V2가 되는 경우: B가 다음에 동기화할 때 기준_B는 V1이거나 더 오래된 버전이다. 원격 r = a는 기준_B와 다르고, B가 그 뒤 r을 건드리지 않았다면 「원격만 바뀜」이라 B는 a를 받는다. A가 나중에 한 편집은 어느 쪽 시계와도 상관없이 남는다.
  4. B가 먼저 V2를 쓴 경우(A는 412를 받는다): A는 V2를 내려받아 기준_A = V1과 견주어 병합한다. B가 V2에서 r을 바꾸지 않았다면(원격 r = b = 기준) 「이 기기만 바뀜」이라 a를 두고 `If-Match` V2로 올린다. A가 나중에 한 편집은 남는다.
  5. B도 V1과 V2 사이에 r을 바꾼 경우(B는 a를 보지 못했고, A는 B의 두 번째 편집을 보지 못했다)만 진짜 충돌이고, 방침(또는 시계)이 필요한 곳은 여기뿐이다.
- **이 논증이 맞기 위한 조건**: (a) 올리기는 모두 조건부다(병합한 버전의 ETag로 `If-Match`). (b) 기준은 서버가 받았거나 내준 버전으로만 둔다(3절). (c) 기준과 이 기기의 데이터는 함께 바뀐다(4절). (d) 병합은 결정적이라 다시 해도 같은 결과로 모인다. (e) 서버의 ETag는 내용이 바뀔 때마다 바뀐다(RFC 9110의 강한 비교).
- **쓰기에 성공했는데 응답을 잃은 경우**: 기준은 올리지 않는다. 다음 내려받기는 내가 올린 것을 돌려준다. 이 기기 = 원격이고 둘 다 기준과 다르므로 「같게 바뀜」이라 말없이 정리된다(Unison의 가짜 충돌 규칙). 중복도 되돌림도 없다.
- **진짜 충돌(양쪽이 바뀌고 값이 다름)의 방침 후보**:
  - 기준 사본 전체가 있으면 필드 단위로 합친다(제목은 한쪽, `parentId`와 순서 값은 다른 쪽). 같은 필드끼리의 충돌만 남는다.
  - 이 경우에만 `_u`가 큰 쪽을 남긴다. 그러면 시계 차이는 실제로 동시에 고친 편집에만 영향을 주어, 지금보다 훨씬 좁아진다.
  - 정해진 규칙으로 정한다. 예를 들어 원격을 남기면, 서버가 먼저 받은 쓰기가 남아 Dropbox의 「먼저 올린 쪽이 남는다」와 같다. 또는 사용자에게 보이는 데이터라면 둘 다 남긴다(북마크를 복제). Dropbox의 충돌 사본, Joplin의 충돌 노트와 같다.
  - 지우기와 고치기: dogear의 규칙(고치면 폴더가 아닌 북마크는 되살아나고, 폴더는 지운 쪽이 남으며, 바뀐 자식은 남아 있는 가장 가까운 조상으로 옮긴다)은 사용자가 만든 내용을 잃지 않는다.
  - 병합 뒤의 트리 검사: 기록 단위로 `parentId`를 합치면 고리, 부모 없는 자식, 같은 순서 값이 생길 수 있다. 병합 뒤에 고치는 단계(고리 끊기, 부모 없는 자식 다시 붙이기, 순서 값 다시 매기기)가 필요하다. dogear의 구조 규칙과 Dropbox의 고리 예가 그렇다.
- **기준을 두지 않는 옛 버전 앱과 함께 쓰기**(옛 앱은 여전히 `_u`가 큰 쪽을 남긴다):
  - 옛 앱의 편집은 새 앱에 「원격이 바뀜」으로 와서 `_u`를 보지 않고 받는다. 그래서 옛 기기의 시계가 느려도 그 편집이 새 기기에 닿지 못하는 일은 없어진다.
  - 새 앱도 옛 앱이 받아들일 `_u`를 써야 한다. `_u = max(Date.now(), 그 기록의 이전 _u + 1)`(본 값보다 하나 올리는 램포트 시계 방식)로 쓰면, 그 기록을 본 뒤 한 편집은 새 기기의 시계가 느려도 옛 앱의 「`_u`가 큰 쪽이 남는다」 규칙에서 남는다. 올리지 않으면, 이전 버전을 `_u`가 더 큰 채로 가진 옛 앱이 새 편집을 되돌린다.
  - 옛 앱이 아직 올리지 않은 자기 편집이 시각이 빠른 시계의 `_u`를 가졌다면, 옛 앱의 병합에서 새 앱이 나중에 한 편집보다 남을 수 있다. 기준은 다른 앱의 「마지막 쓰기 우선」 판단을 막지 못한다. 새 앱은 그것을 「원격이 바뀜」으로 보고 받아들인다. 옛 버전이 사라질 때까지 남는 위험이다.
  - 옛 앱의 304 지름길(가장 큰 `_u`가 바뀌었을 때만 올림)은 올린 `_u`로도 계속 동작한다. 새 편집마다 그 기록의 `_u`가 이전 값보다 커지기 때문이다.
  - 삭제 기록은 옛 앱을 위해 지금 형식과 뜻을 지켜야 한다.

### 빈 곳
- Google Drive 파일의 ETag가 메타데이터만 바뀌어도 바뀌는지(그러면 해롭지 않은 412가 더 생긴다), 같은 내용을 다시 올리면 Drive가 무엇을 돌려주는지는 확인하지 않았다. 맡은 범위 밖이다.
- 「`If-Match`와 기준이 인과적으로 나중인 편집을 남긴다」는 성질을 이 형태로 밝힌 1차 출처는 찾지 못했다. 조사자가 이끌어 낸 것이다(버전 벡터 추론에서 서버가 하나인 특별한 경우다).

## 6. 공통 조상을 쓰는 상태 기반 동기화에 대한 학술과 공학 자료

### 요점
가장 좋은 공학 1차 자료는 다음과 같다. Unison 설명서(보관 파일을 다루는 불변 조건, 멈췄을 때의 안전, 빈 기준으로 돌아가기, 시계와 무관함), Firefox의 북마크 서버 사본과 dogear 소스(변경 표시로 하는 트리 병합, 지우기와 고치기와 구조의 규칙, 변경 횟수 값), Dropbox의 Nucleus 글(트리 셋, 병합 기준인 Synced Tree), Joplin의 2026년 자동 병합 사양(항목마다 기준을 저장하고, 없으면 대체 동작으로 돌아가기)이다. 학술 쪽에서는 Harmony 틀(Foster, Greenwald, Kirkegaard, Pierce, Schmitt)이 가장 가깝다. 트리 구조의 데이터를 보관 파일과 견주어 상태 기반으로 동기화한다.

### 출처가 있는 사실
- [2차] 논문 「Exploiting Schemas in Data Synchronization」(Foster, Greenwald, Kirkegaard, Pierce, Schmitt, DBPL 2005, Journal of Computer and System Sciences 73(4), 2007, 669-689쪽)은 트리 구조 데이터(순서 없고 간선에 이름이 붙은 트리)의 상태 기반 동기화 도구를 만드는 틀인 Harmony를 내놓는다. 충돌을 알아보는 일은 스키마가 이끈다. 사례는 주소록이다. ([UPenn 저장소](https://repository.upenn.edu/cis_papers/344/), [DBPL 2005 PDF](https://senslab.inrialpes.fr/papers/files/DBPL_2005_schema_sync.pdf), 초록까지만 읽음, 본문은 읽지 않음)
- [1차] Unison 설명서의 「충돌이란 무엇인가」, 「조정」, 「불변 조건」 절은 확인 목록으로 쓸 수 있는 동작 사양이다. ([Unison 설명서](https://github.com/bcpierce00/unison/blob/master/src/strings.ml))
- [1차] Firefox: [SyncedBookmarksMirror.sys.mjs](https://github.com/mozilla-firefox/firefox/blob/main/toolkit/components/places/SyncedBookmarksMirror.sys.mjs), [PlacesSyncUtils.sys.mjs](https://github.com/mozilla-firefox/firefox/blob/main/toolkit/components/places/PlacesSyncUtils.sys.mjs), [bookmark_sync/src/store.rs](https://github.com/mozilla-firefox/firefox/blob/main/toolkit/components/places/bookmark_sync/src/store.rs), [dogear merge.rs](https://github.com/mozilla/dogear/blob/master/src/merge.rs), [dogear API 문서](https://docs.rs/dogear/latest/dogear/).
- [1차] Dropbox: [Testing sync at Dropbox](https://dropbox.tech/infrastructure/-testing-our-new-sync-engine), [Rewriting the heart of our sync engine](https://dropbox.tech/infrastructure/rewriting-the-heart-of-our-sync-engine).
- [1차] Joplin: [conflict_auto_merge.md](https://github.com/laurent22/joplin/blob/dev/readme/dev/spec/conflict_auto_merge.md), [Synchronizer.ts](https://github.com/laurent22/joplin/blob/dev/packages/lib/Synchronizer.ts).
- [2차] Kleppmann, Wiggins, van Hardenberg, McGranaghan의 글 「Local-first software: you own your data, in spite of the cloud」(2019): 파일 동기화는 「손으로 합쳐야 하는」 충돌을 낸다. CRDT는 말없이 하나를 정하지 않고 부딪친 값을 모두 둔다. 서버는 중계로 써도 된다. 이 글은 세 방향 병합이나 병합 기준을 다루지 않는다. ([Ink & Switch](https://www.inkandswitch.com/essay/local-first/))

### 추론
- 사용자마다 작은 JSON 문서 하나, 기기 1-4대, 비교 후 교체를 하는 저장소라면, 세 방향 방식(Unison, Nucleus와 같은 방식)이 CRDT를 들이는 것보다 훨씬 작은 변경이고, 옛 앱이 지금 파일 형식을 계속 읽을 수 있다.

### 빈 곳
- 이번 조사에서 읽지 않은 것(인용하기 전에 확인할 후보): Balasubramaniam과 Pierce의 「What is a file synchronizer?」(MobiCom 1998). Pierce와 Vouillon의 「What's in Unison? A formal specification and reference implementation of a file synchronizer」(2004 기술 보고서). Khanna, Kunal, Pierce의 「A Formal Investigation of Diff3」(FSTTCS 2007, 세 방향 병합의 성질을 다룸). git의 merge-base 문서. CouchDB의 버전 모델.
- 순서 있는 트리나 글자가 아니라, 부모 포인터를 담은 id 키의 평평한 JSON 목록을 세 방향으로 병합하는 일을 다룬 학술 논문은 찾지 못했다.
