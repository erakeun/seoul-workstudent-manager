# 서울 총무팀 운영 인수인계 및 전환 Runbook

> **상태: 미배포 안정화 후보. 이 문서만 보고 현재 운영 Code.gs를 교체하거나 main을 push하지 마세요.**
> 현재 운영 원장은 여전히 Script Properties `swtm2`입니다. Sheets 전환 완료 문서가 아닙니다.

## 1. 자산과 책임

- 저장소: [kimaj2507-coder/seoul-workstudent-manager](https://github.com/kimaj2507-coder/seoul-workstudent-manager)
- 운영 화면: [GitHub Pages](https://kimaj2507-coder.github.io/seoul-workstudent-manager/)
- Apps Script: `196tmpdJoCKPbTrpA0RqoWKqVkqXtksAsWZkdWiSHgQCseMtDkOqT5aoe`
- Web App: config.js에 있는 기존 `/exec`를 유지. 새 프로젝트/새 URL 생성 금지.
- 현재 main 기준: `42a4ccc86aca8fb9bb6a3df83ae87061264e523b`
- 신규 원장 ID / 소유자 이메일 / 비공개 백업 폴더 ID: **미확정, 운영 담당자 확인 필요**.
- 실행 계정의 Sheets API 및 Drive 권한 승인, 연결 Cloud 프로젝트의 Sheets API 사용 가능 여부: **실제 격리 원장에서 확인 필요**.

## 2. 절대 삭제하면 안 되는 것

기존 Script Properties 전체, `swtm2`, 기존 배포 버전, 원본 백업, 운영 원장, 이전 원장, 증명사진 폴더와 파일을 삭제하지 마세요. `initialize()` 또는 Properties 초기화 금지. 백업에 비밀번호 해시·salt·개인정보가 들어 있으므로 GitHub, 공유 게시판, 채팅에 업로드하지 않습니다.

신규 코드의 일반 쓰기는 Sheets만 사용하며, Sheets 오류 시 `swtm2`로 자동 복귀하지 않습니다. 이중 쓰기도 하지 않습니다. 사진 교체 때 이전 파일을 삭제하지 않아 예전 백업의 연결을 유지합니다. 파일 정리는 별도 보존 정책을 승인받은 뒤 판단합니다.

## 3. 신규 원장 구조

Sheets를 선택한 이유는 수십 명 규모, 담당자의 원본 열람, 기존 Apps Script 연동입니다. 한 셀에 전체 JSON을 넣지 않습니다. 엔티티 1개=행 1개, 필드=열입니다.

| 시트 | 내용 |
|---|---|
| students | 학생, 계정과 독립된 ID, 사진 연결, 학기 참여/종료 효력일 |
| accounts | 로그인 계정, 학생 연결, 역할, 해시/salt, authVersion |
| semesters | 학기 기간과 예산 설정 |
| schedules / exceptions | 기본 일정과 날짜별 예외 |
| attendances | 출퇴근, 결근, 당시에 기록한 근무 사실 스냅샷 |
| attendanceAudit | 관리자 보정/결근 취소 이력 |
| extraJobs / swaps | 구인·지원자·확정 및 대타 |
| notices / handovers / handoverNotes | 공지, 자료 인수인계, 공유 메모 |
| settings / metadata | 운영 학기와 버전·이관 체크섬 등 |
| requests | 중복 요청 방지용 영수증, 세션 토큰은 포함하지 않음 |

값의 자료형·빈 문자열·중첩 필드 보존을 위해 셀 값은 필드별 JSON 표현입니다. 신청자 배열·예산·스냅샷 등 작은 복합 필드는 별도 열의 JSON입니다. 큰 단일 필드는 저장 전에 거부합니다. `_order`는 원본 배열 순서를 보존합니다. 날짜/시각은 문자열로 보관하여 Sheets의 지역별 자동 날짜 변환을 사용하지 않습니다. 수식처럼 보이는 입력도 `stringValue`로 저장합니다.

한 API 요청에서 원장을 한 번 읽어 요청 내 캐시에 두고, 변경된 행만 하나의 Sheets batchUpdate로 저장합니다. 모든 API는 같은 ScriptLock을 사용합니다. [Google의 batchUpdate 원자성 설명](https://developers.google.com/workspace/sheets/api/guides/batch).

### 직접 편집 규칙

- 직접 해도 되는 것: 열람, 필터 보기, 개인용 별도 복사본에서의 분석.
- 앱에서만 변경: 학생 상태/근무지, 학기 참여, 일정, 공지, 계정, 근태 보정.
- 직접 변경 금지: 헤더, ID, `_order`, revision, authVersion, passwordHash/salt, 스냅샷, JSON 형식, 운영 포인터.
- 준비 도구는 시스템 시트에 경고 보호를 둡니다. 보안 경계는 보호 경고가 아니라 **파일을 실행 소유자만 열 수 있게 하는 권한**입니다. 학생·Viewer·일반 공동편집자에게 원장 파일을 공유하지 않습니다.

## 4. 전환 전 Gate — 현재 통과하지 못함

1. 운영 소유자와 Apps Script 편집·재배포 권한 확인. 현재 CLI에서 프로젝트 content 조회는 HTTP 403.
2. 소유자가 선택한 비공개 백업 폴더와 신규 빈 Sheets 확보. 자동 생성/소유권 추측 금지.
3. 기존 Code.gs를 바꾸기 전에 `PreMigrationBackup.gs` **하나만** 별도 파일로 추가. 상단 두 값에 확인된 비밀 아닌 폴더 ID/소유자 이메일 입력. `createPreMigrationBackup()` 실행 후 반환된 파일 ID·체크섬과 legacyUnchanged 확인. 민감한 결과 본문을 로그로 출력하지 않음.
4. 백업 파일의 다운로드·접근 가능성을 확인. 기존 V4 사용자도 쓰기를 중단한 유지보수 구간에 최종 백업을 다시 확보해야 함. V4는 잠금에 참여하지 않는 쓰기가 있어 V5 잠금만으로 전환 순간을 보호할 수 없음.
5. 별도 격리 Sheets에 정상/실패/재실행 이관, 복원 round-trip, 소유권/사진 접근, Sheets API 권한과 실제 응답시간을 시험.
6. 아래 도구의 helper는 이름 끝 `_`로 웹 API에서 호출할 수 없음. 담당자가 검토한 일회용 편집기 wrapper에서 명시적인 자산 ID를 전달. 현시점에는 어느 helper도 운영에서 실행하지 않았음.
7. 운영 데이터 수량·관계·체크섬 비교, 불확실한 과거 근태 확인, 실계정 권한 회귀와 동시 사용자 시험이 모두 통과해야 전환 검토 가능.

**중요: 현재 자동 cutover 오케스트레이터와 실제 유지보수 전환 리허설은 완료되지 않았습니다. 아래 순서의 각 Gate가 확인되기 전 main 반영/운영 재배포 금지.**

## 5. 이관 도구 사용 순서

`Storage.gs`의 `prepareLedger_(sheetId,ownerEmail)`는 확인된 비공개 원장에 필요한 시트를 준비합니다. 기존 행을 삭제하지 않습니다.

`rehearseMigration_(rawSwtm2)`는 원본 문자열을 수정하지 않고 정규화·관계·중복·checksum·직렬화 왕복을 검증합니다. 기존 근태의 studentId/semester/site/날짜/예정시간만으로 확정 가능한 기록을 backfill합니다. 현재 시간표에서 과거 시간을 추측하지 않습니다. 불완전한 기록은 `REVIEW_REQUIRED`이며 자동 전환을 막습니다.

`migrateLegacy_(sheetId,rawBackupFileId,ownerEmail)`는 백업의 swtm2가 현재 원본과 같은지 확인하고 비운영 원장에 적재합니다. 큰 자료는 한 번에 활성 원장에 쓰지 않고 격리 원장에 분할 적재합니다. 동일 체크섬 재실행은 안전하고, 다른 데이터를 기존 이관 대상으로 덮어쓰지 않습니다. 실패 시 운영 포인터는 그대로입니다.

`activateLedger_(sheetId,ownerEmail,expectedChecksum)`는 원본·대상 checksum과 REVIEW_REQUIRED 부재를 다시 검사한 뒤 `swtm_ledger_v5` 포인터만 지정합니다. 기존 `swtm2`는 **LEGACY / READ ONLY / ROLLBACK ONLY**입니다. 이 함수만 성공했다고 전체 배포 성공은 아닙니다.

Apps Script V5에는 `Code.gs`, `Storage.gs`, `Stability.gs`가 함께 있어야 합니다. 미리 정한 유지보수 구간, 원본 최종 백업, 격리 검증, 기존 Deployment 새 버전 및 Pages의 호환 세트 반영이 필요합니다. 기존 URL을 유지합니다. 구버전 화면은 V5 쓰기에서 명시적으로 거부되므로, 운영 중 사용자에게 구버전 화면이 남지 않도록 재접속 안내와 배포 검증이 필요합니다.

## 6. 평상시 운영

- 학생 추가: 학생 관리에서 등록. 로그인 계정은 선택적으로 별도 생성/연결.
- 계정 연결·권한·비밀번호 변경: 해당 계정의 기존 모든 세션이 무효화되어 다시 로그인해야 함. 마지막 활성 Admin은 해제할 수 없음.
- 새 학기: 생성만으로 운영 학기가 바뀌지 않음. 상단 **조회 학기**는 개인 화면 선택. 운영 학기 전환은 학기 관리의 명시적 버튼으로만 수행.
- 참여/종료: 학생 수정에서 조회 학기 참여와 종료 효력일 지정. 완료 근태는 스냅샷으로 유지. 이전 학기 학생 레코드 삭제 금지.
- 일정: 서버가 겹치는 실제 근무를 차단. 이미 근태가 있는 당일·미래 일정은 일반 수정 대신 담당자 확인/근태 보정 절차로 처리.
- 출근/퇴근: 학생 본인만 수행. 퇴근 미입력은 기존 정책대로 예정 종료를 사용하며, 출근 없는 기록을 정상 근무로 만들지 않음.
- 근태 보정: 한국 시간으로 입력, UTC timestamp 저장. 사유와 전후 이력 보존. 저장 후 다시 열어 시간 확인.
- 새로고침: 상단 버튼으로 서버 재조회. timeout 후에는 저장 여부가 불명확할 수 있으므로 재조회 후 판단. 무조건 다시 등록하지 않음.
- 미확인 과거 기록: migration에서 반환된 attendanceId 목록을 담당자가 원본 자료와 대조. 불확실한 기록의 해결 도구/운영 절차는 실제 자료 확인 후 추가 검증 필요.

## 7. 전체 백업과 복원

### 백업

Admin → 데이터 관리 → 전체 백업. schemaVersion=5. 학생·계정 해시/salt·연결·학기·일정·예외·근태/결근·보정이력·추가근무·대타·공지·메모·설정·사진 파일 연결을 포함합니다. 세션 토큰은 포함하지 않습니다. 사진 **바이트 자체는 포함하지 않으며 Drive 파일이 보존되어 있어야** 합니다. Drive 자산 자체를 잃은 재해는 JSON 하나만으로 복구하지 못합니다.

### 소규모 복원

지원하는 V5 백업만 선택 → 현재 백업 먼저 다운로드 → 경고 확인 → 현재 checksum 일치 확인 → 원자적 복원 → 모든 세션 종료 → 재로그인. 전체 요청이 내부 안전 한도(1.8MB)를 넘으면 **쓰지 않고 거부**합니다. 저장 실패 시 성공을 표시하지 않습니다.

### 대용량/재해 복원

소유자가 새 비공개 빈 원장을 준비한 후 `restoreToPreparedLedger_(backupFileId,newSheetId,ownerEmail,expectedCurrentChecksum)`를 검토·실행합니다. 새 원장에 분할 적재→전체 read-back checksum→단일 포인터 전환 순서이며 이전 원장은 보존합니다. 현재 세션보다 높은 authVersion으로 모두 재인증합니다. 실제 Sheets에서의 최종 리허설은 **미완료**입니다.

## 8. 장애 및 rollback

| 상황 | 조치 | 데이터 주의 |
|---|---|---|
| A. 신규 원장 읽기 실패 | 사용자 쓰기 중단, 소유자 접근·파일 위치·Sheets API/쿼터 확인 | swtm2 자동 복귀 금지 |
| B. 이관 누락 | 포인터 전환 전이면 대상 원장 비운영 유지, 원본 checksum으로 재검증 | 원본/실패 대상 둘 다 보존 |
| C. 새 Apps Script 버전 오류 | 신규 쓰기 중단, 현재 Sheets 전체 백업, 확인된 호환 버전으로 기존 Deployment 변경 | V4로 무작정 되돌리면 신규 Sheets 기록이 보이지 않음 |
| D. 새 Pages 오류 | 호환 API 계약을 유지하는 확인된 프론트 버전으로만 복귀 | 옛 화면의 전체 상태 저장은 V5에서 차단됨 |
| E. 쓰기 실패/응답 유실 | 새로고침으로 반영 여부 조회, 요청 영수증/로그와 확인 | 재시도로 중복 생성하지 않도록 주의 |

신규 쓰기가 **한 건도 없고** 최종 원본과 checksum이 같은 경우만 V4 코드/프론트와 legacy 사용으로 되돌리는 것을 검토할 수 있습니다. 신규 쓰기가 있다면 최신 Sheets 백업을 먼저 확보하고 V5 호환 복구 또는 검증된 새 원장 복원을 수행합니다. 최신 데이터를 버리는 자동 역이관은 제공하지 않습니다. 현재로서는 어느 버전을 실제 rollback 대상으로 선택할지 격리 배포 검증이 추가로 필요합니다.

## 9. 검증 명령과 한계

```sh
npm test
npm run check
npm run preview:stability
```

프리뷰는 localhost 메모리 전용이며 `admin`, `viewer`, `a` / `preview-only`는 **격리 테스트 계정**입니다. 운영 자격증명이 아닙니다. 서버 종료 시 시험 데이터는 사라집니다. 이 계정을 운영에 생성하지 마세요.

Node 테스트와 Sheets 계약 모형은 실제 Google의 동시 요청·쿼터·레이턴시 시험을 대신하지 않습니다. 현재 운영 계정 성공 로그인, 실제 원장 이관, 사진 실파일 복원, 실제 배포 cutover/rollback 검증이 남아 있습니다. 이를 통과하기 전 ‘Production 안정화 완료’로 취급하지 않습니다.
