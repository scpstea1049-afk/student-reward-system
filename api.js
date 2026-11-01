/* 後台串接層：載入於 index.html 主程式之後，覆寫原本 localStorage 版本的函式 */
const API_URL = 'https://script.google.com/macros/s/AKfycbz_Zddj8UxVbklWSlmIMmF0d-YCnwTG9lKMbsX6PFYO3v3c8wtqRqK4_y0UiJneQBJI/exec'; // ← 貼上 Apps Script 部署後的「網頁應用程式網址」

let sessionToken = sessionStorage.getItem('tk') || '';
let saveTimer = null;

async function api(action, data = {}) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // 避免 CORS 預檢
    body: JSON.stringify(Object.assign({ action, token: sessionToken }, data))
  });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || '伺服器錯誤');
  return j;
}

function toast(msg) {
  let t = document.getElementById('api-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'api-toast';
    t.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] bg-slate-800 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-lg';
    document.body.appendChild(t);
  }
  t.innerText = msg;
  t.classList.remove('hidden');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), 3000);
}

/* ---------- 資料載入 ---------- */
function applyBootData(j) {
  classesList = j.classes;
  subjects = j.subjects;
  if (!subjects.includes(currentSubject)) currentSubject = subjects[0];
  renderSubjects();
  currentClassName = j.current;
  localStorage.setItem('classroom_current_class', currentClassName);
  students = j.students;
  rewards = j.rewards.length ? j.rewards : JSON.parse(JSON.stringify(defaultRewards));
  initClasses(); renderStudents(); renderGroups(); renderRewards(); updateAIStudentDropdown();
  try { localStorage.setItem('boot_cache', JSON.stringify(j)); } catch (e) {}
}

function readBootCache() {
  try {
    const c = JSON.parse(localStorage.getItem('boot_cache'));
    return c && c.classes && c.classes.length ? c : null;
  } catch (e) { return null; }
}

async function enterClass(name) {
  const j = await api('getClass', { className: name });
  applyBootData({ classes: classesList, subjects: subjects, current: name, students: j.students, rewards: j.rewards });
}

async function bootstrap() {
  let j = await api('boot', { className: currentClassName });
  if (!j.classes.length) {
    await api('createClass', { name: '我的班級', count: 15 });
    j = await api('boot', { className: '我的班級' });
  }
  applyBootData(j);
}

function saveData() { // 取代 localStorage 版，0.6 秒防抖後同步到試算表
  clearTimeout(saveTimer);
  const snap = {
    className: currentClassName,
    students: JSON.parse(JSON.stringify(students)),
    rewards: JSON.parse(JSON.stringify(rewards))
  };
  try { // 同步更新本機快取，重新整理時先顯示最新狀態
    const c = readBootCache();
    if (c && c.current === currentClassName) { c.students = snap.students; c.rewards = snap.rewards; localStorage.setItem('boot_cache', JSON.stringify(c)); }
  } catch (e) {}
  saveTimer = setTimeout(() => api('saveClass', snap).catch(e => toast('⚠️ 同步失敗：' + e.message)), 600);
}

/* ---------- 登入 / 註冊 ---------- */
async function handleLogin(e) {
  if (e) e.preventDefault();
  const user = document.getElementById('auth-username').value.trim();
  const pass = document.getElementById('auth-password').value;
  const err = document.getElementById('auth-error-msg');
  try {
    const j = await api('login', { username: user, password: pass, className: currentClassName });
    sessionToken = j.token;
    sessionStorage.setItem('tk', sessionToken);
    isAuthenticated = true;
    if (j.classes && j.classes.length) applyBootData(j); else await bootstrap();
    document.getElementById('auth-modal').classList.add('hidden');
    err.classList.add('hidden');
    playRewardSound();
  } catch (ex) {
    err.innerText = '⚠️ ' + ex.message;
    err.classList.remove('hidden');
    playEncourageSound();
  }
}

async function handleRegister(e) {
  if (e) e.preventDefault();
  const user = document.getElementById('reg-username').value.trim();
  const pass = document.getElementById('reg-password').value;
  const pass2 = document.getElementById('reg-password2').value;
  const errBox = document.getElementById('reg-error-msg');
  const showErr = msg => { errBox.innerText = '⚠️ ' + msg; errBox.classList.remove('hidden'); playEncourageSound(); };

  if (user.length < 3) return showErr('帳號至少需要 3 個字元');
  if (pass.length < 4) return showErr('密碼至少需要 4 個字元');
  if (pass !== pass2) return showErr('兩次輸入的密碼不一致');
  const question = document.getElementById('reg-question').value;
  const answer = document.getElementById('reg-answer').value.trim();
  if (answer.length < 2) return showErr('請設定安全問題的答案（至少 2 個字）');
  try {
    await api('register', { username: user, password: pass, question, answer });
    ['reg-username', 'reg-password', 'reg-password2', 'reg-answer'].forEach(id => document.getElementById(id).value = '');
    showLoginForm();
    document.getElementById('auth-username').value = user;
    document.getElementById('auth-password').value = pass;
    playRewardSound();
    alert('🎉 教師帳號建立成功！請按「進入班級管理頁面」登入。');
  } catch (ex) {
    showErr(ex.message);
  }
}

/* ---------- 表單切換 / 忘記密碼 ---------- */
const AUTH_FORMS = ['login-form', 'register-form', 'reset-form'];
function showAuthForm(id, title, desc) {
  AUTH_FORMS.forEach(f => document.getElementById(f).classList.toggle('hidden', f !== id));
  document.getElementById('auth-title').innerText = title;
  document.getElementById('auth-desc').innerText = desc;
}
function showLoginForm() {
  showAuthForm('login-form', '教師身份驗證', '請輸入教師帳號密碼以解鎖「星星班級加分王」');
}
function showRegisterForm() {
  document.getElementById('reg-error-msg').classList.add('hidden');
  showAuthForm('register-form', '建立教師帳號', '設定專屬帳號密碼，保護您的班級資料');
}
function showResetForm() {
  document.getElementById('reset-step2').classList.add('hidden');
  document.getElementById('reset-error-msg').classList.add('hidden');
  document.getElementById('reset-username').value = document.getElementById('auth-username').value;
  showAuthForm('reset-form', '忘記密碼', '密碼無法直接查看，請回答安全問題後重新設定');
}
function resetErr(msg) {
  const b = document.getElementById('reset-error-msg');
  b.innerText = '⚠️ ' + msg;
  b.classList.remove('hidden');
  playEncourageSound();
}
async function handleGetQuestion() {
  const u = document.getElementById('reset-username').value.trim();
  if (!u) return resetErr('請先輸入教師帳號');
  try {
    const j = await api('getQuestion', { username: u });
    document.getElementById('reset-question').innerText = j.question;
    document.getElementById('reset-error-msg').classList.add('hidden');
    document.getElementById('reset-step2').classList.remove('hidden');
  } catch (e) { resetErr(e.message); }
}
async function handleResetPassword(e) {
  if (e) e.preventDefault();
  if (document.getElementById('reset-step2').classList.contains('hidden')) return handleGetQuestion();
  const u = document.getElementById('reset-username').value.trim();
  const answer = document.getElementById('reset-answer').value;
  const np = document.getElementById('reset-pass').value;
  if (np.length < 4) return resetErr('新密碼至少需要 4 個字元');
  if (np !== document.getElementById('reset-pass2').value) return resetErr('兩次輸入的新密碼不一致');
  try {
    await api('resetPassword', { username: u, answer, newPassword: np });
    ['reset-answer', 'reset-pass', 'reset-pass2'].forEach(id => document.getElementById(id).value = '');
    showLoginForm();
    document.getElementById('auth-username').value = u;
    document.getElementById('auth-password').value = '';
    playRewardSound();
    alert('✅ 密碼已重設，請使用新密碼登入。');
  } catch (ex) { resetErr(ex.message); }
}

function logoutTeacher() {
  sessionStorage.removeItem('tk');
  localStorage.removeItem('boot_cache');
  location.reload();
}

/* ---------- 班級管理 ---------- */
async function switchClass(name) {
  try { await enterClass(name); } catch (e) { toast('⚠️ ' + e.message); }
}

async function createNewClass() {
  const name = document.getElementById('new-class-name').value.trim();
  const count = parseInt(document.getElementById('new-class-count').value) || 0;
  if (!name) return alert('請輸入班級名稱！');
  if (classesList.includes(name)) return alert('此班級名稱已存在！');
  try {
    await api('createClass', { name, count });
    classesList.push(name);
    document.getElementById('new-class-name').value = '';
    closeModal('create-class-modal');
    await enterClass(name);
    alert(`🎉 班級「${name}」建立成功！`);
  } catch (e) { alert(e.message); }
}

async function deleteCurrentClass() {
  if (classesList.length <= 1) return alert('無法刪除，系統至少需要保留一個班級！');
  if (!confirm(`確定要刪除當前班級「${currentClassName}」及其所有資料嗎？此操作無法恢復。`)) return;
  try {
    await api('deleteClass', { className: currentClassName });
    classesList = classesList.filter(c => c !== currentClassName);
    closeModal('create-class-modal');
    await enterClass(classesList[0]);
  } catch (e) { alert(e.message); }
}

/* ---------- 科目（存於 Subjects 工作表） ---------- */
async function addSubject() {
  const name = (prompt('請輸入新科目名稱（例如：閱讀、生活、社團）：') || '').trim();
  if (!name) return;
  if (subjects.includes(name)) return alert('此科目已存在！');
  try {
    subjects = (await api('addSubject', { name })).subjects;
    changeSubject(name);
    renderSubjects();
  } catch (e) { alert(e.message); }
}

async function removeSubject() {
  if (subjects.length <= 1) return alert('至少需要保留一個科目！');
  if (!confirm(`確定要刪除科目「${currentSubject}」嗎？\n（學生已累積的總星星與歷史紀錄不會被刪除）`)) return;
  try {
    subjects = (await api('removeSubject', { name: currentSubject })).subjects;
    changeSubject(subjects[0]);
    renderSubjects();
  } catch (e) { alert(e.message); }
}

/* ---------- 學習情形紀錄（寫入 Logs 工作表） ---------- */
function logEvent(student, points, reason) {
  api('log', { className: currentClassName, studentId: student.id, studentName: student.name, points, reason, subject: currentSubject })
    .catch(() => {});
}
const _applyScore = applyScore;
applyScore = function (points, reason, type) {
  const s = students.find(x => x.id === selectedStudentId);
  if (s) logEvent(s, points, reason);
  _applyScore(points, reason, type);
};

/* ---------- 啟動 ---------- */
window.onload = async function () {
  // 正式版不再預填預設帳密
  document.getElementById('auth-username').value = '';
  document.getElementById('auth-password').value = '';
  document.getElementById('auth-username').placeholder = '請輸入教師帳號';
  document.getElementById('auth-password').placeholder = '請輸入密碼';
  document.querySelectorAll('#auth-modal .border-t')[0]?.classList.add('hidden');

  if (!sessionToken) { localStorage.removeItem('boot_cache'); return; }
  const cached = readBootCache();   // 先用快取立即顯示，再於背景向試算表更新
  if (cached) {
    applyBootData(cached);
    isAuthenticated = true;
    document.getElementById('auth-modal').classList.add('hidden');
  }
  try {
    await bootstrap();
    isAuthenticated = true;
    document.getElementById('auth-modal').classList.add('hidden');
  } catch (e) {
    sessionToken = '';
    sessionStorage.removeItem('tk');
    localStorage.removeItem('boot_cache');
    document.getElementById('auth-modal').classList.remove('hidden');
  }
};
