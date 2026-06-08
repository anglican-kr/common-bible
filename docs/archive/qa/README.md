# QA 보고서

`docs/archive/qa/`는 자동 테스트(e2e + 유닛) 실행 결과와 신규 시나리오 추가 내역을 기록하는 공간입니다. 회귀 발견 시 이력을 추적하고, 향후 작업자(개발자가 아니어도)가 "현재 어디까지 자동 검증되는가"를 한눈에 파악할 수 있도록 합니다.

## 파일명 컨벤션

```
YYYY-MM-DD-e2e-{topic}.md      # 브라우저 통합 테스트 (Playwright)
YYYY-MM-DD-unit-{topic}.md     # 유닛 테스트 (node --test, ADR-013)
```

- `topic`은 Phase 또는 도메인 이름 (예: `infrastructure`, `1.3.0-features`, `bookmark-domain`, `settings`, `audio`, `search-nav`, `a11y`, `regression-baseline`, `storage`, `helpers`)
- 동일 토픽을 다시 검증할 경우 새 날짜로 새 파일을 생성 (덮어쓰지 않음)
- `docs/archive/audit/`와 같은 컨벤션을 따름

## 톤

- 비기술 독자(성공회 신자·일반 사용자)도 이해할 수 있는 일상 언어 우선. `feedback_release_notes` 메모리 톤과 같은 기준.
- 기술 식별자(파일·함수·옵션 이름)는 부록 섹션으로 분리하거나 최소화.
- 사용자가 체감하는 동작("앱이 멈추지 않는지", "다시 열어도 같은 위치인지") 중심.

## 보고서 템플릿

```markdown
# E2E 테스트 보고서: {Phase 또는 토픽 이름}

**날짜:** YYYY-MM-DD
**범위:** Phase N — {간단 설명}
**작성자:** {이름}

## 1. 실행 환경

- Python: 3.x.x
- pytest: x.x.x
- playwright: x.x.x
- Chromium: xxx
- 개발 서버: `python3 scripts/serve.py 8080`
- OS: Linux x.x.x

## 2. 실행 결과

| 항목 | 값 |
|------|----|
| 신규 테스트 | N건 |
| 전체 e2e 테스트 | N건 |
| 통과 | N건 |
| 실패 | N건 |
| 스킵 | N건 |
| 소요 시간 | N초 |

```bash
pytest tests/e2e/ -v
# (필요 시 출력 발췌)
```

## 3. 신규/변경된 시나리오

- `tests/e2e/test_xxx.py::test_yyy` — 검증 대상 한 줄 설명
- ...

## 4. 발견된 이슈

(없으면 "없음" 명시)

| # | 심각도 | 위치 | 증상 | 후속 조치 |
|---|--------|------|------|----------|
| 1 | medium | js/app.js:NNN | ... | 별도 이슈 #NN로 분리 |

## 5. 비고

- (선택) 알려진 한계, skip된 테스트 사유, 다음 Phase 인계 사항
```

## 검증 절차 (각 Phase 종료 시)

1. 개발 서버 기동: `python3 scripts/serve.py 8080`
2. 신규 테스트 실행: `pytest tests/e2e/test_{phase_topic}.py -v`
3. 전체 회귀 실행: `pytest tests/e2e/ -v`
4. 결과를 위 템플릿에 따라 `docs/archive/qa/YYYY-MM-DD-e2e-{topic}.md`에 기록
5. 신규 테스트 + 수정된 fixture/헬퍼 + QA 보고서를 단일 커밋으로
   - 메시지: `test: e2e {phase 주제} 커버리지 추가 + QA 보고서`

## 진행 현황

전체 Phase 계획은 `~/.claude/plans/declarative-brewing-puppy.md` 참조 (로컬 전용, git에는 포함되지 않음).
