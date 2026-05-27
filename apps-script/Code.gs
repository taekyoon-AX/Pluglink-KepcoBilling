/**
 * 한전불입금 관리 시스템 - Google Apps Script 백엔드 (v2.0)
 * ------------------------------------------------------
 * 토큰 기반 인증 · 시공사별 행 단위 권한 제어 · 시트 읽기 전용 보호
 *
 * 이 스크립트를 Google Sheet 에 연결된 Apps Script 에 붙여넣고
 * "웹 앱으로 배포" 하여 URL 을 얻어 웹사이트 설정에 입력하세요.
 * 설치 방법은 설치가이드.md 참조.
 */

// ============ 상수 ============
const SHEET_SUBMISSIONS = 'Submissions';
const SHEET_PROJECTS = 'Projects';
const DRIVE_FOLDER_NAME = '한전불입_첨부파일';
const TOKEN_TTL_HOURS = 12;
const API_VERSION = '2.0';

const SUBMISSION_COLS = [
  'id', 'contractor', 'submittedAt', 'projectId', 'projectName', 'location',
  'capacity', 'customerNumber', 'customerBank', 'customerAccount', 'baseFee',
  'scheduledProcessDate', 'status', 'notes',
  'applicationReceiptFileId', 'applicationReceiptUrl',
  'feeNoticeFileId', 'feeNoticeUrl',
  'transferReceiptFileId', 'transferReceiptUrl',
  'updatedAt'
];

// 기본 계정 (최초 1회만 자동 생성)
const DEFAULT_ACCOUNTS_SEED = {
  admin: { password: 'pluglink1234', role: 'admin', name: '관리자' },
  '나이스테크': { password: 'ty1234', role: 'contractor', name: '나이스테크' },
  '택윤컴퍼니2': { password: 'ty5678', role: 'contractor', name: '택윤컴퍼니2' },
};

// ============ 엔트리 ============
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    // 공개 액션 (로그인 전 호출 가능)
    const publicActions = ['ping', 'login'];
    let auth = null;
    if (!publicActions.includes(action)) {
      auth = _verifyToken(data.token);
      if (!auth) return json({ ok: false, error: 'invalid_or_expired_token' });
    }

    let result;
    switch (action) {
      case 'ping':
        result = { ok: true, message: 'pong', version: API_VERSION };
        break;
      case 'login':
        result = login(data.id, data.pw);
        break;

      // --- 데이터 조회 ---
      case 'fetch_all':
        result = fetchAllWithAuth(auth);
        break;
      case 'fetch_projects_for_contractor':
        // contractor 는 토큰에서 강제 (클라이언트가 지정한 name 은 무시)
        result = fetchProjectsForContractor(
          data.sheetUrl, data.sheetGid, data.sheetName,
          auth.role === 'admin' && data.contractorName ? data.contractorName : auth.name,
        );
        break;
      case 'fetch_contractor_projects':
        result = fetchContractorProjects(data.sheetUrl, data.sheetGid);
        break;
      case 'lookup_central_columns':
        // 중앙 시트에서 프로젝트ID 매칭되는 행의 지정 컬럼(예 'AU','AV','AW') 값 조회
        result = lookupCentralColumns(data.sheetUrl, data.sheetGid, data.sheetName, data.projectIds, data.columns);
        break;
      case 'download_file':
        // Google Drive 파일을 base64 로 반환 (CORS 우회). asPdf=true 면 이미지를 PDF 로 변환
        result = downloadFileAsBase64(data.fileId, data.fileUrl, data.asPdf);
        break;
      case 'append_processing_row':
        // 처리 시트(외부 시트)에 새 행 추가 — 바로처리/이체증 업로드 시 호출
        if (auth.role !== 'admin') { result = { ok: false, error: 'admin_only' }; break; }
        result = appendProcessingRow(data.sheetUrl, data.sheetGid, data.sheetName, data.row);
        break;
      case 'read_processing_rows':
        // 처리 시트 행 읽기. admin=전체 / contractor=A열(시공사) 본인 것만
        result = readProcessingRowsWithAuth(auth, data.sheetUrl, data.sheetGid, data.sheetName);
        break;
      case 'set_processing_sheet_config':
        // 처리 시트 설정을 서버에 저장 (시공사도 URL 없이 조회 가능하도록)
        if (auth.role !== 'admin') { result = { ok: false, error: 'admin_only' }; break; }
        result = setProcessingSheetConfig(data.sheetUrl, data.sheetGid, data.sheetName);
        break;
      case 'update_processing_note':
        // R열(비고) 수정. admin=모든 행 / contractor=A열(시공사) 본인 행만
        result = updateProcessingNoteWithAuth(auth, data.sheetUrl, data.sheetGid, data.sheetName, data.rowNumber, data.note);
        break;
      case 'update_processing_row':
        // 처리 시트 특정 행 수정 (납부 이력 탭 수정 기능)
        if (auth.role !== 'admin') { result = { ok: false, error: 'admin_only' }; break; }
        result = updateProcessingRow(data.sheetUrl, data.sheetGid, data.sheetName, data.rowNumber, data.row);
        break;
      case 'update_q_status':
        // 납부내역 시트 Q열(완료확인) 체크박스 업데이트
        if (auth.role !== 'admin') { result = { ok: false, error: 'admin_only' }; break; }
        result = updateQStatus(data.sheetUrl, data.sheetGid, data.sheetName, data.rowNumbers, data.value);
        break;
      case 'copy_to_processed_folder':
        // 처리완료 폴더에 파일 복사 + 텍스트 쓰기 (비고)
        if (auth.role !== 'admin') { result = { ok: false, error: 'admin_only' }; break; }
        result = copyToProcessedFolder(data.targetFolderId, data.projectFolderName, data.files);
        break;
      case 'check_folder_access':
        // 폴더 ID 검증
        if (auth.role !== 'admin') { result = { ok: false, error: 'admin_only' }; break; }
        result = checkFolderAccess(data.folderId);
        break;

      // --- 제출 데이터 쓰기 ---
      case 'save_submission':
        result = saveSubmissionWithAuth(auth, data.submission);
        break;
      case 'update_submission':
        result = updateSubmissionWithAuth(auth, data.id, data.patch);
        break;
      case 'delete_submission':
        result = deleteSubmissionWithAuth(auth, data.id);
        break;

      // --- 파일 ---
      case 'upload_file':
        result = uploadFileWithAuth(auth, data);
        break;

      // --- admin 전용 ---
      case 'save_projects':
        if (auth.role !== 'admin') { result = { ok: false, error: 'admin_only' }; break; }
        result = saveProjects(data.projects);
        break;
      case 'list_accounts':
        if (auth.role !== 'admin') { result = { ok: false, error: 'admin_only' }; break; }
        result = listAccounts();
        break;
      case 'update_password':
        result = updatePasswordWithAuth(auth, data.id, data.newPassword);
        break;
      case 'set_contractor_sheet':
        if (auth.role !== 'admin') { result = { ok: false, error: 'admin_only' }; break; }
        result = setContractorSheet(data.id, data.projectSheetUrl, data.projectSheetGid);
        break;
      case 'create_account':
        if (auth.role !== 'admin') { result = { ok: false, error: 'admin_only' }; break; }
        result = createAccount(data.id, data.password, data.name, data.role);
        break;
      case 'delete_account':
        if (auth.role !== 'admin') { result = { ok: false, error: 'admin_only' }; break; }
        result = deleteAccount(data.id);
        break;
      case 'bulk_create_contractors':
        if (auth.role !== 'admin') { result = { ok: false, error: 'admin_only' }; break; }
        result = bulkCreateContractors(data.contractors);
        break;

      default:
        result = { ok: false, error: 'Unknown action: ' + action };
    }
    return json(result);
  } catch (err) {
    return json({ ok: false, error: err.toString(), stack: err.stack });
  }
}

function doGet(e) {
  return json({ ok: true, message: '한전불입금 관리 API 동작 중. POST 로 호출하세요.', version: API_VERSION });
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============ 인증 인프라 ============
function _getSecretKey() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('SERVER_SECRET_KEY');
  if (!key) {
    key = Utilities.getUuid() + '-' + Utilities.getUuid();
    props.setProperty('SERVER_SECRET_KEY', key);
  }
  return key;
}

function _getAccounts() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('ACCOUNTS');
  if (!raw) {
    props.setProperty('ACCOUNTS', JSON.stringify(DEFAULT_ACCOUNTS_SEED));
    return JSON.parse(JSON.stringify(DEFAULT_ACCOUNTS_SEED));
  }
  return JSON.parse(raw);
}

function _saveAccounts(accounts) {
  PropertiesService.getScriptProperties().setProperty('ACCOUNTS', JSON.stringify(accounts));
}

function _b64url(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}
function _b64urlStr(str) {
  return _b64url(Utilities.newBlob(str).getBytes());
}
function _b64urlDecode(str) {
  const pad = str.length % 4 ? '='.repeat(4 - (str.length % 4)) : '';
  return Utilities.base64DecodeWebSafe(str + pad);
}

function _sign(data) {
  const sig = Utilities.computeHmacSha256Signature(data, _getSecretKey());
  return _b64url(sig);
}

function _makeToken(id, role, name) {
  const payload = {
    id, role, name,
    exp: new Date().getTime() + TOKEN_TTL_HOURS * 3600 * 1000,
  };
  const body = _b64urlStr(JSON.stringify(payload));
  const sig = _sign(body);
  return body + '.' + sig;
}

function _verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (_sign(body) !== sig) return null;
  try {
    const bytes = _b64urlDecode(body);
    const decoded = Utilities.newBlob(bytes).getDataAsString();
    const payload = JSON.parse(decoded);
    if (payload.exp && payload.exp < new Date().getTime()) return null;
    return payload;
  } catch (e) { return null; }
}

function login(id, pw) {
  if (!id || !pw) return { ok: false, error: '아이디/비밀번호를 입력하세요.' };
  const accounts = _getAccounts();
  const acc = accounts[id];
  if (!acc || acc.password !== pw) {
    return { ok: false, error: '아이디 또는 비밀번호가 올바르지 않습니다.' };
  }
  const name = acc.name || id;
  const token = _makeToken(id, acc.role, name);
  return {
    ok: true,
    token,
    id,
    role: acc.role,
    name,
    projectSheetUrl: acc.projectSheetUrl || '',
    projectSheetGid: acc.projectSheetGid || '',
    ttlHours: TOKEN_TTL_HOURS,
  };
}

// ============ 계정 관리 ============
function listAccounts() {
  const accounts = _getAccounts();
  return {
    ok: true,
    accounts: Object.entries(accounts).map(([id, a]) => ({
      id,
      role: a.role,
      name: a.name || id,
      projectSheetUrl: a.projectSheetUrl || '',
      projectSheetGid: a.projectSheetGid || '',
      hasPassword: !!a.password,
    })),
  };
}

function updatePasswordWithAuth(auth, targetId, newPassword) {
  // admin 은 아무 계정 비번 변경 가능, contractor 는 본인 것만
  if (auth.role !== 'admin' && auth.id !== targetId) {
    return { ok: false, error: 'forbidden' };
  }
  if (!newPassword || String(newPassword).length < 4) {
    return { ok: false, error: '비밀번호는 4자 이상이어야 합니다.' };
  }
  const accounts = _getAccounts();
  if (!accounts[targetId]) return { ok: false, error: 'not_found' };
  accounts[targetId].password = String(newPassword);
  _saveAccounts(accounts);
  return { ok: true };
}

function setContractorSheet(id, url, gid) {
  const accounts = _getAccounts();
  if (!accounts[id]) return { ok: false, error: 'not_found' };
  accounts[id].projectSheetUrl = url || '';
  accounts[id].projectSheetGid = gid || '';
  _saveAccounts(accounts);
  return { ok: true };
}

function createAccount(id, password, name, role) {
  if (!id || !password) return { ok: false, error: 'id, password 필수' };
  if (String(password).length < 4) return { ok: false, error: '비밀번호 4자 이상' };
  const accounts = _getAccounts();
  if (accounts[id]) return { ok: false, error: '이미 존재하는 아이디: ' + id };
  accounts[id] = {
    password: String(password),
    role: role || 'contractor',
    name: name || id,
    projectSheetUrl: '',
    projectSheetGid: '',
  };
  _saveAccounts(accounts);
  return { ok: true, id };
}

function deleteAccount(id) {
  const accounts = _getAccounts();
  if (!accounts[id]) return { ok: false, error: 'not_found' };
  if (accounts[id].role === 'admin') return { ok: false, error: 'admin 계정은 삭제 불가' };
  delete accounts[id];
  _saveAccounts(accounts);
  return { ok: true, id };
}

function bulkCreateContractors(contractors) {
  if (!Array.isArray(contractors)) return { ok: false, error: 'array 필요' };
  const accounts = _getAccounts();
  const created = [];
  const skipped = [];
  contractors.forEach(c => {
    if (!c.id || !c.password) return;
    if (accounts[c.id]) { skipped.push(c.id); return; }
    accounts[c.id] = {
      password: String(c.password),
      role: 'contractor',
      name: c.name || c.id,
      projectSheetUrl: '',
      projectSheetGid: '',
    };
    created.push(c.id);
  });
  _saveAccounts(accounts);
  return { ok: true, created, skipped };
}

// ============ 시트 헬퍼 ============
function getOrCreateSheet(name, headers) {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function sheetToObjects(sheet) {
  const range = sheet.getDataRange();
  const values = range.getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  }).filter(o => o.id);
}

function getSubmissionsSheet() { return getOrCreateSheet(SHEET_SUBMISSIONS, SUBMISSION_COLS); }
function getProjectsSheet() { return getOrCreateSheet(SHEET_PROJECTS, ['id', 'name']); }

// ============ 제출 데이터 조회 ============
function fetchAllRaw() {
  const subsSheet = getSubmissionsSheet();
  const projSheet = getProjectsSheet();

  const rawSubs = sheetToObjects(subsSheet);
  const submissions = rawSubs.map(r => ({
    id: String(r.id),
    contractor: String(r.contractor || ''),
    submittedAt: r.submittedAt ? new Date(r.submittedAt).toISOString() : '',
    projectId: String(r.projectId || ''),
    projectName: String(r.projectName || ''),
    location: String(r.location || ''),
    capacity: r.capacity === '' || r.capacity == null ? '' : String(r.capacity),
    customerNumber: String(r.customerNumber || ''),
    customerBank: String(r.customerBank || ''),
    customerAccount: String(r.customerAccount || ''),
    baseFee: Number(r.baseFee) || 0,
    scheduledProcessDate: r.scheduledProcessDate ? new Date(r.scheduledProcessDate).toISOString() : '',
    notes: String(r.notes || ''),
    files: {
      applicationReceipt: r.applicationReceiptFileId ? String(r.applicationReceiptFileId) : null,
      applicationReceiptUrl: r.applicationReceiptUrl ? String(r.applicationReceiptUrl) : null,
      feeNotice: r.feeNoticeFileId ? String(r.feeNoticeFileId) : null,
      feeNoticeUrl: r.feeNoticeUrl ? String(r.feeNoticeUrl) : null,
      transferReceipt: r.transferReceiptFileId ? String(r.transferReceiptFileId) : null,
      transferReceiptUrl: r.transferReceiptUrl ? String(r.transferReceiptUrl) : null,
    },
  }));

  const projMap = {};
  sheetToObjects(projSheet).forEach(p => { projMap[String(p.id)] = String(p.name); });

  return { ok: true, submissions, projects: projMap, at: new Date().toISOString() };
}

function fetchAllWithAuth(auth) {
  const base = fetchAllRaw();
  if (auth.role === 'contractor') {
    // 본인 제출 건만 보여줌
    base.submissions = base.submissions.filter(s => s.contractor === auth.id);
  }
  return base;
}

// ============ 제출 데이터 쓰기 ============
function saveSubmissionWithAuth(auth, sub) {
  if (!sub || !sub.id) return { ok: false, error: 'invalid_submission' };

  // contractor 는 submission.contractor 를 본인으로 강제 + 이체증 직접 설정 금지
  if (auth.role === 'contractor') {
    sub.contractor = auth.id;
    if (sub.files && sub.files.transferReceipt) {
      // 시공사가 이체증을 넣어서 "처리완료" 로 조작하는 것 방지
      delete sub.files.transferReceipt;
      delete sub.files.transferReceiptUrl;
    }
    // 기존 건인 경우 본인 소유 여부 확인
    const existing = _findSubmissionById(sub.id);
    if (existing && existing.contractor !== auth.id) {
      return { ok: false, error: 'forbidden_not_owner' };
    }
  }
  return saveSubmission(sub);
}

function _findSubmissionById(id) {
  const sheet = getSubmissionsSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const values = sheet.getRange(2, 1, lastRow - 1, SUBMISSION_COLS.length).getValues();
  for (const row of values) {
    if (String(row[0]) === String(id)) {
      const obj = {};
      SUBMISSION_COLS.forEach((c, i) => { obj[c] = row[i]; });
      return obj;
    }
  }
  return null;
}

function saveSubmission(sub) {
  const sheet = getSubmissionsSheet();
  const row = submissionToRow(sub);
  const idCol = 1;
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(sub.id)) {
        sheet.getRange(i + 2, 1, 1, SUBMISSION_COLS.length).setValues([row]);
        return { ok: true, updated: true };
      }
    }
  }
  sheet.appendRow(row);
  return { ok: true, created: true };
}

function submissionToRow(sub) {
  const f = sub.files || {};
  return [
    sub.id || '',
    sub.contractor || '',
    sub.submittedAt || '',
    sub.projectId || '',
    sub.projectName || '',
    sub.location || '',
    sub.capacity || '',
    sub.customerNumber || '',
    sub.customerBank || '',
    sub.customerAccount || '',
    Number(sub.baseFee) || 0,
    sub.scheduledProcessDate || '',
    f.transferReceipt ? '처리완료' : '처리예정',
    sub.notes || '',
    f.applicationReceipt || '',
    f.applicationReceiptUrl || '',
    f.feeNotice || '',
    f.feeNoticeUrl || '',
    f.transferReceipt || '',
    f.transferReceiptUrl || '',
    new Date().toISOString(),
  ];
}

function updateSubmissionWithAuth(auth, id, patch) {
  const existing = _findSubmissionById(id);
  if (!existing) return { ok: false, error: 'not_found' };

  if (auth.role === 'contractor') {
    if (existing.contractor !== auth.id) return { ok: false, error: 'forbidden_not_owner' };
    // 민감 필드 차단
    if (patch.files) {
      delete patch.files.transferReceipt;
      delete patch.files.transferReceiptUrl;
    }
    delete patch.scheduledProcessDate;
    delete patch.contractor;
  }
  return updateSubmission(id, patch);
}

function updateSubmission(id, patch) {
  const sheet = getSubmissionsSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: false, error: 'not_found' };
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      const rowRange = sheet.getRange(i + 2, 1, 1, SUBMISSION_COLS.length);
      const cur = rowRange.getValues()[0];
      const obj = {};
      SUBMISSION_COLS.forEach((c, idx) => { obj[c] = cur[idx]; });
      Object.keys(patch).forEach(k => {
        if (k === 'files' && patch.files) {
          if ('applicationReceipt' in patch.files) obj.applicationReceiptFileId = patch.files.applicationReceipt || '';
          if ('applicationReceiptUrl' in patch.files) obj.applicationReceiptUrl = patch.files.applicationReceiptUrl || '';
          if ('feeNotice' in patch.files) obj.feeNoticeFileId = patch.files.feeNotice || '';
          if ('feeNoticeUrl' in patch.files) obj.feeNoticeUrl = patch.files.feeNoticeUrl || '';
          if ('transferReceipt' in patch.files) obj.transferReceiptFileId = patch.files.transferReceipt || '';
          if ('transferReceiptUrl' in patch.files) obj.transferReceiptUrl = patch.files.transferReceiptUrl || '';
          obj.status = patch.files.transferReceipt ? '처리완료' : (obj.status || '처리예정');
        } else {
          obj[k] = patch[k];
        }
      });
      obj.updatedAt = new Date().toISOString();
      const newRow = SUBMISSION_COLS.map(c => obj[c] !== undefined ? obj[c] : '');
      rowRange.setValues([newRow]);
      return { ok: true, updated: true };
    }
  }
  return { ok: false, error: 'not_found' };
}

function deleteSubmissionWithAuth(auth, id) {
  if (auth.role === 'admin') return deleteSubmission(id);
  // contractor 은 본인 것 + 처리 전만 삭제 가능
  const existing = _findSubmissionById(id);
  if (!existing) return { ok: false, error: 'not_found' };
  if (existing.contractor !== auth.id) return { ok: false, error: 'forbidden_not_owner' };
  if (existing.transferReceiptFileId) return { ok: false, error: 'already_processed' };
  return deleteSubmission(id);
}

function deleteSubmission(id) {
  const sheet = getSubmissionsSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: false };
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      const fullRow = sheet.getRange(i + 2, 1, 1, SUBMISSION_COLS.length).getValues()[0];
      const fileIdCols = ['applicationReceiptFileId', 'feeNoticeFileId', 'transferReceiptFileId'];
      fileIdCols.forEach(col => {
        const idx = SUBMISSION_COLS.indexOf(col);
        const fid = fullRow[idx];
        if (fid) { try { DriveApp.getFileById(fid).setTrashed(true); } catch (e) {} }
      });
      sheet.deleteRow(i + 2);
      return { ok: true };
    }
  }
  return { ok: false };
}

// ============ 프로젝트 목록 ============
function saveProjects(projects) {
  const sheet = getProjectsSheet();
  sheet.clear();
  sheet.getRange(1, 1, 1, 2).setValues([['id', 'name']]);
  sheet.setFrozenRows(1);
  const rows = Object.entries(projects).map(([id, name]) => [id, name]);
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 2).setValues(rows);
  }
  return { ok: true, count: rows.length };
}

// ============ 외부 시트 READ-ONLY ============
function extractSheetId(url) {
  const m = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : url;
}

function fetchContractorProjects(sheetUrl, gid) {
  try {
    const id = extractSheetId(sheetUrl);
    const ss = SpreadsheetApp.openById(id);
    let sheet;
    if (gid) sheet = ss.getSheets().filter(s => String(s.getSheetId()) === String(gid))[0];
    if (!sheet) sheet = ss.getSheets()[0];

    const values = sheet.getDataRange().getValues();
    if (values.length < 2) return { ok: true, projects: {}, rows: [] };

    const header = values[0].map(v => String(v || '').trim());
    const norm = s => String(s || '').replace(/\s+/g, '').toLowerCase();
    const findCol = (keywords) => {
      for (let i = 0; i < header.length; i++) {
        const h = norm(header[i]);
        for (const k of keywords) { if (h === norm(k) || h.includes(norm(k))) return i; }
      }
      return -1;
    };
    let idxId = findCol(['프로젝트ID', '프로젝트번호', '고유번호', '고유ID']);
    let idxName = findCol(['프로젝트명', '프로젝트이름']);
    if (idxId < 0) idxId = 0;
    if (idxName < 0) idxName = Math.min(idxId + 1, header.length - 1);

    const projects = {};
    const rows = [];
    for (let r = 1; r < values.length; r++) {
      const pid = String(values[r][idxId] || '').trim();
      if (!pid) continue;
      const pname = String(values[r][idxName] || '').trim();
      projects[pid] = pname;
      rows.push({ id: pid, name: pname });
    }
    return { ok: true, projects, rows, sheetName: sheet.getName() };
  } catch (err) {
    return { ok: false, error: err.toString() };
  }
}

function fetchProjectsForContractor(sheetUrl, gid, sheetName, contractorName) {
  try {
    if (!contractorName) return { ok: false, error: 'no_contractor' };
    const id = extractSheetId(sheetUrl);
    const ss = SpreadsheetApp.openById(id);

    let sheet;
    if (sheetName) sheet = ss.getSheetByName(sheetName);
    if (!sheet && gid) sheet = ss.getSheets().filter(s => String(s.getSheetId()) === String(gid))[0];
    if (!sheet) sheet = ss.getSheets()[0];

    const values = sheet.getDataRange().getValues();
    if (values.length < 2) return { ok: true, projects: {}, rows: [], matched: 0 };

    const norm = s => String(s || '').replace(/\s+/g, '').toLowerCase();
    const makeFindCol = (header) => (keywords) => {
      for (let i = 0; i < header.length; i++) {
        const h = norm(header[i]);
        if (!h) continue;
        for (const k of keywords) { if (h === norm(k) || h.includes(norm(k))) return i; }
      }
      return -1;
    };

    // ==== 헤더 행 자동 탐지 ====
    // 앞 10행 중 "프로젝트ID" + "시공사" 둘 다 매칭되는 행을 선택
    let headerRowIdx = -1;
    let idxId = -1, idxName = -1, idxContractor = -1;
    const scanMax = Math.min(10, values.length);
    for (let r = 0; r < scanMax; r++) {
      const candidate = values[r].map(v => String(v || '').trim());
      const findCol = makeFindCol(candidate);
      const aId = findCol(['프로젝트ID', '프로젝트번호', '프로젝트No', '고유번호', '고유ID']);
      const aContractor = findCol(['시공사', '업체', '담당시공사', '파트너']);
      if (aId >= 0 && aContractor >= 0) {
        headerRowIdx = r;
        idxId = aId;
        idxContractor = aContractor;
        idxName = findCol(['프로젝트명', '프로젝트이름', '현장명', '사업명']);
        break;
      }
    }

    if (headerRowIdx < 0) {
      const sample = values.slice(0, Math.min(3, values.length))
        .map((row, i) => `행${i + 1}: ${row.slice(0, 15).map(v => String(v || '')).join(' | ')}`)
        .join('\n');
      return { ok: false, error: '헤더 행을 찾을 수 없음 (프로젝트ID + 시공사 컬럼 필요).\n상위 샘플:\n' + sample };
    }

    const header = values[headerRowIdx].map(v => String(v || '').trim());
    const target = norm(contractorName);
    const projects = {};
    const rows = [];
    let totalRows = 0;
    for (let r = headerRowIdx + 1; r < values.length; r++) {
      const row = values[r];
      const pid = String(row[idxId] || '').trim();
      if (!pid) continue;
      totalRows++;
      const contractorCell = String(row[idxContractor] || '');
      const contractorNorm = norm(contractorCell);
      if (!contractorNorm) continue;
      const tokens = contractorNorm.split(/[,/·|]/).map(t => t.trim()).filter(Boolean);
      const matched = tokens.some(t => t === target || t.includes(target) || target.includes(t));
      if (!matched) continue;
      const pname = idxName >= 0 ? String(row[idxName] || '').trim() : '';
      projects[pid] = pname;
      rows.push({ id: pid, name: pname, contractor: contractorCell.trim() });
    }
    return {
      ok: true, projects, rows, totalRows, matched: rows.length,
      sheetName: sheet.getName(),
      headerRow: headerRowIdx + 1,
      detectedCols: { id: header[idxId], name: idxName >= 0 ? header[idxName] : null, contractor: header[idxContractor] },
    };
  } catch (err) {
    return { ok: false, error: err.toString() };
  }
}

// ============ 중앙 시트 컬럼 lookup (대기번호 / AU / AV / AW 등) ============
/**
 * @param projectIds 조회할 프로젝트ID 배열
 * @param columns ['A', 'AU', 'AV', ...] 컬럼 letter 배열 (대기번호 = 'A')
 * @return { ok, map: { projectId: { 'A': value, 'AU': value, ... } } }
 */
function lookupCentralColumns(sheetUrl, gid, sheetName, projectIds, columns) {
  try {
    if (!Array.isArray(projectIds) || !Array.isArray(columns)) {
      return { ok: false, error: 'projectIds, columns array 필요' };
    }
    const id = extractSheetId(sheetUrl);
    const ss = SpreadsheetApp.openById(id);
    let sheet;
    if (sheetName) sheet = ss.getSheetByName(sheetName);
    if (!sheet && gid) sheet = ss.getSheets().filter(s => String(s.getSheetId()) === String(gid))[0];
    if (!sheet) sheet = ss.getSheets()[0];

    const values = sheet.getDataRange().getValues();
    if (values.length < 2) return { ok: true, map: {} };

    // 헤더 행 자동 탐지 (이전 로직 재사용)
    const norm = s => String(s || '').replace(/\s+/g, '').toLowerCase();
    let headerRowIdx = -1, idxId = -1;
    const scanMax = Math.min(10, values.length);
    for (let r = 0; r < scanMax; r++) {
      const row = values[r];
      for (let c = 0; c < row.length; c++) {
        const h = norm(row[c]);
        if (/^(프로젝트id|프로젝트번호|고유번호|고유id)$/i.test(h)) {
          headerRowIdx = r;
          idxId = c;
          break;
        }
      }
      if (headerRowIdx >= 0) break;
    }
    if (headerRowIdx < 0) return { ok: false, error: '프로젝트ID 헤더 못 찾음' };

    // 컬럼 letter → 0-based index
    const colToIdx = (letter) => {
      letter = String(letter).toUpperCase().replace(/[^A-Z]/g, '');
      let n = 0;
      for (let i = 0; i < letter.length; i++) n = n * 26 + (letter.charCodeAt(i) - 64);
      return n - 1;
    };
    const colIdxs = columns.map(c => colToIdx(c));

    // 프로젝트ID set
    const wantSet = {};
    projectIds.forEach(p => { wantSet[String(p).trim()] = true; });

    const map = {};
    for (let r = headerRowIdx + 1; r < values.length; r++) {
      const row = values[r];
      const pid = String(row[idxId] || '').trim();
      if (!pid || !wantSet[pid]) continue;
      const obj = {};
      columns.forEach((col, i) => {
        const idx = colIdxs[i];
        obj[col] = idx >= 0 && idx < row.length ? row[idx] : '';
      });
      map[pid] = obj;
    }
    return { ok: true, map, found: Object.keys(map).length, requested: projectIds.length };
  } catch (err) {
    return { ok: false, error: err.toString() };
  }
}

// ============ 처리 시트(외부) 마지막 행에 신규 행 추가 ============
/**
 * @param row {b, c, d, e, f, g, h, i, j, k, m, n, o, p} — 컬럼 키별 값 (소문자)
 *  컬럼 매핑:
 *  B=프로젝트ID, E=충전소명, F=용량(kW), G=표준시설부담금,
 *  J=고객번호, K=은행, L=고객지정계좌,
 *  M=중앙시트AU, N=중앙시트AV, O=중앙시트AW, P=처리날짜
 *  (H 부가세·I 청구금액은 시트 수식으로 자동 계산 → 미입력)
 */
function appendProcessingRow(sheetUrl, gid, sheetName, row) {
  try {
    const id = extractSheetId(sheetUrl);
    const ss = SpreadsheetApp.openById(id);
    let sheet;
    if (sheetName) sheet = ss.getSheetByName(sheetName);
    if (!sheet && gid) sheet = ss.getSheets().filter(s => String(s.getSheetId()) === String(gid))[0];
    if (!sheet) return { ok: false, error: '시트를 찾을 수 없음 (' + sheetName + ')' };

    // B열 기준으로 마지막 데이터 행 찾기 (중간 빈 행 무시)
    const sheetLastRow = sheet.getLastRow();
    let lastBRow = 0;
    if (sheetLastRow > 0) {
      const bValues = sheet.getRange(1, 2, sheetLastRow, 1).getValues();
      for (let i = bValues.length - 1; i >= 0; i--) {
        if (String(bValues[i][0]).trim() !== '') { lastBRow = i + 1; break; }
      }
    }
    const targetRow = lastBRow + 1;

    // ── 위 행 서식 복사 (엑셀 양식 그대로 유지) ──
    if (targetRow > 1) {
      const lastCol = Math.max(sheet.getLastColumn(), 16); // P열(16) 최소 보장
      const srcRange = sheet.getRange(targetRow - 1, 1, 1, lastCol);
      const dstRange = sheet.getRange(targetRow, 1, 1, lastCol);
      srcRange.copyTo(dstRange, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    }

    // 컬럼 키별 매핑 (B=2, ..., P=16)
    const colMap = {
      b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10,
      k: 11, l: 12, m: 13, n: 14, o: 15, p: 16, q: 17, r: 18,
    };

    // P열(날짜)은 Date 객체로 변환해 셀에 날짜 서식이 정상 적용되도록 함
    const parseDateCol = (k, v) => {
      if (String(k).toLowerCase() === 'p' && v) {
        const parts = String(v).split('-');
        if (parts.length === 3) {
          return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        }
      }
      return v == null ? '' : v;
    };

    Object.entries(row || {}).forEach(([k, v]) => {
      const col = colMap[String(k).toLowerCase()];
      if (!col) return;
      sheet.getRange(targetRow, col).setValue(parseDateCol(k, v));
    });
    return { ok: true, rowNumber: targetRow, sheet: sheet.getName() };
  } catch (err) {
    return { ok: false, error: err.toString() };
  }
}

// ============ 처리 시트 설정 저장/조회 (시공사 조회용) ============
function setProcessingSheetConfig(url, gid, name) {
  PropertiesService.getScriptProperties().setProperty(
    'PROCESSING_SHEET_CONFIG',
    JSON.stringify({ url: url || '', gid: gid || '', name: name || '' })
  );
  return { ok: true };
}

function _getStoredProcessingConfig() {
  var raw = PropertiesService.getScriptProperties().getProperty('PROCESSING_SHEET_CONFIG');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

// ============ 권한별 처리 시트 행 읽기 ============
/**
 * admin: 전체 행 / contractor: A열(시공사)이 본인 이름과 매칭되는 행만
 * sheetUrl 미전달 시(주로 contractor) 서버 저장 설정 사용.
 */
function readProcessingRowsWithAuth(auth, sheetUrl, gid, sheetName) {
  var url = sheetUrl, g = gid, name = sheetName;
  if (!url) {
    var stored = _getStoredProcessingConfig();
    if (stored) { url = stored.url; g = stored.gid; name = stored.name; }
  }
  if (!url) return { ok: false, error: '처리 시트가 설정되지 않았습니다.' };

  var result = readProcessingRows(url, g, name);
  if (result.ok && auth && auth.role === 'contractor') {
    var myName = String(auth.name || auth.id || '');
    var nrm = function (s) { return String(s || '').replace(/\s+/g, '').toLowerCase(); };
    var target = nrm(myName);
    result.rows = (result.rows || []).filter(function (r) {
      var a = nrm(r.a);
      if (!a || !target) return false;
      // A열 값이 콤마/슬래시 등으로 여러 시공사면 토큰 분리 매칭
      var tokens = a.split(/[,/·|]/).map(function (t) { return t.trim(); }).filter(Boolean);
      if (tokens.length > 1) {
        return tokens.some(function (t) { return t === target || t.indexOf(target) >= 0 || target.indexOf(t) >= 0; });
      }
      return a === target || a.indexOf(target) >= 0 || target.indexOf(a) >= 0;
    });
    result.total = result.rows.length;
  }
  return result;
}

// ============ 처리 시트 전체 행 읽기 (납부 이력 탭) ============
/**
 * TEST 시트의 B열에 값이 있는 행을 모두 읽어 반환한다.
 * 날짜는 "YYYY-MM-DD" 문자열로 변환해 반환 (timezone 이슈 방지).
 */
function readProcessingRows(sheetUrl, gid, sheetName) {
  try {
    const id = extractSheetId(sheetUrl);
    const ss = SpreadsheetApp.openById(id);
    let sheet;
    if (sheetName) sheet = ss.getSheetByName(sheetName);
    if (!sheet && gid) sheet = ss.getSheets().filter(s => String(s.getSheetId()) === String(gid))[0];
    if (!sheet) return { ok: false, error: '시트를 찾을 수 없음 (' + (sheetName || gid) + ')' };

    const lastRow = sheet.getLastRow();
    if (lastRow < 1) return { ok: true, rows: [], sheet: sheet.getName() };

    const maxCol = 18; // Q=17 (완료확인), R=18 (비고)
    const data = sheet.getRange(1, 1, lastRow, maxCol).getValues();

    const fmtDate = (v) => {
      if (v instanceof Date) {
        const y = v.getFullYear();
        const m = String(v.getMonth() + 1).padStart(2, '0');
        const d = String(v.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + d;
      }
      return String(v || '');
    };

    const fmtNum = (v) => (v === '' || v === null || v === undefined) ? '' : String(v);

    const DATA_START_ROW = 4; // 1~3행은 헤더/라벨 행 → 4행부터 데이터
    const rows = [];
    for (var r = DATA_START_ROW - 1; r < data.length; r++) {
      var rowArr = data[r];
      var b = String(rowArr[1] || '').trim(); // B열
      if (!b) continue;
      // Q열 체크박스: TRUE/true/1 이면 완료 (boolean 또는 문자열 모두 처리)
      var qVal = rowArr[16];
      var qChecked = qVal === true || qVal === 'TRUE' || qVal === 1;
      rows.push({
        rowNumber: r + 1,
        a: String(rowArr[0] || ''), // A열: 시공사
        b: b,
        e: String(rowArr[4] || ''),
        f: String(rowArr[5] || ''),
        g: fmtNum(rowArr[6]),
        j: String(rowArr[9] || ''),
        k: String(rowArr[10] || ''),
        l: String(rowArr[11] || ''),
        m: String(rowArr[12] || ''),
        n: String(rowArr[13] || ''),
        o: String(rowArr[14] || ''),
        p: fmtDate(rowArr[15]),
        q: qChecked, // Q열: 완료확인 체크박스
        r: String(rowArr[17] || ''), // R열: 비고
      });
    }
    return { ok: true, rows: rows, sheet: sheet.getName(), total: rows.length };
  } catch (err) {
    return { ok: false, error: err.toString() };
  }
}

// ============ 납부내역 시트 Q열(완료확인) 상태 업데이트 ============
/**
 * @param rowNumbers 1-based 행 번호 배열
 * @param value true=체크 / false=해제
 */
function updateQStatus(sheetUrl, gid, sheetName, rowNumbers, value) {
  try {
    if (!Array.isArray(rowNumbers) || rowNumbers.length === 0) {
      return { ok: false, error: 'rowNumbers array 필요' };
    }
    var id = extractSheetId(sheetUrl);
    var ss = SpreadsheetApp.openById(id);
    var sheet;
    if (sheetName) sheet = ss.getSheetByName(sheetName);
    if (!sheet && gid) sheet = ss.getSheets().filter(function(s) { return String(s.getSheetId()) === String(gid); })[0];
    if (!sheet) return { ok: false, error: '시트를 찾을 수 없음 (' + (sheetName || gid) + ')' };

    var Q_COL = 17; // Q열 (17번째)
    var boolValue = (value === true || value === 'true' || value === 1 || value === 'TRUE');
    var lastRow = sheet.getLastRow();
    var updated = 0;

    rowNumbers.forEach(function(rowNum) {
      var n = Number(rowNum);
      if (!n || n < 1 || n > lastRow) return;
      sheet.getRange(n, Q_COL).setValue(boolValue);
      updated++;
    });

    return { ok: true, updated: updated };
  } catch (err) {
    return { ok: false, error: err.toString() };
  }
}

// ============ 납부내역 시트 R열(비고) 수정 — admin/contractor 양방향 ============
/**
 * admin: 모든 행 / contractor: A열(시공사)이 본인 이름과 매칭되는 행만
 * sheetUrl 미전달 시 서버 저장 설정 사용.
 */
function updateProcessingNoteWithAuth(auth, sheetUrl, gid, sheetName, rowNumber, note) {
  try {
    var n = Number(rowNumber);
    if (!n || n < 1) return { ok: false, error: 'rowNumber 필요' };

    var url = sheetUrl, g = gid, name = sheetName;
    if (!url) {
      var stored = _getStoredProcessingConfig();
      if (stored) { url = stored.url; g = stored.gid; name = stored.name; }
    }
    if (!url) return { ok: false, error: '처리 시트가 설정되지 않았습니다.' };

    var id = extractSheetId(url);
    var ss = SpreadsheetApp.openById(id);
    var sheet;
    if (name) sheet = ss.getSheetByName(name);
    if (!sheet && g) sheet = ss.getSheets().filter(function (s) { return String(s.getSheetId()) === String(g); })[0];
    if (!sheet) return { ok: false, error: '시트를 찾을 수 없음' };
    if (n > sheet.getLastRow()) return { ok: false, error: '행 번호가 범위를 벗어남' };

    // contractor 는 A열(시공사) 본인 행만 수정 가능
    if (auth && auth.role === 'contractor') {
      var aVal = String(sheet.getRange(n, 1).getValue() || ''); // A열
      var nrm = function (s) { return String(s || '').replace(/\s+/g, '').toLowerCase(); };
      var target = nrm(auth.name || auth.id || '');
      var a = nrm(aVal);
      var tokens = a.split(/[,/·|]/).map(function (t) { return t.trim(); }).filter(Boolean);
      var matched = (tokens.length > 1)
        ? tokens.some(function (t) { return t === target || t.indexOf(target) >= 0 || target.indexOf(t) >= 0; })
        : (a === target || a.indexOf(target) >= 0 || target.indexOf(a) >= 0);
      if (!matched) return { ok: false, error: 'forbidden_not_owner' };
    }

    sheet.getRange(n, 18).setValue(note == null ? '' : String(note)); // R열 = 18
    return { ok: true, rowNumber: n };
  } catch (err) {
    return { ok: false, error: err.toString() };
  }
}

// ============ 처리 시트 특정 행 수정 (납부 이력 탭) ============
/**
 * rowNumber: 1-based 행 번호
 * row: { b, e, f, g, j, k, l, m, n, o, p } — p는 "YYYY-MM-DD" 문자열
 */
function updateProcessingRow(sheetUrl, gid, sheetName, rowNumber, row) {
  try {
    if (!rowNumber || rowNumber < 1) return { ok: false, error: 'rowNumber 필요' };
    const id = extractSheetId(sheetUrl);
    const ss = SpreadsheetApp.openById(id);
    let sheet;
    if (sheetName) sheet = ss.getSheetByName(sheetName);
    if (!sheet && gid) sheet = ss.getSheets().filter(s => String(s.getSheetId()) === String(gid))[0];
    if (!sheet) return { ok: false, error: '시트를 찾을 수 없음 (' + (sheetName || gid) + ')' };

    if (rowNumber > sheet.getLastRow()) return { ok: false, error: '행 번호가 범위를 벗어남' };

    const colMap = {
      b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10,
      k: 11, l: 12, m: 13, n: 14, o: 15, p: 16, q: 17, r: 18,
    };

    const parseDateCol = (k, v) => {
      if (String(k).toLowerCase() === 'p' && v) {
        var parts = String(v).split('-');
        if (parts.length === 3) {
          return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        }
      }
      return v == null ? '' : v;
    };

    Object.entries(row || {}).forEach(function(entry) {
      var k = entry[0], v = entry[1];
      var col = colMap[String(k).toLowerCase()];
      if (!col) return;
      sheet.getRange(rowNumber, col).setValue(parseDateCol(k, v));
    });

    return { ok: true, rowNumber: rowNumber, sheet: sheet.getName() };
  } catch (err) {
    return { ok: false, error: err.toString() };
  }
}

// ============ 처리완료 폴더 복사 (Drive 파일 + 텍스트) ============
/**
 * @param targetFolderId 사용자 지정 처리완료 폴더 ID
 * @param projectFolderName 그 안에 만들 프로젝트 하위 폴더명 (예: "27190_보령시영아파트_1차-2거점")
 * @param files [{ sourceFileId, name } | { text, name }] — Drive 파일 복사 또는 텍스트 파일 생성
 */
function copyToProcessedFolder(targetFolderId, projectFolderName, files) {
  try {
    if (!targetFolderId) return { ok: false, error: 'no_folder_id' };
    if (!projectFolderName) return { ok: false, error: 'no_project_folder_name' };

    let target;
    try {
      target = DriveApp.getFolderById(targetFolderId);
    } catch (e) {
      return { ok: false, error: '폴더에 접근 불가 (ID 확인 또는 공유 권한 확인): ' + e.toString() };
    }
    const projFolder = getOrCreateSubFolder(target, projectFolderName);

    // 충돌 시 _2 _3 suffix 부여 헬퍼
    const uniqueName = (folder, name) => {
      if (!folder.getFilesByName(name).hasNext()) return name;
      const dot = name.lastIndexOf('.');
      const base = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : '';
      let n = 2;
      while (folder.getFilesByName(`${base}_${n}${ext}`).hasNext()) n++;
      return `${base}_${n}${ext}`;
    };

    const results = [];
    for (const f of (files || [])) {
      try {
        // 텍스트 파일 (비고)
        if (f.text != null) {
          const finalName = uniqueName(projFolder, f.name || 'note.txt');
          const blob = Utilities.newBlob(f.text, 'text/plain;charset=utf-8', finalName);
          const file = projFolder.createFile(blob);
          results.push({ ok: true, type: 'text', name: finalName, id: file.getId() });
          continue;
        }
        // base64 데이터 파일 (클라이언트에서 병합된 PDF 등)
        if (f.base64 != null) {
          const finalName = uniqueName(projFolder, f.name || 'merged.pdf');
          const bytes = Utilities.base64Decode(f.base64);
          const blob = Utilities.newBlob(bytes, f.mimeType || 'application/pdf', finalName);
          const file = projFolder.createFile(blob);
          results.push({ ok: true, type: 'base64', name: finalName, id: file.getId() });
          continue;
        }
        // Drive 파일 복사
        if (!f.sourceFileId) {
          results.push({ ok: false, error: 'no_source', name: f.name });
          continue;
        }
        const src = DriveApp.getFileById(f.sourceFileId);
        const finalName = uniqueName(projFolder, f.name || src.getName());
        const copy = src.makeCopy(finalName, projFolder);
        results.push({ ok: true, type: 'file', name: finalName, id: copy.getId() });
      } catch (e) {
        results.push({ ok: false, error: e.toString(), src: f.sourceFileId, name: f.name });
      }
    }
    return {
      ok: true,
      folder: projFolder.getName(),
      folderId: projFolder.getId(),
      folderUrl: projFolder.getUrl(),
      results,
    };
  } catch (err) {
    return { ok: false, error: err.toString() };
  }
}

function checkFolderAccess(folderId) {
  try {
    const f = DriveApp.getFolderById(folderId);
    return { ok: true, name: f.getName(), url: f.getUrl(), id: f.getId() };
  } catch (e) {
    return { ok: false, error: e.toString() };
  }
}

// ============ Drive 파일 다운로드 프록시 (CORS 우회) + PDF 변환 ============
function downloadFileAsBase64(fileId, fileUrl, asPdf) {
  // 로컬 UUID 패턴 (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx) 은 Drive ID가 아님 → 무시
  var uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var id = (fileId && !uuidRe.test(String(fileId))) ? fileId : null;
  if (!id && fileUrl) {
    // /d/ID 형식 또는 ?id=ID / &id=ID 형식 모두 지원
    var m = String(fileUrl).match(/\/d\/([a-zA-Z0-9-_]{10,})|[?&]id=([a-zA-Z0-9-_]{10,})/);
    if (m) id = m[1] || m[2];
  }
  if (!id) return { ok: false, error: 'fileId 없음' };

  // 일시적 Drive 오류 대응 — 최대 3회 재시도
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const file = DriveApp.getFileById(id);
      let blob = file.getBlob();
      const origMime = blob.getContentType();

      // PDF 변환 요청 시 + 이미지인 경우만 변환 (이미 PDF 면 그대로)
      if (asPdf && /^image\//.test(origMime)) {
        try {
          blob = blob.getAs('application/pdf');
        } catch (convErr) {
          // 변환 실패하면 원본 반환
        }
      }

      const bytes = blob.getBytes();
      return {
        ok: true,
        base64: Utilities.base64Encode(bytes),
        name: blob.getName(),
        mimeType: blob.getContentType(),
        size: bytes.length,
        attempts: attempt,
      };
    } catch (err) {
      lastErr = err;
      if (attempt < 3) Utilities.sleep(500 * attempt); // 백오프
    }
  }
  return { ok: false, error: lastErr ? lastErr.toString() : 'unknown', fileId: id };
}

// ============ 파일 업로드 ============
function getOrCreateRootFolder() {
  const it = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(DRIVE_FOLDER_NAME);
}

function getOrCreateSubFolder(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function uploadFileWithAuth(auth, data) {
  // 시공사는 자신 이름으로만 업로드 허용
  if (auth.role === 'contractor') {
    data.contractorFolder = auth.id;
  }
  return uploadFile(data);
}

function uploadFile(data) {
  const rootFolder = getOrCreateRootFolder();
  const contractorFolder = getOrCreateSubFolder(rootFolder, data.contractorFolder);
  const targetFolder = getOrCreateSubFolder(contractorFolder, data.projectFolder);

  // 이름 충돌 시 _2, _3, ... 자동 부여 (덮어쓰지 않음 — 다중 거점 안전)
  let finalName = data.fileName;
  if (targetFolder.getFilesByName(finalName).hasNext()) {
    const dotIdx = finalName.lastIndexOf('.');
    const base = dotIdx > 0 ? finalName.slice(0, dotIdx) : finalName;
    const ext = dotIdx > 0 ? finalName.slice(dotIdx) : '';
    let n = 2;
    while (targetFolder.getFilesByName(`${base}_${n}${ext}`).hasNext()) n++;
    finalName = `${base}_${n}${ext}`;
  }

  const bytes = Utilities.base64Decode(data.base64);
  const blob = Utilities.newBlob(bytes, data.mimeType, finalName);
  const file = targetFolder.createFile(blob);

  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}

  return { ok: true, fileId: file.getId(), url: file.getUrl(), name: finalName };
}
