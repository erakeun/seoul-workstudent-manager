import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import {fixture,runtime,clone} from './helpers/runtime.js';
const base='42a4ccc86aca8fb9bb6a3df83ae87061264e523b';
const read=p=>execFileSync('git',['show',base+':'+p],{encoding:'utf8'});
const backend=read('backend/Code.gs'),front=read('app.js');
test('baseline P0-1 CONFIRMED: single value exceeds 9 KiB with three attendance records',()=>{
 const r=runtime(backend),d=r.app.normalizeData_(JSON.parse(read('data/seed.json')));
 assert.equal(Buffer.byteLength(JSON.stringify(d)),8259);
 for(let i=0;i<3;i++)d.attendances.push({attendanceId:'attendance-'+i,workInstanceId:'schedule:shift-'+i+':2026-09-08',semesterId:d.settings.activeSemesterId,site:'general',studentId:d.students[0].id,scheduleId:'shift-'+i,sourceType:'schedule',workDate:'2026-09-08',scheduledStart:'09:00',scheduledEnd:'12:00',actualCheckIn:'2026-09-08T00:00:00.000Z',actualCheckOut:'',checkoutType:'',correctedByAdmin:false,createdAt:'2026-09-08T00:00:00.000Z',updatedAt:'2026-09-08T00:00:00.000Z'});
 assert.ok(Buffer.byteLength(JSON.stringify(d))>9*1024);
 assert.match(backend,/setProperty\(DATA_KEY,JSON.stringify/);
});
test('baseline P0-2 CONFIRMED: stale administrator snapshot deletes another addition',()=>{
 const r=runtime(backend),token=r.session(),a=r.data(),b=r.data();a.students.push({id:'new',name:'새 학생',site:'general'});r.app.adminSaveData_(token,a);b.notices.push({id:'n',title:'공지'});r.app.adminSaveData_(token,b);assert.ok(!r.data().students.some(s=>s.id==='new'));
});
test('baseline P0-3 CONFIRMED: completed minutes change and deleted schedule disappears',()=>{
 const c={console};vm.createContext(c);vm.runInContext(front.replace(/export function /g,'function '),c);const d=fixture();d.attendances=[{workInstanceId:'schedule:shift:2026-09-08',actualCheckIn:'2026-09-08T00:00:00Z',actualCheckOut:'2026-09-08T03:00:00Z'}];let e=c.eventsForDate(d,'general',new Date('2026-09-08T12:00:00'),'term')[0];assert.equal(c.recognizedAttendance(e,d.attendances[0]).minutes,180);d.schedules[0].end='10:00';e=c.eventsForDate(d,'general',new Date('2026-09-08T12:00:00'),'term')[0];assert.equal(c.recognizedAttendance(e,d.attendances[0]).minutes,60);d.schedules=[];assert.equal(c.eventsForDate(d,'general',new Date('2026-09-08T12:00:00'),'term').length,0);
});
test('baseline P0-4 CONFIRMED: UTC slice interpreted as KST shifts nine hours',()=>{
 assert.match(front,/record.actualCheckIn.slice\(0,16\)/);const old='2026-09-08T00:00:00.000Z';assert.equal(Date.parse(old)-Date.parse(old.slice(0,16)+':00+09:00'),9*3600000);
});
test('baseline P0-5 CONFIRMED: full restore drops backup attendance and notes',()=>{
 const r=runtime(backend),d=fixture();d.attendances=[{attendanceId:'at'}];d.handoverNotes=[{id:'n'}];r.app.adminSaveData_(r.session(),d);assert.equal(r.data().attendances.length,0);assert.equal(r.data().handoverNotes.length,0);
});
test('baseline P0-6 CONFIRMED: old session inherits relinked student',()=>{
 const r=runtime(backend),token=r.session('ua');r.app.adminUpsertUser_(r.session(),{...clone(r.data().accounts[2]),studentId:'b',password:'fixture-only'});assert.equal(r.app.loadApp_(token).user.studentId,'b');
});
