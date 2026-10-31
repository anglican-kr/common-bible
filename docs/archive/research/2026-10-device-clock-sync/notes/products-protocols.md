# 실제 동기화 제품과 프로토콜은 기기 시계 없이 어떻게 남길 판을 정하는가

조사일 2026-10-30. 표시: **[1차]** 1차 출처(공식 문서, 공식 소스 코드)에서 직접 확인, **[2차]** 2차 출처(포럼, 제3자 글), **[미확인]** 조사 중에 확인하지 못한 기억. 인용은 원문 그대로 영어로 둔다. 소스 코드는 2026-10-30에 각 저장소의 기본 브랜치에서 받은 것이다.

## 1. Evernote 동기화 프로토콜(EDAM)

### 요점 (Takeaway)
서버가 계정 하나에 하나뿐인 단조 증가 번호(USN, Update Sequence Number)를 모든 생성, 수정, 삭제에 매기고, 클라이언트는 「지난번에 본 서버의 마지막 번호」와 객체마다 「고침 표시(dirty)」만 저장한다. 승패는 번호와 고침 표시로만 정하고 기기 시계는 쓰지 않는다. 오래된 영구 삭제 기록을 지운 시점은 서버 시각(`fullSyncBefore`)으로 알리고, 그보다 오래 동기화하지 않은 클라이언트는 전체 동기화를 한다.

### 출처가 있는 사실 (Cited Findings)
- USN의 정의: "Each data element has an "Update Sequence Number" (USN) that identifies the order in which it was last modified in the account." USN은 계정에서 1부터 시작해 "increase monotonically every time an object is created, modified, or deleted"이고, 서버는 계정마다 "update count"(지금까지 매긴 가장 큰 USN)를 둔다. [1차] ([Evernote Synchronization via EDAM v1.0.6, 2013-01-03, PDF](https://dev.evernote.com/media/pdf/edam-sync.pdf))
- 서버는 클라이언트별 상태도, 세밀한 트랜잭션 기록도 두지 않는다. "the synchronization scheme pushes all of the record keeping and conflict resolution work onto the client so that the service can perform synchronization in a scalable "stateless" manner." [1차] (같은 PDF)
- 올릴 변경을 아는 법: "the client must maintain an internal "dirty" flag on every modified object in the local store. This constitutes the list of objects that must be pushed to the service (after conflict resolution)." [1차] (같은 PDF)
- 클라이언트가 저장하는 값은 `lastUpdateCount`(지난 동기화 때 서버의 `updateCount`)와 `lastSyncTime`("the time of the last sync (as given by the service)") 둘이다. 서버가 주는 값은 `updateCount`와 `fullSyncBefore`("the cut-off date for old caching clients to perform an incremental (vs. full) synchronization. This value may correspond to the point where historic data (e.g. regarding expunged objects) was wiped from the account, or possibly the time of a serious server issue that would invalidate client USNs.")다. `fullSyncBefore > lastSyncTime`이면 전체 동기화, `updateCount = lastUpdateCount`이면 받을 것이 없다. [1차] (같은 PDF)
- 받기: `getSyncChunk(afterUSN = lastUpdateCount)`로 덩어리를 받고 `chunkHighUSN`으로 이어 받는다. 덩어리 사이에 시간이 흘러도 안전하다("This can be done safely in spite of a time gap between chunks"). [1차] (같은 PDF)
- 충돌 판단(증분 동기화에서 받은 객체마다): 로컬에 고침 표시가 없으면 서버 것으로 바꾼다. 있으면 "the object has been modified on both the server and the client. Perform a field-by-field merge if possible, or report the conflict for resolution." 전체 동기화에서는 USN이 같고 고침 표시가 없으면 일치, USN이 같고 고침 표시가 있으면 올림, 서버 USN이 더 크고 고침 표시가 없으면 서버 것, 서버 USN이 더 크고 고침 표시가 있으면 충돌이다. [1차] (같은 PDF)
- 올리기: 로컬 USN이 없으면 새 객체로 만들고(`createTag` 등), 있으면 수정으로 보낸다. 응답의 USN이 `lastUpdateCount + 1`이면 그사이 다른 기기가 쓰지 않은 것이므로 `lastUpdateCount`를 그 값으로 올리고, 더 크면 다른 기기가 그사이 썼으므로 올린 뒤 증분 동기화를 한 번 더 한다. 서버가 충돌을 알리면 클라이언트가 로컬에서 해결한다. [1차] (같은 PDF)
- 삭제: 덩어리마다 영구 삭제(expunge)된 GUID 목록이 온다. 클라이언트는 받은 덩어리를 차례로 처리해 해당 객체를 지우고, 노트북을 지우면 그 안의 노트도 지운다. 자기 계정에서는 "expunged objects are never resurrected". [1차] (같은 PDF)
- 바뀐 점: 이 사양서는 2007년 초판, 2013년 v1.0.6이다. 개발자 사이트의 안내 문서는 이제 「Legacy API」 아래 「Deprecated」로 표시된다. [1차] ([Evernote synchronization 안내](https://dev.evernote.com/doc/articles/synchronization.php))
- 휴지통으로 옮기는 삭제는 노트의 `deleted` 시각 필드를 채우는 일반 수정(USN이 오른다)이고, 영구 삭제만 GUID 목록으로 온다. [미확인] (사양서 본문에는 공유 노트북 맥락에서 "moved to the Trash or expunged"라는 구분만 있다)

### 추론 (Inferences)
- 승패는 「서버가 매긴 순서(USN)」와 「로컬 고침 표시」의 조합으로만 정해진다. 시각은 `fullSyncBefore`와 `lastSyncTime` 비교 하나에만 쓰이며, 두 값 모두 서버 시계에서 나온다. 기기 시계는 어디에도 들어가지 않는다.
- 삭제 기록 정리 방식이 핵심이다. 서버가 오래된 삭제 기록을 지우고 그 시점을 알리면, 그 뒤로 동기화하지 않은 클라이언트는 증분이 아니라 전체 동기화로 다시 맞춘다. 삭제 기록을 지워도 오래 쉰 기기가 지운 항목을 되살리지 않게 하는 장치다.

### 빈 곳 (Gaps)
- 서버가 수정 요청의 USN이 낡았을 때 거부하는지 사양서에 분명히 적혀 있지 않다("If the service reports a conflict"라는 문장만 있다).
- 영구 삭제 기록을 얼마나 오래 보관하는지 수치가 없다.

## 2. Firefox Sync (저장소 API 1.5와 책갈피 병합)

### 요점 (Takeaway)
서버는 레코드마다 서버 시계로 `modified`를 매기고 클라이언트 값은 무시하며, `X-If-Unmodified-Since`가 낡으면 412로 쓰기를 거부한다. 책갈피 병합(Dogear)은 양쪽이 다 바뀐 항목만 「나이(age)」로 비교하는데, 로컬 나이는 로컬 시계로, 원격 나이는 서버 시계로 잰다. 서로 다른 기기의 시계를 직접 비교하지 않는다. 올릴 변경은 항목마다 변경 카운터로 알고, 업로드가 끝나면 그때 읽은 값만큼 빼서 업로드 중에 생긴 변경을 잃지 않는다.

### 출처가 있는 사실 (Cited Findings)
- `modified`는 서버가 정한다. "any client-supplied value for this field is ignored." 소수 둘째 자리까지의 초 단위이고 "guaranteed to be monotonically increasing"이며 조정과 충돌 관리에 쓰라고 한다. [1차] ([SyncStorage API v1.5](https://mozilla-services.readthedocs.io/en/latest/storage/apis-1.5.html))
- 반면 응답마다 붙는 서버 시각 헤더에는 경고가 있다. "Clients must not use X-Weave-Timestamp for coordination or conflict management." [1차] (같은 문서)
- 조건부 요청: `X-If-Unmodified-Since`보다 대상의 마지막 수정 시각이 나중이면 412로 실패하고 쓰지 않는다. 값 0은 「없을 때만 만든다」는 뜻이다. `X-If-Modified-Since`는 바뀌지 않았으면 304를 준다. `newer=` 질의는 그 값보다 엄격히 큰 레코드만 준다. [1차] (같은 문서)
- 쓰기마다 원자적이다. 서버는 지금 시각이 사용자 전체의 마지막 수정 시각보다 큰지 확인하고 아니면 409를 주며, 동시 쓰기는 "appear to the clients to have occurred sequentially, instantaneously and atomically." [1차] (같은 문서)
- 묶음 업로드(`batch=true`, `commit=true`)는 커밋할 때 한꺼번에 보이고 커밋 시각 하나를 받는다. [1차] (같은 문서)
- 저장소 API에는 `DELETE`가 있고 삭제 표시 레코드(tombstone)는 정의하지 않는다. 레코드에 `ttl`(초)을 주면 그 뒤 보이지 않고 지워질 수 있다. [1차] (같은 문서)
- 삭제 표시는 레코드 수준에 있다. 암호화된 데이터 객체가 `id`와 `deleted` 필드를 더한다("the Encrypted DataObject adds fields like id and deleted"). 서버는 내용을 볼 수 없다. [1차] ([Firefox Sync object formats](https://mozilla-services.readthedocs.io/en/latest/sync/objectformats.html))
- 같은 문서는 기기 시계를 믿지 말라고 적는다(비밀번호의 마지막 사용 시각 필드). "Note that client clocks can be wrong, and thus this time can be dramatically earlier or later than the modified time of the record. Consuming clients should be careful to handle out of range values." [1차] (같은 문서)
- Dogear는 두 방향 병합이다. "Dogear doesn't store the shared parent for changed items, so we can only do two-way merges." iOS판은 마지막 동기화 때의 서버 상태를 담은 「mirror」를 기준으로 세 방향 병합(`ThreeWayMerger`)을 했고, Dogear는 그것을 옮겨 왔다. 바뀌었다는 사실(`needs_merge`)만 알고 어떻게 바뀌었는지는 모르므로 iOS가 깨끗이 합치던 경우에도 충돌로 보고 한쪽 변경을 되돌릴 수 있다고 스스로 적는다. [1차] ([dogear `src/merge.rs`](https://github.com/mozilla/dogear/blob/master/src/merge.rs))
- 양쪽이 모두 바뀐 항목은 "compare timestamps to decide which side is newer" 하여 `local_node.age < remote_node.age`이면 로컬을 택한다. 자식 순서도 더 새로운 쪽을 먼저 쓴다. [1차] (같은 파일)
- 나이 계산: 로컬 항목은 `item.age = (self.local_time_millis - local_modified).max(0)`, 원격 항목은 `item.age = (self.remote_time_millis - remote_modified).max(0)`이고, 원격의 `serverModified`는 서버가 매긴 값이다. [1차] ([Firefox `bookmark_sync/src/store.rs`](https://github.com/mozilla-firefox/firefox/blob/main/toolkit/components/places/bookmark_sync/src/store.rs)) 병합 함수에 넘기는 `remoteTimeSeconds`는 "The current server time, in seconds."다. [1차] ([`SyncedBookmarksMirror.sys.mjs`](https://github.com/mozilla-firefox/firefox/blob/main/toolkit/components/places/SyncedBookmarksMirror.sys.mjs))
- 삭제와 수정이 부딪칠 때의 규칙: 폴더가 아닌 항목은 수정이 삭제를 이긴다(「remote non-folder change wins over local deletion」, 「local non-folder change wins over remote deletion」). 폴더는 삭제가 수정을 이기고, 다른 쪽에서 바뀐 하위 항목을 병합된 상위 폴더로 옮긴다. [1차] ([dogear `src/merge.rs`](https://github.com/mozilla/dogear/blob/master/src/merge.rs))
- 올릴 변경을 아는 법: Places 데이터베이스의 항목마다 `syncChangeCounter`가 있고 0보다 크면 `needs_merge`다. [1차] ([`store.rs`](https://github.com/mozilla-firefox/firefox/blob/main/toolkit/components/places/bookmark_sync/src/store.rs)) 업로드가 끝나면 "Decrements the sync change counter, updates the sync status, and cleans up tombstones for successfully synced items." 실제 SQL은 `SET syncChangeCounter = MAX(syncChangeCounter - :syncChangeDelta, 0)`이다. 로컬 삭제 표시는 별도 표 `moz_bookmarks_deleted (guid, dateRemoved)`에 두고, 올린 뒤 지운다. [1차] ([`PlacesSyncUtils.sys.mjs`](https://github.com/mozilla-firefox/firefox/blob/main/toolkit/components/places/PlacesSyncUtils.sys.mjs))
- 마지막으로 받은 서버 상태는 로컬 「mirror」 데이터베이스에 둔다. 동기화가 끊기면 "we resume downloading from the server collection last modified time, or the server last modified time of the most recent record if newer"이고, 동기화 ID가 바뀌거나 로그아웃하면 mirror를 지운다. [1차] ([`SyncedBookmarksMirror.sys.mjs`](https://github.com/mozilla-firefox/firefox/blob/main/toolkit/components/places/SyncedBookmarksMirror.sys.mjs))

### 추론 (Inferences)
- Firefox는 각 시각을 「그 시각을 만든 시계의 지금」에서 빼서 나이로 바꾼 다음 나이끼리 비교한다. 기기 시계가 서버 시계와 몇 시간 어긋나 있어도 두 나이에는 각자의 어긋남이 들어가지 않는다. 남는 전제는 「두 지금이 거의 같은 순간에 읽혔다」는 것과 「로컬 시계가 편집 뒤로 크게 뛰지 않았다」는 것뿐이다. 서로 다른 기기의 `Date.now()`를 직접 비교하는 방식과 다른 점이다.
- 변경 카운터를 「0으로 되돌리기」가 아니라 「업로드 시작 때 읽은 값만큼 빼기」로 줄이면, 업로드 도중 사용자가 같은 항목을 또 고친 경우가 다음 동기화에 남는다. Joplin 소스가 스스로 지적한 같은 밀리초 경쟁(9절)을 피하는 장치다.
- Firefox는 시계를 쓰기는 하지만 「양쪽이 모두 바뀐 경우」에만 쓰고, 바뀌었는지는 카운터로 안다. 시계가 승패를 정하는 범위가 좁다.

### 빈 곳 (Gaps)
- 서버에 올라간 책갈피 삭제 표시를 언제 지우는지(ttl을 쓰는지) 확인하지 못했다.
- 책갈피 엔진이 412를 받았을 때 어떻게 하는지(중단하고 다음 동기화에 다시 하는지) 코드로 확인하지 못했다. [미확인]
- Dogear 도입 시기(2019년 무렵)는 확인하지 못했다. [미확인]

## 3. Chrome Sync

### 요점 (Takeaway)
엔터티마다 서버(정확히는 저장 백엔드)가 단조 증가 `version`을 매기며, 보통 백엔드가 마지막으로 쓴 시각(서버 시계, 마이크로초)이다. 클라이언트가 보내는 `mtime`과 `ctime`은 서버가 거의 보지 않는다. 충돌은 「마지막으로 맞춘 기준과 같은지」로 판단하고, 진짜 충돌이면 기본은 서버 쪽이 이긴다. 원격 삭제와 로컬 수정이 부딪치면 로컬 수정이 이긴다. 기기 시계로 승패를 정하지 않는다.

### 출처가 있는 사실 (Cited Findings)
- `version`: "a monotonically increasing value that is maintained by the server (or more precisely, the storage backend). It is typically a timestamp, in microseconds since the Unix epoch, of the last backend write." [1차] ([Chromium `sync_entity.proto`](https://chromium.googlesource.com/chromium/src/+/main/components/sync/protocol/sync_entity.proto))
- 커밋할 때 새 항목은 `version` 0, 수정은 클라이언트가 마지막으로 안 버전을 보낸다. 다르면 "the commit *may* fail for that item with a result code of CONFLICT. However, this is not guaranteed, and in practice is not implemented for most data types." 받을 때 이미 아는 것보다 작은 버전이 오면 클라이언트는 무시한다. [1차] (같은 파일)
- 바뀐 점: `version`은 M60 전에는 필수 필드였다. 책갈피 식별자의 표기는 M44 전, M45-M51, M52 이후가 다르고, 옛 식별자(originator item id)는 M93까지 만든 책갈피에 남아 있다. [1차] (같은 파일의 주석)
- 생성 시각과 수정 시각: "Assigned by the client and synced by the server, though the server usually doesn't bother to inspect their values." [1차] ([Chromium `entity_metadata.proto`](https://chromium.googlesource.com/chromium/src/+/main/components/sync/protocol/entity_metadata.proto))
- 올릴 변경을 아는 법: `sequence_number`는 "A version number used to track in-progress commits. Each local change increments this number.", `acked_sequence_number`는 "The sequence number of the last item known to be successfully committed.", `server_version`은 "If there are local changes, this is the version of the entity on which those changes are based."다. [1차] (같은 파일)
- 꼬리표(tag): 서버가 만드는 `server_defined_unique_tag`(예: 「Bookmark Bar」 폴더, 사용자당 같은 꼬리표는 하나뿐)와 클라이언트가 만드는 `client_tag_hash`(값은 `base64(SHA1(client_tag))`, "at most one entity may exist per client tag hash")가 있다. [1차] ([`sync_entity.proto`](https://chromium.googlesource.com/chromium/src/+/main/components/sync/protocol/sync_entity.proto))
- 일반 데이터 종류의 기본 충돌 해결: 원격이 삭제면 `kUseLocal`, 아니면 `kUseRemote`. [1차] ([Chromium `data_type_sync_bridge.cc`](https://chromium.googlesource.com/chromium/src/+/main/components/sync/model/data_type_sync_bridge.cc))
- 책갈피 충돌 처리(`ProcessConflict`): 양쪽 다 삭제면 추적에서 뺀다. 원격만 삭제면 "Local wins". 로컬만 삭제이고 원격 수정이 기준 데이터와 같으면(실제로는 바뀌지 않은 갱신) 로컬 삭제가 이기고, 아니면 서버 데이터로 되살린다. 둘 다 수정이고 내용이 같으면 충돌이 아니다. 원격이 기준 데이터와 같으면 "Local wins, ignore remote", 그 밖에는 "Conflict where data don't match and no remote deletion, and hence server wins." [1차] ([Chromium `bookmark_remote_updates_handler.cc`](https://chromium.googlesource.com/chromium/src/+/main/components/sync_bookmarks/bookmark_remote_updates_handler.cc))

### 추론 (Inferences)
- Chrome은 「어느 쪽이 기준에서 바뀌었는가」를 기준 데이터와 비교해 알고(세 방향 비교의 축소판), 양쪽이 진짜로 다르게 바뀐 경우에만 「서버가 이긴다」는 고정 규칙을 쓴다. 고정 규칙이라 기기 시계가 틀려도 결과가 흔들리지 않는다. 대신 늦게 편집한 쪽이 질 수 있다.
- 「수정이 삭제를 이긴다」는 방향은 Firefox의 폴더가 아닌 항목 규칙과 같다. 데이터를 잃는 쪽보다 되살리는 쪽을 택한다.

### 빈 곳 (Gaps)
- 서버의 삭제 표시를 언제 정리하는지 공개 문서에서 찾지 못했다.
- 기준 데이터 비교에 쓰는 필드 이름(`MatchesBaseData`가 무엇을 비교하는지)은 코드 끝까지 따라가지 않았다. 기준 내용의 해시로 보인다. [미확인]

## 4. CouchDB와 PouchDB

### 요점 (Takeaway)
문서마다 수정 이력이 나무(revision tree)로 남고, 리비전 ID는 「세대 번호-해시」다. 충돌이 나면 모든 복제본이 같은 승자를 고르는 결정적 규칙(삭제되지 않은 잎이 먼저, 그다음 세대가 큰 것, 그다음 해시 문자열이 큰 것)을 쓰고, 진 쪽은 지우지 않고 `_conflicts`로 남겨 앱이 합치게 한다. 시계는 전혀 쓰지 않는다. 삭제는 `_deleted: true`인 새 리비전(삭제 표시)이며 압축 뒤에도 남는다. 영구 삭제(purge)는 다른 데이터베이스로 복제되지 않는다.

### 출처가 있는 사실 (Cited Findings)
- CouchDB는 "picks one arbitrary revision as the "winner", using a deterministic algorithm so that the same choice will be made on all peers." 보통 `GET`은 승자만 주고, `?conflicts=true`는 `_conflicts`로 진 리비전 목록을, `?open_revs=all`은 삭제된 것까지 모든 잎을 준다. [1차] ([CouchDB Replication and conflict model](https://docs.couchdb.org/en/stable/replication/conflicts.html))
- 앱이 충돌을 푸는 법: 충돌한 리비전을 모두 읽어 합친 뒤, 한 잎을 갱신하고 나머지 잎에 `_deleted: true`를 붙여 `_bulk_docs` 한 번으로 보낸다. 이렇게 쓰는 앱은 "never has to deal with a PUT 409"이고 "automatically multi-master capable"이다. 지운 잎은 나무에 남는다("still exist as leaf nodes in the history tree, but as deleted docs"). [1차] (같은 문서)
- 리비전 ID: 같은 문서에 실린 설명은 "A record's revision ID is the checksum of its own data"이고 다음 리비전은 새 데이터와 이전 리비전 ID의 체크섬이라고 한다. [2차] (공식 문서 안에 인용된 StackOverflow 글, 같은 문서)
- 승자 고르기의 실제 코드(PouchDB): 주석은 "undeleted documents with the longest revision tree (most edits) win"이고, 비교는 "sort by deleted, then pos, then id"다. 즉 삭제되지 않은 잎, 더 깊은 세대(`pos`), 더 큰 리비전 해시 문자열 순이다. 주석은 CouchDB Guide의 설명을 출처로 든다. [1차] ([PouchDB `winningRev.js`](https://github.com/pouchdb/pouchdb/blob/master/packages/node_modules/pouchdb-merge/src/winningRev.js)) 호환 구현과 Couchbase 포럼도 같은 순서를 설명한다. [2차] ([RouchDB 충돌 안내](https://rubylab-app.github.io/rouchdb/guides/conflict-resolution.html), [Couchbase 포럼](https://www.couchbase.com/forums/t/how-to-keep-just-server-revision-during-conflicts/7471))
- 압축(compaction): "Old documents revisions are replaced with small amount of metadata called tombstone which are used for conflicts resolution during replication. The number of stored revisions (and their tombstones) can be configured by using the _revs_limit URL endpoint." [1차] ([CouchDB Compaction](https://docs.couchdb.org/en/stable/maintenance/compaction.html))
- 영구 삭제: "Normal deletion of a document within CouchDB does not remove the document from the database; instead, the document is marked as _deleted=true (and a new revision is created). This is to ensure that deleted documents can be replicated to other databases as having been deleted." "Purge operations are not replicated to other external databases." 영구 삭제 기록 보관 수(`purged_infos_limit`)의 기본은 1000이다. [1차] ([CouchDB database misc API](https://docs.couchdb.org/en/stable/api/database/misc.html))
- `_revs_limit` 기본값은 1000이다. [미확인] (문서는 예시 응답에서만 1000을 보인다)
- 복제는 변경 피드의 순번(sequence)과 `_local` 문서에 둔 체크포인트로 어디까지 보냈는지 안다. [미확인] (압축 문서에 「purge _local checkpoint document」라는 언급만 확인)
- PouchDB가 리비전 해시를 내용으로 만드는지(결정적 리비전) 무작위로 만드는지는 버전에 따라 달랐다. [미확인]

### 추론 (Inferences)
- 「가장 많이 고친 가지가 이긴다」는 규칙은 사용자 입장에서는 임의이지만, 모든 기기가 같은 답을 내고 시계를 쓰지 않는다. 진 쪽을 지우지 않고 남기므로 데이터를 잃지 않는다.
- CouchDB는 삭제 표시를 스스로 지우지 않는다. 지우는 수단(purge)은 복제되지 않으므로, 한 곳에서만 지우면 아직 삭제 표시가 없는 복제본이 그 문서를 다시 보낼 수 있다. 삭제 표시를 지우는 일이 「모든 복제본이 그 삭제를 보았다」는 확인 없이는 안전하지 않다는 근거다.

### 빈 곳 (Gaps)
- Apache CouchDB 공식 문서 안에서 승자 규칙의 세부 순서를 직접 적은 쪽은 찾지 못했다(PouchDB 코드와 호환 구현으로 확인).

## 5. Apple CloudKit과 NSPersistentCloudKitContainer

### 요점 (Takeaway)
서버가 레코드마다 「변경 꼬리표(record change tag)」를 두고 저장할 때마다 새 값으로 바꾼다. 기본 저장 정책은 꼬리표가 서버 것과 같을 때만 저장하는 것이고, 다르면 `serverRecordChanged` 오류와 함께 클라이언트 사본, 서버 사본, 공통 조상 사본 셋을 돌려준다. 즉 서버가 세 방향 병합의 기준을 준다. 시계는 쓰지 않는다. Core Data 위의 자동 동기화가 기기 사이 충돌을 어떻게 푸는지는 Apple이 문서로 밝히지 않았다.

### 출처가 있는 사실 (Cited Findings)
- "Every time CloudKit saves a record, the server updates the record's change token to a new value. When you save your copy of the record, the server compares your record's token with the token on the server. If the two tokens match, the server interprets that you modified the latest version of the record and that it can apply your changes immediately. If the two tokens don't match, the server checks your app's save policy to determine how to proceed." [1차] ([CKRecord.recordChangeTag](https://developer.apple.com/documentation/cloudkit/ckrecord/recordchangetag))
- 저장 정책의 기본은 `ifServerRecordUnchanged`다. `changedKeys`(바뀐 필드만 저장)와 `allKeys`(모든 필드 저장)는 "The server doesn't compare record change tags when using this policy." [1차] ([CKModifyRecordsOperation.savePolicy](https://developer.apple.com/documentation/cloudkit/ckmodifyrecordsoperation/savepolicy))
- `serverRecordChanged`: "CloudKit provides your app with three copies of the record in this error's userInfo dictionary to assist with comparing and merging the changes": 저장하려던 로컬 레코드, 서버의 레코드, "The original version of the record". 해결은 "merge all changes into the record for the CKRecordChangedErrorServerRecordKey key and attempt a new save using that record. Merging into either of the other two copies of the record results in another conflict error because those records have the old record change tag." [1차] ([CKError.Code.serverRecordChanged](https://developer.apple.com/documentation/cloudkit/ckerror/code/serverrecordchanged))
- 변경 받기: `CKFetchRecordZoneChangesOperation`에 서버 변경 토큰을 주면 "CloudKit returns only the changes that occur after that point"이고, 레코드의 생성, 수정, 삭제를 돌려준다. 토큰은 "an opaque pointer to a specific change in the zone's history"이며 "Don't infer behavior or order from the tokens' contents." [1차] ([CKFetchRecordZoneChangesOperation](https://developer.apple.com/documentation/cloudkit/ckfetchrecordzonechangesoperation), [CKServerChangeToken](https://developer.apple.com/documentation/cloudkit/ckserverchangetoken))
- 토큰이 너무 오래되면 `changeTokenExpired` 오류가 난다("An error that occurs when the change token expires."). [1차] ([CKError.Code.changeTokenExpired](https://developer.apple.com/documentation/cloudkit/ckerror/code/changetokenexpired)) 이때 토큰 없이 처음부터 다시 받는다. [미확인] (문서 요약만 확인)
- NSPersistentCloudKitContainer: Apple 문서는 Core Data 객체를 레코드로 바꿔 올리는 흐름과 영속 이력(persistent history)을 설명하지만 기기 사이 충돌 규칙은 적지 않는다. [1차] ([Syncing a Core Data Store with CloudKit](https://developer.apple.com/documentation/coredata/syncing-a-core-data-store-with-cloudkit)) 포럼 글은 WWDC 발표를 들어 마지막 쓴 쪽이 이긴다고 하고, 실험해 보니 Core Data 병합 정책이 CloudKit 수준 병합에 영향을 주지 않았으며 속성 단위로 합쳐지지도 않았다고 한다. [2차] ([Apple Developer Forums](https://developer.apple.com/forums/message/382355)) 제3자 안내서들은 기본 정책을 서로 다르게 적는다. [2차] ([3nsofts 글](https://3nsofts-site.pages.dev/insights/cloudkit-conflict-resolution-nspersistentcloudkitcontainer))

### 추론 (Inferences)
- CloudKit은 「낙관적 동시성(조건이 맞을 때만 저장) + 서버가 주는 공통 조상」으로 앱이 세 방향 병합을 하게 한다. 공통 조상이 있으므로 어느 필드를 누가 바꿨는지 시계 없이 안다.
- 우리 환경의 ETag `If-Match`는 변경 꼬리표와 같은 역할을 한다. 다만 Drive는 412와 함께 조상 사본을 주지 않으므로, 조상은 클라이언트가 직접 보관해야 한다(10절 설계 B).

### 빈 곳 (Gaps)
- NSPersistentCloudKitContainer의 충돌 규칙을 적은 1차 출처를 찾지 못했다.
- 서버가 삭제 기록을 얼마나 오래 보관하는지(토큰이 언제 만료되는지) 수치가 없다.

## 6. Firestore

### 요점 (Takeaway)
오프라인에서 한 쓰기는 기기에 줄을 세워 두었다가 다시 연결되면 보내고, 같은 문서에 대한 여러 쓰기는 마지막 쓰기가 이긴다. 「마지막」은 서버가 받은 차례다. 서버 시각이 필요하면 `serverTimestamp()` 표지를 쓰고, 서버가 확정하기 전에는 값이 비어 있거나 로컬 시계로 어림한 값이 보인다. 트랜잭션은 오프라인에서 실패한다.

### 출처가 있는 사실 (Cited Findings)
- "When the device comes back online, Cloud Firestore synchronizes any local changes made by your app to the Cloud Firestore backend. For multiple changes to the same document, it's last write wins." [1차] ([Firestore Access data offline](https://firebase.google.com/docs/firestore/manage-data/enable-offline))
- 보내지 못한 쓰기는 앱을 다시 켜도 남는다. `waitForPendingWrites()`는 "all previously issued writes (including those written in a previous app session)"를 기다리고, 인스턴스를 끝내도 "Termination does not cancel any pending writes"이며 다음에 켜면 다시 보낸다. [1차] ([Firestore JS API 참조](https://firebase.google.com/docs/reference/js/firestore_.md))
- `serverTimestamp()`는 "Returns a sentinel used with setDoc() or updateDoc() to include a server-generated timestamp in the written data." 확정 전 값은 선택에 따라 다르다. "By specifying 'estimate', pending server timestamps return an estimate based on the local clock. This estimate will differ from the final value and cause these values to change once the server result becomes available. By specifying 'previous', pending timestamps will be ignored and return their previous value instead. If omitted or set to 'none', null will be returned by default until the server value becomes available." [1차] (같은 참조, [SnapshotOptions](https://firebase.google.com/docs/reference/js/firestore_.snapshotoptions))
- "Transactions will fail when the client is offline." 동시 편집이 있으면 "Cloud Firestore runs the entire transaction again." [1차] ([Firestore Transactions and batched writes](https://firebase.google.com/docs/firestore/manage-data/transactions))
- 쓰기에 「문서가 이 시각에 마지막으로 바뀌었을 때만」 같은 조건(`Precondition.updateTime`, `exists`)을 줄 수 있다. [미확인]
- 삭제는 문서를 지우는 쓰기이고, 듣는 클라이언트는 「removed」 변경을 받는다. 앱이 삭제 표시를 따로 둘 필요가 없다. [미확인]

### 추론 (Inferences)
- 「마지막 쓰기가 이긴다」의 「마지막」은 서버에 도착한 차례이지 기기에서 편집한 시각이 아니다. 하루 동안 오프라인이던 기기가 연결되면 그사이 다른 기기가 한 더 새로운 편집을 덮어쓴다. 기기 시계 문제는 없지만 「오래된 편집이 늦게 도착해 이긴다」는 다른 문제가 있다.
- 서버 시각이 필요한 곳에서도 기기 시계를 쓰지 않고 서버가 채우는 표지를 둔다. 기기 시계의 어림값은 화면 표시용으로만 쓴다.

### 빈 곳 (Gaps)
- 전제 조건(Precondition)과 삭제 알림 방식은 이번에 1차 출처로 확인하지 못했다.

## 7. Replicache와 Reflect (Rocicorp)

### 요점 (Takeaway)
클라이언트는 상태가 아니라 「변경 함수 이름과 인자(mutation)」를 순번과 함께 서버로 보내고, 서버가 그 함수를 순번대로 다시 실행해 진짜 결과를 정한다. 클라이언트는 서버 상태를 받으면 로컬 상태를 마지막 서버 상태로 되감고, 서버 변경분을 적용한 뒤 아직 확인받지 못한 변경을 다시 실행한다. 순서는 클라이언트별 순번과 서버가 주는 순서 있는 쿠키(cookie)로 정하며, 문서에 시계는 등장하지 않는다. 서버 코드가 반드시 있어야 한다.

### 출처가 있는 사실 (Cited Findings)
- 변경마다 "a sequential integer uniquely identifying the mutation in this client"가 붙고, 이 순서가 서버가 지키는 인과 순서다. 서버는 변경을 순번대로 다시 실행하고 그 클라이언트의 마지막 순번(`lastMutationID`, "the high water mark of mutations seen from that client")을 올린다. 클라이언트의 결과는 서버에서 적용되기 전까지 "speculative"다. [1차] ([Replicache How it works](https://doc.replicache.dev/concepts/how-it-works))
- 받기: 요청에 쿠키를 보내면 새 쿠키, 변경분(patch), `lastMutationIDChanges`가 온다. 클라이언트는 확인된 변경을 대기 줄에서 지운다. 받은 변경분을 로컬 변경 위에 바로 덮지 않고 "rewinds the state of the Client View to the last version it got from the server", 변경분을 적용한 뒤 대기 중인 변경을 다시 실행한다. 충돌은 서버의 변경 함수 코드가 처리한다(예: 예약이 이미 찼으면 덮어쓰지 않고 실패를 기록). [1차] (같은 문서)
- 변경분의 연산은 `put`, `del`("Removes a key from the data store"), `clear`("Removes all the data from the client view") 셋이다. 쿠키는 "must be orderable (string or number)"이고, 쿠키가 무효하거나 서버가 모르면 `clear`와 `put`으로 처음부터 다시 보내라고 권한다. [1차] ([Replicache Pull Endpoint Reference](https://doc.replicache.dev/reference/server-pull))
- 두 문서 모두 시계를 언급하지 않는다. 요청 ID도 클라이언트 ID, 세션 ID, 요청 횟수로 만든다. [1차] (같은 문서)
- 바뀐 점: Rocicorp는 이후 Zero에 집중하고, Replicache는 무료 공개 소스로 돌렸으며, Reflect 호스팅 서비스는 종료했다. [미확인]

### 추론 (Inferences)
- 삭제는 서버가 쿠키 이후의 `del` 연산으로 알려 주므로 클라이언트는 삭제 표시를 오래 저장할 필요가 없다. 서버가 「누가 어디까지 봤는가」를 쿠키로 알기 때문이다.
- 「상태 대신 연산을 기록하고, 정해진 순서로 다시 실행한다」는 생각은 단순 파일 저장소에서도 흉내 낼 수 있다. 조건부 쓰기에 성공한 차례가 곧 권위 있는 순서가 된다(10절 설계 A의 변형). 다만 파일에 연산 기록이 쌓이므로 정리 규칙이 필요하다.

### 빈 곳 (Gaps)
- Rocicorp가 시계를 쓰지 않는 이유를 직접 설명한 글은 찾지 못했다.

## 8. Dropbox, Unison, Syncthing (파일 동기화)

### 요점 (Takeaway)
Dropbox와 Unison은 「마지막으로 맞춘 상태」를 기준으로 저장해 두고 세 방향으로 비교한다. 기준이 있어서 「한쪽에서 지운 것」과 「다른 쪽에서 새로 만든 것」을 시계 없이 구별한다. Unison은 서로 다른 호스트의 시각을 아예 비교하지 않는다고 명시한다. Syncthing은 기기별 카운터 묶음(버전 벡터)으로 동시 변경을 알아내고, 승자는 파일 수정 시각(기기 시계)으로 정하되 진 쪽을 충돌 사본으로 남겨 데이터를 잃지 않는다.

### 출처가 있는 사실 (Cited Findings)
- Dropbox 동기화 엔진(Nucleus)은 나무 셋을 둔다. Remote Tree는 "the latest state of the user's Dropbox in the cloud", Local Tree는 "the last observed state of the user's Dropbox on disk", Synced Tree는 "expresses the last known "fully synced" state between the Remote Tree and Local Tree"다. Synced Tree의 각 노드를 "merge base"로 볼 수 있고, 그것이 "allows us to derive the direction of a change". Synced Tree가 없으면 원격에서 새로 추가된 파일과 로컬에서 지운 파일을 구별할 수 없다. [1차] ([Testing sync at Dropbox, 2020-04-20](https://dropbox.tech/infrastructure/-testing-our-new-sync-engine))
- 두 사용자가 오프라인에서 폴더를 서로의 안으로 옮기면 "the final order depends on which sync engine uploads their move first." [1차] ([Rewriting the heart of our sync engine, 2020-03-09](https://dropbox.tech/infrastructure/rewriting-the-heart-of-our-sync-engine))
- Dropbox API: `rev`는 "can be used to detect changes and avoid conflicts". 쓰기 방식 `update(rev)`는 "Overwrite if the given "rev" matches the existing file's "rev"."이고, 이름 바꾸기를 켜면 "conflicted copy"를 붙인 사본으로 저장한다. `client_modified`는 "Since this time is not verified (the Dropbox server stores whatever the desktop client sends up), this should only be used for display purposes (such as sorting) and not, for example, to determine if a file has changed or not." [1차] ([Dropbox API 명세 `files.stone`](https://github.com/dropbox/dropbox-api-spec/blob/master/files.stone))
- Unison의 충돌 정의: 한 복제본에서 바뀌었고, 다른 복제본에서도 그것이나 그 하위가 바뀌었고, 두 내용이 같지 않을 때다. 각 호스트는 "its archive file (which records the state of each path in the replica when it was last synchronized)"을 지금 내용과 비교해 바뀐 경로를 찾고, 양쪽에서 바뀌었지만 내용이 같은 「가짜 충돌」은 조용히 맞춘 것으로 표시한다. [1차] ([Unison 설명서, `src/strings.ml`에 내장, 2.54판](https://github.com/bcpierce00/unison/blob/master/src/strings.ml))
- 시계: "Unison is not bothered by clock skew between the different hosts on which it is running. It only performs comparisons between timestamps obtained from the same host, and the only assumption it makes about them is that the clock on each system always runs forward." [1차] (같은 파일)
- 기준(archive)을 잃으면 "it behaves as though the replicas had both been completely empty at the point of the last synchronization. The effect of this is that, on the first run, files that exist in only one replica will be propagated to the other, while files that exist in both replicas but are unequal will be marked as conflicting." [1차] (같은 파일)
- 빠른 검사(`fastcheck`)는 수정 시각으로 확실히 안 바뀐 파일을 걸러 낸 뒤, 바뀌었을 수 있는 파일은 내용 지문을 지난번 것과 비교한다. 충돌을 한쪽으로 자동 해결하는 `prefer` 설정에는 `newer`와 `older`라는 특수 값이 있다. [1차] (같은 파일)
- Syncthing의 버전 벡터: `Counter`마다 ID는 "the first 64 bits of the device ID", 값은 "a simple incrementing counter, starting at zero"라고 프로토콜 문서는 적는다. [1차] ([Block Exchange Protocol v1](https://docs.syncthing.net/specs/bep-v1.html)) 실제 코드는 다르다. `Update`가 `now := uint64(time.Now().Unix())`를 읽어 기존 ID는 `max(v.Counters[i].Value+1, now)`, 새 ID는 `max(1, now)`로 둔다. 동시성은 `Compare`가 판정한다("There's really no such thing as "concurrent lesser" and "concurrent greater" in version vectors, just "concurrent"."). [1차] ([Syncthing `lib/protocol/vector.go`](https://github.com/syncthing/syncthing/blob/main/lib/protocol/vector.go))
- Syncthing의 승자: "The file with the older modification time will be marked as the conflicting file and thus be renamed." 수정 시각이 같으면 기기 ID의 앞 63비트가 큰 쪽이 충돌 파일이 된다. 수정과 삭제가 부딪쳐 삭제가 이기면 수정한 파일을 같은 방식으로 이름을 바꿔 남긴다. 충돌 사본(`<filename>.sync-conflict-<date>-<time>-<modifiedBy>.<ext>`)은 보통 파일처럼 모든 기기로 퍼진다. [1차] ([Syncthing Understanding Synchronization](https://docs.syncthing.net/users/syncing.html))
- Syncthing의 삭제: `deleted` 표시가 있는 `FileInfo`로 보낸다. "The block list SHALL be of length zero and the modification time indicates the time of deletion." [1차] ([BEP v1](https://docs.syncthing.net/specs/bep-v1.html))
- Syncthing이 보낼 변경을 아는 법: 파일마다 `sequence`가 "the value of a device local monotonic clock at the time of last local database update to a file"이고 지역 데이터베이스를 고칠 때마다 1씩 오른다. {색인 ID, 최대 순번}으로 상대가 어디까지 받았는지 알고 그 뒤만 보낸다. [1차] (같은 문서)
- Syncthing이 삭제 기록을 일정 기간 뒤 데이터베이스에서 지운다. [미확인]

### 추론 (Inferences)
- 기준 사본(Unison archive, Dropbox Synced Tree)이 있으면 「누가 바꿨는가」를 시계 없이 안다. 시계는 「양쪽이 다 바꿨을 때 어느 쪽을 고를까」에만 남는데, Unison은 그것도 사용자에게 묻는다.
- 기준을 잃었을 때 Unison의 보수적 처리(양쪽이 비어 있었다고 가정)는 지운 파일을 되살리는 쪽을 택한다. 데이터를 잃는 것보다 되살리는 편이 낫다는 선택이다.
- Syncthing의 `max(old+1, now)`는 시계가 뒤로 가거나 데이터베이스를 새로 만들어도 카운터가 줄지 않게 하는 램포트 시계(Lamport clock, 「본 것 중 가장 큰 값보다 크게」 번호를 매기는 논리 시계)와 비슷한 장치로 보인다. 코드에 이유를 적은 주석은 없다.
- Syncthing은 동시성 판정은 시계 없이 하고, 이름을 지킬 쪽만 시계로 고른다. 진 쪽을 지우지 않으므로 시계가 틀려도 잃는 데이터가 없다.

### 빈 곳 (Gaps)
- Syncthing이 버전 벡터에 벽시계 값을 섞기 시작한 시기와 이유는 확인하지 못했다.
- Unison 설명서의 웹판 주소(옛 `cis.upenn.edu` 경로)는 404였다. 소스에 내장된 설명서 문자열로 확인했다.

## 9. 파일 하나나 단순 저장소로 동기화하는 앱 (KeePass, Joplin, Obsidian Sync, Zotero)

### 요점 (Takeaway)
서버 없이 파일 하나(또는 파일 묶음)를 주고받는 KeePass와 Joplin은 결국 기기가 매긴 수정 시각을 서로 비교한다. 두 앱 모두 그 약점을 진 쪽 보존(KeePass 이력, Joplin 충돌 노트)으로 줄인다. Joplin 소스는 미래 시각 문제와 같은 밀리초 경쟁을 스스로 적고 「변경마다 오르는 카운터」가 해답이라고 남겼다. 서버가 있는 Zotero는 라이브러리 버전 번호와 조건부 쓰기로 시계를 피하고, Obsidian Sync는 마크다운은 내용 병합, 나머지는 「가장 최근에 고친 것」으로 정한다.

### 출처가 있는 사실 (Cited Findings)
- KeePass: "KeePass mainly uses the last modification time of the object." 동기화는 항목 단위이고, 같은 항목이 양쪽에서 바뀌면 한쪽을 현재 값으로 두고 다른 쪽의 변경을 그 항목의 이력으로 저장한다. "History entries are merged, without performing deletions." [1차] ([KeePass Synchronization](https://keepass.info/help/v2/sync.html))
- KeePass의 삭제: 데이터베이스에 삭제 객체 목록(UUID, `DeletionTime`)이 있다. 합칠 때 같은 UUID는 더 늦은 삭제 시각을 남기고, 객체의 `LastModificationTime`이 삭제 시각보다 이를 때만 지운다. 객체가 더 새로우면 삭제 기록을 목록에서 뺀다("Prevent future deletion attempts"). [1차] ([KeePassLib `PwDatabase.cs`, 공개 소스 미러](https://github.com/dlech/KeePass2.x/blob/master/KeePassLib/PwDatabase.cs)) 이 파일에서는 삭제 기록을 기간으로 지우는 코드를 찾지 못했다. [1차, 없음을 확인, 미러의 판 번호는 확인하지 않음]
- Joplin의 변경 감지: 사용자가 항목을 고치면 몇 초 안에 올리고, 몇 분마다 원격 변경을 받는다. 항목별 동기화 상태는 `sync_items` 표의 `sync_time`이 정한다. [1차] ([Joplin Synchronisation spec](https://joplinapp.org/help/dev/spec/sync))
- Joplin의 충돌 판단: "if the remote has been modified after the sync time, it means both items have been modified and so there's a conflict"이고 코드는 `remoteContent.updated_time > local.sync_time`이다. 파일 저장소의 시각은 믿지 않는다. "in practice it's not accurate enough ... updated_time is set and managed by clients so it's always accurate." [1차] ([Joplin `packages/lib/Synchronizer.ts`](https://github.com/laurent22/joplin/blob/dev/packages/lib/Synchronizer.ts))
- Joplin의 미래 시각 문제: 원격 항목의 `updated_time`이 미래면 동기화가 같은 항목을 되풀이하다 오류를 낸다("Remote item %s has an updated_time in the future", 하루 넘게 미래일 때). 주석은 "There's currently no automatic fix for this - the remote item on the sync target must be fixed manually (by setting an updated_time less than current time)."라고 적는다. [1차] (같은 파일)
- Joplin의 같은 밀리초 경쟁: 업로드하는 동안 같은 밀리초에 다시 고친 변경은 `sync_time`이 같아 다음 동기화에서 놓칠 수 있다고 적고, "The solution would be to use something like an etag (a simple counter incremented on every change) to make sure each change is uniquely identified. Leaving it like this for now."라고 남겼다. [1차] (같은 파일)
- Joplin의 삭제: 동기화 단계 중 「DELETE_REMOTE: Delete on the sync target, the items that have been deleted locally」가 있고, 원격 변경 목록에서 `remote.isDeleted`인 항목은 로컬에서 지운다. 충돌한 노트는 충돌 노트(`is_conflict`)로 남긴다. 동기화 대상에 기한(TTL)이 있는 잠금 파일을 둔다. [1차] (같은 파일) 로컬 삭제 기록을 `deleted_items` 표에 둔다. [미확인]
- Obsidian Sync: 마크다운은 "Obsidian Sync merges the changes using Google's diff-match-patch algorithm." 그 밖의 파일은 "The most recently modified version replaces earlier versions." 설정 JSON은 "It applies keys from the local JSON on top of the remote JSON." 1.9.7부터 자동 병합 대신 충돌 파일을 만드는 선택이 있다. 시계 이야기는 없다. [1차] ([Obsidian Sync Troubleshoot](https://obsidian.md/help/sync/troubleshoot)) Obsidian Sync는 Obsidian 회사의 서버를 쓰는 서비스다. [미확인]
- Zotero: "Every Zotero library and object (collection, item, etc.) on the server has an associated version number." 번호는 "guaranteed to be monotonically increasing"이며 클라이언트는 "should treat it as an opaque integer value". 쓰기 뒤 `Last-Modified-Version` 헤더로 새 번호를 준다. 조건 헤더(`If-Unmodified-Since-Version`)를 빼면 428, 라이브러리가 그사이 바뀌었으면 412이고, 412를 받으면 그 라이브러리의 동기화를 처음부터 다시 하되 점점 오래 기다린다. [1차] ([Zotero Web API v3 Syncing](https://www.zotero.org/support/dev/web_api/v3/syncing))
- Zotero가 올릴 변경을 아는 법: 새 객체는 버전 0, 로컬에서 고치면 `synced = false`, 동기화 밖에서 고칠 때는 버전을 바꾸지 않는다. 로컬에서 지우면 「delete log」에 라이브러리와 키를 넣고, 원격 삭제는 `GET .../deleted?since=<지난 동기화의 Last-Modified-Version>`으로 받는다. 같은 필드의 충돌만 사용자에게 묻고, 항목이 아닌 객체는 자동으로 풀되 지운 데이터를 되살리는 쪽을 택한다. [1차] (같은 문서)

### 추론 (Inferences)
- 서버 없이 파일만 주고받는 앱(KeePass, Joplin)은 지금 앱과 같은 「기기 시각 비교」를 쓴다. 차이는 진 쪽을 버리지 않는다는 점이다. 지금 앱의 `_u` 비교는 진 쪽을 버린다.
- Joplin이 남긴 두 주석(미래 시각, 같은 밀리초)은 「시각으로 변경 여부를 판단하는 설계」가 실제로 겪은 문제를 1차 출처로 보여 준다. Joplin이 제안한 해답은 변경 카운터다.
- Zotero는 서버가 있지만 쓰는 장치는 「단조 증가 버전 + 조건부 쓰기 + 412면 다시 받아 합치기」뿐이다. 이 셋은 ETag 조건부 쓰기가 되는 단순 저장소에서도 흉내 낼 수 있다(10절 설계 A).

### 빈 곳 (Gaps)
- Joplin 잠금이 어느 시계로 기한을 재는지 확인하지 못했다.
- KeePass가 삭제 기록 목록을 정리하는지 최신판 코드로 확인하지 못했다.
- Obsidian Sync가 「가장 최근」을 어느 시계로 재는지 공개 문서에 없다.
- 구글 드라이브만으로 JSON 하나를 동기화하는 공개 앱의 구체 사례는 찾지 못했다.

## 10. 비교표와 우리 서버 없이 쓸 수 있는 설계

### 요점 (Takeaway)
기기 시계 없이 버티는 제품은 모두 다음 셋 가운데 하나 이상을 쓴다. ① 한 곳이 매기는 순서(서버의 USN, 버전, 변경 꼬리표), ② 마지막으로 맞춘 기준 사본과의 세 방향 비교, ③ 기기별 카운터. 그리고 진짜 동시 변경만 남았을 때는 고정 규칙(서버가 이긴다, 세대가 큰 쪽이 이긴다)을 쓰거나 진 쪽을 사본이나 이력으로 남긴다. ETag 조건부 쓰기가 되는 파일 하나는 쓰기를 한 번에 하나씩 받으므로, 파일 안에 ①을 직접 만들 수 있다. ②와 ③은 서버가 전혀 필요 없다.

### 출처가 있는 사실 (Cited Findings)

비교표(근거는 1-9절의 출처):

| 제품 | 남길 판이나 충돌을 정하는 것 | 기기 시계의 역할 | 삭제 기록과 정리 | 올릴 변경을 아는 법 |
| --- | --- | --- | --- | --- |
| Evernote | 서버 USN(계정당 하나), 로컬 고침 표시가 있고 서버 USN이 더 크면 충돌, 앱이 필드별로 합치거나 사용자에게 알림 | 없음(`fullSyncBefore`와 `lastSyncTime`도 서버 시각) | 영구 삭제 GUID 목록, 서버가 오래된 기록을 지우면 `fullSyncBefore`로 알리고 오래 쉰 기기는 전체 동기화 | 객체별 고침 표시 |
| Firefox Sync | 서버 `modified`와 412, 책갈피는 양쪽 다 바뀐 항목만 나이 비교, 폴더가 아닌 항목은 수정이 삭제를 이김 | 로컬 나이는 로컬 시계, 원격 나이는 서버 시계로 따로 잼 | 레코드 안의 `deleted`, 로컬 삭제 표시는 올린 뒤 지움, 서버 쪽 정리는 확인 못 함 | `syncChangeCounter`, 올린 뒤 읽은 값만큼 뺌 |
| Chrome Sync | 서버 `version`(서버 시각), 기준과 비교해 한쪽만 바뀌었으면 그쪽, 둘 다 다르면 서버가 이김, 원격 삭제와 로컬 수정은 로컬이 이김 | 없음(`mtime`은 서버도 거의 안 봄) | 삭제 엔터티, 정리는 확인 못 함 | `sequence_number`와 `acked_sequence_number` |
| CouchDB, PouchDB | 리비전 나무, 결정적 승자(삭제 아님, 세대, 해시), 진 쪽은 `_conflicts`로 남김 | 없음 | `_deleted` 리비전이 압축 뒤에도 남음, 영구 삭제는 복제 안 됨 | 변경 피드 순번과 체크포인트[미확인] |
| CloudKit | 서버 변경 꼬리표, 다르면 `serverRecordChanged`와 조상 사본, 앱이 세 방향 병합 | 없음 | 변경 받기에 삭제 포함, 토큰이 만료되면 다시 받음 | 앱이 관리(Core Data는 영속 이력) |
| Firestore | 서버에 도착한 마지막 쓰기가 이김 | 없음(서버 시각 표지의 어림값만 로컬 시계) | 문서 삭제, 앱 삭제 표시 불필요[미확인] | SDK의 보내지 못한 쓰기 줄 |
| Replicache | 서버가 변경 함수를 순번대로 다시 실행, 클라이언트는 되감고 다시 실행 | 없음 | 서버가 `del` 연산을 보냄, 모르는 쿠키면 `clear` | 클라이언트별 순번이 붙은 대기 변경 |
| Dropbox | `rev` 조건부 쓰기, 기준 나무로 방향 판단, 충돌은 「conflicted copy」 | `client_modified`는 표시용으로만 | 기준 나무로 삭제와 추가 구별 | 로컬 나무와 기준 나무 비교 |
| Unison | 기준(archive)과 세 방향 비교, 충돌은 사용자에게 | 같은 호스트의 시각끼리만 비교 | 기준에 있고 지금 없으면 삭제, 기준을 잃으면 되살림 | 기준과 지금 내용 비교 |
| Syncthing | 버전 벡터로 동시성 판정, 승자는 수정 시각, 진 쪽은 충돌 사본 | 승자 고르기, 카운터에 `max(old+1, now)` | `deleted` 표시 `FileInfo`, 정리 시기 미확인 | 기기 지역 순번 |
| KeePass | 마지막 수정 시각, 진 쪽은 이력 | 승자 고르기(기기 시각끼리 비교) | (UUID, 삭제 시각) 목록, 객체가 더 새로우면 기록 제거 | 추적 없음, 파일 전체를 합침[추론] |
| Joplin | 원격 `updated_time` > 로컬 `sync_time`이면 충돌 노트 | 충돌 판단(기기 시각끼리 비교) | 원격 삭제 단계와 `isDeleted` | `sync_time`과 `updated_time` 비교 |
| Obsidian Sync | 마크다운은 내용 병합, 그 밖은 가장 최근 수정 | 문서에 없음 | 문서에 없음 | 문서에 없음 |
| Zotero | 라이브러리 버전, `If-Unmodified-Since-Version`과 412, 같은 필드 충돌만 사용자에게 | 없음 | 삭제 기록 `deleted?since=` | `synced = false`와 delete log |
| (참고) 지금 앱 | 레코드의 `_u`(편집 기기의 `Date.now()`)가 큰 쪽, 같으면 기기 ID | 승자 고르기, 304 때 올릴지 판단, 삭제 기록 30일 정리 | ID와 시각의 삭제 표시, 기기 시계로 30일 뒤 지움 | 문서의 가장 큰 `_u`와 지난 동기화 때 값 비교 |

(마지막 줄은 조사 의뢰에 적힌 지금 앱의 동작이며 이번에 따로 확인하지 않았다.)

- 구글 드라이브 v3의 파일 메타데이터에는 서버가 매기는 `version`("Output only. A monotonically increasing version number for the file.")이 있다. `modifiedTime`은 클라이언트가 설정할 수 있다("Note that setting modifiedTime also updates modifiedByMeTime for the user."). [1차] ([Drive API v3 files 리소스](https://developers.google.com/workspace/drive/api/reference/rest/v3/files))
- 구글 API 서버는 인증 실패(401) 응답에도 서버 시각 `Date` 헤더를 붙인다. 2026-10-30에 `https://www.googleapis.com/drive/v3/about`을 요청해 `date: Fri, 30 Oct 2026 13:54:40 GMT`를 받았다. [1차, 직접 요청으로 확인] HTTP 날짜의 해상도는 1초다. [미확인, RFC 9110 기억]

### 추론 (Inferences)
아래는 1-9절의 사실에서 끌어낸 설계 후보다. 모두 「`sync.json` 하나, ETag `If-Match` 조건부 쓰기, 412면 다시 받아 합치기」만으로 동작하고 우리 서버가 필요 없다. 각 설계가 빌려 온 제품을 함께 적는다.

- **A. 파일 안의 쓰기 차례 번호(Evernote의 USN, Zotero의 라이브러리 버전, Chrome의 서버 버전을 흉내).** 문서 맨 위에 `seq`를 두고, 조건부 쓰기에 성공할 때마다 `기준 seq + 1`로 올린다. 이번 쓰기에서 바뀐 레코드에는 편집 시각 대신 그 `seq`를 적는다. `If-Match`가 쓰기를 한 번에 하나씩만 받아들이므로 `seq`는 모든 기기에 공통인 하나의 순서가 된다. 기기는 지난번에 본 `seq`를 저장하고, 「로컬에서 고쳤고 레코드의 `seq`가 지난번 본 값보다 크다」를 충돌로 판단한다(Evernote의 규칙과 같다). 이 경우에만 고정 규칙이나 시각을 쓴다. 412가 나면 다시 받아 합치고 `seq`를 다시 계산한다. Drive의 `version` 필드는 업로드 전에 다음 값을 알 수 없으므로 레코드에 적기보다 「파일이 바뀌었는가」 확인에 맞는다.
- **B. 기준 사본과 세 방향 병합(Unison archive, Dropbox Synced Tree, CloudKit 조상 사본, Firefox iOS mirror, Chrome 기준 비교).** 기기가 마지막으로 내려받아 합친 `sync.json`을 기준으로 저장한다. 레코드마다 기준과 로컬, 기준과 원격을 비교해 한쪽만 바뀌었으면 그쪽을 택한다. 이 경우가 대부분이고 시계가 필요 없다. 양쪽 다 바뀐 경우에만 규칙(Chrome처럼 원격 우선, Syncthing처럼 둘 다 남김, 또는 지금의 `_u`)을 쓴다. 기준에 있었고 한쪽에서 사라진 레코드는 그쪽에서 지운 것이다. 기준을 잃으면(브라우저 저장소 삭제) Unison처럼 「기준이 비어 있었다」고 보고 되살리는 쪽을 택해야 데이터를 잃지 않는다. 옛 버전과 섞여 쓰이므로 삭제 표시는 계속 파일에 둔다.
- **C. 시계를 앞으로만 가게 하기(Syncthing의 `max(old+1, now)`, 램포트 시계).** 레코드를 고칠 때 `_u = max(Date.now(), 이 기기가 본 가장 큰 _u + 1)`로 둔다. 파일 형식이 그대로라 옛 버전과 함께 쓸 수 있다. 「시계가 늦은 기기가, 이미 본 남의 편집 뒤에 고쳤는데도 진다」는 경우가 사라진다. 서로 보지 못한 진짜 동시 편집은 여전히 시계로 정해진다. 시계가 크게 앞선 기기가 한 번 쓰면 그 뒤 모든 `_u`가 그 값을 따라 커진다(값이 커질 뿐 순서는 지켜진다).
- **D. 같은 시계로 잰 값끼리만 비교하기(Firefox의 나이 계산, Unison의 같은 호스트 비교, Firestore의 서버 시각 표지).** 동기화할 때마다 구글 API 응답의 `Date` 헤더로 「서버 시각 - 기기 시각」 차이를 재고, 레코드 시각을 서버 시각 기준으로 고쳐 적는다. 기기 시계가 몇 시간 틀려도 차이가 상쇄된다. 해상도는 1초이고, 오프라인에서 편집하면 마지막으로 잰 차이를 쓴다.
- **E. 기기별 카운터 묶음(Syncthing의 버전 벡터, CouchDB의 세대 번호와 해시).** 레코드마다 `{기기 ID: 카운터}`를 두면 「한쪽이 다른 쪽을 보고 고쳤는가」와 「서로 모르고 고쳤는가」를 정확히 구별한다. 기기가 1-4대라 크기 부담이 작다. 동시 편집은 CouchDB처럼 고정 규칙(삭제 아님, 세대, 해시)으로 정하거나 둘 다 남긴다. 파일 형식이 바뀌므로 옛 버전이 모르는 필드를 지우지 않는지 확인이 필요하다.
- **F. 삭제 기록 정리를 시계 대신 쓰기 차례로(Evernote의 `fullSyncBefore`, CloudKit의 토큰 만료, CouchDB 영구 삭제의 함정).** 삭제 표시에 그것을 쓴 `seq`(설계 A)를 적고, 파일에 기기별 「마지막으로 본 seq」를 둔다. 모든 기기가 지나간 삭제 표시만 지우거나, 오래된 것을 지우고 그 경계 `seq`를 적는다. 경계보다 오래 쉰 기기는 Evernote처럼 「조심하는 전체 병합」(자기만 가진 레코드를 새로 만든 것으로 볼지 지워진 것으로 볼지 정하는 규칙)을 한다. 이 장치 없이 삭제 표시를 지우면, 오래 쉰 기기가 지운 책갈피를 되살린다(CouchDB 문서가 경고하는 일과 같다).
- **G. 올릴 변경 판단을 변경 카운터로(Evernote 고침 표시, Firefox `syncChangeCounter`, Chrome `sequence_number`, Zotero `synced = false`, Joplin 주석이 제안한 카운터).** 편집할 때마다 로컬 카운터를 올리고, 업로드를 시작할 때 읽은 값을 업로드에 성공한 뒤 뺀다. 304를 받았을 때 카운터가 0보다 크면 올린다. 시계가 뒤로 가서 새 편집의 `_u`가 지난번 가장 큰 값보다 작아도 놓치지 않는다.
- **H. 진 쪽을 버리지 않기(Syncthing 충돌 사본, KeePass 이력, Dropbox 「conflicted copy」, CouchDB `_conflicts`).** 진짜 동시 편집에서 진 레코드를 이력이나 별도 항목으로 남기면 어떤 규칙을 쓰든 데이터를 잃지 않는다. 책갈피와 설정처럼 작은 기록에는 「이전 값 하나」만 남겨도 된다. 화면에 보일지는 따로 정한다.
- **우리 서버 없이는 어려운 것.** Replicache의 서버 실행, Firestore와 CloudKit의 서버 측 판정, Chrome과 Firefox의 서버 시각은 그 회사의 서버가 있어야 한다. 다만 그 효과(하나의 순서)는 A가 ETag 조건부 쓰기로 대신한다.
- **함께 고려할 점.** A, E, F는 파일에 새 필드를 더한다. 옛 버전 앱이 파일을 다시 쓸 때 모르는 필드를 남기는지에 따라 쓸 수 있는지가 갈린다. C, D, G, H는 파일 형식을 바꾸지 않거나 로컬에만 값을 둔다.

### 빈 곳 (Gaps)
- 구글 드라이브가 미디어 업로드의 `If-Match`를 원자적으로 지키는지(동시에 두 쓰기가 통과하지 않는지) 이번 조사에서 1차 출처로 확인하지 않았다. 설계 A와 F는 이 전제가 맞아야 동작한다.
- 옛 버전 앱이 모르는 필드를 보존하는지는 앱 조사 범위 밖이라 보지 않았다.
- 하이브리드 논리 시계(HLC) 같은 학술 설계는 이번 범위(제품과 프로토콜) 밖이다.
