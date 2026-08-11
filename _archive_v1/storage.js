// ============================================================
// Storage Layer: localStorage for config/data, IndexedDB for files
// ============================================================

const LS_KEYS = {
  CONFIG: 'kepco_config',
  PROJECTS: 'kepco_projects',
  SUBMISSIONS: 'kepco_submissions',
  ACCOUNTS: 'kepco_accounts',
  AUTH: 'kepco_auth',
};

const DEFAULT_CONFIG = {
  deadlineDow: 2,      // 화요일
  deadlineTime: '23:59',
  processDow: 4,       // 목요일
  excelDow: 3,         // 수요일
  excelTime: '10:00',
  lastExcelExport: null,
  // 중앙 프로젝트 시트 (시공사별 자동 필터링)
  centralProjectSheetUrl: 'https://docs.google.com/spreadsheets/d/1onfjrPZoISzT3uiAGBpTNMl5wWiRxIyAzvETycrGBMk/edit',
  centralProjectSheetGid: '',
  centralProjectSheetName: 'PM_영차영차new',
  // 처리 결과 기록 시트 (바로처리/이체증 업로드 시 자동 추가)
  processingSheetUrl: 'https://docs.google.com/spreadsheets/d/1onfjrPZoISzT3uiAGBpTNMl5wWiRxIyAzvETycrGBMk/edit',
  processingSheetGid: '',
  processingSheetName: '한전 표준시설부담금 납부내역(윤택)',
  // 처리완료 파일 저장 폴더 (관리자가 지정)
  processedFolderUrl: '',
  processedFolderId: '',
};

// ⚠️ 이 기본 계정은 Apps Script 미설정 시에만 테스트용으로 사용됨.
// 실제 운영에서는 Apps Script Properties 에 저장된 계정이 사용되며,
// 브라우저에는 비밀번호가 절대 내려오지 않습니다.
const DEFAULT_ACCOUNTS = {
  admin: { password: 'pluglink1234', role: 'admin', name: '관리자' },
  '나이스테크': {
    password: 'ty1234', role: 'contractor', name: '나이스테크',
    projectSheetUrl: '', projectSheetGid: '',
  },
  '택윤컴퍼니2': {
    password: 'ty5678', role: 'contractor', name: '택윤컴퍼니2',
    projectSheetUrl: '', projectSheetGid: '',
  },
};

const DEFAULT_PROJECTS = {
  '23366': '삼일아파트_1차 (무지개삼일)',
  '26389': '신도6-1차(20기)',
  '26968': '신도6-1차(2기)',
  '27097': '길음뉴타운 경남아너스빌_1차',
  '27190': '보령시영아파트_1차',
  '27388': '청수극동2차아파트_1차',
};

const Storage = {
  // ---- Config ----
  getConfig() {
    const raw = localStorage.getItem(LS_KEYS.CONFIG);
    return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : { ...DEFAULT_CONFIG };
  },
  setConfig(cfg) {
    localStorage.setItem(LS_KEYS.CONFIG, JSON.stringify(cfg));
  },

  // ---- Accounts ----
  // 서버 모드: Apps Script 에서 받은 계정 정보 캐시 (비밀번호 없음)
  // 로컬 모드: Apps Script 미설정 시 테스트 전용 (비밀번호 포함)
  getAccounts() {
    const raw = localStorage.getItem(LS_KEYS.ACCOUNTS);
    if (!raw) {
      localStorage.setItem(LS_KEYS.ACCOUNTS, JSON.stringify(DEFAULT_ACCOUNTS));
      return { ...DEFAULT_ACCOUNTS };
    }
    return JSON.parse(raw);
  },
  setAccounts(accounts) {
    localStorage.setItem(LS_KEYS.ACCOUNTS, JSON.stringify(accounts));
  },

  /**
   * 서버 모드용: 비밀번호 없는 계정 캐시 업데이트
   */
  setServerAccounts(serverAccounts) {
    // [{ id, role, name, projectSheetUrl, projectSheetGid }] 형식
    const map = {};
    serverAccounts.forEach(a => {
      map[a.id] = {
        role: a.role,
        name: a.name,
        projectSheetUrl: a.projectSheetUrl || '',
        projectSheetGid: a.projectSheetGid || '',
      };
    });
    localStorage.setItem(LS_KEYS.ACCOUNTS, JSON.stringify(map));
  },

  getContractors() {
    const accounts = this.getAccounts();
    return Object.entries(accounts)
      .filter(([_, v]) => v.role === 'contractor')
      .map(([k, v]) => ({
        id: k,
        name: v.name,
        // 서버 모드에서는 password 가 undefined → UI 에 표시 안함
        password: v.password || '',
        projectSheetUrl: v.projectSheetUrl || '',
        projectSheetGid: v.projectSheetGid || '',
      }));
  },

  getContractorConfig(contractorId) {
    const auth = this.getAuth();
    // 현재 로그인된 시공사는 auth 객체에 시트 정보가 포함됨 (서버 응답 기준)
    if (auth && auth.id === contractorId && auth.projectSheetUrl !== undefined) {
      return {
        name: auth.name,
        projectSheetUrl: auth.projectSheetUrl || '',
        projectSheetGid: auth.projectSheetGid || '',
      };
    }
    const accounts = this.getAccounts();
    return accounts[contractorId] || null;
  },

  // ---- Projects ----
  getProjects() {
    const raw = localStorage.getItem(LS_KEYS.PROJECTS);
    if (!raw) {
      localStorage.setItem(LS_KEYS.PROJECTS, JSON.stringify(DEFAULT_PROJECTS));
      return { ...DEFAULT_PROJECTS };
    }
    return JSON.parse(raw);
  },
  setProject(id, name) {
    const p = this.getProjects();
    p[id] = name;
    localStorage.setItem(LS_KEYS.PROJECTS, JSON.stringify(p));
  },
  deleteProject(id) {
    const p = this.getProjects();
    delete p[id];
    localStorage.setItem(LS_KEYS.PROJECTS, JSON.stringify(p));
  },

  // ---- Submissions ----
  getSubmissions(contractor = null) {
    const raw = localStorage.getItem(LS_KEYS.SUBMISSIONS);
    const all = raw ? JSON.parse(raw) : [];
    if (contractor) return all.filter(s => s.contractor === contractor);
    return all;
  },
  addSubmission(sub) {
    const all = this.getSubmissions();
    all.push(sub);
    localStorage.setItem(LS_KEYS.SUBMISSIONS, JSON.stringify(all));
  },
  updateSubmission(id, patch) {
    const all = this.getSubmissions();
    const idx = all.findIndex(s => s.id === id);
    if (idx >= 0) {
      all[idx] = { ...all[idx], ...patch };
      localStorage.setItem(LS_KEYS.SUBMISSIONS, JSON.stringify(all));
    }
  },
  deleteSubmission(id) {
    const all = this.getSubmissions().filter(s => s.id !== id);
    localStorage.setItem(LS_KEYS.SUBMISSIONS, JSON.stringify(all));
  },

  // ---- Auth ----
  getAuth() {
    const raw = sessionStorage.getItem(LS_KEYS.AUTH);
    return raw ? JSON.parse(raw) : null;
  },
  setAuth(auth) {
    sessionStorage.setItem(LS_KEYS.AUTH, JSON.stringify(auth));
  },
  clearAuth() {
    sessionStorage.removeItem(LS_KEYS.AUTH);
  },

  // ---- Reset ----
  resetAll() {
    localStorage.removeItem(LS_KEYS.SUBMISSIONS);
    localStorage.removeItem(LS_KEYS.PROJECTS);
    localStorage.removeItem(LS_KEYS.CONFIG);
    localStorage.removeItem(LS_KEYS.ACCOUNTS);
    return FileDB.clearAll();
  },
};

// ============================================================
// IndexedDB for file storage (PDFs, images)
// ============================================================
const FileDB = (() => {
  const DB_NAME = 'kepco_files';
  const STORE = 'files';
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  return {
    async save(id, file) {
      const arrayBuffer = await file.arrayBuffer();
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({
          id,
          name: file.name,
          type: file.type,
          size: file.size,
          data: arrayBuffer,
          savedAt: new Date().toISOString(),
        });
        tx.oncomplete = () => resolve(id);
        tx.onerror = () => reject(tx.error);
      });
    },
    async get(id) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    async delete(id) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
    async clearAll() {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
  };
})();

// ============================================================
// LocalFolderDB: File System Access API 폴더 핸들 저장 (IndexedDB)
// Chrome/Edge에서 처리완료 파일을 PC 로컬 폴더에 직접 저장하기 위한 핸들 영속화
// ============================================================
const LocalFolderDB = (() => {
  const DB_NAME = 'kepco_local_folder';
  const STORE = 'handles';
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        e.target.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  return {
    async save(handle) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(handle, 'processed_folder');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
    async get() {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get('processed_folder');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    },
    async clear() {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete('processed_folder');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
    // 저장된 핸들의 폴더명 반환 (없으면 null)
    async getName() {
      const h = await this.get().catch(() => null);
      return h ? h.name : null;
    },
  };
})();
