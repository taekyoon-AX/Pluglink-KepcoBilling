// ============================================================
// Utility helpers: date calc, status, formatting
// ============================================================

const DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];

const Utils = {
  // ---- ID gen ----
  uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  },

  // ---- Date helpers ----
  now() { return new Date(); },

  toYMD(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  toYMDHM(d) {
    return `${this.toYMD(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  },

  parseTime(str) {
    const [h, m] = str.split(':').map(Number);
    return { h, m };
  },

  /**
   * 제출일 기준으로 처리예정일(목요일) 을 계산한다.
   * - 금주 마감요일(화요일) 마감시각 이전에 제출 → 금주 처리요일(목요일)
   * - 이후에 제출 → 다음주 처리요일(목요일)
   */
  calcScheduledDate(submittedAt, config) {
    const sub = new Date(submittedAt);
    const { h: dlH, m: dlM } = this.parseTime(config.deadlineTime);

    // 금주 마감일시
    const deadline = new Date(sub);
    const diffToDeadline = (config.deadlineDow - sub.getDay() + 7) % 7;
    // 같은 요일이면 시각 비교
    if (diffToDeadline === 0 && (sub.getHours() > dlH || (sub.getHours() === dlH && sub.getMinutes() > dlM))) {
      // 오늘이 마감요일인데 시각이 지난 경우
      deadline.setDate(sub.getDate() + 7);
    } else {
      deadline.setDate(sub.getDate() + diffToDeadline);
    }
    deadline.setHours(dlH, dlM, 0, 0);

    // 처리일 = 마감일을 기준으로, 마감 이후에 오는 첫 processDow
    const processDate = new Date(deadline);
    const diffToProcess = (config.processDow - deadline.getDay() + 7) % 7;
    // 마감과 같은 요일이면 다음 주
    processDate.setDate(deadline.getDate() + (diffToProcess === 0 ? 7 : diffToProcess));
    processDate.setHours(0, 0, 0, 0);

    // 제출이 마감 이후이면 한 주 미룸
    if (sub > deadline) {
      processDate.setDate(processDate.getDate() + 7);
    }

    return processDate;
  },

  /**
   * 금주 입력 마감일시 (현재 시점 기준)
   */
  getCurrentDeadline(config) {
    const now = new Date();
    const { h, m } = this.parseTime(config.deadlineTime);
    const d = new Date(now);
    let diff = (config.deadlineDow - now.getDay() + 7) % 7;
    if (diff === 0 && (now.getHours() > h || (now.getHours() === h && now.getMinutes() > m))) {
      diff = 7;
    }
    d.setDate(now.getDate() + diff);
    d.setHours(h, m, 0, 0);
    return d;
  },

  /**
   * 금주 처리예정일 (현재 시점 기준, 다가오는)
   */
  getCurrentProcessDate(config) {
    const deadline = this.getCurrentDeadline(config);
    const processDate = new Date(deadline);
    const diff = (config.processDow - deadline.getDay() + 7) % 7;
    processDate.setDate(deadline.getDate() + (diff === 0 ? 7 : diff));
    processDate.setHours(0, 0, 0, 0);
    return processDate;
  },

  /**
   * 다가오는 엑셀 출력 일시
   */
  getNextExcelExportDate(config) {
    const now = new Date();
    const { h, m } = this.parseTime(config.excelTime);
    const d = new Date(now);
    let diff = (config.excelDow - now.getDay() + 7) % 7;
    if (diff === 0 && (now.getHours() > h || (now.getHours() === h && now.getMinutes() > m))) {
      diff = 7;
    }
    d.setDate(now.getDate() + diff);
    d.setHours(h, m, 0, 0);
    return d;
  },

  /**
   * 엑셀 자동 출력 타이밍 여부
   */
  shouldExportExcel(config) {
    const now = new Date();
    const { h, m } = this.parseTime(config.excelTime);
    if (now.getDay() !== config.excelDow) return false;
    const targetMinutes = h * 60 + m;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    if (nowMinutes < targetMinutes) return false;
    // 이미 오늘 출력했는지 확인
    if (config.lastExcelExport) {
      const last = new Date(config.lastExcelExport);
      if (this.toYMD(last) === this.toYMD(now)) return false;
    }
    return true;
  },

  // ---- Status ----
  calcStatus(submission) {
    if (submission.files && submission.files.transferReceipt) {
      return '처리완료';
    }
    return '처리예정';
  },

  // ---- Formatters ----
  formatMoney(n) {
    if (n == null || isNaN(n)) return '-';
    return Number(n).toLocaleString('ko-KR') + '원';
  },

  formatMoneyRaw(n) {
    if (n == null || isNaN(n)) return '';
    return Number(n).toLocaleString('ko-KR');
  },

  parseMoney(str) {
    if (!str) return 0;
    return Number(String(str).replace(/[^0-9.-]/g, '')) || 0;
  },

  formatDowTime(dow, time) {
    return `${DOW_KO[dow]}요일 ${time}`;
  },

  describeDate(d) {
    if (!d) return '-';
    const date = d instanceof Date ? d : new Date(d);
    return `${this.toYMD(date)} (${DOW_KO[date.getDay()]})`;
  },

  // ---- 고객번호 / 계좌번호 포맷 ----
  /**
   * 고객번호 → 00-0000-0000 (10자리, 부족하면 앞에 0 패딩)
   * 예) "1234567890"  → "12-3456-7890"
   *     "234567891"   → "02-3456-7891"  (9자리 → 앞에 0 추가)
   *     "12-3456-7890" → "12-3456-7890" (이미 형식 맞음)
   */
  formatCustomerNumber(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return raw || '';
    const padded = digits.padStart(10, '0').slice(-10); // 10자리 유지
    return `${padded.slice(0, 2)}-${padded.slice(2, 6)}-${padded.slice(6, 10)}`;
  },

  /**
   * 계좌번호 → 000-00000-000000 (3-5-나머지 형식)
   * 예) "56217438641540"     → "562-17438-641540"
   *     "562-17438-641540"   → "562-17438-641540"
   *     "14001575199"        → "140-01575-199"
   */
  formatAccountNumber(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return raw || '';
    if (digits.length <= 3) return digits;
    if (digits.length <= 8) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 8)}-${digits.slice(8)}`;
  },

  // ---- 계산 ----
  calcVat(base) { return Math.round(Number(base || 0) * 0.1); },
  calcTotal(base) { return Number(base || 0) + this.calcVat(base); },

  // ---- 이미지 → PDF 변환 (jsPDF) ----
  isPdf(mimeType, fileName) {
    if (mimeType && /pdf/i.test(mimeType)) return true;
    if (fileName && /\.pdf$/i.test(fileName)) return true;
    return false;
  },
  isImage(mimeType, fileName) {
    if (mimeType && /^image\//i.test(mimeType)) return true;
    if (fileName && /\.(jpg|jpeg|png|gif|bmp|webp|tif|tiff)$/i.test(fileName)) return true;
    return false;
  },

  /**
   * 여러 PDF ArrayBuffer 를 하나의 PDF 로 병합 (pdf-lib 사용)
   */
  async mergePdfs(arrayBuffers) {
    const { PDFDocument } = window.PDFLib;
    const merged = await PDFDocument.create();
    for (const buf of arrayBuffers) {
      try {
        const src = await PDFDocument.load(buf, { ignoreEncryption: true });
        const pages = await merged.copyPages(src, src.getPageIndices());
        pages.forEach(p => merged.addPage(p));
      } catch (e) {
        console.warn('PDF 병합 중 한 파일 스킵:', e.message);
      }
    }
    return await merged.save(); // ArrayBuffer
  },

  /**
   * 이미지 ArrayBuffer 를 PDF ArrayBuffer 로 변환 (페이지 전체 채움)
   */
  async imageToPdf(arrayBuffer, mimeType) {
    const blob = new Blob([arrayBuffer], { type: mimeType || 'image/jpeg' });
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    // 이미지 크기 측정
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = dataUrl;
    });

    // jspdf UMD 글로벌
    const { jsPDF } = window.jspdf;
    // 이미지 비율에 맞춰 페이지 크기 결정 (A4 기본)
    const a4w = 595, a4h = 842; // pt
    const ratio = img.width / img.height;
    let w = a4w, h = a4w / ratio;
    if (h > a4h) { h = a4h; w = a4h * ratio; }
    const orientation = ratio > 1 ? 'l' : 'p';
    const pdf = new jsPDF({ orientation, unit: 'pt', format: 'a4' });
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    // 이미지 비율 유지하며 페이지 중앙 정렬
    const ir = img.width / img.height;
    const pr = pw / ph;
    let dw = pw, dh = ph;
    if (ir > pr) { dh = pw / ir; } else { dw = ph * ir; }
    const x = (pw - dw) / 2, y = (ph - dh) / 2;
    const fmt = /png/i.test(mimeType || '') ? 'PNG' : 'JPEG';
    pdf.addImage(dataUrl, fmt, x, y, dw, dh);
    return pdf.output('arraybuffer');
  },

  // ---- 파일 이름 생성 ----
  /**
   * 파일명/폴더명에 사용할 수 없는 문자 제거 (Windows + URL/ZIP 안전)
   */
  sanitize(s) {
    return String(s || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
  },

  /**
   * 거점명 정규화 — 무의미한 값(빈 문자열, 하이픈 단독, 언더스코어 단독)을 빈 값으로
   */
  normalizeLocation(loc) {
    const s = String(loc || '').trim();
    if (!s) return '';
    if (/^[-_\s]+$/.test(s)) return ''; // -, --, _, _ _ 등은 무의미
    if (s === '0거점') return '';
    return s;
  },

  /**
   * 프로젝트명에서 [현장명, 차수] 추출
   * - "25년환경부_아포리 배말타운_1차(대기4842,...)" → { name:'아포리 배말타운', round:'1' }
   * - "삼일아파트_2차" → { name:'삼일아파트', round:'2' }
   * - "기타현장" → { name:'기타현장', round:'' }
   */
  parseProjectName(fullName) {
    if (!fullName) return { name: '', round: '' };
    const s = String(fullName);
    // 차수 마커 이후 모두 제거 (괄호, 부가 텍스트 등)
    const m = s.match(/^(.*?)_(\d+)차/);
    let name, round;
    if (m) {
      name = m[1].trim();
      round = m[2];
    } else {
      const parenIdx = s.indexOf('(');
      name = parenIdx >= 0 ? s.slice(0, parenIdx).trim() : s.trim();
      round = '';
    }
    // "XX년환경부_" 접두사 제거 (예: "25년환경부_아포리 배말타운" → "아포리 배말타운")
    name = name.replace(/^\d{2}년환경부_/, '');
    return { name, round };
  },

  /**
   * [프로젝트ID]_[현장명]_[차수]차[-거점] 형식의 식별자
   */
  getProjectIdent(sub) {
    const { name, round } = this.parseProjectName(sub.projectName || '');
    const idPart = this.sanitize(sub.projectId);
    const namePart = this.sanitize(name);
    const roundSuffix = round ? `_${round}차` : '';
    const cleanLoc = this.normalizeLocation(sub.location);
    const locPart = cleanLoc ? `-${this.sanitize(cleanLoc)}` : '';
    return `${idPart}_${namePart}${roundSuffix}${locPart}`;
  },

  /**
   * 같은 projectId 가 여러 번 등장하면 자동으로 거점번호 부여 (-1거점, -2거점)
   * @param submissions 원본 제출 배열
   * @returns 같은 길이의 배열, 각 항목은 effectiveLocation 문자열
   */
  assignAutoLocations(submissions) {
    const counts = {};
    submissions.forEach(s => { counts[s.projectId] = (counts[s.projectId] || 0) + 1; });
    const idx = {};
    return submissions.map(s => {
      // 다중 거점 → 항상 자동 번호 (1거점, 2거점 ...) 충돌 방지
      if (counts[s.projectId] > 1) {
        idx[s.projectId] = (idx[s.projectId] || 0) + 1;
        return `${idx[s.projectId]}거점`;
      }
      // 단일 → 거점명 없음 (파일/폴더명에서 제외)
      return '';
    });
  },

  /**
   * 폴더 구조: [프로젝트ID]_[현장명]_[차수]차[-거점]
   */
  getFolderPath(sub) {
    return this.getProjectIdent(sub);
  },

  /**
   * 파일명 규칙:
   * - 전기사용신청접수증: [프로젝트ID]_[프로젝트명]_[차수]차_전기사용신청접수증.[ext]
   *   (거점 없음 — 프로젝트당 공통)
   * - 시설부담금고지서: [프로젝트ID]_[프로젝트명]_[차수]차-[거점]_시설부담금고지서([대기번호]).[ext]
   *   (거점, 대기번호 포함)
   * - 이체증: [프로젝트ID]_[프로젝트명](-거점)_이체증.[ext]
   *
   * extra: { waitingNumber } — 중앙 시트에서 lookup 한 추가 정보
   */
  getFileName(sub, docType, originalName, extra) {
    // 비고는 .txt, 나머지는 .pdf
    const ext = docType === 'notes' ? 'txt' : 'pdf';
    extra = extra || {};

    const { name, round } = this.parseProjectName(sub.projectName || '');
    const idPart = this.sanitize(sub.projectId);
    const namePart = this.sanitize(name);
    const roundSuffix = round ? `_${round}차` : '';
    const cleanLoc = this.normalizeLocation(sub.location);
    const locPart = cleanLoc ? `-${this.sanitize(cleanLoc)}` : '';

    if (docType === 'applicationReceipt') {
      // 전기사용신청접수증: 거점 없음
      return `${idPart}_${namePart}${roundSuffix}_전기사용신청접수증.${ext}`;
    }
    if (docType === 'feeNotice') {
      // 시설부담금고지서: [ID]_[현장명]_[N차]-[M거점]_시설부담금고지서(0000) — 대기번호 4자리
      const wnRaw = extra.waitingNumber ? String(extra.waitingNumber).replace(/[^0-9]/g, '') : '';
      const wn = wnRaw ? `(${wnRaw.padStart(4, '0')})` : '';
      return `${idPart}_${namePart}${roundSuffix}${locPart}_시설부담금고지서${wn}.${ext}`;
    }
    if (docType === 'transferReceipt') {
      // 이체증_한국전력공사_[ID]_25년환경부_[현장명]_[N]차[-M거점]_[YYYYMMDD]
      const today = new Date();
      const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
      const roundLabel = round ? `_${round}차` : '';
      return `이체증_한국전력공사_${idPart}_25년환경부_${namePart}${roundLabel}${locPart}_${dateStr}.${ext}`;
    }
    if (docType === 'notes') {
      return `${idPart}_${namePart}${roundSuffix}${locPart}_비고.${ext}`;
    }
    return `${idPart}_${namePart}${roundSuffix}${locPart}_파일.${ext}`;
  },
};
