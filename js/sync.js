// ============================================================
// Cloud Sync: Google Apps Script 백엔드 연동
// ============================================================

const SYNC_URL_KEY = 'kepco_sync_url';
const TOKEN_KEY = 'kepco_auth_token';

const Sync = {
  getUrl() {
    if (typeof CLOUD_SYNC_URL !== 'undefined' && CLOUD_SYNC_URL) return CLOUD_SYNC_URL;
    return localStorage.getItem(SYNC_URL_KEY) || '';
  },

  setUrl(url) {
    localStorage.setItem(SYNC_URL_KEY, url.trim());
  },

  enabled() {
    return !!this.getUrl();
  },

  getToken() {
    return sessionStorage.getItem(TOKEN_KEY) || '';
  },

  setToken(token) {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  },

  clearToken() {
    sessionStorage.removeItem(TOKEN_KEY);
  },

  async call(action, payload = {}) {
    const url = this.getUrl();
    if (!url) return { ok: false, error: 'sync_disabled' };
    try {
      // 모든 요청에 token 자동 포함 (login/ping 은 서버가 무시)
      const body = { action, token: this.getToken(), ...payload };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        redirect: 'follow',
      });
      const text = await res.text();
      try {
        const result = JSON.parse(text);
        // 토큰 만료 감지
        if (result && result.error === 'invalid_or_expired_token') {
          this.clearToken();
          if (window.App && typeof App.onTokenExpired === 'function') App.onTokenExpired();
        }
        return result;
      } catch (e) {
        return { ok: false, error: 'invalid_response', raw: text };
      }
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  },

  /**
   * 서버 로그인 — 토큰 발급
   */
  async login(id, pw) {
    const r = await this.call('login', { id, pw });
    if (r && r.ok && r.token) {
      this.setToken(r.token);
    }
    return r;
  },

  /**
   * 서버에서 계정 목록 조회 (admin)
   */
  async listAccounts() {
    return this.call('list_accounts');
  },

  async updatePassword(id, newPassword) {
    return this.call('update_password', { id, newPassword });
  },

  async setContractorSheet(id, projectSheetUrl, projectSheetGid) {
    return this.call('set_contractor_sheet', { id, projectSheetUrl, projectSheetGid });
  },

  async createAccount(id, password, name, role) {
    return this.call('create_account', { id, password, name, role });
  },

  async deleteAccount(id) {
    return this.call('delete_account', { id });
  },

  async bulkCreateContractors(contractors) {
    return this.call('bulk_create_contractors', { contractors });
  },

  async lookupCentralColumns(sheetUrl, sheetGid, sheetName, projectIds, columns) {
    return this.call('lookup_central_columns', { sheetUrl, sheetGid, sheetName, projectIds, columns });
  },

  async appendProcessingRow(sheetUrl, sheetGid, sheetName, row) {
    return this.call('append_processing_row', { sheetUrl, sheetGid, sheetName, row });
  },

  /** TEST 시트의 모든 데이터 행 읽기 (납부 이력 탭용). 시공사는 A열 본인 것만 자동 필터됨 */
  async readProcessingRows(sheetUrl, sheetGid, sheetName) {
    return this.call('read_processing_rows', { sheetUrl, sheetGid, sheetName });
  },

  /** 처리 시트 설정을 서버에 저장 (시공사가 URL 없이 조회 가능하도록) */
  async setProcessingSheetConfig(sheetUrl, sheetGid, sheetName) {
    return this.call('set_processing_sheet_config', { sheetUrl, sheetGid, sheetName });
  },

  /** TEST 시트의 특정 행 수정 */
  async updateProcessingRow(sheetUrl, sheetGid, sheetName, rowNumber, row) {
    return this.call('update_processing_row', { sheetUrl, sheetGid, sheetName, rowNumber, row });
  },

  /**
   * 납부내역 시트 Q열(완료확인) 체크박스 업데이트
   * @param rowNumbers 1-based 행 번호 배열
   * @param value true=체크완료 / false=해제
   */
  async updateQStatus(sheetUrl, sheetGid, sheetName, rowNumbers, value) {
    return this.call('update_q_status', { sheetUrl, sheetGid, sheetName, rowNumbers, value });
  },

  async copyToProcessedFolder(targetFolderId, projectFolderName, files) {
    return this.call('copy_to_processed_folder', { targetFolderId, projectFolderName, files });
  },

  async checkFolderAccess(folderId) {
    return this.call('check_folder_access', { folderId });
  },

  /**
   * Google Drive 파일을 Apps Script 프록시 통해 가져오기 (CORS 우회)
   * @param asPdf true 면 이미지를 PDF 로 자동 변환
   */
  async downloadDriveFile(fileId, fileUrl, asPdf) {
    const r = await this.call('download_file', { fileId, fileUrl, asPdf: !!asPdf });
    if (!r.ok) return r;
    try {
      const binary = atob(r.base64);
      const buf = new ArrayBuffer(binary.length);
      const view = new Uint8Array(buf);
      for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
      return { ok: true, arrayBuffer: buf, name: r.name, mimeType: r.mimeType };
    } catch (e) {
      return { ok: false, error: 'base64 decode 실패: ' + e.message };
    }
  },

  async ping() {
    return this.call('ping');
  },

  /**
   * 클라우드에서 전체 데이터를 받아와 로컬에 저장
   */
  async pull() {
    if (!this.enabled()) return { ok: false, error: 'sync_disabled' };
    const r = await this.call('fetch_all');
    if (!r.ok) return r;
    // 로컬 파일 ID 유지하며 클라우드 URL 병합
    // 전체 덮어쓰기 방식 — 단순하지만 경합 시 마지막 쓰기 우선
    localStorage.setItem('kepco_submissions', JSON.stringify(r.submissions || []));
    if (r.projects && Object.keys(r.projects).length > 0) {
      localStorage.setItem('kepco_projects', JSON.stringify(r.projects));
    }
    return r;
  },

  /**
   * 제출 한 건 클라우드에 저장
   */
  async pushSubmission(submission) {
    return this.call('save_submission', { submission });
  },

  async updateSubmission(id, patch) {
    return this.call('update_submission', { id, patch });
  },

  async deleteSubmissionRemote(id) {
    return this.call('delete_submission', { id });
  },

  async pushProjects(projects) {
    return this.call('save_projects', { projects });
  },

  /**
   * 중앙 프로젝트 시트에서 시공사 값이 매칭되는 프로젝트만 가져오기
   */
  async fetchProjectsForContractor(sheetUrl, sheetGid, sheetName, contractorName) {
    if (!sheetUrl || !contractorName) return { ok: false, error: 'missing_params' };
    if (this.enabled()) {
      return this.call('fetch_projects_for_contractor', { sheetUrl, sheetGid, sheetName, contractorName });
    }
    // Public CSV fallback + client-side filter
    try {
      const m = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (!m) return { ok: false, error: 'invalid_url' };
      const id = m[1];
      const csvUrl = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv${sheetGid ? `&gid=${sheetGid}` : ''}`;
      const res = await fetch(csvUrl);
      if (!res.ok) return { ok: false, error: 'fetch_failed_' + res.status };
      const text = await res.text();
      return this._parseCsvWithContractorFilter(text, contractorName);
    } catch (e) {
      return { ok: false, error: e.message || 'fetch_error' };
    }
  },

  _parseCsvWithContractorFilter(text, contractorName) {
    const norm = s => String(s || '').replace(/\s+/g, '').toLowerCase();
    const target = norm(contractorName);

    // CSV 파싱 (간단판)
    const rows = [];
    let cur = [''], inQuote = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuote) {
        if (c === '"' && text[i + 1] === '"') { cur[cur.length - 1] += '"'; i++; }
        else if (c === '"') inQuote = false;
        else cur[cur.length - 1] += c;
      } else {
        if (c === '"') inQuote = true;
        else if (c === ',') cur.push('');
        else if (c === '\n') { rows.push(cur); cur = ['']; }
        else if (c !== '\r') cur[cur.length - 1] += c;
      }
    }
    if (cur.length > 1 || cur[0]) rows.push(cur);
    if (rows.length < 2) return { ok: true, projects: {}, rows: [], matched: 0 };

    const header = rows[0].map(h => (h || '').trim());
    const findCol = (keywords) => {
      for (let i = 0; i < header.length; i++) {
        const h = norm(header[i]);
        for (const k of keywords) {
          if (h === norm(k) || h.includes(norm(k))) return i;
        }
      }
      return -1;
    };
    const idxId = findCol(['프로젝트ID', '프로젝트번호', '고유번호', '고유ID']);
    const idxName = findCol(['프로젝트명']);
    const idxContractor = findCol(['시공사', '업체']);
    if (idxId < 0 || idxContractor < 0) {
      return { ok: false, error: '컬럼 인식 실패. 헤더: ' + header.join(', ') };
    }

    const projects = {};
    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const pid = String(row[idxId] || '').trim();
      if (!pid) continue;
      const contractor = String(row[idxContractor] || '').trim();
      const tokens = norm(contractor).split(/[,/·|]/).map(t => t.trim()).filter(Boolean);
      if (!tokens.some(t => t === target || t.includes(target) || target.includes(t))) continue;
      const pname = idxName >= 0 ? String(row[idxName] || '').trim() : '';
      projects[pid] = pname;
      out.push({ id: pid, name: pname, contractor });
    }
    return { ok: true, projects, rows: out, matched: out.length };
  },

  /**
   * 시공사별 프로젝트 시트에서 프로젝트 목록 가져오기
   * - Apps Script 가 설정되어 있으면 Apps Script 프록시 사용 (비공개 시트도 OK)
   * - 아니면 공개 시트 CSV 직접 fetch 시도
   */
  async fetchContractorProjects(sheetUrl, sheetGid) {
    if (!sheetUrl) return { ok: false, error: 'no_sheet_url' };
    if (this.enabled()) {
      return this.call('fetch_contractor_projects', { sheetUrl, sheetGid });
    }
    // Fallback: public CSV
    try {
      const m = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (!m) return { ok: false, error: 'invalid_url' };
      const id = m[1];
      const csvUrl = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv${sheetGid ? `&gid=${sheetGid}` : ''}`;
      const res = await fetch(csvUrl);
      if (!res.ok) return { ok: false, error: 'fetch_failed_' + res.status };
      const text = await res.text();
      return this._parseCsvForProjects(text);
    } catch (e) {
      return { ok: false, error: e.message || 'fetch_error' };
    }
  },

  _parseCsvForProjects(text) {
    // 단순 CSV 파싱 (따옴표 감안)
    const rows = [];
    let cur = [''], inQuote = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuote) {
        if (c === '"' && text[i + 1] === '"') { cur[cur.length - 1] += '"'; i++; }
        else if (c === '"') inQuote = false;
        else cur[cur.length - 1] += c;
      } else {
        if (c === '"') inQuote = true;
        else if (c === ',') cur.push('');
        else if (c === '\n') { rows.push(cur); cur = ['']; }
        else if (c !== '\r') cur[cur.length - 1] += c;
      }
    }
    if (cur.length > 1 || cur[0]) rows.push(cur);
    if (rows.length < 2) return { ok: true, projects: {}, rows: [] };

    const header = rows[0].map(h => (h || '').trim());
    let idxId = header.findIndex(h => /프로젝트.*(ID|번호|NO)/i.test(h));
    let idxName = header.findIndex(h => /프로젝트(명|이름)|현장명|사업명/i.test(h));
    if (idxId < 0) idxId = 0;
    if (idxName < 0) idxName = Math.min(idxId + 1, header.length - 1);

    const projects = {};
    const outRows = [];
    for (let r = 1; r < rows.length; r++) {
      const pid = String(rows[r][idxId] || '').trim();
      if (!pid) continue;
      const pname = String(rows[r][idxName] || '').trim();
      projects[pid] = pname;
      outRows.push({ id: pid, name: pname });
    }
    return { ok: true, projects, rows: outRows };
  },

  /**
   * 파일을 Google Drive 에 업로드
   * returns { ok, fileId, url }
   */
  async uploadFile(file, submission, docType) {
    const base64 = await this.fileToBase64(file);
    const fileName = Utils.getFileName(submission, docType, file.name);
    const folderPath = Utils.getFolderPath(submission);
    const [contractorFolder, projectFolder] = folderPath.split('/');
    // contractorFolder 는 서버가 토큰 기준으로 덮어씀 (시공사는 본인 폴더로만)
    return this.call('upload_file', {
      base64,
      fileName,
      mimeType: file.type || 'application/octet-stream',
      contractorFolder,
      projectFolder,
    });
  },

  fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  },
};
