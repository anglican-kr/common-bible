# 논리 시계, 하이브리드 논리 시계, 인과 추적: 기기 시각 없이 레코드 판본의 순서를 정하는 방법

조사일 2026-10-30. 출처 등급은 각 줄 앞에 적는다.

- [1차]: 1차 출처(논문 원문, 공식 문서, 소스 코드, 해당 PR)에서 직접 읽고 확인했다.
- [2차]: 2차 출처(다른 사람의 해설, 검색 결과 요약, 하류 사용자의 문서)로만 확인했다.
- [미확인]: 출처를 찾지 못했다.
- [직접 계산]: 이 조사에서 `node`로 직접 계산했다.

앱에 적용하는 이야기는 모두 「추론」에 둔다. 앱의 현재 방식은 「레코드마다 `_u` = 편집한 기기의 `Date.now()`, 삭제 표시(tombstone)는 id와 시각, `_u`가 큰 쪽이 이기고 같으면 기기 id로 정함」이다.

## 1. 램포트 시계와 하이브리드 논리 시계(HLC): 갱신 규칙, 보장하는 순서, 정하지 못하는 것

### 요점(Takeaway)
두 시계 모두 「a가 b보다 먼저 일어났다(happened-before)면 a의 값이 더 작다」만 보장하고, 그 역은 보장하지 않는다. 그래서 동시 편집을 알아내지 못하고 임의의 전순서로 줄 세울 뿐이다. HLC는 이 전순서를 물리 시각에 가깝게(오차 ε 이내) 만든다. 사람이 기기를 바꿔 가며 편집할 때처럼 시스템 밖에서 생긴 선후는 램포트 시계가 알 수 없다는 점을 Lamport 자신이 1978년에 지적했다.

### 출처가 있는 사실(Cited Findings)
램포트 시계 (Lamport, "Time, Clocks, and the Ordering of Events in a Distributed System", CACM 21(7), 1978년 7월)
- [1차] 시계 조건(Clock Condition): 모든 사건 a, b에 대해 a → b 이면 C(a) < C(b). 역은 기대할 수 없다. 역이 성립하면 동시인 두 사건이 같은 시각에 일어나야 하기 때문이다. — [Lamport 1978](https://lamport.azurewebsites.net/pubs/time-clocks.pdf)
- [1차] 구현 규칙 IR1: 각 프로세스 Pi는 연속한 두 사건 사이에 Ci를 증가시킨다. IR2: (a) Pi가 메시지 m을 보내면 m에 Tm = Ci(a)를 넣는다. (b) m을 받으면 Ci를 현재 값 이상이면서 Tm보다 크게 설정한다. — [Lamport 1978](https://lamport.azurewebsites.net/pubs/time-clocks.pdf)
- [1차] 전순서 ⇒의 정의: a가 Pi의 사건, b가 Pj의 사건일 때 Ci(a) < Cj(b) 이거나, 값이 같고 Pi < Pj(프로세스에 대한 임의의 전순서)이면 a ⇒ b. 이 전순서는 유일하지 않고, 사건들이 유일하게 정하는 것은 부분 순서뿐이라고 썼다. — [Lamport 1978](https://lamport.azurewebsites.net/pubs/time-clocks.pdf)
- [1차] 「이상 동작(anomalous behavior)」: 사람이 컴퓨터 A에서 요청 A를 낸 뒤 전화로 친구에게 컴퓨터 B에서 요청 B를 내게 하면, 요청 B가 더 낮은 타임스탬프를 받아 A보다 앞에 놓일 수 있다. 선후 정보가 시스템 밖의 전화로만 전달되었기 때문이다. 해결책은 둘이다. 사용자가 A의 타임스탬프를 받아 B에 넘기거나, 서로 동기화된 물리 시계로 「강한 시계 조건(Strong Clock Condition)」을 만족시키는 것이다. — [Lamport 1978](https://lamport.azurewebsites.net/pubs/time-clocks.pdf)
- [1차] 물리 시계용 규칙 IR2'(b): 메시지 m을 시각 t'에 받으면 Ci(t')를 max(Ci(t' − 0), Tm + μm)로 설정한다(μm은 알려진 최소 전송 지연). — [Lamport 1978](https://lamport.azurewebsites.net/pubs/time-clocks.pdf)
- [1차] Kleppmann의 강의 노트: 램포트 타임스탬프 두 개만으로는 두 사건이 동시인지 한쪽이 먼저인지 일반적으로 알 수 없고, 동시성을 알아내려면 벡터 시계가 필요하다. — [Kleppmann, Concurrent and Distributed Systems 강의 노트(케임브리지 2021/22)](https://www.cl.cam.ac.uk/teaching/2122/ConcDisSys/dist-sys-notes.pdf)
- [1차] 같은 노트: 사용자가 복제본 A에서 T1의 결과를 보고 복제본 B에서 T2를 실행하면 T2가 더 큰 타임스탬프를 가져야 하지만, A에서 B로 간 메시지가 없고 소통이 사용자를 거치므로 램포트 타임스탬프는 이 순서를 보장하지 못한다. — [Kleppmann 강의 노트](https://www.cl.cam.ac.uk/teaching/2122/ConcDisSys/dist-sys-notes.pdf)
- [1차] 같은 노트: 시각 시계(time-of-day clock)의 타임스탬프로 메시지를 정렬하면, A의 시계가 B보다 조금 앞서 있을 때 m1에 대한 응답 m2가 m1보다 작은 타임스탬프를 받을 수 있다. — [Kleppmann 강의 노트](https://www.cl.cam.ac.uk/teaching/2122/ConcDisSys/dist-sys-notes.pdf)

하이브리드 논리 시계 (Kulkarni, Demirbas, Madeppa, Avva, Leone, "Logical Physical Clocks and Consistent Snapshots in Globally Distributed Databases", 버펄로 대학 기술 보고서 2014-04)
- [1차] 문제 정의(§3.1): 각 사건 e에 l.e를 주되 (1) e hb f ⇒ l.e < l.f, (2) 공간은 O(1)개 정수, (3) 크기에 상한이 있고, (4) |l.e − pt.e|에 상한이 있어야 한다(pt는 물리 시각). — [HLC 2014](https://cse.buffalo.edu/tech-reports/2014-04.pdf)
- [1차] 단순 알고리즘(그림 3): 보내기나 로컬 사건에서 `l.j := max(l.j + 1, pt.j)`, 받기에서 `l.j := max(l.j + 1, l.m + 1, pt.j)`. 이 방식은 l 하나에 「지금까지 본 pt의 최댓값」과 「사건마다의 논리 증가」를 함께 담아, 세 노드의 메시지 순환에서 |l − pt|가 끝없이 커지는 반례가 있다(그림 4). 다만 보내기와 받기 사이에 모든 노드의 물리 시계가 적어도 1씩 증가한다고 가정하면 이 반례가 성립하지 않고 단순 알고리즘으로 충분하다고 썼다(§3.2, §3.3 끝의 따름정리 4 다음 문단). — [HLC 2014](https://cse.buffalo.edu/tech-reports/2014-04.pdf)
- [1차] HLC 알고리즘(그림 5) 원문:
  ```
  Initially l.j := 0; c.j := 0
  Send or local event
    l'.j := l.j; l.j := max(l'.j, pt.j)
    If (l.j = l'.j) then c.j := c.j + 1 Else c.j := 0
    Timestamp with l.j, c.j
  Receive event of message m
    l'.j := l.j; l.j := max(l'.j, l.m, pt.j)
    If (l.j = l'.j = l.m) then c.j := max(c.j, c.m) + 1
    Elseif (l.j = l'.j) then c.j := c.j + 1
    Elseif (l.j = l.m) then c.j := c.m + 1
    Else c.j := 0
    Timestamp with l.j, c.j
  ```
  — [HLC 2014](https://cse.buffalo.edu/tech-reports/2014-04.pdf)
- [1차] 정리 1: e hb f ⇒ (l.e, c.e) < (l.f, c.f)(사전식 비교). 정리 2: l.f ≥ pt.f. 따름정리 1: |l.f − pt.f| ≤ ε(ε는 시계 동기화 오차). 따름정리 3: c.f ≤ N × (ε + 1)(N은 노드 수). 따름정리 4: 메시지 전송 동안 물리 시계가 적어도 d 증가한다고 가정하면 c.f ≤ ε/d + 1. — [HLC 2014](https://cse.buffalo.edu/tech-reports/2014-04.pdf)
- [1차] 요건 1에서 l.e = l.f ⇒ e ∥ f가 나온다(같은 l 값을 가진 두 사건은 동시). 저자들은 이를 일관된 스냅숏에 쓴다. — [HLC 2014](https://cse.buffalo.edu/tech-reports/2014-04.pdf)
- [1차] 64비트 하나에 담는 방식: l은 pt의 상위 48비트만 추적하고(마이크로초 단위 정밀도), 나머지 16비트를 c에 쓴다(65536까지). — [HLC 2014](https://cse.buffalo.edu/tech-reports/2014-04.pdf)
- [1차] 실험: AWS 4노드에서 c는 4 미만이었다(c=0이 약 84%). 평균 NTP 오프셋 5ms일 때 l − pt의 최댓값은 21.7ms였다. — [HLC 2014](https://cse.buffalo.edu/tech-reports/2014-04.pdf)
- [1차] 저자들은 HLC의 오차 가림(masking) 성질이 Cassandra 같은 마지막 쓰기 우선(LWW) 데이터베이스에 특히 유용하다고 썼다(§4.2). — [HLC 2014](https://cse.buffalo.edu/tech-reports/2014-04.pdf)

실제 구현
- [1차] CockroachDB의 타임스탬프는 벽시각(`WallTime`, int64 나노초)과 논리 카운터(`Logical`, int32)로 나뉜다. `Update()`는 원격 벽시각이 더 크면 원격의 벽시각과 논리값을 그대로 받아들이고, 벽시각이 같으면 더 큰 논리값을 쓴다. — [cockroach `pkg/util/hlc/hlc.go`](https://github.com/cockroachdb/cockroach/blob/master/pkg/util/hlc/hlc.go)
- [1차] Actual Budget(로컬 우선 가계부 앱)의 HLC: 보내기 `lNew = Math.max(lOld, phys)`, `cNew = lOld === lNew ? cOld + 1 : 0`. 받기 `lNew = Math.max(Math.max(lOld, phys), lMsg)`에 위 논문과 같은 c 규칙. `phys`는 `Date.now()`(밀리초). 카운터 상한은 `0xFFFF`이고 넘으면 `OverflowError`. 문자열 표기는 「ISO 시각-4자리 16진 카운터-16자 노드 id」(예: `2015-04-24T22:23:42.123Z-1000-A219E7A71CC18912`). 같은 노드 id 검사(`DuplicateNodeError`)는 주석 처리되어 있다. — [actualbudget/actual `packages/crdt/src/crdt/timestamp.ts`](https://github.com/actualbudget/actual/blob/master/packages/crdt/src/crdt/timestamp.ts)

### 추론(Inferences)
- HLC도 동시 편집을 「알아내지」 않는다. 인과 관계가 있으면 그 순서를 따르고, 없으면 대략의 물리 시각(l)과 c, 마지막으로 기기 id로 줄 세운다. 그러니 인과 관계가 없는 두 편집의 승패는 여전히 기기 시계에 달려 있다.
- 앱의 첫째 문제(시계가 느린 기기의 나중 편집이 시계가 맞는 기기의 앞선 편집에 지는 일)는 두 경우로 나뉜다.
  - (가) 느린 기기가 편집 전에 Drive 파일을 내려받아 병합했다면, 그 편집은 앞선 편집 뒤에 일어난 것(happened-before)이다. 받은 레코드의 최댓값보다 크게 매기는 규칙(IR2, HLC 받기 규칙)만 있으면 느린 시계와 상관없이 이긴다. 램포트 시계, 레코드별 카운터, HLC 모두 이 경우를 고친다.
  - (나) 내려받지 않고 오프라인에서 편집했다면, Lamport의 「전화」 예와 같은 구조다. 선후 정보가 사용자 머리 안에만 있으므로 어떤 논리 시계도 고치지 못한다. HLC는 이때 기기 시각을 쓰므로 현재와 똑같이 진다. 순수 논리 시계는 기기 활동량이나 기기 id로 정하므로 결과가 실제 시간과 무관해진다.
- 한 사용자가 기기를 바꿔 쓰는 앱에서는 (나)가 드물지 않다(오프라인 우선이므로). 따라서 「벽시각을 완전히 버리는 것」은 (나)에서 지금보다 나빠질 수 있고, 「인과 관계가 있으면 논리 순서, 없으면 벽시각」인 HLC 계열이 이 앱의 요구에 가장 가깝다.

### 빈 곳(Gaps)
- 학회 발표판(OPODIS 2014)과 기술 보고서의 차이는 확인하지 않았다. 이 노트의 HLC 인용은 모두 기술 보고서 2014-04에서 왔다.

## 2. 앞선 시각의 전파(clock poisoning): 실제 시스템이 어떻게 제한하고, 제한의 비용은 무엇인가

### 요점(Takeaway)
HLC와 램포트 시계는 받은 값의 최댓값을 따르므로, 한 기기의 시계가 크게 앞서 있거나 망가진 큰 값이 들어오면 모든 기기의 시계가 그 값으로 올라간다. 실제 시스템은 「내 물리 시각보다 Δ 이상 앞선 값은 받지 않는다」로 막는다(CockroachDB 기본 500ms, Actual Budget과 selfstore 5분, MongoDB 1년). 서명으로 위조를 막는 곳은 MongoDB뿐이다. 받지 않는 방식은 그 기기와의 동기화를 멈추게 하고, 값을 낮춰 받는 방식(clamp)은 기기마다 다른 결과를 만들 수 있어 selfstore는 일부러 쓰지 않았다.

### 출처가 있는 사실(Cited Findings)
- [1차] HLC 논문 §4.1: 나쁜 HLC 값이 퍼지는 것을 막으려고 l이 pt에서 너무 멀어지게 만드는 메시지의 수신을 무시한다. 보낸 쪽 값이 매우 크면 시계가 망가졌을 가능성을 뜻하기 때문이다. 상한이 깨지면 물리 시계를 권위로 삼아 l과 c를 pt와 0으로 되돌리고, 로그를 남기고 관리자에게 예외를 알린다. c는 공간을 제한해 최악에도 한 바퀴 돌 뿐이다. — [HLC 2014](https://cse.buffalo.edu/tech-reports/2014-04.pdf)
- [1차] HLC 논문 §4.2: l − pt의 상한을 ε보다 넉넉한 Δ(ε의 상수배, 응용에 따라 초 단위)로 잡아 흔한 NTP 오류를 가린다. 물리 시계가 조금 뒤처진 노드(straggler)는 메시지에서 더 큰 l을 받아들여 계속 따라가고, 조금 앞선 노드(rusher)도 견딘다. — [HLC 2014](https://cse.buffalo.edu/tech-reports/2014-04.pdf)
- [1차] CockroachDB `UpdateAndCheckMaxOffset`은 원격 타임스탬프가 `maxOffset`보다 많이 앞서 있으면 `remote wall time is too far ahead (%s) to be trustworthy` 오류를 낸다(`maxOffset > 0`일 때). 앞으로 뛴 물리 시계는 `maxOffset/2`를 넘으면 검사를 켠 경우 프로세스를 멈추고(`detected forward time jump ... is not allowed`), 뒤로 뛴 시계는 `maxOffset/10`을 넘으면 경고하고 셈한다. — [cockroach `hlc.go`](https://github.com/cockroachdb/cockroach/blob/master/pkg/util/hlc/hlc.go)
- [1차] CockroachDB 운영 FAQ: 최대 오프셋 기본값은 500ms이고 `--max-offset`으로 바꾼다. 노드는 다른 노드의 적어도 절반과 최대 오프셋의 80%만큼 어긋난 것을 알아내면 스스로 꺼진다. 설정 범위를 넘는 어긋남은 인과 관계가 있는 트랜잭션 사이에서 단일 키 선형화 가능성(single-key linearizability) 위반을 낳을 수 있다. — [CockroachDB Operational FAQs](https://docs.cockroachlabs.com/docs/stable/operational-faqs)
- [1차] MongoDB SERVER-27721(3.5.5에서 해결): 논리 시계(클러스터 시각)를 올릴 때 속도 제한 검사(`passesRateLimiter_inlock`)를 넣는다. 시작 매개변수 `maxAcceptableLogicalClockDrift`(초 단위, 기본 365 × 24 × 60 × 60 = 1년)보다 새 시각이 앞서면 `ClusterTimeFailsRateLimiter` 오류를 낸다. 서명하며 올리는 `signAndAdvanceClusterTime`만 예외다. 티켓은 도입 이유를 적지 않았다. — [MongoDB SERVER-27721](https://jira.mongodb.org/browse/SERVER-27721)
- [2차] MongoDB `vector_clock.h` 주석으로 검색 결과에 나온 문장: 새 시각의 어느 구성 요소든 초 값이 이 노드의 벽시각보다 `gMaxAcceptableLogicalClockDriftSecs` 넘게 앞서면 거부한다. — [mongo `vector_clock.h`(특정 커밋)](https://github.com/mongodb/mongo/blob/e433dda6115621d018291503e4485a764cbdc139/src/mongo/db/vector_clock.h)
- [2차] SERVER-28458(검색 요약): 벽시계를 1년 넘게 과거로 돌려 시험하며, 벽시각과 클러스터 시각의 차이가 한도를 넘는 동안에는 시각을 매기는 모든 시도가 오류를 내고, 차이가 한도 안으로 돌아오면 쓰기가 다시 성공해야 한다고 적었다. — [MongoDB SERVER-28458](https://jira.mongodb.org/browse/SERVER-28458)
- [2차] SERVER-31757(검색 요약): 받은 논리 시각이 자기 시각보다 작으면 시계를 올릴 필요가 없으므로 서명을 검증하지 않는다. — [MongoDB SERVER-31757](https://jira.mongodb.org/browse/SERVER-31757)
- [2차] HLC 공동 저자 Demirbas의 MongoDB SIGMOD 2019 논문(Tyulenev 외) 해설: 악의적인 클라이언트가 최댓값 시각을 보내면 노드가 더는 쓰기를 받지 못해 샤드가 멈출 수 있어, MongoDB는 클러스터 시각에 HMAC-SHA1 서명을 붙였다. 클라이언트는 서명을 만들 수 없고 MongoDB 프로세스만 만든다. 클러스터 시각은 32비트 초(물리 시각)와 32비트 증가값으로 이루어진다. 서명은 하위 비트를 가린 시각 범위 단위로 해 매번 검증하지 않는다. — [Demirbas 블로그, 2024-04](https://muratbuffalo.blogspot.com/2024/04/implementation-of-cluster-wide-logical.html)
- [1차] Actual Budget: `maxDrift: 5 * 60 * 1000`(5분). 받기에서 `lMsg - phys > config.maxDrift`이면 바로 `ClockDriftError`를 던지고, 새 값을 계산한 뒤 `lNew - phys > config.maxDrift`이면 다시 던진다. 보내기에서도 `lNew - phys > maxDrift`이면 던진다. — [Actual `timestamp.ts`](https://github.com/actualbudget/actual/blob/master/packages/crdt/src/crdt/timestamp.ts)
- [1차] selfstore PR #108(2026-07-31 머지, 「refuse a replica whose clock cannot be real」): HLC는 본 것 가운데 가장 큰 벽시각을 그대로 받아들인다고 문제를 설명했다. `merge()`는 들어오는 복제본의 메타, 레코드, 삭제 표시, 필드 시각 가운데 하나라도 로컬 벽시각보다 5분 넘게 앞서면 복제본 전체를 거부하고 `CLOCK_DRIFT` 코드를 돌려준다. 과거 시각은 오프라인 기기에서 올 수 있으므로 절대 거부하지 않는다. 낮춰 받기(clamp)를 하지 않는 이유는, 조용히 시각을 낮추면 복제본들이 어느 쓰기가 나중인지에 대해 서로 다른 판단을 하게 되기 때문이다. 들어오는 쪽만 검사하므로 이미 나쁜 시각을 받아들인 로컬 복제본은 계속 병합한다. — [selfstore PR #108](https://github.com/selfstoredev/selfstore/pull/108)
- [1차] Riak은 `allow_mult`가 `false`이면 동시 판본(sibling)을 만들지 않고 단순한 타임스탬프 비교로 이길 값을 정한다. Riak 문서는 일반적으로 `allow_mult`를 늘 `true`로 두라고 권한다. — [Riak Causal Context](https://docs.riak.com/riak/kv/latest/learn/concepts/causal-context/index.html)

### 추론(Inferences)
- 이 앱에서 앞선 시각이 생기는 원인은 악의가 아니라 기기 시계 오류(사용자가 날짜를 손으로 바꿈, 시계 배터리 문제)나 망가진 데이터다. 사용자가 한 명이고 서버가 없으므로 MongoDB식 서명은 쓸 수 없고 필요도 적다.
- 제한의 첫째 비용: 「받는 기기 시각보다 Δ 앞섬」으로 판정하므로, 시계가 Δ보다 많이 느린 기기는 정상 기기의 레코드를 모두 「미래 값」으로 보고 거부한다. Actual의 5분이면 6분 느린 기기는 모든 수신에서 `ClockDriftError`가 난다(코드에서 읽은 조건으로 판단). HLC 논문이 말한 「뒤처진 노드도 따라간다」는 Δ가 넉넉할 때만 성립한다. 그러니 Δ는 사용자 기기 시계의 현실적인 최대 오차보다 커야 하고, 작게 잡으면 앱의 첫째 문제(느린 시계)를 동기화 중단이라는 더 나쁜 증상으로 바꾼다.
- 제한의 둘째 비용: 서버 없이 파일 하나를 병합하므로 「거부」는 그 파일 전체와의 병합 중단, 곧 동기화 정지다. 레코드 단위로만 거부하거나 낮춰 받으면, 판정 기준이 받는 기기의 현재 시각이라 기기마다 판정이 달라질 수 있어 수렴이 깨진다(selfstore가 clamp를 버린 이유와 같다).
- 「범위를 벗어난 레코드는 벽시각 비교로 되돌린다」는 방식을 쓰면, 그 레코드에 대해서는 원래 문제(시계 의존)가 그대로 남는다. 또 판정이 결정적이어야 하므로(모든 기기가 같은 결론) 받는 기기의 `Date.now()`가 아니라 파일 안의 값만으로 판정해야 한다.
- 앞선 값이 한 번 퍼진 뒤의 영향: HLC에서는 실제 시각이 그 값을 따라잡을 때까지 모든 새 편집이 l은 그대로 두고 c만 올린다. 16비트 c(Actual)는 65535번 편집 뒤 `OverflowError`가 난다. 밀리초 하나로 표현하는 단순 HLC(편집마다 `max(Date.now(), 본 최댓값 + 1)`)는 넘침이 없지만 `_u`가 실제 시각에서 멀어진다. 그동안 옛 클라이언트(`Date.now()`만 씀)의 편집은 실제로 나중이어도 모두 진다.
- 삭제 표시를 30일 뒤 기기 시계로 지우는 규칙과의 관계: 미래로 오염된 삭제 표시는 「아직 젊다」로 보여 더 오래 남는다(안전한 방향). 반대로 시계가 앞선 기기는 삭제 표시를 일찍 지워, 오래 꺼져 있던 기기가 지워진 레코드를 되살릴 위험이 커진다.

### 빈 곳(Gaps)
- MongoDB 현재 매뉴얼(2026)에서 `maxAcceptableLogicalClockDriftSecs`의 기본값과 동작을 직접 확인하지 못했다. 1년 기본값은 2017년 Jira 티켓에서 왔다.
- MongoDB SIGMOD 2019 논문 원문은 열지 못했다. 서명 이유는 공동 저자의 해설(2차)에서만 확인했다.
- Automerge, Yjs, Loro가 받은 아주 큰 램포트 카운터(예: 2^53에 가까운 값)를 제한하는지 찾지 못했다. 세 라이브러리 문서에 앞선 시각 전파에 대한 지침은 없었다.
- CockroachDB가 최근 판에서 최대 오프셋 검사를 끌 수 있게 했는지 등 판마다의 차이는 보지 않았다.

## 3. 버전 벡터와 점 버전 벡터(DVV, Riak): 동시 편집 감지, 레코드당 크기, 사라진 기기 id의 처리

### 요점(Takeaway)
버전 벡터는 기기마다 카운터 하나를 두어 「한 판본이 다른 판본을 포함하는지, 서로 동시인지」를 정확히 알아낸다. 대가는 쓰는 주체 수에 비례하는 크기와, 사라진 id를 지우는 규칙이다. Riak은 오래된 항목을 벽시각 기준으로 지웠고(기본 상한 50개), DVV는 서버 id만 쓰는 대신 판본마다 「점(dot)」을 붙여 동시 판본을 정확히 구분한다.

### 출처가 있는 사실(Cited Findings)
- [1차] Kleppmann 노트: 벡터 타임스탬프는 노드마다 정수 하나이고, ti는 노드 Ni에서 일어났다고 알려진 사건 수다. 다중 값 레지스터(multi-value register)는 t2 > t1이면 v2가 v1을 대체하고, t1 ∥ t2이면 {v1, v2}를 모두 보존한다. 램포트 시계로 LWW를 하면 동시 갱신이 타임스탬프가 매겨진 우연에 따라 임의로 정렬되고 낮은 쪽은 버려진다(「데이터 손실」). — [Kleppmann 강의 노트 Slide 95](https://www.cl.cam.ac.uk/teaching/2122/ConcDisSys/dist-sys-notes.pdf)
- [1차] 같은 노트: 벡터 시계는 모든 클라이언트가 항목을 가져야 하므로, 클라이언트가 많거나 재시작할 때마다 새 신원을 쓰는 시스템에서는 벡터가 데이터보다 커질 수 있다. — [Kleppmann 강의 노트](https://www.cl.cam.ac.uk/teaching/2122/ConcDisSys/dist-sys-notes.pdf)
- [1차] Riak: 벡터 시계는 같은 객체의 동시 갱신을 알아내지만 어느 값이 어느 갱신에서 왔는지는 보여 주지 않는다. Riak 2.0에서 DVV를 도입했고, 값마다 그것을 만든 갱신을 묶어 중복을 알아보고 지울 수 있다. 벡터 시계에서는 중복이 쌓여 「동시 판본 폭증(sibling explosion)」이 생길 수 있고, DVV에서는 동시 판본 수가 동시 갱신 수에 비례한다. Riak 2.0 이후에는 DVV를 강하게 권한다. — [Riak Causal Context](https://docs.riak.com/riak/kv/latest/learn/concepts/causal-context/index.html)
- [1차] DVV 저장소 README: 클라이언트 id로 버전 벡터를 만들면 클라이언트 1000개가 한 키에 쓸 때 VV에 `(client_id, counter)` 항목이 1000개 생긴다. 서버 id 버전 벡터는 크기는 괜찮지만 충돌하는 값을 구분하지 못한다. DVV는 서버 id를 쓰면서 그 문제가 없다. DVVSet의 크기는 버전 벡터와 비슷하다. `prune`은 DVVSet이 MAX를 넘으면 값이 없는 가장 오래된 항목을 버린다. 함수는 `new`, `update`, `sync`, `join`, `values`, `lww`. — [ricardobcl/Dotted-Version-Vectors](https://github.com/ricardobcl/Dotted-Version-Vectors)
- [1차] DVV 논문 초록(Preguiça, Baquero, Almeida, Fonte, Gonçalves, arXiv 1011.5808, 2010-11-26): 기존 인과 추적 방식은 인과 정보를 잃거나 확장되지 않으며, 제안한 방식은 인과 관계를 온전히 담으면서 크기가 「한 데이터 원소에 갱신을 등록한 서버 수」에만 선형으로 늘고 복제 수로 제한된다. — [arXiv 1011.5808](https://arxiv.org/abs/1011.5808)
- [1차] riak_core `vclock.erl`: 항목은 `{node, {counter, timestamp}}`로 카운터 옆에 벽시각(초)을 함께 둔다. `prune`은 항목을 타임스탬프 오래된 순(같으면 노드 id)으로 정렬한 뒤, 길이가 `small_vclock` 이하이면 그대로 두고, 가장 오래된 항목이 `young_vclock`보다 젊으면 그대로 두고, 그렇지 않으면 길이가 `big_vclock`을 넘거나 가장 오래된 항목이 `old_vclock`보다 오래된 동안 가장 오래된 항목을 지운다. 정렬이 결정적이어야 「나중에 가짜 병합 충돌이 생기지 않는다」는 주석이 있다. `merge`는 같은 노드에서 더 큰 카운터를, 카운터가 같으면 더 큰 타임스탬프를 쓴다. — [riak_core `vclock.erl`](https://github.com/basho/riak_core/blob/develop/src/vclock.erl)
- [2차] 기본 상한은 50개이고 보통 한 번에 한 항목씩 지운다. 읽기 수리(read repair)는 이 정리를 건너뛰어 50개를 넘을 수 있다(riak_kv 이슈 #1864, 검색 요약). 한 버킷 설정 덤프에는 `small_vclock` 50, `big_vclock` 50, `young_vclock` 20, `old_vclock` 86400(초)로 나온다. — [basho/riak_kv #1864](https://github.com/basho/riak_kv/issues/1864); [slfritchie gist](https://gist.github.com/slfritchie/442e09035c70c5ab6240)

### 추론(Inferences)
- 이 앱에는 서버가 없고 기기가 각자 쓰고 병합하므로, 벡터의 항목은 기기 id다. DVV가 푸는 문제(서버가 많은 클라이언트의 쓰기를 대신 받는 경우)는 이 앱에 없고, 기기 id로 만든 평범한 버전 벡터가 DVV의 「서버 id」 경우와 같은 크기가 된다.
- 크기: JSON에서 항목 하나가 `"<16자 id>":<카운터>,` 약 20-25바이트이므로, 기기 4개면 레코드당 약 100바이트를 더한다. 레코드 1000개(북마크와 삭제 표시)면 약 100KB로, Safari의 약 5 MiB 한도 안이지만 무시할 크기는 아니다. 기기 id를 짧게(예: 4-6자) 하면 줄어든다.
- 사라진 기기: 브라우저 저장소가 지워지거나 새 기기를 쓰면 새 id가 생겨 항목이 늘어난다(Kleppmann이 말한 「재시작마다 새 신원」과 같은 구조). Riak처럼 벽시각으로 오래된 항목을 지우면 시계 의존이 다시 들어온다. 항목을 지우면 한 판본이 다른 판본을 포함한다는 정보가 사라져, 실제로는 나중인 판본이 동시로 보일 수 있다(가짜 충돌). 이 경우 데이터가 조용히 사라지기보다 충돌 해결 규칙으로 넘어간다.
- 동시성을 알아내도 해결 규칙은 따로 필요하다. 읽기 위치와 설정은 결국 「나중 것」을 원하므로 동시일 때 벽시각 LWW로 돌아가고, 북마크처럼 집합 성격의 데이터는 「추가 우선(add-wins)」 같은 규칙을 고를 수 있다. 감지의 이점은 「인과 관계가 있는 경우에는 시계를 아예 보지 않는다」는 점이다. 이 이점은 HLC도 대부분 준다(1절 추론의 (가)).
- 파일 수준에서 기기마다 「어디까지 병합했는지」를 버전 벡터로 남기면, 모든 알려진 기기가 본 삭제 표시만 지우는 방식(인과적 안정성)이 가능해 30일 기기 시계 규칙을 대신할 수 있다. 다만 사라진 기기가 있으면 영원히 지우지 못하므로, 결국 기기 항목을 시간으로 만료시키는 규칙이 필요하다. 이 설계는 출처로 확인한 것이 아니다.

### 빈 곳(Gaps)
- 현재 Riak 공식 문서에서 가지 정리 매개변수의 기본값을 확인하지 못했다(문서 페이지에 없었다). 위 기본값은 이슈와 gist(2차)에서 왔다.
- 「오래된 항목을 지우면 가짜 동시 판본이 생긴다」는 Riak 문서의 직접 문장은 찾지 못했다. 위는 `vclock.erl`의 주석과 동작에서 한 추론이다.

## 4. CRDT 라이브러리는 LWW 레지스터와 맵을 벽시각 없이 어떻게 정렬하는가

### 요점(Takeaway)
Automerge, Yjs, Loro, cr-sqlite는 순서에 벽시각을 쓰지 않는다. Automerge와 Loro는 문서 전체의 램포트 타임스탬프와 행위자(actor) 또는 피어(peer) id로, Yjs는 클라이언트별 카운터와 「무엇 뒤에 썼는가(origin)」와 clientID로, cr-sqlite는 열(column)마다의 카운터, 값, site id 순으로 정한다. 그래서 동시 편집에서는 늘 같은 기기(id가 큰 쪽)가 이긴다. 벽시각은 Automerge와 Loro에서 이력용 메타데이터로만 저장된다. 반대로 「실제로 나중인 편집이 이겨야 하는」 개인용 로컬 우선 앱(Actual Budget, selfstore)은 HLC와 5분 제한을 쓴다.

### 출처가 있는 사실(Cited Findings)
Automerge
- [1차] 같은 맵 키에 동시에 쓰면 이길 값을 「임의이지만 결정적이고 두 문서에서 같게」 고른다. 이기는 기준은 연산 id(카운터와 actorId의 조합, 예 `1@01234567`)이며 「벽시각이 아니라 연산의 내부 id에 기반한다」. 진 값은 `Automerge.getConflicts(doc, key)`로 볼 수 있다(다중 값 레지스터 의미). — [Automerge Conflicts](https://automerge.org/docs/reference/documents/conflicts/)
- [1차] 바이너리 형식 명세: 「연산 id는 램포트 타임스탬프다」. 카운터가 다르면 큰 카운터가 크고, 같으면 사전순으로 큰 actor id가 크다. actor id는 임의의 바이트열이고 참조 구현은 128비트 무작위 id를 만든다. 변경(change)에는 선택 항목 `time`(유닉스 기원 이후 밀리초)이 있지만 순서는 램포트 타임스탬프와 순번으로 정한다. — [Automerge Binary Format](https://automerge.org/automerge-binary-format-spec/)

Yjs
- [1차] 문서에 넣는 모든 것은 (clientID, clock) 쌍의 id를 가지며 문서는 이것을 램포트 타임스탬프라고도 부른다. 다만 clock은 클라이언트마다 0부터 세고 삽입할 때만 증가한다. `Y.Map`은 키마다 「마지막으로 삽입된 항목」을 쓰고 나머지는 삭제로 표시한다. 언제 누가 지웠는지는 저장하지 않는다. — [Yjs INTERNALS.md](https://github.com/yjs/yjs/blob/main/INTERNALS.md)
- [1차] `Item.integrate()`: 같은 위치에 동시에 들어온 항목은 `o.id.client < this.id.client`이면 작은 clientID 쪽을 왼쪽에 두고, 맵 항목(`parentSub !== null`)인데 오른쪽에 항목이 있으면 자신을 지운다. 그러므로 동시에 같은 키에 쓰면 clientID가 큰 쪽이 남는다(코드를 읽고 판단). — [yjs `src/structs/Item.js`](https://github.com/yjs/yjs/blob/main/src/structs/Item.js)
- [2차] Yjs 포럼과 해설 문서도 「더 큰 clientID가 이기며, 나중 편집이 질 수 있다」고 설명하고, 시각이 필요하면 `y-lwwmap` 같은 시각 기반 층을 따로 두라고 권한다. — [discuss.yjs.dev 「Y.Map conflict resolution」](https://discuss.yjs.dev/t/y-map-conflict-resolution-which-side-wins/1952)

Loro
- [1차] 「Loro의 Map은 LWW 의미를 쓰며, 동시 편집이 충돌하면 램포트 논리 타임스탬프를 비교해 이길 쪽을 정한다.」 예제에서 같은 램포트 값일 때 peerId가 큰 docB가 이긴다. — [loro-docs `tutorial/map.mdx`](https://github.com/loro-dev/loro-docs/blob/main/pages/docs/tutorial/map.mdx) (공개 페이지 [loro.dev/docs/tutorial/map](https://loro.dev/docs/tutorial/map))
- [1차] `setRecordTimestamp`로 켜면 각 Change에 유닉스 시각을 기록하고 내보낸 Updates와 Snapshots에 보존한다. 켜지 않으면 Change의 Timestamp는 「현재 알려진 최대 Timestamp」가 된다. 변경 병합 간격 기본값은 1000초다. — [loro-docs `advanced/timestamp.mdx`](https://github.com/loro-dev/loro-docs/blob/main/pages/docs/advanced/timestamp.mdx)

cr-sqlite
- [2차] Fly.io Corrosion 문서(cr-sqlite 0.15 기준): 열마다 「가장 큰 `col_version`이 이긴다」. 같으면 「더 큰 값」(SQLite `max()`의 비교, 문자열은 사전순)이 이기고, 마지막으로 `site_id`로 정하는데 site_id가 무작위라 사실상 무작위 선택이다. 예: 둘 다 `col_version = 2`일 때 `max('started', 'destroyed')`로 `'started'`가 이겼다. `db_version`은 트랜잭션마다 늘어나는 데이터베이스 전체 카운터, `cl`(인과 길이)은 행의 존재와 삭제를 나타낸다. 램포트 타임스탬프를 「단조 증가 카운터로 줄인 것」이라고 설명하며 벽시각은 쓰지 않는다. — [Corrosion CRDTs](https://superfly.github.io/corrosion/crdts.html)

벽시각을 쓰는 쪽
- [1차] Actual Budget은 `Date.now()` 기반 HLC를 쓰고 5분 넘게 앞선 시각을 거부한다(2절). — [Actual `timestamp.ts`](https://github.com/actualbudget/actual/blob/master/packages/crdt/src/crdt/timestamp.ts)
- [1차] selfstore는 HLC와 LWW로 충돌을 정하며 「해결은 시계 비교일 뿐」이라고 썼다(2절). — [selfstore PR #108](https://github.com/selfstoredev/selfstore/pull/108)

### 추론(Inferences)
- 공동 편집용 CRDT 라이브러리가 벽시각을 쓰지 않는 이유는, 함께 편집하는 사람들이 서로의 편집을 실시간으로 보므로 인과 정보가 대부분 있고, 진짜 동시 편집에서는 「누가 나중인가」가 의미 없거나 시계로 알 수 없다고 보기 때문으로 보인다(Automerge 문서의 「임의이지만 결정적」). 이 이유를 직접 적은 문장은 찾지 못했다.
- 한 사용자의 여러 기기 앱에서는 인과 관계가 없지만 실제 시간으로는 분명히 순서가 있는 편집(오프라인 기기 전환)이 많다. 이때 clientID나 peerId로 정하면 「노트북이 늘 휴대폰을 이긴다」 같은 결과가 되어, 읽기 위치처럼 「가장 최근」이 중요한 값에는 맞지 않는다. Actual과 selfstore가 HLC를 고른 것은 이 앱과 같은 요구로 읽힌다.
- Automerge의 `getConflicts`처럼 진 값을 남겨 두는 방식은, 나중에 사용자에게 고르게 하거나 벽시각으로 다시 정하는 여지를 준다.

### 빈 곳(Gaps)
- Automerge 명세는 연산 id가 램포트 타임스탬프라고 하지만, 새 연산의 카운터가 「문서에서 본 최대 카운터 + 1」이라는 문장은 이번에 읽은 범위에서 찾지 못했다.
- Yjs의 「큰 clientID가 이긴다」는 소스 코드를 읽은 판단과 2차 출처에 기댄다. Yjs 공식 문서의 명시 문장은 찾지 못했다.
- cr-sqlite 저장소(vlcn-io)의 현재 판과 유지 상태, 비교 순서의 1차 근거(소스)는 확인하지 못했다.

## 5. 레코드마다의 버전 카운터와 문서 전체의 논리 시계는 어떻게 다르게 동작하는가

### 요점(Takeaway)
cr-sqlite(열마다 카운터)와 Riak(객체마다 벡터)은 레코드 단위, Automerge와 Loro는 문서 단위 램포트 시계다. 둘 다 인과 관계가 있는 편집은 바르게 정렬하지만, 동시 편집에서는 실제 시간과 무관하게 「그 레코드를 더 많이 고친 쪽」(레코드 단위) 또는 「기기 전체 활동이 많은 쪽」(문서 단위)이 이기고, 같으면 id나 값이 정한다. 이 앱처럼 파일 전체를 한 번에 병합하면 인과 정렬에서는 둘의 차이가 거의 없고, 차이는 저장할 상태와 동시 편집의 승패에서 난다.

### 출처가 있는 사실(Cited Findings)
- [2차] cr-sqlite는 두 단계 카운터를 쓴다. 열마다 그 열이 바뀔 때마다 늘어나는 `col_version`이 충돌을 정하고, 데이터베이스 전체의 `db_version`은 트랜잭션마다 늘어나며 한 트랜잭션의 변경은 같은 값을 공유한다. 같은 `col_version`은 값 비교로 정한다(`'started'`가 `'destroyed'`를 이긴 예). — [Corrosion CRDTs](https://superfly.github.io/corrosion/crdts.html)
- [1차] Automerge의 연산 id는 문서 전체의 램포트 타임스탬프이고 카운터 다음에 actor id로 정렬한다. — [Automerge Binary Format](https://automerge.org/automerge-binary-format-spec/)
- [1차] Loro Map은 램포트 논리 타임스탬프로 LWW를 정하고 같으면 peerId가 큰 쪽이 이긴다. — [loro-docs `tutorial/map.mdx`](https://github.com/loro-dev/loro-docs/blob/main/pages/docs/tutorial/map.mdx)
- [1차] Riak은 객체마다 벡터 시계를 둔다(레코드 단위 인과 추적). — [riak_core `vclock.erl`](https://github.com/basho/riak_core/blob/develop/src/vclock.erl)
- [1차] Kleppmann: 램포트 시계로 LWW를 하면 동시 갱신은 「타임스탬프가 매겨진 방식에 따라 임의로」 정렬된다. — [Kleppmann 강의 노트](https://www.cl.cam.ac.uk/teaching/2122/ConcDisSys/dist-sys-notes.pdf)

### 추론(Inferences)
- 저장할 상태: 레코드 단위 카운터는 새 값을 그 레코드에서만 계산하므로(현재 값 + 1) 따로 저장할 시계가 없고, localStorage가 지워져도 데이터에서 다시 계산된다. 문서 단위 시계는 기기마다 시계 값을 저장해야 하고, 잃으면 파일 안 모든 레코드의 최댓값에서 다시 세워야 한다(이 앱은 모든 데이터가 파일 하나에 있으므로 가능).
- 인과 정렬: 이 앱은 동기화할 때 파일 전체를 내려받아 병합하므로, 병합 뒤에는 어느 방식이든 그 레코드의 최신 값을 본다. 「그 레코드의 최댓값 + 1」만으로 1절 (가) 경우가 해결되고, 문서 단위 시계의 레코드 사이 순서는 레코드별 LWW에 필요하지 않다.
- 동시 편집의 승패(예): 휴대폰과 노트북이 모두 읽기 위치 `v=3`에서 갈라졌다. 아침에 휴대폰이 오프라인으로 다섯 번 고쳐 `v=8`, 저녁에 노트북이 한 번 고쳐 `v=4`가 되면 휴대폰의 아침 위치가 이긴다. 시계가 맞다면 지금의 벽시각 방식은 노트북을 이기게 한다(사용자가 원하는 결과). 그러니 순수 카운터는 오프라인 기기 전환에서 현재보다 나빠질 수 있다. 문서 단위 시계는 「그날 다른 레코드를 많이 고친 기기」가 이기는 차이만 있을 뿐 같은 문제를 가진다.
- 같은 값이 자주 나온다: 레코드 단위 카운터는 두 기기가 같은 판에서 한 번씩 고치면 둘 다 `v+1`이 되어, 승패가 기기 id(또는 cr-sqlite처럼 값)로 정해진다.
- 레코드 단위 카운터를 밀리초 단위에서 시작하면(`max(Date.now(), 그 레코드의 _u + 1)`) HLC 논문의 단순 알고리즘을 레코드마다 적용한 것이 된다. 논문은 사건 사이에 물리 시계가 적어도 1 증가하면 단순 알고리즘으로 충분하다고 했고, 사람의 편집 간격은 밀리초보다 훨씬 길므로 이 조건은 거의 늘 성립한다. 같은 밀리초 안의 연속 편집은 1ms씩 앞설 뿐이다. 이렇게 하면 인과 관계가 있으면 논리 순서, 없으면 벽시각으로 정해지고, `_u`는 밀리초 숫자로 남는다.

### 빈 곳(Gaps)
- cr-sqlite가 `db_version`을 「어디까지 받았는지」를 주고받는 데 쓰는지(변경분 동기화)는 1차 출처로 확인하지 못했다.
- 레코드 단위 카운터와 문서 단위 시계를 이 관점(동시 편집에서 「더 많이 고친 쪽이 이긴다」)으로 직접 비교한 글은 찾지 못했다. 위는 규칙에서 끌어낸 추론이다.

## 6. 옛 클라이언트(`Date.now()`를 쓰는 판)와 새 클라이언트가 같은 파일을 쓸 때

### 요점(Takeaway)
`_u`를 「밀리초처럼 보이는 숫자 하나」로 유지하면서 옛 클라이언트와 섞여도 뜻이 통하는 방식은 밀리초 단위의 단순 HLC(`_u = max(Date.now(), 본 최댓값 + 1)`)뿐이다. 작은 정수의 램포트 카운터와 64비트에 담은 HLC는 크기가 달라 옛 값과 비교가 무의미해지고, 별도 필드(카운터, 벡터)는 모든 클라이언트가 새 판일 때만 제대로 동작한다.

### 출처가 있는 사실(Cited Findings)
- [1차] HLC는 NTP와 하위 호환되고 64비트 NTP 타임스탬프 형식에 맞으며, l이 pt에 가까워(|l − pt| ≤ ε) 물리 시각 대신 쓸 수 있다고 저자들이 썼다. — [HLC 2014](https://cse.buffalo.edu/tech-reports/2014-04.pdf)
- [1차] HLC를 64비트 하나에 담는 방식은 l에 48비트, c에 16비트를 준다. — [HLC 2014](https://cse.buffalo.edu/tech-reports/2014-04.pdf)
- [직접 계산] 2026-10-30의 `Date.now()`는 약 1.793 × 10^12이다. 여기에 2^16을 곱하면 약 1.18 × 10^17로 `Number.MAX_SAFE_INTEGER`(9,007,199,254,740,991)를 넘는다. 카운터에 12비트를 주면 2039-09-07까지, 11비트를 주면 2109-05-15까지 안전 정수 안에 든다. 지금 크기의 `Date.now()`에서 배정밀도 숫자가 구분하는 가장 작은 차이는 2^-12ms(약 0.000244ms)다.
- [1차] Actual은 HLC를 숫자가 아닌 문자열(ISO 시각, 16진 카운터, 노드 id)로 저장한다. — [Actual `timestamp.ts`](https://github.com/actualbudget/actual/blob/master/packages/crdt/src/crdt/timestamp.ts)
- [1차] CockroachDB는 벽시각과 논리값을 별도 필드로 둔다. — [cockroach `hlc.go`](https://github.com/cockroachdb/cockroach/blob/master/pkg/util/hlc/hlc.go)
- [1차] Riak 벡터 시계의 항목은 카운터 옆에 벽시각을 함께 저장한다(오래된 항목 삭제용). — [riak_core `vclock.erl`](https://github.com/basho/riak_core/blob/develop/src/vclock.erl)

### 추론(Inferences)
기법마다 섞였을 때의 결과(옛 클라이언트는 `_u`를 숫자로 비교한다고 가정):
- 순수 램포트 카운터(작은 정수)를 `_u`에 넣기: 새 클라이언트의 값(예: 57)이 옛 클라이언트의 `Date.now()`(약 1.8 × 10^12)에 늘 진다. 호환되지 않는다.
- 64비트에 담은 HLC(l × 2^16 + c)를 `_u`에 넣기: 새 값이 옛 값보다 늘 훨씬 커서 옛 클라이언트의 편집이 늘 지고, JS 숫자의 안전 범위도 넘는다. 호환되지 않는다.
- 밀리초 단순 HLC(`_u = max(Date.now(), 본 최댓값 + 1)`): 값이 밀리초 크기 그대로라 옛 클라이언트도 지금처럼 비교한다. 옛 클라이언트의 편집은 지금과 같은 규칙(그 기기 시계)으로 겨루고, 새 클라이언트의 편집은 인과 관계를 반영한다. 옛 클라이언트 가운데 시계가 앞선 기기는 새 클라이언트의 시계를 끌어올린다(2절). 새 클라이언트에 Δ 제한을 두면 그런 레코드를 거부하거나 표시하게 되는데, 옛 클라이언트는 같은 판정을 하지 않으므로 판정이 기기마다 달라질 수 있다.
- HLC를 두 필드로 나누기(`_u` = l, 새 필드 = c): 옛 클라이언트는 `_u`만 비교하고 같은 밀리초에서는 기기 id로 정한다. 새 클라이언트는 (l, c, id)로 정하므로 두 판의 결론이 같은 밀리초에서만 어긋날 수 있다(드문 경우지만 수렴이 깨진다). 옛 클라이언트가 레코드를 다시 쓸 때 모르는 필드를 지우는지에 따라 c가 사라질 수 있다.
- 소수 부분에 카운터 넣기(`_u` = 밀리초 + 작은 소수): 숫자 크기는 그대로지만, 옛 판이 정수로 바꾸거나 정수 검사를 하면 깨진다. 확인되지 않은 아이디어이며 출처가 없다.
- 레코드별 카운터를 새 필드로 두기: 옛 클라이언트는 편집할 때 카운터를 올리지 않는다. 새 클라이언트가 카운터를 먼저 비교하면, 옛 클라이언트의 나중 편집이 카운터가 같거나 작다는 이유로 질 수 있다. 「`_u`가 바뀌었는데 카운터가 그대로면 옛 클라이언트의 편집」으로 보는 규칙이 필요하다.
- 버전 벡터를 새 필드로 두기: 옛 클라이언트가 벡터를 그대로 두고 `_u`만 바꾸면, 새 클라이언트는 벡터만 보고 「같은 판」으로 잘못 볼 수 있다. 옛 클라이언트가 벡터를 지우면 그 레코드는 `_u` 비교로 돌아간다. 어느 쪽이든 옛 클라이언트가 만진 레코드는 지금과 같은 LWW로 정해진다.
- 삭제 표시(id와 시각)도 같은 `_u` 규칙을 따르므로 위 결론이 그대로 적용된다.

### 빈 곳(Gaps)
- 옛 앱 판이 모르는 필드를 보존하는지, 정수가 아닌 숫자를 그대로 저장하는지, `_u`의 범위를 검사하는지는 앱 코드에 달려 있고 이번 조사 범위 밖이다. 위 추론은 「숫자로 비교만 한다」는 가정 위에 있다.
- 옛 클라이언트와 새 클라이언트가 섞인 상황에서 HLC를 도입한 실제 사례 글은 찾지 못했다.

## 7. 기법을 나란히 비교하면

### 요점(Takeaway)
이 앱의 조건(기기 1-4개, 서버 없음, 파일 하나 병합, 옛 판과 같은 형식, 「가장 최근」이 중요한 값)에서는 밀리초 단위의 단순 HLC에 넉넉한 앞선 시각 제한을 더한 방식이 비용 대비 이점이 가장 크다. 순수 논리 시계는 오프라인 기기 전환에서 지금보다 나빠질 수 있고, 버전 벡터는 동시 편집을 정확히 알려 주지만 크기, 기기 id 정리, 옛 판 호환의 비용이 크며 알아낸 뒤의 해결 규칙이 따로 필요하다.

### 출처가 있는 사실(Cited Findings)
- 아래 표의 각 칸은 1-6절의 출처를 근거로 한다. 핵심 근거: 램포트 규칙과 이상 동작은 [Lamport 1978](https://lamport.azurewebsites.net/pubs/time-clocks.pdf), HLC 규칙과 상한은 [HLC 2014](https://cse.buffalo.edu/tech-reports/2014-04.pdf), 앞선 시각 제한은 [cockroach `hlc.go`](https://github.com/cockroachdb/cockroach/blob/master/pkg/util/hlc/hlc.go), [MongoDB SERVER-27721](https://jira.mongodb.org/browse/SERVER-27721), [Actual `timestamp.ts`](https://github.com/actualbudget/actual/blob/master/packages/crdt/src/crdt/timestamp.ts), [selfstore PR #108](https://github.com/selfstoredev/selfstore/pull/108), 벡터와 DVV는 [Riak Causal Context](https://docs.riak.com/riak/kv/latest/learn/concepts/causal-context/index.html), [DVV README](https://github.com/ricardobcl/Dotted-Version-Vectors), [riak_core `vclock.erl`](https://github.com/basho/riak_core/blob/develop/src/vclock.erl), LWW의 데이터 손실은 [Kleppmann 강의 노트](https://www.cl.cam.ac.uk/teaching/2122/ConcDisSys/dist-sys-notes.pdf).

### 추론(Inferences)

| 기법 | 보장하는 것 | 정하지 못하는 것 | 레코드당 추가 크기(기기 4개) | 앞선 시각 전파 | 느린 시계 문제(1절 가, 나) | 30일 삭제 표시 수거 | 옛 판(`Date.now()`)과 섞임 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 현재: 벽시각 LWW | 시계가 맞으면 실제 시간 순서 | 인과 관계(느린 시계면 뒤집힘) | 0 | 앞선 기기의 레코드가 그 시각까지 늘 이김(퍼지지는 않음) | (가) 못 고침, (나) 못 고침 | 기기 시계 그대로 | 해당 없음 |
| 램포트 시계(문서 단위) | happened-before면 작은 값 | 동시 여부, 실제 시간 순서 | 0(기기마다 시계 값 저장) | 큰 값이 모두에게 퍼짐 | (가) 고침, (나) 활동량이나 id로 정함(나빠질 수 있음) | 시각 정보 없음, 다른 근거 필요 | 작은 정수면 늘 짐(호환 안 됨) |
| 레코드별 카운터 | 그 레코드의 인과 순서 | 동시 여부, 실제 시간 순서 | 0(`_u` 대신 쓰면) 또는 숫자 필드 하나 | 그 레코드에만 퍼짐 | (가) 고침, (나) 더 많이 고친 쪽이 이김 | 시각 정보 없음 | 새 필드면 옛 판 편집을 놓칠 수 있음 |
| HLC (l, c) | happened-before면 작음, l은 pt에서 ε 이내 | 동시 여부(동시면 l로 정함) | 카운터 필드 하나(또는 문자열) | 퍼짐, Δ 제한으로 막음(거부는 동기화 중단) | (가) 고침, (나) 지금과 같음 | l을 기준으로 쓸 수 있음(Δ 제한이 있을 때) | 두 필드면 같은 밀리초에서만 어긋남, 하나로 담으면 호환 안 됨 |
| 밀리초 단순 HLC (`max(now, 최댓값 + 1)`) | happened-before면 작음, 편집 간격이 1ms 이상이면 pt에 가까움 | 동시 여부(동시면 기기 시각으로 정함) | 0(`_u` 그대로) | 퍼짐(1ms씩 증가), Δ 제한으로 막음 | (가) 고침, (나) 지금과 같음 | `_u` 그대로 기준 가능(오염되면 오래 남음) | 숫자 크기가 같아 비교가 통함 |
| 버전 벡터(기기 id) | 포함 관계와 동시 여부를 정확히 앎 | 동시일 때 무엇이 이길지(규칙 필요) | 약 100바이트(16자 id 기준) | 시각을 쓰지 않으므로 없음(동시일 때 쓰는 시각에는 있음) | (가) 고침, (나) 동시로 알아냄, 해결은 다른 규칙 | 기기마다 병합 위치를 알면 인과적 안정성으로 수거 가능, 사라진 기기 문제 | 옛 판이 벡터를 안 고치면 오판 가능 |
| 점 버전 벡터(DVV) | 동시 판본을 값 단위로 정확히 구분 | 해결 규칙은 따로 | 버전 벡터와 비슷 | 없음 | 버전 벡터와 같음 | 버전 벡터와 같음 | 버전 벡터와 같음 |

- 표에서 「(가)」는 편집 전에 파일을 내려받은 경우, 「(나)」는 내려받지 않고 오프라인에서 편집한 경우다(1절 추론).
- DVV는 서버가 클라이언트의 쓰기를 대신 받는 구조에서 이점이 있으므로, 서버가 없는 이 앱에서는 평범한 버전 벡터와 실질적인 차이가 적다.
- 앞선 시각 제한 Δ는 「사용자 기기 시계의 현실적 최대 오차」보다 커야 한다. 작으면 느린 기기가 정상 데이터를 거부해 동기화가 멈춘다. 실제 값의 범위는 500ms(서버 클러스터, CockroachDB), 5분(개인용 앱, Actual과 selfstore), 1년(MongoDB, 가용성 우선)이다.
- 어느 기법도 1절 (나)의 경우(내려받지 않은 오프라인 편집)를 기기 시계 없이 고치지 못한다. Lamport가 말한 대로 이 정보는 시스템 밖(사용자)에 있다. 고치려면 편집 전에 동기화하도록 하거나(가 경우로 바꾸기), 동시 편집을 남겨 사용자에게 보이는 방법뿐이다.

### 빈 곳(Gaps)
- 사용자 기기(휴대폰, 노트북 브라우저)의 실제 시계 오차 분포에 대한 출처는 이번 조사 범위 밖이라 찾지 않았다. Δ를 정하려면 필요하다.
- 표의 「레코드당 추가 크기」는 JSON 표기를 가정한 어림셈이며 측정값이 아니다.
