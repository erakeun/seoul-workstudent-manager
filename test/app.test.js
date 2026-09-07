import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsForDate, scheduleOccursOn, statusFor, lanes } from '../app.js';

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
