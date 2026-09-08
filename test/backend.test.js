import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {source as allSource} from './helpers/runtime.js';

const source=allSource();

function backend(){
  const context={console,Date,JSON,String,Number,Array,Object,Math,RegExp,Error,Utilities:{getUuid:()=>`uuid-${Math.random()}`}};
  vm.createContext(context);
  vm.runInContext(source,context);
  return context;
}

function data(){
  return {
    version:4,
    settings:{activeSemesterId:'semester'},
    semesters:[{id:'semester',name:'학기',startDate:'2026-09-01',endDate:'2026-09-30',active:true,budgets:{general:{},holmz:{}}}],
    students:[{id:'s1',name:'학생 A',site:'general',type:'교내근로',active:true},{id:'s2',name:'학생 B',site:'general',type:'교내근로',active:true}],
    schedules:[{id:'shift',semesterId:'semester',site:'general',studentId:'s1',studentName:'학생 A',kind:'date',date:'2026-09-08',start:'09:00',end:'10:00'}],
    exceptions:[],accounts:[],notices:[],handovers:[],handoverNotes:[],swaps:[],extraJobs:[],attendances:[],attendanceAudit:[]
  };
}

test('Apps Script accepts an unlinked student in admin and viewer data', () => {
  const app=backend(),current=data(),admin={id:'admin',name:'관리자',role:'admin',active:true},viewer={id:'viewer',name:'조회자',role:'viewer',active:true};
  current.accounts=[admin,viewer];
  app.requireAdmin_=()=>admin;
  app.data_=()=>current;
  let saved;
  app.saveData_=next=>{saved=next;};
  assert.throws(()=>app.adminSaveData_('token',current),/전체 상태 저장은 폐기/);
  const result=app.adminMutate_('token',[{entity:'students',id:'unlinked',operation:'upsert',expectedRevision:0,fields:{name:'미연결 학생',site:'general',type:'교내근로',active:true}}]);
  assert.equal(result.ok,true);
  assert.ok(saved.students.some(student=>student.id==='unlinked'));
  assert.ok(!saved.accounts.some(account=>account.studentId==='unlinked'));
  assert.ok(app.publicViewerData_(app.normalizeData_(saved)).students.some(student=>student.id==='unlinked'));
});

test('Apps Script can link an existing account later without duplicating student data', () => {
  const app=backend(),current=data(),admin={id:'admin',name:'관리자',role:'admin',active:true};
  current.accounts=[admin,{id:'login',username:'student-a',name:'학생 A',role:'viewer',studentId:'',active:true}];
  app.requireAdmin_=()=>admin;
  app.data_=()=>current;
  let saved;
  app.saveData_=next=>{saved=next;};
  const beforeStudent=JSON.stringify(current.students),beforeSchedule=JSON.stringify(current.schedules);
  const result=app.adminUpsertUser_('token',{id:'login',username:'student-a',name:'학생 A',role:'student',studentId:'s1',active:true,password:''});
  assert.equal(result.ok,true);
  assert.equal(saved.accounts.find(account=>account.id==='login').studentId,'s1');
  assert.equal(JSON.stringify(saved.students),beforeStudent);
  assert.equal(JSON.stringify(saved.schedules),beforeSchedule);
});

test('Apps Script enforces handover note ownership and viewer read-only access', () => {
  const app=backend(),current=data();
  current.handoverNotes=[
    {id:'mine',site:'general',authorUserId:'user-a',authorName:'학생 A',content:'내 메모',createdAt:'2026-09-08T07:00:00.000Z'},
    {id:'other',site:'general',authorUserId:'user-b',authorName:'학생 B',content:'다른 메모',createdAt:'2026-09-08T08:00:00.000Z'}
  ];
  let user={id:'user-a',name:'학생 A',role:'student',studentId:'s1',active:true},saved;
  app.requireUser_=()=>user;
  app.data_=()=>current;
  app.saveData_=next=>{saved=next;};
  assert.throws(()=>app.deleteHandoverNote_('token','other'),/삭제할 권한/);
  assert.equal(app.deleteHandoverNote_('token','mine').ok,true);
  assert.deepEqual(saved.handoverNotes.map(note=>note.id),['other']);
  user={id:'viewer',name:'조회자',role:'viewer',active:true};
  assert.throws(()=>app.createHandoverNote_('token','작성 시도','general'),/작성 권한/);
  assert.throws(()=>app.deleteHandoverNote_('token','other'),/삭제할 권한/);
  user={id:'admin',name:'관리자',role:'admin',active:true};
  assert.equal(app.deleteHandoverNote_('token','other').ok,true);
});

test('Apps Script trims notes, rejects blank content, and records immutable author identity', () => {
  const app=backend(),current=data(),user={id:'user-a',name:'학생 A',role:'student',studentId:'s1',active:true};
  app.requireUser_=()=>user;
  app.data_=()=>current;
  let saved;
  app.saveData_=next=>{saved=next;};
  assert.throws(()=>app.createHandoverNote_('token','   ','holmz'),/메모 내용을 입력/);
  const result=app.createHandoverNote_('token','  <b>일반 텍스트</b>  ','holmz');
  assert.equal(result.ok,true);
  assert.equal(saved.handoverNotes[0].site,'general');
  assert.equal(saved.handoverNotes[0].authorUserId,'user-a');
  assert.equal(saved.handoverNotes[0].content,'<b>일반 텍스트</b>');
  assert.ok(saved.handoverNotes[0].createdAt);
});
