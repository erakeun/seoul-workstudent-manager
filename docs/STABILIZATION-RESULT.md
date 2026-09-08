# 서울 총무팀 근로장학생 관리 시스템 Production 안정화 결과

작성일: 2026-09-08 / 기준 main: `42a4ccc86aca8fb9bb6a3df83ae87061264e523b`

**중간 인계 보고: 로컬 후보와 실제 Google Sheets migration rehearsal까지 완료, Production 전환은 중단. 안정화 완료 보고가 아닙니다.**

운영 `swtm2`와 기존 Web App 배포/main/Pages는 수정하지 않았습니다. Apps Script HEAD에만 owner-run 백업/리허설 helper와 Google Sheets API 서비스를 추가했고, 후보 Sheets에만 스키마·이관 데이터를 작성했습니다. 실환경 결과는 `docs/PRODUCTION-MIGRATION-REHEARSAL-2026-09-08.md`를 기준으로 합니다.

## ■ 최종 판정

- Production 운영 가능: **NO — 이번 안정화 세트 미배포. 기존 Audit의 위험이 운영에 남아 있음.**
- 근태 원장 신뢰성: 운영 기준 미해결. 로컬 격리 재현에서는 개선 확인.
- 다음 학기 전환 가능: CONDITIONAL — 로컬 참여/조회 분리 검증은 통과, 실제 원장/계정 검증 필요.
- 전체 위험도: 현재 운영 높음. 로컬 테스트 통과를 운영 해결로 간주하지 않음.
- Production Source of Truth: **기존 Script Properties `swtm2`**.
- Legacy Rollback Snapshot: 아직 별도 확보하지 않음. 현재 swtm2는 여전히 운영 원본이며, 전환 이후에만 read-only legacy가 됨.

## ■ P0 재검증

최신 main의 six baseline tests는 독립 재현하여 모두 CONFIRMED. 운영 편집기의 프로젝트와 V4 시작 부분은 확인했으나 CLI의 프로젝트 content 조회는 HTTP 403이므로 **실제 배포 코드 전체 대조는 PARTIALLY CONFIRMED**입니다. 이 한계를 최신 main 재현 결과와 구분합니다.

| 항목 | 최초 판정(main) | 로컬 조치·재검증 | 최종 판정(Production) |
|---|---|---|---|
| P0-1 저장 용량 | CONFIRMED | Sheets 행/필드 저장, 30명/4학기/6,240근태, 작은 변경 행 저장 검증 | UNRESOLVED — 실제 원장 생성/이관 미실행 |
| P0-2 Lost Update | CONFIRMED | 전체 상태 저장 차단, 엔티티/필드 mutation, revision, 공통 Lock, 원자적 batch | UNRESOLVED — 운영 코드 미반영 |
| P0-3 과거 근태 | CONFIRMED | 기록 사실 스냅샷, 180분 보존·삭제 후 조회·당시 site 보존, 불확실 backfill 보류 | UNRESOLVED — 운영 자료 backfill 미검증 |
| P0-4 KST/UTC | CONFIRMED | 명시적 +09:00 입력 변환, 자정/밀리초 및 무수정 보정 테스트 | UNRESOLVED — 운영 화면 미반영 |
| P0-5 백업/복원 | CONFIRMED | V5 전체 envelope, 계정/근태/메모/사진 연결, checksum, 소규모 원자 복원·대용량 격리 적재 도구 | UNRESOLVED — 운영 원본 백업/실제 Sheets 복원 미검증 |
| P0-6 세션 | CONFIRMED | authVersion 비교, 권한/비밀번호/연결 변경 및 복원 시 회수 | UNRESOLVED — 운영 코드 미반영 |

P0의 로컬 재현은 모두 통과했지만, 운영에서 RESOLVED로 표기할 조건은 충족하지 않았습니다.

## ■ 저장구조

- 기존 구조: 단일 Script Property JSON. baseline seed 8,259 bytes, 근태 3건 추가로 9KiB 초과.
- 신규 구조: Google Sheets, 엔티티별 시트·행·필드 열. 전체 JSON을 한 셀에 보관하지 않음.
- 데이터 원장: 실제 신규 원장 ID/소유자 미확정.
- migration 방식: 원본 읽기 → 비운영 원장 적재 → 수량/관계/checksum read-back → 명시적 포인터 전환. 원본 삭제·dual write 없음.
- migration rehearsal: 메모리 및 Sheets 계약 모형 통과. 큰 격리 적재의 중간 실패/재실행/idempotency 통과.
- Production migration: **미실행**.
- 데이터 무결성: 중복 ID, 계정-학생, 일정/근태-학기, 대타/추가근무-학생 관계 검사. 운영 데이터에 적용한 수량·checksum은 아직 없음.
- Legacy 보존: 운영 원본 변경 없음. 신규 코드는 legacy 쓰기/자동 fallback을 하지 않음.

## ■ 동시성

- 엔티티 단위 mutation: 학생/학기/일정/예외/공지/자료/설정은 변경 엔티티와 허용 필드만 수신. 기존 `adminSaveData` 차단.
- LockService: 웹 API 공통 경계에서 인증·읽기·검증·commit을 잠금. 중첩 잠금은 한 번만 획득.
- revision/충돌 감지: 오래된 동일 엔티티 수정 거부. 계정/구인/대타 관리도 revision 확인.
- 동시 사용자 테스트: Admin A 학생 변경, Student 출근, Admin B 공지, Student 메모 순서를 격리 실행하여 모두 보존. 실제 Google 다중 실행 부하 시험은 미수행.
- Lost Update 재현 결과: baseline에서는 소실, 수정 후보에서는 독립 변경 보존·충돌 오류.

## ■ 근태

- 완료 근무 스냅샷: 예정시간/실제 근무자/site/source/인정시간을 보존. 신규 기록의 당시 단가도 스냅샷에 보존.
- 기존 근태 backfill: 저장된 근태 사실만 사용. 불완전 날짜/시간/관계는 REVIEW_REQUIRED, 원래 대타 여부를 모르면 UNKNOWN_LEGACY. 현재 일정으로 과거를 추측하지 않음.
- 시간표 변경 후 과거 근태: 180분 유지, 원본 일정 삭제 후에도 스냅샷 조회 확인.
- 근무지 변경 후 과거 근태: 당시 site 유지. 미래 기본 일정에는 효력 경계를 둠.
- 대타 변경 후 과거 근태: 저장된 worker 유지. 이미 근태가 있는 당일·미래 source 변경 차단.
- 9시간 보정 문제: 명시적 KST↔UTC 왕복 확인, 초·밀리초 보존.
- 남은 한계: 실제 운영 backfill 검증, 불확실 기록의 담당자 대조·정정 경로, 이미 날짜·site가 잘못된 과거 원본의 복구는 아직 미확인.

## ■ 백업/복원

- 백업 범위: 학생, 인증 해시/salt 포함 계정/연결, 학기, 일정/예외, 근태/결근/보정이력, 대타/추가근무, 공지/자료/메모, 설정, 사진 파일 ID.
- 복원 범위: 위 데이터. 세션은 복원하지 않고 모두 회수. 요청 영수증은 초기화.
- schemaVersion: 5, 지원하지 않는 버전/불일치 checksum 거부.
- 실제 round-trip 테스트: **격리 API A→B→A 통과**, 근태/메모 보존. 운영 복원·실제 Sheets round-trip 미수행.
- 복구 문서: `docs/PRODUCTION-RUNBOOK.md`.
- 제한: 사진 바이트는 JSON에 없고 기존 Drive 파일 보존이 필요. 한 번의 원자 요청이 1.8MB 초과하면 쓰지 않고 거부, 비운영 신규 원장에 분할 복원 후 전환하는 별도 도구 사용.
- 원본 백업: 사전 전용 helper 준비, 실행하지 않음. 민감한 백업 파일/dump를 Git에 저장하지 않음.

## ■ 인증/권한

- 비밀번호 변경 세션 회수: 로컬 다중 토큰 시험 통과.
- 계정 재연결 세션 회수: A→B 후 기존 토큰 인증 거부.
- role 변경 세션 회수: 변경 후 재인증 필요.
- 마지막 Admin 보호: 비활성/권한 강등/삭제 서버 차단.
- Student 최소정보: 같은 site의 필드 allowlist, 내부 관리자 메모·다른 신청 사유·계정 author ID·인증정보·단가 제외. 본인 메모 삭제 가능 여부는 boolean.
- Viewer 쓰기 차단: 관리자 endpoint 10종을 Student/Viewer 각각 거부하는 격리 시험 통과.
- 실제 성공 로그인: localhost 격리 Admin/Viewer/Student만 검증. 운영 실계정 비밀번호를 사용하지 않음.

## ■ P1

아래 상태는 로컬 후보 기준이며, 전부 운영 반영 전입니다.

| 항목 | 상태 | 근거/남은 조건 |
|---|---|---|
| 저장 완료 UX | PARTIALLY RESOLVED | Admin 브라우저 저장 성공 확인 후 모달 종료. timeout 오류/서버 실패 검사. 실제 네트워크 단절 E2E는 추가 필요 |
| Student 최소정보 | RESOLVED (격리) | 서버 DTO 비밀 표식 누출 없음, 본인 메모 권한 유지 |
| 마지막 Admin | RESOLVED (격리) | 서버 거부 시험 |
| Viewer 검색/필터 | RESOLVED (격리) | 이름 검색으로 행 0개 확인, 상태 복합 필터 수정 |
| Viewer 당일 근태 | PARTIALLY RESOLVED | 정오 경계 수정. 실제 오전 운영 화면 추가 검증 필요 |
| Viewer 모바일 | RESOLVED (격리) | 390px viewport에서 전체 페이지 390px, 표는 카드 안에서 스크롤 |
| Student 모바일 로그아웃 | RESOLVED (격리) | 버튼 보임·클릭 후 로그인 화면 복귀 |
| 일정 중복 | PARTIALLY RESOLVED | 정규/다른 site/추가근무 충돌, 기록된 일정 변경 차단. 운영 전체 예외 조합 추가 검증 필요 |
| 운영/조회 학기 분리 | RESOLVED (격리) | 보기 선택은 로컬 상태, 신규 학기 생성은 activeSemester 유지 |
| 학기별 학생 참여 | PARTIALLY RESOLVED | 기존 semesterIds 활용, 종료일 UI/서버 반영. 실제 학생 교체 리허설 필요 |
| 비활성 학생 미래 일정 | PARTIALLY RESOLVED | 서버/화면 참여 필터, 스냅샷 보존. 운영 근무지 이동/대타 혼합 추가 검증 필요 |
| 자동 polling/실시간 | DEFERRED | 명시적 새로고침만 추가. 재조회 누락 민원이 반복되면 검토 |
| 메모 200건 제한/이전 목록 | DEFERRED | 이번 선택 P1 외 기존 기능을 확대하지 않음. 200건 근접 시 운영 피드백으로 별도 보완 |
| CSV/복사/전면 UI 개편 | DEFERRED | 요청에서 제외한 기능. 제출 양식/반복 작업 요구가 확정될 때만 검토 |

## ■ 테스트

- 기존 테스트: 30건의 의도 유지, 폐기된 전체 저장 호출을 새 엔티티 mutation 호출로 변경.
- 신규 안정화 테스트: baseline 6 + 후보/저장 30 = 추가 36. **총 66/66 통과**.
- 운영 규모 시뮬레이션: 30명, 4학기, 주 3회 기본 일정 360건, 근태 6,240건, 메모 350건, 공지 20건. 약 3.7MB. Node/계약 모형 왕복·단일 행 수정 약 2초 이내였으며 Google 응답시간 수치가 아님.
- 동시성 테스트: 가능한 요청 순서/중복 요청/동일 엔티티 충돌 검사. 실제 클라우드 동시 실행은 미검증.
- 실패 상황 테스트: 저장 실패, batch 실패, 분할 적재 중간 실패/재실행, 중복 요청, 잘못된 관계/백업, stale restore, 무효 세션, 권한 없는 API 거부.
- 전체 회귀: 주요 단위/계약·격리 브라우저 검증. 운영 데이터 전체 회귀 완료라고 보고하지 않음.
- JS 문법: 통과.
- Apps Script 문법: 모든 .gs를 함께 파싱하여 통과. Google 런타임 실제 실행은 미검증.
- 실제 Pages Smoke Test: index/config/app/styles HTTP 200, 모두 기존 main과 SHA-256 일치. 무효 세션 API HTTP 200 JSON, 정상 인증 거부, CORS `*`. 변경 배포본 smoke test는 아님.

## ■ 배포

- Apps Script 운영본: 수정하지 않음. content API 403 때문에 전체 자동 대조 불가.
- Apps Script 배포 버전: 새 버전 생성/갱신 안 함. 이전 감사에서 확인한 버전 5의 재배포를 이번에 성공했다고 주장하지 않음.
- Web App URL 변경 여부: 없음.
- GitHub main: `42a4ccc`, 변경/push 안 함.
- 주요 로컬 커밋: `d76d39d` baseline, `4f4efc6` backend safety, `64e7248` client/tests. 후속 문서·마감 검증 커밋은 git log 참조.
- GitHub Pages: 기존 서비스 그대로 유지.
- 운영 파일 검증: 기존 main 일치. 신규 프론트만 선배포하지 않음.

## ■ Rollback

- rollback 준비: 상황 A~E와 데이터 보존 원칙 문서화, 기존 원장을 삭제하지 않는 도구 구현.
- rollback 대상: 현재 운영은 미변경이므로 지금 되돌릴 작업 없음. 신규 배포 시 실제 확인된 호환 버전 선정과 리허설 필요.
- legacy 데이터: 미변경, 운영 원본 그대로.
- 주의사항: 신규 Sheets 쓰기가 발생한 뒤 V4로 단순 복귀하면 새 기록이 보이지 않음. 최신 백업 확보 후 V5 호환 복원 사용. 자동 reverse migration 없음.

## ■ 운영 문서

- 문서 위치: `docs/PRODUCTION-RUNBOOK.md`, `backend/README.md`의 경고 안내.
- 일반 담당자 인수인계 가능 여부: CONDITIONAL. 절차 초안은 준비됐지만 실제 원장/폴더/소유자 ID와 실환경 리허설 결과를 채워야 운영 완료 문서가 됨.

## ■ 최종 10문항 — 현재 Production 기준

1. 실제 운영 가능: **NO** — Audit P0의 운영 반영 미완료.
2. 근태 기록 신뢰 가능: **NO** — 운영은 여전히 기존 계산 구조.
3. 장기 데이터 누적 안전: **NO** — 단일 Property가 현재 원장.
4. 동시 사용 안전: **NO** — 운영 코드 미교체.
5. 과거 근태 보존: **NO** — 운영 스냅샷 미이관.
6. 전체 복구 가능: **CONDITIONAL** — V5 전환·실제 복원 리허설·Drive 자산 보존 필요.
7. 세션 회수 안전: **NO** — 운영에는 기존 세션 로직.
8. 다음 학기 학생 교체 가능: **CONDITIONAL** — 신규 참여/종료 기능 실환경 검증 후 가능.
9. 일반 운영자 복구 가능: **CONDITIONAL** — 자산 위치 확정과 소유자 복구 연습 필요.
10. 신규 개발 중단 후 운영 전환 가능: **NO** — 기능 확대는 중단하되, 아래 Gate 해결 후 안정화 검증을 마쳐야 함.

## ■ 내가 직접 해야 할 작업

1. 운영 Apps Script 프로젝트에 접근 가능한 최종 담당자 Google 계정으로 CLI 인증을 연결하거나 해당 계정의 편집/배포 권한을 확인. 현재 인증의 content API 응답은 403.
2. **최종 Google 소유자 이메일, 소유자 전용 비공개 백업 폴더 ID, 소유자 전용 신규 빈 Sheets ID**를 확정. 비밀번호·토큰은 전달하지 않음.
3. 원본 백업 및 실제 격리 Sheets 리허설 결과를 확인한 뒤 유지보수 전환 시간을 정함. 이 조건들이 확보되면 코드/백업·migration·권한·실배포·rollback Gate 검증을 이어갈 수 있음. 아직 main merge/배포는 하지 말 것.

현재 사용자에게 운영 migration을 바로 실행하라고 요청하는 것이 아닙니다. 우선 권한과 비공개 자산을 확인해야 합니다.
