// ============================================================
// 세션 · 인증 (비밀번호 없음 — 아이디만)
// ============================================================

const Auth = {
  _KEY: 'pl_kepco_session',

  current() {
    try { return JSON.parse(sessionStorage.getItem(this._KEY) || 'null'); }
    catch (e) { return null; }
  },

  async login(id) {
    id = String(id || '').trim();
    if (!id) return { ok: false, error: '아이디를 입력하세요.' };
    // 서버 로그인 (비밀번호 없이)
    if (API.enabled()) {
      const r = await API.login(id, '');
      if (r && r.ok) {
        const session = { id, role: r.role || (id === 'admin' ? 'admin' : 'contractor'), name: r.name || id };
        sessionStorage.setItem(this._KEY, JSON.stringify(session));
        return { ok: true, ...session };
      }
      // 서버 실패 시 로컬 fallback (admin만 허용, 계약사는 관리자가 등록해야 함)
      if (id === 'admin') {
        const session = { id: 'admin', role: 'admin', name: '관리자' };
        sessionStorage.setItem(this._KEY, JSON.stringify(session));
        return { ok: true, ...session, fallback: true };
      }
      return { ok: false, error: r && r.error ? r.error : '로그인 실패' };
    }
    // API 미설정: admin만 로컬 진입 허용
    if (id === 'admin') {
      const session = { id: 'admin', role: 'admin', name: '관리자' };
      sessionStorage.setItem(this._KEY, JSON.stringify(session));
      return { ok: true, ...session, fallback: true };
    }
    return { ok: false, error: '서버 URL을 먼저 설정해주세요 (설정 탭).' };
  },

  logout() {
    sessionStorage.removeItem(this._KEY);
    API.clearToken();
  },

  isAdmin() {
    const s = this.current();
    return s && s.role === 'admin';
  },
};
