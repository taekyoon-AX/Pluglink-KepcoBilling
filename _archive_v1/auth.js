// ============================================================
// Authentication: 서버 기반 (Apps Script) + 로컬 폴백
// ============================================================

const Auth = {
  /**
   * 서버 로그인 (Apps Script). 서버 연결이 없으면 로컬 비번 폴백 (테스트용).
   */
  async login(id, pw) {
    if (Sync.enabled()) {
      const r = await Sync.login(id, pw);
      if (!r || !r.ok) {
        return { ok: false, error: (r && r.error) || '로그인 실패' };
      }
      const auth = {
        id: r.id,
        role: r.role,
        name: r.name || r.id,
        at: new Date().toISOString(),
        projectSheetUrl: r.projectSheetUrl || '',
        projectSheetGid: r.projectSheetGid || '',
        via: 'server',
      };
      Storage.setAuth(auth);
      return { ok: true, auth };
    }

    // 폴백: 로컬 accounts (Apps Script 미설정 시 테스트 전용)
    const accounts = Storage.getAccounts();
    const acc = accounts[id];
    if (!acc || acc.password !== pw) {
      return { ok: false, error: '아이디 또는 비밀번호가 올바르지 않습니다.' };
    }
    const auth = {
      id, role: acc.role, name: acc.name,
      at: new Date().toISOString(),
      projectSheetUrl: acc.projectSheetUrl || '',
      projectSheetGid: acc.projectSheetGid || '',
      via: 'local',
    };
    Storage.setAuth(auth);
    return { ok: true, auth };
  },

  logout() {
    Storage.clearAuth();
    Sync.clearToken();
  },

  current() {
    return Storage.getAuth();
  },

  isAdmin() {
    const a = this.current();
    return a && a.role === 'admin';
  },

  isContractor() {
    const a = this.current();
    return a && a.role === 'contractor';
  },
};
