// ============================================================
// App Router: handles view switching based on auth state
// ============================================================

const App = {
  // 포털 뷰잉 컨텍스트 (관리자가 특정 시공사 섹션으로 전환했을 때 설정)
  _viewAsContractor: null,
  _currentSection: 'admin',

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
      this.hidePortalBar();
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
      // 관리자 로그인 → 포털 전환 바 노출 (기본 섹션은 관리자)
      this._currentSection = 'admin';
      this._viewAsContractor = null;
      this.renderPortalBar();
      this.showView('admin');
      AdminView.init();
    } else if (auth.role === 'contractor') {
      // 시공사 직접 로그인 → 포털 바 숨김 (기존 동작)
      this.hidePortalBar();
      this.showView('contractor');
      ContractorView.init();
    }
  },

  showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${name}`).classList.add('active');
  },

  hidePortalBar() {
    const bar = document.getElementById('portal-bar');
    if (bar) bar.hidden = true;
  },

  /**
   * 포털 전환 바 렌더 — 관리자 로그인 상태일 때만 호출.
   * [관리자] [시공사A] [시공사B] ... 버튼 생성.
   */
  renderPortalBar() {
    const auth = Auth.current();
    if (!auth || auth.role !== 'admin') { this.hidePortalBar(); return; }

    const bar = document.getElementById('portal-bar');
    const tabsEl = document.getElementById('portal-bar-tabs');
    if (!bar || !tabsEl) return;

    const cfg = Storage.getConfig();
    const portalIds = cfg.portalContractors || [];
    const contractors = Storage.getContractors();
    const byId = {};
    contractors.forEach(c => { byId[c.id] = c; });

    const sections = [{ key: 'admin', label: '🛠 관리자', isAdmin: true }];
    portalIds.forEach(id => {
      const c = byId[id];
      if (c) sections.push({ key: 'contractor:' + id, label: c.name, contractor: c });
    });

    tabsEl.innerHTML = sections.map(s => {
      const cls = ['tab-btn'];
      if (s.isAdmin) cls.push('admin-tab');
      if (s.key === this._currentSection) cls.push('active');
      return `<button class="${cls.join(' ')}" data-section="${s.key}">${s.label}</button>`;
    }).join('');

    tabsEl.querySelectorAll('button').forEach(btn => {
      btn.onclick = () => this.switchSection(btn.dataset.section);
    });

    bar.hidden = false;
  },

  /**
   * 섹션 전환: 'admin' 또는 'contractor:<id>'
   */
  async switchSection(key) {
    const auth = Auth.current();
    if (!auth || auth.role !== 'admin') return;
    if (key === this._currentSection) return;

    this._currentSection = key;
    if (key === 'admin') {
      this._viewAsContractor = null;
      this.showView('admin');
      AdminView.init();
    } else if (key.startsWith('contractor:')) {
      const id = key.slice('contractor:'.length);
      const c = Storage.getContractors().find(x => x.id === id);
      if (!c) {
        alert('시공사 정보를 찾을 수 없습니다: ' + id);
        this.switchSection('admin');
        return;
      }
      this._viewAsContractor = {
        id: c.id,
        name: c.name,
        projectSheetUrl: c.projectSheetUrl || '',
        projectSheetGid: c.projectSheetGid || '',
        viewAs: true,
      };
      this.showView('contractor');
      await ContractorView.init(this._viewAsContractor);
    }
    this.renderPortalBar(); // active 상태 갱신
  },

  /**
   * ContractorView 등 다른 모듈에서 호출. 뷰잉-애즈 모드면 그 ctx 를 반환,
   * 아니면 실제 Auth.current() 반환.
   */
  effectiveContractorAuth() {
    return this._viewAsContractor || Auth.current();
  },

  async handleLogin() {
    const id = document.getElementById('login-id').value.trim();
    const pw = document.getElementById('login-pw').value;
    const errEl = document.getElementById('login-error');
    const btn = document.getElementById('btn-login');
    errEl.textContent = '';

    // 비밀번호 비활성화: 아이디만 입력해도 통과
    if (!id) {
      errEl.textContent = '아이디를 입력하세요.';
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
