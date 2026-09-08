# Production migration rehearsal — 2026-09-08

이 문서는 `stabilization/production-safety` 브랜치에서 실제 Google Drive, Google Sheets, Apps Script를 사용한 검증 증거다. Production Source of Truth는 계속 Script Properties `swtm2`이다. `swtm_ledger_v5` 운영 포인터, 기존 Web App 배포, main, Pages는 변경하지 않았다.

## 실제 자산과 백업

- 비공개 백업 폴더: `1cgXvSe3c4AM31NAZ2XwYSLIzpioulRg-`; Drive UI에서 실행 계정 소유와 전용 비공개 상태 확인.
- migration candidate: `1b8WiwwkI0WVv4uZaGGHEvzvylqlpk_HyNx5jDOgsV2U`; Drive UI에서 실행 계정 소유와 `나에게만 공개` 확인.
- 원본 백업: `seoul-workstudent-premigration-v1-20260908-221235.json`, 24KB. 파일 생성 후 JSON 재읽기, SHA-256, `swtm2` 불변 검증을 같은 실행에서 통과. 백업 본문은 Git에 저장하지 않음.
- 복구 형식: `seoul-script-properties-raw`, schemaVersion 1. `migrateLegacy_` 도구가 파일 체크섬과 현재 `swtm2` 일치를 재검증한 후에만 이관하므로 실제 복구/이관 도구와 호환됨.

## Sheets API와 Production schema

- 최초 REST 요청: HTTP 403 `PERMISSION_DENIED`; 응답 본문이 Cloud project `824890117808`에서 Google Sheets API가 비활성화됨을 명시.
- 최소 조치: 기존 Apps Script project에 Google Sheets API v4 고급 서비스만 추가. 재요청 HTTP 200, 원장 제목 읽기 성공.
- schema 시트: `students`, `accounts`, `semesters`, `schedules`, `exceptions`, `attendances`, `attendanceAudit`, `extraJobs`, `swaps`, `notices`, `handovers`, `handoverNotes`, `requests`, `settings`, `metadata`.
- 빈 `시트1`을 삭제하지 않고 `students`로 재사용. 모든 시스템 시트에 warning-only 보호 표시 적용. Drive/Sheets UI에서 15개 탭, 헤더, 실제 행 데이터, 비공개 상태를 시각 검수.

## 실제 migration 결과

| 데이터 유형 | 원본 | 신규 Sheets |
|---|---:|---:|
| Students | 9 | 9 |
| Accounts | 10 | 10 |
| Semesters | 1 | 1 |
| Schedules | 35 | 35 |
| Exceptions | 0 | 0 |
| Attendance | 1 | 1 |
| Absences (`Attendance.checkoutType=ABSENT`) | 0 | 0 |
| AttendanceAudit | 0 | 0 |
| ExtraWork (`extraJobs`) | 0 | 0 |
| Substitutions (`swaps`) | 1 | 1 |
| Notices | 0 | 0 |
| Handovers | 0 | 0 |
| HandoverNotes | 1 | 1 |
| Requests | 0 | 0 |

- Admin/Viewer/Student 계정: 4 / 0 / 6.
- 이관 소요: 6,412ms. 이관 후 전체 재읽기: 506ms, 최종 재검증: 530ms.
- 수량: 전부 일치. 누락/ID 중복/관계 누락 0. 원본에서 예상한 이관 대상과 실제 Sheets checksum 일치.
- 과거 근태: 1건의 원본 식별자/학기/site/예정시간/실제시간/상태가 전부 일치, mismatch 0, `REVIEW_REQUIRED` 0.

## 실제 쓰기·복원·동시성

- 단일 round-trip: 후보 Sheets에 검증 필드 쓰기 → 재읽기 → 이관 snapshot 복원. 쓰기 249ms, 복원 304ms, 복원 전/후 checksum 일치.
- Lost Update: 두 Apps Script editor 실행에서 writer A/B를 실제 동시 시작. A는 A를 저장했고, B는 ScriptLock 대기 후 A+B를 모두 재읽기. 최종 검증 `bothRetained=true`; 후보 원장은 이관 checksum으로 복원.
- KST/UTC: `2026-09-08 00:00` ↔ `2026-09-07T15:00:00.000Z`, `2026-12-31 24:00` ↔ `2026-12-31T15:00:00.000Z`; Apps Script `Asia/Seoul` 실환경에서 PASS.
- 세션 경계: 운영 Script Properties의 현재 세션 83개를 본문/토큰 로깅 없이 읽음. 83/83 JSON 파싱, 전부 V4 형식이어서 V5 `authVersion` 검증에서 거부됨. 세션 삭제/변경은 수행하지 않음. 계정 변경 후 세션 revoke는 자동 테스트 66개 세트에 포함.

## 회귀와 Production Gate

- 자동 테스트 66/66, Apps Script/JS 문법 검사 PASS.
- 기존 운영 Web App에 잘못된 자격증명으로 비파괴 로그인 요청: redirect 후 HTTP 200 JSON, 정상적인 자격증명 거부. 기존 배포본 동작 유지.
- rollback: migration 전 raw backup 존재·재읽기 성공, `swtm2` 미변경, `swtm_ledger_v5` 미지정, candidate 최종 checksum 일치. 전환 전 rollback은 기존 배포와 `swtm2` 유지다.
- Production Gate: **BLOCKED**. 미통과 항목은 V5 Web App의 실계정 성공 로그인, Admin/Viewer/Student 역할별 실제 읽기/쓰기, 기존 URL 버전 갱신과 rollback 배포 회귀다. 운영 자격증명 없이 PASS로 추측하지 않음.
- 따라서 main merge, Pages, `swtm_ledger_v5` 포인터 설정, 기존 Web App 배포 갱신을 수행하지 않음. 실제 cutover 직전에는 유지보수 구간에서 원본 백업을 다시 생성해야 함.
