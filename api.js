/* 後台串接層：載入於 index.html 主程式之後，覆寫原本 localStorage 版本的函式 */
const API_URL = 'https://script.google.com/macros/s/AKfycbwo3LF53EDsv6-SEgnXx_RbdBCgfvjt1cM7z_Nse044o7wqizkjmb7oUAJuUlDDrbFL/exec'; // ← 貼上 Apps Script 部署後的「網頁應用程式網址」

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
async function enterClass(name) {
  const j = await api('getClass', { className: name });
  currentClassName = name;
  students = j.students;
  rewards = j.rewards.length ? j.rewards : JSON.parse(JSON.stringify(defaultRewards));
  initClasses(); renderStudents(); renderGroups(); renderRewards(); updateAIStudentDropdown();
}

async function bootstrap() {
  const j = await api('init');
  classesList = j.classes;
  subjects = j.subjects;                       // 科目清單改由試算表讀取
  if (!subjects.includes(currentSubject)) currentSubject = subjects[0];
  renderSubjects();
  if (!classesList.length) {
    await api('createClass', { name: '我的班級', count: 15 });
    classesList = ['我的班級'];
  }
  await enterClass(classesList.includes(currentClassName) ? currentClassName : classesList[0]);
}

function saveData() { // 取代 localStorage 版，0.6 秒防抖後同步到試算表
  clearTimeout(saveTimer);
  const snap = {
    className: currentClassName,
    students: JSON.parse(JSON.stringify(students)),
    rewards: JSON.parse(JSON.stringify(rewards))
  };
  saveTimer = setTimeout(() => api('saveClass', snap).catch(e => toast('⚠️ 同步失敗：' + e.message)), 600);
}

/* ---------- 登入 / 註冊 ---------- */
async function handleLogin(e) {
  if (e) e.preventDefault();
  const user = document.getElementById('auth-username').value.trim();
  const pass = document.getElementById('auth-password').value;
  const err = document.getElementById('auth-error-msg');
  try {
    const j = await api('login', { username: user, password: pass });
    sessionToken = j.token;
    sessionStorage.setItem('tk', sessionToken);
    isAuthenticated = true;
    await bootstrap();
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
  try {
    await api('register', { username: user, password: pass });
    ['reg-username', 'reg-password', 'reg-password2'].forEach(id => document.getElementById(id).value = '');
    showLoginForm();
    document.getElementById('auth-username').value = user;
    document.getElementById('auth-password').value = pass;
    playRewardSound();
    alert('🎉 教師帳號建立成功！請按「進入班級管理頁面」登入。');
  } catch (ex) {
    showErr(ex.message);
  }
}

function logoutTeacher() {
  sessionStorage.removeItem('tk');
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

  if (!sessionToken) return;
  try {
    await bootstrap();
    isAuthenticated = true;
    document.getElementById('auth-modal').classList.add('hidden');
  } catch (e) {
    sessionToken = '';
    sessionStorage.removeItem('tk');
  }
};
