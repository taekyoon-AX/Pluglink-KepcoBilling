// ============================================================
// 관리자 뷰: 대시보드 · 납부이력 · 설정
// ============================================================

const Admin = {
  _pending: [],
  _paid: [],
  _filterCategory: '',
  _filterContractor: '',
  _filterSearch: '',

  navTabs() {
    return [
      { id: 'dashboard', label: '대시보드' },
      { id: 'history',   label: '납부이력' },
      { id: 'settings',  label: '설정' },
    ];
  },

  async render(tab, container) {
    if (tab === 'dashboard') return this._renderDashboard(container);
    if (tab === 'history')   return this._renderHistory(container);
    if (tab === 'settings')  return this._renderSettings(container);
  },

  // ══════════ 대시보드 (납부대기) ══════════
  async _renderDashboard(root) {
    root.innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">납부 요청 검토</div>
          <div class="page-desc">시공사가 제출한 납부 요청을 검토하고 확인완료 처리합니다.</div>
        </div>
        <div class="page-actions">
          <button id="btn-refresh" class="btn btn-ghost">🔄 새로고침</button>
        </div>
      </div>

      <div class="stats" id="dashboard-stats"></div>

      <div class="toolbar">
        <div class="toolbar-group grow">
          <input id="filter-search" class="toolbar-search" placeholder="🔎 프로젝트ID · 현장명 · 시공사 · 고객번호" />
        </div>
        <div class="toolbar-group">
          <span class="muted" style="padding:0 6px;font-size:12px;">사업</span>
          <button class="toolbar-btn active" data-cat="">전체</button>
          ${APP.categories.map(c => `<button class="toolbar-btn" data-cat="${c.id}">${c.label}</button>`).join('')}
        </div>
        <div class="toolbar-group">
          <select id="filter-contractor" class="toolbar-select"><option value="">전체 시공사</option></select>
        </div>
      </div>

      <div id="dashboard-table"></div>
    `;

    document.getElementById('btn-refresh').onclick = () => this._loadPending();
    document.querySelectorAll('.toolbar-btn[data-cat]').forEach(b => {
      b.onclick = () => {
        document.querySelectorAll('.toolbar-btn[data-cat]').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this._filterCategory = b.dataset.cat;
        this._renderTable();
      };
    });
    document.getElementById('filter-search').oninput = e => { this._filterSearch = e.target.value.toLowerCase(); this._renderTable(); };
    document.getElementById('filter-contractor').onchange = e => { this._filterContractor = e.target.value; this._renderTable(); };

    await this._loadPending();
  },

  async _loadPending() {
    if (!API.enabled()) {
      document.getElementById('dashboard-table').innerHTML = `<div class="notice notice-warn">Apps Script URL이 설정되지 않았습니다. 설정 탭에서 입력하세요.</div>`;
      return;
    }
    Utils.showLoading('납부대기 로드 중...');
    const [p, d] = await Promise.all([API.readPending(), API.readProcessing()]);
    Utils.hideLoading();
    this._pending = p && p.ok ? (p.rows || []) : [];
    this._paid = d && d.ok ? (d.rows || []) : [];
    this._renderStats();
    this._renderContractorFilter();
    this._renderTable();
  },

  _renderStats() {
    const el = document.getElementById('dashboard-stats');
    if (!el) return;
    const pendingSum = this._pending.reduce((s, r) => s + Utils.calcTotal(r.g), 0);
    const doneCount = this._paid.filter(r => r.q).length;
    el.innerHTML = `
      <div class="stat-card">
        <div class="stat-label">📥 납부대기</div>
        <div class="stat-value accent">${this._pending.length}<span style="font-size:14px;color:var(--muted);"> 건</span></div>
        <div class="stat-hint">시공사 제출 · 관리자 검토 대기</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">💰 이번 청구합계</div>
        <div class="stat-value">${Utils.fmtMoney(pendingSum)}<span style="font-size:14px;color:var(--muted);"> 원</span></div>
        <div class="stat-hint">부가세 포함</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">✅ 납부완료</div>
        <div class="stat-value success">${doneCount}<span style="font-size:14px;color:var(--muted);"> 건</span></div>
        <div class="stat-hint">Q열 체크</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">📊 전체 납부내역</div>
        <div class="stat-value">${this._paid.length}<span style="font-size:14px;color:var(--muted);"> 건</span></div>
        <div class="stat-hint">누적 처리 건수</div>
      </div>
    `;
  },

  _renderContractorFilter() {
    const sel = document.getElementById('filter-contractor');
    if (!sel) return;
    const names = [...new Set(this._pending.map(r => r.a).filter(Boolean))].sort();
    const cur = sel.value;
    sel.innerHTML = `<option value="">전체 시공사</option>` + names.map(n => `<option value="${Utils.esc(n)}">${Utils.esc(n)}</option>`).join('');
    sel.value = cur;
  },

  _matchesCategory(row) {
    if (!this._filterCategory) return true;
    const label = row.c || '';
    const cat = APP.categories.find(c => c.label === label);
    return cat ? cat.id === this._filterCategory : this._filterCategory === 'env25';
  },

  _renderTable() {
    const el = document.getElementById('dashboard-table');
    if (!el) return;
    const filtered = this._pending.filter(r => {
      if (!this._matchesCategory(r)) return false;
      if (this._filterContractor && r.a !== this._filterContractor) return false;
      if (this._filterSearch) {
        const hay = `${r.a} ${r.b} ${r.d || ''} ${r.e || ''} ${r.j || ''}`.toLowerCase();
        if (!hay.includes(this._filterSearch)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      el.innerHTML = `<div class="table-wrap"><div class="empty-state"><div class="empty-state-icon">📭</div><div class="empty-state-title">납부 대기 항목이 없습니다</div><div class="empty-state-desc">시공사의 새 요청을 기다리고 있습니다.</div></div></div>`;
      return;
    }

    el.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>사업</th>
              <th>시공사</th>
              <th>프로젝트ID</th>
              <th>현장명</th>
              <th>도로명 주소</th>
              <th>용량</th>
              <th class="num">청구금액</th>
              <th>파일</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(r => this._rowHtml(r)).join('')}
          </tbody>
        </table>
      </div>
    `;
    // 클릭 → 검토 drawer 오픈
    el.querySelectorAll('tr.clickable').forEach(tr => {
      tr.onclick = e => {
        if (e.target.closest('.btn-file-preview')) return;
        const rn = Number(tr.dataset.row);
        const row = this._pending.find(x => x.rowNumber === rn);
        if (row) Review.open(row, () => this._loadPending());
      };
    });
  },

  _rowHtml(r) {
    const catLabel = r.c || Utils.categoryLabel(Utils.detectCategory(r.d));
    const catId = APP.categories.find(c => c.label === catLabel)?.id || Utils.detectCategory(r.d);
    const total = Utils.calcTotal(r.g);
    const hasApp = !!r.s;
    const hasFee = !!r.t;
    const fileCell = `
      <div style="display:flex;gap:4px;">
        ${hasApp ? `<button class="btn btn-ghost btn-sm btn-file-preview" onclick="Review.previewUrl(event, '${Utils.esc(r.s)}', '접수증')">📄 접수증</button>` : '<span class="muted" style="font-size:11px">없음</span>'}
        ${hasFee ? `<button class="btn btn-ghost btn-sm btn-file-preview" onclick="Review.previewUrl(event, '${Utils.esc(r.t)}', '고지서')">📄 고지서</button>` : ''}
      </div>`;
    return `
      <tr class="clickable" data-row="${r.rowNumber}">
        <td><span class="pill ${Utils.categoryPill(catId)}">${Utils.esc(catLabel)}</span></td>
        <td><strong>${Utils.esc(r.a || '-')}</strong></td>
        <td class="mono">${Utils.esc(r.b)}</td>
        <td>${Utils.esc(r.d || '-')}</td>
        <td class="muted">${Utils.esc(r.e || '-')}</td>
        <td>${Utils.esc(r.f)}</td>
        <td class="num"><strong>${Utils.fmtMoney(total)}</strong></td>
        <td>${fileCell}</td>
        <td><span class="btn btn-ghost btn-sm">검토 →</span></td>
      </tr>
    `;
  },

  // ══════════ 납부이력 ══════════
  async _renderHistory(root) {
    root.innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">납부 이력</div>
          <div class="page-desc">전체 납부내역 시트의 처리 완료 건들입니다.</div>
        </div>
        <div class="page-actions">
          <button id="btn-refresh-h" class="btn btn-ghost">🔄 새로고침</button>
        </div>
      </div>
      <div class="toolbar">
        <div class="toolbar-group grow">
          <input id="hist-search" class="toolbar-search" placeholder="🔎 검색" />
        </div>
        <div class="toolbar-group">
          <span class="muted" style="padding:0 6px;font-size:12px;">사업</span>
          <button class="toolbar-btn active" data-hcat="">전체</button>
          ${APP.categories.map(c => `<button class="toolbar-btn" data-hcat="${c.id}">${c.label}</button>`).join('')}
        </div>
      </div>
      <div id="hist-body"></div>
    `;
    document.getElementById('btn-refresh-h').onclick = () => this._loadHistory();
    document.getElementById('hist-search').oninput = e => { this._histSearch = e.target.value.toLowerCase(); this._renderHistoryTable(); };
    document.querySelectorAll('.toolbar-btn[data-hcat]').forEach(b => {
      b.onclick = () => {
        document.querySelectorAll('.toolbar-btn[data-hcat]').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this._histCat = b.dataset.hcat;
        this._renderHistoryTable();
      };
    });
    await this._loadHistory();
  },

  async _loadHistory() {
    if (!API.enabled()) return;
    Utils.showLoading('납부내역 로드 중...');
    const r = await API.readProcessing();
    Utils.hideLoading();
    this._paid = r && r.ok ? (r.rows || []).reverse() : [];
    this._renderHistoryTable();
  },

  _renderHistoryTable() {
    const el = document.getElementById('hist-body');
    if (!el) return;
    const rows = this._paid.filter(r => {
      if (this._histCat) {
        const cid = APP.categories.find(c => c.label === r.c)?.id;
        if (cid !== this._histCat) return false;
      }
      if (this._histSearch) {
        const hay = `${r.a} ${r.b} ${r.d || ''} ${r.e || ''}`.toLowerCase();
        if (!hay.includes(this._histSearch)) return false;
      }
      return true;
    });
    if (rows.length === 0) {
      el.innerHTML = `<div class="table-wrap"><div class="empty-state"><div class="empty-state-desc">항목이 없습니다.</div></div></div>`;
      return;
    }
    el.innerHTML = `
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>사업</th><th>시공사</th><th>프로젝트ID</th><th>현장명</th><th>용량</th><th class="num">청구금액</th><th>처리일</th><th>상태</th></tr></thead>
        <tbody>${rows.map(r => {
          const catLabel = r.c || '';
          const catId = APP.categories.find(c => c.label === catLabel)?.id || 'env25';
          return `<tr>
            <td><span class="pill ${Utils.categoryPill(catId)}">${Utils.esc(catLabel || '-')}</span></td>
            <td>${Utils.esc(r.a || '-')}</td>
            <td class="mono">${Utils.esc(r.b)}</td>
            <td>${Utils.esc(r.d || '-')}</td>
            <td>${Utils.esc(r.f)}</td>
            <td class="num">${Utils.fmtMoney(Utils.calcTotal(r.g))}</td>
            <td>${Utils.esc(r.p || '-')}</td>
            <td><span class="pill ${r.q ? 'pill-done' : 'pill-pending'}">${r.q ? '납부완료' : '처리예정'}</span></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    `;
  },

  // ══════════ 설정 ══════════
  _renderSettings(root) {
    const cfg = Store.getConfig();
    root.innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">설정</div>
          <div class="page-desc">Google 시트·드라이브·FLEX 연동 설정</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">☁️ Apps Script 백엔드</div>
        <div class="card-sub">배포된 웹앱 URL을 입력하세요. 아직 없다면 <code>apps-script/설치가이드.md</code> 참고.</div>
        <label class="field"><span>웹앱 URL</span>
          <input id="cfg-sync-url" type="text" placeholder="https://script.google.com/macros/s/.../exec" />
        </label>
        <div class="flex gap-8">
          <button id="btn-sync-test" class="btn">🔌 연결 테스트</button>
          <span id="sync-test-result" class="muted" style="align-self:center;"></span>
        </div>
      </div>

      <div class="card">
        <div class="card-title">📋 시트 설정</div>
        <div class="form-grid">
          <label class="field span-2"><span>납부내역 시트 URL</span><input id="cfg-proc-url" type="text" /></label>
          <label class="field"><span>GID</span><input id="cfg-proc-gid" type="text" /></label>
          <label class="field"><span>탭명</span><input id="cfg-proc-name" type="text" /></label>

          <label class="field span-2"><span>납부대기 시트 URL</span><input id="cfg-pend-url" type="text" /></label>
          <label class="field"><span>GID</span><input id="cfg-pend-gid" type="text" /></label>
          <label class="field"><span>탭명</span><input id="cfg-pend-name" type="text" /></label>

          <label class="field span-2"><span>중앙 프로젝트 시트 (PM) URL</span><input id="cfg-pm-url" type="text" /></label>
          <label class="field"><span>GID</span><input id="cfg-pm-gid" type="text" /></label>
          <label class="field"><span>탭명</span><input id="cfg-pm-name" type="text" placeholder="PM_영차영차new" /></label>
        </div>
        <div class="mt-16">
          <div class="card-sub">PM 시트 컬럼 매핑 (프로젝트ID로 매칭 후 아래 컬럼값들을 가져옵니다)</div>
          <div class="form-grid">
            <label class="field"><span>프로젝트ID</span><input id="cfg-pm-id" type="text" placeholder="B" /></label>
            <label class="field"><span>현장명</span><input id="cfg-pm-name-col" type="text" placeholder="D" /></label>
            <label class="field"><span>도로명주소</span><input id="cfg-pm-addr" type="text" placeholder="E" /></label>
            <label class="field"><span>사업구분</span><input id="cfg-pm-cat" type="text" placeholder="F" /></label>
            <label class="field"><span>대기번호</span><input id="cfg-pm-wait" type="text" placeholder="A" /></label>
            <label class="field"><span>계약합계</span><input id="cfg-pm-sum" type="text" placeholder="X" /></label>
            <label class="field"><span>시공사</span><input id="cfg-pm-contractor" type="text" placeholder="I" /></label>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">📂 G드라이브 저장 폴더</div>
        <div class="card-sub">확인완료 시 접수증/고지서 파일이 저장될 폴더 (URL 또는 폴더ID)</div>
        <label class="field"><span>폴더 URL 또는 ID</span><input id="cfg-folder" type="text" placeholder="https://drive.google.com/drive/folders/..." /></label>
        <div class="flex gap-8">
          <button id="btn-folder-test" class="btn">🔌 폴더 접근 테스트</button>
          <span id="folder-test-result" class="muted" style="align-self:center;"></span>
        </div>
      </div>

      <div class="card">
        <div class="card-title">📝 FLEX 연동 (지출결의서 자동화)</div>
        <div class="card-sub">확인완료 시 FLEX로 지출결의서 요청을 보냅니다. 아직 개발 중입니다.</div>
        <label class="field"><span>FLEX API 엔드포인트 (선택)</span><input id="cfg-flex-endpoint" type="text" placeholder="https://api.flex.team/..." /></label>
        <label class="flex gap-8 mt-8"><input id="cfg-flex-enabled" type="checkbox" /> <span>FLEX 연동 활성화</span></label>
        <div class="notice notice-info mt-16">💡 실제 FLEX API 연동은 다음 릴리즈에서 추가됩니다. 지금은 UI만 준비되어 있습니다.</div>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;">
        <span id="save-result" class="muted" style="align-self:center;"></span>
        <button id="btn-save-cfg" class="btn btn-primary btn-lg">💾 설정 저장</button>
      </div>
    `;

    // 값 채우기
    document.getElementById('cfg-sync-url').value = API.getUrl();
    document.getElementById('cfg-proc-url').value = cfg.processingSheetUrl;
    document.getElementById('cfg-proc-gid').value = cfg.processingSheetGid;
    document.getElementById('cfg-proc-name').value = cfg.processingSheetName;
    document.getElementById('cfg-pend-url').value = cfg.pendingSheetUrl;
    document.getElementById('cfg-pend-gid').value = cfg.pendingSheetGid;
    document.getElementById('cfg-pend-name').value = cfg.pendingSheetName;
    document.getElementById('cfg-pm-url').value = cfg.centralProjectSheetUrl;
    document.getElementById('cfg-pm-gid').value = cfg.centralProjectSheetGid;
    document.getElementById('cfg-pm-name').value = cfg.centralProjectSheetName;
    document.getElementById('cfg-pm-id').value = cfg.centralIdCol || 'B';
    document.getElementById('cfg-pm-name-col').value = cfg.pmSiteNameCol;
    document.getElementById('cfg-pm-addr').value = cfg.pmAddressCol;
    document.getElementById('cfg-pm-cat').value = cfg.pmCategoryCol;
    document.getElementById('cfg-pm-wait').value = cfg.pmWaitingNumCol;
    document.getElementById('cfg-pm-sum').value = cfg.pmContractSumCol;
    document.getElementById('cfg-pm-contractor').value = cfg.pmContractorCol;
    document.getElementById('cfg-folder').value = cfg.processedFolderUrl;
    document.getElementById('cfg-flex-endpoint').value = cfg.flexEndpoint;
    document.getElementById('cfg-flex-enabled').checked = !!cfg.flexEnabled;

    document.getElementById('btn-sync-test').onclick = async () => {
      const url = document.getElementById('cfg-sync-url').value.trim();
      if (url) API.setUrl(url);
      const r = await API.ping();
      document.getElementById('sync-test-result').innerHTML = r && r.ok
        ? `<span style="color:var(--success)">✓ 연결 성공 (v${r.version || '?'})</span>`
        : `<span style="color:var(--danger)">✗ 실패: ${r && r.error || ''}</span>`;
    };
    document.getElementById('btn-folder-test').onclick = async () => {
      const raw = document.getElementById('cfg-folder').value.trim();
      const id = this._extractFolderId(raw);
      if (!id) { document.getElementById('folder-test-result').innerHTML = `<span style="color:var(--danger)">폴더 ID 추출 실패</span>`; return; }
      const r = await API.checkFolderAccess(id);
      document.getElementById('folder-test-result').innerHTML = r && r.ok
        ? `<span style="color:var(--success)">✓ ${Utils.esc(r.name)}</span>`
        : `<span style="color:var(--danger)">✗ ${r && r.error || ''}</span>`;
    };
    document.getElementById('btn-save-cfg').onclick = () => this._saveSettings();
  },

  _extractFolderId(input) {
    if (!input) return '';
    const m = String(input).match(/[?&\/]folders\/([a-zA-Z0-9-_]+)/);
    if (m) return m[1];
    if (/^[a-zA-Z0-9-_]{20,}$/.test(input.trim())) return input.trim();
    return '';
  },

  async _saveSettings() {
    const $ = id => document.getElementById(id);
    API.setUrl($('cfg-sync-url').value.trim());
    const folderRaw = $('cfg-folder').value.trim();
    const cfg = Store.patchConfig({
      processingSheetUrl: $('cfg-proc-url').value.trim(),
      processingSheetGid: $('cfg-proc-gid').value.trim(),
      processingSheetName: $('cfg-proc-name').value.trim(),
      pendingSheetUrl: $('cfg-pend-url').value.trim(),
      pendingSheetGid: $('cfg-pend-gid').value.trim(),
      pendingSheetName: $('cfg-pend-name').value.trim(),
      centralProjectSheetUrl: $('cfg-pm-url').value.trim(),
      centralProjectSheetGid: $('cfg-pm-gid').value.trim(),
      centralProjectSheetName: $('cfg-pm-name').value.trim(),
      centralIdCol: ($('cfg-pm-id').value.trim() || 'B').toUpperCase(),
      pmSiteNameCol: ($('cfg-pm-name-col').value.trim() || 'D').toUpperCase(),
      pmAddressCol: ($('cfg-pm-addr').value.trim() || 'E').toUpperCase(),
      pmCategoryCol: ($('cfg-pm-cat').value.trim() || 'F').toUpperCase(),
      pmWaitingNumCol: ($('cfg-pm-wait').value.trim() || 'A').toUpperCase(),
      pmContractSumCol: ($('cfg-pm-sum').value.trim() || 'X').toUpperCase(),
      pmContractorCol: ($('cfg-pm-contractor').value.trim() || 'I').toUpperCase(),
      processedFolderUrl: folderRaw,
      processedFolderId: this._extractFolderId(folderRaw),
      flexEndpoint: $('cfg-flex-endpoint').value.trim(),
      flexEnabled: $('cfg-flex-enabled').checked,
    });

    // 서버에도 시트 설정 저장 (시공사 조회용)
    if (API.enabled()) {
      if (cfg.processingSheetUrl) API.setProcessingSheetConfig(cfg.processingSheetUrl, cfg.processingSheetGid, cfg.processingSheetName);
      if (cfg.pendingSheetUrl) API.setPendingSheetConfig(cfg.pendingSheetUrl, cfg.pendingSheetGid, cfg.pendingSheetName);
    }

    const el = document.getElementById('save-result');
    el.innerHTML = `<span style="color:var(--success)">✓ 저장되었습니다.</span>`;
    setTimeout(() => { el.innerHTML = ''; }, 3000);
  },
};
