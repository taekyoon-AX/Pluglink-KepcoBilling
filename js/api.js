// ============================================================
// Apps Script 백엔드 클라이언트
// ============================================================

const API = {
  _URL_KEY: 'pl_kepco_sync_url',
  _TOKEN_KEY: 'pl_kepco_token',

  getUrl() {
    if (typeof CLOUD_SYNC_URL !== 'undefined' && CLOUD_SYNC_URL) return CLOUD_SYNC_URL;
    return localStorage.getItem(this._URL_KEY) || '';
  },
  setUrl(url) { localStorage.setItem(this._URL_KEY, (url || '').trim()); },
  enabled() { return !!this.getUrl(); },

  getToken() { return sessionStorage.getItem(this._TOKEN_KEY) || ''; },
  setToken(t) { t ? sessionStorage.setItem(this._TOKEN_KEY, t) : sessionStorage.removeItem(this._TOKEN_KEY); },
  clearToken() { sessionStorage.removeItem(this._TOKEN_KEY); },

  async call(action, payload = {}) {
    const url = this.getUrl();
    if (!url) return { ok: false, error: 'no_url' };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, token: this.getToken(), ...payload }),
        redirect: 'follow',
      });
      const text = await res.text();
      try {
        const r = JSON.parse(text);
        if (r && r.error === 'invalid_or_expired_token') {
          this.clearToken();
          if (window.App && App.onTokenExpired) App.onTokenExpired();
        }
        return r;
      } catch (e) {
        return { ok: false, error: 'invalid_response', raw: text };
      }
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  },

  // ─── 인증 ───
  async login(id, pw = '') {
    const r = await this.call('login', { id, pw });
    if (r && r.ok && r.token) this.setToken(r.token);
    return r;
  },
  async ping() { return this.call('ping'); },

  // ─── 시트 ───
  async readPending()   { return this.call('read_pending_rows', { sheetUrl: '', sheetGid: '', sheetName: '' }); },
  async readProcessing(){ return this.call('read_processing_rows', { sheetUrl: '', sheetGid: '', sheetName: '' }); },
  async appendPending(row) { return this.call('append_pending_row', { row, sheetUrl: '', sheetGid: '', sheetName: '' }); },
  async appendProcessing(row) {
    const cfg = Store.getConfig();
    return this.call('append_processing_row', {
      sheetUrl: cfg.processingSheetUrl, sheetGid: cfg.processingSheetGid, sheetName: cfg.processingSheetName, row,
    });
  },
  async deletePendingMatching(match) {
    return this.call('delete_pending_row_matching', { match, sheetUrl: '', sheetGid: '', sheetName: '' });
  },
  async updateProcessingNote(rowNumber, note) {
    return this.call('update_processing_note', { rowNumber, note, sheetUrl: '', sheetGid: '', sheetName: '' });
  },
  async updateQStatus(rowNumbers, value) {
    const cfg = Store.getConfig();
    return this.call('update_q_status', {
      sheetUrl: cfg.processingSheetUrl, sheetGid: cfg.processingSheetGid, sheetName: cfg.processingSheetName,
      rowNumbers, value,
    });
  },

  // ─── 시트 설정 서버 저장 ───
  async setPendingSheetConfig(url, gid, name) { return this.call('set_pending_sheet_config', { sheetUrl: url, sheetGid: gid, sheetName: name }); },
  async setProcessingSheetConfig(url, gid, name) { return this.call('set_processing_sheet_config', { sheetUrl: url, sheetGid: gid, sheetName: name }); },

  // ─── PM 시트 lookup ───
  async lookupCentral(projectIds, columns) {
    const cfg = Store.getConfig();
    if (!cfg.centralProjectSheetUrl) return { ok: false, error: 'no_central_url' };
    return this.call('lookup_central_columns', {
      sheetUrl: cfg.centralProjectSheetUrl,
      sheetGid: cfg.centralProjectSheetGid,
      sheetName: cfg.centralProjectSheetName,
      projectIds, columns,
    });
  },
  /** 시공사별 프로젝트 목록 (PM 시트 기준) */
  async fetchProjectsForContractor(contractorName) {
    const cfg = Store.getConfig();
    if (!cfg.centralProjectSheetUrl) return { ok: false, error: 'no_central_url' };
    return this.call('fetch_projects_for_contractor', {
      sheetUrl: cfg.centralProjectSheetUrl,
      sheetGid: cfg.centralProjectSheetGid,
      sheetName: cfg.centralProjectSheetName,
      contractorName,
    });
  },

  // ─── 파일 ───
  async uploadFile(file, sub, docType) {
    const base64 = await this._fileToB64(file);
    const fileName = Utils.buildFileName(sub, docType);
    const folderPath = Utils.buildFolderName(sub);
    return this.call('upload_file', {
      base64, fileName,
      mimeType: file.type || 'application/octet-stream',
      contractorFolder: sub.contractor || 'unknown',
      projectFolder: folderPath,
    });
  },
  async downloadDriveFile(fileId, fileUrl, asPdf) {
    const r = await this.call('download_file', { fileId, fileUrl, asPdf: !!asPdf });
    if (!r.ok) return r;
    try {
      const bin = atob(r.base64);
      const buf = new ArrayBuffer(bin.length);
      const view = new Uint8Array(buf);
      for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
      return { ok: true, arrayBuffer: buf, name: r.name, mimeType: r.mimeType };
    } catch (e) {
      return { ok: false, error: 'decode_error' };
    }
  },
  async copyToProcessedFolder(folderId, projectFolder, files) {
    return this.call('copy_to_processed_folder', { targetFolderId: folderId, projectFolderName: projectFolder, files });
  },
  async checkFolderAccess(folderId) { return this.call('check_folder_access', { folderId }); },

  _fileToB64(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => {
        const s = r.result;
        const i = s.indexOf(',');
        res(i >= 0 ? s.slice(i + 1) : s);
      };
      r.onerror = () => rej(r.error);
      r.readAsDataURL(file);
    });
  },
};
