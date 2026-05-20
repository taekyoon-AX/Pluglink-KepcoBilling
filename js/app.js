// ============================================================
// App Router: handles view switching based on auth state
// ============================================================

const App = {
  init() {
    // 로그인 버튼
    document.getElementById('btn-login').onclick = () => this.handleLogin();
    document.getElementById('login-pw').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.handleLogin();
    });

    // 모달 닫기
    document.getElementById('modal-close').onclick = () => {
      document.getElementById('modal-overlay').classList.remove('active');
    };
    document.getElementById('modal-overlay').onclick = (e) => {
      if (e.target.id === 'modal-overlay') {
        document.getElementById('modal-overlay').classList.remove('active');
      }
    };

    this.route();
  },

  async route() {
    const auth = Auth.current();
    if (!auth) {
      this.showView('login');
      return;
    }

    // 로그인되어 있으면 클라우드에서 먼저 최신 데이터 가져오기
    if (Sync.enabled()) {
      try {
        await Sync.pull();
      } catch (e) {
        console.warn('cloud pull failed', e);
      }
    }

    if (auth.role === 'admin') {
      this.showView('admin');
      AdminView.init();
    } else if (auth.role === 'contractor') {
      this.showView('contractor');
      ContractorView.init();
    }
  },

  showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${name}`).classList.add('active');
  },

  async handleLogin() {
    const id = document.getElementById('login-id').value.trim();
    const pw = document.getElementById('login-pw').value;
    const errEl = document.getElementById('login-error');
    const btn = document.getElementById('btn-login');
    errEl.textContent = '';

    if (!id || !pw) {
      errEl.textContent = '아이디와 비밀번호를 입력하세요.';
      return;
    }
    btn.disabled = true;
    btn.textContent = '로그인 중...';
    try {
      const result = await Auth.login(id, pw);
      if (!result.ok) {
        errEl.textContent = result.error;
        return;
      }
      document.getElementById('login-id').value = '';
      document.getElementById('login-pw').value = '';
      await this.route();
    } finally {
      btn.disabled = false;
      btn.textContent = '로그인';
    }
  },

  logout() {
    Auth.logout();
    this.route();
  },

  onTokenExpired() {
    Storage.clearAuth();
    Sync.clearToken();
    alert('세션이 만료되었습니다. 다시 로그인해주세요.');
    this.route();
  },
};

// Bootstrap
document.addEventListener('DOMContentLoaded', () => App.init());
