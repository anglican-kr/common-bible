# 전례독서 검색: 보충 조사 보고서 (2026-11-15)

첫 조사(`report.md`)는 클라우드 세션에서 했고, 그 세션의 네트워크 정책이 여러 사이트를 막아 조사 질문 다섯 가운데 둘에 근거를 얻지 못했다. 다른 전례독서 사이트와 앱의 검색(질문 1)과, 검색 화면과 접근성의 사례(질문 5)다. 같은 날 사용자 컴퓨터의 세션에서 두 질문을 다시 조사해 이 보고서에 모았다. 설계서 `docs/design/lectionary-search.md`는 「보충 N」으로 이 보고서의 절 번호를 가리킨다.

## 1. 조사 방법

- 조사 에이전트 셋이 나눠 조사했다. 영어권 독서표와 성구 역색인, 천주교와 한국 교회의 독서 서비스, 검색 화면과 접근성이다. 에이전트는 페이지를 직접 열어 확인한 것만 적고, 주장마다 원문 인용과 주소를 붙였다.
- 설계 판단에 쓰는 주장은 에이전트의 보고와 별도로 다시 열어 확인했다. 아래에서 **(직접 확인)** 표시가 그것이다. 표시가 없는 줄은 에이전트가 열어 확인했고 다시 열어 보지 않은 것이다.
- 인용은 원문 언어 그대로 둔다. 페이지 요약 도구(WebFetch)를 거친 인용은 낱자까지 원문과 같다고 보장하지 못한다. 원문 HTML을 받아 확인한 곳은 그렇게 적는다.

## 2. 구절로 전례일을 찾는 곳

「이 구절은 언제 읽는가」에 답하는 역색인을 일곱 곳 찾았다. 모두 날짜 없는 전례일 이름(「Proper 12B」, 「Lent 4A」)으로 답하고, 실제 날짜를 보이는 곳은 Sundays and Seasons 하나다(§3).

- **Vanderbilt Revised Common Lectionary** (<https://lectionary.library.vanderbilt.edu/>)
  - 검색 폼에 방식이 넷이다. 「Texts」(낱말), 「Lections」(성구), 「Date」, 「Liturgical」(해, 절기, 날을 고른다). 날짜 검색은 「search is only available whithin current three year cycle」이다. **(직접 확인)**
  - 성구 검색은 이미 있는 성구 목록에서 고르게 한다. FAQ: 「Begin typing the book of the Bible, and a list of all the entries in the RCL will appear as a list.」, 「Click on the appropriate passage from the list」. **(직접 확인, <https://lectionary.library.vanderbilt.edu/faq/>)**
  - 목록에 없는 성구를 치면 엉뚱한 독서가 나온다. `John 3:16`을 성구 검색으로 치면 「This is the closest match.」 아래에 요한1서 「1 John 3:16-24」(부활 4주일 나해)가 나오고, 요한 복음 3:16을 읽는 사순 4주일 나해(John 3:14-21)는 나오지 않는다. **(직접 확인, 원문 HTML)** 낱말 검색으로 `John 3:16`을 치면 0건이다.
  - 성구 색인 「Sunday/Special Days Citation Index in Canonical Order」는 성구 표기마다 읽는 날을 적는다. 줄은 「Year A - Lent - Second Sunday in Lent」처럼 주기, 절기, 전례일 이름이고, 실제 날짜와 독서 자리는 없다. 겹치는 독서도 표기가 다르면 따로 선다(「John 3:1-17」, 「John 3:13-17」, 「John 3:14-21」). **(직접 확인, <https://lectionary.library.vanderbilt.edu/sunday-citations/>)**
  - `Luke 1:68-79`로 찾으면 즈가리야 송가를 시편 자리에 읽는 두 날(대림 2주일 다해, Proper 29 다해)이 나온다. 송가를 성구 표기로 적어 두었기 때문이다.
  - `Jude 1:3`처럼 결과가 없으면 「This is the closest match.」만 있고 빈 목록이다. 결과가 없다는 안내가 없다.
- **catholiccrossreference.online** (천주교 독서 역색인, <https://catholiccrossreference.online/bible/lectionary.cgi>)
  - 성구를 치는 칸 하나와 「Examples: John 3:16; Phil. 2:1-11; Luke 1-2」 안내가 있다.
  - `John 3:16`을 치면 「Lectionary Readings Referencing John 3:16」 아래에 전례일 15개가 나온다. **결과 하나가 전례일 하나**이고, 그날의 독서(제1독서, 화답송, 제2독서, 환호송, 복음)를 모두 보이며, 맞은 독서 줄에만 `class='reading on'`을 붙여 표시한다. 일부만 겹치는 독서(성 십자가 현양의 「John 3:13-17」)도 맞는다. 차례는 독서표 번호순(「Lect. #29」, 「#32」, 「#87」)이고 날짜는 없다. **(직접 확인, 원문 HTML)**
  - 장만 친 `John 3`은 전례일 19개다. `Luke 1:68-79`는 화답송 자리의 송가(「Luke 1:69-70, 71-72, 73-75」)와 복음(「Luke 1:67-79」)을 함께 찾는다.
  - 한 장짜리 책: `Jude 20`은 0건이고 `Jude 1:20`은 2건이다. 숫자 하나를 장으로 읽는 것으로 보인다. **(`Jude 20`의 0건은 직접 확인)**
  - 결과가 없을 때 구절로 읽혔으면 제목만 나오고 안내가 없다. 구절로 읽히지 않으면 「No Lectionary Readings Referencing prodigal」과 「Enter a reference to a passage from Scripture (e.g. John 3:16)」를 보인다.
- **lectionarypage.net** (미국 성공회, <https://www.lectionarypage.net/ReverseLectionary.html>)
  - 「Reverse Lectionary」 머리말: 「But sometimes we have the inverted question, "When will this lesson be read?"」. 성서 순서의 표 하나이고 검색창이 없다.
  - 여러 주기를 한 줄에 묶어 적는다. 「Psalm 23」에 「Lent 4A」, 「Easter 4A,B,C」, 「Proper 11B」. 날짜와 독서 자리는 없다.
  - 송가는 번호로만 적는다(「Canticle 4」에 「Advent 2C」, 「Proper 29C」). 그래서 「Luke 1:68-79」로는 찾지 못한다.
  - 성인 색인은 이름이 둘인 성인을 두 곳에 올린다(「Tabitha (Dorcas) of Joppa」를 D와 T에).
- **textweek.com** (<http://www.textweek.com/john.htm>): 책마다 표가 있고 열이 교단별이다(「RCL | Roman | Episcopal | Lutheran | United Methodist」). 줄의 구간은 독서 표기가 아니라 공부 단위로 묶은 구간이다. 검색은 일반 사이트 검색이다.
- **Sundays and Seasons의 역독서표** (도움말 <https://help.sundaysandseasons.com/?p=134>, 도구는 구독 서비스로 보여 열지 않았다)
  - 「next three years (i.e., the next full lectionary cycle)」 안에서 찾고, 결과는 날짜순으로 전례일 이름, 실제 날짜, 그날의 독서 전체를 보인다. **(직접 확인)**
  - 친 글자를 저장된 성구 표기의 앞부분과 맞춘다. 「The search isn't smart enough to know that "1-6" in the citation means that the reading includes verse 2.」 그래서 `lamentations 1:2`는 찾지 못하고, 책 이름이나 책과 장으로 찾으라고 권한다. **(직접 확인)**
- **그 밖의 성구 색인**: DPS Reverse Lectionary(「find the Feast Day for your Scripture passage」), 펠릭스 저스트의 천주교 주일 독서 색인(「John 3:14-21 / 32-B / 4th Sunday of Lent」), lpmc.uk 감리교 RCL 색인(열에 「7-13 Jan」 같은 날짜 구간), lectionarycentral.com(1662년 기도서의 한 해 주기, 구절 칸과 전례일 칸이 짝지어 있지 않다)이 있다. 모두 검색창 없는 표다.

## 3. 날짜, 주기, 다음 날짜를 보이는 방식

- **날짜 없는 전례일의 날짜**: 영국 성공회 Common Worship 독서표는 「Proper 12」 아래 「Sunday between 24 and 30 July inclusive」처럼 날짜 규칙을 적고, 트랙은 「Continuous」와 「Related」다. lectionarypage.net도 「Sunday closest to July 27」처럼 규칙만 적는다. 실제 날짜는 해별 달력에만 있다. ACNA 2019 기도서의 주보 자료도 「Proper 13: Sunday from July 31 – Aug. 6」처럼 구간을 적는다.
- **해별 페이지**: Vanderbilt는 전례일 페이지가 해마다 따로 있어 실제 날짜를 보인다(Proper 12 나해에 「Jul 25, 2027」). 해별 달력은 절기로 거를 수 있다(`/calendar/2026-27/?season=advent`). 조사한 곳 가운데 기간 질의에 가장 가까운 화면이다.
- **다음 날짜**: 결과에 앞으로의 실제 날짜를 적는 곳은 Sundays and Seasons의 역독서표 하나다. 앞으로 3년(한 주기) 안에서 날짜순이다(§2).
- **주기 표기**: Universalis는 하루 머리에 「Year: A(II)」처럼 주일 주기와 평일 주기를 함께 적고, 시편은 두 번호를 함께 적는다(「Psalm 127(128):1-5」). 영국 성공회는 「Today we are in Year A (Sunday Lectionary)」와 「Until the start of Advent (Sunday 29 November) 2026.」로 지금 주기와 바뀌는 날을 적는다.
- **일일 독서 서비스**: USCCB(<https://bible.usccb.org/daily-bible-reading>), Universalis(<https://universalis.com/mass.htm>), iBreviary, Laudate는 날짜로만 이동한다. 전날, 다음 날, 달력이고, 전례일 이름이나 구절로 찾는 칸은 없다. 앱 스토어 설명의 「검색」은 기도문 검색이다(iBreviary 「the ability to search for preferred texts」, Laudate 「searchable prayers」). USCCB의 달력과 사이트 검색은 403으로 열리지 않았다.
- **기간 질의**: 「2027년 사순절」, 「다음 주일」 같은 검색어를 받는 곳은 찾지 못했다.

## 4. 한국 천주교와 한국 교회

- **굿뉴스 매일미사** (<https://maria.catholic.or.kr/mi_pr/missa/missa.asp>)
  - 「전날」, 「다음날」, 「오늘」, 월 달력, 연도 목록으로 이동하고, 매일미사 화면에는 검색창이 없다.
  - 머리 줄은 「2026년 11월 15일 주일」, 「(녹) 연중 제33주일(세계 가난한 이의 날)」이고, 가해, 나해, 다해를 적지 않는다.
  - 독서 표기는 장과 절을 쉼표로, 절 묶음을 마침표로 나눈다. 시편은 두 번호를 함께 적는다. 「잠언 31,10-13.19-20.30-31」, 「시편 128(127),1-2.3.4-5」, 「테살로니카 1서 5,1-6」, 「마태오 25,14-30」. 독서 자리는 「제1독서」, 「화답송」, 「제2독서」, 「복음 환호송」, 「복음」이다.
- **굿뉴스 「전례력으로 찾기」** (<https://maria.catholic.or.kr/mi_pr/missa/jeon_list.asp>): 조사한 곳 가운데 전례일 이름을 치는 칸이 있는 유일한 서비스다. 「미사년도」(ALL, 2027년부터 1998년까지), 「미사월」(ALL, 1-12월), 「전례/복음제목」 입력칸, 「검색」이 있다. 표의 머리는 「번호, 날짜, 제의, 전례일, 복음말씀」이고 날짜 내림차순이다(첫 줄 「2026-11-30 / 홍 / 성 안드레아 사도 축일」). **(직접 확인)** 입력칸이 무엇을 어떻게 맞추는지는 시험하지 못했다.
- **한국천주교주교회의 전례력** (<https://missa.cbck.or.kr/Liturgy>): 그해 이동 축일과 특별 주일을 이름과 날짜로 적는다. **(직접 확인)**
  - 주기를 글로 적고 바뀌는 날을 밝힌다. 「주일과 축일 독서 - 가해」, 「연중 평일 독서 - 짝수해」, 「2026년 11월 29일 대림 제1주일부터는 나해」.
  - 이름의 표기: 「주님 공현 대축일」, 「주님 세례 축일」, 「재의 수요일」, 「주님 수난 성지 주일」, 「주님 부활 대축일」, 「주님 승천 대축일」, 「성령 강림 대축일」, 「지극히 거룩하신 삼위일체 대축일」, 「지극히 거룩하신 그리스도의 성체 성혈 대축일」, 「지극히 거룩하신 예수 성심 대축일」, 「온 누리의 임금이신 우리 주 예수 그리스도왕 대축일」, 「대림 제1주일」, 「예수, 마리아, 요셉의 성가정 축일」.
- **그 밖의 천주교 자료**: gcatholic의 한국어 달력은 평일을 「연중 제1주간 월요일」로, 주일을 「사순 제1주일」, 「부활 제2주일 (하느님의 자비 주일)」로 적는다(<https://gcatholic.org/calendar/2027/KR-ko>). 주교회의 성경 사이트(<https://bible.cbck.or.kr/>)는 낱말 검색만 있고 전례 독서와 이어지지 않는다. 앱 스토어의 「매일미사」와 「가톨릭」(굿뉴스) 설명에는 독서 검색이 없다.
- **한국 개신교와 대한성공회**: 개신교의 온라인 성서일과 검색 서비스와 개신교식 교회력 이름의 1차 출처는 찾지 못했다. 대한성공회 공식 사이트(`anglican.kr`)는 열리지 않았다(ENOTFOUND, Socket is closed).

## 5. 결과 수 알림과 상태 메시지

- **WCAG 2.1 성공 기준 4.1.3 Status Messages**: 이해 문서의 예가 검색 결과 수다. 「The change to content also includes the message "5 results returned" near the top of this new content.」, 「This text is given an appropriate role for a status message.」 동작의 결과를 알리는 경우의 충분한 기법은 ARIA22(`role=status`)와 G199다. **(직접 확인, <https://www.w3.org/WAI/WCAG21/Understanding/status-messages>)**
- **실패 사례 F103**: 결과가 없는 검색도 상태 메시지다. 「Since the search has no results, the change to content conveys the status message "0 results returned".」 상태 메시지로 인정하는 방법에 `role="status"`, `role="alert"`, `role="log"`, `output` 요소, 「the use of an `aria-live` attribute on an element, set to either "`polite`" or "`assertive`"」가 든다. **(직접 확인, <https://www.w3.org/WAI/WCAG21/Techniques/failures/F103>)**
- **ARIA22, ARIA 1.2, MDN**: `role="status"`는 `aria-live="polite"`와 `aria-atomic="true"`를 기본으로 갖는다. 라이브 영역은 글을 넣기 전에 페이지에 있어야 하고, 처음 마크업에 두는 것이 가장 확실하다(「The most reliable way to ensure that live regions are registered is to include them in the initial markup.」, MDN).
- **GOV.UK 검색 접근성 개선 글** (2014-08-14, <https://technology.blog.gov.uk/2014/08/14/improving-accessibility-on-gov-uk-search/>): 결과 목록 전체를 라이브 영역에 넣으면 스크린 리더가 「is going to read out every single search result」, 이는 「way too much information」이라, 결과 수만 따로 라이브 영역에 넣었다.

## 6. 탭과 쪽 이동

- **APG Tabs 패턴**: 한 페이지 안에서 패널을 바꿔 보이는 것이다(「Tabs are a set of layered sections of content, known as tab panels, that display one panel of content at a time.」). 화살표 키로 탭 사이를 옮기고, 탭 목록에서는 한 요소만 탭 순서에 둔다. 패널을 그리는 데 네트워크 요청이 들면 포커스만으로 활성화하지 말고 Enter나 Space로 고르게 하라고 한다(키보드 설계 문서). APG에는 「주소를 바꾸는 탐색에는 링크를 써라」는 문장이 없다.
- **GOV.UK 디자인 시스템 Tabs**: 「For this reason, do not use the tabs component as a form of page navigation.」, 「Tabs hide content from users and not everyone will notice them or understand how they work.」 이 탭 요소도 주소의 조각(`#id-of-the-tab`)을 바꾼다. 그러니 기준은 주소가 바뀌는지가 아니라 다른 쪽으로 가는지다. **(직접 확인, <https://design-system.service.gov.uk/components/tabs/>)**
- **Chrome 개발자 문서의 탭 안내**: 「DO NOT use this or the WAI-ARIA tabs pattern for page navigation」. 탭을 고르면 주소나 방문 기록이 바뀌는 경우는 수동 활성화를 권한다(<https://developer.chrome.com/docs/modern-web-guidance/guides/ui-components/tabs>).
- **`aria-current`**: ARIA 1.2는 탭 목록에서 `aria-selected` 대신 `aria-current`를 쓰지 말라고 하고, `page` 값의 예로 쪽 나누기 링크를 든다. GOV.UK의 서비스 탐색 요소는 링크 목록에서 지금 항목에 `aria-current`를 단다.

## 7. 검색 범위, 해석 보이기, 결과 없음

- **검색 범위(NN/g, Katie Sherwin, 2015-01-18, <https://www.nngroup.com/articles/scoped-search/>)** **(직접 확인)**
  - 「Always set the default scope to 'all'.」
  - 「Even customers that do use scoped search frequently forget that they've limited the search.」
  - 결과 화면은 「states any scope limitation clearly」하고 「offers a one-click option to expand the search to the entire site」해야 한다.
- **검색 범위(Baymard, 2014-08-13, <https://baymard.com/blog/search-scope>)**: 「applying a search scope is not a natural part of most users’ thought process.」 특정 범위를 기본값으로 둔 것이 「lead to multiple site abandonments when testing Tesco.」 결과 화면에서 알맞은 범위를 제안하라고 한다(「Suggest Near-Perfect Scopes on the Results Page」).
- **해석을 보이고 되돌릴 길 두기**
  - NN/g(2016): 철자를 고쳐 찾으면 「make it clear that you retrieved results for a variation of the user's spelling.」, 비슷한 말은 「Your site search should accommodate realistic user synonyms and alternative terminology.」
  - NN/g(2022): 「Always allow users to revert to their original keyword, in case the suggestion is wrong.」 맨 위에 고정한 결과(pinned results)를 권한다.
  - Google(2021): 확신이 덜하면 「did you mean…」으로 묻고, 높으면 자동으로 고쳐 보이되 원래 철자로 돌아갈 길을 둔다.
  - 스코틀랜드 정부 디자인 시스템: 「Also showing results for」, 「Show results only for」 문구로 고친 검색어와 원래 검색어를 고르게 한다.
  - 놓치는 자리: NN/g는 결과 탭 위에 둔 「Did you mean」 링크를 사용자가 놓친다고 한다(「are unlikely to notice text that doesn't appear to be part of the main body of page content」).
- **결과 없음 화면**
  - NN/g(2014, <https://www.nngroup.com/articles/search-no-results-serp/>): 「Clearly explain that there are no matching results.」, 「Offer starting points for moving forward.」, 「Don't mock the user.」 검색어를 다시 보이고, 결과가 나오는 비슷한 검색어와 철자 교정을 제안하고, 검색창에 원래 검색어를 남긴다.
  - Baymard(2019, 2025 갱신): 결과 없음 화면이 문제가 되는 것은 이어 갈 길이 없을 때다. 일반적인 검색 요령은 사용자가 「rarely read or apply them effectively.」
  - GOV.UK 사이트 검색과 스코틀랜드 정부 디자인 시스템은 「There are no matching results.」 뒤에 철자 확인, 낱말 줄이기, 거르개 지우기 같은 요령을 둔다.

## 8. 결과 목록의 구조, 쪽 나누기, 포커스

- **스코틀랜드 정부 디자인 시스템 Search results**: 결과 수, 쪽 나누기, 결과 없음 메시지가 반드시 있어야 한다. 결과 수는 `h2`에 `aria-live="polite"`, 목록은 `<ol>`과 `start` 속성이다. 결과가 10개를 넘으면 쪽을 나눈다. 쪽의 일부만 다시 그리면 바뀐 내용의 시작으로 포커스를 옮기라고 한다.
- **GOV.UK 디자인 시스템 Pagination**: 「Show the page number in the page <title> so that screen reader users know they’ve navigated to a different page.」 지금 쪽 링크에 `aria-current="page"`를 단다. 무한 스크롤은 키보드 사용자에게 문제가 된다고 한다.
- **GOV.UK 사이트 검색의 지금 코드**(finder-frontend): 결과 수 제목 옆에 「Skip to results」 건너뛰기 링크를 두고, 포커스는 옮기지 않는다.
- **Scott O'Hara(2022)**: 결과 앞에 제목을 두면 결과가 늘 같은 자리에 온다. Enter를 쳤을 때 결과 제목으로 포커스를 옮기는 것은 선택 사항이다.
- **WCAG 기법 H42, H48**: 제목 요소로 구조를 알리고(하위 묶음은 한 단계 낮은 제목), 목록은 `ol`이나 `ul`에 넣는다. 둘 다 성공 기준 1.3.1의 충분한 기법이다.

## 9. 입력하는 동안 알림 늦추기

- W3C 문서(WCAG, ARIA, APG)와 MDN에는 알림을 몇 초 늦추라는 규범 문장이 없다.
- Scott O'Hara(2022): 「Constantly interrupting a user as they type with a live region should be avoided.」 얼마나 늦출지는 사람마다 다르다고 한다.
- GOV.UK accessible-autocomplete 코드(`src/status.js`): 마지막 갱신 뒤 1.4초(`statusDebounceMillis = 1400`)가 지나야 상태 글을 쓰고, 검색창에 포커스가 없으면 알리지 않는다. 저장소 문서에 이 수치의 근거는 없다.
- Sara Soueidan(2024): 내용이 바뀐다고 모두 라이브 영역일 필요는 없고, 메시지는 짧게 쓴다.

## 10. 앱의 코드와 데이터에서 확인한 것

조사 결과를 이 앱에 대어 보려고 2026-11-15에 직접 확인했다.

- 검색 워커의 구절 판정(`tryVerseRef`)은 `요한 3,16`을 요한 복음 3장과 16장으로 읽는다. `마태오 25,14-30`, `루카 15:11`, `마르코 1:1`, `테살로니카 1서 5,1-6`, `시편 128(127),1-2`는 구절로 읽지 못한다. 책 이름 목록(`search-meta.json`)에 `마태오`, `마르코`, `루카`, `코린토 1서`, `갈라티아`, `필리피`가 없고, `탈출기`, `코헬렛`, `1코린`은 있다.
- 한국천주교주교회의 전례력과 gcatholic의 이름 22개를 설계서 §4.1의 정규화로 색인과 교회력 표의 이름에 맞춰 보았다. 지금 규칙으로 7개, `제N주간`을 `N주`로 바꾸는 규칙을 더하면 9개가 맞는다. 주일과 주간 이름은 맞고, `주님 부활 대축일`, `그리스도왕 대축일` 같은 대축일과 축일 이름 13개는 맞지 않는다.
- 알림 영역(`index.html`의 `#a11y-announce`)은 `aria-live="polite"`와 `aria-atomic="true"`이고 처음부터 페이지에 있다. 성서 검색은 워커가 중간 결과를 보낼 때마다 「검색 중… 현재 N건」을 알린다(`search.js`의 `onPartial`).
- 성서 검색은 구절로 바로 갈 때 검색 주소를 장 주소로 바꿔 쓴다(`history.replaceState`). 뒤로 가면 검색 전 화면이다.

## 11. 확인하지 못한 것

- USCCB의 달력, 독서 목록, 사이트 검색(403). 이름이나 구절로 찾는 기능이 있는지 모른다.
- 앱 안의 실제 검색 동작. 영국 성공회 Lectionary 앱의 「browse by bible」, 매일미사 앱, 가톨릭 앱, iBreviary, Laudate는 스토어 설명만 보았다.
- 굿뉴스 「전례력으로 찾기」의 입력칸이 무엇을 어떻게 맞추는지(부분 문자열인지, 띄어쓰기를 무시하는지).
- Sundays and Seasons의 역독서표 도구 자체(도움말만 읽었다).
- 한국 개신교의 교회력 이름과 성서일과 서비스, 대한성공회 공식 사이트의 전례독서 안내.
- 「오늘이 주일일 때 『다음 주일』은 언제인가」의 근거(설계서 미결 11).
- 한국어 VoiceOver와 TalkBack이 `aria-current="page"`와 연이은 알림을 실제로 어떻게 읽는지.
