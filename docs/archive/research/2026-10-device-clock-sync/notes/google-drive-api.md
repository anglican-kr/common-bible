# Google Drive API v3에서 서버가 정한 순서, 버전, 시각을 얻는 방법

표시 규칙: 「문서화됨」은 Google 1차 문서의 인용과 URL이다. 「다른 사람의 관찰」은 Google 문서 밖의 보고(Stack Overflow, GitHub)다. 「직접 관찰」은 이 조사에서 2026-10-30 13:50 UTC쯤 인증 없이 curl로 본 결과다(토큰은 쓰지 않았다). 「문서에 없음」은 아래에 적은 문서들을 찾아도 나오지 않은 것이다. 문서는 2026-10-30에 받은 판이다. 안내서 대부분은 「Last updated 2026-09-03 UTC」, files 참조는 2026-07-14, files.update 참조는 2026-03-20, revisions 리소스 참조는 2025-07-23이다. 디스커버리 문서(API의 기계용 명세)는 `"revision": "20261028"`이다.

## 1. 파일 리소스의 필드(`version`, `modifiedTime`, `headRevisionId`, `md5Checksum`, ETag)

### 요점
파일마다 서버가 매기는 순서로 쓸 수 있다고 문서에 적힌 값은 `version` 하나다. 이 값은 「monotonically increasing」이고 서버의 모든 변경을 반영한다고 적혀 있으며, int64 숫자를 JSON 문자열로 준다. 다만 1씩 오른다는 보장은 없고, 실제로 한 번 바꿨을 때 3에서 6으로 뛴 보고가 있다. `modifiedTime`은 클라이언트가 덮어쓸 수 있는 필드라 서버 시계로 믿을 수 없다. v3 파일 리소스에는 `etag` 필드가 없다.

### 출처가 있는 사실
- 「문서화됨」 `version`: "Output only. A monotonically increasing version number for the file. This reflects every change made to the file on the server, even those not visible to the user." 형식은 문자열이다(디스커버리: `"type": "string", "format": "int64"`, 참조 페이지: "string (int64 format)"). (출처: [files 참조](https://developers.google.com/workspace/drive/api/reference/rest/v3/files), [디스커버리 문서](https://www.googleapis.com/discovery/v1/apis/drive/v3/rest))
- 「문서화됨」 v2의 같은 필드는 "...even those not visible to the requesting user."라고 적는다. 두 판 모두 같은 뜻이다. (출처: [v2 files 참조](https://developers.google.com/workspace/drive/api/reference/rest/v2/files))
- 「문서에 없음」 `version`이 한 번 쓸 때 몇씩 오르는지, 메타데이터만 바뀌어도 오르는지, 「monotonically increasing」이 엄격한 증가인지 같은 값 유지를 포함하는지는 적혀 있지 않다. 다른 파일의 `version`과 비교할 수 있다는 말도 없다.
- 「다른 사람의 관찰」 gogcli의 PR은 실제 Drive에 조건부 교체를 시험한 결과로 "Drive advanced the file version from `3` to `6`, and the downloaded replacement matched the local payload byte-for-byte."라고 적었다. 한 번의 교체에 `version`이 3 올랐다는 뜻이다. (출처: [openclaw/gogcli PR #929](https://github.com/openclaw/gogcli/pull/929))
- 「문서에 없음」 appDataFolder 파일에서 `version`이 채워지는지는 따로 적혀 있지 않다. 다만 `headRevisionId`나 `md5Checksum`과 달리 `version` 설명에는 파일 종류나 저장 공간에 대한 제한 문구가 없다. appdata 안내서의 목록 예시는 `fields=files(id,name,mimeType,size,modifiedTime)`만 요청한다. (출처: [appdata 안내서](https://developers.google.com/workspace/drive/api/guides/appdata))
- 「문서화됨」 `modifiedTime`은 참조 페이지에 "Output only"가 붙지 않은, 쓸 수 있는 필드다: "The last time the file was modified by anyone (RFC 3339 date-time). Note that setting modifiedTime also updates modifiedByMeTime for the user." (출처: [files 참조](https://developers.google.com/workspace/drive/api/reference/rest/v3/files))
- 「문서화됨」 v2와 v3 비교표는 v2의 `files.touch`를 v3의 "files.update with {'modifiedTime':'timestamp'}"로 옮기고, v2의 `modifiedDateBehavior` 매개변수는 v3에서 "The modified date is set automatically if not provided in the resource body."라고 적는다. v2의 `setModifiedDate`는 "n/a"다. (출처: [v2 to v3 reference](https://developers.google.com/workspace/drive/api/guides/v2-to-v3-reference))
- 「문서화됨」 비교 안내서: "The modifiedTime field in the files resource updates the last time anyone modified the file. In v2, the modifiedDate field was only mutable on update if you set the setModifiedDate field." 즉 v3에서는 따로 허락하는 매개변수 없이 요청 본문의 `modifiedTime`이 그대로 쓰인다. (출처: [v3versusv2](https://developers.google.com/workspace/drive/api/guides/v3versusv2))
- 「문서화됨」 files.update 설명: "When updating fields, some fields might be changed automatically, such as `modifiedDate`." v2 필드 이름이 v3 문서에 남아 있다. (출처: [files.update 참조](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update))
- 「문서화됨」 서버가 정하는 시각이라는 명시는 v2에만 있다. v2 `files.touch`: "Set the file's updated time to the current server time." v3 문서에는 클라이언트가 값을 주지 않을 때 어느 시계로 정하는지 적혀 있지 않다. (출처: [v2 files.touch](https://developers.google.com/workspace/drive/api/reference/rest/v2/files/touch))
- 「문서에 없음」 `modifiedTime`의 정밀도는 명세로 적혀 있지 않다. appdata 안내서의 응답 예시는 밀리초까지 보인다: `"modifiedTime": "2025-04-03T23:40:05.860Z"`. (출처: [appdata 안내서](https://developers.google.com/workspace/drive/api/guides/appdata))
- 「문서에 없음」 클라이언트가 보낸 `modifiedTime`이 미래나 과거일 때 서버가 거절하거나 고치는지는 적혀 있지 않다.
- 「문서화됨」 `modifiedByMeTime`: "Output only. The last time the file was modified by the user (RFC 3339 date-time)." (출처: [files 참조](https://developers.google.com/workspace/drive/api/reference/rest/v3/files))
- 「문서화됨」 `headRevisionId`: "Output only. The ID of the file's head revision. This is currently only available for files with binary content in Google Drive." 값은 문자열이고, 리비전 ID끼리의 순서는 적혀 있지 않다. (출처: [files 참조](https://developers.google.com/workspace/drive/api/reference/rest/v3/files))
- 「문서화됨」 `md5Checksum`: "Output only. The MD5 checksum for the content of the file. This is only applicable to files with binary content in Google Drive." `sha1Checksum`과 `sha256Checksum`은 "only populated for files with content stored in Google Drive"다. (출처: [디스커버리 문서](https://www.googleapis.com/discovery/v1/apis/drive/v3/rest))
- 「문서화됨」 「binary content」의 뜻: "In the Drive API, a blob file refers to any raw binary file stored on Google Drive (such as images, videos, and PDFs) as opposed to a Google Workspace document." (출처: [manage-downloads 안내서](https://developers.google.com/workspace/drive/api/guides/manage-downloads))
- 「문서화됨」 v3에는 파일의 `etag` 필드가 없다. 비교표의 리소스 필드 표에서 Files, About, Apps, Permissions, Revisions의 `etag`와 files.list, changes.list, permissions.list, revisions.list의 `etag`가 모두 v3 쪽 "n/a"다. v3 디스커버리 문서 전체에 「etag」라는 글자가 한 번도 나오지 않는다(직접 세었다). v2 File에는 "Output only. ETag of the file."가 있다. (출처: [v2 to v3 reference](https://developers.google.com/workspace/drive/api/guides/v2-to-v3-reference), [디스커버리 문서](https://www.googleapis.com/discovery/v1/apis/drive/v3/rest), [v2 files 참조](https://developers.google.com/workspace/drive/api/reference/rest/v2/files))
- 「다른 사람의 관찰」 2026-01-11 질문자가 v3 메타데이터 요청(`fields=id,name,version`)을 curl로 보내고 "I do not see an `ETag:` header in the response headers at all"이라고 적었다. 다운로드(`alt=media`) 응답은 시험하지 않았다. (출처: [Stack Overflow 79865579](https://stackoverflow.com/questions/79865579/is-raceless-optimistic-concurrency-possible-in-google-drive-v3-interface))
- 「다른 사람의 관찰」 2014년 v2 사용자의 답: "Note that ETag might change even if the content does not." (출처: [Stack Overflow 21793871](https://stackoverflow.com/questions/21793871/detect-conflict-when-uploading-document-to-google-drive))

### 추론
- `version`은 한 파일 안에서 서버가 매긴 순서로 쓸 수 있다. 같은 파일의 두 상태 가운데 `version`이 큰 쪽이 나중이다. 증가 폭이 일정하지 않으므로 「쓰기 몇 번」을 세는 데는 못 쓰고, 시간 간격의 대신으로도 못 쓴다.
- `version`은 int64 문자열이라 JavaScript에서는 `BigInt`로 바꿔 비교하는 편이 안전하다(문서가 값의 크기 범위를 적지 않는다).
- `modifiedTime`을 서버 시각으로 쓰려면 앱의 모든 기기가 요청 본문에 `modifiedTime`을 절대 넣지 않아야 한다. 그래도 v3 문서는 그 값이 서버 시계라고 명시하지 않는다. 클라이언트가 덮어쓸 수 있으므로 단조 증가도 보장되지 않는다.
- 앱의 `sync.json`은 JSON으로 올리는 일반 파일이므로 문서의 「blob file」에 들어간다. 그래서 `headRevisionId`, `md5Checksum`, 리비전 규칙이 적용될 것으로 보인다.
- 업로드 응답에 `fields=id,version,modifiedTime,headRevisionId,md5Checksum`을 요청하면 그 쓰기에 서버가 매긴 값을 같은 응답에서 받을 수 있다. 성능 안내서는 `fields` 매개변수를 "any request that returns response data"에 쓸 수 있다고 적는다(출처: [performance 안내서](https://developers.google.com/workspace/drive/api/guides/performance)).

### 남은 공백
- 인증 토큰 없이 조사해서 appDataFolder 파일에 `version`, `headRevisionId`, `md5Checksum`이 실제로 채워지는지, 메타데이터만 바꿔도 `version`이 오르는지 직접 보지 못했다.
- `modifiedTime`을 클라이언트가 보내지 않을 때 서버 시계로 정한다는 v3 문서는 찾지 못했다.
- Google Issue Tracker에서 `version`이나 ETag를 다룬 항목은 검색으로 찾지 못했다.

## 2. appDataFolder 파일의 리비전 API

### 요점
appDataFolder를 따로 다루는 리비전 문서는 없지만, 규칙은 blob 파일 전체에 적용된다. 머리 리비전이 아닌 리비전은 보통 30일 보관되고, 「Keep Forever」가 아닌 리비전이 100개가 된 뒤 새 리비전이 올라오면 더 일찍 지워질 수 있다. 문서는 「Keep Forever」로 표시한 리비전만 내려받을 수 있다고 적는다. 그래서 「마지막 동기화의 기준본」을 리비전으로 두려면 올릴 때 `keepRevisionForever=true`를 붙이고, 다 쓴 리비전은 직접 지워야 한다(파일당 200개 상한, 저장 용량에 포함).

### 출처가 있는 사실
- 「문서화됨」 자동 삭제: "Any blob file revision, other than the head revision, that's not designated as "Keep Forever" is purgeable. Purgeable revisions are typically preserved for 30 days, but can be purged earlier if a file has 100 revisions that aren't designated as "Keep Forever" and a new revision is uploaded." 그리고 "Up to 200 revisions can be set to "Keep Forever" and they count towards your storage limit. The head revision is never auto-purged." (출처: [manage-revisions 안내서](https://developers.google.com/workspace/drive/api/guides/manage-revisions), 같은 문장이 [change-overview](https://developers.google.com/workspace/drive/api/guides/change-overview)에도 있다)
- 「문서화됨」 `Revision.keepForever`: "Whether to keep this revision forever, even if it is no longer the head revision. If not set, the revision will be automatically purged 30 days after newer content is uploaded. This can be set on a maximum of 200 revisions for a file. This field is only applicable to files with binary content in Drive." (출처: [디스커버리 문서](https://www.googleapis.com/discovery/v1/apis/drive/v3/rest), [revisions 참조](https://developers.google.com/workspace/drive/api/reference/rest/v3/revisions))
- 「문서화됨」 files.create와 files.update의 `keepRevisionForever` 매개변수(기본값 false): "Whether to set the `keepForever` field in the new head revision. This is only applicable to files with binary content in Google Drive. Only 200 revisions for the file can be kept forever. If the limit is reached, try deleting pinned revisions." (출처: [디스커버리 문서](https://www.googleapis.com/discovery/v1/apis/drive/v3/rest))
- 「문서화됨」 내려받기 조건: "You can only download blob file content revisions marked as "Keep Forever". If you want to download a revision, make sure to set it to "Keep Forever" first." 방법은 `revisions.get`에 `alt=media`이고 예시 URL은 `https://www.googleapis.com/drive/v3/files/FILE_ID/revisions/REVISION_ID?alt=media`다. `Range` 헤더도 받는다. (출처: [manage-revisions 안내서](https://developers.google.com/workspace/drive/api/guides/manage-revisions), [manage-downloads 안내서](https://developers.google.com/workspace/drive/api/guides/manage-downloads))
- 「문서화됨」 장기 작업으로 내려받는 `files.download`도 `revisionId`를 받는다: "Operations are valid for 24 hours from the time of creation." (출처: [디스커버리 문서](https://www.googleapis.com/discovery/v1/apis/drive/v3/rest))
- 「문서화됨」 한 번 「Keep Forever」로 하면 되돌릴 수 없다: "Once a blob file revision is set to "Keep Forever", it can only be downloaded or deleted." 오류 `illegalKeepForeverModification`은 "Cannot update a revision to false that is marked as keepForever."이고, 고치는 법은 그 리비전을 지우는 것이다. (출처: [manage-revisions 안내서](https://developers.google.com/workspace/drive/api/guides/manage-revisions), [handle-errors 안내서](https://developers.google.com/workspace/drive/api/guides/handle-errors))
- 「문서화됨」 지우기: "You can only delete revisions for blob files with binary content in Drive... the last remaining revision of the binary file, can't be deleted." (출처: [manage-revisions 안내서](https://developers.google.com/workspace/drive/api/guides/manage-revisions))
- 「문서화됨」 목록: `revisions.list`는 기본으로 "the id, mimeType, kind, and modifiedTime fields"만 준다. `pageSize`는 기본 200, 최대 1000이다. "The list of revisions returned by this method might be incomplete for files with a large revision history... Older revisions might be omitted from the response." (출처: [revisions.list 참조](https://developers.google.com/workspace/drive/api/reference/rest/v3/revisions/list), [manage-revisions 안내서](https://developers.google.com/workspace/drive/api/guides/manage-revisions))
- 「문서화됨」 순서: "Revision history: A record of all revisions of a file in chronological order." (출처: [change-overview](https://developers.google.com/workspace/drive/api/guides/change-overview))
- 「문서화됨」 리비전 필드: `id`(Output only), `modifiedTime`("The last time the revision was modified (RFC 3339 date-time)."), `md5Checksum`, `size`, `keepForever`, `originalFilename`, `lastModifyingUser`. 리비전에는 `version` 같은 번호 필드가 없다. 디스커버리는 `Revision.modifiedTime`에 "Output only"를 붙이지 않는다. (출처: [디스커버리 문서](https://www.googleapis.com/discovery/v1/apis/drive/v3/rest))
- 「문서화됨」 권한: "To access the revision history, a user must have the role of owner, organizer, fileOrganizer, or writer." (출처: [manage-revisions 안내서](https://developers.google.com/workspace/drive/api/guides/manage-revisions))
- 「문서화됨」 v2의 `newRevision` 매개변수는 "Whether a blob upload should create a new revision. If false, the blob data in the current head revision is replaced. If true or not set, a new blob is created as head revision..."이고, 비교표에서 v3 쪽은 "n/a"다. (출처: [v2 files.update](https://developers.google.com/workspace/drive/api/reference/rest/v2/files/update), [v2 to v3 reference](https://developers.google.com/workspace/drive/api/guides/v2-to-v3-reference))
- 「문서에 없음」 appdata 안내서는 리비전을 언급하지 않는다. `drive.appdata` 범위만으로 리비전을 나열하고 내려받고 지울 수 있는지도 적혀 있지 않다. (출처: [appdata 안내서](https://developers.google.com/workspace/drive/api/guides/appdata))

### 추론
- v3에는 `newRevision`이 없으므로 내용을 올릴 때마다 새 머리 리비전이 생길 것으로 보인다(v2의 기본 동작이 그렇고 v3에 그 선택지가 사라졌다). 동기화가 잦으면 표시 안 한 리비전 100개에 빨리 이르고, 오래된 것은 30일보다 먼저 지워질 수 있다.
- 문서대로라면 표시 안 한 리비전은 내려받을 수 없으므로, 기준본으로 쓸 리비전은 올리는 순간에 `keepRevisionForever=true`로 표시해야 한다. 그다음 기준본이 바뀔 때마다 이전 기준본을 지워 200개 상한과 저장 용량을 지켜야 한다.
- 이렇게 하면 각 기기가 자기가 마지막으로 맞춘 리비전 ID를 저장해 두고, 다음 동기화에서 그 리비전을 내려받아 3자 병합(기준본, 내 것, 서버 것)의 기준으로 쓸 수 있다. 리비전 목록이 시간순이므로, 내 기준본 뒤에 리비전이 둘 이상 생겼으면 다른 기기가 그사이에 썼다는 신호로 읽을 수 있다. 이것은 막기가 아니라 나중에 알아채기다.

### 남은 공백
- 「Keep Forever」가 아닌 리비전을 실제로 내려받으면 거절되는지 시험하지 못했다.
- appDataFolder 파일에서 리비전이 같은 규칙으로 보관되는지, `drive.appdata` 범위로 리비전 API를 부를 수 있는지 직접 확인하지 못했다.
- `Revision.modifiedTime`이 서버 시각인지, 파일의 `modifiedTime`을 클라이언트가 덮어쓰면 리비전 시각도 바뀌는지는 문서에 없다.

## 3. 조건부 요청(`If-Match`, `If-None-Match`, 412, 304)

### 요점
v3 참조와 안내서 어디에도 `If-Match`, `If-None-Match`, 412, 304가 나오지 않는다. 그래서 `files.update` 업로드에서 `If-Match`가 원자적 비교 후 교체(값이 같을 때만 쓰기)로 동작한다는 보장은 없다. 2026-01 보고는 v3 업로드 PATCH의 `If-Match`가 무시된다고 하고, v2는 2014년 보고에서 412 `conditionNotMet`을 돌려줬다. 앱이 지금 쓰는 `If-Match` 보호는 실제로 아무것도 막지 않을 수 있으니 시험이 필요하다.

### 출처가 있는 사실
- 직접 확인: 다음 v3 문서의 본문을 「etag」, 「If-Match」, 「If-None-Match」, 「412」, 「precondition」, 「conditional」, 「304」, 「not modified」로 찾았다. files, files.get, files.update, revisions, revisions.list, changes.list 참조와 manage-revisions, appdata, performance, manage-changes, about-changes, change-overview, handle-errors, manage-uploads, manage-downloads, about-files, fields-parameter, limits, push, migrate-to-v3, v3versusv2 안내서다. 맞은 곳은 비교표의 「n/a」 행들과 성능 안내서의 한 문장뿐이다.
- 「문서화됨」 성능 안내서의 그 문장은 조건문이다: "If ETags are used by the API, the server updates ETag values when it successfully processes a patch request, just as it does with PUT." 같은 페이지 머리말은 "In some cases, examples from other APIs or generic APIs are used to illustrate the ideas presented."라고 적는다. (출처: [performance 안내서](https://developers.google.com/workspace/drive/api/guides/performance))
- 「문서화됨」 오류 안내서는 400, 401, 403, 404, 429, 500-504만 다룬다. 412와 304는 없다. (출처: [handle-errors 안내서](https://developers.google.com/workspace/drive/api/guides/handle-errors))
- 「문서화됨」 Google이 만든 Go 클라이언트의 `FilesGetCall.IfNoneMatch`: "IfNoneMatch sets an optional parameter which makes the operation fail if the object's ETag matches the given value. This is useful for getting updates only after the object has changed since the last request." 304 판별 함수 `googleapi.IsNotModified`도 있다. 같은 생성 코드 `drive-gen.go`에 「If-None-Match」는 28번, 「If-Match」는 0번 나온다(직접 세었다). 이 기능은 모든 GET 호출에 생성기가 똑같이 넣는 것이라 Drive가 따로 약속한 동작으로 읽기 어렵다. (출처: [pkg.go.dev drive/v3](https://pkg.go.dev/google.golang.org/api/drive/v3), [drive-gen.go](https://github.com/googleapis/google-api-go-client/blob/main/drive/v3/drive-gen.go))
- 「다른 사람의 관찰」 2015년 Go 클라이언트 이슈에서 보고자는 "all APIs already return an etag in the response header"라고 적었고, Google 측 관리자(gmlewis)가 `If-None-Match` 지원을 넣었다. 오래된 보고다. (출처: [google-api-go-client 이슈 #86](https://github.com/googleapis/google-api-go-client/issues/86))
- 「다른 사람의 관찰」 2026-01-11 질문(Eric Zinda): 임의의 값으로 `If-Match`를 붙여 `PATCH https://www.googleapis.com/upload/drive/v3/files/$FILE_ID?uploadType=media`를 보냈더니 "I don't get a 412 or anything that indicates a precondition check (it behaves like the header is ignored, or there's no ETag to check against)." `DELETE`도 같았다. 본인 답(2026-01-13)은 "there is no (server enforced) way to... abort an edit/delete if the file changed out from under you since your last read"라고 결론짓는다. 다른 답은 없다. (출처: [Stack Overflow 79865579](https://stackoverflow.com/questions/79865579/is-raceless-optimistic-concurrency-possible-in-google-drive-v3-interface))
- 「다른 사람의 관찰」 2014년 v2 사용자: `If-Match`에 파일의 `etag`를 넣고 갱신하면 그사이 바뀐 경우 "412 Precondition Failed"와 `"location": "If-Match"`, `"reason": "conditionNotMet"`이 왔다. (출처: [Stack Overflow 21793871](https://stackoverflow.com/questions/21793871/detect-conflict-when-uploading-document-to-google-drive))
- 「다른 사람의 관찰」 gogcli PR은 "Drive v3 does not expose the file ETag needed for an atomic `If-Match` precondition"이라 보고 조건부 교체만 v2로 보낸다("The Drive v2 media update uses HTTP `PUT` rather than the v3 `PATCH`"). 다만 실제 서버에서 412를 일으킨 것은 아니다: "reliably inducing the post-GET HTTP 412 race requires coordinating a concurrent write". 412 처리는 단위 시험으로만 확인했다. (출처: [openclaw/gogcli PR #929](https://github.com/openclaw/gogcli/pull/929))
- 「다른 사람의 관찰」 다른 설계 이슈는 "Community reports say If-Match is ignored on v3 and still enforced (412) on the v2 endpoint."라고 적고 "Unverified by us."를 붙였다. 근거는 위 Stack Overflow 79865579다. (출처: [rain-ventures-ai/keeptrack 이슈 #43](https://github.com/rain-ventures-ai/keeptrack/issues/43))
- 「문서화됨」 v2는 아직 문서가 유지된다. 비교 안내서: "Use the current version unless you need the v2 collection." 폐지 일정은 찾은 문서에 없다. (출처: [v3versusv2](https://developers.google.com/workspace/drive/api/guides/v3versusv2))
- 「직접 관찰」 CORS 사전 요청(preflight, 브라우저가 본 요청 전에 보내는 확인 요청): `OPTIONS https://www.googleapis.com/upload/drive/v3/files/abc?uploadType=media`에 `Access-Control-Request-Method: PATCH`, `Access-Control-Request-Headers: authorization,content-type,if-match`를 보내니 200과 `access-control-allow-headers: authorization,content-type,if-match`, `access-control-allow-methods: DELETE,GET,HEAD,OPTIONS,PATCH,POST,PUT`, `access-control-max-age: 3600`이 왔다. `GET .../drive/v3/files/abc?alt=media`에 `if-none-match`를 요청해도 같았다. 서버가 요청한 헤더 이름을 그대로 돌려주는 방식으로 보인다.
- 「문서에 없음」 다운로드(`alt=media`) 응답의 ETag와 메타데이터 응답의 ETag가 같은지, 약한 ETag(`W/` 접두어)를 쓰는지, `If-None-Match`가 304를 돌려주는지는 Drive 문서에 없다.
- 「문서화됨」(MDN) ETag는 CORS 기본 허용 응답 헤더가 아니다. 기본 목록은 `Cache-Control`, `Content-Language`, `Content-Length`, `Content-Type`, `Expires`, `Last-Modified`, `Pragma`이고, 나머지는 서버가 `Access-Control-Expose-Headers`에 넣어야 스크립트가 읽는다. (출처: [MDN CORS-safelisted response header](https://developer.mozilla.org/en-US/docs/Glossary/CORS-safelisted_response_header))

### 추론
- 사전 요청이 `if-match`를 허락한다는 것은 브라우저가 헤더를 보낼 수 있다는 뜻일 뿐, 서버가 그 값을 검사한다는 뜻은 아니다.
- 앱이 업로드에서 412를 받아 본 적이 없다면, 헤더가 무시된다는 2026-01 보고와 맞는다. 확인하는 가장 짧은 방법은 일부러 틀린 `If-Match` 값(예: `"x"`)으로 `sync.json`을 올려 보고 200이 오는지 412가 오는지 보는 것이다. `uploadType=media`와 `uploadType=multipart`를 둘 다 시험해야 한다.
- 앱이 다운로드 응답에서 ETag를 읽고 있다면, 그 ETag는 다운로드 서버가 내용에서 만든 값일 수 있다. 그 경우 `If-None-Match`와 304는 캐시 절약으로는 동작할 수 있어도, 업로드의 `If-Match`가 같은 값을 검사한다는 근거는 되지 않는다.
- 문서로 보장된 v3의 원자적 비교 후 교체는 없다. 남는 길은 (가) 문서상 아직 유지되는 v2 엔드포인트의 `etag`와 `If-Match`(2026년에 동작하는지 미확인, 브라우저 CORS도 미확인), (나) `version`과 리비전 목록으로 쓰기 뒤에 충돌을 알아채기, (다) 자체 잠금 서버다.

### 남은 공백
- 인증된 요청으로 v3 업로드 PATCH와 multipart의 `If-Match`를 시험하지 못했다.
- 2026년 현재 v2 `files.update`가 `If-Match`에 412를 돌려주는지, 브라우저에서 v2 업로드 엔드포인트를 CORS로 부를 수 있는지 확인하지 못했다.
- Google Issue Tracker에서 v3 조건부 요청을 다룬 항목은 찾지 못했다.

## 4. HTTP `Date` 응답 헤더를 브라우저에서 읽을 수 있는가

### 요점
Drive 문서에는 CORS로 어떤 응답 헤더를 노출하는지 적혀 있지 않다. 직접 관찰로는 인증 없는 오류 응답에서 `date`가 메타데이터 호스트와 업로드 호스트 모두 `Access-Control-Expose-Headers`에 들어 있었다. 인증된 200 응답은 토큰이 없어 보지 못했다. `Date`는 초 단위다.

### 출처가 있는 사실
- 「문서화됨」(MDN) `Date`는 CORS 기본 허용 응답 헤더 목록에 없으므로 서버가 노출해야 읽을 수 있다. (출처: [MDN CORS-safelisted response header](https://developer.mozilla.org/en-US/docs/Glossary/CORS-safelisted_response_header))
- 「문서에 없음」 Drive 참조, 안내서, 디스커버리 문서 어디에도 `Access-Control-Expose-Headers`나 `Date` 헤더를 다룬 문장이 없다.
- 「직접 관찰」 모두 `Origin: https://example.org`을 붙였고, 응답의 `access-control-allow-origin`은 그 값을 그대로 돌려줬다.
  - `GET https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id)`, 인증 없음: 403, `access-control-expose-headers: content-encoding,date,server,content-length,vary,vary,vary`.
  - `GET https://www.googleapis.com/drive/v3/files/abc?alt=media`, 가짜 토큰: 401, `www-authenticate,content-encoding,date,server,content-length,vary,vary,vary`.
  - `GET https://www.googleapis.com/drive/v3/changes/startPageToken`, 인증 없음: 401, 위와 같은 목록.
  - `PATCH https://www.googleapis.com/upload/drive/v3/files/abc?uploadType=media`, 인증 없음: 401, `Content-Length, Date, Server, Transfer-Encoding, X-GUploader-UploadID, X-Google-Trace, date, server, vary, www-authenticate`.
  - `POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`, 인증 없음: 401, 바로 위와 같은 목록.
  - `GET https://content.googleapis.com/drive/v3/files?spaces=appDataFolder`: 403, 첫 줄과 같은 목록.
  - 비교용으로 같은 앞단의 디스커버리 문서 200 응답도 `content-encoding,date,server,content-length,vary,vary,vary`였다. Books API 429 응답은 `x-frame-options`, `x-content-type-options`를 실어 보냈지만 노출 목록에는 넣지 않았다.
- 「다른 사람의 관찰」 2026-01 질문자는 "To eliminate CORS issues, I tested in curl"이라 적어 브라우저 노출은 다루지 않았다. (출처: [Stack Overflow 79865579](https://stackoverflow.com/questions/79865579/is-raceless-optimistic-concurrency-possible-in-google-drive-v3-interface))
- 「문서화됨」(HTTP 표준, 이 조사에서 원문을 다시 열지 않은 기억 기반 인용) `Date`는 메시지를 만든 시각이고 형식은 `Sun, 06 Nov 1994 08:49:37 GMT`처럼 초 단위다. (출처: [RFC 9110 §6.6.1 Date](https://www.rfc-editor.org/rfc/rfc9110#section-6.6.1), [RFC 9110 §5.6.7](https://www.rfc-editor.org/rfc/rfc9110#section-5.6.7))
- 「문서화됨」 Google 서버 시각은 윤초 때 번진 시각(leap smear)이다: "The leap smear applies to all Google services, including all our APIs." "Smeared time briefly deviates from UTC during the smear period but realigns after 24 hours." (출처: [Google Public NTP Leap Smear](https://developers.google.com/time/smear))

### 추론
- 메타데이터 호스트의 노출 목록은 그 응답에 실제로 있는 헤더로 만드는 것으로 보인다(`vary`가 세 번 들어가고, `www-authenticate`는 401일 때만 들어간다). 그러나 모든 헤더를 넣지는 않는다(Books 429의 `x-frame-options`). 그래서 인증된 200 응답에 `ETag`가 있을 때 그것이 노출되는지는 이 관찰로 알 수 없다. 반면 `date`는 두 호스트, 2xx와 4xx, 서로 다른 API에서 빠짐없이 들어 있었으므로 인증된 응답에도 있을 가능성이 높다. 확인은 필요하다.
- 앱이 지금 다운로드 응답에서 `response.headers.get('ETag')`로 값을 읽고 있다면, 인증된 응답의 노출 목록에 `etag`가 들어 있다는 직접 증거가 된다. 같은 방법으로 `Date`도 앱 안에서 바로 확인할 수 있다.
- `Date`로 기기 시계의 어긋남을 재려면, 요청 직전 시각 t0과 응답 직후 시각 t1을 재고 `Date - (t0 + t1) / 2`를 어긋남으로 잡는다. 오차는 왕복 시간의 절반에 1초(초 단위 절삭)를 더한 만큼이다.
- 브라우저 HTTP 캐시나 서비스 워커 캐시에서 나온 응답은 처음 받은 때의 `Date`를 그대로 가진다. 시계로 쓰는 요청은 캐시를 거치지 않게(`cache: 'no-store'`) 보내야 한다. Drive의 인증된 응답이 어떤 `Cache-Control`을 붙이는지는 보지 못했다.
- `Date`는 앞단 서버가 응답을 만든 시각이지 파일이 저장된 시각이 아니다. 파일 단위 순서에는 `version`이 맞고, `Date`는 기기 시각을 고치는 데 맞다.

### 남은 공백
- 인증된 200, 304, 412 응답의 `Access-Control-Expose-Headers`를 보지 못했다.
- Google이 이 노출 목록을 문서로 약속한 곳은 찾지 못했다. 언제든 바뀔 수 있는 동작으로 다뤄야 한다.

## 5. 변경 목록 API(`changes.getStartPageToken`, `changes.list`)

### 요점
변경 목록은 사용자마다 서버가 시간순으로 쌓는 기록이고 페이지 토큰은 만료되지 않는다. `spaces=appDataFolder`로 이 앱의 숨은 폴더 변경만 볼 수 있다. 그러나 파일마다 가장 최근 항목 하나만 남으므로 쓰기 하나하나의 순서를 남기지 않는다. 「지난번 이후 바뀌었나」를 묻는 표시로는 쓸 수 있지만 레코드 단위 시계는 되지 못한다.

### 출처가 있는 사실
- 「문서화됨」 "Entries in the changes collection are in chronological order (the oldest changes appear first)." (출처: [manage-changes 안내서](https://developers.google.com/workspace/drive/api/guides/manage-changes))
- 「문서화됨」 "A change log entry indicates the user who made the change, the timestamp, and an ID. There can only be one entry per file or shared drive in the change log at a time. Each time that file or shared drive changes, a new ID is created for that entry, and it replaces the previous entry." (출처: [change-overview](https://developers.google.com/workspace/drive/api/guides/change-overview))
- 「문서화됨」 "A change does not provide a delta between revisions." "individual change entries may be invalidated and replaced with a newer change entry for the corresponding item." (출처: [about-changes](https://developers.google.com/workspace/drive/api/guides/about-changes))
- 「문서화됨」 `Change.time`: "The time of this change (RFC 3339 date-time)." `Change.file`: "The updated state of the file." (출처: [디스커버리 문서](https://www.googleapis.com/discovery/v1/apis/drive/v3/rest))
- 「문서화됨」 `startPageToken`과 `nextPageToken`, `newStartPageToken`: "The page token doesn't expire." `newStartPageToken`은 "present only if the end of the current changes list has been reached." (출처: [디스커버리 문서](https://www.googleapis.com/discovery/v1/apis/drive/v3/rest), [changes.list 참조](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes/list))
- 「문서화됨」 `changes.list`의 `spaces`: "Supported values are 'drive' and 'appDataFolder'." 기본값은 `drive`다. `restrictToMyDrive`는 "omits changes to files such as those in the Application Data folder"다. (출처: [디스커버리 문서](https://www.googleapis.com/discovery/v1/apis/drive/v3/rest))
- 「문서화됨」 v3에서 앱 데이터는 기본으로 나오지 않는다: "In v3, you set the drive.appdata scope, and also set the query parameter spaces=appDataFolder to request" 앱 데이터. (출처: [v3versusv2](https://developers.google.com/workspace/drive/api/guides/v3versusv2))
- 「문서화됨」 `changes.getStartPageToken`에는 `spaces` 매개변수가 없다(`supportsAllDrives`, `driveId`와 폐지된 `teamDriveId`, `supportsTeamDrives`뿐). Google의 Node 예제는 이 호출에 `drive.appdata` 범위를 쓴다. (출처: [디스커버리 문서](https://www.googleapis.com/discovery/v1/apis/drive/v3/rest), [manage-changes 안내서](https://developers.google.com/workspace/drive/api/guides/manage-changes))
- 「문서화됨」 변경 알림(`changes.watch`)은 앱의 HTTPS 수신 서버가 있어야 한다: "This is an HTTPS server that handles the API notification messages", "there's a valid SSL certificate installed on your web server". 알림의 `X-Goog-Message-Number`는 채널마다 커지는 정수다. (출처: [push 안내서](https://developers.google.com/workspace/drive/api/guides/push))
- 「문서에 없음」 페이지 토큰의 형식과, 두 토큰을 비교해 앞뒤를 정할 수 있는지는 적혀 있지 않다.
- 「문서화됨」 폐지된 것: `changes.list`의 `includeTeamDriveItems`, `teamDriveId`, `supportsTeamDrives`와 `Change`의 `type`, `teamDriveId`, `teamDrive`. (출처: [디스커버리 문서](https://www.googleapis.com/discovery/v1/apis/drive/v3/rest))

### 추론
- 파일이 `sync.json` 하나라면, 저장해 둔 토큰으로 `changes.list?spaces=appDataFolder&fields=newStartPageToken,nextPageToken,changes(fileId,time,file(version,modifiedTime,md5Checksum))`를 부르는 것은 `files.get`으로 `version`을 묻는 것과 얻는 정보가 거의 같다. 순서 정보로는 `version`보다 나은 점이 없다.
- 항목이 파일마다 하나로 합쳐지므로, 두 기기가 짧은 사이에 연달아 쓴 경우 변경 목록만으로는 중간 쓰기를 알 수 없다. 중간 쓰기를 보려면 리비전 목록이 필요하다.
- `Change.time`은 서버가 매긴 시각으로 보이지만 문서가 그렇다고 명시하지는 않는다.
- 앱에는 알림을 받을 서버가 없으므로 `changes.watch`는 쓸 수 없다.

### 남은 공백
- `getStartPageToken`이 준 토큰으로 `spaces=appDataFolder` 변경을 빠짐없이 받는지 직접 시험하지 못했다.

## 6. 시계 어긋남과 appDataFolder 동시 쓰기에 대한 Google의 안내

### 요점
Drive 문서에는 클라이언트 시계 어긋남이나 appDataFolder 동시 쓰기 제어를 다룬 안내가 없다. 관련된 Google 문서는 모든 Google API가 번진 시각(leap smear)을 쓴다는 것뿐이다. appDataFolder는 그 앱만 읽고 쓰므로, 경쟁하는 쓰기는 같은 사용자의 다른 기기나 다른 탭에서만 온다.

### 출처가 있는 사실
- 「문서에 없음」 developers.google.com과 cloud.google.com에서 Drive의 시계 어긋남 안내를 찾았지만 나오지 않았다. 검색에 나온 시계 이야기는 서비스 계정 JWT의 `iat`와 `exp` 검사였고, 브라우저 OAuth 앱과는 관계가 없다(검색 요약으로만 보았다). (출처: [서비스 계정 OAuth](https://developers.google.com/identity/protocols/oauth2/service-account))
- 「문서화됨」 "The leap smear applies to all Google services, including all our APIs." "Google's recommended leap smear standard is a 24-hour linear smear from noon to noon UTC". (출처: [Google Public NTP Leap Smear](https://developers.google.com/time/smear))
- 「문서화됨」 appDataFolder: "This folder is only accessible by your app and its contents are hidden from the user and from other Google Drive apps." "Only the application that created the data in the appDataFolder can access it." 공유, 공간 사이 이동, 휴지통 보내기는 `notSupportedForAppDataFolderFiles` 오류가 난다. (출처: [appdata 안내서](https://developers.google.com/workspace/drive/api/guides/appdata))
- 「문서화됨」 "Files cannot move between spaces." (출처: [about-files](https://developers.google.com/workspace/drive/api/guides/about-files))
- 「다른 사람의 관찰」 2026-01 본인 답은 Drive에 서버가 강제하는 잠금, 「그사이 바뀌었으면 중단」, 여러 작업 묶음(트랜잭션)이 없다고 보고, 대안으로 별도 잠금 서버나 리비전을 이용한 사후 감지를 든다: "The best you can do is a "best-effort" attempt to use their revisions api after the fact to see that it happened and create conflict files or try to merge the changes." (출처: [Stack Overflow 79865579](https://stackoverflow.com/questions/79865579/is-raceless-optimistic-concurrency-possible-in-google-drive-v3-interface))
- 「다른 사람의 관찰」 "The best Drive supports is read-then-compare-then-upload, which is still racy: another writer can land between the compare and the upload." (출처: [gasizdat/GT4 이슈 #407](https://github.com/gasizdat/GT4/issues/407))

### 추론
- 서버가 정한 값만으로 순서를 세우려면 파일 단위로는 `version`, 쓰기 단위로는 리비전 ID와 그 시간순 목록, 기기 시각 보정에는 `Date` 헤더를 쓰는 조합이 된다. 셋 다 레코드 하나하나에 서버 시각을 주지는 않으므로, 레코드의 시각은 기기 시계에 `Date`로 잰 어긋남을 더하는 방식이나 논리 시계(서버 `version`을 기준값으로 삼는 방식) 쪽에서 찾아야 한다. 이 부분은 다른 조사 범위다.
- leap smear로 서버 시각은 윤초 날 하루 동안 UTC와 1초 미만 차이가 날 수 있다. `Date`가 초 단위라 실제 영향은 작다.

### 남은 공백
- Google이 appDataFolder 동기화의 동시성 제어를 권하는 문서나 Google 직원의 답은 찾지 못했다.
