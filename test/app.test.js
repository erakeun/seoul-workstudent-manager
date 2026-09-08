import test from 'node:test';
import assert from 'node:assert/strict';
import { attendanceForEvent, calculateBudget, composeStudentDashboardFlow, eventsForDate, filterDataForStudent, handoverNotesForSite, hasTimeConflict, lanes, linkedStudentAccount, normalizeData, recognizedAttendance, renderHandoverNotePanel, scheduleOccursOn, statusFor, visibleWeekdays } from '../app.js';

const data = { schedules: [
  { id: 'monday', site: 'general', studentName: '권기재', kind: 'weekly', weekday: 1, start: '08:30', end: '12:00' },
  { id: 'date', site: 'general', studentName: '최인승', kind: 'date', date: '2026-09-07', start: '13:00', end: '17:00' },
  { id: 'holmz', site: 'holmz', studentName: '한상윤', kind: 'weekly', weekday: 1, start: '12:00', end: '15:00' }
] };
test('weekly and date schedules expand on the correct calendar date', () => {
  const monday = new Date('2026-09-07T12:00:00');
  assert.equal(eventsForDate(data, 'general', monday).length, 2);
  assert.equal(eventsForDate(data, 'general', new Date('2026-09-08T12:00:00')).length, 0);
  assert.ok(scheduleOccursOn(data.schedules[0], monday));
});
test('today state uses current time boundaries', () => {
  const item = data.schedules[0];
  assert.equal(statusFor(item, new Date('2026-09-07T08:00:00')), '근무 예정');
  assert.equal(statusFor(item, new Date('2026-09-07T09:00:00')), '현재 근무');
  assert.equal(statusFor(item, new Date('2026-09-07T12:00:00')), '종료');
});
test('overlapping schedules receive separate lanes', () => {
  const result = lanes([{start:'09:00',end:'11:00'},{start:'09:30',end:'10:30'},{start:'11:00',end:'12:00'}]);
  assert.equal(result[0].lane, 0);
  assert.equal(result[1].lane, 1);
  assert.equal(result[2].lane, 0);
});

test('legacy data migrates without deleting existing records', () => {
  const migrated = normalizeData({ students:[{id:'s1',name:'학생',site:'general',type:'교내근로'}], schedules:[{id:'w1',site:'general',studentId:'s1',studentName:'학생',kind:'weekly',weekday:1,start:'09:00',end:'10:00'}] });
  assert.equal(migrated.version, 4);
  assert.equal(migrated.students[0].name, '학생');
  assert.match(migrated.students[0].color, /^#[0-9a-f]{6}$/i);
  assert.equal(migrated.schedules[0].semesterId, migrated.settings.activeSemesterId);
  assert.deepEqual(migrated.exceptions, []);
  assert.deepEqual(migrated.extraJobs, []);
  assert.deepEqual(migrated.attendances, []);
  assert.deepEqual(migrated.attendanceAudit, []);
  assert.deepEqual(migrated.handoverNotes, []);
});

test('handover notes are newest first and stay within the student workplace payload', () => {
  const d=normalizeData({students:[{id:'g1',name:'총무 학생',site:'general'},{id:'h1',name:'HOLMZ 학생',site:'holmz'}],handoverNotes:[
    {id:'old',site:'general',authorUserId:'g1',authorName:'총무 학생',content:'먼저 작성',createdAt:'2026-09-07T01:00:00.000Z'},
    {id:'new',site:'general',authorUserId:'g1',authorName:'총무 학생',content:'나중 작성',createdAt:'2026-09-07T02:00:00.000Z'},
    {id:'other',site:'holmz',authorUserId:'h1',authorName:'HOLMZ 학생',content:'다른 근무지',createdAt:'2026-09-07T03:00:00.000Z'}
  ]});
  assert.deepEqual(handoverNotesForSite(d,'general').map(x=>x.id),['new','old']);
  assert.deepEqual(filterDataForStudent(d,{studentId:'g1'}).handoverNotes.map(x=>x.id),['old','new']);
});

test('student dashboard renders the empty handover note card between today and weekly schedule', () => {
  const notePanel=renderHandoverNotePanel({handoverNotes:[]},{id:'user-a',role:'student'},'general');
  const html=composeStudentDashboardFlow('<article data-dashboard-section="today">오늘</article>',notePanel,'<article data-dashboard-section="week">주간</article>','<article data-dashboard-section="month">월간</article>');
  assert.match(notePanel,/data-dashboard-section="handover-notes"/);
  assert.match(notePanel,/id="handover-note-form"/);
  assert.match(notePanel,/아직 공유된 메모가 없습니다/);
  assert.match(notePanel,/다음 근무자에게 전달할 내용이 있다면 남겨주세요/);
  assert.ok(html.indexOf('data-dashboard-section="today"')<html.indexOf('data-dashboard-section="handover-notes"'));
  assert.ok(html.indexOf('data-dashboard-section="handover-notes"')<html.indexOf('data-dashboard-section="week"'));
  assert.ok(html.indexOf('data-dashboard-section="week"')<html.indexOf('data-dashboard-section="month"'));
});

test('handover note controls follow student ownership, admin, and viewer roles', () => {
  const data={handoverNotes:[
    {id:'mine',site:'general',authorUserId:'user-a',authorName:'학생 A',content:'<script>alert(1)</script>',createdAt:'2026-09-08T07:00:00.000Z'},
    {id:'other',site:'general',authorUserId:'user-b',authorName:'학생 B',content:'전달 사항',createdAt:'2026-09-08T08:00:00.000Z'}
  ]};
  const student=renderHandoverNotePanel(data,{id:'user-a',role:'student'},'general');
  const admin=renderHandoverNotePanel(data,{id:'admin',role:'admin'},'general');
  const viewer=renderHandoverNotePanel(data,{id:'viewer',role:'viewer'},'general');
  assert.equal((student.match(/data-delete-handover-note=/g)||[]).length,1);
  assert.equal((admin.match(/data-delete-handover-note=/g)||[]).length,2);
  assert.equal((viewer.match(/data-delete-handover-note=/g)||[]).length,0);
  assert.match(student,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(student,/<script>/);
  assert.match(viewer,/조회자 계정은 메모를 열람만 할 수 있습니다/);
  assert.doesNotMatch(viewer,/id="handover-note-form"/);
});

test('students remain schedulable without accounts and can be linked later without changing their record', () => {
  const d=normalizeData({students:[{id:'unlinked',name:'미연결 학생',site:'general'}],schedules:[{id:'shift',site:'general',studentId:'unlinked',studentName:'미연결 학생',kind:'date',date:'2026-09-08',start:'09:00',end:'10:00'}],accounts:[]});
  const semester=d.semesters[0];semester.startDate='2026-09-01';semester.endDate='2026-09-30';
  assert.equal(linkedStudentAccount(d.accounts,'unlinked'),undefined);
  assert.equal(eventsForDate(d,'general',new Date('2026-09-08T12:00:00'),semester.id)[0].studentId,'unlinked');
  const studentBefore=JSON.stringify(d.students[0]),scheduleBefore=JSON.stringify(d.schedules[0]);
  d.accounts.push({id:'account',username:'student',name:'미연결 학생',role:'student',studentId:'unlinked',active:true});
  assert.equal(linkedStudentAccount(d.accounts,'unlinked').id,'account');
  assert.equal(JSON.stringify(d.students[0]),studentBefore);
  assert.equal(JSON.stringify(d.schedules[0]),scheduleBefore);
});

test('general weekly view is weekdays only while HOLMZ keeps seven days', () => {
  assert.deepEqual(visibleWeekdays('general'), [1,2,3,4,5]);
  assert.deepEqual(visibleWeekdays('holmz'), [1,2,3,4,5,6,0]);
});

test('date exception cancels or changes one occurrence without altering the weekly schedule', () => {
  const d = normalizeData({ students:[{id:'s1',name:'학생',site:'general'}], schedules:[{id:'w1',site:'general',studentId:'s1',studentName:'학생',kind:'weekly',weekday:1,start:'09:00',end:'12:00'}] });
  const semesterId = d.settings.activeSemesterId;
  d.exceptions.push({id:'e1',semesterId,site:'general',type:'cancel',scheduleId:'w1',studentId:'s1',date:'2026-09-07'});
  d.exceptions.push({id:'e2',semesterId,site:'general',type:'change',scheduleId:'w1',studentId:'s1',date:'2026-09-14',start:'10:00',end:'12:00'});
  assert.equal(eventsForDate(d,'general',new Date('2026-09-07T12:00:00'),semesterId).length,0);
  assert.equal(eventsForDate(d,'general',new Date('2026-09-14T12:00:00'),semesterId)[0].start,'10:00');
  assert.equal(d.schedules[0].start,'09:00');
});

test('student payload excludes other workplace and all private student fields', () => {
  const d = normalizeData({
    students:[
      {id:'s1',name:'총무 학생',site:'general',studentNumber:'secret-1',phone:'010-1',email:'one@example.com'},
      {id:'s2',name:'HOLMZ 학생',site:'holmz',studentNumber:'secret-2',phone:'010-2',email:'two@example.com'}
    ],
    schedules:[
      {id:'g',site:'general',studentId:'s1',studentName:'총무 학생',kind:'weekly',weekday:1,start:'09:00',end:'10:00'},
      {id:'h',site:'holmz',studentId:'s2',studentName:'HOLMZ 학생',kind:'weekly',weekday:1,start:'09:00',end:'10:00'}
    ]
  });
  const visible = filterDataForStudent(d,{studentId:'s1'});
  assert.equal(visible.students.length,1);
  assert.equal(visible.students[0].phone, '');
  assert.equal(visible.students[0].studentNumber, '');
  assert.ok(visible.schedules.every(x=>x.site==='general'));
  assert.deepEqual(visible.accounts,[]);
  assert.equal(visible.semesters[0].budgets.general.total,0);
});

test('approved substitute appears on the actual date and preserves original worker', () => {
  const d=normalizeData({students:[{id:'s1',name:'원근무자',site:'general'},{id:'s2',name:'대타자',site:'general'}],schedules:[{id:'w1',site:'general',studentId:'s1',studentName:'원근무자',kind:'weekly',weekday:1,start:'09:00',end:'10:00'}]});
  const semesterId=d.settings.activeSemesterId;
  d.swaps.push({id:'swap',semesterId,site:'general',scheduleId:'w1',date:'2026-09-07',status:'대타확정',assigneeId:'s2',assigneeName:'대타자'});
  const event=eventsForDate(d,'general',new Date('2026-09-07T12:00:00'),semesterId)[0];
  assert.equal(event.studentName,'대타자');
  assert.equal(event.originalStudentName,'원근무자');
  assert.equal(eventsForDate(d,'general',new Date('2026-09-07T12:00:00'),semesterId,'s1').length,0);
  assert.equal(eventsForDate(d,'general',new Date('2026-09-07T12:00:00'),semesterId,'s2').length,1);
});

test('budget calculation uses configured workplace wage and schedule hours', () => {
  const d=normalizeData({students:[{id:'s1',name:'학생',site:'general',type:'국가근로'}],schedules:[{id:'w1',site:'general',studentId:'s1',studentName:'학생',kind:'weekly',weekday:1,start:'09:00',end:'11:00'}]});
  const semester=d.semesters[0];
  semester.startDate='2026-09-07'; semester.endDate='2026-09-07'; semester.budgets.general={total:100000,wage:9000,rates:{국가근로:10000}};
  d.attendances.push({attendanceId:'a1',workInstanceId:'schedule:w1:2026-09-07',semesterId:semester.id,site:'general',studentId:'s1',scheduleId:'w1',sourceType:'schedule',workDate:'2026-09-07',scheduledStart:'09:00',scheduledEnd:'11:00',actualCheckIn:'2026-09-07T00:00:00.000Z',actualCheckOut:''});
  const result=calculateBudget(d,'general',semester.id,new Date('2026-09-07T12:00:00'));
  assert.equal(result.used,20000);
  assert.equal(result.remaining,80000);
});

test('confirmed extra work becomes an independent work instance while unconfirmed applications do not', () => {
  const d=normalizeData({students:[{id:'s1',name:'학생',site:'general'}],extraJobs:[
    {id:'j1',site:'general',date:'2026-09-15',start:'14:00',end:'17:00',capacity:2,status:'OPEN',applicants:[{studentId:'s1',name:'학생',status:'CONFIRMED'}]},
    {id:'j2',site:'general',date:'2026-09-15',start:'18:00',end:'19:00',capacity:2,status:'OPEN',applicants:[{studentId:'s1',name:'학생',status:'APPLIED'}]}
  ]});
  const semester=d.semesters[0]; semester.startDate='2026-09-01'; semester.endDate='2026-09-30';
  const items=eventsForDate(d,'general',new Date('2026-09-15T12:00:00'),semester.id,'s1');
  assert.equal(items.length,1);
  assert.equal(items[0].isExtraWork,true);
  assert.equal(items[0].workInstanceId,'extra:j1:s1:2026-09-15');
});

test('early check-in is stored but recognized start remains the scheduled start', () => {
  const event={workDate:'2026-09-07',start:'09:00',end:'12:00'};
  const result=recognizedAttendance(event,{actualCheckIn:'2026-09-06T23:40:00.000Z',actualCheckOut:'2026-09-07T03:00:00.000Z'},new Date('2026-09-07T04:00:00.000Z'));
  assert.equal(result.status,'COMPLETE');
  assert.equal(result.minutes,180);
  assert.equal(result.recognizedStart,'2026-09-07T00:00:00.000Z');
});

test('late check-in reduces recognized time without an invented rounding rule', () => {
  const event={workDate:'2026-09-07',start:'09:00',end:'12:00'};
  const result=recognizedAttendance(event,{actualCheckIn:'2026-09-07T00:17:00.000Z',actualCheckOut:''},new Date('2026-09-07T03:20:00.000Z'));
  assert.equal(result.status,'COMPLETE');
  assert.equal(result.minutes,163);
});

test('missing normal checkout automatically uses scheduled end after the shift', () => {
  const event={workDate:'2026-09-07',start:'09:00',end:'12:00'};
  const result=recognizedAttendance(event,{actualCheckIn:'2026-09-07T00:00:00.000Z',actualCheckOut:''},new Date('2026-09-07T03:01:00.000Z'));
  assert.equal(result.status,'COMPLETE');
  assert.equal(result.recognizedEnd,'2026-09-07T03:00:00.000Z');
  assert.equal(result.minutes,180);
});

test('manual early checkout reduces recognized time and late checkout never creates overtime', () => {
  const event={workDate:'2026-09-07',start:'09:00',end:'12:00'};
  const early=recognizedAttendance(event,{actualCheckIn:'2026-09-07T00:00:00.000Z',actualCheckOut:'2026-09-07T02:00:00.000Z'},new Date('2026-09-07T04:00:00.000Z'));
  const late=recognizedAttendance(event,{actualCheckIn:'2026-09-07T00:00:00.000Z',actualCheckOut:'2026-09-07T04:00:00.000Z'},new Date('2026-09-07T04:00:00.000Z'));
  assert.equal(early.status,'EARLY_LEAVE');
  assert.equal(early.minutes,120);
  assert.equal(late.status,'COMPLETE');
  assert.equal(late.minutes,180);
});

test('an absence record remains distinct from a missing check-in and has no recognized time', () => {
  const event={workDate:'2026-09-07',start:'09:00',end:'12:00'};
  const result=recognizedAttendance(event,{checkoutType:'ABSENT'},new Date('2026-09-07T04:00:00.000Z'));
  assert.equal(result.status,'ABSENT');
  assert.equal(result.minutes,0);
  assert.equal(result.inProgress,false);
});

test('a past shift without check-in remains missing and receives no recognized time', () => {
  const result=recognizedAttendance({workDate:'2026-09-07',start:'09:00',end:'12:00'},null,new Date('2026-09-07T04:00:00.000Z'));
  assert.equal(result.status,'MISSING_CHECK_IN');
  assert.equal(result.minutes,0);
});

test('multiple shifts on one day keep distinct attendance identities', () => {
  const d=normalizeData({students:[{id:'s1',name:'학생',site:'general'}],schedules:[
    {id:'am',site:'general',studentId:'s1',studentName:'학생',kind:'date',date:'2026-09-07',start:'08:30',end:'10:00'},
    {id:'pm',site:'general',studentId:'s1',studentName:'학생',kind:'date',date:'2026-09-07',start:'15:00',end:'17:00'}
  ]});
  const semester=d.semesters[0]; semester.startDate='2026-09-01'; semester.endDate='2026-09-30';
  const events=eventsForDate(d,'general',new Date('2026-09-07T12:00:00'),semester.id,'s1');
  assert.notEqual(events[0].workInstanceId,events[1].workInstanceId);
  d.attendances.push({attendanceId:'a',workInstanceId:events[0].workInstanceId,actualCheckIn:'2026-09-06T23:30:00.000Z'});
  assert.equal(attendanceForEvent(d,events[0],events[0].workDate).attendanceId,'a');
  assert.equal(attendanceForEvent(d,events[1],events[1].workDate),undefined);
});

test('time overlap validation catches extra work conflicts but permits adjacent shifts', () => {
  const d=normalizeData({students:[{id:'s1',name:'학생',site:'general'}],schedules:[{id:'w1',site:'general',studentId:'s1',studentName:'학생',kind:'date',date:'2026-09-15',start:'14:00',end:'17:00'}]});
  const semester=d.semesters[0]; semester.startDate='2026-09-01'; semester.endDate='2026-09-30';
  assert.equal(hasTimeConflict(d,'s1','2026-09-15','15:00','18:00'),true);
  assert.equal(hasTimeConflict(d,'s1','2026-09-15','17:00','18:00'),false);
});

test('student payload contains only own attendance and hides other applicant identities', () => {
  const d=normalizeData({students:[{id:'s1',name:'학생1',site:'general'},{id:'s2',name:'학생2',site:'general'}],extraJobs:[{id:'j',site:'general',capacity:2,date:'2026-09-15',start:'09:00',end:'10:00',applicants:[{studentId:'s1',name:'학생1',status:'APPLIED'},{studentId:'s2',name:'학생2',status:'APPLIED'}]}],attendances:[{attendanceId:'a1',studentId:'s1'},{attendanceId:'a2',studentId:'s2'}]});
  const visible=filterDataForStudent(d,{studentId:'s1'});
  assert.deepEqual(visible.attendances.map(a=>a.attendanceId),['a1']);
  assert.deepEqual(visible.extraJobs[0].applicants.map(a=>a.studentId),['s1']);
  assert.equal(visible.extraJobs[0].applicantCount,2);
  assert.deepEqual(visible.attendanceAudit,[]);
});

test('student weekly data contains same-site actual workers but excludes other sites', () => {
  const d=normalizeData({students:[
    {id:'s1',name:'학생 A',site:'general'},
    {id:'s2',name:'학생 B',site:'general'},
    {id:'s3',name:'학생 C',site:'general'},
    {id:'h1',name:'HOLMZ 학생',site:'holmz'}
  ],schedules:[
    {id:'mine',site:'general',studentId:'s1',studentName:'학생 A',kind:'date',date:'2026-09-08',start:'09:00',end:'11:00'},
    {id:'coworker',site:'general',studentId:'s2',studentName:'학생 B',kind:'date',date:'2026-09-08',start:'09:00',end:'12:00'},
    {id:'cancelled',site:'general',studentId:'s3',studentName:'학생 C',kind:'date',date:'2026-09-08',start:'13:00',end:'14:00'},
    {id:'other-site',site:'holmz',studentId:'h1',studentName:'HOLMZ 학생',kind:'date',date:'2026-09-08',start:'09:00',end:'10:00'}
  ],exceptions:[
    {id:'cancel',site:'general',type:'cancel',scheduleId:'cancelled',studentId:'s3',date:'2026-09-08'}
  ],swaps:[
    {id:'swap',site:'general',scheduleId:'mine',date:'2026-09-08',status:'대타확정',assigneeId:'s3',assigneeName:'학생 C'}
  ],extraJobs:[
    {id:'extra',site:'general',date:'2026-09-08',start:'15:00',end:'16:00',status:'OPEN',applicants:[{studentId:'s2',name:'학생 B',status:'CONFIRMED'}]},
    {id:'other-extra',site:'holmz',date:'2026-09-08',start:'15:00',end:'16:00',status:'OPEN',applicants:[{studentId:'h1',name:'HOLMZ 학생',status:'CONFIRMED'}]}
  ]});
  const semester=d.semesters[0];semester.startDate='2026-09-01';semester.endDate='2026-09-30';
  const visible=filterDataForStudent(d,{studentId:'s1'});
  const events=eventsForDate(visible,'general',new Date('2026-09-08T12:00:00'),semester.id);
  assert.deepEqual(events.map(x=>x.studentName),['학생 B','학생 C','학생 B']);
  assert.equal(events[1].isSubstitute,true);
  assert.equal(events[2].isExtraWork,true);
  assert.ok(events.every(x=>x.site==='general'));
  assert.ok(!events.some(x=>x.id==='cancelled'));
  assert.ok(!JSON.stringify(visible).includes('HOLMZ 학생'));
});

test('student payload exposes only sanitized same-site absence markers for coworkers', () => {
  const d=normalizeData({students:[
    {id:'s1',name:'학생 A',site:'general'},
    {id:'s2',name:'학생 B',site:'general'},
    {id:'h1',name:'HOLMZ 학생',site:'holmz'}
  ],attendances:[
    {attendanceId:'own',studentId:'s1',site:'general',workInstanceId:'schedule:mine:2026-09-08',checkoutType:'',actualCheckIn:'2026-09-08T00:00:00.000Z'},
    {attendanceId:'coworker',studentId:'s2',site:'general',workInstanceId:'schedule:coworker:2026-09-08',workDate:'2026-09-08',checkoutType:'ABSENT',absenceReason:'민감한 관리자 메모',absenceMarkedByName:'관리자'},
    {attendanceId:'other-site',studentId:'h1',site:'holmz',workInstanceId:'schedule:other:2026-09-08',workDate:'2026-09-08',checkoutType:'ABSENT',absenceReason:'다른 근무지'}
  ]});
  const visible=filterDataForStudent(d,{studentId:'s1'});
  assert.equal(visible.attendances.length,2);
  assert.equal(visible.attendances.find(x=>x.studentId==='s1').attendanceId,'own');
  const coworker=visible.attendances.find(x=>x.studentId==='s2');
  assert.equal(coworker.checkoutType,'ABSENT');
  assert.equal(coworker.absenceReason,undefined);
  assert.equal(coworker.absenceMarkedByName,undefined);
  assert.ok(!visible.attendances.some(x=>x.studentId==='h1'));
});

test('budget separates past recognized hours from future scheduled hours and includes confirmed extra work', () => {
  const d=normalizeData({students:[{id:'s1',name:'학생',site:'general',type:'교내근로'}],schedules:[
    {id:'past',site:'general',studentId:'s1',studentName:'학생',kind:'date',date:'2026-09-07',start:'09:00',end:'12:00'},
    {id:'future',site:'general',studentId:'s1',studentName:'학생',kind:'date',date:'2026-09-09',start:'09:00',end:'11:00'}
  ],extraJobs:[{id:'extra',site:'general',date:'2026-09-09',start:'14:00',end:'15:00',capacity:1,status:'CLOSED',applicants:[{studentId:'s1',name:'학생',status:'CONFIRMED'}]}]});
  const semester=d.semesters[0];semester.startDate='2026-09-07';semester.endDate='2026-09-09';semester.budgets.general={total:100000,wage:10000,rates:{}};
  d.attendances.push({attendanceId:'a',workInstanceId:'schedule:past:2026-09-07',studentId:'s1',actualCheckIn:'2026-09-07T00:00:00.000Z',actualCheckOut:'2026-09-07T02:00:00.000Z'});
  const result=calculateBudget(d,'general',semester.id,new Date('2026-09-08T03:00:00.000Z'));
  assert.equal(result.usedHours,2);
  assert.equal(result.futureHours,3);
  assert.equal(result.used,20000);
  assert.equal(result.future,30000);
  assert.equal(result.projected,50000);
});
