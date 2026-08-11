// ============================================================
// 앱 라우터
// ============================================================

const App = {
  _tab: null,

  init() {
    // 로그인 상태 확인
    const s = Auth.current();
    if (!s) {
      this._showLogin();
      return;
    }
    this._showApp(s);
  },

  _showLogin() {
    document.getElementById('view-login').classList.add('active');
    document.getElementById('view-app').style.display = 'none';
    const btn = document.getElementById('btn-login');
    const inp = document.getElementById('login-id');
    const err = document.getElementById('login-error');
    err.textContent = '';
    inp.value = '';
    inp.focus();

    const doLogin = async () => {
      err.textContent = '';
      btn.disabled = true;
      btn.textContent = '로그인 중...';
      const r = await Auth.login(inp.value);
      btn.disabled = false;
      btn.textContent = '로그인';
      if (!r.ok) {
        err.textContent = r.error || '로그인 실패';
        return;
      }
      this._showApp(r);
    };
    btn.onclick = doLogin;
    inp.onkeydown = e => { if (e.key === 'Enter') doLogin(); };
  },

  _showApp(session) {
    document.getElementById('view-login').classList.remove('active');
    document.getElementById('view-app').style.display = 'flex';
    document.getElementById('header-user').textContent = `${session.name || session.id} (${session.role === 'admin' ? '관리자' : '시공사'})`;
    document.getElementById('btn-logout').onclick = () => { Auth.logout(); location.reload(); };

    // 탭 렌더링
    const isAdmin = session.role === 'admin';
    const tabs = isAdmin ? Admin.navTabs() : Contractor.navTabs();
    const nav = document.getElementById('app-nav');
    nav.innerHTML = tabs.map(t => `<button class="nav-btn" data-tab="${t.id}">${t.label}</button>`).join('');
    nav.querySelectorAll('.nav-btn').forEach(b => {
      b.onclick = () => this.showTab(b.dataset.tab, isAdmin);
    });

    this.showTab(tabs[0].id, isAdmin);
  },

  showTab(id, isAdmin) {
    this._tab = id;
    document.querySelectorAll('#app-nav .nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
    const content = document.getElementById('app-content');
    content.innerHTML = '<div class="empty-state"><div class="empty-state-desc">로딩 중...</div></div>';
    if (isAdmin === undefined) isAdmin = Auth.isAdmin();
    if (isAdmin) Admin.render(id, content);
    else Contractor.render(id, content);
  },

  onTokenExpired() {
    Utils.toast('세션이 만료되었습니다. 다시 로그인해주세요.');
    Auth.logout();
    location.reload();
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
