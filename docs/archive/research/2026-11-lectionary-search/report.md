# 전례독서 검색: 웹 조사 보고서 (2026-11-15)

deep-research 워크플로가 만든 보고서를 옮겨 적었다. 검색 각도 다섯, 받은 원문 21개, 뽑은 주장 45개 가운데 25개를 반박 검증(주장마다 세 번 투표, 둘 이상이 반박하면 버림)에 넣어 20개가 남고 5개가 반박되었다. 남은 주장은 합성 단계에서 12개로 묶었다. 낱말은 보고서의 것을 그대로 두고, 앱의 파일 경로만 저장소 기준으로 고쳤다.

## 요약

검증을 통과한 근거는 이미 있는 설계서(`docs/design/lectionary-search.md`)의 큰 방향을 대부분 뒷받침한다. 판별은 구절, 날짜, 기간, 이름의 차례로 한다. 구절은 겹치면 맞추고 장만 친 질의는 장 전체로 펼친다. 기간은 교회력 엔진으로 펼쳐 메인 스레드에서 거른다. 이름은 직접 만든 정규화로 찾는다. 1차 출처들도 같은 방식을 쓴다. 기간 질의는 romcal, romcal-api, pylect 세 곳 모두 미리 계산한 날짜 표 없이 「(연도, 기간 키)를 엔진으로 펼친 뒤 거르는」 방식이다. 상대 날짜는 정해 둔 낱말 몇 개만 받는다. 날짜 없는 전례일의 다음 날짜는 우선순위까지 계산해야 정확하다(romcal은 연중 12주일이 그해 다른 축일에 밀려 오지 않으면 null을 돌려준다). 구절 질의에는 겹침이 기본이고 포함은 엄격 모드로 두는 라이브러리 사례가 있다. 구절 판별을 느슨하게 하면 자유 텍스트를 구절로 잘못 읽는다는 경고도 있다. 이 합성 단계에서 앱의 실데이터로 확인해 보니, 지금의 구절 판별(`REF_RE`와 책 별칭)로는 전례일 제목, 라벨, 별칭 1,240여 개 가운데 구절로 읽히는 것이 하나도 없었다. 그러니 구절 판별을 먼저 하되 지금처럼 엄격하게 두는 것이 맞다. 초성 검색은 라이브러리 없이 수십 줄로 만들 수 있지만 수요의 근거는 찾지 못했다. 기존 전례독서 사이트와 앱의 검색 사례(조사 질문 1)와 검색 UX, 접근성(조사 질문 5)은 검증을 통과한 주장이 없다. 그래서 그 부분의 권장은 앱이 이미 쓰는 방식에 기댄다.

## 발견

「신뢰도」와 「투표」는 워크플로가 매긴 값이다. 투표 `3-0`은 검증 셋이 모두 주장을 받아들였다는 뜻이다.

### 1. 구절 판별은 이름 검색보다 먼저 하되, 「알려진 책 이름과 숫자로만 된 나머지」가 검색어 전체와 맞을 때만 구절로 읽는 지금의 엄격한 판별을 유지해야 한다. 성서 구절 파서는 검색창용으로 공격적으로 해석하도록 만들어져 있어, 그 방식을 그대로 따라 하면 이름 검색을 가로챈다.

- 신뢰도: 중간, 투표: 3-0, 3-0(주장 15, 16)
- 출처: <https://github.com/openbibleinfo/Bible-Passage-Reference-Parser>, `js/search-worker.js`, `데이터 저장소 lectionary/search-lectionary.json`, `데이터 저장소 search-meta.json`

openbibleinfo README는 이 파서가 검색어 해석용이라 공격적이며 자유 텍스트를 넣으면 거짓 양성이 나온다고 인정한다(「she is 2 cool」의 「is 2」를 Isa.2로 읽는다). 「Matt 1, 3」의 두 해석(1장과 3장, 또는 1장 3절)은 규칙만으로 풀기 어렵다고 쓴다. 「Psalm 123-24」를 Ps.123-124로 고쳐 읽는 범위 보정도 스스로 과할 수 있다고 적는다. 장이 하나뿐인 책의 「Jude 1」은 기본값에서 책 전체로 읽는데, 검색창 사용자가 거의 늘 그것을 원하기 때문이라고 한다. 이 합성 단계에서 앱의 판별 규칙(`js/search-worker.js`의 `REF_RE`와 `tryVerseRef`, `search-meta.json`의 책 별칭)을 색인의 제목, 라벨, 별칭 1,247개에 직접 돌려 보았다. 구절로 읽힌 이름은 0개였다. 다만 첫 낱말이 책 약칭인 이름이 있다(「사도 …」, 「요한 …」). 그래서 판별 조건을 넓히면(책 이름만 맞아도 구절로 보거나 숫자 앞의 낱말을 건너뛰면) 바로 충돌한다. 「마태 1, 3」은 앱이 이미 장 목록으로 읽는다(`REF_CHAPTERS`). 작은 빈 곳도 하나 있다. 장이 하나뿐인 책 가운데 필레몬서, 요한2서, 요한3서, 유다서가 색인에 8행 있는데, 지금 규칙은 「유다 3」을 3장으로 읽어 결과가 0건이 된다. 1장 3절로 읽는 규칙을 검토할 만하다.

### 2. 구절 질의는 한 절이라도 겹치면 맞추고(겹침), 독서가 검색어를 모두 담는 경우(포함)는 정렬의 첫 단으로 쓴다. 겹침을 기본, 포함을 엄격 모드로 두는 라이브러리 설계가 이 방식을 뒷받침한다.

- 신뢰도: 중간, 투표: 3-0(주장 4)
- 출처: <https://www.npmjs.com/package/bible-reference-range>, `docs/design/lectionary-search.md`

bible-reference-range 1.1.1의 `doesReferenceContain(refToSearch, refSearchTerm, strict = false)`가 이렇게 동작한다. 기본(strict false)에서는 검색어의 조각 하나라도 범위와 겹치면 참이고, 두 범위가 완전히 떨어져 있을 때만 거짓이다. strict에서는 검색 범위 전체가 들어 있어야 참이다. 패키지의 테스트도 같다. 「3:12-24」와 「3:1-17」은 느슨한 모드에서 참, 엄격한 모드에서 거짓이다. 설계서 §5.1의 실측도 같은 방향이다. 「요한 3:14-21」은 포함으로 1건, 겹침으로 7건이다. 영어 성경의 절 번호로 친 「이사 9:2-7」은 포함으로 0건, 겹침으로 4건이다. 그러므로 맞추기는 겹침으로 하고, 엄격 모드에 해당하는 결과(검색어를 모두 담는 독서)를 맨 앞에 두는 설계서의 정렬이 맞다. 근거가 작은 라이브러리 하나여서 「업계 관행」이라고까지 말할 수는 없다.

### 3. 장만 친 질의는 그 장 전체 구간으로 펼쳐 겹침을 본다. 이때 장의 절 수는 외부 파서의 표가 아니라 앱 자체 데이터에서 얻어야 한다. 반절 표시(상, 하, a, b)는 지우고 절 전체로 본다.

- 신뢰도: 중간, 투표: 2-1(주장 0), 3-0(주장 2, 3)
- 출처: <https://github.com/openbibleinfo/Bible-Passage-Reference-Parser>, <https://www.npmjs.com/package/bible-reference-range>, <https://github.com/educational-resources-and-services/bibletags-versification>, `js/search-worker.js`, `데이터 저장소 books.json`

openbibleinfo 파서는 `osis_compaction_strategy: 'bcv'`에서 「Gen.1」을 「Gen.1.1-Gen.1.31」로 펼친다. 장별 절 수는 `translation_info()`의 `chapters`에서 온다. 그런데 이 표는 ESV 계열 절 번호 체계를 쓰고, 제2경전은 `include_apocrypha(true)`를 켜야 읽는다. 공동번역의 절 수와 다를 수 있다. 앱은 장의 끝을 표시값 999(`REF_CHAPTER_END`)로 두므로 겹침을 보는 데는 절 수가 필요 없다. 그러나 설계서의 「검색어를 모두 담는 독서를 먼저」 정렬은 장만 친 질의에서 실제 마지막 절 번호가 있어야 한다. 지금 `books.json`에는 장 수만, `search-meta.json`에는 책 이름만 있다. 그래서 색인에 71권의 장별 마지막 절 번호를 더하거나, 장만 친 질의에서는 포함 단을 빼고 겹친 절 수와 전례년 순서로만 정렬해야 한다. 반절은 이렇다. bible-reference-range는 절 표기를 `parseInt`로 읽어 「2:4b-5a」를 4-5절로 줄이고, 자료 구조에도 반절 칸이 없다. bibletags는 더 세밀하게 「BBCCCVVV:W1-W2」처럼 단어 번호 구간을 쓰지만, 단어 번호가 특정 본문의 단어 나누기에 묶여 있어 검색에는 맞지 않는다. 앱의 ADR-005 규칙(상, 하, ㄱ, ㄴ, 로마자 소문자를 지운다)이 앞의 방식과 같다. 반절 경계 표(`half-verses.json`)는 화면 표시에만 쓰면 된다. 「bcvp 압축 방식이 a/b를 「!」 뒤에 남긴다」는 주장은 반박되었으므로 그 기능에 기대지 않는다.

### 4. 절 번호 체계의 차이(전례시편과 성서 시편, 영어 성경의 절 번호)는 「기본 체계와 예외 표」 방식으로 다룰 수 있다. 다만 지금 데이터에서는 겹침만으로 대부분 흡수되므로, 예외 표는 실제 누락이 확인될 때 더한다. 색인의 구간 행은 지금의 장별 행으로 충분하고, 더할 것은 독서 자리 칸이다.

- 신뢰도: 중간, 투표: 3-0(주장 1, 16, 18, 19)
- 출처: <https://github.com/educational-resources-and-services/bibletags-versification>, <https://github.com/openbibleinfo/Bible-Passage-Reference-Parser>, `데이터 저장소 lectionary/search-lectionary.json`, `docs/design/lectionary-search.md`

bibletags-versification은 번역본마다 절 번호 체계를 따로 정의하지 않는다. 몇 가지 기본 체계(KJV, LXX, Synodal, Vulgate)를 두고, 번역본마다 예외만 `extraVerseMappings`에 적는다. 범위 키에 정수를 주면 범위 안의 모든 절을 같은 수만큼 옮긴다(예: 「02012001-021: -1」). 여러 절을 한 단위로 인쇄한 경우(TLB의 요한 10:22-23)는 첫 절로 다루고 원문의 범위 전체에 잇는다. 이런 경우는 드물다고 전제한다. 위치는 고정 폭 문자열 BBCCCVVV(책, 장, 절을 0으로 채움)로 적어 문자열로도 정수로도 정렬된다. 다만 책 번호가 KJV 1-66이라 제2경전이 없어 앱은 자기 책 번호를 써야 한다. openbibleinfo는 `versification_system`(예: 시편에 불가타 번호를 쓰는 'vulgate')과 `ps151_strategy`로 시편 체계를 바꾼다. 앱에 대어 보면 이렇다. 전례시편과 성서 시편은 150편 가운데 147편이 마지막 절 번호가 같고, 72, 75, 113편만 하나씩 달라 겹침으로 맞는다(설계서 §2). 영어 절 번호로 친 「이사 9:2-7」도 겹침으로 4건을 찾는다. 반면 불가타 번호로 친 시편(10-147편이 하나씩 밀린다)은 겹침으로 고칠 수 없으니, 필요하면 질의에 적용하는 작은 예외 표가 답이다. 이 합성 단계에서 보니 지금 색인의 `cov` 3,899행은 모두 한 장 안의 구간이다(시작 절이 끝 절보다 큰 행이 0개). 그러므로 BBCCCVVV 같은 묶은 키가 없어도 정수 비교로 충분하다. 행이 4천 개 안쪽이라 선형 탐색이면 된다. 설계서 §8이 말하는 독서 자리 칸이 실제로 필요한 보완이다.

### 5. 기간 질의는 (연도, 기간 키)로 읽은 뒤 교회력 엔진으로 그 해를 펼쳐 기간에 드는 날을 거른다. 미리 계산한 날짜 표 없이 엔진으로 펼치는 것이 조사한 세 구현의 공통 방식이다.

- 신뢰도: 높음, 투표: 3-0(주장 5, 8, 13)
- 출처: <https://github.com/romcal/romcal>, <https://github.com/romcal/romcal-api>, <https://pypi.org/project/pylect>, `데이터 저장소 lectionary/periods.json`

romcal v3의 `generateCalendar(year)`는 {ISO 날짜: LiturgicalDay 배열}을 돌려준다. 배열의 첫 객체가 기본 전례일이고 나머지는 선택 기념일 같은 대안이다. romcal-api는 `GET /calendars/:name/:locale/:year/period/:period`에 고정된 기간 키를 받는다. 절기(advent, christmastide, ordinary-time, lent, easter-triduum, eastertide), 8일 축제와 성주간(christmas-octave, holy-week, easter-octave), 편의상 나눈 연중 시기(early-ordinary-time, later-ordinary-time)다. 모르는 키는 404를 돌려준다. 구현은 한 해 전체를 계산한 뒤 절기 키로 거르고, 8일 축제는 성탄과 부활에 7일을 더해 따로 처리한다. pylect는 구간의 날마다 `Lectionary(date)`를 불러 전례일을 모으고, 날짜 표가 없다. 앱 설계서 §6과 같다. 앵커(`yearAnchors`)와 기간 표(`spansOf`)로 구간을 정하고 날마다 `resolveDate`를 부른다(Node에서 365일 37ms). 한국어 키 표의 예는 「대림절」, 「성탄절, 성탄 시기」, 「성탄 8일」, 「사순절」, 「성주간」, 「성삼일」, 「부활절, 부활 시기」, 「부활 8일」, 「연중 시기」다. `periods.json`의 유일한 항목인 「그리스도인 일치를 위한 기도 주간」도 기간 키로 받을 수 있다. 표에 없는 말은 romcal-api의 404처럼 기간 카드를 내지 않고 이름 검색으로 넘긴다. 주의할 점도 있다. romcal v3는 베타(npm dev 태그)이고 romcal-api는 2025-08-24에 보관되어 더 고치지 않는다. 설계의 선례로만 쓴다.

### 6. 기간 질의의 「연도」는 양력 해와 교회력 해 가운데 무엇인지 정해야 한다. 조사한 구현은 둘을 모두 지원하되 양력 해를 기본으로 둔다. 앱은 「절기가 시작하는 날의 양력 해」로 읽고, 카드에 실제 날짜 구간을 보여 모호함을 덜어야 한다.

- 신뢰도: 높음, 투표: 3-0(주장 6, 8)
- 출처: <https://github.com/romcal/romcal>, <https://github.com/romcal/romcal-api>

romcal은 범위를 둘 둔다. 기본값 `scope: 'gregorian'`는 1월 1일부터 12월 31일까지다. `{ scope: 'liturgical' }`는 대림 1주일부터 연중 시기의 마지막 토요일까지로, 2030년이면 2029-12-02부터 2030-11-30까지다(이 합성 단계에서 날짜를 다시 계산해 맞는 것을 확인했다). romcal-api는 연도 자리에 YYYY(양력 해)와 YYYY-YYYY+1(교회력 해)을 받고, 다른 형식은 422로 거절한다. 앱에서 「2026년 대림절」은 양력 해로 읽으면 2026-11-29에 시작하는 대림이고, 교회력 2026년으로 읽으면 2025-11-30에 시작하는 대림이다. 설계서 §6.1의 「절기가 시작하는 날의 연도」는 romcal의 기본값과 같은 선택이다. 기간 카드에 「11월 29일부터 12월 24일까지」처럼 실제 구간과 앞뒤 해로 가는 링크를 두면 사용자가 뜻이 다른 경우를 바로 알아본다.

### 7. 상대 날짜는 일반 문법을 만들지 말고 닫힌 낱말 목록(어제, 오늘, 내일, 이번 주일, 다음 주일, 지난 주일)만 받는다. 기준 날짜는 기기의 지역 날짜다.

- 신뢰도: 중간, 투표: 3-0(주장 9, 14)
- 출처: <https://github.com/romcal/romcal-api>, <https://pypi.org/project/pylect>, `js/app/liturgical-engine.js`, `js/app/lectionary.js`

romcal-api의 상대 날짜는 yesterday, today, tomorrow 세 경로뿐이다. 각각 하루의 전례일을 돌려주고 「next Sunday」 같은 문법은 없다. 서버의 UTC 시계로 오늘을 정하고, 시간대 차이 처리는 로드맵에 미구현으로 남아 있다. pylect는 인자가 없으면 오늘부터 7일 뒤까지(양끝 포함 8일)를 보이는 고정 기본값만 있고, 상대 표현을 해석하지 않는다. 그러니 닫힌 목록이 선례와 맞고, 판별도 이름 검색과 겹치지 않는다. 시간대 문제는 앱이 이미 규칙으로 막고 있다. `js/app/liturgical-engine.js` 머리 주석이 `toISOString()`으로 날짜를 만들지 말라고 하고, `js/app/lectionary.js`에 지역 날짜 함수가 있다. 그 함수를 다시 쓴다. 출처에서 찾지 못한 것이 있다. 오늘이 주일일 때 「이번 주일」과 「다음 주일」이 각각 어느 날인지는 앱이 정해 설계서에 적어야 한다. 두 출처가 작은 프로젝트이고 「없다」는 것을 근거로 한 판단이라 중간 신뢰도로 둔다.

### 8. 날짜 없는 전례일(예: 연중 7주일 가해)에 「다음에 읽는 날」을 붙이려면 규칙만으로 명목상의 날짜를 계산하면 안 된다. 우선순위와 옮김까지 반영한 날별 계산(`resolveDate`)으로 훑어야 한다. 정의되어 있어도 그해에 오지 않는 전례일이 있기 때문이다.

- 신뢰도: 중간, 투표: 3-0(주장 7, 13)
- 출처: <https://github.com/romcal/romcal>, <https://pypi.org/project/pylect>, `docs/design/lectionary-search.md`

romcal의 `getOneLiturgicalDay(key)`는 정의에는 있으나 그해에 오지 않는 전례일이면 null을 돌려준다. 성능 때문에 기본으로는 한 해 전체를 계산하지 않아 우선순위 정보가 부정확할 수 있다고 README가 밝힌다. 그래서 `{ computeInWholeYear: true }`를 둔다. README의 예는 2022년의 `ordinary_time_12_sunday`다. 성체성혈 대축일이 우선해 null이 된다. 정의와 발생을 나누는 것이다(LiturgicalDayDef에는 날짜가 없다). pylect도 날마다 엔진을 불러 펼친다. 설계서 §7의 실측이 이 방식이 쓸 만한 비용임을 보인다. Node에서 3년을 훑는 데 74ms, 26년을 훑는 데 597ms가 걸렸다. 939개 세트 모두 2025-2050년 안에 오고, 427개는 다음 날짜가 1년보다 멀며, 가장 먼 것은 연중 7주일 가해(2035-05-20)다. 결과를 먼저 그리고 다음 날짜를 해마다 나눠 채우는 설계서의 방식이 맞다. 휴대폰 실측은 아직 없다.

### 9. 한국어 이름 검색은 직접 만든 정규화(공백, 가운뎃점, 「N주일」과 「제N주」 통일)와 비슷한 말 표로 충분하다. 초성 검색을 넣는다면 라이브러리 없이 수십 줄로 만들 수 있고, 검색어가 모두 홑자음(ㄱ-ㅎ)일 때만 실행하면 다른 판정과 부딪치지 않는다.

- 신뢰도: 높음, 투표: 3-0(주장 10, 11, 12)
- 출처: <https://github.com/toss/es-hangul>, <https://awesome.ecosyste.ms/projects/github.com%2Fbluewings%2Fkorean-regexp>, <https://unpkg.com/hangul-searcher@2.0.1/README.md>, `데이터 저장소 lectionary/search-lectionary.json`

es-hangul(2.4.0, MIT)의 `getChoseong`은 단어에서 초성을 뽑는다(「사과」에서 「ㅅㄱ」). README는 이것을 사용자가 친 초성과 비교하는 방식을 보인다. v2는 옛 `chosungIncludes`를 없애고 `getChoseong`과 `includes`를 함께 쓰게 했다. korean-regexp(1.0.13)의 `initialSearch`는 홑자음 하나를 그 자음으로 시작하는 588음절 범위의 문자 집합으로 바꾼다(「ㅊ」에서 [ㅊ차-칳]). 그래서 따로 초성 색인을 만들지 않고도 「ㅅㄹ」이 「성령」에 맞는다. 다만 연속한 글자만 맞추고, 같은 검색어를 옵션만 바꿔 부르면 이전 결과를 돌려주는 버그가 있으며, global 옵션에서는 `lastIndex`를 되돌려야 한다. hangul-searcher(코드 약 3KB, MIT)는 위 둘과 MiniSearch를 감싼 것이다. 문자열 배열을 받아 일치하면 문자열을, 그 밖에는 MiniSearch 객체를 돌려주어 반환 형식이 섞이고, ES2023 `toSorted()`가 있어야 돈다. 최신판은 2.0.2다. 세 라이브러리의 핵심은 「(글자 코드 - 0xAC00) / 588의 몫이 초성 번호」라는 계산 하나다. 그래서 이름 1천 개 안팎에는 직접 구현이 낫고, 런타임 라이브러리를 쓰지 않는 앱의 원칙(ADR-001, 설계서 §12)과도 맞는다. 이 합성 단계에서 확인해 보니 색인과 월별 축일 표 어디에도 홑자모가 없다. 그래서 「검색어가 모두 ㄱ-ㅎ이면 초성 검색」이라는 판정은 모호하지 않다. 공백을 무시하는 일은 라이브러리 옵션에 기대지 말고 직접 정규화한다. `ignoreSpace`와 `keepNonHangul`의 동작에 관한 주장은 반박되었다. 초성 검색이 필요하다는 사용자 근거는 찾지 못했으므로, 넣을지는 설계서의 미결 9로 남는다.

### 10. 구절 판별에는 외부 파서(openbibleinfo, 한 언어 약 30KB gzip)를 들이지 말고, 성서 본문 탭이 이미 쓰는 `tryVerseRef`를 검색 워커에서 그대로 함께 쓴다. 두 탭이 같은 규칙으로 구절을 읽어야 사용자의 기대가 어긋나지 않는다.

- 신뢰도: 중간, 투표: 3-0(주장 17, 12)
- 출처: <https://github.com/openbibleinfo/Bible-Passage-Reference-Parser>, <https://unpkg.com/hangul-searcher@2.0.1/README.md>, `js/search-worker.js`

openbibleinfo README에 따르면 한 언어의 코드는 압축 전 약 125KB(minified), gzip 후 약 30KB다. 짧은 문자열은 1밀리초 안에 처리하고, 한국어(ko)를 지원하며, 긴 문자열을 넘기면 메인 이벤트 루프를 막을 수 있다. 앱의 전례독서 색인 전체가 gzip으로 31KB이니, 파서를 들이면 내려받는 양이 두 배 가까이 된다. 얻는 것은 오타와 모호한 표기에 대한 공격적 해석인데, 이는 위의 첫 발견에서 본 대로 이름 검색과 충돌한다. 앱의 `tryVerseRef`는 공동번역 약칭(`search-meta.json`의 별칭), 반절 표시 지우기, 장을 넘는 구간, 쉼표 목록을 이미 다룬다. 외부 파서의 한국어 책 이름 표가 공동번역 약칭과 얼마나 맞는지는 확인하지 않았다(추정). hangul-searcher도 MiniSearch, es-hangul, korean-regexp를 함께 실어야 해 같은 이유로 맞지 않는다.

### 11. 결과는 「전례일」 카드 하나에 그 전례일의 독서 세트(주기, 트랙, 대안)를 담는 두 층으로 묶는다. 날짜나 기간 결과는 날짜별로 기본 전례일과 대안을 함께 보인다.

- 신뢰도: 낮음, 투표: 3-0(주장 5), 나머지는 앱 실측
- 출처: <https://github.com/romcal/romcal>, `데이터 저장소 lectionary/search-lectionary.json`, `docs/design/lectionary-search.md`

romcal은 한 날짜에 LiturgicalDay 배열을 두고 첫 것을 기본, 나머지를 대안(선택 기념일)으로 둔다. 날짜 결과의 묶음에 쓸 수 있는 선례다. 앱 색인의 `names` 939행은 독서 세트 단위이고, 같은 제목은 448개, 전례일로 묶으면 약 370개다(설계서 §2). 독서 세트 단위로 보이면 「대림1주」가 주기마다 세 번 나온다. 그래서 설계서 §4.2와 §8의 전례일과 독서 세트 두 층(`obs`, `sets`)이 맞다. 기존 전례독서 사이트(Vanderbilt RCL 성서 색인, 매일미사 등)가 결과를 어떻게 묶는지는 검증을 통과한 근거가 없다. 그래서 이 권장은 앱 자체 데이터와 romcal 하나에 기댄 낮은 신뢰도다.

### 12. 권장 판별 순서와 처리 위치는 다음과 같다. 빈 검색어면 예시를 보인다. 홑자음뿐이면 초성 이름 검색을 한다(채택 시, 워커). 엄격한 구절 표기면 겹침 탐색을 한다(워커). 날짜와 상대 날짜면 답 카드를 보이고 Enter로 바로 간다(메인). 기간 키가 있으면 기간 카드를 보이고 그 아래에 이름 결과를 둔다(메인과 워커). 그 밖은 정규화, 비슷한 말, 낱말 나누기로 이름을 찾는다(워커). 날짜와 기간, 다음에 읽는 날은 엔진이 있는 메인 스레드에서 해마다 나눠 계산한다.

- 신뢰도: 중간, 투표: 위 발견들의 종합
- 출처: <https://github.com/romcal/romcal>, <https://github.com/romcal/romcal-api>, <https://pypi.org/project/pylect>, <https://github.com/openbibleinfo/Bible-Passage-Reference-Parser>, `docs/design/lectionary-search.md`

구절과 이름, 초성은 색인 데이터만 있으면 되어 검색 워커에 둔다. 날짜와 기간은 교회력 엔진(`js/app/liturgical-engine.js`)이 있어야 계산되는데, 엔진은 메인 스레드 모듈이고 캘린더와 함께 늦게 받는다. 조사한 세 구현 모두 기간을 엔진으로 펼쳐 거르고, 그 비용은 한 절기에 수 ms다(설계서 §6.2). 그래서 워커에 엔진을 따로 실을 까닭이 없다. 메인은 검색어를 워커에 보내면서 같은 때에 날짜와 기간 판정을 하고 두 결과를 합친다. 「부활」처럼 절기 이름과 전례일 이름에 함께 쓰이는 말이 있으니, 판정을 하나만 내지 않고 답 카드 아래에 이름 목록을 두는 설계서 §3의 방식을 유지한다. 구절 판정이 앞서도 되는 근거는 첫 발견의 실측(이름 1,247개 가운데 구절로 읽히는 것 0개)이다. 다음에 읽는 날은 결과를 먼저 그린 뒤 해마다 나눠 채워 화면이 멈추지 않게 한다.

## 한계

조사 질문 1(Vanderbilt RCL 성서 색인, lectionarypage.net, textweek, Common Worship, USCCB, Universalis, iBreviary, Laudate, 매일미사, 굿뉴스, TEC와 ACNA 독서표의 검색 기능)과 조사 질문 5(질의 자동 판별과 명시적 필터, 결과 묶음, 빈 결과 안내, 결과 수 알림과 키보드 탐색 같은 WCAG 2.1 AA 사례)에는 검증을 통과한 주장이 하나도 없다. 그래서 결과 묶음과 화면에 관한 권장은 외부 근거가 아니라 앱이 이미 쓰는 방식(ADR-005 답 카드, 성서 검색의 결과 수 알림)과 앱 자체 데이터에 기댄다. 남은 근거는 대부분 소규모 프로젝트의 1차 출처(README와 코드) 하나씩이다. romcal v3는 베타(npm dev 태그, 3.0.0-dev.144)로 API가 바뀔 수 있다. romcal-api는 2025-08-24에 보관되었다. pylect는 개인 취미 도구다. 장만 친 질의를 펼치는 주장(주장 0)은 2-1로 갈렸다. 외부 라이브러리의 절 번호 체계(openbibleinfo의 ESV 기본, bibletags의 KJV 66권)는 공동번역 73권과 전례시편(`lps`), 송가(`cant`)에 그대로 맞지 않는다. 몇 가지 라이브러리 세부 동작에 관한 주장은 반박되었다. 바로 `getChoseong`의 숫자 처리, korean-regexp `ignoreSpace`의 띄어쓰기 무시, openbibleinfo bcvp의 반절 보존, hangul-searcher의 자모 분해 퍼지 효과다. 그래서 띄어쓰기 무시와 퍼지 일치는 라이브러리 옵션에 기대지 말고 직접 정규화해야 한다. 앱 쪽 수치 가운데 일부는 이 합성 단계에서 데이터 저장소 작업 사본으로 직접 확인했다. 구절로 읽히는 이름 0개, `cov` 행이 모두 한 장 안의 구간이라는 것, 단일 장 책 4권이 8행이라는 것, 홑자모가 없다는 것이다. 나머지 수치(37ms, 597ms 등)는 설계서가 Node에서 잰 값이라 휴대폰에서는 몇 배 느릴 수 있다. 비슷한 말(「바오로」와 「바울로」, 「종려주일」과 「성지주일」)의 범위에는 외부 근거가 없고, 설계서의 로컬 실측(52개 이름 시험)만 있다.

## 남은 물음

- 영어 성경이나 천주교 성경의 절 번호로 친 구절(예: 「이사 9:2-7」, 불가타 번호의 시편)을 공동번역 번호로 옮기는 작은 예외 표(bibletags `extraVerseMappings` 방식)가 필요한가, 아니면 겹침만으로 충분한가? 불가타 번호로 친 시편은 겹침으로 고칠 수 없다.
- 장이 하나뿐인 책(필레몬서, 요한2서, 요한3서, 유다서)에서 「유다 3」을 3장(지금 동작, 결과 0건)으로 읽을지 1장 3절로 읽을지, 그리고 성서 본문 탭도 같이 바꿀지
- 오늘이 주일일 때 「이번 주일」과 「다음 주일」이 각각 어느 날을 가리키는지, 「이번 주」, 「다음 달」처럼 구간이 되는 상대 표현까지 받을지
- 실제 사용자가 초성 검색이나 다른 교회의 이름(「바오로」, 「종려주일」)을 얼마나 치는지. 기존 전례독서 앱들이 이를 지원하는지는 이번 조사에서 검증된 근거가 없어, 미결 5와 미결 9를 정할 근거가 아직 부족하다

## 반박된 주장

검증에서 0-3으로 버려진 주장이다. 설계는 이 주장들에 기대지 않는다.

- 반절 표시(a/b)는 기본 출력에서 버려지고, 'bcvp' 같은 p 계열 압축 방식에서만 「Gen.1.1!a」처럼 '!' 뒤에 남는다. 표시 문자는 입력에 쓰인 그대로 넘어오므로 한국어의 「상/하」 같은 비라틴 문자도 '!' 뒤에 올 수 있다. 이 기능은 3.1.0-alpha(2025-07-27)에서 OSIS 규격을 따라 추가됐다. (<https://github.com/openbibleinfo/Bible-Passage-Reference-Parser>)
- The library's reference parser accepts partial-verse suffixes (a/b), cross-chapter ranges, verse lists and multi-part references, and normalizes each part to either a single {chapter, verse} or a span {chapter, verse, endChapter, endVerse}. That is the same row shape (start chapter/verse, end chapter/verse) as a lectionary range table. (<https://www.npmjs.com/package/bible-reference-range>)
- By default (keepNonHangul: false), getChoseong keeps only choseong, compatibility jamo and whitespace, and removes digits, Latin letters and punctuation; spaces are preserved ('띄어 쓰기' gives 'ㄸㅇ ㅆㄱ'). With keepNonHangul: true, non-Hangul characters pass through ('네이버123' gives 'ㄴㅇㅂ123'). Names that contain digits, such as '대림3주 (가해)', therefore need keepNonHangul: true or explicit whitespace stripping to support spacing-insensitive choseong matching. (<https://github.com/toss/es-hangul>)
- The ignoreSpace option makes matching ignore spacing by inserting \s* between every query character. This handles the 띄어쓰기-insensitive case (e.g. '대림 3주' vs '대림3주') when the generated RegExp is tested against names. (<https://awesome.ecosyste.ms/projects/github.com%2Fbluewings%2Fkorean-regexp>)
- For fuzzy matching, search() splits each Hangul syllable into its jamo (consonant and vowel letters) before giving it to MiniSearch, so one syllable becomes three or more tokens. The author says MiniSearch's fuzzy (edit-distance) option therefore has little extra effect, because jamo-level partial matching already acts as built-in fuzziness. This is a design lesson: edit-distance fuzziness over whole syllables works poorly for Korean, and decomposing into jamo is the usual workaround. (<https://unpkg.com/hangul-searcher@2.0.1/README.md>)

## 출처

| 출처 | 등급 | 각도 | 남은 주장 |
| --- | --- | --- | --- |
| <https://lectionary.library.vanderbilt.edu/faq2.php> | 주장을 뽑지 못함 | 기존 독서표 사이트의 성서 색인 사례 | 0 |
| <https://lectionary.library.vanderbilt.edu/citationindex.php> | 주장을 뽑지 못함 | 기존 독서표 사이트의 성서 색인 사례 | 0 |
| <https://crivoice.org/lectionary/lectionlistot.html> | 주장을 뽑지 못함 | 기존 독서표 사이트의 성서 색인 사례 | 0 |
| <https://lectionary.library.vanderbilt.edu/sunday-citations/> | 주장을 뽑지 못함 | 기존 독서표 사이트의 성서 색인 사례 | 0 |
| <https://lectionarypage.net/> | 주장을 뽑지 못함 | 기존 독서표 사이트의 성서 색인 사례 | 0 |
| <https://www.wikipedia.org/wiki/The_Text_This_Week> | 주장을 뽑지 못함 | 기존 독서표 사이트의 성서 색인 사례 | 0 |
| <https://github.com/openbibleinfo/Bible-Passage-Reference-Parser> | 1차 출처 | 성서 구절 파서와 구간 일치 의미 | 5 |
| <https://www.catholiccrossreference.online/bible/lectionary.cgi> | 주장을 뽑지 못함 | 성서 구절 파서와 구간 일치 의미 | 0 |
| <https://lectionarycentral.com/ScriptureIndex.html> | 주장을 뽑지 못함 | 성서 구절 파서와 구간 일치 의미 | 0 |
| <https://github.com/educational-resources-and-services/bibletags-versification> | 1차 출처 | 성서 구절 파서와 구간 일치 의미 | 5 |
| <https://en.wikipedia.org/wiki/Psalms> | 주장을 뽑지 못함 | 성서 구절 파서와 구간 일치 의미 | 0 |
| <https://www.npmjs.com/package/bible-reference-range> | 1차 출처 | 성서 구절 파서와 구간 일치 의미 | 5 |
| <https://github.com/romcal/romcal> | 1차 출처 | 교회력 계산 엔진으로 기간 펼치기 | 5 |
| <https://github.com/romcal/romcal-api> | 1차 출처 | 교회력 계산 엔진으로 기간 펼치기 | 5 |
| <https://pypi.org/project/pylect> | 개인 프로젝트 | 교회력 계산 엔진으로 기간 펼치기 | 5 |
| <https://github.com/toss/es-hangul> | 1차 출처 | 오프라인 한국어 클라이언트 검색 | 5 |
| <https://awesome.ecosyste.ms/projects/github.com%2Fbluewings%2Fkorean-regexp> | 1차 출처 | 오프라인 한국어 클라이언트 검색 | 5 |
| <https://unpkg.com/hangul-searcher@2.0.1/README.md> | 1차 출처 | 오프라인 한국어 클라이언트 검색 | 5 |
| <https://www.w3.org/WAI/WCAG21/Understanding/status-messages> | 주장을 뽑지 못함 | 검색 UX와 접근성 패턴 | 0 |
| <https://technology.blog.gov.uk/2014/08/14/improving-accessibility-on-gov-uk-search/> | 주장을 뽑지 못함 | 검색 UX와 접근성 패턴 | 0 |
| <https://www.nngroup.com/articles/scoped-search/> | 주장을 뽑지 못함 | 검색 UX와 접근성 패턴 | 0 |
