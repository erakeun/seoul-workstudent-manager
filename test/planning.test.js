import test from 'node:test';
import assert from 'node:assert/strict';
import { staged, fixture } from './helpers/runtime.js';

function base(){const d=fixture();Object.assign(d.semesters[0],{termEndDate:'2026-09-20',vacationStartDate:'2026-09-21',vacationHours:{general:{start:'08:00',end:'18:00'},holmz:{start:'08:00',end:'18:00'}},termWeeklyLimit:20,vacationWeeklyLimit:30});d.accounts.push({id:'ub',username:'b',name:'학생 B',studentId:'b',role:'student',active:true});return d;}
const request=(r,action,token,payload={})=>r.request(action,{token,...payload});

test('legacy notices are quiet; each new notice has independent persistent read state',()=>{
  const d=base();d.notices=[{id:'old',semesterId:'term',site:'all',title:'기존',createdAt:'2026-09-01',readBy:[]}];const r=staged(d);
  let a=request(r,'session',r.studentToken),b=request(r,'session',r.session('ub'));assert.equal(a.data.notices[0].requiresRead,false);assert.equal(b.data.notices[0].requiresRead,false);
  const change={entity:'notices',id:'new',operation:'upsert',expectedRevision:0,fields:{semesterId:'term',site:'all',title:'신규',content:'확인',createdAt:'2026-09-08T00:00:00Z',requiresRead:true}};assert.equal(r.request('adminMutate',{changes:[change]}).ok,true);
  a=request(r,'session',r.studentToken);const bToken=r.session('ub');b=request(r,'session',bToken);assert.equal(a.data.notices.find(n=>n.id==='new').readBy.length,0);assert.equal(b.data.notices.find(n=>n.id==='new').readBy.length,0);
  const read=request(r,'studentMarkNoticeRead',r.studentToken,{noticeId:'new'});assert.equal(read.ok,true,read.error);
  a=request(r,'session',r.studentToken);b=request(r,'session',bToken);assert.deepEqual(a.data.notices.find(n=>n.id==='new').readBy,['ua']);assert.equal(b.data.notices.find(n=>n.id==='new').readBy.length,0);
});

test('student class schedule is owner-only, semester-scoped, and overlap-safe',()=>{
  const r=staged(base()),item={semesterId:'term',weekday:2,start:'10:00',end:'11:30',subject:'통계학'};let result=request(r,'studentUpsertClassSchedule',r.studentToken,{item});assert.equal(result.ok,true,result.error);const id=r.ledger().classSchedules[0].id;
  result=request(r,'studentUpsertClassSchedule',r.studentToken,{item:{...item,start:'11:00',end:'12:00'}});assert.equal(result.ok,false);assert.match(result.error,/겹칩니다/);
  const other=request(r,'studentDeleteClassSchedule',r.session('ub'),{itemId:id});assert.equal(other.ok,false);assert.match(other.error,/본인 수업/);
  assert.equal(request(r,'studentDeleteClassSchedule',r.studentToken,{itemId:id}).ok,true);assert.equal(r.ledger().classSchedules.length,0);
});

test('preferences reject class conflicts and do not become actual work',()=>{
  const r=staged(base());assert.equal(request(r,'studentUpsertClassSchedule',r.studentToken,{item:{semesterId:'term',weekday:2,start:'13:00',end:'14:00',subject:''}}).ok,true);
  let result=request(r,'studentUpsertWorkPreference',r.studentToken,{item:{date:'2026-09-08',start:'13:00',end:'14:00'}});assert.equal(result.ok,false);assert.match(result.error,/수업시간/);
  result=request(r,'studentUpsertWorkPreference',r.studentToken,{item:{date:'2026-09-08',start:'14:00',end:'15:00'}});assert.equal(result.ok,true,result.error);assert.equal(r.ledger().workPreferences.length,1);assert.equal(r.ledger().schedules.length,1);
  const id=r.ledger().workPreferences[0].id;assert.equal(request(r,'studentDeleteWorkPreference',r.session('ub'),{itemId:id}).ok,false);assert.equal(request(r,'studentDeleteWorkPreference',r.studentToken,{itemId:id}).ok,true);
});

test('admin can partially assign and edit a draft inside availability before confirmation',()=>{
  const r=staged(base()),item={semesterId:'term',site:'general',studentId:'b',date:'2026-09-09',start:'09:00',end:'10:00',availabilityStart:'09:00',availabilityEnd:'12:00'};let result=r.request('adminUpsertScheduleDraft',{item});assert.equal(result.ok,true,result.error);const draft=r.ledger().scheduleDrafts[0];assert.equal(draft.status,'DRAFT');assert.equal(draft.end,'10:00');assert.equal(draft.availabilityEnd,'12:00');assert.equal(r.ledger().schedules.length,1);
  result=r.request('adminUpsertScheduleDraft',{item:{...draft,end:'11:00'}});assert.equal(result.ok,true,result.error);assert.equal(r.ledger().scheduleDrafts[0].end,'11:00');
  result=r.request('adminUpsertScheduleDraft',{item:{...draft,start:'08:30',end:'10:00'}});assert.equal(result.ok,false);assert.match(result.error,/가능시간/);
  result=request(r,'adminConfirmScheduleDraft',r.viewerToken,{itemId:draft.id});assert.equal(result.ok,false);assert.match(result.error,/관리자 권한/);
  result=r.request('adminConfirmScheduleDraft',{itemId:draft.id});assert.equal(result.ok,true,result.error);assert.equal(r.ledger().scheduleDrafts[0].status,'CONFIRMED');assert.equal(r.ledger().schedules.length,2);assert.equal(r.ledger().schedules[1].createdFromDraftId,draft.id);assert.equal(r.ledger().schedules[1].end,'11:00');
});

test('candidate calculation excludes class conflict, other site, inactive and conflicting workers',()=>{
  const d=base();d.classSchedules=[{id:'c',studentId:'a',semesterId:'term',weekday:3,start:'13:00',end:'15:00'}];d.workPreferences=[{id:'p',studentId:'b',semesterId:'term',site:'general',date:'2026-09-09',start:'13:00',end:'15:00'}];const r=staged(d),list=r.app.planningCandidates_(r.ledger(),'general','term','2026-09-09','13:00','15:00');assert.deepEqual(list.map(x=>x.studentId),['b']);assert.equal(list[0].wanted,true);
});

test('student and viewer payloads do not expose another student planning records',()=>{
  const d=base();d.classSchedules=[{id:'ca',studentId:'a',semesterId:'term',weekday:2,start:'13:00',end:'14:00'},{id:'cb',studentId:'b',semesterId:'term',weekday:2,start:'14:00',end:'15:00'}];d.workPreferences=[{id:'pa',studentId:'a',semesterId:'term',site:'general',date:'2026-09-09',start:'15:00',end:'16:00'},{id:'pb',studentId:'b',semesterId:'term',site:'general',date:'2026-09-09',start:'16:00',end:'17:00'}];d.scheduleDrafts=[{id:'draft',studentId:'a',semesterId:'term',site:'general',date:'2026-09-09',start:'17:00',end:'18:00',status:'DRAFT'}];const r=staged(d),student=request(r,'session',r.studentToken).data,viewer=request(r,'session',r.viewerToken).data;assert.deepEqual(student.classSchedules.map(x=>x.id),['ca']);assert.deepEqual(student.workPreferences.map(x=>x.id),['pa']);assert.deepEqual(student.scheduleDrafts,[]);assert.deepEqual(viewer.classSchedules,[]);assert.deepEqual(viewer.workPreferences,[]);assert.deepEqual(viewer.scheduleDrafts,[]);
});

test('preference totals and duplicate drafts are rejected before confirmation',()=>{
  const r=staged(base());for(let day=7;day<=10;day++)assert.equal(request(r,'studentUpsertWorkPreference',r.studentToken,{item:{date:`2026-09-${String(day).padStart(2,'0')}`,start:'13:00',end:'18:00'}}).ok,true);const over=request(r,'studentUpsertWorkPreference',r.studentToken,{item:{date:'2026-09-11',start:'13:00',end:'13:30'}});assert.equal(over.ok,false);assert.match(over.error,/주간 최대시간/);const item={semesterId:'term',site:'general',studentId:'b',date:'2026-09-11',start:'13:00',end:'15:00'};assert.equal(r.request('adminUpsertScheduleDraft',{item}).ok,true);const duplicate=r.request('adminUpsertScheduleDraft',{item:{...item,start:'14:30',end:'16:00'}});assert.equal(duplicate.ok,false);assert.match(duplicate.error,/Draft/);
});
