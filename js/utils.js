// ============================================================
// 유틸리티 (날짜 · 포맷 · 파일명 · 카테고리)
// ============================================================

const Utils = {
  // ─── ID ───
  uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  },

  // ─── 날짜 ───
  toYMD(d) {
    if (!(d instanceof Date)) d = new Date(d);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  },
  toYMDCompact(d) {
    return this.toYMD(d).replace(/-/g, '');
  },
  /** 해당 주(월-일) 목요일 */
  thisThursday() {
    const now = new Date();
    const day = now.getDay(); // 0=일 ... 4=목
    const diff = 4 - day;
    const d = new Date(now);
    d.setDate(now.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  },

  // ─── 숫자/금액 ───
  parseNum(v) {
    if (v == null || v === '') return 0;
    return Number(String(v).replace(/[^0-9.-]/g, '')) || 0;
  },
  fmtMoney(n) {
    const v = Number(n) || 0;
    return v.toLocaleString('ko-KR');
  },
  fmtMoneyWon(n) { return this.fmtMoney(n) + '원'; },
  calcVat(base) { return Math.round(this.parseNum(base) * 0.1); },
  calcTotal(base) { const b = this.parseNum(base); return b + this.calcVat(b); },

  // ─── 고객번호/계좌 ───
  fmtCustomerNo(raw) {
    const d = String(raw || '').replace(/\D/g, '');
    if (!d) return '';
    const p = d.padStart(10, '0').slice(-10);
    return `${p.slice(0,2)}-${p.slice(2,6)}-${p.slice(6,10)}`;
  },
  fmtAccountNo(raw) {
    const d = String(raw || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.length <= 3) return d;
    if (d.length <= 8) return `${d.slice(0,3)}-${d.slice(3)}`;
    return `${d.slice(0,3)}-${d.slice(3,8)}-${d.slice(8)}`;
  },

  // ─── HTML escape ───
  esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  },

  // ─── 문자열 정제 (파일명) ───
  sanitize(s) {
    return String(s || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
  },
  /** "25년환경부_아포리 배말타운_1차(대기...)" → { name, round } */
  parseProjectName(full) {
    if (!full) return { name: '', round: '' };
    const s = String(full);
    const m = s.match(/^(.*?)_(\d+)차/);
    let name, round;
    if (m) { name = m[1].trim(); round = m[2]; }
    else {
      const p = s.indexOf('(');
      name = p >= 0 ? s.slice(0, p).trim() : s.trim();
      round = '';
    }
    name = name.replace(/^\d{2}년환경부_/, '').replace(/^\d{2}년민자_/, '');
    return { name, round };
  },

  // ─── 카테고리 ───
  detectCategory(projectName) {
    const s = String(projectName || '');
    if (/25년환경부|2025.*환경부|환경부.*25/.test(s)) return 'env25';
    if (/26년환경부|2026.*환경부|환경부.*26/.test(s)) return 'env26';
    if (/민자|자체|비환경부/.test(s)) return 'private';
    return 'env25'; // 기본값 (현재 대다수)
  },
  categoryLabel(id) {
    const c = APP.categories.find(x => x.id === id);
    return c ? c.label : id;
  },
  categoryPill(id) {
    const c = APP.categories.find(x => x.id === id);
    return c ? c.pill : 'pill-muted';
  },

  // ─── 파일명 규칙 ───
  /**
   * docType:
   *   applicationReceipt: [ID]_[현장명]_[N차]_전기사용신청접수증.pdf
   *   feeNotice:          [ID]_[현장명]_[N차][-M거점]_시설부담금고지서(대기번호).pdf
   */
  buildFileName(sub, docType, extra = {}) {
    const { name, round } = this.parseProjectName(sub.projectName || '');
    const idPart = this.sanitize(sub.projectId);
    const namePart = this.sanitize(name);
    const roundSuffix = round ? `_${round}차` : '';
    const loc = String(sub.location || '').trim();
    const locPart = loc && !/^[-_\s]+$/.test(loc) ? `-${this.sanitize(loc)}` : '';

    if (docType === 'applicationReceipt') {
      return `${idPart}_${namePart}${roundSuffix}_전기사용신청접수증.pdf`;
    }
    if (docType === 'feeNotice') {
      const wnRaw = extra.waitingNumber ? String(extra.waitingNumber).replace(/[^0-9]/g,'') : '';
      const wn = wnRaw ? `(${wnRaw.padStart(4,'0')})` : '';
      return `${idPart}_${namePart}${roundSuffix}${locPart}_시설부담금고지서${wn}.pdf`;
    }
    return `${idPart}_${namePart}${roundSuffix}${locPart}_${docType}.pdf`;
  },
  /** 프로젝트 폴더명 */
  buildFolderName(sub) {
    const { name, round } = this.parseProjectName(sub.projectName || '');
    const idPart = this.sanitize(sub.projectId);
    const namePart = this.sanitize(name);
    const roundSuffix = round ? `_${round}차` : '';
    return `${idPart}_${namePart}${roundSuffix}`;
  },

  // ─── 이미지 → PDF 변환 ───
  async imageToPdf(arrayBuffer, mimeType) {
    const blob = new Blob([arrayBuffer], { type: mimeType || 'image/jpeg' });
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = dataUrl;
    });
    const { jsPDF } = window.jspdf;
    const ratio = img.width / img.height;
    const orientation = ratio > 1 ? 'l' : 'p';
    const pdf = new jsPDF({ orientation, unit: 'pt', format: 'a4' });
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    let dw = pw, dh = ph;
    if (ratio > pw/ph) { dh = pw/ratio; } else { dw = ph*ratio; }
    const x = (pw - dw) / 2, y = (ph - dh) / 2;
    const fmt = /png/i.test(mimeType || '') ? 'PNG' : 'JPEG';
    pdf.addImage(dataUrl, fmt, x, y, dw, dh);
    return pdf.output('arraybuffer');
  },
  isPdf(mime, name) {
    if (mime && /pdf/i.test(mime)) return true;
    if (name && /\.pdf$/i.test(name)) return true;
    return false;
  },
  isImage(mime, name) {
    if (mime && /^image\//i.test(mime)) return true;
    if (name && /\.(jpe?g|png|gif|bmp|webp|tiff?)$/i.test(name)) return true;
    return false;
  },

  // ─── 로딩 오버레이 ───
  showLoading(text) {
    const el = document.getElementById('loading-overlay');
    document.getElementById('loading-text').textContent = text || '처리 중...';
    el.classList.add('active');
  },
  hideLoading() {
    document.getElementById('loading-overlay').classList.remove('active');
  },

  // ─── Toast (간단) ───
  toast(msg) { alert(msg); }, // 향후 커스텀 토스트로 교체 예정
};
