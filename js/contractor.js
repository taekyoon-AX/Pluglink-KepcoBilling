// ============================================================
// 시공사 뷰: 새 요청 / 나의 이력
// ============================================================

const Contractor = {
  _projects: {}, // { projectId: { name, category, ...pmData } }
  _pending: [],  // 납부대기 rows
  _paid: [],     // 납부내역 rows
  _pmCache: {},  // projectId → pm columns

  navTabs() {
    return [
      { id: 'submit',  label: '새 요청' },
      { id: 'history', label: '나의 이력' },
    ];
  },

  async render(tab, container) {
    if (tab === 'submit') return this._renderSubmit(container);
    if (tab === 'history') return this._renderHistory(container);
  },

  // ══════════ 새 요청 ══════════
  async _renderSubmit(root) {
    const auth = Auth.current();
    root.innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">새 납부 요청</div>
          <div class="page-desc">한전 표준시설부담금 납부 요청을 접수합니다. 프로젝트 ID 입력 → 자동 완성 → 파일 첨부 → 제출.</div>
        </div>
      </div>

      <div class="flow-steps">
        <div class="flow-step active" data-step="1">
          <div class="flow-step-num">1</div>
          <div class="flow-step-body">
            <div class="flow-step-label">프로젝트 선택</div>
            <div class="flow-step-desc">본인 시공사 프로젝트 목록에서 선택</div>
          </div>
        </div>
        <div class="flow-step" data-step="2">
          <div class="flow-step-num">2</div>
          <div class="flow-step-body">
            <div class="flow-step-label">정보 입력</div>
            <div class="flow-step-desc">용량 · 부담금 · 고객번호 · 계좌</div>
          </div>
        </div>
        <div class="flow-step" data-step="3">
          <div class="flow-step-num">3</div>
          <div class="flow-step-body">
            <div class="flow-step-label">파일 첨부</div>
            <div class="flow-step-desc">고지서 · 접수증 (PDF/이미지)</div>
          </div>
        </div>
        <div class="flow-step" data-step="4">
          <div class="flow-step-num">4</div>
          <div class="flow-step-body">
            <div class="flow-step-label">제출</div>
            <div class="flow-step-desc">납부대기 시트에 등록</div>
          </div>
        </div>
      </div>

      <div id="submit-items"></div>

      <div class="card" style="text-align:center;padding:16px;">
        <button id="btn-add-row" class="btn btn-outline">+ 프로젝트 추가</button>
        <button id="btn-import-excel" class="btn btn-ghost" style="margin-left:8px">📥 엑셀 일괄 업로드</button>
        <input type="file" id="excel-input" accept=".xlsx,.xls" style="display:none" />
      </div>

      <div style="display:flex;justify-content:flex-end;margin-top:20px;gap:8px;">
        <button id="btn-download-template" class="btn btn-ghost">📄 양식 다운로드</button>
        <button id="btn-submit-all" class="btn btn-primary btn-lg">📤 전체 제출</button>
      </div>
      <p id="submit-msg" class="mt-16"></p>
    `;

    // 시공사 프로젝트 로드
    await this._loadContractorProjects(auth.name || auth.id);

    // 초기 1개 행 추가
    this._items = [];
    this._addItem();

    document.getElementById('btn-add-row').onclick = () => this._addItem();
    document.getElementById('btn-submit-all').onclick = () => this._submitAll();
    document.getElementById('btn-import-excel').onclick = () => document.getElementById('excel-input').click();
    document.getElementById('excel-input').onchange = e => this._importExcel(e.target.files[0]);
    document.getElementById('btn-download-template').onclick = () => this._downloadTemplate();
  },

  async _loadContractorProjects(contractorName) {
    if (!API.enabled()) return;
    const r = await API.fetchProjectsForContractor(contractorName);
    if (r && r.ok && r.projects) this._projects = r.projects;
  },

  _addItem() {
    const id = 'itm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const item = { id, projectId: '', projectName: '', capacity: '', baseFee: '', customerNumber: '', customerBank: '', customerAccount: '', notes: '', appReceipt: null, feeNotice: null };
    if (!this._items) this._items = [];
    this._items.push(item);
    this._renderItems();
  },

  _removeItem(id) {
    this._items = this._items.filter(x => x.id !== id);
    this._renderItems();
  },

  _renderItems() {
    const wrap = document.getElementById('submit-items');
    if (!wrap) return;
    if (this._items.length === 0) {
      wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-title">추가된 요청이 없습니다</div><div class="empty-state-desc">+ 프로젝트 추가 버튼을 눌러 시작하세요.</div></div>`;
      return;
    }
    wrap.innerHTML = this._items.map((it, i) => this._itemCard(it, i)).join('');
    // 이벤트 바인딩
    this._items.forEach(it => {
      const card = document.querySelector(`[data-item="${it.id}"]`);
      if (!card) return;
      card.querySelector('.f-projectId').onchange = e => this._onProjectIdChange(it.id, e.target.value);
      card.querySelectorAll('.f-input').forEach(inp => {
        inp.oninput = e => { it[inp.dataset.field] = e.target.value; this._recalc(it.id); };
      });
      card.querySelector('.btn-remove').onclick = () => this._removeItem(it.id);
      card.querySelector('.f-app-receipt').onchange = e => this._onFileChange(it.id, 'appReceipt', e.target.files[0]);
      card.querySelector('.f-fee-notice').onchange = e => this._onFileChange(it.id, 'feeNotice', e.target.files[0]);
    });
  },

  _itemCard(it, idx) {
    const cat = Utils.detectCategory(it.projectName);
    const proj = this._projects[it.projectId];
    const autoFilled = !!(proj && proj.name);
    const vat = Utils.calcVat(it.baseFee);
    const total = Utils.calcTotal(it.baseFee);

    return `
      <div class="card" data-item="${it.id}">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="pill pill-primary">#${idx + 1}</span>
            ${it.projectName ? `<span class="pill ${Utils.categoryPill(cat)}">${Utils.categoryLabel(cat)}</span>` : ''}
            <strong style="font-size:14px;">${Utils.esc(it.projectName || '프로젝트 미선택')}</strong>
          </div>
          <button class="btn btn-ghost btn-sm btn-remove">✕ 삭제</button>
        </div>

        <div class="form-grid">
          <label class="field field-required" style="grid-column: span 2;">
            <span>프로젝트 ID</span>
            <input type="text" class="f-projectId" value="${Utils.esc(it.projectId)}" placeholder="예: 26863" list="projects-list" />
            ${autoFilled ? `<div class="field-hint" style="color:var(--primary)">✓ ${Utils.esc(proj.name)}</div>` : `<div class="field-hint">프로젝트 ID 입력 시 자동으로 이름·주소 채워집니다</div>`}
          </label>

          <label class="field field-required">
            <span>용량 (kW)</span>
            <input type="number" class="f-input" data-field="capacity" value="${Utils.esc(it.capacity)}" placeholder="예: 30" />
          </label>

          <label class="field field-required">
            <span>표준시설부담금</span>
            <input type="number" class="f-input" data-field="baseFee" value="${Utils.esc(it.baseFee)}" placeholder="예: 350000" />
            <div class="field-hint">부가세 <strong>${Utils.fmtMoney(vat)}원</strong> · 합계 <strong style="color:var(--primary)">${Utils.fmtMoney(total)}원</strong></div>
          </label>

          <label class="field field-required">
            <span>고객번호</span>
            <input type="text" class="f-input" data-field="customerNumber" value="${Utils.esc(it.customerNumber)}" placeholder="예: 12-3456-7890" />
          </label>

          <label class="field field-required">
            <span>은행</span>
            <input type="text" class="f-input" data-field="customerBank" value="${Utils.esc(it.customerBank)}" placeholder="예: 기업" />
          </label>

          <label class="field field-required" style="grid-column: span 2;">
            <span>계좌번호</span>
            <input type="text" class="f-input" data-field="customerAccount" value="${Utils.esc(it.customerAccount)}" placeholder="예: 123-45678-901234" />
          </label>

          <label class="field" style="grid-column: span 2;">
            <span>비고 (선택)</span>
            <input type="text" class="f-input" data-field="notes" value="${Utils.esc(it.notes)}" placeholder="메모" />
          </label>
        </div>

        <div class="form-grid" style="margin-top:16px;">
          <div>
            <div class="field-hint" style="margin-bottom:6px;font-weight:600;color:var(--text);">전기사용신청접수증 <span style="color:var(--danger)">*</span></div>
            ${it.appReceipt
              ? `<div class="file-selected"><span>📄</span><span class="file-name">${Utils.esc(it.appReceipt.name)}</span><button class="btn btn-ghost btn-sm" onclick="Contractor._clearFile('${it.id}','appReceipt')">✕</button></div>`
              : `<label class="file-dropzone"><div class="file-dropzone-icon">📄</div><div class="file-dropzone-label">클릭하여 접수증 첨부</div><div class="file-dropzone-hint">PDF · JPG · PNG</div><input type="file" class="f-app-receipt" accept="application/pdf,image/*" style="display:none" /></label>`}
          </div>
          <div>
            <div class="field-hint" style="margin-bottom:6px;font-weight:600;color:var(--text);">시설부담금 고지서 <span style="color:var(--danger)">*</span></div>
            ${it.feeNotice
              ? `<div class="file-selected"><span>📄</span><span class="file-name">${Utils.esc(it.feeNotice.name)}</span><button class="btn btn-ghost btn-sm" onclick="Contractor._clearFile('${it.id}','feeNotice')">✕</button></div>`
              : `<label class="file-dropzone"><div class="file-dropzone-icon">📄</div><div class="file-dropzone-label">클릭하여 고지서 첨부</div><div class="file-dropzone-hint">PDF · JPG · PNG</div><input type="file" class="f-fee-notice" accept="application/pdf,image/*" style="display:none" /></label>`}
          </div>
        </div>
      </div>
    `;
  },

  _clearFile(itemId, field) {
    const it = this._items.find(x => x.id === itemId);
    if (it) { it[field] = null; this._renderItems(); }
  },

  _onFileChange(itemId, field, file) {
    const it = this._items.find(x => x.id === itemId);
    if (it && file) { it[field] = file; this._renderItems(); }
  },

  async _onProjectIdChange(itemId, projectId) {
    const it = this._items.find(x => x.id === itemId);
    if (!it) return;
    it.projectId = projectId.trim();

    // 로컬 프로젝트 매핑에서 검색
    let projMeta = this._projects[it.projectId];
    if (projMeta) {
      it.projectName = projMeta.name || '';
    }

    // PM 시트에서 세부 정보 조회
    if (it.projectId && API.enabled()) {
      const cfg = Store.getConfig();
      const cols = [cfg.pmSiteNameCol, cfg.pmAddressCol, cfg.pmCategoryCol, cfg.pmWaitingNumCol, cfg.pmContractSumCol];
      const r = await API.lookupCentral([it.projectId], cols);
      if (r && r.ok && r.map && r.map[it.projectId]) {
        const hit = r.map[it.projectId];
        it.projectName = hit[cfg.pmSiteNameCol] || it.projectName || '';
        it.pmMeta = {
          address: hit[cfg.pmAddressCol] || '',
          category: hit[cfg.pmCategoryCol] || '',
          waitingNumber: hit[cfg.pmWaitingNumCol] || '',
          contractSum: hit[cfg.pmContractSumCol] || '',
        };
      }
    }
    this._renderItems();
  },

  _recalc(itemId) {
    // 값만 입력되면 부가세/합계는 카드 렌더 시 재계산됨. 여기선 렌더만.
    this._renderItems();
  },

  async _submitAll() {
    if (!this._items || this._items.length === 0) { Utils.toast('제출할 항목이 없습니다.'); return; }
    const auth = Auth.current();
    const errs = [];
    this._items.forEach((it, i) => {
      const missing = [];
      if (!it.projectId) missing.push('프로젝트ID');
      if (!it.capacity) missing.push('용량');
      if (!it.baseFee) missing.push('표준시설부담금');
      if (!it.customerNumber) missing.push('고객번호');
      if (!it.customerBank) missing.push('은행');
      if (!it.customerAccount) missing.push('계좌번호');
      if (!it.appReceipt) missing.push('접수증');
      if (!it.feeNotice) missing.push('고지서');
      if (missing.length) errs.push(`#${i + 1}: ${missing.join(', ')}`);
    });
    if (errs.length) {
      document.getElementById('submit-msg').innerHTML = `<div class="notice notice-err">필수값 누락:<br>${errs.join('<br>')}</div>`;
      return;
    }

    Utils.showLoading(`제출 중... 0/${this._items.length}`);
    let ok = 0, fail = 0;
    for (let i = 0; i < this._items.length; i++) {
      Utils.showLoading(`제출 중... ${i + 1}/${this._items.length}`);
      const it = this._items[i];
      try {
        // 파일 → PDF 변환 → Drive 업로드
        const sub = {
          projectId: it.projectId,
          projectName: it.projectName,
          contractor: auth.name || auth.id,
        };
        const appPdf = await Files.toPdf(it.appReceipt);
        const feePdf = await Files.toPdf(it.feeNotice);
        const appFile = Files.toFile(appPdf, Utils.buildFileName(sub, 'applicationReceipt'));
        const feeFile = Files.toFile(feePdf, Utils.buildFileName(sub, 'feeNotice', { waitingNumber: (it.pmMeta && it.pmMeta.waitingNumber) || '' }));
        const appUp = await API.uploadFile(appFile, sub, 'applicationReceipt');
        const feeUp = await API.uploadFile(feeFile, sub, 'feeNotice');

        // 납부대기 행 추가
        const cat = (it.pmMeta && it.pmMeta.category) || Utils.detectCategory(it.projectName);
        const row = {
          a: auth.name || auth.id,                             // 시공사
          b: it.projectId,                                     // 프로젝트ID
          c: Utils.categoryLabel(cat),                         // 사업구분
          d: it.projectName,                                   // 현장명
          e: (it.pmMeta && it.pmMeta.address) || '',           // 도로명주소
          f: `${it.capacity} kW`,                              // 용량
          g: Utils.parseNum(it.baseFee),                       // 부담금
          j: it.customerNumber,                                // 고객번호
          k: it.customerBank,                                  // 은행
          l: it.customerAccount,                               // 계좌
          m: (it.pmMeta && it.pmMeta.waitingNumber) || '',     // 대기번호
          n: (it.pmMeta && it.pmMeta.contractSum) || '',       // 계약합계
          r: it.notes || '',                                   // 비고
          s: (appUp && appUp.ok) ? appUp.url : '',             // 접수증 URL
          t: (feeUp && feeUp.ok) ? feeUp.url : '',             // 고지서 URL
        };
        const r = await API.appendPending(row);
        if (r && r.ok) ok++; else fail++;
      } catch (e) {
        console.error('submit error', e);
        fail++;
      }
    }
    Utils.hideLoading();

    document.getElementById('submit-msg').innerHTML =
      `<div class="notice notice-info">✓ ${ok}건 제출 완료${fail ? ` · 실패 ${fail}건` : ''}</div>`;
    this._items = [];
    this._renderItems();
  },

  async _importExcel(file) {
    if (!file) return;
    Utils.showLoading('엑셀 파싱 중...');
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new Error('시트를 찾을 수 없습니다');

      // 2차원 배열로 읽기 (헤더 자동 탐지)
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (!rows || rows.length < 2) throw new Error('데이터가 없습니다');

      // 헤더 행 탐지 (첫 5행 중 '프로젝트ID' 또는 '프로젝트' 있는 행)
      const norm = s => String(s || '').replace(/\s+/g, '').toLowerCase();
      let headerIdx = -1;
      for (let i = 0; i < Math.min(5, rows.length); i++) {
        const row = rows[i];
        if (row.some(v => /프로젝트|projectid/i.test(norm(v)))) { headerIdx = i; break; }
      }
      if (headerIdx < 0) { Utils.hideLoading(); Utils.toast('헤더 행(프로젝트ID 컬럼)을 찾을 수 없습니다. 양식을 확인해주세요.'); return; }

      const header = rows[headerIdx].map(v => norm(v));
      const findCol = (keys) => {
        for (let c = 0; c < header.length; c++) {
          for (const k of keys) { if (header[c].includes(norm(k))) return c; }
        }
        return -1;
      };
      const cols = {
        pid:  findCol(['프로젝트id', '프로젝트번호', '프로젝트']),
        cap:  findCol(['용량', 'kw', 'capacity']),
        fee:  findCol(['부담금', '표준시설', '금액']),
        cust: findCol(['고객번호', '고객']),
        bank: findCol(['은행']),
        acct: findCol(['계좌', '계좌번호']),
        note: findCol(['비고', '메모', '노트']),
      };
      if (cols.pid < 0) { Utils.hideLoading(); Utils.toast('프로젝트ID 컬럼을 찾을 수 없습니다.'); return; }

      // 파싱
      const imported = [];
      for (let r = headerIdx + 1; r < rows.length; r++) {
        const row = rows[r];
        const pid = String(row[cols.pid] || '').trim();
        if (!pid) continue;
        imported.push({
          id: 'itm_' + Date.now() + '_' + r + '_' + Math.random().toString(36).slice(2, 6),
          projectId: pid,
          projectName: '',
          capacity: cols.cap  >= 0 ? String(row[cols.cap] || '').trim() : '',
          baseFee:  cols.fee  >= 0 ? String(row[cols.fee] || '').trim() : '',
          customerNumber: cols.cust >= 0 ? String(row[cols.cust] || '').trim() : '',
          customerBank:   cols.bank >= 0 ? String(row[cols.bank] || '').trim() : '',
          customerAccount:cols.acct >= 0 ? String(row[cols.acct] || '').trim() : '',
          notes: cols.note >= 0 ? String(row[cols.note] || '').trim() : '',
          appReceipt: null,
          feeNotice: null,
        });
      }

      if (imported.length === 0) { Utils.hideLoading(); Utils.toast('가져올 항목이 없습니다.'); return; }

      // PM 시트 lookup (일괄)
      if (API.enabled()) {
        const cfg = Store.getConfig();
        const ids = [...new Set(imported.map(x => x.projectId))];
        const lookupCols = [cfg.pmSiteNameCol, cfg.pmAddressCol, cfg.pmCategoryCol, cfg.pmWaitingNumCol, cfg.pmContractSumCol];
        const lr = await API.lookupCentral(ids, lookupCols);
        if (lr && lr.ok && lr.map) {
          imported.forEach(it => {
            const hit = lr.map[it.projectId];
            if (hit) {
              it.projectName = hit[cfg.pmSiteNameCol] || '';
              it.pmMeta = {
                address: hit[cfg.pmAddressCol] || '',
                category: hit[cfg.pmCategoryCol] || '',
                waitingNumber: hit[cfg.pmWaitingNumCol] || '',
                contractSum: hit[cfg.pmContractSumCol] || '',
              };
            }
          });
        }
      }

      // 기존 items 에 추가 (병합)
      if (!this._items) this._items = [];
      // 기존 빈 항목 제거 (프로젝트ID 미입력 상태)
      this._items = this._items.filter(x => x.projectId);
      this._items.push(...imported);
      Utils.hideLoading();
      this._renderItems();

      const notMatched = imported.filter(x => !x.projectName).length;
      const msg = `✓ ${imported.length}건 가져옴 · PM 매칭 ${imported.length - notMatched}건${notMatched ? ` (미매칭 ${notMatched}건)` : ''}`;
      document.getElementById('submit-msg').innerHTML = `<div class="notice notice-info">${msg} — 각 항목에 <strong>접수증·고지서 파일</strong>을 첨부해 주세요.</div>`;
      document.getElementById('excel-input').value = ''; // 다시 같은 파일 업로드 가능하도록
    } catch (e) {
      Utils.hideLoading();
      console.error('excel import error', e);
      Utils.toast('엑셀 파싱 실패: ' + (e.message || e));
    }
  },

  _downloadTemplate() {
    // 동적 생성 — 필드 안내 헤더 + 예시 행
    const headers = ['프로젝트ID', '용량(kW)', '표준시설부담금(원)', '고객번호', '은행', '계좌번호', '비고'];
    const example = ['26863', '30', '350000', '12-3456-7890', '기업', '123-45678-901234', '(선택) 메모'];
    const guide   = ['* 필수', '* 필수', '* 필수', '* 필수', '* 필수', '* 필수', '선택'];
    const aoa = [
      ['한전표준시설부담금 납부 요청 · 일괄 등록 양식'],
      [`※ 접수증·고지서 파일은 업로드 후 각 항목마다 개별 첨부해주세요.`],
      [],
      headers,
      guide,
      example,
      example.map(() => ''), // 빈 행
      example.map(() => ''),
      example.map(() => ''),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // 컬럼 폭
    ws['!cols'] = [
      { wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 18 },
      { wch: 10 }, { wch: 20 }, { wch: 20 },
    ];
    // 제목 셀 병합
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '납부요청');
    XLSX.writeFile(wb, '한전표준시설부담금납부_양식.xlsx');
  },

  // ══════════ 나의 이력 ══════════
  async _renderHistory(root) {
    root.innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">나의 납부 이력</div>
          <div class="page-desc">본인 시공사 관련 납부 대기 · 완료 건이 표시됩니다.</div>
        </div>
        <div class="page-actions">
          <button id="btn-refresh-hist" class="btn btn-ghost">🔄 새로고침</button>
        </div>
      </div>
      <div id="history-status" class="muted mb-16"></div>
      <div class="card"><div class="card-title">⏳ 납부 대기 <span id="pending-cnt" class="muted"></span></div><div id="pending-body"></div></div>
      <div class="card"><div class="card-title">✅ 납부 완료 <span id="paid-cnt" class="muted"></span></div><div id="paid-body"></div></div>
    `;
    document.getElementById('btn-refresh-hist').onclick = () => this._loadHistory();
    await this._loadHistory();
  },

  async _loadHistory() {
    const statusEl = document.getElementById('history-status');
    if (!API.enabled()) { statusEl.textContent = '서버가 설정되지 않았습니다.'; return; }
    statusEl.textContent = '로드 중...';
    const [p, d] = await Promise.all([API.readPending(), API.readProcessing()]);
    this._pending = p && p.ok ? (p.rows || []).reverse() : [];
    this._paid    = d && d.ok ? (d.rows || []).reverse() : [];
    statusEl.textContent = `대기 ${this._pending.length}건 · 완료 ${this._paid.length}건`;
    this._renderHistoryTables();
  },

  _renderHistoryTables() {
    const mkTable = rows => {
      if (rows.length === 0) return `<div class="empty-state"><div class="empty-state-desc">항목이 없습니다.</div></div>`;
      return `
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>구분</th><th>프로젝트ID</th><th>현장명</th><th>용량</th><th>부담금</th><th>처리일</th><th>상태</th></tr></thead>
        <tbody>
          ${rows.map(r => {
            const cat = r.c || '';
            const catId = APP.categories.find(x => x.label === cat)?.id || 'env25';
            const done = r.q;
            return `<tr>
              <td><span class="pill ${Utils.categoryPill(catId)}">${Utils.esc(cat || Utils.categoryLabel(catId))}</span></td>
              <td class="mono">${Utils.esc(r.b)}</td>
              <td>${Utils.esc(r.d || r.e || '-')}</td>
              <td>${Utils.esc(r.f)}</td>
              <td class="num">${Utils.fmtMoney(r.g)}</td>
              <td>${Utils.esc(r.p || '-')}</td>
              <td><span class="pill ${done ? 'pill-done' : 'pill-pending'}">${done ? '납부완료' : '처리예정'}</span></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>
      `;
    };
    document.getElementById('pending-cnt').textContent = `(${this._pending.length}건)`;
    document.getElementById('paid-cnt').textContent    = `(${this._paid.length}건)`;
    document.getElementById('pending-body').innerHTML = mkTable(this._pending);
    document.getElementById('paid-body').innerHTML    = mkTable(this._paid);
  },
};
