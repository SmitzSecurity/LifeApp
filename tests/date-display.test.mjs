import test from 'node:test';
import assert from 'node:assert/strict';
import {isCalendarDate,formatDate,formatMonth,parseDisplayDate,parseDisplayMonth,formatTimestampDate,formatDateTime} from '../lib/life/date-display.ts';

test('calendar-date presentation retains the recorded day at timezone and year boundaries',()=>{
 for(const [iso,display] of [['2026-01-01','01/01/2026'],['2026-12-31','12/31/2026'],['2026-03-08','03/08/2026'],['2026-11-01','11/01/2026'],['2024-02-29','02/29/2024'],['2000-02-29','02/29/2000'],['0099-01-01','01/01/0099']]){
  assert.equal(formatDate(iso),display);
  assert.equal(parseDisplayDate(display),iso);
 }
 assert.equal(formatMonth('2026-09'),'09/2026');
 assert.equal(parseDisplayMonth('9/2026'),'2026-09');
});

test('date entry rejects invalid and incomplete text rather than normalizing it to a different day',()=>{
 for(const invalid of ['','02/','02/29/2026','02/29/1900','04/31/2026','00/10/2026','13/10/2026','01/00/2026','2026-09-15','09/15/26','9/15/20260','09/15/2026 extra'])assert.equal(parseDisplayDate(invalid),null,invalid);
 for(const invalid of ['2026-02-29','1900-02-29','2026-04-31','2026-00-10','2026-13-10','2026-01-00','2026-1-01','2026-01-01T00:00:00Z']){
  assert.equal(isCalendarDate(invalid),false,invalid);
  assert.equal(formatDate(invalid),'—',invalid);
 }
 for(const invalid of ['','00/2026','13/2026','09/26','2026-09','09/15/2026'])assert.equal(parseDisplayMonth(invalid),null,invalid);
 assert.equal(parseDisplayDate(' 9/5/2026 '),'2026-09-05');
 assert.equal(formatDate(null),'—');
 assert.equal(formatMonth('2026-13'),'—');
});

test('timestamps use the intended timezone while calendar identifiers never shift',()=>{
 const instant='2026-01-01T01:30:00.000Z';
 assert.equal(formatTimestampDate(instant,'America/New_York'),'12/31/2025');
 assert.equal(formatTimestampDate(instant,'Pacific/Kiritimati'),'01/01/2026');
 assert.equal(formatDateTime(instant,'America/New_York'),'12/31/2025, 8:30 PM');
 assert.equal(formatDate('2026-01-01'),'01/01/2026');
 assert.equal(formatTimestampDate('invalid','UTC'),'—');
 assert.equal(formatDateTime('invalid','UTC'),'—');
});
