import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');

test('admin viewing-semester control keeps its id and viewing-only change handler',()=>{
  assert.match(app,/class="semester-picker"/);
  assert.match(app,/id="viewing-semester"/);
  assert.match(app,/state\.viewingSemesterId=e\.target\.value;render\(\)/);
  assert.doesNotMatch(app,/viewing-semester[^\n]+activeSemesterId=e\.target\.value/);
  assert.match(css,/\.semester-picker select:focus-visible/);
  assert.match(css,/\.semester-picker\{order:3;width:100%/);
});

test('budget UI omits legacy accounting warning while retaining four-bucket calculations',()=>{
  assert.doesNotMatch(app,/과거 회계 귀속 확인 필요/);
  assert.match(app,/calculateBudgetCategories\(state\.data,semester\.id\)/);
  assert.match(app,/근무지 × 근로유형 4개 예산/);
  assert.match(app,/전체 확정 집행/);
  assert.match(app,/전체 미래 예정/);
  assert.match(app,/예상 최종 집행/);
  assert.match(app,/b\.status==='위험'/);
});
