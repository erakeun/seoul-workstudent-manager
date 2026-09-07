/**
 * 서울 총무팀 근로장학생 관리 API
 *
 * 이 파일은 Apps Script 프로젝트에 배포하는 서버 코드입니다.
 * 배포 전 프로젝트 설정 > 스크립트 속성에 INITIAL_ADMIN_PASSWORD를 설정한 뒤
 * 편집기에서 initialize()를 한 번 실행합니다. 이 값은 GitHub에 올리지 않습니다.
 */
const DATA_KEY = 'seoul_workstudent_data_v2';
const SESSION_PREFIX = 'seoul_workstudent_session_';
const SESSION_HOURS = 24;

function doGet(e) { return handle_(request_(e)); }
function doPost(e) { return handle_(request_(e)); }

function request_(e) {
  const params = (e && e.parameter) || {};
  let body = {};
  try { body = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {}; } catch (_) {}
  return Object.assign({}, body, params, { action: body.action || params.action || '' });
}

function handle_(req) {
  try {
    const action = req.action;
    if (action === 'login') return respond_(login_(req.username, req.password));
    if (action === 'logout') return respond_(logout_(req.token));
    if (action === 'session') return respond_(loadApp_(req.token));
    if (action === 'loadApp') return respond_(loadApp_(req.token));
    if (action === 'adminSaveData') return respond_(adminSaveData_(req.token, req.data));
    if (action === 'adminUpsertUser') return respond_(adminUpsertUser_(req.token, req.user));
    if (action === 'adminDeleteUser') return respond_(adminDeleteUser_(req.token, req.userId));
    if (action === 'studentCreateSwap') return respond_(studentCreateSwap_(req.token, req.swap));
    if (action === 'adminUpdateSwap') return respond_(adminUpdateSwap_(req.token, req.swapId, req.status, req.note));
    if (action === 'studentMarkNoticeRead') return respond_(studentMarkNoticeRead_(req.token, req.noticeId));
    return respond_({ ok: false, error: '알 수 없는 요청입니다.' });
  } catch (err) {
    return respond_({ ok: false, error: err.message || '서버 처리 중 오류가 발생했습니다.' });
  }
}

function respond_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

/** 최초 1회 편집기에서 실행. 프로젝트 속성의 INITIAL_ADMIN_PASSWORD가 필요합니다. */
function initialize() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(DATA_KEY)) return '이미 초기화되었습니다.';
  const password = props.getProperty('INITIAL_ADMIN_PASSWORD');
  if (!password) throw new Error('프로젝트 설정에 INITIAL_ADMIN_PASSWORD를 먼저 설정하세요.');
  const admin = makeUser_({ id: Utilities.getUuid(), username: 'admin', name: '서울 총무팀 관리자', role: 'admin', active: true }, password);
  saveData_({ students: [], schedules: [], accounts: [admin], notices: [], handovers: [], swaps: [], settings: { initializedAt: new Date().toISOString() } });
  return '초기 관리자 계정이 생성되었습니다. 로그인 후 즉시 비밀번호를 변경하세요.';
}

function login_(username, password) {
  const data = data_();
  const account = data.accounts.find(x => x.username === String(username || '').trim() && x.active);
  if (!account || account.passwordHash !== hash_(password, account.salt)) return { ok: false, error: '아이디 또는 비밀번호를 확인하세요.' };
  const token = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty(SESSION_PREFIX + token, JSON.stringify({ userId: account.id, expiresAt: Date.now() + SESSION_HOURS * 3600000 }));
  return { ok: true, token: token, user: publicUser_(account), data: publicData_(data) };
}

function logout_(token) { PropertiesService.getScriptProperties().deleteProperty(SESSION_PREFIX + token); return { ok: true }; }
function loadApp_(token) { const user = requireUser_(token); return { ok: true, user: publicUser_(user), data: publicData_(data_()) }; }

function adminSaveData_(token, incoming) {
  requireAdmin_(token);
  if (!incoming || !Array.isArray(incoming.students) || !Array.isArray(incoming.schedules)) throw new Error('저장할 데이터 형식이 올바르지 않습니다.');
  const current = data_();
  current.students = incoming.students;
  current.schedules = incoming.schedules;
  current.notices = Array.isArray(incoming.notices) ? incoming.notices : current.notices;
  current.handovers = Array.isArray(incoming.handovers) ? incoming.handovers : current.handovers;
  current.swaps = Array.isArray(incoming.swaps) ? incoming.swaps : current.swaps;
  saveData_(current);
  return { ok: true, data: publicData_(current) };
}

function adminUpsertUser_(token, incoming) {
  requireAdmin_(token);
  if (!incoming || !incoming.username || !incoming.name || !incoming.role) throw new Error('이름, 아이디, 역할은 필수입니다.');
  const data = data_();
  let user = data.accounts.find(x => x.id === incoming.id);
  if (user) {
    if (data.accounts.some(x => x.id !== user.id && x.username === incoming.username)) throw new Error('이미 사용 중인 아이디입니다.');
    user.username = incoming.username; user.name = incoming.name; user.role = incoming.role; user.studentId = incoming.studentId || ''; user.active = incoming.active !== false;
    if (incoming.password) { user.salt = Utilities.getUuid(); user.passwordHash = hash_(incoming.password, user.salt); }
  } else {
    if (!incoming.password) throw new Error('새 계정의 초기 비밀번호를 입력하세요.');
    if (data.accounts.some(x => x.username === incoming.username)) throw new Error('이미 사용 중인 아이디입니다.');
    user = makeUser_({ id: Utilities.getUuid(), username: incoming.username, name: incoming.name, role: incoming.role, studentId: incoming.studentId || '', active: incoming.active !== false }, incoming.password);
    data.accounts.push(user);
  }
  saveData_(data); return { ok: true, data: publicData_(data) };
}

function adminDeleteUser_(token, userId) {
  const admin = requireAdmin_(token); const data = data_();
  if (admin.id === userId) throw new Error('현재 로그인한 관리자 계정은 삭제할 수 없습니다.');
  data.accounts = data.accounts.filter(x => x.id !== userId); saveData_(data); return { ok: true, data: publicData_(data) };
}

function studentCreateSwap_(token, swap) {
  const user = requireUser_(token); if (user.role !== 'student') throw new Error('학생 계정만 대타 요청을 등록할 수 있습니다.');
  if (!swap || !swap.scheduleId || !swap.date || !swap.reason) throw new Error('대상 일정과 사유를 입력하세요.');
  const data = data_();
  const schedule = data.schedules.find(x => x.id === swap.scheduleId && x.studentId === user.studentId);
  if (!schedule) throw new Error('본인의 근무 일정만 요청할 수 있습니다.');
  data.swaps.unshift({ id: Utilities.getUuid(), scheduleId: schedule.id, site: schedule.site, requesterId: user.id, requesterName: user.name, date: swap.date, reason: swap.reason, status: '대기', adminNote: '', createdAt: new Date().toISOString() });
  saveData_(data); return { ok: true, data: publicData_(data) };
}

function adminUpdateSwap_(token, swapId, status, note) {
  requireAdmin_(token); const data = data_(); const swap = data.swaps.find(x => x.id === swapId); if (!swap) throw new Error('대타 요청을 찾을 수 없습니다.');
  swap.status = status; swap.adminNote = note || ''; swap.updatedAt = new Date().toISOString(); saveData_(data); return { ok: true, data: publicData_(data) };
}

function studentMarkNoticeRead_(token, noticeId) {
  const user = requireUser_(token); const data = data_(); const notice = data.notices.find(x => x.id === noticeId); if (!notice) throw new Error('공지를 찾을 수 없습니다.');
  notice.readBy = notice.readBy || []; if (!notice.readBy.includes(user.id)) notice.readBy.push(user.id); saveData_(data); return { ok: true };
}

function requireUser_(token) {
  const sessionRaw = PropertiesService.getScriptProperties().getProperty(SESSION_PREFIX + token);
  if (!sessionRaw) throw new Error('로그인이 필요하거나 세션이 만료되었습니다.');
  const session = JSON.parse(sessionRaw); if (session.expiresAt < Date.now()) { PropertiesService.getScriptProperties().deleteProperty(SESSION_PREFIX + token); throw new Error('세션이 만료되었습니다. 다시 로그인하세요.'); }
  const user = data_().accounts.find(x => x.id === session.userId && x.active); if (!user) throw new Error('사용할 수 없는 계정입니다.'); return user;
}
function requireAdmin_(token) { const user = requireUser_(token); if (user.role !== 'admin') throw new Error('관리자 권한이 필요합니다.'); return user; }
function data_() { const raw = PropertiesService.getScriptProperties().getProperty(DATA_KEY); if (!raw) throw new Error('서버 초기화가 필요합니다.'); return JSON.parse(raw); }
function saveData_(data) { PropertiesService.getScriptProperties().setProperty(DATA_KEY, JSON.stringify(data)); }
function hash_(password, salt) { let value = String(password || '') + ':' + salt; for (let i = 0; i < 5000; i++) value = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value)); return value; }
function makeUser_(fields, password) { const salt = Utilities.getUuid(); return Object.assign({}, fields, { salt: salt, passwordHash: hash_(password, salt) }); }
function publicUser_(user) { return { id: user.id, username: user.username, name: user.name, role: user.role, studentId: user.studentId || '', active: user.active }; }
function publicData_(data) { return { students: data.students || [], schedules: data.schedules || [], notices: data.notices || [], handovers: data.handovers || [], swaps: data.swaps || [], accounts: (data.accounts || []).map(publicUser_) }; }
