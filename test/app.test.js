import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateBudget, eventsForDate, filterDataForStudent, lanes, normalizeData, scheduleOccursOn, statusFor, visibleWeekdays } from '../app.js';

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
  assert.equal(migrated.version, 3);
  assert.equal(migrated.students[0].name, '학생');
  assert.match(migrated.students[0].color, /^#[0-9a-f]{6}$/i);
  assert.equal(migrated.schedules[0].semesterId, migrated.settings.activeSemesterId);
  assert.deepEqual(migrated.exceptions, []);
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
  const result=calculateBudget(d,'general',semester.id,new Date('2026-09-07T12:00:00'));
  assert.equal(result.used,20000);
  assert.equal(result.remaining,80000);
});
