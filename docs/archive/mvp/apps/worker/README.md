> **ARCHIVED — 현재 개발 명세가 아닙니다.** 2026-11-03 이전 MVP 기록입니다. 원래 위치: `apps/worker/README.md`. 본문의 요구·금지·완료 주장은 당시 범위이며 후속 작업에 적용하지 않습니다. [현재 개발 기준](../../../../README.md)을 먼저 확인하세요.

# 공유대여 워커

`@sb/worker`는 실제 PostgreSQL outbox와 `pg-boss@12.38.0`을 사용한다. 업무 상태·작업 결과·이벤트는 모두 `@sb/db` 명령으로 저장한다. 워커의 직접 SQL은 미완료 작업을 찾는 읽기 전용 조회뿐이다.

## 실행

```sh
npm run db:up
npm run -w @sb/db migrate
# seed는 공유 DB를 초기화하므로 기존 데이터가 필요 없는 초기 설치 때만 실행한다.
npm run seed -- --scenario default
AI_MODE=live npm run -w @sb/worker dev
# watch 없는 실행
AI_MODE=live npm run -w @sb/worker start
```

두 실행 명령은 루트 `.env`를 값 출력 없이 읽는다. `DATABASE_URL` 기본값은 `postgres://sb:sb@127.0.0.1:54329/sb`이며 API와 같은 DB를 사용한다. `AI_MODE=live`가 기본값이고 `OPENAI_API_KEY`가 필요하다. 모델 설정과 fallback은 `packages/ai/README.md`를 따른다. 테스트는 명시적으로 `AI_MODE=fixture` 포트를 주입한다.

SIGINT/SIGTERM에서 신규 폴링을 중지하고 실행 중 작업의 종료를 최대 60초 기다린 뒤 DB pool을 닫는다. 시작 도중 받은 종료 신호도 queue 초기화와 순서를 맞춘다. `RentalWorker({db, ai})`를 직접 사용하는 호출자는 `worker.stop()` 후 자신이 제공한 `db`를 닫아야 한다.

## 에이전트 실행 관측

기본 AI 포트는 `agent.run` 이벤트로 역할·프롬프트 버전·taskId·처리 시간·MODEL/RESULT 검증 단계·고정 결과 분류만 기록한다. 발화·모델 응답·provider 오류 내용은 포함하지 않는다. 기존 큐·재시도·업무 상태 전이는 유지한다. 주입한 AI 포트의 관측 설정은 호출자가 관리한다.

## 처리와 복구

- outbox는 250ms마다 최대 100행을 읽는다. TASK는 `sb-agent-tasks` 큐로 전송한 후 전달 표시한다. EVENT는 이미 도메인 트랜잭션에서 사용자 이벤트와 PostgreSQL NOTIFY로 저장·전달됐으므로 전달 완료만 표시한다.
- 큐는 taskId를 singleton key로 사용하는 `exclusive` 정책이다. 중복 outbox 전달이나 복구 scan이 실행 중인 동일 task를 동시에 처리하지 않는다. 최종 효과는 DB의 `(taskId, step, canonicalHash(inputVersion))` 유일 키가 보호한다.
- 시작 시와 5초마다 QUEUED/RUNNING 작업을 다시 큐에 넣는다. pg-boss heartbeat는 4초마다 갱신하며 10초 이상 끊긴 작업을 5초 주기의 감시에서 복구한다. 프로세스 강제 종료 후 활성 job은 일반적으로 약 10–17초 안에 재개된다. 큐 작업 제한은 120초다.
- SEARCH는 AI 가격 추천 포트를 `runSearch`에 전달한다. 가격 실패와 실제 8초 초과는 기준금액으로 확정되며 뒤늦은 결과가 quote를 바꾸지 않는다. 검색 자체의 일시적 I/O 실패는 최초 포함 최대 3회, 1초·4초 + 0–250ms jitter로 시도한 뒤 FAILED로 종료한다. 대기 중에는 exclusive lease와 heartbeat를 유지하며 DB 잠금을 잡지 않는다.
- PUBLIC_SUBMIT은 1–2초 지연 후 도메인 명령이 공공 fixture·자격·가용성을 다시 검사한다. 승인은 PUBLIC_DEMO Offer, 거절은 PUBLIC_DEMO_DECLINED, 실행 오류는 PUBLIC_DEMO_ERROR/UNAVAILABLE다. 주민 응답을 생성하는 경로는 없다.
- ROUTE_INTENT 결과 저장은 도메인 명령을 통해 EXTRACT_NEED와 outbox를 생성한다. 추출은 작업의 제안 결과만 저장하며 DRAFT를 수정하지 않는다. EXPLAIN_TERMS/COMPARE_OFFERS도 도메인에서 생성한 작업을 처리하며 실패하면 서버 템플릿을 보존한다. AI 포트 내부의 네트워크 재시도를 워커에서 중복 적용하지 않는다.
- 시작·결과 저장·실패 처리 시 도메인 명령이 root 종료 및 작업별 inputVersion을 검사한다. 취소·만료·바뀐 입력에 대한 늦은 결과는 폐기한다.
- `expireDue()`는 1초마다 실행하며 재시작 직후에도 실행한다. 중첩 sweep은 생략한다. 기본/expiry-fast 모두 이 간격을 사용한다. 사용자 이벤트·멱등 기록의 보존 정리도 도메인 명령이 담당한다.

공공 접수번호 필드는 노출하지 않는다. 현재 계약 엔터티에는 `demoApplicationId`가 없고 PUBLIC_SUBMIT의 AI 결과 저장 스키마도 없으므로 새 필드를 추가하지 않았다. 이 해석은 W2 코디네이터 확인을 받았다.

큐 정책·heartbeat·pending job update의 동작은 [pg-boss 공식 문서](https://pgboss.io/api/workers)와 설치된 12.38.0 타입/구현을 확인했다.

## 검증

```sh
npm run -w @sb/worker typecheck
npm test -w @sb/worker
AI_MODE=live npm run -w @sb/worker smoke:live
```

실행 결과: typecheck 종료 코드 0, 통합 테스트 **15/15 통과**(56.05초), live smoke 종료 코드 0. 주민 응답 테스트를 `APP_MODE=automated-test` 전용 헬퍼로 연결한 뒤 해당 설명·비교 테스트도 다시 통과했다.

통합 테스트는 테스트마다 별도 `sb_test_<uuid>` DB를 만들고 실제 마이그레이션·seed·pg-boss를 실행한 뒤 삭제한다. 공유 `sb` DB를 초기화하지 않는다. 15개 테스트가 다음을 확인한다.

- AT03: 공공 프로젝터 PENDING_PUBLIC → OFFERED, PUBLIC_DEMO 표시, 실제 접수번호 없음, 주민 분기는 AWAITING_OWNER 유지.
- AT15: fixture 오류·timeout·없는 옵션 및 실제 8초 deadline에서 BASELINE, 늦은 추천으로 quote 변경 없음.
- AT17: 중복 outbox/job 효과 1회, 실제 자식 프로세스 SIGKILL 후 활성 공공 작업 복구, 취소 후 늦은 추출 결과 폐기.
- AT18: 후보 없음 NO_MATCH, 공공 사다리 DECLINED/NO_OFFERS, 무응답 분기 NO_OFFERS, root EXPIRED 구분 및 자동 승인 없음. 만료 sweep은 lazy GET을 거치지 않은 저장 상태로도 확인한다.
- ROUTE_INTENT → EXTRACT_NEED와 초안 미변경, 설명·비교 실패의 서버 템플릿, 실제 PostgreSQL 오류에 대한 1초·4초 재시도와 3회 한도, 공공 작업 오류 UNAVAILABLE.

`smoke:live`는 별도 DB에 seed하고 `127.0.0.1:3101`에서 실제 Fastify HTTP 서버와 워커를 실행한다. 하나 세션 → 빈 요청 → draft 수정 → search → 후보·quote 확인 → 공공 submit → OFFERED를 실제 HTTP로 수행하고 종료한다. 세션 쿠키·CSRF·API 키는 보고서에 넣지 않는다. 결과는 `reports/live-<UTC>.json`에 저장한다.

실제 live 검증 기록: 2026-11-01 KST 실행 응답과 로그 (실행 산출물은 공유본에서 제외). `MATCHES_READY`와 공공 `OFFERED`에 도달했으며 주민 프로젝터 두 개는 `AI`(5,000원·2,000원), 공공 프로젝터는 `PUBLIC_FIXED`(3,000원)였다. 음성·실기기 검증은 이 워커 테스트의 범위가 아니다.
