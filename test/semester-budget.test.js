import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateBudgetCategories,defaultSemesterDates,eventsForDate,normalizeData,semesterPeriodForDate,studentAbsenceSummary} from '../app.js';
import {fixture,staged} from './helpers/runtime.js';

function configuredFixture(){
  const data=fixture(),term=data.semesters[0];
  Object.assign(term,{startDate:'2026-09-01',endDate:'2026-09-30',termEndDate:'2026-09-13',vacationStartDate:'2026-09-21',termWeeklyLimit:20,vacationWeeklyLimit:30,mixedWeekPolicy:'SEPARATE_PERIOD_LIMITS',vacationHours:{general:{start:'08:00',end:'18:00'},holmz:{start:'08:00',end:'18:00'}}});
  term.budgets={general:{byWorkType:{NATIONAL:{total:1000000,wage:12000},INTERNAL:{total:800000,wage:10000}}},holmz:{byWorkType:{NATIONAL:{total:600000,wage:12000},INTERNAL:{total:400000,wage:10000}}}};
  data.students[0].type='국가근로';data.students[1].type='교내근로';data.students[2].type='국가근로';data.schedules=[];return data;
}
const schedule=(id,studentId,date,start,end,periodType='TERM',site='general')=>({id,semesterId:'term',site,studentId,studentName:studentId,periodType,kind:'date',date,start,end});
const change=record=>({entity:'schedules',id:record.id,operation:'upsert',expectedRevision:0,fields:Object.fromEntries(Object.entries(record).filter(([key])=>key!=='id'))});

test('semester suggestions cover both halves and leap-year February',()=>{
  assert.deepEqual(defaultSemesterDates(2027,1),{startDate:'2027-03-01',endDate:'2027-08-31'});
  assert.deepEqual(defaultSemesterDates(2027,2),{startDate:'2027-09-01',endDate:'2028-02-29'});
  assert.deepEqual(defaultSemesterDates(2028,2),{startDate:'2028-09-01',endDate:'2029-02-28'});
});

test('TERM, BREAK_GAP, VACATION and OUTSIDE are classified without equating end and vacation start',()=>{
  const term=configuredFixture().semesters[0];
  assert.equal(semesterPeriodForDate(term,'2026-09-13'),'TERM');
  assert.equal(semesterPeriodForDate(term,'2026-09-14'),'BREAK_GAP');
  assert.equal(semesterPeriodForDate(term,'2026-09-21'),'VACATION');
  assert.equal(semesterPeriodForDate(term,'2026-10-01'),'OUTSIDE');
  delete term.termEndDate;assert.equal(semesterPeriodForDate(term,'2026-09-08'),'CONFIG_REQUIRED');
});

test('period schedules switch at the boundary and no repeating schedule appears in the gap',()=>{
  const data=normalizeData(configuredFixture());data.schedules=[
    {...schedule('term','a','', '09:00','10:00','TERM'),kind:'weekly',weekday:1},
    {...schedule('vac','a','', '10:00','11:00','VACATION'),kind:'weekly',weekday:1}
  ];
  assert.equal(eventsForDate(data,'general',new Date('2026-09-07T12:00:00'),'term')[0].id,'term');
  assert.equal(eventsForDate(data,'general',new Date('2026-09-14T12:00:00'),'term').length,0);
  assert.equal(eventsForDate(data,'general',new Date('2026-09-21T12:00:00'),'term')[0].id,'vac');
});

test('four budget categories remain independent and forecast only confirmed future work',()=>{
  const data=normalizeData(configuredFixture());data.schedules=[schedule('gn','a','2026-09-09','09:00','11:00'),schedule('gi','b','2026-09-10','09:00','12:00'),schedule('hn','c','2026-09-11','09:00','10:00','TERM','holmz')];
  data.attendances=[{attendanceId:'past',workInstanceId:'past',semesterId:'term',site:'general',studentId:'a',workDate:'2026-09-08',scheduledStart:'09:00',scheduledEnd:'11:00',actualCheckIn:'2026-09-08T00:00:00Z',actualCheckOut:'2026-09-08T02:00:00Z',recognizedMinutes:120,snapshot:{site:'general',workType:'국가근로',budgetWorkType:'NATIONAL',wage:12000,start:'09:00',end:'11:00'}}];
  const buckets=calculateBudgetCategories(data,'term',new Date('2026-09-08T12:00:00+09:00'));
  assert.equal(buckets['general:NATIONAL'].used,24000);
  assert.equal(buckets['general:NATIONAL'].future,24000);
  assert.equal(buckets['general:INTERNAL'].future,30000);
  assert.equal(buckets['holmz:NATIONAL'].future,12000);
  assert.equal(buckets['holmz:INTERNAL'].future,0);
});

test('zero budgets and unknown work types are explicit risk or setup-required states',()=>{
  const data=normalizeData(configuredFixture());data.semesters[0].budgets.general.byWorkType.NATIONAL.total=0;data.schedules=[schedule('known','a','2026-09-09','09:00','10:00'),schedule('unknown','b','2026-09-10','09:00','10:00')];data.students[1].type='미분류';
  const buckets=calculateBudgetCategories(data,'term',new Date('2026-09-08T12:00:00+09:00'));
  assert.equal(buckets['general:NATIONAL'].status,'설정 필요');
  assert.equal(buckets['general:INTERNAL'].status,'설정 필요');
  assert.ok(buckets['general:NATIONAL'].accountingReview>0);
});

test('past accounting stays fixed after current site, work type and wage change',()=>{
  const data=normalizeData(configuredFixture());data.attendances=[{attendanceId:'past',workInstanceId:'past',semesterId:'term',site:'general',studentId:'a',workDate:'2026-09-08',scheduledStart:'09:00',scheduledEnd:'11:00',actualCheckIn:'2026-09-08T00:00:00Z',actualCheckOut:'2026-09-08T02:00:00Z',recognizedMinutes:120,snapshot:{site:'general',workType:'국가근로',budgetWorkType:'NATIONAL',wage:12000,start:'09:00',end:'11:00'}}];
  data.students[0].site='holmz';data.students[0].type='교내근로';data.semesters[0].budgets.general.byWorkType.NATIONAL.wage=20000;
  const buckets=calculateBudgetCategories(data,'term',new Date('2026-09-09T12:00:00+09:00'));
  assert.equal(buckets['general:NATIONAL'].used,24000);assert.equal(buckets['holmz:INTERNAL'].used,0);
});

test('server captures site, work type and wage before later student changes',()=>{
  const base=configuredFixture();base.schedules=[schedule('shift','a','2026-09-08','09:00','12:00')];const r=staged(base);let result=r.request('studentCheckIn',{token:r.studentToken,workInstanceId:'schedule:shift:2026-09-08'});assert.equal(result.ok,true,result.error);r.setTime('2026-09-08T03:00:00Z');result=r.request('studentCheckOut',{token:r.studentToken,workInstanceId:'schedule:shift:2026-09-08'});assert.equal(result.ok,true,result.error);const snapshot=r.ledger().attendances[0].snapshot;assert.equal(snapshot.site,'general');assert.equal(snapshot.workType,'국가근로');assert.equal(snapshot.budgetWorkType,'NATIONAL');assert.equal(snapshot.wage,12000);
});

test('absence summary uses confirmed attendance facts and excludes restored absence records',()=>{
  const data=normalizeData(configuredFixture());data.attendances=[{attendanceId:'a1',studentId:'a',semesterId:'term',site:'general',workDate:'2026-09-08',scheduledStart:'09:00',scheduledEnd:'11:00',checkoutType:'ABSENT'},{attendanceId:'normal',studentId:'a',semesterId:'term',site:'general',workDate:'2026-09-09',scheduledStart:'09:00',scheduledEnd:'11:00',checkoutType:'MANUAL'}];
  let summary=studentAbsenceSummary(data,'a','term');assert.equal(summary.count,1);assert.equal(summary.recentDate,'2026-09-08');assert.equal(summary.items[0].start,'09:00');
  data.attendances=data.attendances.filter(a=>a.attendanceId!=='a1');summary=studentAbsenceSummary(data,'a','term');assert.equal(summary.count,0);
});

test('server permits TERM 18+2 hours and rejects 18+2.5 with a detailed limit message',()=>{
  const base=configuredFixture();base.schedules=[schedule('m','a','2026-09-07','09:00','18:00'),schedule('t','a','2026-09-08','09:00','18:00')];
  let r=staged(base);r.setTime('2026-09-07T00:00:00Z');let result=r.request('adminMutate',{changes:[change(schedule('ok','a','2026-09-09','09:00','11:00'))]});assert.equal(result.ok,true,result.error);
  r=staged(base);r.setTime('2026-09-07T00:00:00Z');result=r.request('adminMutate',{changes:[change(schedule('over','a','2026-09-09','09:00','11:30'))]});assert.equal(result.ok,false);assert.match(result.error,/현재 18\.0시간.*추가 2\.5시간.*예상 20\.5시간.*허용 최대 20\.0시간/);
});

test('server permits VACATION 28+2 hours and rejects 28+3, including extra-work confirmation path',()=>{
  const base=configuredFixture();base.schedules=[schedule('m','a','2026-09-21','09:00','16:00','VACATION'),schedule('t','a','2026-09-22','09:00','16:00','VACATION'),schedule('w','a','2026-09-23','09:00','16:00','VACATION'),schedule('h','a','2026-09-24','09:00','16:00','VACATION')];
  let r=staged(base),result=r.request('adminMutate',{changes:[change(schedule('ok','a','2026-09-25','09:00','11:00','VACATION'))]});assert.equal(result.ok,true,result.error);
  base.extraJobs=[{id:'job',semesterId:'term',site:'general',title:'추가',place:'사무실',date:'2026-09-25',start:'09:00',end:'12:00',capacity:1,status:'OPEN',applicants:[{studentId:'a',name:'a',status:'APPLIED'}]}];r=staged(base);result=r.request('adminUpdateExtraApplicant',{jobId:'job',studentId:'a',status:'CONFIRMED',expectedRevision:0});assert.equal(result.ok,false);assert.match(result.error,/예상 31\.0시간.*허용 최대 30\.0시간/);
});

test('a confirmed substitute is counted only for the substitute and cannot push them over the vacation cap',()=>{
  const base=configuredFixture();base.schedules=[schedule('m','a','2026-09-21','09:00','16:00','VACATION'),schedule('t','a','2026-09-22','09:00','16:00','VACATION'),schedule('w','a','2026-09-23','09:00','16:00','VACATION'),schedule('h','a','2026-09-24','09:00','16:00','VACATION'),schedule('requester','b','2026-09-25','09:00','12:00','VACATION')];base.swaps=[{id:'swap',semesterId:'term',site:'general',scheduleId:'requester',date:'2026-09-25',requesterStudentId:'b',requesterName:'b',status:'모집중',applicants:[{studentId:'a',name:'a'}]}];const r=staged(base),result=r.request('adminUpdateSwap',{swapId:'swap',status:'대타확정',assigneeId:'a',note:'',expectedRevision:0});assert.equal(result.ok,false);assert.match(result.error,/예상 31\.0시간.*허용 최대 30\.0시간/);assert.equal(r.ledger().swaps[0].status,'모집중');
});

test('vacation operating hours and unresolved mixed-week policy are server-side gates',()=>{
  let base=configuredFixture();let r=staged(base),result=r.request('adminMutate',{changes:[change(schedule('late','a','2026-09-21','17:00','19:00','VACATION'))]});assert.equal(result.ok,false);assert.match(result.error,/방학 일정.*운영시간/);
  base=configuredFixture();Object.assign(base.semesters[0],{termEndDate:'2026-09-15',vacationStartDate:'2026-09-17',mixedWeekPolicy:''});base.schedules=[schedule('term','a','2026-09-14','09:00','10:00')];r=staged(base);result=r.request('adminMutate',{changes:[change(schedule('vac','a','2026-09-17','09:00','10:00','VACATION'))]});assert.equal(result.ok,false);assert.match(result.error,/운영정책 결정이 필요/);
});

test('server rejects malformed period types and partial vacation operating hours',()=>{
  let base=configuredFixture(),r=staged(base),result=r.request('adminMutate',{changes:[change(schedule('bad-period','a','2026-09-09','09:00','10:00','OTHER'))]});assert.equal(result.ok,false);assert.match(result.error,/운영 기간/);
  base=configuredFixture();const term=base.semesters[0];term.vacationHours={general:{start:'08:00'},holmz:{start:'08:00',end:'18:00'}};r=staged(base);result=r.request('adminMutate',{changes:[{entity:'semesters',id:'term',operation:'upsert',expectedRevision:0,fields:{name:'학기 수정'}}]});assert.equal(result.ok,false);assert.match(result.error,/방학 운영시간/);
});

test('budget updates are Admin-only, unique by category, revision-safe and audited',()=>{
  const r=staged(configuredFixture()),budget={semesterId:'term',site:'general',workType:'국가근로',total:123456,wage:13000};let result=r.request('adminUpdateBudget',{budget,expectedRevision:0});assert.equal(result.ok,true,result.error);let data=r.ledger();assert.equal(data.semesters[0].budgets.general.byWorkType.NATIONAL.total,123456);assert.equal(data.budgetAudit.length,1);assert.equal(data.budgetAudit[0].before.total,1000000);
  result=r.request('adminUpdateBudget',{token:r.viewerToken,budget:{...budget,total:1},expectedRevision:1});assert.equal(result.ok,false);result=r.request('adminUpdateBudget',{budget:{...budget,total:2},expectedRevision:0});assert.equal(result.ok,false);data=r.ledger();assert.equal(data.budgetAudit.length,1);
});
