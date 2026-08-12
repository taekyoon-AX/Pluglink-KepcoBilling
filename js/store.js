// ============================================================
// LocalStorage 저장소 (설정 · 세션 캐시)
// ============================================================

const Store = {
  _CFG_KEY: 'pl_kepco_cfg_v2',

  getConfig() {
    try {
      const raw = localStorage.getItem(this._CFG_KEY);
      const cfg = raw ? JSON.parse(raw) : {};
      return {
        // 시트 설정
        processingSheetUrl: '',
        processingSheetGid: '',
        processingSheetName: '한전 표준시설부담금 납부내역(윤택)',
        pendingSheetUrl: '',
        pendingSheetGid: '',
        pendingSheetName: '납부대기',
        // 중앙 프로젝트 시트 (PM_영차영차new)
        centralProjectSheetUrl: '',
        centralProjectSheetGid: '',
        centralProjectSheetName: 'PM_영차영차new',
        centralIdCol: 'B', // 프로젝트ID 컬럼
        // 참조 컬럼들 (PM 시트)
        pmSiteNameCol: 'D',     // 현장명
        pmAddressCol: 'E',      // 도로명주소
        pmCategoryCol: 'F',     // 사업구분
        pmWaitingNumCol: 'A',   // 대기번호
        pmContractSumCol: 'X',  // 계약합계
        pmContractorCol: 'I',   // 시공사
        // Drive 폴더 — 사업구분별 개별 폴더 (없으면 default 사용)
        folders: {
          env25:   { url: '', id: '' },
          private: { url: '', id: '' },
          env26:   { url: '', id: '' },
          default: { url: '', id: '' },
        },
        // (구) 단일 폴더 — 하위 호환
        processedFolderId: '',
        processedFolderUrl: '',
        // FLEX 연동 (미구현 stub)
        flexEndpoint: '',
        flexEnabled: false,
        // 오버라이드
        ...cfg,
      };
    } catch (e) {
      console.warn('config load error', e);
      return this.getConfig();
    }
  },

  setConfig(cfg) {
    localStorage.setItem(this._CFG_KEY, JSON.stringify(cfg));
  },

  patchConfig(patch) {
    const cfg = this.getConfig();
    Object.assign(cfg, patch);
    this.setConfig(cfg);
    return cfg;
  },
};
