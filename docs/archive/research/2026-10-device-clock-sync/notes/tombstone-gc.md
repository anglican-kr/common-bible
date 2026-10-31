# 삭제 기록(tombstone)을 기기 시계에 기대지 않고 안전하게 지우는 방법

조사 날짜는 2026-10-30이다. 출처 표시는 다음과 같다.

- [1차]: 공식 문서, 소스 코드, 논문 원문, 버그 트래커 원문을 직접 열어 확인했다(URL을 단다).
- [2차]: 제3자 글이나 검색 결과 요약으로만 확인했다. 원문을 열지 못했다.
- [미확인]: 기억에 기댄 내용이거나 출처를 찾지 못했다.

「되살아남(resurrection)」은 삭제를 아직 보지 못한 기기가, 삭제 기록이 지워진 뒤에 지운 기록을 다시 올리는 일을 말한다. 이 글에서 「창(window)」은 삭제 기록을 지우기 전까지 기다리는 기간이다.

## Cassandra `gc_grace_seconds`와 되살아난 데이터(zombie), 그리고 창 안에 수리(repair)를 해야 하는 이유

### Takeaway
Cassandra는 삭제 기록을 기본 10일 동안 지우지 않고, 그 안에 모든 복제본을 수리(repair)해야 한다고 문서에 적는다. 더 오래 꺼져 있던 노드는 지운 데이터를 「새 데이터」로 퍼뜨려 되살린다. 눈여겨볼 점은 순서를 정하는 시각(`markedForDeleteAt`)과 삭제 기록의 나이를 재는 시각(`localDeletionTime`, 서버의 시계)을 따로 둔다는 것이다.

### Cited Findings
- [1차] 「Cassandra treats a deletion as an insertion, and inserts a time-stamped deletion marker called a tombstone.」 삭제 기록에는 「built-in expiration date/time」이 있다. — [Cassandra: Tombstones](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/compaction/tombstones.html)
- [1차] `gc_grace_seconds`의 기본값은 864000초(10일)다. 「after which a tombstone expires and can be deleted during compaction」. 기간이 지나도 압축(compaction)이 일어나기 전에는 지워지지 않는다. — [Cassandra: Tombstones](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/compaction/tombstones.html)
- [1차] 유예 기간의 목적은 「to give unresponsive nodes time to recover and process tombstones normally」다. — [Cassandra: Tombstones](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/compaction/tombstones.html)
- [1차] 「If a node remains down or disconnected for longer than `gc_grace_seconds`, its deleted data will be repaired back to the other nodes and reappear in the cluster.」 「This kind of deleted but persistent object is called a zombie.」 「Cassandra treats the object on the recovered node as new data, and propagates it to the rest of the cluster.」 — [Cassandra: Compaction overview](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/compaction/overview.html)
- [1차] 삭제 기록을 지우려면 「The tombstone must be older than `gc_grace_seconds`」이고, 그 파티션의 더 오래된 데이터를 가진 SSTable이 모두 압축에 함께 들어와야 한다. — [Cassandra: Compaction overview](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/compaction/overview.html)
- [1차] 선택 사항 `only_purge_repaired_tombstones`를 켜면 「tombstones are only removed if the data has also been repaired」. 나이만이 아니라 「전파가 확인되었는가」를 조건에 더하는 장치다. — [Cassandra: Compaction overview](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/compaction/overview.html)
- [1차] 수리 문서는 수리를 자주 실행해 「the gc grace period never expires on unrepaired data」가 되게 하라고 하고, 그러지 않으면 「deleted data could reappear」라고 적는다. 기본 10일이면 모든 노드를 적어도 7일마다 수리하는 예를 든다. 권장 빈도는 「running an incremental repair every 1-3 days, and a full repair every 1-3 weeks is probably reasonable」, 증분 수리가 없으면 「a full repair every 5 days is a good place to start」다. — [Cassandra: Repair](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/repair.html)
- [1차] 소스 코드의 `DeletionTime`은 시각을 둘 가진다. `markedForDeleteAt`는 「A timestamp (typically in microseconds since the unix epoch, although this is not enforced) after which data should be considered deleted」이고, `localDeletionTime`은 「The local server timestamp, in seconds since the unix epoch, at which this tombstone was created. This is only used for purposes of purging the tombstone after gc_grace_seconds have elapsed.」다. 복제본끼리 비교하는 요약값(digest)에서는 `localDeletionTime`을 뺀다(「localDeletionTime is basically a metadata of the deletion time that tells us when it's ok to purge it.」). — [apache/cassandra DeletionTime.java](https://github.com/apache/cassandra/blob/trunk/src/java/org/apache/cassandra/db/DeletionTime.java)
- [2차] The Last Pickle의 Alain Rodriguez(2016-07-27)는 삭제 기록이 「only after `local_delete_time` + `gc_grace_seconds`」에 지워지고, 「all the nodes are supposed to have been repaired within `gc_grace_seconds`」이며, 그렇지 않으면 「deletes would often lead to reappearing data, called "zombie" or "ghost"」라고 쓴다. 놓친 삭제를 바로잡는 유일한 방법은 「a full repair」라고 한다. — [The Last Pickle: About Deletes and Tombstones in Cassandra](https://thelastpickle.com/blog/2016/07/27/about-deletes-and-tombstones.html)

### Inferences
- Cassandra의 안전 규칙은 「창이 지나기 전에 모든 복제본이 삭제를 받았다는 것을 운영자가 수리로 보장한다」이다. 창 자체가 안전을 주지 않는다. 1-4대 기기의 앱에는 수리를 강제할 운영자가 없으므로, 쓰지 않는 기기가 창보다 오래 꺼져 있으면 Cassandra와 같은 이유로 되살아남이 생긴다.
- Cassandra는 「어느 쪽이 이기는가」를 정하는 시각(클라이언트나 코디네이터가 찍는 마이크로초)과 「언제 지워도 되는가」를 재는 시각(그 서버의 시계, 초)을 나눈다. 같은 값으로 두 일을 다 하면, 시계가 틀린 기기 하나가 병합 결과와 지우는 시점을 함께 망친다.

### Gaps
- `localDeletionTime`이 복제될 때 처음 만든 노드의 값을 그대로 가지고 가는지, 받는 복제본마다 다시 찍는지는 소스에서 확인하지 못했다(직렬화 코드를 보지 않았다).
- 클라이언트가 미래 시각을 찍은 쓰기가 나중의 삭제를 이기는 문제는 열어 본 Cassandra 문서에 나오지 않았다.

## Riak `delete_mode`와 삭제 기록 거두기(reaping)

### Takeaway
Riak은 지운 객체를 삭제 기록으로 바꾸고, 기본 3초 뒤에 거둔다. `keep`으로 두면 영영 거두지 않으며, 문서는 이것이 되살아남을 막는다고 적는다. 거두는 시각은 노드의 타이머로 잰다.

### Cited Findings
- [1차] Riak은 지운 객체를 「a special object called a **tombstone**」로 바꾼다. 삭제 기록의 메타데이터에는 `X-Riak-Deleted` = `true`가 있고, 한 번도 쓰지 않은 객체는 「no entry at all」이다. — [Riak KV: Object Deletion](https://docs.riak.com/riak/kv/latest/using/reference/object-deletion/index.html)
- [1차] `delete_mode`는 셋이다. `keep`은 「Disables tombstone removal」, `immediate`는 「The tombstone is removed as soon as the request is received」, 기본값은 `3000`(3초 기다림, 밀리초 단위)이다. 지운 키를 다시 만드는 클러스터에는 `keep`을 권하며, 이것이 「protects against failure scenario cases in which a deleted object may be resurrected」라고 적는다. — [Riak KV: Object Deletion](https://docs.riak.com/riak/kv/latest/using/reference/object-deletion/index.html)
- [1차] 거둔 삭제 기록은 완전히 사라진다. 거두기 타이머가 끝나기 전에 노드가 죽으면 다시 켜져도 타이머가 저절로 다시 시작하지 않고, 다른 요청이 그 삭제 기록을 만나야 새 타이머가 시작한다. 삭제가 성공해도 거두기는 보장되지 않는다. — [Riak KV: Object Deletion](https://docs.riak.com/riak/kv/latest/using/reference/object-deletion/index.html)
- [1차] 엉성한 정족수(sloppy quorum) 때문에 삭제는 대개 성공하지만, 이는 삭제 기록이 「모든 사본」이 아니라 적어도 W개 노드에 있다는 뜻이다. 네트워크 연결이 나쁜 다중 데이터센터 복제에서는 기본보다 긴 지연을 권한다. 문서의 예는 네트워크 장애로 꺼져 있던 노드가 오래된 사본을 가지고 돌아오는 경우다. — [Riak KV: Object Deletion](https://docs.riak.com/riak/kv/latest/using/reference/object-deletion/index.html)

### Inferences
- Riak의 짧은 기본값(3초)은 복제본이 늘 연결된 데이터센터를 전제한다. 오프라인이 길 수 있는 곳에서는 문서 스스로 `keep`(영구 보관)을 안전한 쪽으로 권한다. 기기 몇 대가 몇 달씩 꺼져 있는 앱은 이 「연결이 나쁜」 경우보다도 나쁘다.

### Gaps
- Riak 문서는 시계나 벡터 시계(vector clock)가 거두기에 주는 영향을 다루지 않는다. 이 페이지에는 「Causal Context」 링크만 있다.

## CouchDB와 PouchDB의 `_deleted` 문서, 압축(compaction)과 `_purge`, 그리고 Couchbase의 비슷한 장치

### Takeaway
CouchDB는 삭제 기록을 영영 남긴다. 압축은 옛 리비전의 본문만 줄이고, 삭제 기록을 없애는 길은 `_purge`뿐이다. 그런데 `_purge`는 다른 데이터베이스로 복제되지 않으므로, 그 문서를 아직 가진 쪽에서 복제하면 다시 들어올 수 있다. Couchbase는 서버에서 삭제 기록을 기본 3일 뒤에 지우며, 클라이언트가 동기화하는 빈도에 맞춰 늘리라고 한다.

### Cited Findings
- [1차] 문서를 지우면 CouchDB는 「leaves a tombstone with very basic information about the document」. 「The tombstone is required so that the delete action can be replicated across databases.」 `_deleted: true`인 문서는 요청 결과에 나오지 않지만 「stay in the database」. — [CouchDB: Document API](https://docs.couchdb.org/en/stable/api/document/common.html)
- [1차] 압축은 「removing unused file sections created during updates」이고, 옛 리비전을 복제의 충돌 해결에 쓰는 작은 메타데이터(삭제 기록)로 바꾼다. 남기는 리비전 수는 `_revs_limit`으로 정한다. — [CouchDB: Compaction](https://docs.couchdb.org/en/stable/maintenance/compaction.html)
- [1차] 「A database purge permanently removes the references to documents in the database.」 「Purges are automatically replicated between replicas of the same database.」 그러나 「Purge operations are not replicated to other external databases.」 여러 데이터베이스에서 지우려면 「you must run the purge separately on each of the databases」. 기록해 두는 퍼지 요청 수(`purged_infos_limit`)의 기본값은 1000이다. — [CouchDB: Database misc API](https://docs.couchdb.org/en/stable/api/database/misc.html)
- [1차] 데이터베이스마다 `purge_seq`와 최근 퍼지 요청 목록을 가진다. 색인 같은 소비자는 `_local/purge-{type}-{hash}` 문서에 마지막으로 처리한 `purge_seq`를 적는다. 소비자가 `index_lag_warn_seconds`(기본 86400) 안에 체크포인트를 남기지 않으면 경고 대상이 된다. 노드 사이 내부 복제는 퍼지를 먼저 당겨 와 「to make sure we don't reintroduce to target source's docs/revs that have been already purged on target」. — [CouchDB: Clustered purge](https://docs.couchdb.org/en/stable/cluster/purging.html)
- [2차] PouchDB의 `db.remove()`는 `_deleted=true`인 새 리비전을 만들 뿐이다. `db.purge(docId, rev)`는 8.0.0에서 들어왔고 `indexeddb` 어댑터에만 있으며, 다른 어댑터에서 부르면 오류를 낸다(검색 결과 요약, 원문 미열람). — [PouchDB 8.0.0 릴리스 글](https://pouchdb.com/2022/12/14/pouchdb-8.0.0.html)
- [1차] Couchbase Sync Gateway의 삭제 기록은 `_id`, `_rev`, `_deleted`만 가진다. 서버의 기본 「metadata purge interval」은 3일이며, 이것이 「can potentially result in tombstones being purged before all clients have had a chance to be notified」. 지운 뒤에는 「that tombstone is no longer replicated to mobile clients」. 권장은 「set the server's metadata purge interval based on their expected client replication frequency」이고, 다른 방법으로 동기화 함수의 `expiry()`로 「sufficient to allow for all other devices to sync」인 기간(예: 일주일이나 한 달)을 준다. 「Purging of tombstones is also required on Couchbase Lite.」 — [Couchbase: Managing tombstones](https://docs.couchbase.com/sync-gateway/current/managing-tombstones.html)

### Inferences
- CouchDB 계열의 기본 선택은 「삭제 기록은 영영 남기고, 정말 지울 때는 모든 복제본에서 손으로 지운다」다. 퍼지가 다른 데이터베이스로 가지 않는다는 문서와 「외부 복제는 대상에 없는 리비전을 찾아 보낸다」는 문서를 합치면, 퍼지한 문서를 아직 가진 복제본에서 복제하면 문서가 다시 들어온다고 볼 수 있다(문서에 직접 쓴 경고는 아니다).
- CouchDB 내부 복제의 「퍼지를 먼저 당겨 온다」와 소비자별 `purge_seq` 체크포인트는, 「누가 어디까지 처리했는가」를 기록해 두고 그보다 늦은 것만 지우는 설계다. 아래 「모든 기기가 확인한 뒤 지우기」와 같은 생각이다.
- Couchbase가 「클라이언트가 동기화하는 빈도에 맞춰라」라고만 하고 그보다 오래 꺼진 클라이언트의 처리를 적지 않은 것은, 창 방식이 그 경우를 스스로 풀지 못한다는 뜻이다.

### Gaps
- PouchDB의 퍼지 문서 원문과, PouchDB 9 이후 다른 어댑터로 넓혀졌는지는 확인하지 못했다.
- Couchbase 문서는 퍼지 간격보다 오래 꺼진 클라이언트를 어떻게 하라는지(재동기화, 체크포인트 초기화) 적지 않는다.

## Evernote의 영구 삭제(expunge)와 `fullSyncBefore`

### Takeaway
Evernote는 서버를 「단순한 저장소」로 두고, 계정마다 하나씩 올라가는 갱신 번호(USN)로 동기화한다. 서버는 오래된 영구 삭제 정보를 지운 시점을 `fullSyncBefore`(서버 시각)로 알려 주고, 마지막 동기화 시각(이것도 서버가 준 시각)이 그보다 이른 클라이언트는 전체 동기화를 한다. 전체 동기화에서는 「한 번 서버에 올린 적이 있는데 지금 서버에 없는 항목」을 지운다. 그래서 삭제 기록 없이도 되살아남이 생기지 않는다.

### Cited Findings
- [1차] Evernote 동기화 명세 v1.0.6(2013-01-03, 주 저자 Dave Engberg)은 서비스가 클라이언트의 상태를 추적하지 않고 세밀한 트랜잭션 로그도 두지 않는다고 적는다. 각 데이터에 「Update Sequence Number」가 있고, USN은 「increase monotonically every time an object is created, modified, or deleted」. — [Evernote Synchronization via EDAM (PDF)](https://dev.evernote.com/media/pdf/edam-sync.pdf)
- [1차] 「Expunged (deleted permanently) objects are included by reference (GUID) only.」 증분 동기화는 받은 묶음에서 영구 삭제된 GUID 목록을 모아 그 항목을 클라이언트에서 지운다. — [Evernote Synchronization via EDAM (PDF)](https://dev.evernote.com/media/pdf/edam-sync.pdf)
- [1차] `fullSyncBefore`는 「the cut-off date for old caching clients to perform an incremental (vs. full) synchronization. This value may correspond to the point where historic data (e.g. regarding expunged objects) was wiped from the account, or possibly the time of a serious server issue that would invalidate client USNs.」 클라이언트의 `lastSyncTime`은 「the time of the last sync (as given by the service)」이고, 규칙은 「If ( fullSyncBefore > lastSyncTime ), continue to Full Sync.」다. 동기화를 마치면 클라이언트는 「the server's current time to lastSyncTime」을 저장한다. — [Evernote Synchronization via EDAM (PDF)](https://dev.evernote.com/media/pdf/edam-sync.pdf)
- [1차] 전체 동기화에서 클라이언트에는 있고 서버에는 없는 항목은 이렇게 다룬다. 「If the client's tag has no "dirty" flag, or if it has previously been uploaded to the server, then delete the tag from the client.」 「Otherwise the tag is new on the client, it will be uploaded later」. — [Evernote Synchronization via EDAM (PDF)](https://dev.evernote.com/media/pdf/edam-sync.pdf)
- [1차] 사용자 자신의 계정에서는 「expunged objects are never resurrected」라고 적는다(공유 노트북에서는 같은 GUID로 다시 나타날 수 있다고 따로 적는다). 또 「The client should make it possible for a user to perform a full synchronization even if the client is theoretically capable of an incremental sync.」 — [Evernote Synchronization via EDAM (PDF)](https://dev.evernote.com/media/pdf/edam-sync.pdf)

### Inferences
- Evernote가 기기 시계를 쓰지 않는 지점은 둘이다. 순서는 서버의 USN으로 정하고, 「얼마나 오래 떨어져 있었나」는 서버가 준 `lastSyncTime`과 서버의 `fullSyncBefore`를 비교해 정한다. 기기 시계가 몇 년 틀려도 결과가 같다.
- 되살아남을 막는 핵심은 삭제 기록의 보관 기간이 아니라, 각 클라이언트가 항목마다 「서버에 올린 적이 있다」와 「그 뒤 이 기기에서 고쳤다(dirty)」를 기억하는 데 있다. 서버에 없는데 올린 적이 있으면 누군가 지운 것이다. 이 규칙이 있으면 삭제 기록은 「빨리 알리기」용이 되고, 기간이 지나 지워도 안전하다.
- 이 규칙에서 오프라인 동안 고친 항목이 다른 기기에서 지워졌으면 삭제가 이긴다(「previously uploaded」이면 지운다). 고친 내용을 잃지 않으려면 따로 묻거나 사본을 남겨야 한다.

### Gaps
- 명세는 서버가 영구 삭제 정보를 얼마 동안 두는지 숫자로 적지 않는다.
- 현재 Evernote API 문서는 이 동기화 글을 「deprecated」, 레거시 API로 표시한다. 2026년 지금 서비스가 같은 규칙을 쓰는지는 확인하지 못했다.

## Firefox Sync의 삭제 기록과 기록별 수명(TTL)

### Takeaway
Firefox Sync 서버는 기록마다 수명(`ttl`)을 받고, 수정 시각을 서버 자신의 시계로 찍는다. 그러나 삭제 기록이 사라지거나 서버가 데이터를 잃은 뒤 오래된 기기가 돌아와 지운 항목을 되살리는 문제는 2017년 무렵 열린 버그가 지금도 열려 있다. 삭제 기록을 모든 기기에 영구 저장하자는 제안은 「지우는 정책을 정해야 한다」는 이유 등으로 닫혔다.

### Cited Findings
- [1차] 저장소 API 1.5에서 `ttl`의 기본값은 없음이고, 「If not specified or null, the record will not expire.」 수명이 지나면 「this item will no longer be returned in response to any request, and it may be pruned from the database」. `ttl`은 쓸 때 줄 수 있지만 서버가 돌려주지 않는다. — [Mozilla SyncStorage API 1.5](https://mozilla-services.readthedocs.io/en/latest/storage/apis-1.5.html)
- [1차] 기록의 `modified`는 「set automatically by the server according to its own clock; any client-supplied value for this field is ignored」이고 「guaranteed to be monotonically increasing」이다. 덮어쓰기를 막으려면 `X-If-Unmodified-Since`를 보낸다. 응답의 `X-Weave-Timestamp`는 서버의 현재 시각이지만 「Clients must not use X-Weave-Timestamp for coordination or conflict management」. — [Mozilla SyncStorage API 1.5](https://mozilla-services.readthedocs.io/en/latest/storage/apis-1.5.html)
- [2차] Firefox 소스의 history 엔진은 `const HISTORY_TTL = 5184000; // 60 days`를 기록 수명으로 쓴다(검색 결과 요약, 단위 주석은 요약이 「milliseconds」라고 전하나 5184000은 60일을 초로 센 값이다). — [searchfox: history.sys.mjs](https://searchfox.org/mozilla-central/source/services/sync/modules/engines/history.sys.mjs)
- [1차] 버그 669338 「Deleted records should always have a TTL」(WONTFIX로 정리). Mike Connor의 첫 댓글은 「Otherwise deleted bookmarks will eventually return (server wipe, etc).」, 「I wouldn't go less than 60 days at this point」이고, 그보다 오래 오프라인이던 클라이언트에는 따로 대조(reconciliation)를 하자고 했다. — [Bugzilla 669338](https://bugzilla.mozilla.org/show_bug.cgi?id=669338)
- [1차] 버그 1332290 「sync may resurrect old deleted items」는 아직 NEW(P3)다. 보고자는 오래된 컴퓨터를 다시 켜자 다른 곳에서 지운 로그인이 돌아왔다고 했다. Mark Hammond는 기기가 삭제를 로컬에 저장하지 않으므로 「these deleted "tombstones" never survive a node reassignment」라고 했다. Richard Newman은 「Bump TTLs for deleted records to a much longer duration」과, 동기화 ID가 바뀌었고 마지막 동기화가 오래되었으면 사용자에게 합칠지 버릴지 묻자는 안을 냈다. Mark Hammond는 「the root issue isn't going to go away in the current Sync」라고 했다. — [Bugzilla 1332290](https://bugzilla.mozilla.org/show_bug.cgi?id=1332290)
- [1차] 버그 1343103 「Store and upload tombstones for deleted bookmarks」(WONTFIX). Lina Butler는 다른 기기의 삭제 기록도 로컬 표에 두자며 「We'd need to agree on an eviction policy, though.」라고 했다. Mark Hammond는 정기 정비 때 「(say) 12 months」보다 오래된 것을 지우자고 했다. Richard Newman은 「The longer a tombstone list sticks around, the higher the chance of a GUID collision」과, 진짜 되살리기와 「an old client」를 어떻게 구별하느냐를 물었다. 끝내 「This got complicated」로 닫혔다. — [Bugzilla 1343103](https://bugzilla.mozilla.org/show_bug.cgi?id=1343103)

### Inferences
- Firefox Sync는 「서버 시계로 재는 수명」과 「서버가 찍는 단조 증가 시각」을 갖추었는데도, 오래 꺼진 기기의 되살아남을 풀지 못했다. 서버 시각은 기기 시계 문제를 없앨 뿐, 창보다 오래 꺼진 기기 문제는 그대로 남는다는 사례다.
- 기기가 「서버에 있었던 것」을 기억하지 않으면(Evernote의 「올린 적이 있다」 표시가 없으면), 삭제 기록이 사라진 뒤에는 「지워진 것」과 「다른 기기가 모르는 새 것」을 구별할 정보가 없다. Richard Newman의 질문이 바로 이것이다.

### Gaps
- 지금 Firefox(데스크톱과 Rust `application-services`)가 북마크 삭제 기록에 서버 수명을 주는지, 준다면 얼마인지는 찾지 못했다.

## 인과적 안정성(causal stability)과 「모든 복제본이 확인한 뒤」 지우기, 복제본 명부가 요구하는 것

### Takeaway
CRDT 연구에서 안전하게 지우는 조건은 「이 삭제와 동시에 일어난 일이 모든 복제본에서 더는 오지 않는다」(안정성)이다. 이를 알려면 복제본의 집합을 알아야 하고, 복제본이 영영 사라지면 지우기가 멈춘다. 지우기가 멈춰도 정확성은 해치지 않는다는 것이 문헌의 입장이다. 버전 벡터(version vector)를 쓰면 삭제 기록 자체를 두지 않는 집합(Optimized OR-Set)도 만들 수 있다.

### Cited Findings
- [1차] Shapiro 등(INRIA RR-7506, 2011) §4: 「Solving distributed GC would be difficult without synchronisation.」 요건이 맞지 않으면 「GC may block」인데, 「GC does not impact correctness (only performance)」이므로 받아들일 만하다고 쓴다. — [Shapiro, Preguiça, Baquero, Zawirski, A comprehensive study of CRDTs](https://inria.hal.science/inria-00555588)
- [1차] 같은 글 정의 4.1: 갱신 f가 복제본 xi에서 안정하다는 것은 「all updates concurrent to f according to delivery order <d are already delivered at xi」. 「Liveness of Φ requires that the set of replicas be known and that they not crash permanently (undetectably).」 Wuu와 Bernstein의 알고리즘을 따라, 각 복제본은 다른 복제본마다 마지막으로 받은 벡터 시계 V_min(j)를 두고, 「Replica must periodically propagate its vector clock ... possibly by sending empty messages」. 모든 j에서 V_min(j)가 v(f) 이상이면 f는 안정하다. RGA, Treedoc, Logoot이 이렇게 삭제 기록을 지운다. — [A comprehensive study of CRDTs](https://inria.hal.science/inria-00555588)
- [1차] 같은 글 §4.2: 2P-Set에서 삭제 기록을 지우는 일(「thus allowing deleted elements to be added again」)은 「an atomic, unanimous agreement between all replicas, i.e., a commitment protocol such as 2-Phase Commit or Paxos Commit」이 필요하고, 「The set of replicas must be known, and liveness requires that they all be reachable and responsive.」 Leţia 등은 안정한 작은 부분 집합(core)만 합의하고 나머지는 나중에 맞추게 했다. — [A comprehensive study of CRDTs](https://inria.hal.science/inria-00555588)
- [1차] 같은 글의 2P-Set: 지운 원소의 집합을 「the tombstone set」이라 부르고, 「a tombstone is required to ensure that, if a removed element is received by a downstream replica before its added counterpart, the effect of the remove still takes precedence」. — [A comprehensive study of CRDTs](https://inria.hal.science/inria-00555588)
- [1차] Baquero, Almeida, Shoker(2017) 정의 5.1: 「A timestamp τ, and a corresponding message, is causally stable at node i when all messages subsequently delivered at i will have timestamp t > τ.」 이는 「received by all nodes」인 고전적 안정성보다 강하고, 전역이 아니라 노드마다의 판단이다. 판정은 집합 I의 다른 모든 노드 j에서 τ보다 뒤의 메시지를 이미 받았는지로 한다. 구현은 Roh의 RGA 삭제 기록 지우기처럼 노드마다 마지막 벡터 시각을 두고 최솟값을 본다. 모형은 「a fixed set of nodes」이고, 노드는 죽었다가 지속 상태를 그대로 가진 채 돌아올 수 있다. 안정해진 연산에서는 시각 메타데이터를 떼어 낸다. — [Pure Operation-Based Replicated Data Types (arXiv 1710.04469)](https://arxiv.org/abs/1710.04469)
- [1차] Bieniusa 등(2012): Wuu의 2P-Set은 「garbage-collects tombstones that have been delivered everywhere, basically by waiting for acknowledgements from each process to every other process. This adds communication and processing overhead, and requires all processes to be correct.」 Optimized OR-Set은 삭제 기록을 두지 않는다. 병합할 때 「an element has been removed if it is not in the payload but its identifier is reflected in the replica's vector」. 원소와 원래 복제본의 조합마다 가장 최근 추가의 식별자만 두면 되고, 크기는 「O(|elements|n+n)」, 흔한 경우 O(|elements|+n)이다. 순서 밖 전달에는 「version vector with exceptions」가 필요하다고 각주에 적는다. — [An optimized conflict-free replicated set (arXiv 1210.3368)](https://arxiv.org/abs/1210.3368)
- [1차] CouchDB의 소비자별 `purge_seq` 체크포인트와 Cassandra의 `only_purge_repaired_tombstones`도 「확인된 뒤에만 지운다」는 같은 생각을 서버 쪽에서 구현한 예다. — [CouchDB: Clustered purge](https://docs.couchdb.org/en/stable/cluster/purging.html); [Cassandra: Compaction overview](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/compaction/overview.html)

### Inferences
- 동기화 파일 하나에 「복제본 명부(replica registry)」를 두면 이렇게 된다. 기기마다 고유 ID를 두고, 파일에 기기별로 「이 기기가 마지막으로 반영한 파일 버전」(확인 표시)을 적는다. 삭제 기록은 그것이 처음 들어간 버전보다 모든 등록 기기의 확인 표시가 크거나 같아지면 지운다. 기기 시계는 쓰지 않는다. 메타데이터는 기기마다 ID, 버전, 마지막으로 본 서버 시각 정도라 1-4대면 수백 바이트다.
- 명부의 약점은 문헌이 말한 대로 「영영 오지 않는 복제본」이다. 앱을 지우고 다시 깔면 새 ID가 생기고, 옛 ID는 확인 표시를 올리지 않으므로 지우기가 영영 멈춘다. 그래서 명부에는 은퇴 규칙이 필요하다. 예를 들어 서버 시각으로 N개월 동안 확인 표시를 올리지 않은 기기는 명부에서 뺀다. 빠진 기기가 돌아오면 「창 밖에서 돌아온 기기」로 다루어 아래의 전체 동기화 규칙을 따르게 한다. 이 은퇴는 Shapiro §4.2의 「합의」 없이 하는 근사이고, 은퇴시킨 기기에 대한 안전은 돌아올 때의 규칙이 맡는다.
- 확인 표시를 쓰지 않는 옛 앱 버전은 명부에 없는 기기다. 그런 기기가 있으면 「모든 기기가 확인」을 판단할 수 없으므로, 명부 방식만으로는 옛 버전의 되살아남을 막지 못한다.
- 저장소가 파일 하나이고 올리기가 조건부(If-Match)라 모든 쓰기가 한 줄로 정렬된다. 그러면 버전 벡터 대신 하나뿐인 증가 번호(Evernote의 USN과 같은 것)로 충분하다. Optimized OR-Set의 「식별자가 벡터에 반영되었는데 없으면 지운 것」은, 이 경우 「기록이 가진 번호가 이 기기가 마지막으로 본 번호 이하인데 파일에 없으면 지운 것」이 된다. 이렇게 하면 기간 제한이 없는 되살아남 방지를 삭제 기록 없이 얻는다.

### Gaps
- 사용자 기기 몇 대 규모에서 명부의 은퇴 기간을 정한 실제 제품 사례는 찾지 못했다.

## 기기 시각 대신 서버 시각이나 서버 버전으로 재기

### Takeaway
Cassandra(`localDeletionTime`), Firefox Sync(서버가 찍는 `modified`와 `ttl`), Evernote(`lastSyncTime`과 `fullSyncBefore`), Couchbase, MongoDB가 모두 나이와 기한을 서버 쪽 시각으로 잰다. 서버 시각은 기기 시계가 틀려 창이 줄어드는 문제를 없애지만, 창보다 오래 꺼진 기기 문제는 풀지 못한다. Google Drive는 파일마다 단조 증가하는 `version`을 준다. 브라우저 코드는 교차 출처 응답의 `Date` 헤더를 기본으로는 읽지 못한다.

### Cited Findings
- [1차] Cassandra의 `localDeletionTime`은 「The local server timestamp ... only used for purposes of purging the tombstone after gc_grace_seconds have elapsed」다. — [apache/cassandra DeletionTime.java](https://github.com/apache/cassandra/blob/trunk/src/java/org/apache/cassandra/db/DeletionTime.java)
- [1차] Firefox Sync 서버는 `modified`를 「according to its own clock」으로 찍고 클라이언트 값을 무시하며, `ttl`도 서버가 적용한다. — [Mozilla SyncStorage API 1.5](https://mozilla-services.readthedocs.io/en/latest/storage/apis-1.5.html)
- [1차] Evernote 클라이언트는 동기화를 마칠 때 「the server's current time」을 `lastSyncTime`으로 저장하고, 서버의 `fullSyncBefore`와 비교한다. — [Evernote Synchronization via EDAM (PDF)](https://dev.evernote.com/media/pdf/edam-sync.pdf)
- [2차] MongoDB Atlas Device Sync의 「client maximum offline time」은 새 앱에서 기본 30일(최소 1일)이다. 서버의 정기 작업이 그보다 오래된 변경 이력을 잘라 내면(trimming), 그보다 오래 떨어진 클라이언트는 돌아올 때 「client reset」을 해야 한다. 설정은 `client_max_offline_days`이고, 자른 이력은 되돌릴 수 없다(검색 결과 요약). — [MongoDB: Optimize Sync Atlas usage](https://www.mongodb.com/docs/atlas/app-services/sync/go-to-production/optimize-sync-atlas-usage/)
- [1차] Google Drive 파일의 `version`은 「Output only. A monotonically increasing version number for the file.」 「This reflects every change made to the file on the server, even those not visible to the user.」 `modifiedTime`은 「The last time the file was modified by anyone」이며 출력 전용이 아니다(설정하면 `modifiedByMeTime`도 바뀐다고 적는다). `headRevisionId`와 `md5Checksum`은 「files with binary content in Google Drive」에만 있다. — [Google Drive API v3: files](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)
- [1차] 브라우저 스크립트가 교차 출처 응답에서 기본으로 읽을 수 있는 헤더는 `Cache-Control`, `Content-Language`, `Content-Length`, `Content-Type`, `Expires`, `Last-Modified`, `Pragma`뿐이다. 「Additional headers can be added to the safelist using `Access-Control-Expose-Headers`.」 `Date`는 목록에 없다. — [MDN: CORS-safelisted response header](https://developer.mozilla.org/en-US/docs/Glossary/CORS-safelisted_response_header)

### Inferences
- 단순한 저장소에서 서버 시각을 얻는 길은 응답 본문의 메타데이터다. Drive의 파일 정보(`modifiedTime`, `version`)는 JSON 본문으로 오므로 `Date` 헤더 문제를 피한다. 다만 `modifiedTime`은 클라이언트가 바꿀 수 있는 필드라, 앱이 이 값을 직접 정하는 코드가 없을 때만 서버 시각으로 믿을 수 있다.
- 서버 시각으로 삭제 기록의 나이를 재는 한 방법: 삭제한 기기는 삭제 기록에 「아직 서버 시각 없음」을 표시해 올린다. 이후 이 파일을 내려받는 기기(삭제한 기기 자신 포함)는, 그 표시를 「내려받은 파일의 `modifiedTime`」(그 삭제 기록이 처음 저장소에 들어간 쓰기의 서버 시각 이후의 값)으로 바꾼다. 지울지는 「지금 내려받은 파일의 `modifiedTime`」과 비교해 정한다. 이러면 어느 기기의 시계도 쓰지 않는다. 아무도 쓰지 않는 동안에는 `modifiedTime`이 멈추므로 삭제 기록도 지워지지 않는다(안전한 쪽).
- 삭제한 기기가 올리기의 기준으로 삼은 파일(If-Match의 대상)의 `modifiedTime`을 그대로 찍으면 안 된다. 그 파일이 몇 달 전에 마지막으로 바뀌었다면 삭제 기록이 태어날 때부터 몇 달 묵은 것이 되어 너무 일찍 지워진다.
- 버전 번호(`version`)로 창을 재면 「그 뒤 몇 번 썼는가」를 재게 된다. 쓰기가 드문 사용자에게는 몇 달이 몇 번의 쓰기일 수 있어, 시간 창과 뜻이 다르다. 오래 꺼진 기기를 가려내는 데는 시간(서버 시각)이 맞다.
- 어느 쪽이든, 창보다 오래 꺼진 기기는 남는다. 서버 시각은 아래 「창 밖에서 돌아온 기기」 규칙과 함께 써야 한다.

### Gaps
- Drive API가 `Access-Control-Expose-Headers`로 `Date`를 내보내는지 확인하지 않았다.
- Drive에서 `modifiedTime`을 주지 않고 올리면 서버가 그 순간의 서버 시각으로 정한다는 것을 문서에서 직접 확인하지 못했다(기억으로는 그렇다, [미확인]).
- Drive의 `version`이 올리기 한 번에 정확히 1씩 오르는지는 확인하지 못했다. 문서는 「단조 증가」만 보장한다.
- MongoDB Atlas Device Sync는 2024년에 지원 종료가 발표된 것으로 기억하지만 확인하지 못했다([미확인]). 설계 사례로만 인용한다.

## 삭제 기록을 영영 두거나 줄여서 두기, 수천 건의 크기

### Takeaway
영구 보관은 Riak(`keep`)과 CouchDB의 기본이고, Yjs도 지운 항목의 ID는 남기되 내용은 버린다. JSON으로 「ID와 밀리초 시각」을 두면 UUID ID 기준 한 건에 약 53바이트, 5,000건에 약 259 KiB(gzip 약 140 KiB)다. 짧은 ID면 그 절반쯤이다.

### Cited Findings
- [1차] Riak `keep`은 삭제 기록을 지우지 않으며 되살아남을 막는다고 적는다. — [Riak KV: Object Deletion](https://docs.riak.com/riak/kv/latest/using/reference/object-deletion/index.html)
- [1차] CouchDB의 삭제 문서는 압축 뒤에도 남는 작은 메타데이터이고, 지우는 길은 퍼지다. — [CouchDB: Document API](https://docs.couchdb.org/en/stable/api/document/common.html); [CouchDB: Database misc API](https://docs.couchdb.org/en/stable/api/database/misc.html)
- [1차] Yjs는 지운 항목에 「flagged as deleted on the item」 표시만 하고, 「No data is kept on when an item was deleted, or which user deleted it.」 가비지 수집을 켜면 「its content is discarded」이고, 자식이 있으면 내용 길이만 가진 `GC` 객체로 바꾼다. 「The deleted set is O(n), but because deletions usually happen in runs, this data set is usually tiny in practice.」 B4 벤치마크 스냅숏에서 삭제 집합은 4.5 KB였다. — [Yjs INTERNALS.md](https://github.com/yjs/yjs/blob/main/INTERNALS.md)
- [1차] Syncthing 2.0.0(2025-08-12 공개)은 「Deleted items are no longer kept forever in the database, instead they are forgotten after six months.」 `--db-delete-retention-interval`을 0으로 하면 영영 두고, 더 긴 기간도 줄 수 있다. 바꾼 이유는 적지 않았다. — [Syncthing v2.0.0 release](https://github.com/syncthing/syncthing/releases/tag/v2.0.0)
- [1차] Shapiro 등의 2P-Set은 삭제 기록에 원소만 두는 대신 「never added again」인 집합이다. 시각 없이 ID만 두면 그 ID는 다시 쓸 수 없다. — [A comprehensive study of CRDTs](https://inria.hal.science/inria-00555588)
- [1차] Firefox 버그에서 Richard Newman은 삭제 기록 목록이 오래 남을수록 새 항목과 GUID가 겹칠 가능성이 커진다고 지적했다. — [Bugzilla 1343103](https://bugzilla.mozilla.org/show_bug.cgi?id=1343103)
- [계산] 압축하지 않은 JSON 객체 `{"id":1730000000000,...}`로 쟀다(Python, 2026-10-30).

| 건수 | UUID ID와 시각 | 12자 ID와 시각 | UUID ID만(배열) |
| --- | --- | --- | --- |
| 1,000 | 51.8 KiB (gzip 28.4) | 28.3 KiB (gzip 16.1) | 38.1 KiB (gzip 21.6) |
| 5,000 | 258.8 KiB (gzip 139.5) | 141.6 KiB (gzip 79.0) | 190.4 KiB (gzip 106.3) |
| 20,000 | 1035.2 KiB (gzip 556.3) | 566.4 KiB (gzip 314.7) | 761.7 KiB (gzip 423.0) |

한 건 크기는 UUID와 시각이 약 53바이트, 12자 ID와 시각이 약 29바이트다. 시각을 빼면 UUID 기준으로 한 건에 14바이트쯤 준다.

### Inferences
- 북마크를 지우는 횟수는 사람이 손으로 하는 일이라 몇 년에 수백에서 수천 건 규모일 것이다(추정, 사용 통계는 찾지 않았다). 그러면 영구 보관해도 동기화 파일은 수십에서 수백 KiB 늘어난다. 저장 공간보다는 매번 내려받고 올리는 양과, 기기 쪽 저장 한도가 따질 거리다.
- 시각까지 빼고 ID만 두려면 ID를 다시 쓰지 않는다는 보장이 필요하다. ID를 무작위로 만들면 대체로 괜찮다. ID를 내용에서 만들면(예: 같은 절이면 같은 ID) 지운 뒤 같은 것을 다시 북마크할 때 삭제 기록과 부딪치므로 시각이나 번호가 필요하다.
- 시각 대신 작은 증가 번호(파일의 쓰기 번호)를 두면 크기는 비슷하고 기기 시계에서 벗어난다.
- 영구 보관도 옛 앱 버전이 30일 지난 삭제 기록을 지우고 올리는 동안에는 지켜지지 않는다. 옛 버전이 쓰는 한, 새 버전이 무엇을 정하든 파일 속 삭제 기록은 옛 버전의 셈으로 사라질 수 있다.

### Gaps
- Drive appDataFolder 파일의 크기 한도와, 앱의 기기 쪽 저장 한도는 조사 범위 밖이라 보지 않았다.

## 이 기기가 삭제 기록을 처음 본 시각(로컬 수신 시각)으로 나이 재기

### Takeaway
삭제 기록마다 「이 기기가 처음 받은 때」를 이 기기의 시계로 로컬에만 적고 N일 뒤 지우는 방식은, 삭제한 기기의 시계가 틀린 문제는 없앤다. 그러나 지우는 기기 자신의 시계가 앞으로 뛰면 여전히 일찍 지우고, 창보다 오래 꺼진 다른 기기 문제는 그대로다. RxDB와 Firefox의 논의가 이와 가까운 사례다.

### Cited Findings
- [1차] RxDB의 정리(cleanup) 플러그인은 지운 문서를 「when it can be done safely」에 지운다. `minimumDeletedTime`의 기본값은 한 달(`1000 * 60 * 60 * 24 * 31`), `runEach`는 5분이다. `awaitReplicationsInSync`(기본 참)는 복제 주기가 도는 동안 기다리며, 「This ensures we do not remove deleted documents when they might not have already been replicated.」 문서는 어느 시계로 재는지 적지 않는다. — [RxDB: Cleanup](https://rxdb.info/cleanup.html)
- [1차] RxDB 소스에서 감싼 저장소의 `bulkWrite`는 쓰는 행마다 `_meta.lwt`를 지금 시각(`now()`)으로 덮어쓴다. 복제에서 온 쓰기를 따로 건너뛰는 분기가 없다. 그래서 `lwt`는 이 기기가 그 문서를 마지막으로 저장한 시각이다. — [RxDB rx-storage-helper.ts](https://github.com/pubkey/rxdb/blob/master/src/rx-storage-helper.ts)
- [1차] Firefox 버그 1343103에서 다른 기기의 삭제 기록을 로컬 표에 두자는 제안에 「eviction policy」가 필요하다는 지적과 「12 months」보다 오래된 것을 지우자는 안이 나왔지만, 구현하지 않고 닫았다. — [Bugzilla 1343103](https://bugzilla.mozilla.org/show_bug.cgi?id=1343103)
- [2차] Apple Core Data의 영속 이력은 `deleteHistory(before:)`로 날짜나 토큰 이전의 이력을 지운다. Stack Overflow에 옮겨진 Apple의 안내는 지우기 전에 한 곳에서 「your app and its clients have consumed the history they need」를 확인하라는 것이다(검색 결과 요약). — [Apple: deleteHistory(before:)](https://developer.apple.com/documentation/coredata/nspersistenthistorychangerequest/deletehistory(before:)-5kghb)
- [2차] Ditto는 기기 사이에 퍼지는 삭제 기록을 설정한 수명(`TOMBSTONE_TTL_HOURS`) 뒤에 거둔다고 제3자 Rust 크레이트가 적는다. 그 크레이트는 일반 기기 7일, 저장이 적은 기기 72시간을 기본으로 둔다. Ditto 공식 문서는 확인하지 못했다. — [peat-mesh ttl.rs](https://docs.rs/crate/peat-mesh/0.8.2/source/src/storage/ttl.rs)

### Inferences
- 로컬 수신 시각은 「이 기기가 이 삭제를 안 지 얼마나 되었나」를 잴 뿐, 「다른 기기들이 이 삭제를 받을 기회가 있었나」는 재지 못한다.
- 지금 앱처럼 「로컬에서 지운 삭제 기록은 다음 올리기 때 파일에서도 빠진다」면, 파일 속 삭제 기록의 실제 수명은 「가장 먼저 N일을 채운 기기」가 정한다. 삭제한 기기는 삭제 기록을 가장 먼저 받으므로, 실제 창은 삭제 시점부터 대략 N일이다. 즉 로컬 수신 시각으로 바꾸어도 창의 길이는 거의 같고, 바뀌는 것은 시계 오차의 영향뿐이다.
- 로컬 수신 시각에서 시계가 미치는 영향: 지우는 기기의 시계가 뒤로 가면 더 오래 두어 안전하다. 앞으로 뛰면(예: 1년 앞으로 맞춰짐) 받은 삭제 기록을 모두 바로 지운다. 지금 방식과 달리, 삭제한 기기의 시계가 틀린 것은 영향을 주지 않는다.
- 앱 데이터를 지우거나 다시 설치하면 수신 시각을 잃는다. 이때 「모두 방금 받은 것」으로 다시 세면 안전한 쪽이다.
- 로컬 수신 시각을 파일 속 삭제 기록을 지우는 기준으로 쓰지 않고, 이 기기의 로컬 사본에서만 지우는 기준으로 쓰고 파일에는 남기면(파일 쪽은 서버 시각이나 확인 표시로 지우기), 기기 시계가 틀려도 다른 기기에 해가 가지 않는다.
- 이 방식을 따로 이름 붙여 쓰는 제품 사례는 찾지 못했다. RxDB가 사실상 이렇게 동작한다는 것은 소스에서 본 `lwt`에서 미루어 본 것이다.

### Gaps
- RxDB의 정리 코드가 실제로 `_meta.lwt`와 `minimumDeletedTime`을 비교하는지는 저장소 구현 파일을 열어 확인하지 않았다.
- Syncthing의 6개월이 어느 기기의 어떤 시각을 기준으로 하는지 확인하지 못했다.

## 창이 지난 뒤 돌아온 기기 다루기(전체 재동기화, 오래된 기록 거부, 창보다 오래된 기록을 따로 다루기)

### Takeaway
실제 시스템의 답은 셋이다. 서버가 「여기까지 지웠다」는 경계를 알리고, 그보다 오래 떨어진 클라이언트는 증분 병합을 하지 않고 전체 동기화나 초기화를 한다(Evernote, MongoDB). 운영자가 창 안에 수리해 그런 기기가 생기지 않게 한다(Cassandra). 해결하지 못한 채 두거나 사용자에게 묻자는 안에 머문다(Firefox).

### Cited Findings
- [1차] Evernote는 `fullSyncBefore > lastSyncTime`이면 전체 동기화를 하고, 전체 동기화에서는 서버에 없고 「previously uploaded」였던 항목을 클라이언트에서 지운다. — [Evernote Synchronization via EDAM (PDF)](https://dev.evernote.com/media/pdf/edam-sync.pdf)
- [2차] MongoDB Device Sync는 「client maximum offline time」보다 오래 떨어진 클라이언트가 다시 이어 붙지 못하고 「client reset」을 해야 한다(기본 30일). — [MongoDB: Optimize Sync Atlas usage](https://www.mongodb.com/docs/atlas/app-services/sync/go-to-production/optimize-sync-atlas-usage/)
- [1차] Cassandra는 창보다 오래 꺼진 노드를 그대로 붙이면 지운 데이터가 되살아난다고 적고, 창 안의 수리를 요구한다. — [Cassandra: Compaction overview](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/compaction/overview.html); [Cassandra: Repair](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/repair.html)
- [1차] Firefox에서는 오래된 기기가 돌아와 지운 로그인이 되살아난 사례가 보고되었고, 「마지막 동기화가 오래되었으면 합칠지 버릴지 사용자에게 묻는다」는 안이 논의되었으나 고치지 않았다. 2011년에는 60일보다 오래 떨어진 클라이언트에 대조를 하자는 의견이 있었다. — [Bugzilla 1332290](https://bugzilla.mozilla.org/show_bug.cgi?id=1332290); [Bugzilla 669338](https://bugzilla.mozilla.org/show_bug.cgi?id=669338)
- [1차] Couchbase는 퍼지 간격을 클라이언트의 동기화 빈도에 맞추라고만 한다. — [Couchbase: Managing tombstones](https://docs.couchbase.com/sync-gateway/current/managing-tombstones.html)

### Inferences
- 동기화 파일 하나로 옮기면 Evernote 방식은 이렇게 된다. 파일 머리에 「삭제 기록을 지운 경계」(서버 시각이나 쓰기 번호)를 적는다. 기기는 로컬에 「마지막으로 병합에 성공한 파일의 서버 시각 또는 번호」와 「그때 파일에 있던 ID 목록」(또는 기록마다 「파일에 올라간 적 있음」 표시)을 둔다. 병합할 때 로컬에만 있는 기록은, 파일에 있었던 적이 있으면 누가 지운 것이므로 지우고, 파일에 있었던 적이 없으면(이 기기가 오프라인으로 만든 것) 올린다.
- 이 규칙은 경계와 비교하지 않아도 언제나 맞다. 그래서 삭제 기록은 「다른 기기에 빨리 알리기」와 「로컬 동기화 상태를 잃은 기기 돕기」만 맡게 되고, 창의 길이가 안전을 좌우하지 않는다. 경계는 「이 기기는 동기화 상태를 믿을 수 없다」를 알아내는 데 쓴다. 예: 로컬 상태가 없거나, 마지막 동기화가 경계보다 이르고 로컬 ID 목록도 없으면, 로컬에만 있는 기록을 올리지 않고 사용자에게 보이거나 따로 둔다.
- 「창보다 오래된 기록을 거부」하는 다른 방법: 기록의 수정 시각이 「파일의 경계보다 이르고 파일에 없으면」 올리지 않는다. 이 방법은 기록의 시각이 기기 시계로 찍혀 있으면 다시 시계에 기대게 되고, 오프라인 동안 새로 만든 기록을 잘못 버릴 수 있다. 시각 대신 「파일에 올라간 적 있음」을 쓰는 쪽이 낫다.
- 고친 내용과 삭제가 부딪치는 경우(오프라인 동안 고쳤는데 그사이 다른 기기에서 지움)는 Evernote처럼 삭제를 이기게 하거나, 고친 쪽을 살리고 사용자에게 알리는 선택이 남는다. 북마크라면 고친 쪽을 살리는 편이 사용자가 잃는 것이 적다(판단, 출처 없음).

### Gaps
- 기기 몇 대의 개인용 동기화에서 「돌아온 기기에게 묻는 대화상자」를 실제로 둔 제품 사례와 사용자 반응은 찾지 못했다.

## 1-4대 기기가 단순한 저장소의 파일 하나로 동기화하는 단일 사용자 앱에 맞는 전략

### Takeaway
기기 시계로 찍은 삭제 시각에서 30일을 재는 지금 방식은, 시계가 30일 넘게 빠른 기기 하나가 파일의 삭제 기록을 모두 지울 수 있고, 30일 넘게 쓰지 않은 기기는 늘 되살아남을 일으킨다. 이 규모에서 가장 튼튼한 조합은 「파일 쓰기 번호나 서버 시각으로 순서와 나이를 재고, 기기마다 파일에 올라간 적 있는 기록을 기억해 없어진 것을 삭제로 읽는 것」(Evernote 방식)에, 크기가 작으니 삭제 기록을 오래(또는 영영) 두는 것을 더한 것이다. 옛 앱 버전이 쓰는 동안에는 어떤 전략도 옛 버전의 30일 삭제를 막지 못한다.

### Cited Findings
- [1차] 창 방식이 창보다 오래 꺼진 복제본에서 실패한다는 것은 Cassandra, Couchbase, Firefox, MongoDB 문서와 버그가 모두 적는다. — [Cassandra: Compaction overview](https://cassandra.apache.org/doc/latest/cassandra/managing/operating/compaction/overview.html); [Couchbase: Managing tombstones](https://docs.couchbase.com/sync-gateway/current/managing-tombstones.html); [Bugzilla 1332290](https://bugzilla.mozilla.org/show_bug.cgi?id=1332290)
- [1차] 확인 기반 지우기는 복제본 집합을 알아야 하고, 영영 사라진 복제본이 지우기를 멈춘다. — [A comprehensive study of CRDTs](https://inria.hal.science/inria-00555588); [arXiv 1210.3368](https://arxiv.org/abs/1210.3368)
- [1차] 하나뿐인 증가 번호와 「올린 적 있음」 표시로 삭제를 알아내는 설계는 Evernote 명세에 있다. — [Evernote Synchronization via EDAM (PDF)](https://dev.evernote.com/media/pdf/edam-sync.pdf)

### Inferences

아래에서 W는 창(30일), 시계 오차는 실제 시각보다 빠르면 양수다.

**S1. 삭제한 기기의 시계로 찍은 시각에서 W를 각 기기의 시계로 잰다(지금 방식).**
- 규칙: 삭제 기록에 삭제한 기기의 `Date.now()`를 적고, 각 기기가 앱을 시작할 때 자기 시계로 W보다 오래된 것을 지운다. 지운 기기가 올리면 파일에서도 빠진다.
- 가정: 모든 기기의 시계가 W보다 훨씬 작은 오차 안에 있다. 모든 기기가 W 안에 한 번은 동기화한다.
- 실제 창: 삭제한 기기의 오차를 d1, 지우는 기기의 오차를 d2라 하면, 지우는 기기는 실제 나이가 W + d1 - d2를 넘으면 지운다. 지운 기기가 올리면 모두에게서 사라지므로, 실제 창은 활동하는 기기들 가운데 이 값이 가장 작은 기기가 정한다.
- 시계가 빠른 기기: 지우는 쪽이 W보다 더 빠르면(d2 - d1 > W) 받는 삭제 기록을 모두 첫 시작에서 지우고, 다음 올리기로 파일에서 모두 없앤다. 29일 빠르면 창이 하루가 된다. 삭제하는 쪽이 빠르면 그 삭제 기록은 다른 기기에서 W + d1만큼 오래 남고, 병합 규칙(삭제 시각이 기록의 `_u`보다 크면 삭제)에 따라 그동안 같은 ID의 수정과 다시 만들기를 이긴다.
- 시계가 느린 기기: 삭제하는 쪽이 W보다 더 느리면 그 삭제 기록은 다른 기기에서 바로 지워진다. 또 삭제 시각이 시계가 맞는 기기가 찍은 `_u`보다 작아, 병합에서 삭제가 지고 기록이 바로 되살아난다. 지우는 쪽이 느리면 오래 두므로 안전하다.
- 몇 달 꺼진 기기: 실패한다. 돌아온 기기의 로컬 기록은 파일에 없고 삭제 기록도 없으므로 새 기록으로 올라가 모든 기기에서 되살아난다(Cassandra의 zombie, Firefox 1332290과 같은 경우).
- 메타데이터: 지난 W 동안 지운 건수만큼. 가장 작다.

**S2. 삭제 기록을 영영 둔다(줄여서 두기 포함).**
- 규칙: 삭제 기록을 지우지 않는다. 줄이려면 ID와 작은 번호만 두거나, ID를 다시 쓰지 않는다면 ID만 둔다.
- 가정: 삭제 건수가 작다. 파일을 쓰는 모든 앱 버전이 삭제 기록을 지우지 않는다.
- 실패: 옛 버전이 30일 규칙으로 지우고 올리면 사라진다. ID만 두면 같은 ID를 다시 쓸 수 없다. 기기 로컬 상태를 처음부터 다시 받는 기기에는 문제가 없다.
- 시계: 지우기에는 시계를 쓰지 않는다. 병합의 「삭제 시각과 `_u` 비교」는 여전히 기기 시계에 기댄다.
- 몇 달 꺼진 기기: 삭제 기록이 남아 있으면 안전하다.
- 메타데이터: 지운 전체 건수에 비례. UUID와 시각이면 5,000건에 약 259 KiB(gzip 약 140 KiB).

**S3. 서버 시각이나 파일 버전으로 나이를 잰다.**
- 규칙: 삭제 기록이 처음 파일에 들어간 쓰기의 서버 시각(그 뒤 처음 내려받은 파일의 `modifiedTime`)이나 파일 쓰기 번호를 삭제 기록에 적고, 지금 내려받은 파일의 같은 값과 비교해 W를 잰다.
- 가정: 저장소가 클라이언트가 바꾸지 않는 시각이나 단조 증가 번호를 응답 본문으로 준다(Drive의 `version`, 앱이 정하지 않는 `modifiedTime`).
- 실패: 서버 시각을 처음 적는 데 한 번 더 써야 할 수 있다(다음 쓰기에 함께 넣으면 추가 쓰기가 없다). 기준 파일의 옛 `modifiedTime`을 찍으면 너무 일찍 지운다. 옛 버전은 이 필드를 모르고 자기 시계로 지운다.
- 시계: 기기 시계는 어느 쪽으로 틀려도 영향이 없다.
- 몇 달 꺼진 기기: 여전히 실패한다. 창을 서버 시간으로 바르게 잴 뿐이다. S6과 함께 써야 한다.
- 메타데이터: S1과 같은 건수에 값 하나.

**S4. 이 기기가 처음 받은 시각(로컬 전용)으로 잰다.**
- 규칙: 받을 때 이 기기의 시계로 수신 시각을 로컬에만 적고, N일 뒤 지운다.
- 가정: 지우는 기기의 시계가 앞으로 크게 뛰지 않는다.
- 실패: 파일 쪽 삭제 기록까지 이 기준으로 지우면 실제 창은 「삭제한 기기의 N일」과 거의 같다. 시계가 앞으로 뛴 기기는 다 지운다. 몇 달 꺼진 기기 문제는 그대로다.
- 시계: 삭제한 기기의 오차는 영향이 없다. 지우는 기기의 오차는 S1과 같은 방향으로 영향을 준다.
- 메타데이터: 기기마다 로컬에 ID와 수신 시각. 파일에는 없다.
- 맞는 쓰임: 로컬 사본 정리에만 쓰고, 파일 쪽은 S3이나 S5로 지울 때.

**S5. 모든 등록 기기가 확인한 뒤 지운다(복제본 명부).**
- 규칙: 파일에 기기별 확인 번호(마지막으로 반영한 파일 쓰기 번호)를 둔다. 삭제 기록의 번호가 모든 등록 기기의 확인 번호 이하이면 지운다. 서버 시각으로 오래 확인하지 않은 기기는 은퇴시킨다.
- 가정: 기기 집합을 안다. 모든 앱 버전이 확인 번호를 쓴다.
- 실패: 다시 설치하면 새 ID가 생기고 옛 ID가 지우기를 막는다(은퇴로 풀린다). 옛 버전은 명부에 없어 판단할 수 없다. 은퇴한 기기가 돌아오면 S6이 필요하다.
- 시계: 번호와 서버 시각만 쓰므로 기기 시계와 무관하다.
- 몇 달 꺼진 기기: 은퇴 기간 안이면 안전하다(그동안 지우기가 멈출 뿐). 은퇴 뒤면 S6에 맡긴다.
- 메타데이터: 기기마다 수십 바이트. 1-4대면 무시할 만하다.

**S6. 「파일에 올라간 적 있음」을 기억하고, 없어진 것을 삭제로 읽는다(Evernote 방식, 경계 포함).**
- 규칙: 파일에 쓰기마다 오르는 번호(또는 Drive `version`)를 두고, 기록마다 파일에 처음 올라간 번호를 적는다. 기기는 마지막으로 병합한 번호를 로컬에 둔다. 로컬에만 있는 기록은, 그 번호가 마지막 병합 번호 이하이면(파일에 있었던 적이 있으면) 지운 것으로 읽고, 번호가 없으면 새 기록으로 올린다. 파일 머리에는 삭제 기록을 지운 경계를 둔다. 로컬 상태를 믿을 수 없는 기기만 경계를 보고 조심한다.
- 가정: 올리기가 조건부라 쓰기가 한 줄로 정렬된다(If-Match). 각 기기가 로컬 동기화 상태를 잃지 않거나, 잃었음을 알 수 있다.
- 실패: 오프라인 동안 고친 기록이 다른 곳에서 지워지면 정책을 정해야 한다. 옛 버전이 번호를 지우거나 올리지 않으면 그 쓰기에서 번호가 빠진다. 옛 버전은 여전히 S1로 동작한다.
- 시계: 순서와 삭제 판단에 기기 시계를 쓰지 않는다.
- 몇 달 꺼진 기기: 삭제 기록이 없어도 안전하다. 이것이 S1에서 S5까지와 다른 점이다.
- 메타데이터: 기록마다 번호 하나(약 5-10바이트), 파일에 번호와 경계 하나, 기기마다 로컬에 번호 하나. 삭제 기록은 S3이나 S5로 지울 수 있다.
- 변형: 기기마다 카운터를 두는 버전 벡터(Optimized OR-Set)도 같은 효과를 내지만, 쓰기가 한 줄로 정렬되는 저장소에서는 번호 하나로 충분하다.

**S7. 창이 지나 돌아온 기기에 전체 초기화를 시킨다.**
- 규칙: 기기의 마지막 동기화(서버 시각)가 경계보다 이르면, 로컬 기록을 파일로 바꾸고 로컬에만 있는 기록은 올리지 않고 따로 보여 준다(MongoDB의 client reset, Evernote의 full sync).
- 가정: 기기가 마지막 동기화의 서버 시각을 안다.
- 실패: 오프라인 동안 만든 기록을 바로 올리지 않으므로 사용자에게 묻는 화면이 필요하다. 로컬 상태가 없는 기기와 옛 버전에는 쓸 수 없다.
- 시계: 서버 시각만 쓴다.
- 메타데이터: 파일에 경계 하나, 기기마다 로컬에 서버 시각 하나.

**요약 비교**

| 전략 | 기기 시계 오차에 | 몇 달 꺼진 기기에 | 파일 크기 | 옛 버전과 함께 |
| --- | --- | --- | --- | --- |
| S1 기기 시계로 W | 약하다(빠른 기기 하나가 모두 지움) | 실패 | 가장 작다 | 지금과 같다 |
| S2 영구 보관 | 지우기는 무관 | 남아 있으면 안전 | 지운 건수에 비례 | 옛 버전이 지운다 |
| S3 서버 시각으로 W | 무관 | 실패 | S1과 같다 | 옛 버전이 지운다 |
| S4 로컬 수신 시각 | 삭제한 기기의 오차는 무관 | 실패 | 파일은 S1과 같다 | 옛 버전이 지운다 |
| S5 모든 기기 확인 | 무관 | 은퇴 전까지 안전 | 아주 작은 명부 | 옛 버전은 판단 불가 |
| S6 올라간 적 있음 | 무관 | 안전 | 기록마다 번호 하나 | 옛 버전은 S1로 동작 |
| S7 전체 초기화 | 무관 | 안전(사용자 확인 필요) | 경계 하나 | 쓸 수 없다 |

- 이 규모에 맞는 조합(추론): S6을 바탕으로 두고, 삭제 기록은 「빨리 알리기」와 「로컬 상태를 잃은 기기」용으로 S3(서버 시각)의 긴 창(예: 몇 달에서 영구)으로 둔다. 크기는 수천 건에도 수백 KiB 아래다. 기기가 4대 안팎이라 S5의 명부도 싸지만, 다시 설치와 옛 버전 때문에 은퇴 규칙과 S6이 어차피 필요하다.
- 옛 버전 문제(추론): 옛 버전은 자기 시계로 30일 규칙을 쓰고, 지운 삭제 기록을 파일에서도 빼고 올린다. 그래서 옛 버전이 하나라도 그 파일에 쓰는 동안은, 새 버전의 S2, S3, S5가 파일 속 삭제 기록을 지켜 주지 못한다. S6만은 새 버전 기기 사이에서 삭제 기록 없이 동작하므로, 옛 버전이 삭제 기록을 지워도 새 버전 기기는 되살리지 않는다. 다만 옛 버전 기기 자신이 오래 꺼져 있다 돌아오면 그 기기는 여전히 되살린다.
- 옛 버전이 모르는 필드(번호, 경계, 명부)를 다시 올릴 때 지키는지 버리는지가 S3, S5, S6의 실현성을 정한다. 이는 앱 코드의 문제라 조사하지 않았다.

### Gaps
- 옛 앱 버전이 동기화 파일의 모르는 필드를 보존하는지는 조사 범위(앱 자체) 밖이라 확인하지 않았다.
- 1-4대 개인 기기 규모에서 S6과 같은 규칙을 쓰는 브라우저 앱의 공개 사례나 엔지니어링 블로그는 찾지 못했다. 찾은 자료는 대부분 제품 문서(Cassandra, Riak, CouchDB, Couchbase, MongoDB, RxDB)와 버그 트래커였다.
- 이 규모의 앱에서 한 해에 지우는 북마크 수의 실제 통계는 찾지 않았다. 크기 추정은 건수를 가정한 계산이다.
