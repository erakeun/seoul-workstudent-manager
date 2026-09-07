const DB_KEY = 'seoul-workstudent-manager:v1';
const SITE = { general: '총무팀', holmz: 'HOLMZ' };
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const COLOR = ['#28628d', '#2b7a78', '#805d9d', '#b06b3b', '#527b4e', '#9b5268'];

let state = { site: 'general', view: 'today', cursor: new Date(), data: null };

function iso(date) { return date.toISOString().slice(0, 10); }
function fromIso(value) { return new Date(`${value}T12:00:00`); }
function mins(value) { const [h, m] = value.split(':').map(Number); return h * 60 + m; }
function fmtDate(date) { return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 (${DAYS[date.getDay()]})`; }
function timeText(item) { return `${item.start}–${item.end}`; }
function esc(value = '') { return String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]); }
function uid(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
function dayStart(date) { const copy = new Date(date); copy.setHours(0, 0, 0, 0); return copy; }
function monday(date) { const copy = dayStart(date); const d = copy.getDay() || 7; copy.setDate(copy.getDate() - d + 1); return copy; }
function addDays(date, count) { const copy = new Date(date); copy.setDate(copy.getDate() + count); return copy; }
function sameDate(a, b) { return iso(a) === iso(b); }

export function scheduleOccursOn(item, date) {
  return item.kind === 'weekly' ? item.weekday === date.getDay() : item.date === iso(date);
}
export function eventsForDate(data, site, date) {
  return data.schedules
    .filter(item => item.site === site && scheduleOccursOn(item, date))
    .sort((a, b) => mins(a.start) - mins(b.start) || a.studentName.localeCompare(b.studentName, 'ko'));
}
export function statusFor(item, now = new Date()) {
  const nowMins = now.getHours() * 60 + now.getMinutes();
  if (nowMins < mins(item.start)) return '근무 예정';
  if (nowMins >= mins(item.end)) return '종료';
  return '현재 근무';
}
export function lanes(items) {
  const sorted = [...items].sort((a,b) => mins(a.start) - mins(b.start) || mins(b.end) - mins(a.end));
  const active = [];
  return sorted.map(item => {
    for (let i = active.length - 1; i >= 0; i--) if (active[i].end <= mins(item.start)) active.splice(i, 1);
    const occupied = new Set(active.map(x => x.lane));
    let lane = 0; while (occupied.has(lane)) lane++;
    active.push({ end: mins(item.end), lane });
    return { ...item, lane, lanes: Math.max(1, lane + 1) };
  });
}

async function loadData() {
  const saved = localStorage.getItem(DB_KEY);
  if (saved) return JSON.parse(saved);
  const seed = await fetch('./data/seed.json').then(r => r.json());
  localStorage.setItem(DB_KEY, JSON.stringify(seed));
  return seed;
}
function save() { localStorage.setItem(DB_KEY, JSON.stringify(state.data)); }
function students(site = state.site, includeInactive = true) { return state.data.students.filter(s => s.site === site && (includeInactive || s.active)); }
function activeStudent(id) { return state.data.students.find(s => s.id === id); }
function title() { return `${SITE[state.site]} · 근로장학생 관리`; }
function navButton(view, label, icon) { return `<button class="nav-button ${state.view === view ? 'is-active' : ''}" data-view="${view}"><span>${icon}</span>${label}</button>`; }

function appShell(content) {
  return `<div class="shell">
    <aside class="sidebar">
      <div class="brand"><div class="brand-mark">S</div><div><strong>서울 근로장학생</strong><small>관리 시안 · 2026</small></div></div>
      <div class="site-switch" aria-label="근무지 선택">
        <button data-site="general" class="${state.site === 'general' ? 'is-selected' : ''}">총무팀</button>
        <button data-site="holmz" class="${state.site === 'holmz' ? 'is-selected' : ''}">HOLMZ</button>
      </div>
      <nav>${navButton('today', '오늘 근무', '◷')}${navButton('week', '주간 시간표', '▦')}${navButton('month', '월간 시간표', '□')}${navButton('students', '학생 관리', '♙')}${navButton('schedules', '일정 관리', '☷')}</nav>
      <div class="sidebar-note"><span class="dot"></span><div><b>브라우저에 저장됨</b><small>변경사항은 이 기기에 유지됩니다.</small></div></div>
    </aside>
    <main><header class="topbar"><div><p class="eyebrow">${SITE[state.site].toUpperCase()} WORKSPACE</p><h1>${title()}</h1></div><div class="top-actions"><button class="secondary" data-action="export">데이터 내보내기</button><label class="secondary import-label">가져오기<input data-action="import" type="file" accept="application/json" /></label></div></header>${content}</main>
  </div>`;
}

function todayView() {
  const today = new Date(); const items = eventsForDate(state.data, state.site, today); const now = new Date();
  const groups = [['오전', items.filter(x => mins(x.start) < 12 * 60)], ['오후', items.filter(x => mins(x.start) >= 12 * 60 && mins(x.start) < 18 * 60)], ['저녁', items.filter(x => mins(x.start) >= 18 * 60)]];
  const active = items.filter(x => statusFor(x, now) === '현재 근무').length;
  const upcoming = items.filter(x => statusFor(x, now) === '근무 예정').length;
  return appShell(`<section class="page-head"><div><p class="eyebrow">${fmtDate(today)}</p><h2>오늘 근무</h2><p class="muted">오늘 ${SITE[state.site]}의 근무 일정을 빠르게 확인하세요.</p></div><button class="primary" data-action="add-schedule">+ 근무 일정 추가</button></section>
    <section class="metrics"><article><span>오늘 일정</span><b>${items.length}<small>건</small></b><p>반복 일정 포함</p></article><article><span>현재 근무</span><b>${active}<small>명</small></b><p>현재 시각 기준</p></article><article><span>근무 예정</span><b>${upcoming}<small>건</small></b><p>오늘 남은 일정</p></article><article><span>활성 학생</span><b>${students(state.site, false).length}<small>명</small></b><p>${SITE[state.site]} 소속</p></article></section>
    <section class="content-card today-card"><div class="card-title"><div><h3>시간대별 근무</h3><p>상태는 현재 시각을 기준으로 표시됩니다.</p></div><button class="text-button" data-view="week">주간표 보기 →</button></div>
      ${items.length ? groups.filter(([, g]) => g.length).map(([name, group]) => `<div class="day-section"><h4>${name}</h4><div class="schedule-list">${group.map(item => `<article class="shift-row"><span class="avatar" style="--avatar:${studentColor(item.studentId)}">${esc(item.studentName).slice(0,1)}</span><div class="shift-main"><b>${esc(item.studentName)}</b><span>${timeText(item)}</span></div><span class="badge ${statusFor(item, now) === '현재 근무' ? 'live' : statusFor(item, now) === '종료' ? 'finished' : ''}">${statusFor(item, now)}</span></article>`).join('')}</div></div>`).join('') : empty('오늘 등록된 근무 일정이 없습니다.', '일정 추가')}</section>`);
}

function controls(label) { return `<div class="calendar-controls"><button class="icon-button" data-action="prev-${label}" aria-label="이전">‹</button><button class="secondary" data-action="today-${label}">오늘</button><button class="icon-button" data-action="next-${label}" aria-label="다음">›</button></div>`; }
function weekView() {
  const start = monday(state.cursor); const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const all = dates.map(date => eventsForDate(state.data, state.site, date));
  const earliest = Math.max(0, Math.min(...all.flat().map(x => mins(x.start)), 8 * 60) - 60);
  const latest = Math.min(24*60, Math.max(...all.flat().map(x => mins(x.end)), 18 * 60) + 60);
  const slots = Array.from({ length: Math.ceil((latest-earliest)/30) }, (_, i) => earliest + i * 30);
  return appShell(`<section class="page-head compact"><div><p class="eyebrow">주간 시간표</p><h2>${start.getMonth()+1}월 ${start.getDate()}일 – ${dates[6].getMonth()+1}월 ${dates[6].getDate()}일</h2><p class="muted">동일 시간대의 복수 근무자는 나란히 표시합니다.</p></div>${controls('week')}<button class="primary" data-action="add-schedule">+ 일정 추가</button></section>
  <section class="content-card week-card"><div class="week-grid" style="--rows:${slots.length}; --row-height:48px"><div class="time-corner">시간</div>${dates.map(date => `<div class="week-day-head ${sameDate(date,new Date()) ? 'is-today' : ''}"><b>${DAYS[date.getDay()]}</b><span>${date.getDate()}</span></div>`).join('')}${slots.map(slot => `<div class="time-label" style="grid-row:${2 + (slot-earliest)/30}">${String(Math.floor(slot/60)).padStart(2,'0')}:${String(slot%60).padStart(2,'0')}</div>`).join('')}${dates.map((date, d) => `<div class="day-column" style="grid-column:${d+2};grid-row:2 / span ${slots.length}">${renderWeekEvents(eventsForDate(state.data,state.site,date), earliest, latest)}</div>`).join('')}</div></section><section class="mobile-week">${dates.map(date => `<article class="mobile-day"><h3>${DAYS[date.getDay()]} <span>${date.getMonth()+1}/${date.getDate()}</span></h3>${eventChips(eventsForDate(state.data,state.site,date))}</article>`).join('')}</section>`);
}
function renderWeekEvents(items, earliest, latest) {
  const positioned = lanes(items); const laneCount = Math.max(1, ...positioned.map(x => x.lane + 1)); const duration = latest - earliest;
  return positioned.map(item => { const top = (mins(item.start) - earliest) / duration * 100; const height = (mins(item.end) - mins(item.start)) / duration * 100; const width = 100 / laneCount; return `<button class="event-block" data-edit-schedule="${item.id}" style="--top:${top}%;--height:${height}%;--left:${item.lane*width}%;--width:${width}%;--event:${studentColor(item.studentId)}"><b>${esc(item.studentName)}</b><span>${timeText(item)}</span></button>`; }).join('');
}
function eventChips(items) { return items.length ? `<div class="mobile-shifts">${items.map(item => `<button data-edit-schedule="${item.id}"><span style="background:${studentColor(item.studentId)}"></span><b>${esc(item.studentName)}</b><em>${timeText(item)}</em></button>`).join('')}</div>` : '<p class="empty-small">등록된 일정이 없습니다.</p>'; }

function monthView() {
  const first = new Date(state.cursor.getFullYear(), state.cursor.getMonth(), 1); const gridStart = addDays(first, -first.getDay()); const dates = Array.from({length:42}, (_,i)=>addDays(gridStart,i));
  return appShell(`<section class="page-head compact"><div><p class="eyebrow">월간 시간표</p><h2>${first.getFullYear()}년 ${first.getMonth()+1}월</h2><p class="muted">반복 일정과 날짜 지정 일정을 함께 표시합니다.</p></div>${controls('month')}<button class="primary" data-action="add-schedule">+ 일정 추가</button></section><section class="content-card month-card"><div class="month-grid"><div class="month-weekdays">${DAYS.map(day=>`<b>${day}</b>`).join('')}</div><div class="month-days">${dates.map(date=>monthCell(date, first)).join('')}</div></div></section>`);
}
function monthCell(date, current) { const items = eventsForDate(state.data,state.site,date); return `<article class="month-day ${date.getMonth() !== current.getMonth() ? 'outside' : ''} ${sameDate(date,new Date()) ? 'is-today' : ''}"><div class="date-number">${date.getDate()}</div><div class="month-events">${items.slice(0,4).map(item=>`<button data-edit-schedule="${item.id}" title="${esc(item.studentName)} ${timeText(item)}"><i style="background:${studentColor(item.studentId)}"></i><b>${esc(item.studentName)}</b><span>${timeText(item)}</span></button>`).join('')}${items.length > 4 ? `<small>+${items.length-4}개 더</small>` : ''}</div></article>`; }

function studentsView() { const list = students(); return appShell(`<section class="page-head"><div><p class="eyebrow">${SITE[state.site]} 학생</p><h2>학생 관리</h2><p class="muted">학생 정보와 활성 상태를 관리합니다.</p></div><button class="primary" data-action="add-student">+ 학생 추가</button></section><section class="content-card table-card"><div class="card-title"><div><h3>학생 ${list.length}명</h3><p>비활성 학생의 과거 일정은 유지됩니다.</p></div></div><div class="table-wrap"><table><thead><tr><th>이름</th><th>근무지</th><th>근로유형</th><th>상태</th><th aria-label="관리"></th></tr></thead><tbody>${list.map(s=>`<tr><td><span class="avatar small" style="--avatar:${studentColor(s.id)}">${esc(s.name).slice(0,1)}</span><b>${esc(s.name)}</b></td><td>${SITE[s.site]}</td><td><span class="type-tag">${s.type}</span></td><td><button class="status-toggle ${s.active ? 'on' : ''}" data-toggle-student="${s.id}">${s.active ? '활성' : '비활성'}</button></td><td><button class="row-action" data-edit-student="${s.id}">수정</button><button class="row-action danger" data-delete-student="${s.id}">삭제</button></td></tr>`).join('')}</tbody></table></div></section>`); }

function schedulesView() { const list = state.data.schedules.filter(s=>s.site===state.site).sort((a,b)=>((a.kind==='weekly'?a.weekday+7:a.date) > (b.kind==='weekly'?b.weekday+7:b.date) ? 1 : -1) || mins(a.start)-mins(b.start)); return appShell(`<section class="page-head"><div><p class="eyebrow">${SITE[state.site]} 일정</p><h2>근무 일정 관리</h2><p class="muted">매주 반복 일정과 날짜 지정 일정을 함께 관리합니다.</p></div><button class="primary" data-action="add-schedule">+ 근무 일정 추가</button></section><section class="content-card table-card"><div class="card-title"><div><h3>등록 일정 ${list.length}건</h3><p>일정은 학생 삭제 후에도 당시 이름과 함께 보존됩니다.</p></div></div><div class="table-wrap"><table><thead><tr><th>학생</th><th>반복</th><th>요일 또는 날짜</th><th>근무시간</th><th aria-label="관리"></th></tr></thead><tbody>${list.map(item=>`<tr><td><b>${esc(item.studentName)}</b></td><td><span class="type-tag">${item.kind==='weekly'?'매주 반복':'날짜 지정'}</span></td><td>${item.kind==='weekly'?`매주 ${DAYS[item.weekday]}요일`:item.date}</td><td><b>${timeText(item)}</b></td><td><button class="row-action" data-edit-schedule="${item.id}">수정</button><button class="row-action danger" data-delete-schedule="${item.id}">삭제</button></td></tr>`).join('')}</tbody></table></div></section>`); }
function empty(text, action) { return `<div class="empty"><b>${text}</b><button class="secondary" data-action="add-schedule">${action}</button></div>`; }
function studentColor(id) { const n = [...id].reduce((sum, c) => sum + c.charCodeAt(0), 0); return COLOR[n % COLOR.length]; }

function modal(title, body) { return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true"><header><h2>${title}</h2><button class="modal-close" data-action="close-modal" aria-label="닫기">×</button></header>${body}</section></div>`; }
function studentForm(existing = {}) { return modal(existing.id ? '학생 정보 수정' : '학생 추가', `<form id="student-form" data-id="${existing.id||''}"><div class="form-grid"><label>이름<input required name="name" value="${esc(existing.name||'')}" placeholder="학생 이름" /></label><label>근무지<select name="site"><option value="general" ${existing.site==='general'||!existing.site?'selected':''}>총무팀</option><option value="holmz" ${existing.site==='holmz'?'selected':''}>HOLMZ</option></select></label><label>근로유형<select name="type"><option>교내근로</option><option ${existing.type==='국가근로'?'selected':''}>국가근로</option></select></label><label>상태<select name="active"><option value="true" ${existing.active!==false?'selected':''}>활성</option><option value="false" ${existing.active===false?'selected':''}>비활성</option></select></label></div><footer><button type="button" class="secondary" data-action="close-modal">취소</button><button class="primary" type="submit">저장</button></footer></form>`); }
function scheduleForm(existing = {}) { const site = existing.site || state.site; const selectedStudent = existing.studentId || students(site, false)[0]?.id || ''; return modal(existing.id ? '근무 일정 수정' : '근무 일정 추가', `<form id="schedule-form" data-id="${existing.id||''}"><div class="form-grid"><label>근무지<select name="site" id="schedule-site"><option value="general" ${site==='general'?'selected':''}>총무팀</option><option value="holmz" ${site==='holmz'?'selected':''}>HOLMZ</option></select></label><label>학생<select name="studentId" id="schedule-student">${students(site, false).map(s=>`<option value="${s.id}" ${s.id===selectedStudent?'selected':''}>${esc(s.name)}${s.active?'':' (비활성)'}</option>`).join('')}</select></label><label>일정 방식<select name="kind" id="schedule-kind"><option value="weekly" ${existing.kind!=='date'?'selected':''}>매주 반복</option><option value="date" ${existing.kind==='date'?'selected':''}>날짜 지정</option></select></label><label id="weekday-field">요일<select name="weekday">${[1,2,3,4,5,6,0].map(d=>`<option value="${d}" ${Number(existing.weekday)===d?'selected':''}>${DAYS[d]}요일</option>`).join('')}</select></label><label id="date-field" class="${existing.kind==='date'?'':'hidden'}">날짜<input type="date" name="date" value="${existing.date||iso(new Date())}" /></label><label>시작시간<input required type="time" name="start" value="${existing.start||'08:30'}" /></label><label>종료시간<input required type="time" name="end" value="${existing.end||'12:00'}" /></label></div><p class="form-hint">반복 일정은 매주 선택한 요일에 자동으로 표시됩니다.</p><footer><button type="button" class="secondary" data-action="close-modal">취소</button><button class="primary" type="submit">저장</button></footer></form>`); }

function render() { const views = { today: todayView, week: weekView, month: monthView, students: studentsView, schedules: schedulesView }; document.querySelector('#app').innerHTML = views[state.view](); bind(); }
function showModal(html) { document.body.insertAdjacentHTML('beforeend', html); bindModal(); }
function closeModal() { document.querySelector('.modal-backdrop')?.remove(); }
function toast(message) { const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'), 2400); }
function bind() {
  document.querySelectorAll('[data-site]').forEach(button => button.addEventListener('click', ()=>{ state.site=button.dataset.site; render(); }));
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', ()=>{ state.view=button.dataset.view; render(); }));
  document.querySelectorAll('[data-action]:not(input[type="file"])').forEach(button => button.addEventListener('click', event => action(button.dataset.action, event)));
  document.querySelector('input[data-action="import"]')?.addEventListener('change', importData);
  document.querySelectorAll('[data-edit-student]').forEach(b=>b.addEventListener('click',()=>showModal(studentForm(activeStudent(b.dataset.editStudent)))));
  document.querySelectorAll('[data-toggle-student]').forEach(b=>b.addEventListener('click',()=>{ const s=activeStudent(b.dataset.toggleStudent); s.active=!s.active; save(); toast(`${s.name} 학생을 ${s.active?'활성':'비활성'} 처리했습니다.`); render(); }));
  document.querySelectorAll('[data-delete-student]').forEach(b=>b.addEventListener('click',()=>deleteStudent(b.dataset.deleteStudent)));
  document.querySelectorAll('[data-edit-schedule]').forEach(b=>b.addEventListener('click',()=>showModal(scheduleForm(state.data.schedules.find(s=>s.id===b.dataset.editSchedule)))));
  document.querySelectorAll('[data-delete-schedule]').forEach(b=>b.addEventListener('click',()=>deleteSchedule(b.dataset.deleteSchedule)));
}
function action(name, event) {
  if (name==='add-student') showModal(studentForm({site:state.site}));
  if (name==='add-schedule') showModal(scheduleForm({site:state.site}));
  if (name==='close-modal') closeModal();
  if (name==='prev-week') { state.cursor=addDays(monday(state.cursor),-7); render(); }
  if (name==='next-week') { state.cursor=addDays(monday(state.cursor),7); render(); }
  if (name==='today-week') { state.cursor=new Date(); render(); }
  if (name==='prev-month') { state.cursor=new Date(state.cursor.getFullYear(),state.cursor.getMonth()-1,1); render(); }
  if (name==='next-month') { state.cursor=new Date(state.cursor.getFullYear(),state.cursor.getMonth()+1,1); render(); }
  if (name==='today-month') { state.cursor=new Date(); render(); }
  if (name==='export') exportData();
  if (name==='import') importData(event);
}
function bindModal() {
  const backdrop=document.querySelector('.modal-backdrop'); backdrop.addEventListener('click',e=>{if(e.target===backdrop) closeModal();});
  document.querySelectorAll('.modal [data-action="close-modal"]').forEach(b=>b.addEventListener('click',closeModal));
  const student=document.querySelector('#student-form'); if(student) student.addEventListener('submit',saveStudent);
  const schedule=document.querySelector('#schedule-form'); if(schedule) { schedule.addEventListener('submit',saveSchedule); const kind=schedule.querySelector('#schedule-kind'); const site=schedule.querySelector('#schedule-site'); kind.addEventListener('change',()=>toggleScheduleFields(schedule)); site.addEventListener('change',()=>refreshStudentOptions(schedule)); toggleScheduleFields(schedule); }
}
function toggleScheduleFields(form) { const date=form.querySelector('#date-field'); const weekday=form.querySelector('#weekday-field'); const byDate=form.querySelector('#schedule-kind').value==='date'; date.classList.toggle('hidden',!byDate); weekday.classList.toggle('hidden',byDate); }
function refreshStudentOptions(form) { const select=form.querySelector('#schedule-student'); select.innerHTML=students(form.querySelector('#schedule-site').value,false).map(s=>`<option value="${s.id}">${esc(s.name)}${s.active?'':' (비활성)'}</option>`).join(''); }
function saveStudent(e) { e.preventDefault(); const f=new FormData(e.currentTarget); const id=e.currentTarget.dataset.id; const record={id:id||uid('student'),name:f.get('name').trim(),site:f.get('site'),type:f.get('type'),active:f.get('active')==='true'}; if(id) { const i=state.data.students.findIndex(s=>s.id===id); state.data.students[i]=record; state.data.schedules.filter(s=>s.studentId===id).forEach(s=>{s.studentName=record.name;s.site=record.site;}); } else state.data.students.push(record); state.site=record.site; save(); closeModal(); toast('학생 정보를 저장했습니다.'); render(); }
function saveSchedule(e) { e.preventDefault(); const f=new FormData(e.currentTarget); const id=e.currentTarget.dataset.id; if(mins(f.get('end'))<=mins(f.get('start'))) return toast('종료시간은 시작시간보다 늦어야 합니다.'); const student=activeStudent(f.get('studentId')); const record={id:id||uid('schedule'),site:f.get('site'),studentId:student.id,studentName:student.name,kind:f.get('kind'),weekday:Number(f.get('weekday')),date:f.get('date'),start:f.get('start'),end:f.get('end')}; if(record.kind==='weekly') delete record.date; else delete record.weekday; if(id) state.data.schedules[state.data.schedules.findIndex(s=>s.id===id)]=record; else state.data.schedules.push(record); state.site=record.site; save(); closeModal(); toast('근무 일정을 저장했습니다.'); render(); }
function deleteStudent(id) { const student=activeStudent(id); const count=state.data.schedules.filter(s=>s.studentId===id).length; if(!confirm(`${student.name} 학생을 삭제할까요?${count?` 연결된 ${count}개 일정은 과거 기록으로 유지됩니다.`:''}`))return; state.data.students=state.data.students.filter(s=>s.id!==id); save(); toast('학생을 삭제했습니다. 과거 일정은 보존됩니다.'); render(); }
function deleteSchedule(id) { const item=state.data.schedules.find(s=>s.id===id); if(!confirm(`${item.studentName}의 ${timeText(item)} 일정을 삭제할까요?`))return; state.data.schedules=state.data.schedules.filter(s=>s.id!==id);save();toast('근무 일정을 삭제했습니다.');render(); }
function exportData() { const blob=new Blob([JSON.stringify(state.data,null,2)],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a');a.href=url;a.download=`seoul-workstudent-data-${iso(new Date())}.json`;a.click();URL.revokeObjectURL(url);toast('데이터를 JSON 파일로 내보냈습니다.'); }
function importData(event) { const file=event.target.files?.[0]; if(!file)return; const reader=new FileReader();reader.onload=()=>{try{const data=JSON.parse(reader.result);if(!Array.isArray(data.students)||!Array.isArray(data.schedules))throw Error();state.data=data;save();toast('데이터를 가져왔습니다.');render();}catch{toast('올바른 데이터 파일이 아닙니다.');}};reader.readAsText(file); }

if (typeof document !== 'undefined') {
  loadData().then(data=>{state.data=data;render();}).catch(()=>{document.querySelector('#app').innerHTML='<p class="fatal">데이터를 불러오지 못했습니다. 페이지를 새로고침해 주세요.</p>';});
}
