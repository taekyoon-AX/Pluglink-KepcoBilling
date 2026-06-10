// ============================================================
// Admin View Logic
// ============================================================

const AdminView = {
  // ---- Q열 상태 캐시 ----
  _qStatusMap: {},   // projectId → true (Q=체크됨=처리완료)
  _sheetRowMap: {},  // projectId → rowNumber[] (납부내역 시트 행 번호)
  _totalSheetCount: 0, // 납부내역 시트 B열 총 건수 (전체 제출 stat)
  _dashboardPendingRows: null, // 납부대기 시트 행 캐시 (대시보드 데이터 소스)

  async init() {
    const auth = Auth.current();
    document.getElementById('admin-user').textContent = auth ? auth.name : '';

    // 서버 모드면 계정 목록을 서버에서 갱신
    if (Sync.enabled()) {
      const r = await Sync.listAccounts();
      if (r.ok) Storage.setServerAccounts(r.accounts);
    }

    // 탭 바인딩
    document.querySelectorAll('#view-admin .tab').forEach(btn => {
      btn.onclick = () => this.switchTab(btn.dataset.tab);
    });

    // 액션 바인딩
    document.getElementById('btn-admin-logout').onclick = () => App.logout();
    const refreshDashBtn = document.getElementById('btn-refresh-dashboard');
    if (refreshDashBtn) refreshDashBtn.onclick = () => this._refreshDashboardData();
    document.getElementById('btn-export-excel').onclick = () => this.exportExcel();
    document.getElementById('btn-export-zip').onclick = () => this.exportZip();
    document.getElementById('btn-split-transfer').onclick = () => this.openSplitModal();
    document.getElementById('split-modal-close').onclick = () => this.closeSplitModal();
    document.getElementById('btn-split-analyze').onclick = () => this.analyzeSplitPdf();
    document.getElementById('btn-refresh-payment-history').onclick = () => this.loadPaymentHistory();
    document.getElementById('payment-edit-close').onclick = () => this.closePaymentEditModal();
    document.getElementById('btn-payment-edit-cancel').onclick = () => this.closePaymentEditModal();
    document.getElementById('btn-payment-edit-save').onclick = () => this.savePaymentEdit();
    document.getElementById('btn-save-settings').onclick = () => this.saveSettings();
    document.getElementById('btn-reset-all').onclick = () => this.resetAll();
    document.getElementById('btn-sync-test').onclick = () => this.syncTest();
    document.getElementById('btn-sync-pull').onclick = () => this.syncPull();
    document.getElementById('btn-sync-push-all').onclick = () => this.syncPushAll();
    document.getElementById('btn-central-test').onclick = () => this.centralSheetTest();
    const billingRefTestBtn = document.getElementById('btn-billingref-test');
    if (billingRefTestBtn) billingRefTestBtn.onclick = () => this.billingRefTest();
    document.getElementById('btn-folder-test').onclick = () => this.folderAccessTest();
    document.getElementById('btn-select-local-folder').onclick = () => this.selectLocalFolder();
    document.getElementById('btn-clear-local-folder').onclick = () => this.clearLocalFolder();

    // 저장된 로컬 폴더명 표시
    LocalFolderDB.getName().then(name => {
      const el = document.getElementById('local-folder-status');
      if (el) el.innerHTML = name
        ? `<span style="color:var(--success)">✓ ${name}</span>`
        : '미선택';
    });
    document.getElementById('btn-add-contractor').onclick = () => this.addContractor();

    document.getElementById('filter-contractor').onchange = () => this.renderDashboard();
    document.getElementById('filter-status').onchange = () => this.renderDashboard();
    document.getElementById('filter-search').oninput = () => this.renderDashboard();

    // 배치 액션 버튼 바인딩
    const batchConfirmBtn = document.getElementById('btn-batch-confirm');
    if (batchConfirmBtn) batchConfirmBtn.onclick = () => this.actionBatchConfirm();
    const batchPaidBtn = document.getElementById('btn-batch-paid');
    if (batchPaidBtn) batchPaidBtn.onclick = () => this.actionBatchMarkPaid();
    const chkAll = document.getElementById('chk-all');
    if (chkAll) chkAll.onchange = (e) => this._toggleAllChecks(e.target.checked);

    this.renderDashboard();
    this.renderSettings();

    // 초기 데이터: 시공사 제출 동기화 + 납부대기 + Q열 상태 비동기 로드
    const initTasks = [
      this.loadDashboardPending(),
      this.loadQStatus(),
    ];
    if (Sync.enabled()) initTasks.push(Sync.pull().catch(e => console.warn('초기 Sync.pull 실패:', e)));
    Promise.all(initTasks).then(() => this.renderDashboard()).catch(e => console.warn('대시보드 초기 로드 실패:', e));

    // 자동 엑셀 출력 체크
    this.checkAutoExcelExport();
  },

  switchTab(tab) {
    document.querySelectorAll('#view-admin .tab').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    document.querySelectorAll('#view-admin .panel').forEach(p => {
      p.classList.toggle('active', p.id === `panel-${tab}`);
    });
    // 납부 이력 탭 전환 시 자동 로드
    if (tab === 'projects') this.loadPaymentHistory();
    // 대시보드 탭 전환 시 납부대기 + Q 상태 새로고침
    if (tab === 'dashboard') {
      this.renderDashboard(); // 캐시 상태로 즉시 렌더
      this._refreshDashboardData().catch(() => {});
    }
  },

  // ---------- 대시보드 ----------

  /** 납부대기 시트 로드 (대시보드 데이터 소스) */
  async loadDashboardPending() {
    if (!Sync.enabled()) {
      this._dashboardPendingRows = [];
      return;
    }
    const r = await Sync.readPendingRows('', '', '');
    if (r.ok) {
      this._dashboardPendingRows = r.rows || [];
    } else {
      this._dashboardPendingRows = [];
      console.warn('납부대기 로드 실패:', r.error);
    }
  },

  /** 납부대기 행과 매칭되는 내부 submission 찾기 (파일 참조용) */
  _findMatchingSub(row) {
    const submissions = Storage.getSubmissions();
    return submissions.find(s => {
      if (s.contractor !== row.a) return false;
      if (String(s.projectId) !== String(row.b)) return false;
      const parsed = Utils.parseProjectName(s.projectName || '');
      const cleanName = parsed.name || s.projectName || '';
      const locSuffix = s.location ? `-${s.location}` : '';
      return (cleanName + locSuffix) === row.e;
    });
  },

  renderDashboard() {
    const config = Storage.getConfig();
    const pendingRows = this._dashboardPendingRows || [];

    // 정보 바
    document.getElementById('info-deadline').textContent =
      Utils.describeDate(Utils.getCurrentDeadline(config)) + ' ' + config.deadlineTime;
    document.getElementById('info-process').textContent =
      Utils.describeDate(Utils.getCurrentProcessDate(config));
    document.getElementById('info-excel').textContent =
      Utils.describeDate(Utils.getNextExcelExportDate(config)) + ' ' + config.excelTime;

    // 시공사 필터 옵션: 납부대기 행에 등장하는 시공사들
    const contractorSelect = document.getElementById('filter-contractor');
    const currentVal = contractorSelect.value;
    const contractorSet = new Set(pendingRows.map(r => r.a).filter(Boolean));
    const contractorList = [...contractorSet].sort();
    contractorSelect.innerHTML = '<option value="">전체 시공사</option>' +
      contractorList.map(c => `<option value="${this._esc(c)}">${this._esc(c)}</option>`).join('');
    contractorSelect.value = currentVal;

    // 필터 적용
    const fContractor = document.getElementById('filter-contractor').value;
    const fSearch = document.getElementById('filter-search').value.trim().toLowerCase();

    const filtered = pendingRows.filter(row => {
      if (fContractor && row.a !== fContractor) return false;
      if (fSearch) {
        const hay = `${row.b} ${row.e} ${row.j} ${row.a}`.toLowerCase();
        if (!hay.includes(fSearch)) return false;
      }
      return true;
    });

    // 통계
    const parseFee = v => Number(String(v || '').replace(/[^0-9.-]/g, '')) || 0;
    const pendingAmount = pendingRows.reduce((sum, r) => {
      const fee = parseFee(r.g);
      return sum + fee + Math.round(fee * 0.1);
    }, 0);
    // 처리완료: 납부내역 Q=TRUE 실제 행 수
    const doneCount = this._doneRowCount || 0;
    const totalCount = this._totalSheetCount > 0 ? this._totalSheetCount : pendingRows.length;

    document.getElementById('stat-row').innerHTML = `
      <div class="stat"><div class="label">전체 제출</div><div class="value">${totalCount}건</div></div>
      <div class="stat warning"><div class="label">처리예정</div><div class="value">${pendingRows.length}건</div></div>
      <div class="stat success"><div class="label">처리완료</div><div class="value">${doneCount}건</div></div>
      <div class="stat primary"><div class="label">금주 청구금액</div><div class="value">${Utils.formatMoney(pendingAmount)}</div></div>
    `;

    const tbody = document.getElementById('admin-tbody');
    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="18" style="text-align:center;padding:40px;color:var(--muted);">납부대기 항목이 없습니다.</td></tr>`;
      return;
    }

    // projectId 그룹화 (다중 거점 배지)
    const groupMap = {};
    filtered.forEach(row => {
      const k = `${row.a}|${row.b}`;
      if (!groupMap[k]) groupMap[k] = [];
      groupMap[k].push(row);
    });

    // 각 행을 내부 sub 와 매칭 (파일 표시용)
    const display = filtered.map(row => ({ row, sub: this._findMatchingSub(row) }));

    tbody.innerHTML = display.map(({ row, sub }) => {
      const baseFee = parseFee(row.g);
      const vat = Math.round(baseFee * 0.1);
      const total = baseFee + vat;

      // 프로젝트명 표시: 매칭된 sub 가 있으면 차수 포함, 없으면 시트 E값
      let displayName = row.e || '-';
      if (sub) {
        const parsed = Utils.parseProjectName(sub.projectName || '');
        displayName = parsed.round
          ? `${parsed.name}_${parsed.round}차`
          : (parsed.name || sub.projectName || row.e);
      }

      const groupKey = `${row.a}|${row.b}`;
      const groupSize = (groupMap[groupKey] || []).length;
      const myIdx = (groupMap[groupKey] || []).indexOf(row) + 1;
      const groupBadge = groupSize > 1
        ? ` <span class="loc-badge" title="같은 프로젝트 ${groupSize}개 거점 중 ${myIdx}번째">${myIdx}/${groupSize}거점</span>`
        : '';

      // 파일 셀 (sub 가 있으면 표시, 없으면 미연동)
      const noFileCell = '<span class="file-missing">미연동</span>';
      let appRcptCell, feeNoticeCell;
      if (sub) {
        const hasAppRcpt = sub.files && (sub.files.applicationReceipt || sub.files.applicationReceiptUrl);
        if (hasAppRcpt) {
          appRcptCell = this.fileCell(sub, 'applicationReceipt');
        } else {
          // 같은 프로젝트의 다른 거점 sub에서 접수증 공유 탐색
          const sameProjSub = (groupMap[groupKey] || [])
            .map(r => this._findMatchingSub(r))
            .filter(Boolean)
            .find(s => s.files && (s.files.applicationReceipt || s.files.applicationReceiptUrl));
          if (sameProjSub) {
            appRcptCell = this.fileCell({ files: sameProjSub.files }, 'applicationReceipt') + ' <span class="muted" style="font-size:10px">(공유)</span>';
          } else {
            appRcptCell = '<span class="file-missing">없음</span>';
          }
        }
        feeNoticeCell = this.fileCell(sub, 'feeNotice');
      } else {
        appRcptCell = feeNoticeCell = noFileCell;
      }

      const rowKey = String(row.rowNumber);
      const submitDate = sub ? Utils.toYMD(new Date(sub.submittedAt)) : '-';
      const scheduledDate = sub ? Utils.describeDate(sub.scheduledProcessDate) : '-';
      const customer = row.j ? Utils.formatCustomerNumber(row.j) : '-';
      const account = row.l ? Utils.formatAccountNumber(row.l) : '-';

      // 비고 셀: 시트 R열 (sub 도 있으면 sub.notes 와 동기화되지만, 시트값이 최신)
      const noteText = row.r || '';
      const noteDisplay = noteText
        ? (noteText.length > 12 ? this._esc(noteText.slice(0, 12)) + '…' : this._esc(noteText))
        : '✏️ 추가';

      // 액션: 행 번호 기반 (rowNumber 가 시트 식별자)
      // 내부 sub 가 매칭되면 그 id 도 같이 전달 (파일 처리 위해)
      const subIdAttr = sub ? `data-sub-id="${this._esc(sub.id)}"` : '';

      return `
        <tr data-row="${rowKey}" ${subIdAttr}>
          <td style="text-align:center"><input type="checkbox" class="row-check" data-row="${rowKey}"></td>
          <td>${submitDate}</td>
          <td>${this._esc(row.a)}</td>
          <td><code>${this._esc(row.b)}</code>${groupBadge}</td>
          <td>${this._esc(displayName)}</td>
          <td>${this._esc(row.f) || '-'}</td>
          <td>${customer}</td>
          <td>${this._esc(row.k) || '-'}</td>
          <td>${account}</td>
          <td class="num">${Utils.formatMoneyRaw(baseFee)}</td>
          <td class="num">${Utils.formatMoneyRaw(vat)}</td>
          <td class="num"><strong>${Utils.formatMoneyRaw(total)}</strong></td>
          <td title="${this._esc(noteText)}" style="cursor:pointer;color:${noteText ? 'var(--primary)' : 'var(--muted)'}"
              onclick="AdminView.actionEditPendingNote(${rowKey})">${noteDisplay}</td>
          <td>${appRcptCell}</td>
          <td>${feeNoticeCell}</td>
          <td>${scheduledDate}</td>
          <td><span class="status-pill status-처리예정">처리예정</span></td>
          <td>
            <button class="small" onclick="AdminView.actionConfirmFromRow(${rowKey})">확인완료</button>
            <button class="small btn-paid" onclick="AdminView.actionMarkPaidFromRow(${rowKey})">납부 완료</button>
            <button class="small" onclick="AdminView.actionDeleteFromRow(${rowKey})">삭제</button>
          </td>
        </tr>
      `;
    }).join('');
  },

  // ================== 이체증 일괄 분리 ==================
  openSplitModal() {
    document.getElementById('split-pdf-input').value = '';
    document.getElementById('split-result').innerHTML = '';
    document.getElementById('split-status').textContent = '';
    document.getElementById('split-modal-overlay').classList.add('active');
  },

  closeSplitModal() {
    document.getElementById('split-modal-overlay').classList.remove('active');
    this._splitGroups = null;
    this._splitPdfBytes = null;
  },

  async analyzeSplitPdf() {
    const input = document.getElementById('split-pdf-input');
    const file = input.files && input.files[0];
    const status = document.getElementById('split-status');
    const result = document.getElementById('split-result');
    if (!file) { alert('PDF 파일을 선택하세요.'); return; }
    if (!window.pdfjsLib) { alert('PDF.js 로드 실패. 새로고침 후 재시도하세요.'); return; }

    status.textContent = '⏳ PDF 분석 중...';
    result.innerHTML = '';

    try {
      const ab = await file.arrayBuffer();
      this._splitPdfBytes = ab.slice(0); // pdf-lib 용 보존

      // PDF.js 로 페이지별 텍스트 추출
      const loadingTask = pdfjsLib.getDocument({ data: ab.slice(0) });
      const pdf = await loadingTask.promise;
      const pageCount = pdf.numPages;

      const pageInfos = [];
      for (let p = 1; p <= pageCount; p++) {
        status.textContent = `⏳ 페이지 분석 ${p}/${pageCount}...`;
        const page = await pdf.getPage(p);
        const tc = await page.getTextContent();

        // 좌표 기반 라인 그룹핑: 같은 y(±2pt) 같은 줄로 묶고 x 순 정렬
        const lineMap = {};
        let dateVal = '';
        for (const it of tc.items) {
          const x = it.transform[4];
          const y = it.transform[5];
          const t = (it.str || '');
          if (!t) continue;
          // 날짜 (YYYY.MM.DD) — 페이지 어디에든
          const tt = t.trim();
          if (!dateVal && /^\d{4}\.\d{2}\.\d{2}$/.test(tt)) dateVal = tt;
          // y를 2pt 단위로 묶음
          const yKey = Math.round(y / 2) * 2;
          if (!lineMap[yKey]) lineMap[yKey] = [];
          lineMap[yKey].push({ x, str: t });
        }

        // 라인별 텍스트 (x 순 정렬 후 그대로 이어붙임 — 좌표가 인접하면 공백 없이)
        const lines = Object.values(lineMap).map(arr => {
          arr.sort((a, b) => a.x - b.x);
          let s = '';
          let lastX = -Infinity;
          for (const o of arr) {
            // 좌표 간격이 크면 공백 추가
            if (lastX !== -Infinity && o.x - lastX > 5) s += ' ';
            s += o.str;
            lastX = o.x + (o.str.length * 5); // 대략적
          }
          return s.trim();
        }).filter(Boolean);

        // 5자리 + 한글 현장명 패턴 — 라인별로 검색
        let projNum = '', memo = '';
        const matchPatterns = [
          /(\d{5})\s*([가-힣][가-힣A-Za-z0-9_\s\(\)\-\.]{1,40})/,
          /([가-힣][가-힣A-Za-z0-9_\s\(\)\-\.]{1,30})\s*(\d{5})/, // 한글 + 숫자 순서
        ];
        for (const line of lines) {
          for (const pattern of matchPatterns) {
            const m = line.match(pattern);
            if (m) {
              // 패턴에 따라 그룹 위치가 다름
              if (/^\d/.test(m[1])) { projNum = m[1]; memo = (m[2] || '').trim(); }
              else { projNum = m[2]; memo = (m[1] || '').trim(); }
              break;
            }
          }
          if (projNum) break;
        }

        // fallback: 페이지 전체 텍스트에서 공백 무시하고 5자리 + 한글
        if (!projNum) {
          const compact = lines.join(' ').replace(/\s+/g, '');
          const m = compact.match(/(\d{5})([가-힣]{2,20})/);
          if (m) { projNum = m[1]; memo = m[2]; }
        }

        pageInfos.push({
          page: p, projNum, dateVal, memo,
          fullText: lines.join(' | ').slice(0, 250),
        });
      }

      // 프로젝트별 그룹핑
      const groups = {};
      pageInfos.forEach(pi => {
        const key = pi.projNum || '_UNKNOWN';
        if (!groups[key]) groups[key] = [];
        groups[key].push(pi);
      });

      // 중앙 시트(PM_영차영차new) 에서 검출된 프로젝트번호 정보 lookup
      const cfg = Storage.getConfig();
      const projNums = Object.keys(groups).filter(k => k !== '_UNKNOWN');
      let centralLookup = {};
      if (projNums.length > 0 && Sync.enabled() && cfg.centralProjectSheetUrl) {
        status.textContent = `⏳ 중앙 시트 검증 (${projNums.length}개)...`;
        // 컬럼: G=프로젝트명(7번열), I=시공사(9번열), H=주소(8번열)
        const r = await Sync.lookupCentralColumns(
          cfg.centralProjectSheetUrl,
          cfg.centralProjectSheetGid,
          cfg.centralProjectSheetName,
          projNums,
          ['G', 'H', 'I'],
        );
        if (r.ok) centralLookup = r.map || {};
      }

      // 시공사 제출 데이터와 매칭
      const submissions = Storage.getSubmissions();
      const subsByProj = {};
      submissions.forEach(s => {
        if (!subsByProj[s.projectId]) subsByProj[s.projectId] = [];
        subsByProj[s.projectId].push(s);
      });

      // 결과 표시
      this._splitGroups = groups;
      const tbl = [];
      tbl.push(`<table class="data-table compact"><thead><tr>
        <th>프로젝트번호</th><th>페이지</th><th>날짜</th><th>거래메모(PDF)</th><th>중앙시트 검증</th><th>매칭 제출</th><th>처리</th>
      </tr></thead><tbody>`);

      Object.entries(groups).forEach(([proj, list]) => {
        const matchedSubs = subsByProj[proj] || [];
        const matchInfo = matchedSubs.length > 0
          ? matchedSubs.map(s => `${s.contractor} (${s.location || '-'})`).join('<br>')
          : '<span style="color:var(--muted)">없음</span>';

        // 중앙 시트 검증
        const central = centralLookup[proj];
        let verifyCell;
        if (proj === '_UNKNOWN') {
          verifyCell = '<span style="color:var(--muted)">-</span>';
        } else if (central) {
          const centralName = String(central.G || '').trim();
          const centralContractor = String(central.I || '').trim();
          verifyCell = `<span style="color:var(--success)">✓ ${centralName}</span>` +
            (centralContractor ? `<br><span class="muted">시공사: ${centralContractor}</span>` : '');
        } else {
          verifyCell = '<span style="color:var(--danger)">중앙시트 미발견</span>';
        }

        // 처리 가능 여부
        let action;
        if (proj === '_UNKNOWN') {
          action = '<span style="color:var(--muted)">스킵</span>';
        } else if (matchedSubs.length > 0) {
          action = `<span style="color:var(--success)">분배 대상 (${matchedSubs.length}건)</span>`;
        } else if (central) {
          action = '<span style="color:var(--warning)">시공사 미제출</span>';
        } else {
          action = '<span style="color:var(--danger)">중앙시트 미발견</span>';
        }

        tbl.push(`<tr>
          <td><strong>${proj}</strong></td>
          <td>${list.map(p => p.page).join(', ')} (${list.length}p)</td>
          <td>${list[0].dateVal || '-'}</td>
          <td title="${(list[0].fullText || '').replace(/"/g, '&quot;')}">${list[0].memo || '-'}</td>
          <td>${verifyCell}</td>
          <td>${matchInfo}</td>
          <td>${action}</td>
        </tr>`);
      });
      tbl.push('</tbody></table>');

      const distributable = Object.entries(groups).filter(([proj]) => proj !== '_UNKNOWN' && subsByProj[proj]);
      const distributableCount = distributable.length;
      const verifiedCount = Object.keys(groups).filter(k => k !== '_UNKNOWN' && centralLookup[k]).length;

      result.innerHTML = `
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:10px;margin-bottom:12px">
          📄 총 <strong>${pageCount}페이지</strong>
          · 검출 프로젝트 <strong>${Object.keys(groups).length}개</strong>
          · 중앙시트 검증 <strong>${verifiedCount}건</strong>
          · 자동 분배 가능 <strong>${distributableCount}건</strong>
        </div>
        ${tbl.join('')}
        <div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end">
          <button id="btn-split-confirm" class="primary strong" ${distributableCount === 0 ? 'disabled' : ''}>
            📁 ${distributableCount}건 이체증 폴더 분배 (상태 변경 없음)
          </button>
          <button id="btn-split-cancel">취소</button>
        </div>
      `;
      status.textContent = '';

      document.getElementById('btn-split-confirm').onclick = () => this.confirmSplitDistribute();
      document.getElementById('btn-split-cancel').onclick = () => this.closeSplitModal();
    } catch (e) {
      status.innerHTML = `<span style="color:var(--danger)">분석 실패: ${e.message}</span>`;
      console.error(e);
    }
  },

  /**
   * 이체증 일괄 분리 — PDF 페이지를 각 프로젝트 폴더에 분배만 함
   * 상태 변경 없음, 납부내역 시트 기록 없음
   */
  async confirmSplitDistribute() {
    const statusEl = document.getElementById('split-status');
    const groups = this._splitGroups;
    const pdfBytes = this._splitPdfBytes;
    if (!groups || !pdfBytes) return;

    const cfg = Storage.getConfig();
    const driveConfigured = !!(Sync.enabled() && cfg.processedFolderId);

    // 로컬 폴더 핸들 (있으면 가져옴)
    let localHandle = null;
    try { localHandle = await this.getLocalFolderHandle(); } catch (e) { localHandle = null; }
    const localConfigured = !!localHandle;

    if (!driveConfigured && !localConfigured) {
      alert('처리완료 폴더가 설정되지 않았습니다.\nDrive 폴더 또는 PC 로컬 폴더를 설정해주세요.');
      return;
    }

    const submissions = Storage.getSubmissions();
    const subsByProj = {};
    submissions.forEach(s => {
      if (!subsByProj[s.projectId]) subsByProj[s.projectId] = [];
      subsByProj[s.projectId].push(s);
    });

    const distributable = Object.entries(groups).filter(([proj]) => proj !== '_UNKNOWN' && subsByProj[proj]);
    if (distributable.length === 0) {
      alert('분배할 프로젝트가 없습니다.');
      return;
    }

    const targets = [];
    if (driveConfigured) targets.push('☁️ Drive');
    if (localConfigured) targets.push('💻 PC 로컬');
    if (!confirm(`${distributable.length}개 프로젝트 폴더(${targets.join(' + ')})에 이체증 파일을 분배합니다.\n상태는 변경되지 않습니다. 계속하시겠습니까?`)) return;

    const { PDFDocument } = window.PDFLib;
    const srcDoc = await PDFDocument.load(pdfBytes);

    statusEl.textContent = '⏳ 분배 중...';
    let driveOk = 0, driveFail = 0, localOk = 0, localFail = 0;
    const errors = [];

    for (const [proj, pages] of Object.entries(groups)) {
      if (proj === '_UNKNOWN') continue;
      const targetSubs = subsByProj[proj];
      if (!targetSubs || targetSubs.length === 0) continue;

      let newPdfBytes;
      let folderName, fileName;
      try {
        // 해당 프로젝트 페이지들 추출
        const newDoc = await PDFDocument.create();
        const pageIdxs = pages.map(p => p.page - 1);
        const copied = await newDoc.copyPages(srcDoc, pageIdxs);
        copied.forEach(p => newDoc.addPage(p));
        newPdfBytes = await newDoc.save();

        // 폴더명 / 파일명 결정 (copyToProcessedFolder 와 동일한 로직)
        const groupSize = targetSubs.length;
        const rep = { ...targetSubs[0] };
        rep.location = groupSize > 1 ? `${groupSize}거점` : '';
        folderName = Utils.getProjectIdent(rep);
        const today = new Date();
        const dateStr = Utils.toYMD(today).replace(/-/g, '');
        fileName = `이체증_${proj}_${dateStr}.pdf`;
      } catch (e) {
        errors.push(`${proj} (PDF 추출): ${e.message}`);
        console.error('Split PDF extract error', proj, e);
        continue;
      }

      // ── Drive 저장 ──
      if (driveConfigured) {
        try {
          const r = await Sync.copyToProcessedFolder(cfg.processedFolderId, folderName, [{
            base64: this._arrayBufferToBase64(newPdfBytes),
            mimeType: 'application/pdf',
            name: fileName,
          }]);
          const okFile = r.ok && r.results && r.results[0] && r.results[0].ok;
          if (okFile) driveOk++;
          else {
            driveFail++;
            const errMsg = r.error || (r.results && r.results[0] && r.results[0].error) || 'unknown';
            errors.push(`Drive[${proj}]: ${errMsg}`);
          }
        } catch (e) {
          driveFail++;
          errors.push(`Drive[${proj}]: ${e.message}`);
        }
      }

      // ── PC 로컬 저장 ──
      if (localConfigured) {
        try {
          const projHandle = await localHandle.getDirectoryHandle(folderName, { create: true });
          const fh = await projHandle.getFileHandle(fileName, { create: true });
          const writable = await fh.createWritable();
          await writable.write(newPdfBytes);
          await writable.close();
          localOk++;
        } catch (e) {
          localFail++;
          errors.push(`Local[${proj}]: ${e.message}`);
          console.warn('Split local write error', proj, e);
        }
      }
    }

    statusEl.textContent = '';
    const lines = [];
    if (driveConfigured) lines.push(`☁️ Drive: ${driveOk}개 저장${driveFail ? ` (실패 ${driveFail})` : ''}`);
    if (localConfigured) lines.push(`💻 PC 로컬: ${localOk}개 저장${localFail ? ` (실패 ${localFail})` : ''}`);
    alert(`✓ 이체증 분배 완료\n\n${lines.join('\n')}${errors.length > 0 ? '\n\n오류 (최대 5건):\n' + errors.slice(0, 5).join('\n') : ''}`);
    this.closeSplitModal();
    // 상태 미변경이므로 대시보드 재렌더 불필요 (선택적)
  },

  // ============ Q열 상태 관리 ============

  /**
   * 납부내역 시트에서 Q열(완료확인) 상태 로드 → _qStatusMap, _sheetRowMap 갱신
   */
  async loadQStatus() {
    if (!Sync.enabled()) return;
    const cfg = Storage.getConfig();
    if (!cfg.processingSheetUrl) return;
    try {
      const r = await Sync.readProcessingRows(cfg.processingSheetUrl, cfg.processingSheetGid, cfg.processingSheetName);
      if (!r.ok) return;
      this._qStatusMap = {};
      this._sheetRowMap = {};
      this._totalSheetCount = r.total || 0;
      let doneRowCount = 0;
      (r.rows || []).forEach(row => {
        const pid = String(row.b || '').trim();
        if (!pid) return;
        if (row.q) {
          this._qStatusMap[pid] = true;
          doneRowCount++; // 실제 Q=TRUE 행 수
        }
        if (!this._sheetRowMap[pid]) this._sheetRowMap[pid] = [];
        this._sheetRowMap[pid].push(row.rowNumber);
      });
      this._doneRowCount = doneRowCount;
    } catch (e) {
      console.warn('Q 상태 로드 실패:', e);
    }
  },

  /**
   * 제출 건의 실제 상태 반환
   * - Q열 체크 → 처리완료 (새 시스템)
   * - transferReceipt 있음 → 처리완료 (구 시스템 호환)
   * - 그 외 → 처리예정
   */
  getEffectiveStatus(s) {
    if (this._qStatusMap && this._qStatusMap[s.projectId]) return '처리완료';
    if (s.files && s.files.transferReceipt) return '처리완료';
    return '처리예정';
  },

  /** 체크된 행의 납부대기 rowNumber 배열 반환 */
  _getCheckedRowNumbers() {
    return [...document.querySelectorAll('#admin-tbody .row-check:checked')]
      .map(cb => Number(cb.dataset.row))
      .filter(n => !isNaN(n) && n > 0);
  },

  /** 전체 선택/해제 */
  _toggleAllChecks(checked) {
    document.querySelectorAll('#admin-tbody .row-check').forEach(cb => { cb.checked = checked; });
  },

  /** 납부대기 행에서 sub-like 객체 빌드 (내부 sub 미매칭 시) */
  _buildSubFromRow(row) {
    // E열 포맷: "{name}-{N거점}" 또는 "{name}"
    const eMatch = String(row.e || '').match(/^(.+?)-(\d+거점)$/);
    return {
      id: `pending-row-${row.rowNumber}`,
      contractor: row.a,
      submittedAt: new Date().toISOString(),
      projectId: row.b,
      projectName: eMatch ? eMatch[1] : row.e,
      location: eMatch ? eMatch[2] : '',
      capacity: row.f ? String(row.f).replace(/[^0-9.]/g, '') : '',
      customerNumber: row.j || '',
      customerBank: row.k || '',
      customerAccount: row.l || '',
      baseFee: Number(String(row.g || '').replace(/[^0-9.-]/g, '')) || 0,
      notes: row.r || '',
      scheduledProcessDate: '',
      files: {},
    };
  },

  /** 매칭되는 내부 sub 가 없는 납부대기 행을 시트만으로 처리 */
  async _processUnmatchedRow(row) {
    const cfg = Storage.getConfig();
    if (!cfg.processingSheetUrl) return { ok: false, error: '처리 시트 미설정' };

    const refData = await this._lookupBillingRef(row.b);
    const processDate = Utils.getCurrentProcessDate(cfg);
    const newRow = {
      a: row.a || '',
      b: row.b || '',
      e: row.e || '',
      f: row.f || '',
      g: Number(String(row.g || '').replace(/[^0-9.-]/g, '')) || 0,
      j: row.j || '',
      k: row.k || '',
      l: row.l || '',
      m: refData.m, n: refData.n, o: refData.o,
      p: Utils.toYMD(processDate),
      r: row.r || '',
    };
    const r = await Sync.appendProcessingRow(
      cfg.processingSheetUrl, cfg.processingSheetGid, cfg.processingSheetName,
      newRow,
    );
    if (!r.ok) return r;

    // 납부대기 행 삭제
    await Sync.deletePendingRowMatching(
      { a: row.a, b: row.b, e: row.e },
      cfg.pendingSheetUrl || '', cfg.pendingSheetGid || '', cfg.pendingSheetName || '',
    );
    return r;
  },

  // ─── 대시보드 행 기반 액션 (납부대기 시트 기반) ───

  /** 행 단위 확인완료: 매칭된 sub 가 있으면 기존 path, 없으면 시트만 이동 */
  async actionConfirmFromRow(rowNumber) {
    const row = (this._dashboardPendingRows || []).find(r => r.rowNumber === rowNumber);
    if (!row) { alert('행을 찾을 수 없습니다.'); return; }
    if (!confirm('이 항목을 확인완료 처리하시겠습니까?\n납부내역 시트에 기록되고 폴더에 저장됩니다.')) return;

    const matchedSub = this._findMatchingSub(row);
    if (matchedSub) {
      await this.actionConfirmComplete(matchedSub.id, true);
      // 결과 표시
      await this._refreshDashboardData();
      alert('✓ 확인완료 처리되었습니다.');
    } else {
      const r = await this._processUnmatchedRow(row);
      await this._refreshDashboardData();
      if (r && r.ok) alert('✓ 확인완료 처리되었습니다. (시트만 이동)');
      else alert('처리 실패: ' + (r && r.error || '알 수 없음'));
    }
  },

  /** 행 단위 납부 완료: 확인완료 + Q열 TRUE */
  async actionMarkPaidFromRow(rowNumber) {
    const row = (this._dashboardPendingRows || []).find(r => r.rowNumber === rowNumber);
    if (!row) return;
    if (!confirm('이 항목을 납부 완료 처리하시겠습니까?\n납부내역 시트에 기록 후 Q열(완료확인)이 체크됩니다.')) return;

    const matchedSub = this._findMatchingSub(row);
    if (matchedSub) {
      await this.actionConfirmComplete(matchedSub.id, true);
    } else {
      const r = await this._processUnmatchedRow(row);
      if (!r || !r.ok) { alert('처리 실패: ' + (r && r.error || '')); return; }
    }

    // 새로 추가된 납부내역 행 찾아 Q=TRUE
    const cfg = Storage.getConfig();
    await this.loadQStatus();
    const rowNumbers = this._sheetRowMap[row.b] || [];
    if (rowNumbers.length > 0) {
      const newestRow = Math.max(...rowNumbers);
      await Sync.updateQStatus(
        cfg.processingSheetUrl, cfg.processingSheetGid, cfg.processingSheetName,
        [newestRow], true,
      );
      this._qStatusMap[row.b] = true;
    }
    await this._refreshDashboardData();
    alert('✓ 납부 완료 처리되었습니다.');
  },

  /** 행 단위 삭제: 납부대기 행 + 내부 sub(매칭 시) */
  async actionDeleteFromRow(rowNumber) {
    const row = (this._dashboardPendingRows || []).find(r => r.rowNumber === rowNumber);
    if (!row) return;
    if (!confirm('이 행을 삭제하시겠습니까?\n납부대기 시트 행과 (있는 경우) 내부 제출 데이터가 모두 삭제됩니다.')) return;

    const matchedSub = this._findMatchingSub(row);
    if (matchedSub) {
      if (matchedSub.files) {
        for (const [key, fId] of Object.entries(matchedSub.files)) {
          if (fId && !key.endsWith('Url')) await FileDB.delete(fId).catch(() => {});
        }
      }
      Storage.deleteSubmission(matchedSub.id);
      if (Sync.enabled()) await Sync.deleteSubmissionRemote(matchedSub.id);
    }

    await Sync.deletePendingRowMatching(
      { a: row.a, b: row.b, e: row.e },
      '', '', '',
    );
    await this._refreshDashboardData();
  },

  /** 납부대기 행 R열(비고) 수정 */
  async actionEditPendingNote(rowNumber) {
    const row = (this._dashboardPendingRows || []).find(r => r.rowNumber === rowNumber);
    if (!row) return;
    const newNote = prompt('비고 입력:', row.r || '');
    if (newNote === null) return;
    const cfg = Storage.getConfig();
    const r = await Sync.updateProcessingNote(
      rowNumber, newNote,
      cfg.pendingSheetUrl || '', cfg.pendingSheetGid || '', cfg.pendingSheetName || '',
    );
    if (!r.ok) { alert('비고 저장 실패: ' + (r.error || '')); return; }
    row.r = newNote;
    // 매칭 내부 sub 도 동기화
    const matchedSub = this._findMatchingSub(row);
    if (matchedSub) {
      Storage.updateSubmission(matchedSub.id, { notes: newNote });
      if (Sync.enabled()) await Sync.updateSubmission(matchedSub.id, { notes: newNote });
    }
    this.renderDashboard();
  },

  /** 대시보드 데이터 새로고침 (내부 submissions sync + Q 상태 + 납부대기 + 렌더) */
  async _refreshDashboardData() {
    // 시공사 제출(접수증/고지서 파일 참조 포함)을 서버에서 가져와야 매칭됨
    const tasks = [
      this.loadQStatus(),
      this.loadDashboardPending(),
    ];
    if (Sync.enabled()) tasks.push(Sync.pull().catch(e => console.warn('Sync.pull 실패:', e)));
    await Promise.all(tasks);
    this.renderDashboard();
  },

  // ============ 납부 완료 / 일괄 처리 ============

  /**
   * 납부내역 시트에서 해당 프로젝트의 Q열을 TRUE로 설정 → 대시보드에서 숨김
   */
  async actionMarkPaid(id) {
    const sub = Storage.getSubmissions().find(s => s.id === id);
    if (!sub) return;

    const cfg = Storage.getConfig();
    if (!Sync.enabled() || !cfg.processingSheetUrl) {
      alert('Apps Script 및 처리 시트가 설정되어야 합니다.');
      return;
    }

    let rowNumbers = this._sheetRowMap[sub.projectId] || [];
    if (rowNumbers.length === 0) {
      // 시트에 아직 기록 안 됨 → 먼저 확인완료 실행할지 물어봄
      if (!confirm('납부내역 시트에 해당 프로젝트 행이 없습니다.\n먼저 "확인완료"를 실행하여 시트에 기록 후 납부 완료 처리하시겠습니까?')) return;
      await this.actionConfirmComplete(id, true);
      await this.loadQStatus();
      rowNumbers = this._sheetRowMap[sub.projectId] || [];
      if (rowNumbers.length === 0) {
        alert('시트 기록에 실패했습니다. 다시 시도해주세요.');
        return;
      }
    }

    if (!confirm(`납부 완료로 표시합니다.\n해당 프로젝트(${sub.projectId})가 대시보드에서 숨겨집니다. 계속하시겠습니까?`)) return;

    const r = await Sync.updateQStatus(cfg.processingSheetUrl, cfg.processingSheetGid, cfg.processingSheetName, rowNumbers, true);
    if (!r.ok) {
      alert(`납부 완료 처리 실패: ${r.error}`);
      return;
    }

    this._qStatusMap[sub.projectId] = true;
    this.renderDashboard();
  },

  /**
   * 선택된 항목 일괄 확인완료 (납부내역 시트 기록 + 폴더 저장)
   * - 납부대기 시트 기반: 체크된 rowNumber 단위로 처리
   * - 시트 기록: 거점별로 수행
   * - 폴더 저장: 프로젝트별 1회만 수행
   */
  async actionBatchConfirm() {
    const rowNumbers = this._getCheckedRowNumbers();
    if (rowNumbers.length === 0) { alert('선택된 항목이 없습니다.'); return; }
    if (!confirm(`선택된 ${rowNumbers.length}건을 일괄 확인완료 처리하시겠습니까?\n납부내역 시트에 기록하고 폴더에 저장합니다.`)) return;

    const btn = document.getElementById('btn-batch-confirm');
    const origText = btn ? btn.textContent : '';
    if (btn) btn.disabled = true;

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const pendingMap = {};
    (this._dashboardPendingRows || []).forEach(r => { pendingMap[r.rowNumber] = r; });

    let recorded = 0, recordFail = 0;
    let projectCount = 0;
    let driveSaved = 0, driveFailed = 0, localSaved = 0;
    let driveConfigured = false, localConfigured = false;
    const seenProjects = new Set();

    // 1단계: 거점별 시트 기록
    for (let i = 0; i < rowNumbers.length; i++) {
      if (btn) btn.textContent = `⏳ 시트 기록 ${i + 1}/${rowNumbers.length}...`;
      const row = pendingMap[rowNumbers[i]];
      if (!row) continue;
      try {
        const matchedSub = this._findMatchingSub(row);
        if (matchedSub) {
          const patch = { scheduledProcessDate: today.toISOString() };
          Storage.updateSubmission(matchedSub.id, patch);
          if (Sync.enabled()) await Sync.updateSubmission(matchedSub.id, patch);
          await this.uploadNotesTxt(matchedSub);
          await this.recordToProcessingSheet(matchedSub);
        } else {
          // 시트만 이동
          const r = await this._processUnmatchedRow(row);
          if (!r || !r.ok) throw new Error(r && r.error || 'unknown');
        }
        recorded++;
      } catch (e) {
        recordFail++;
        console.error('일괄 시트 기록 오류', rowNumbers[i], e);
      }
    }

    // 2단계: 프로젝트별 폴더 저장 (매칭 sub 가 있는 항목만)
    for (let i = 0; i < rowNumbers.length; i++) {
      const row = pendingMap[rowNumbers[i]];
      if (!row) continue;
      const matchedSub = this._findMatchingSub(row);
      if (!matchedSub) continue;
      const key = `${matchedSub.contractor}|${matchedSub.projectId}`;
      if (seenProjects.has(key)) continue;
      seenProjects.add(key);
      projectCount++;
      if (btn) btn.textContent = `⏳ 폴더 저장 ${seenProjects.size}...`;
      try {
        const [dr, lr] = await Promise.all([
          this.copyToProcessedFolder(matchedSub),
          this.copyToLocalFolder(matchedSub),
        ]);
        if (dr && dr.ok) {
          driveConfigured = true;
          driveSaved += (dr.results || []).filter(x => x.ok).length;
          driveFailed += (dr.results || []).filter(x => !x.ok).length;
        }
        if (lr && lr.ok) {
          localConfigured = true;
          localSaved += lr.saved || 0;
        }
      } catch (e) {
        console.error('일괄 폴더 저장 오류', rowNumbers[i], e);
      }
    }

    if (btn) { btn.disabled = false; btn.textContent = origText; }
    await this._refreshDashboardData();

    const saveLines = [];
    if (driveConfigured) saveLines.push(`☁️ Drive 폴더: ${driveSaved}개 저장${driveFailed > 0 ? ` (실패 ${driveFailed})` : ''}`);
    if (localConfigured) saveLines.push(`💻 PC 폴더: ${localSaved}개 저장`);
    if (saveLines.length === 0) saveLines.push('(저장된 파일 없음 — 폴더 설정 확인)');

    alert(`✓ 일괄 확인완료\n\n시트 기록: ${recorded}건${recordFail ? ` (실패 ${recordFail})` : ''}\n처리 프로젝트: ${projectCount}개\n${saveLines.join('\n')}`);
  },

  /**
   * 선택된 항목 일괄 납부 완료 — 확인완료 + Q열 TRUE
   */
  async actionBatchMarkPaid() {
    const rowNumbers = this._getCheckedRowNumbers();
    if (rowNumbers.length === 0) { alert('선택된 항목이 없습니다.'); return; }

    const cfg = Storage.getConfig();
    if (!Sync.enabled() || !cfg.processingSheetUrl) {
      alert('Apps Script 및 처리 시트가 설정되어야 합니다.');
      return;
    }

    if (!confirm(`선택된 ${rowNumbers.length}건을 납부 완료 처리하시겠습니까?\n납부내역 시트에 기록 후 Q열(완료확인) 모두 체크됩니다.`)) return;

    const btn = document.getElementById('btn-batch-paid');
    const origText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 처리 중...'; }

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const pendingMap = {};
    (this._dashboardPendingRows || []).forEach(r => { pendingMap[r.rowNumber] = r; });

    let recorded = 0, recordFail = 0;
    const targetPids = new Set();

    // 1단계: 확인완료 처리 (시트 이동)
    for (let i = 0; i < rowNumbers.length; i++) {
      if (btn) btn.textContent = `⏳ 시트 기록 ${i + 1}/${rowNumbers.length}...`;
      const row = pendingMap[rowNumbers[i]];
      if (!row) continue;
      try {
        const matchedSub = this._findMatchingSub(row);
        if (matchedSub) {
          const patch = { scheduledProcessDate: today.toISOString() };
          Storage.updateSubmission(matchedSub.id, patch);
          if (Sync.enabled()) await Sync.updateSubmission(matchedSub.id, patch);
          await this.uploadNotesTxt(matchedSub);
          await this.recordToProcessingSheet(matchedSub);
        } else {
          const r = await this._processUnmatchedRow(row);
          if (!r || !r.ok) throw new Error(r && r.error || 'unknown');
        }
        targetPids.add(row.b);
        recorded++;
      } catch (e) {
        recordFail++;
        console.error('일괄 납부완료(시트 기록) 오류', rowNumbers[i], e);
      }
    }

    // 2단계: Q열 TRUE 일괄 설정
    if (btn) btn.textContent = '⏳ Q열 체크 중...';
    await this.loadQStatus();
    const allRowNumbers = [];
    targetPids.forEach(pid => {
      (this._sheetRowMap[pid] || []).forEach(n => allRowNumbers.push(n));
    });

    let qOk = false;
    if (allRowNumbers.length > 0) {
      const r = await Sync.updateQStatus(
        cfg.processingSheetUrl, cfg.processingSheetGid, cfg.processingSheetName,
        allRowNumbers, true,
      );
      qOk = !!(r && r.ok);
      if (qOk) targetPids.forEach(pid => { this._qStatusMap[pid] = true; });
    }

    if (btn) { btn.disabled = false; btn.textContent = origText; }
    await this._refreshDashboardData();
    alert(`✓ 일괄 납부 완료\n\n시트 기록: ${recorded}건${recordFail ? ` (실패 ${recordFail})` : ''}\nQ열 체크: ${qOk ? targetPids.size + '개 프로젝트' : '실패'}`);
  },

  shortNote(notes) {
    if (!notes) return '✏️ 추가';
    const s = String(notes);
    return s.length > 12 ? s.slice(0, 12) + '…' : s;
  },

  async actionEditNotes(id) {
    const sub = Storage.getSubmissions().find(s => s.id === id);
    if (!sub) return;
    const newNotes = prompt('비고 입력:', sub.notes || '');
    if (newNotes === null) return;
    Storage.updateSubmission(id, { notes: newNotes });
    if (Sync.enabled()) await Sync.updateSubmission(id, { notes: newNotes });
    this.renderDashboard();
  },

  /**
   * fileId/fileUrl 필드가 뒤섞여 저장된 경우도 모두 처리.
   * - fileId 필드에 Drive URL이 들어간 경우
   * - fileUrl 필드에 Drive ID(비URL)가 들어간 경우
   * - UUID는 로컬 IndexedDB 키로만 취급
   * 반환: { driveId, driveUrl, localUuid }
   */
  _resolveFile(fileId, fileUrl) {
    const isUuid    = s => !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
    const isHttp    = s => !!s && /^https?:\/\//i.test(s);
    const isDriveId = s => !!s && !isUuid(s) && !isHttp(s) && /^[a-zA-Z0-9_-]{15,}$/.test(s);
    const extractId = s => {
      if (!s) return null;
      const m = String(s).match(/\/d\/([a-zA-Z0-9_-]{10,})|[?&]id=([a-zA-Z0-9_-]{10,})/);
      return m ? (m[1] || m[2]) : null;
    };

    let driveId = null, driveUrl = null, localUuid = null;

    // --- fileId 필드 분석 ---
    if (isHttp(fileId)) {           // fileId 필드에 URL이 잘못 들어간 케이스
      driveUrl = driveUrl || fileId;
      driveId  = driveId  || extractId(fileId);
    } else if (isDriveId(fileId)) { // 정상적인 Drive file ID
      driveId = fileId;
    } else if (isUuid(fileId)) {    // 로컬 UUID
      localUuid = fileId;
    }

    // --- fileUrl 필드 분석 ---
    if (isHttp(fileUrl)) {           // 정상적인 Drive URL
      driveUrl = driveUrl || fileUrl;
      driveId  = driveId  || extractId(fileUrl);
    } else if (isDriveId(fileUrl)) { // fileUrl 필드에 Drive ID만 들어간 케이스
      driveId = driveId || fileUrl;
    } else if (isUuid(fileUrl)) {    // fileUrl 필드에 UUID가 잘못 들어간 케이스
      localUuid = localUuid || fileUrl;
    }

    return { driveId, driveUrl, localUuid };
  },

  fileCell(sub, docType, isTransfer) {
    const rawId  = sub.files && sub.files[docType];
    const rawUrl = sub.files && sub.files[docType + 'Url'];
    if (!rawId && !rawUrl) {
      return isTransfer ? '<span class="file-missing">미첨부</span>' : '<span class="file-missing">없음</span>';
    }
    const { driveId, driveUrl, localUuid } = this._resolveFile(rawId, rawUrl);
    const esc = s => String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    // Drive URL이 있으면 바로 링크
    if (driveUrl) {
      return `<a class="file-btn" href="${driveUrl}" target="_blank">보기</a>`;
    }
    // Drive ID 또는 로컬 UUID → viewFile로 프록시/로컬 시도
    if (driveId || localUuid) {
      return `<button class="file-btn" onclick="AdminView.viewFile('${esc(driveId||localUuid)}','${esc(driveUrl||'')}')">보기</button>`;
    }
    return isTransfer ? '<span class="file-missing">미첨부</span>' : '<span class="file-missing">없음</span>';
  },

  async viewFile(fileId, fileUrl) {
    let fileBuf = null, mimeType = 'application/pdf', fileName = '미리보기';

    // _resolveFile로 정규화
    const { driveId, driveUrl, localUuid } = this._resolveFile(fileId, fileUrl);

    // 1) 로컬 IndexedDB 시도 (UUID 키로 저장된 경우)
    const localKey = localUuid || fileId;
    if (localKey) {
      const local = await FileDB.get(localKey).catch(() => null);
      if (local && local.data) {
        fileBuf = local.data;
        mimeType = local.type || mimeType;
        fileName = local.name || fileName;
      }
    }

    // 2) Drive 프록시 시도 (Drive ID 또는 Drive URL 사용)
    if (!fileBuf && Sync.enabled() && (driveId || driveUrl)) {
      const r = await Sync.downloadDriveFile(driveId, driveUrl, false);
      if (r.ok && r.arrayBuffer) {
        fileBuf = r.arrayBuffer;
        mimeType = r.mimeType || mimeType;
        fileName = r.name || fileName;
      }
    }

    if (!fileBuf) {
      alert('파일을 찾을 수 없습니다.\n(Drive에 업로드되지 않았거나 시공사 로컬에만 존재합니다)');
      return;
    }

    const blob = new Blob([fileBuf], { type: mimeType });
    const url  = URL.createObjectURL(blob);
    document.getElementById('modal-title').textContent = fileName;
    const body = document.getElementById('modal-body');
    if (mimeType.startsWith('image/')) {
      body.innerHTML = `<img src="${url}" style="max-width:100%" />`;
    } else {
      body.innerHTML = `<iframe src="${url}" style="width:100%;height:70vh;border:none"></iframe>
        <p style="margin-top:10px"><a href="${url}" download="${fileName}">📥 다운로드</a></p>`;
    }
    document.getElementById('modal-overlay').classList.add('active');
  },

  /**
   * 확인완료: 납부내역 시트에 기록하고 폴더에 저장
   * silent=true 이면 confirm 없이 실행 (일괄 처리 시 사용)
   */
  async actionConfirmComplete(id, silent = false) {
    if (!silent && !confirm('이 항목을 확인완료 처리하시겠습니까?\n납부내역 시트에 기록되고 폴더에 저장됩니다.')) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const patch = { scheduledProcessDate: today.toISOString() };
    Storage.updateSubmission(id, patch);
    if (Sync.enabled()) await Sync.updateSubmission(id, patch);

    const sub = Storage.getSubmissions().find(s => s.id === id);
    let driveResult = null, localResult = null;
    if (sub) {
      await this.uploadNotesTxt(sub);
      await this.recordToProcessingSheet(sub);
      const [dr, lr] = await Promise.all([
        this.copyToProcessedFolder(sub),
        this.copyToLocalFolder(sub),
      ]);
      driveResult = dr;
      localResult = lr;
    }

    if (!silent) {
      // Q 상태 + 납부대기 맵에 새로 추가된 행 반영
      await Promise.all([this.loadQStatus(), this.loadDashboardPending()]);
      this.renderDashboard();
      alert('✓ 확인완료 처리되었습니다.\n\n' + this._formatSaveSummary(driveResult, localResult));
    }
    return { driveResult, localResult };
  },

  /**
   * Drive 저장 결과 + 로컬(PC) 저장 결과를 합쳐 사람이 읽는 요약 문자열 생성
   */
  _formatSaveSummary(driveResult, localResult) {
    const lines = [];
    // Drive 폴더 결과
    if (driveResult && driveResult.ok) {
      const okCount = (driveResult.results || []).filter(x => x.ok).length;
      const failCount = (driveResult.results || []).length - okCount;
      lines.push(`☁️ Drive 폴더: ${okCount}개 저장${failCount > 0 ? ` (실패 ${failCount})` : ''}`);
    } else if (driveResult === null) {
      // Drive 미설정 — 메시지 생략
    }
    // 로컬(PC) 폴더 결과
    if (localResult && localResult.ok) {
      lines.push(`💻 PC 폴더: ${localResult.saved}개 저장`);
    }
    if (lines.length === 0) {
      return '(저장된 파일 없음 — Drive 처리완료 폴더 또는 PC 로컬 폴더를 설정하세요)';
    }
    return lines.join('\n');
  },

  actionUploadTransfer(id) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,image/*';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const fileId = Utils.uuid();
      await FileDB.save(fileId, file);
      const sub = Storage.getSubmissions().find(s => s.id === id);
      const files = { ...(sub.files || {}), transferReceipt: fileId };

      // 클라우드 업로드
      if (Sync.enabled()) {
        const up = await Sync.uploadFile(file, sub, 'transferReceipt');
        if (up.ok) {
          files.transferReceipt = up.fileId;
          files.transferReceiptUrl = up.url;
        }
      }

      Storage.updateSubmission(id, { files });
      if (Sync.enabled()) await Sync.updateSubmission(id, { files });

      const updatedSub = Storage.getSubmissions().find(s => s.id === id);
      if (updatedSub) {
        await this.uploadNotesTxt(updatedSub);
        // 시트 기록 먼저 → _syncGroupProcessed 보다 앞서야 중복 방지 로직이 정상 동작
        await this.recordToProcessingSheet(updatedSub);
        // 같은 프로젝트의 나머지 거점에 처리완료 상태 동기화
        await this._syncGroupProcessed(updatedSub, files.transferReceipt, files.transferReceiptUrl);
        await Promise.all([
          this.copyToProcessedFolder(updatedSub),
          this.copyToLocalFolder(updatedSub),
        ]);
      }

      this.renderDashboard();
      alert('이체증이 업로드되었습니다. 상태가 "처리완료"로 변경되었습니다.');
    };
    input.click();
  },

  /**
   * 비고가 있으면 Drive 폴더에 .txt 로 업로드
   */
  async uploadNotesTxt(sub) {
    if (!sub.notes || !sub.notes.trim()) return;
    if (!Sync.enabled()) return;

    const today = new Date();
    const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const content = `[비고]\n${sub.notes}\n\n` +
      `프로젝트ID: ${sub.projectId}\n` +
      `프로젝트명: ${sub.projectName || ''}\n` +
      `시공사: ${sub.contractor}\n` +
      `처리일: ${ymd}\n`;

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const file = new File([blob], '비고.txt', { type: 'text/plain' });
    try {
      const r = await Sync.uploadFile(file, sub, 'notes');
      if (r.ok) console.log(`✓ 비고.txt Drive 업로드 완료: ${r.url}`);
      else console.warn('비고.txt 업로드 실패:', r.error);
    } catch (e) {
      console.warn('비고.txt 업로드 예외:', e);
    }
  },

  /**
   * M·N·O열 참조 시트(예: PM_25년환경부입찰)에서 프로젝트ID 매칭 행의 지정 컬럼 조회
   * 참조 시트 미설정 시 중앙 시트(centralProjectSheet)로 폴백.
   * 반환: { m, n, o } 문자열 값
   */
  async _lookupBillingRef(projectId) {
    const empty = { m: '', n: '', o: '' };
    if (!Sync.enabled()) return empty;
    const cfg = Storage.getConfig();

    // 참조 시트 우선, 없으면 중앙 시트로 폴백
    const useRef = !!cfg.billingRefSheetUrl;
    const url  = useRef ? cfg.billingRefSheetUrl  : cfg.centralProjectSheetUrl;
    const gid  = useRef ? cfg.billingRefSheetGid  : cfg.centralProjectSheetGid;
    const name = useRef ? cfg.billingRefSheetName : cfg.centralProjectSheetName;
    if (!url) return empty;

    const colM = (cfg.billingRefColM || 'AU').toUpperCase();
    const colN = (cfg.billingRefColN || 'AV').toUpperCase();
    const colO = (cfg.billingRefColO || 'AW').toUpperCase();

    const r = await Sync.lookupCentralColumns(url, gid, name, [projectId], [colM, colN, colO]);
    if (r.ok && r.map && r.map[projectId]) {
      const hit = r.map[projectId];
      return {
        m: hit[colM] ?? '',
        n: hit[colN] ?? '',
        o: hit[colO] ?? '',
      };
    }
    return empty;
  },

  /**
   * 처리 시트(외부 Google Sheet)에 신규 행 추가 (B열 마지막 행 기준)
   * B=프로젝트ID, E=현장명, F=용량, G=표준시설부담금,
   * J=고객번호, K=은행, L=고객지정계좌, P=처리날짜
   * 다중 거점이면 B·E 값 뒤에 "-N거점" 자동 추가
   */
  async recordToProcessingSheet(sub) {
    if (!Sync.enabled()) return;
    const cfg = Storage.getConfig();
    if (!cfg.processingSheetUrl) return;

    // 다중 거점 여부 확인 → 거점 suffix
    const submissions = Storage.getSubmissions();
    const sameProject = submissions
      .filter(s => s.projectId === sub.projectId && s.contractor === sub.contractor)
      .sort((a, b) => (a.submittedAt || '').localeCompare(b.submittedAt || ''));
    const groupSize = sameProject.length;
    const myIdx = sameProject.findIndex(s => s.id === sub.id);
    const locSuffix = groupSize > 1 ? `-${myIdx + 1}거점` : '';

    // 다중 거점에서 이미 처리완료된 거점이 있으면 중복 기록 방지
    if (groupSize > 1) {
      const alreadyRecorded = sameProject.some(s =>
        s.id !== sub.id && s.files && s.files.transferReceipt
      );
      if (alreadyRecorded) {
        console.log(`✓ 다른 거점 이미 처리완료 → 시트 기록 스킵 (${sub.projectId})`);
        return;
      }
    }

    // 현장명: "25년환경부_" + 차수 제거
    const { name: cleanName } = Utils.parseProjectName(sub.projectName || '');

    // P열(처리날짜) = 해당 주의 처리예정일(목요일). 금일이 아니라 처리요일로 기록.
    const processDate = Utils.getCurrentProcessDate(cfg);
    const ymd = Utils.toYMD(processDate);
    const baseFee = Number(sub.baseFee) || 0;

    // F열 용량: 값이 있으면 뒤에 ' kW' 단위 추가
    const capacityVal = sub.capacity ? `${sub.capacity} kW` : '';

    // M·N·O열 값 조회 → 전용 참조 시트(PM_25년환경부입찰)에서 지정 컬럼 가져옴
    // 참조 시트 미설정 시 중앙 시트로 폴백
    const refData = await this._lookupBillingRef(sub.projectId);

    const row = {
      a: sub.contractor || '',             // A = 시공사
      b: sub.projectId,                    // B = 프로젝트ID (거점 suffix 없이)
      e: cleanName + locSuffix,            // E = 현장명 (-N거점)
      f: capacityVal,                      // F = 용량 (예: "30 kW")
      g: baseFee,                          // G = 표준시설부담금
      // H(부가세), I(청구금액) 제거 → 시트 수식으로 자동 계산
      j: sub.customerNumber || '',         // J = 고객번호
      k: sub.customerBank || '',           // K = 은행
      l: sub.customerAccount || '',        // L = 고객지정계좌
      m: refData.m,                        // M = 참조 시트 (기본 AU)
      n: refData.n,                        // N = 참조 시트 (기본 AV)
      o: refData.o,                        // O = 참조 시트 (기본 AW)
      p: ymd,                              // P = 처리날짜
      r: sub.notes || '',                  // R = 비고
    };

    const r = await Sync.appendProcessingRow(
      cfg.processingSheetUrl,
      cfg.processingSheetGid,
      cfg.processingSheetName,
      row,
    );
    if (!r.ok) {
      console.warn('처리 시트 기록 실패:', r.error);
      return;
    }
    console.log(`✓ 처리 시트 ${r.sheet} ${r.rowNumber}행 추가 (${sub.projectId}${locSuffix})`);

    // 납부내역 기록 성공 → 납부대기에서 같은 행 삭제 (best-effort)
    // URL이 로컬에 없어도 서버 저장 설정으로 시도
    try {
      const delRes = await Sync.deletePendingRowMatching(
        { a: sub.contractor || '', b: sub.projectId, e: cleanName + locSuffix },
        cfg.pendingSheetUrl || '', cfg.pendingSheetGid || '', cfg.pendingSheetName || '',
      );
      if (!delRes) {
        console.warn('납부대기 삭제: 응답 없음');
      } else if (!delRes.ok) {
        console.warn('납부대기 삭제 실패:', delRes.error);
      } else if (delRes.deleted > 0) {
        console.log(`✓ 납부대기 ${delRes.rowNumber}행 삭제 (matched ${delRes.matchedBy || 'A+B+E'})`);
      } else {
        console.log(`납부대기에서 매칭 행 없음 (${sub.projectId} · ${sub.contractor})`);
      }
    } catch (e) {
      console.warn('납부대기 삭제 예외:', e);
    }
  },

  async actionDelete(id) {
    if (!confirm('이 제출 건을 삭제하시겠습니까? (첨부 파일 포함)')) return;
    const sub = Storage.getSubmissions().find(s => s.id === id);
    if (sub && sub.files) {
      for (const [key, fId] of Object.entries(sub.files)) {
        if (fId && !key.endsWith('Url')) await FileDB.delete(fId).catch(() => {});
      }
    }
    Storage.deleteSubmission(id);
    if (Sync.enabled()) await Sync.deleteSubmissionRemote(id);
    this.renderDashboard();
  },

  // ---------- 납부 이력 (TEST 시트 연동) ----------

  /**
   * TEST 시트에서 납부 이력 로드 후 렌더링
   */
  async loadPaymentHistory() {
    const statusEl = document.getElementById('payment-history-status');
    const tbody = document.getElementById('payment-history-tbody');
    if (!statusEl || !tbody) return;

    if (!Sync.enabled()) {
      statusEl.innerHTML = '<span style="color:var(--warning)">⚠ Apps Script가 설정되지 않아 시트 연동이 불가합니다. 설정 탭에서 웹앱 URL을 입력하세요.</span>';
      tbody.innerHTML = '';
      return;
    }

    const cfg = Storage.getConfig();
    if (!cfg.processingSheetUrl) {
      statusEl.innerHTML = '<span style="color:var(--warning)">⚠ 처리 시트 URL이 설정되지 않았습니다. 설정 탭에서 입력하세요.</span>';
      tbody.innerHTML = '';
      return;
    }

    statusEl.innerHTML = '⏳ 시트에서 데이터 로드 중...';
    tbody.innerHTML = '';

    const r = await Sync.readProcessingRows(
      cfg.processingSheetUrl,
      cfg.processingSheetGid,
      cfg.processingSheetName,
    );

    if (!r.ok) {
      statusEl.innerHTML = `<span style="color:var(--danger)">✗ 로드 실패: ${r.error}</span>`;
      return;
    }

    const rows = [...(r.rows || [])].reverse(); // 최신(하단) 행이 위로
    statusEl.innerHTML = `<span style="color:var(--success)">✓ ${rows.length}건 로드 완료</span>`;
    this._paymentRows = rows; // 편집 시 참조용

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="14" style="text-align:center;padding:24px;color:var(--muted);">기록된 처리 내역이 없습니다.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(row => `
      <tr>
        <td style="color:var(--muted);font-size:11px">${row.rowNumber}</td>
        <td>${this._esc(row.a)}</td>
        <td><code>${this._esc(row.b)}</code></td>
        <td>${this._esc(row.e)}</td>
        <td>${this._esc(row.f)}</td>
        <td style="text-align:right">${row.g ? Number(String(row.g).replace(/[^0-9.-]/g, '')).toLocaleString('ko-KR') : ''}</td>
        <td>${this._esc(row.j)}</td>
        <td>${this._esc(row.k)}</td>
        <td>${this._esc(row.l)}</td>
        <td>${this._esc(row.m)}</td>
        <td>${this._esc(row.n)}</td>
        <td>${this._esc(row.o)}</td>
        <td>${this._esc(row.p)}</td>
        <td title="${this._esc(row.r)}">${this._esc((row.r || '').length > 14 ? row.r.slice(0,14) + '…' : (row.r || ''))}</td>
        <td><button class="small" onclick="AdminView.openPaymentEditModal(${row.rowNumber})">수정</button></td>
      </tr>
    `).join('');
  },

  /** HTML 이스케이프 헬퍼 */
  _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  },

  /** 납부 이력 수정 모달 열기 */
  openPaymentEditModal(rowNumber) {
    const rows = this._paymentRows || [];
    const row = rows.find(r => r.rowNumber === rowNumber);
    if (!row) return;
    this._editingRowNumber = rowNumber;

    document.getElementById('payment-edit-row-label').textContent = `(시트 ${rowNumber}행)`;
    document.getElementById('pe-b').value = row.b || '';
    document.getElementById('pe-e').value = row.e || '';
    document.getElementById('pe-f').value = row.f || '';
    document.getElementById('pe-g').value = String(row.g || '').replace(/[^0-9.-]/g, '');
    document.getElementById('pe-j').value = row.j || '';
    document.getElementById('pe-k').value = row.k || '';
    document.getElementById('pe-l').value = row.l || '';
    document.getElementById('pe-m').value = row.m || '';
    document.getElementById('pe-n').value = row.n || '';
    document.getElementById('pe-o').value = row.o || '';
    document.getElementById('pe-r').value = row.r || '';

    // 날짜: 시트에서 "YYYY-MM-DD" 형식으로 옴
    const dateStr = String(row.p || '');
    const m = dateStr.match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
    document.getElementById('pe-p').value = m
      ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
      : '';

    document.getElementById('payment-edit-modal-overlay').classList.add('active');
  },

  closePaymentEditModal() {
    document.getElementById('payment-edit-modal-overlay').classList.remove('active');
    this._editingRowNumber = null;
  },

  /** 수정 내용 TEST 시트에 저장 */
  async savePaymentEdit() {
    const rowNumber = this._editingRowNumber;
    if (!rowNumber) return;

    const cfg = Storage.getConfig();
    const row = {
      b: document.getElementById('pe-b').value.trim(),
      e: document.getElementById('pe-e').value.trim(),
      f: document.getElementById('pe-f').value.trim(),
      g: Number(document.getElementById('pe-g').value) || 0,
      j: document.getElementById('pe-j').value.trim(),
      k: document.getElementById('pe-k').value.trim(),
      l: document.getElementById('pe-l').value.trim(),
      m: document.getElementById('pe-m').value.trim(),
      n: document.getElementById('pe-n').value.trim(),
      o: document.getElementById('pe-o').value.trim(),
      p: document.getElementById('pe-p').value,  // "YYYY-MM-DD"
      r: document.getElementById('pe-r').value,  // R = 비고
    };

    const btn = document.getElementById('btn-payment-edit-save');
    btn.textContent = '저장 중...';
    btn.disabled = true;

    const r = await Sync.updateProcessingRow(
      cfg.processingSheetUrl,
      cfg.processingSheetGid,
      cfg.processingSheetName,
      rowNumber,
      row,
    );

    btn.textContent = '💾 저장';
    btn.disabled = false;

    if (!r.ok) {
      alert(`저장 실패: ${r.error}`);
      return;
    }

    // 로컬 캐시 업데이트
    if (this._paymentRows) {
      const idx = this._paymentRows.findIndex(r => r.rowNumber === rowNumber);
      if (idx >= 0) this._paymentRows[idx] = { ...this._paymentRows[idx], ...row };
    }

    this.closePaymentEditModal();
    await this.loadPaymentHistory(); // 테이블 새로고침
  },

  // ---------- 설정 ----------
  renderSettings() {
    const cfg = Storage.getConfig();
    document.getElementById('cfg-deadline-dow').value = cfg.deadlineDow;
    document.getElementById('cfg-deadline-time').value = cfg.deadlineTime;
    document.getElementById('cfg-process-dow').value = cfg.processDow;
    document.getElementById('cfg-excel-dow').value = cfg.excelDow;
    document.getElementById('cfg-excel-time').value = cfg.excelTime;

    // 시공사 계정 + 프로젝트 시트 URL
    const isServer = Sync.enabled();
    const contractors = Storage.getContractors();
    const list = document.getElementById('contractor-password-list');
    list.innerHTML = contractors.map(c => `
      <div class="contractor-block">
        ${isServer ? `<button class="delete-btn" onclick="AdminView.deleteContractor('${c.id}')">✕ 삭제</button>` : ''}
        <div class="contractor-pw-row">
          <span class="cname">${c.name}</span>
          <span style="font-size:11px;color:var(--muted);width:40px">비번</span>
          <input type="text" data-contractor="${c.id}" data-field="password"
                 value="${isServer ? '' : (c.password || '')}"
                 placeholder="${isServer ? '(서버 저장됨 · 변경 시만 입력)' : ''}" />
        </div>
        <div class="contractor-pw-row">
          <span class="cname"></span>
          <span style="font-size:11px;color:var(--muted);width:40px">시트</span>
          <input type="text" data-contractor="${c.id}" data-field="projectSheetUrl"
                 value="${c.projectSheetUrl || ''}"
                 placeholder="개별 시트 (중앙 시트 쓰면 비워두기)" />
        </div>
      </div>
    `).join('') + (isServer ? '<p class="muted" style="margin-top:6px">🔒 서버 모드: 비밀번호는 Apps Script에만 저장됩니다. 변경할 계정의 비번란에 새 값을 입력하고 <strong>설정 저장</strong>을 누르세요.</p>' : '');

    // 동기화 URL
    document.getElementById('cfg-sync-url').value = Sync.getUrl();

    // 중앙 프로젝트 시트
    document.getElementById('cfg-central-url').value = cfg.centralProjectSheetUrl || '';
    document.getElementById('cfg-central-gid').value = cfg.centralProjectSheetGid || '';
    document.getElementById('cfg-central-name').value = cfg.centralProjectSheetName || '';

    // M·N·O 참조 시트 (AU/AV/AW 출처)
    document.getElementById('cfg-billingref-url').value = cfg.billingRefSheetUrl || '';
    document.getElementById('cfg-billingref-gid').value = cfg.billingRefSheetGid || '';
    document.getElementById('cfg-billingref-name').value = cfg.billingRefSheetName || '';
    document.getElementById('cfg-billingref-col-m').value = cfg.billingRefColM || 'AU';
    document.getElementById('cfg-billingref-col-n').value = cfg.billingRefColN || 'AV';
    document.getElementById('cfg-billingref-col-o').value = cfg.billingRefColO || 'AW';

    // 처리 결과 기록 시트
    document.getElementById('cfg-processing-url').value = cfg.processingSheetUrl || '';
    document.getElementById('cfg-processing-gid').value = cfg.processingSheetGid || '';
    document.getElementById('cfg-processing-name').value = cfg.processingSheetName || '';

    // 납부대기 시트
    const pendingUrlEl = document.getElementById('cfg-pending-url');
    if (pendingUrlEl) {
      pendingUrlEl.value = cfg.pendingSheetUrl || '';
      document.getElementById('cfg-pending-gid').value = cfg.pendingSheetGid || '';
      document.getElementById('cfg-pending-name').value = cfg.pendingSheetName || '';
    }

    // 처리완료 폴더
    document.getElementById('cfg-processed-folder').value = cfg.processedFolderUrl || '';
  },

  saveSettings() {
    const cfg = Storage.getConfig();
    cfg.deadlineDow = parseInt(document.getElementById('cfg-deadline-dow').value);
    cfg.deadlineTime = document.getElementById('cfg-deadline-time').value || '23:59';
    cfg.processDow = parseInt(document.getElementById('cfg-process-dow').value);
    cfg.excelDow = parseInt(document.getElementById('cfg-excel-dow').value);
    cfg.excelTime = document.getElementById('cfg-excel-time').value || '10:00';
    Storage.setConfig(cfg);

    // 시공사 비번 + 시트 URL 저장
    const isServer = Sync.enabled();
    const accounts = Storage.getAccounts();
    const serverCalls = [];
    document.querySelectorAll('#contractor-password-list input').forEach(inp => {
      const id = inp.dataset.contractor;
      const field = inp.dataset.field;
      if (!accounts[id]) return;
      const val = inp.value.trim();
      if (field === 'password') {
        if (val && (!isServer || val !== '••••••••')) {
          if (isServer) {
            serverCalls.push(Sync.updatePassword(id, val));
          } else {
            accounts[id].password = val;
          }
        }
      } else if (field === 'projectSheetUrl') {
        const url = val;
        accounts[id].projectSheetUrl = url;
        const m = url.match(/[#&?]gid=(\d+)/);
        const gid = m ? m[1] : '';
        accounts[id].projectSheetGid = gid;
        if (isServer) {
          serverCalls.push(Sync.setContractorSheet(id, url, gid));
        }
      }
    });
    Storage.setAccounts(accounts);
    if (serverCalls.length) {
      Promise.all(serverCalls).catch(e => console.error('server save error', e));
    }

    // 동기화 URL 저장
    const syncUrl = document.getElementById('cfg-sync-url').value.trim();
    Sync.setUrl(syncUrl);

    // 중앙 프로젝트 시트 저장
    const centralUrl = document.getElementById('cfg-central-url').value.trim();
    cfg.centralProjectSheetUrl = centralUrl;
    let centralGid = document.getElementById('cfg-central-gid').value.trim();
    if (!centralGid && centralUrl) {
      const m = centralUrl.match(/[#&?]gid=(\d+)/);
      centralGid = m ? m[1] : '';
    }
    cfg.centralProjectSheetGid = centralGid;
    cfg.centralProjectSheetName = document.getElementById('cfg-central-name').value.trim();

    // M·N·O 참조 시트 저장 (AU/AV/AW 출처)
    const billingRefUrl = document.getElementById('cfg-billingref-url').value.trim();
    cfg.billingRefSheetUrl = billingRefUrl;
    let billingRefGid = document.getElementById('cfg-billingref-gid').value.trim();
    if (!billingRefGid && billingRefUrl) {
      const m = billingRefUrl.match(/[#&?]gid=(\d+)/);
      billingRefGid = m ? m[1] : '';
    }
    cfg.billingRefSheetGid = billingRefGid;
    cfg.billingRefSheetName = document.getElementById('cfg-billingref-name').value.trim();
    cfg.billingRefColM = (document.getElementById('cfg-billingref-col-m').value.trim() || 'AU').toUpperCase();
    cfg.billingRefColN = (document.getElementById('cfg-billingref-col-n').value.trim() || 'AV').toUpperCase();
    cfg.billingRefColO = (document.getElementById('cfg-billingref-col-o').value.trim() || 'AW').toUpperCase();

    // 처리 결과 기록 시트 저장
    const processingUrl = document.getElementById('cfg-processing-url').value.trim();
    cfg.processingSheetUrl = processingUrl;
    let processingGid = document.getElementById('cfg-processing-gid').value.trim();
    if (!processingGid && processingUrl) {
      const m = processingUrl.match(/[#&?]gid=(\d+)/);
      processingGid = m ? m[1] : '';
    }
    cfg.processingSheetGid = processingGid;
    cfg.processingSheetName = document.getElementById('cfg-processing-name').value.trim();
    // 처리 시트 설정을 서버에도 저장 → 시공사가 URL 없이 본인 납부이력 조회 가능
    if (Sync.enabled() && processingUrl) {
      Sync.setProcessingSheetConfig(processingUrl, processingGid, cfg.processingSheetName)
        .catch(e => console.warn('처리 시트 설정 서버 저장 실패:', e));
    }

    // 납부대기 시트 저장
    const pendingUrlInput = document.getElementById('cfg-pending-url');
    if (pendingUrlInput) {
      const pendingUrl = pendingUrlInput.value.trim();
      cfg.pendingSheetUrl = pendingUrl;
      let pendingGid = document.getElementById('cfg-pending-gid').value.trim();
      if (!pendingGid && pendingUrl) {
        const m = pendingUrl.match(/[#&?]gid=(\d+)/);
        pendingGid = m ? m[1] : '';
      }
      cfg.pendingSheetGid = pendingGid;
      cfg.pendingSheetName = document.getElementById('cfg-pending-name').value.trim();
      if (Sync.enabled() && pendingUrl) {
        Sync.setPendingSheetConfig(pendingUrl, pendingGid, cfg.pendingSheetName)
          .catch(e => console.warn('납부대기 시트 설정 서버 저장 실패:', e));
      }
    }

    // 처리완료 폴더 저장
    const folderInput = document.getElementById('cfg-processed-folder').value.trim();
    cfg.processedFolderUrl = folderInput;
    cfg.processedFolderId = this._extractFolderId(folderInput);
    Storage.setConfig(cfg);

    const msg = document.getElementById('settings-saved');
    msg.textContent = '✓ 저장되었습니다.';
    setTimeout(() => { msg.textContent = ''; }, 2000);

    this.renderDashboard();
  },

  // ---------- 클라우드 동기화 ----------
  async syncTest() {
    const urlInput = document.getElementById('cfg-sync-url').value.trim();
    if (urlInput) Sync.setUrl(urlInput);
    const status = document.getElementById('sync-status');
    status.textContent = '⏳ 연결 테스트 중...';
    const r = await Sync.ping();
    if (r.ok) {
      status.innerHTML = `<span style="color:var(--success)">✓ 연결 성공 (${r.version || 'v?'})</span>`;
    } else {
      status.innerHTML = `<span style="color:var(--danger)">✗ 연결 실패: ${r.error || '알 수 없는 오류'}</span>`;
    }
  },

  async syncPull() {
    if (!Sync.enabled()) { alert('먼저 URL을 저장하세요.'); return; }
    const status = document.getElementById('sync-status');
    status.textContent = '⏳ 클라우드에서 데이터 가져오는 중...';
    const r = await Sync.pull();
    if (r.ok) {
      status.innerHTML = `<span style="color:var(--success)">✓ ${(r.submissions||[]).length}건 가져옴</span>`;
      this.renderDashboard();
    } else {
      status.innerHTML = `<span style="color:var(--danger)">✗ 실패: ${r.error}</span>`;
    }
  },

  async addContractor() {
    if (!Sync.enabled()) { alert('서버 모드(Apps Script)에서만 사용 가능합니다.'); return; }
    const name = document.getElementById('new-contractor-name').value.trim();
    const pw = document.getElementById('new-contractor-pw').value.trim();
    if (!name) { alert('시공사 이름을 입력하세요.'); return; }
    if (!pw || pw.length < 4) { alert('비밀번호는 4자 이상으로 입력하세요.'); return; }
    const r = await Sync.createAccount(name, pw, name, 'contractor');
    if (!r.ok) { alert('실패: ' + r.error); return; }
    document.getElementById('new-contractor-name').value = '';
    document.getElementById('new-contractor-pw').value = '';
    // 서버에서 계정 목록 재갱신
    const list = await Sync.listAccounts();
    if (list.ok) Storage.setServerAccounts(list.accounts);
    this.renderSettings();
    alert(`✓ "${name}" 시공사 계정이 생성되었습니다.\n초기 비밀번호: ${pw}`);
  },

  async deleteContractor(id) {
    if (!confirm(`시공사 "${id}" 계정을 삭제하시겠습니까?\n(해당 시공사의 기존 제출 데이터는 유지됩니다)`)) return;
    const r = await Sync.deleteAccount(id);
    if (!r.ok) { alert('실패: ' + r.error); return; }
    const list = await Sync.listAccounts();
    if (list.ok) Storage.setServerAccounts(list.accounts);
    this.renderSettings();
  },

  async bulkRegisterContractors() {
    if (!Sync.enabled()) { alert('서버 모드(Apps Script)에서만 사용 가능합니다.'); return; }
    const list = [
      { id: '유닛커넥트',       password: 'unit1234', name: '유닛커넥트' },
      { id: '한백',             password: 'hanbaek1234', name: '한백' },
      { id: '에스아이전기',     password: 'si1234',   name: '에스아이전기' },
      { id: '나이스테크',       password: 'nice1234', name: '나이스테크' },
      { id: '대광이브이',       password: 'dkev1234', name: '대광이브이' },
      { id: '성우이브이텍',     password: 'swev1234', name: '성우이브이텍' },
      { id: '엘엔테크',         password: 'lntech1234', name: '엘엔테크' },
      { id: 'ev세상',           password: 'evsj1234', name: 'ev세상' },
      { id: '한국홈충전',       password: 'kor1234',  name: '한국홈충전' },
      { id: '화두에너지솔루션', password: 'hwadoo1234', name: '화두에너지솔루션' },
    ];

    const msg = `아래 10개 시공사를 일괄 등록하시겠습니까?\n(이미 존재하는 계정은 건너뜁니다)\n\n` +
      list.map(c => `• ${c.name} / ${c.password}`).join('\n');
    if (!confirm(msg)) return;

    const r = await Sync.bulkCreateContractors(list);
    if (!r.ok) { alert('실패: ' + r.error); return; }

    const serverList = await Sync.listAccounts();
    if (serverList.ok) Storage.setServerAccounts(serverList.accounts);
    this.renderSettings();

    const summary = `✓ 등록 완료\n\n생성 (${r.created.length}개): ${r.created.join(', ') || '(없음)'}\n건너뜀 (${r.skipped.length}개): ${r.skipped.join(', ') || '(없음)'}\n\n⚠️ 각 시공사에 초기 비밀번호를 전달해주세요. (이 창 닫으면 다시 볼 수 없음)\n\n` +
      list.map(c => `${c.name}: ${c.password}`).join('\n');
    alert(summary);
  },

  _extractFolderId(input) {
    if (!input) return '';
    const m = String(input).match(/[?&\/]folders\/([a-zA-Z0-9-_]+)/);
    if (m) return m[1];
    if (/^[a-zA-Z0-9-_]{20,}$/.test(input.trim())) return input.trim();
    return '';
  },

  async folderAccessTest() {
    const input = document.getElementById('cfg-processed-folder').value.trim();
    const status = document.getElementById('folder-test-status');
    if (!input) { status.textContent = '폴더 URL/ID를 입력하세요.'; return; }
    const id = this._extractFolderId(input);
    if (!id) { status.innerHTML = '<span style="color:var(--danger)">URL에서 폴더 ID를 추출할 수 없음</span>'; return; }
    status.textContent = '⏳ 폴더 접근 테스트 중...';
    const r = await Sync.checkFolderAccess(id);
    if (r.ok) {
      status.innerHTML = `<span style="color:var(--success)">✓ 접근 성공: ${r.name}</span>`;
    } else {
      status.innerHTML = `<span style="color:var(--danger)">✗ 실패: ${r.error}</span>`;
    }
  },

  /**
   * ArrayBuffer → base64 문자열 (chunk 방식, 스택 안전)
   */
  _arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 8192;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, bytes.length)));
    }
    return btoa(binary);
  },

  /**
   * Drive 파일 ArrayBuffer 가져오기
   * 우선순위: 로컬 FileDB → Drive 프록시 (이미지는 자동 PDF 변환)
   */
  async _fetchFileBuf(fileId, fileUrl) {
    const { driveId, driveUrl, localUuid } = this._resolveFile(fileId, fileUrl);

    // 1) 로컬 IndexedDB 우선 (UUID 키)
    const localKey = localUuid || (fileId && !driveId ? fileId : null);
    if (localKey) {
      const local = await FileDB.get(localKey).catch(() => null);
      if (local && local.data) {
        let buf = local.data;
        const mime = local.type || '';
        if (!Utils.isPdf(mime, local.name) && Utils.isImage(mime, local.name)) {
          try { buf = await Utils.imageToPdf(buf, mime); } catch (e) { /* 원본 사용 */ }
        }
        return buf;
      }
    }

    // 2) Drive 프록시 (Drive ID 또는 URL)
    if (Sync.enabled() && (driveId || driveUrl)) {
      const proxy = await Sync.downloadDriveFile(driveId || null, driveUrl || null, true);
      if (proxy.ok) return proxy.arrayBuffer;
    }
    return null;
  },

  /**
   * Drive 파일 ID 추출 — _resolveFile 사용 (UUID는 Drive ID로 취급하지 않음)
   * fileId/fileUrl 필드가 뒤섞여 저장된 경우도 정상 처리
   */
  _driveIdFrom(fileId, fileUrl) {
    const { driveId } = this._resolveFile(fileId, fileUrl);
    return driveId;
  },

  // ──────────────────────────────────────────────────
  // 로컬 폴더 (File System Access API)
  // ──────────────────────────────────────────────────

  /** 폴더 선택 다이얼로그 → IndexedDB 저장 */
  async selectLocalFolder() {
    if (!window.showDirectoryPicker) {
      alert('이 브라우저는 로컬 폴더 직접 저장을 지원하지 않습니다.\nChrome 또는 Edge 최신 버전을 사용해주세요.');
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'desktop' });
      await LocalFolderDB.save(handle);
      const el = document.getElementById('local-folder-status');
      if (el) el.innerHTML = `<span style="color:var(--success)">✓ ${handle.name}</span>`;
    } catch (e) {
      if (e.name !== 'AbortError') alert('폴더 선택 실패: ' + e.message);
    }
  },

  /** 로컬 폴더 설정 해제 */
  async clearLocalFolder() {
    await LocalFolderDB.clear();
    const el = document.getElementById('local-folder-status');
    if (el) el.textContent = '미선택';
  },

  /**
   * 다중 거점 그룹 처리완료 동기화
   * 기준 submission(sub)과 같은 projectId+contractor 인 나머지 거점에
   * 동일한 transferReceipt 파일 정보를 자동으로 복사한다.
   * recordToProcessingSheet 호출 이후에 실행해야 중복 기록 방지 로직이 정상 동작한다.
   */
  async _syncGroupProcessed(sub, fileId, fileUrl) {
    const submissions = Storage.getSubmissions();
    const others = submissions.filter(s =>
      s.id !== sub.id &&
      s.projectId === sub.projectId &&
      s.contractor === sub.contractor
    );
    if (others.length === 0) return;
    for (const other of others) {
      const otherFiles = { ...(other.files || {}) };
      if (fileId) otherFiles.transferReceipt = fileId;
      if (fileUrl) otherFiles.transferReceiptUrl = fileUrl;
      Storage.updateSubmission(other.id, { files: otherFiles });
      if (Sync.enabled()) await Sync.updateSubmission(other.id, { files: otherFiles });
    }
    console.log(`✓ ${others.length}개 거점 처리완료 동기화 (${sub.projectId})`);
  },

  /** 저장된 핸들 반환 (권한 없으면 자동 요청) */
  async getLocalFolderHandle() {
    const handle = await LocalFolderDB.get().catch(() => null);
    if (!handle) return null;
    try {
      const perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') return handle;
      const req = await handle.requestPermission({ mode: 'readwrite' });
      return req === 'granted' ? handle : null;
    } catch (e) {
      return null;
    }
  },

  /**
   * PC 로컬 폴더에 처리완료 파일 저장 (File System Access API)
   * Drive 저장과 독립적으로 동작 — 둘 다 설정돼 있으면 동시 저장
   */
  async copyToLocalFolder(sub) {
    const folderHandle = await this.getLocalFolderHandle();
    if (!folderHandle) return null;

    const cfg = Storage.getConfig();
    const submissions = Storage.getSubmissions();
    const sameProject = submissions
      .filter(s => s.projectId === sub.projectId && s.contractor === sub.contractor)
      .sort((a, b) => (a.submittedAt || '').localeCompare(b.submittedAt || ''));

    const groupSize = sameProject.length;
    const rep = { ...sub };
    rep.location = groupSize > 1 ? `${groupSize}거점` : '';
    const folderName = Utils.getProjectIdent(rep);

    // 로컬 저장은 속도 우선 — 대기번호 lookup 생략
    const extra = {};

    // 프로젝트 하위 폴더 생성
    let projHandle;
    try {
      projHandle = await folderHandle.getDirectoryHandle(folderName, { create: true });
    } catch (e) {
      console.warn('로컬 폴더 생성 실패:', e);
      return { ok: false, saved: 0, folderName };
    }

    // 파일 쓰기 헬퍼
    const writeFile = async (name, data) => {
      try {
        const fh = await projHandle.getFileHandle(name, { create: true });
        const writable = await fh.createWritable();
        await writable.write(data);
        await writable.close();
      } catch (e) {
        console.warn(`로컬 쓰기 실패 [${name}]:`, e);
      }
    };

    let saved = 0;

    // 접수증: 첫 거점만
    const firstAppRcpt = sameProject.find(s => s.files && (s.files.applicationReceipt || s.files.applicationReceiptUrl));
    if (firstAppRcpt) {
      const buf = await this._fetchFileBuf(firstAppRcpt.files.applicationReceipt, firstAppRcpt.files.applicationReceiptUrl);
      if (buf) { await writeFile(Utils.getFileName(rep, 'applicationReceipt', 'a.pdf', extra), buf); saved++; }
    }

    // 고지서: 모든 거점 병합
    const feeNoticeSubs = sameProject.filter(s => s.files && (s.files.feeNotice || s.files.feeNoticeUrl));
    if (feeNoticeSubs.length > 0) {
      const buffers = [];
      for (const s of feeNoticeSubs) {
        const buf = await this._fetchFileBuf(s.files.feeNotice, s.files.feeNoticeUrl);
        if (buf) buffers.push(buf);
      }
      if (buffers.length > 0) {
        let merged = buffers[0];
        if (buffers.length > 1) { try { merged = await Utils.mergePdfs(buffers); } catch(e) {} }
        await writeFile(Utils.getFileName(rep, 'feeNotice', 'a.pdf', extra), merged);
        saved++;
      }
    }

    // 이체증: 모든 거점 병합
    const transferSubs = sameProject.filter(s => s.files && (s.files.transferReceipt || s.files.transferReceiptUrl));
    if (transferSubs.length > 0) {
      const buffers = [];
      for (const s of transferSubs) {
        const buf = await this._fetchFileBuf(s.files.transferReceipt, s.files.transferReceiptUrl);
        if (buf) buffers.push(buf);
      }
      if (buffers.length > 0) {
        let merged = buffers[0];
        if (buffers.length > 1) { try { merged = await Utils.mergePdfs(buffers); } catch(e) {} }
        await writeFile(Utils.getFileName(rep, 'transferReceipt', 'a.pdf', extra), merged);
        saved++;
      }
    }

    // 비고: 모든 거점 합쳐서 txt
    const allNotes = sameProject
      .map((s, i) => {
        if (!s.notes || !s.notes.trim()) return '';
        const tag = groupSize > 1 ? `[${i + 1}거점] ` : '';
        return tag + s.notes.trim();
      })
      .filter(Boolean).join('\n\n');
    if (allNotes) {
      const today = new Date();
      const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const content = `[비고]\n${allNotes}\n\n프로젝트ID: ${sub.projectId}\n프로젝트명: ${sub.projectName || ''}\n시공사: ${sub.contractor}\n처리일: ${ymd}\n`;
      await writeFile(Utils.getFileName(rep, 'notes', 'a.txt', extra), new TextEncoder().encode(content));
      saved++;
    }

    if (saved > 0) console.log(`✓ 로컬 저장: ${saved}개 → ${folderHandle.name}/${folderName}`);
    return { ok: true, saved, folderName };
  },

  /**
   * 처리완료 폴더에 같은 프로젝트의 모든 첨부파일 복사
   * - 접수증: 첫 거점 1개 (공유)
   * - 고지서: 모든 거점 PDF 병합 → 1파일 (다중이면 파일명에 -N거점)
   * - 이체증: 모든 거점 PDF 병합 → 1파일 (다중이면 파일명에 -N거점)
   * - 비고: 모든 거점 합쳐서 txt 1개
   */
  async copyToProcessedFolder(sub) {
    if (!Sync.enabled()) return;
    const cfg = Storage.getConfig();
    if (!cfg.processedFolderId) return;

    // 같은 시공사 + 같은 프로젝트의 모든 submission (제출 순서)
    const submissions = Storage.getSubmissions();
    const sameProject = submissions
      .filter(s => s.projectId === sub.projectId && s.contractor === sub.contractor)
      .sort((a, b) => (a.submittedAt || '').localeCompare(b.submittedAt || ''));

    const groupSize = sameProject.length;
    // 대표 rep: location = N거점(다중) or ''(단일)
    const rep = { ...sub };
    rep.location = groupSize > 1 ? `${groupSize}거점` : '';
    const folderName = Utils.getProjectIdent(rep);

    const files = [];
    let extra = {}; // waitingNumber 등 — 고지서가 있을 때만 lookup

    // ── 접수증: 첫 거점만, Drive 직접 복사 (단일 파일) ──
    const firstAppRcpt = sameProject.find(s => s.files && (s.files.applicationReceipt || s.files.applicationReceiptUrl));
    if (firstAppRcpt) {
      const driveId = this._driveIdFrom(firstAppRcpt.files.applicationReceipt, firstAppRcpt.files.applicationReceiptUrl);
      if (driveId) {
        files.push({ sourceFileId: driveId, name: Utils.getFileName(rep, 'applicationReceipt', 'a.pdf', extra) });
      } else {
        const buf = await this._fetchFileBuf(firstAppRcpt.files.applicationReceipt, firstAppRcpt.files.applicationReceiptUrl);
        if (buf) files.push({ base64: this._arrayBufferToBase64(buf), mimeType: 'application/pdf', name: Utils.getFileName(rep, 'applicationReceipt', 'a.pdf', extra) });
      }
    }

    // ── 고지서: 모든 거점 수집 후 병합 ──
    // 고지서 파일명에 대기번호가 필요할 때만 중앙시트 조회 (속도 최적화)
    const feeNoticeSubs = sameProject.filter(s => s.files && (s.files.feeNotice || s.files.feeNoticeUrl));
    if (feeNoticeSubs.length > 0 && cfg.centralProjectSheetUrl) {
      const r = await Sync.lookupCentralColumns(
        cfg.centralProjectSheetUrl, cfg.centralProjectSheetGid, cfg.centralProjectSheetName,
        [sub.projectId], ['A']
      );
      if (r.ok && r.map[sub.projectId]) extra = { waitingNumber: r.map[sub.projectId].A || '' };
    }
    if (feeNoticeSubs.length === 1) {
      // 단일 → Drive 직접 복사 (빠름, 다운로드 불필요)
      const driveId = this._driveIdFrom(feeNoticeSubs[0].files.feeNotice, feeNoticeSubs[0].files.feeNoticeUrl);
      if (driveId) {
        files.push({ sourceFileId: driveId, name: Utils.getFileName(rep, 'feeNotice', 'a.pdf', extra) });
      } else {
        const buf = await this._fetchFileBuf(feeNoticeSubs[0].files.feeNotice, feeNoticeSubs[0].files.feeNoticeUrl);
        if (buf) files.push({ base64: this._arrayBufferToBase64(buf), mimeType: 'application/pdf', name: Utils.getFileName(rep, 'feeNotice', 'a.pdf', extra) });
      }
    } else if (feeNoticeSubs.length > 1) {
      // 다중 → 다운로드 + 병합
      const buffers = [];
      for (const s of feeNoticeSubs) {
        const buf = await this._fetchFileBuf(s.files.feeNotice, s.files.feeNoticeUrl);
        if (buf) buffers.push(buf);
      }
      if (buffers.length > 0) {
        let merged = buffers[0];
        if (buffers.length > 1) {
          try { merged = await Utils.mergePdfs(buffers); }
          catch (e) { console.warn('고지서 PDF 병합 실패, 첫 파일 사용:', e); }
        }
        files.push({ base64: this._arrayBufferToBase64(merged), mimeType: 'application/pdf', name: Utils.getFileName(rep, 'feeNotice', 'a.pdf', extra) });
      }
    }

    // ── 이체증: 모든 거점 수집 후 병합 ──
    const transferSubs = sameProject.filter(s => s.files && (s.files.transferReceipt || s.files.transferReceiptUrl));
    if (transferSubs.length === 1) {
      const driveId = this._driveIdFrom(transferSubs[0].files.transferReceipt, transferSubs[0].files.transferReceiptUrl);
      if (driveId) {
        files.push({ sourceFileId: driveId, name: Utils.getFileName(rep, 'transferReceipt', 'a.pdf', extra) });
      } else {
        const buf = await this._fetchFileBuf(transferSubs[0].files.transferReceipt, transferSubs[0].files.transferReceiptUrl);
        if (buf) files.push({ base64: this._arrayBufferToBase64(buf), mimeType: 'application/pdf', name: Utils.getFileName(rep, 'transferReceipt', 'a.pdf', extra) });
      }
    } else if (transferSubs.length > 1) {
      const buffers = [];
      for (const s of transferSubs) {
        const buf = await this._fetchFileBuf(s.files.transferReceipt, s.files.transferReceiptUrl);
        if (buf) buffers.push(buf);
      }
      if (buffers.length > 0) {
        let merged = buffers[0];
        if (buffers.length > 1) {
          try { merged = await Utils.mergePdfs(buffers); }
          catch (e) { console.warn('이체증 PDF 병합 실패, 첫 파일 사용:', e); }
        }
        files.push({ base64: this._arrayBufferToBase64(merged), mimeType: 'application/pdf', name: Utils.getFileName(rep, 'transferReceipt', 'a.pdf', extra) });
      }
    }

    // ── 비고: 모든 거점 합쳐서 txt 1개 ──
    const allNotes = sameProject
      .map((s, i) => {
        if (!s.notes || !s.notes.trim()) return '';
        const tag = groupSize > 1 ? `[${i + 1}거점] ` : '';
        return tag + s.notes.trim();
      })
      .filter(Boolean)
      .join('\n\n');

    if (allNotes) {
      const today = new Date();
      const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const content = `[비고]\n${allNotes}\n\n` +
        `프로젝트ID: ${sub.projectId}\n` +
        `프로젝트명: ${sub.projectName || ''}\n` +
        `시공사: ${sub.contractor}\n` +
        `처리일: ${ymd}\n`;
      files.push({ text: content, name: Utils.getFileName(rep, 'notes', 'a.txt', extra) });
    }

    if (files.length === 0) return;

    const r = await Sync.copyToProcessedFolder(cfg.processedFolderId, folderName, files);
    if (r.ok) {
      const okCount = r.results.filter(x => x.ok).length;
      const failCount = r.results.length - okCount;
      console.log(`✓ 처리완료 폴더 복사: ${okCount}/${r.results.length}개 → ${r.folder}`, r.folderUrl);
      if (failCount > 0) console.warn('일부 파일 복사 실패:', r.results.filter(x => !x.ok));
    } else {
      console.warn('처리완료 폴더 복사 실패:', r.error);
    }
    return r;
  },

  async centralSheetTest() {
    const url = document.getElementById('cfg-central-url').value.trim();
    let gid = document.getElementById('cfg-central-gid').value.trim();
    const sheetName = document.getElementById('cfg-central-name').value.trim();
    if (!gid && url) {
      const m = url.match(/[#&?]gid=(\d+)/);
      gid = m ? m[1] : '';
    }
    const status = document.getElementById('central-test-status');
    if (!url) { status.textContent = '시트 URL을 입력하세요.'; return; }

    status.textContent = '⏳ 시공사별 매칭 결과 조회 중...';
    const contractors = Storage.getContractors();
    const results = [];
    for (const c of contractors) {
      const r = await Sync.fetchProjectsForContractor(url, gid, sheetName, c.name);
      if (r.ok) {
        results.push(`${c.name}: ${r.matched}개 매칭 (전체 ${r.totalRows}행 중)`);
      } else {
        results.push(`${c.name}: 실패 - ${r.error}`);
        break;
      }
    }
    status.innerHTML = '<br>' + results.map(r => '• ' + r).join('<br>');
  },

  /** M·N·O 참조 시트 테스트 — 처리예정 첫 건의 프로젝트ID로 AU/AV/AW 조회 결과 표시 */
  async billingRefTest() {
    const status = document.getElementById('billingref-test-status');
    const url = document.getElementById('cfg-billingref-url').value.trim();
    if (!url) { status.textContent = 'URL을 입력하세요 (비우면 중앙 시트 사용).'; return; }
    if (!Sync.enabled()) { status.innerHTML = '<span style="color:var(--danger)">Apps Script URL을 먼저 설정·저장하세요.</span>'; return; }

    let gid = document.getElementById('cfg-billingref-gid').value.trim();
    if (!gid && url) { const m = url.match(/[#&?]gid=(\d+)/); gid = m ? m[1] : ''; }
    const name = document.getElementById('cfg-billingref-name').value.trim();
    const colM = (document.getElementById('cfg-billingref-col-m').value.trim() || 'AU').toUpperCase();
    const colN = (document.getElementById('cfg-billingref-col-n').value.trim() || 'AV').toUpperCase();
    const colO = (document.getElementById('cfg-billingref-col-o').value.trim() || 'AW').toUpperCase();

    // 샘플 프로젝트ID: 처리예정 첫 건
    const sample = Storage.getSubmissions().find(s => this.getEffectiveStatus(s) === '처리예정')
      || Storage.getSubmissions()[0];
    if (!sample) { status.textContent = '테스트할 제출 데이터가 없습니다.'; return; }

    status.textContent = `⏳ "${sample.projectId}" 조회 중...`;
    const r = await Sync.lookupCentralColumns(url, gid, name, [sample.projectId], [colM, colN, colO]);
    if (!r.ok) {
      status.innerHTML = `<span style="color:var(--danger)">✗ 실패: ${r.error}</span>`;
      return;
    }
    const hit = r.map && r.map[sample.projectId];
    if (!hit) {
      status.innerHTML = `<span style="color:var(--warning)">⚠ 프로젝트ID "${sample.projectId}" 매칭 행 없음 (${r.found || 0}/${r.requested || 1})</span>`;
      return;
    }
    status.innerHTML = `<span style="color:var(--success)">✓ ${sample.projectId} → M(${colM})=${this._esc(String(hit[colM] ?? ''))} · N(${colN})=${this._esc(String(hit[colN] ?? ''))} · O(${colO})=${this._esc(String(hit[colO] ?? ''))}</span>`;
  },

  async syncPushAll() {
    if (!Sync.enabled()) { alert('먼저 URL을 저장하세요.'); return; }
    if (!confirm('로컬의 모든 데이터를 클라우드에 업로드합니다. 계속하시겠습니까?')) return;

    const status = document.getElementById('sync-status');
    const subs = Storage.getSubmissions();
    const projects = Storage.getProjects();

    status.textContent = '⏳ 프로젝트 목록 업로드 중...';
    await Sync.pushProjects(projects);

    let success = 0, failed = 0, uploaded = 0;
    for (let i = 0; i < subs.length; i++) {
      const sub = subs[i];
      status.textContent = `⏳ 제출 업로드 중... (${i + 1}/${subs.length})`;

      // 각 파일을 Drive 에 업로드 → URL 획득
      if (sub.files) {
        const newFiles = { ...sub.files };
        for (const docType of ['applicationReceipt', 'feeNotice', 'transferReceipt']) {
          const fileId = sub.files[docType];
          if (!fileId) continue;
          // 이미 Drive URL 이 있으면 스킵
          if (sub.files[docType + 'Url']) continue;
          const localFile = await FileDB.get(fileId);
          if (!localFile) continue;
          const blob = new Blob([localFile.data], { type: localFile.type });
          const fileObj = new File([blob], localFile.name, { type: localFile.type });
          const upRes = await Sync.uploadFile(fileObj, sub, docType);
          if (upRes.ok) {
            newFiles[docType + 'Url'] = upRes.url;
            uploaded++;
          }
        }
        sub.files = newFiles;
        Storage.updateSubmission(sub.id, { files: newFiles });
      }

      const r = await Sync.pushSubmission(sub);
      if (r.ok) success++; else failed++;
    }
    status.innerHTML = `<span style="color:var(--success)">✓ 제출 ${success}건 (파일 ${uploaded}개) 업로드 완료${failed ? ` / 실패 ${failed}건` : ''}</span>`;
  },

  async resetAll() {
    if (!confirm('모든 데이터를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;
    if (!confirm('정말로 초기화하시겠습니까?')) return;
    await Storage.resetAll();
    location.reload();
  },

  // ---------- 엑셀 / ZIP ----------
  /** 대시보드 필터를 납부대기 행에 적용 (엑셀/ZIP 공용) */
  _filteredPendingRows() {
    const rows = this._dashboardPendingRows || [];
    const fContractor = document.getElementById('filter-contractor').value;
    const fSearch = document.getElementById('filter-search').value.trim().toLowerCase();
    return rows.filter(row => {
      if (fContractor && row.a !== fContractor) return false;
      if (fSearch) {
        const hay = `${row.b} ${row.e} ${row.j} ${row.a}`.toLowerCase();
        if (!hay.includes(fSearch)) return false;
      }
      return true;
    });
  },

  async exportExcel() {
    // 전체 제출 현황(= 납부대기 시트) 데이터 사용
    if (!this._dashboardPendingRows) {
      await this.loadDashboardPending();
    }
    const filtered = this._filteredPendingRows();
    if (filtered.length === 0) { alert('전체 제출 현황 데이터가 없습니다.'); return; }

    const cfg = Storage.getConfig();

    // 1) 양식 파일 로드
    let templateBuf;
    try {
      const res = await fetch('assets/한전표준시설부담금납부_정리양식.xlsx');
      if (!res.ok) throw new Error('양식 파일 응답 ' + res.status);
      templateBuf = await res.arrayBuffer();
    } catch (e) {
      alert('양식 파일 로드 실패: ' + e.message);
      return;
    }

    const wb = XLSX.read(templateBuf, { type: 'array', cellStyles: true });
    const ws = wb.Sheets[wb.SheetNames[0]];

    // 2) M·N·O(엑셀 L·M·N) 값을 참조 시트(환경부 출금계좌)에서 조회
    const colM = (cfg.billingRefColM || 'AU').toUpperCase();
    const colN = (cfg.billingRefColN || 'AV').toUpperCase();
    const colO = (cfg.billingRefColO || 'AW').toUpperCase();
    const useRef = !!cfg.billingRefSheetUrl;
    const refUrl  = useRef ? cfg.billingRefSheetUrl  : cfg.centralProjectSheetUrl;
    const refGid  = useRef ? cfg.billingRefSheetGid  : cfg.centralProjectSheetGid;
    const refName = useRef ? cfg.billingRefSheetName : cfg.centralProjectSheetName;

    let centralMap = {};
    if (Sync.enabled() && refUrl) {
      const projectIds = [...new Set(filtered.map(r => r.b).filter(Boolean))];
      const r = await Sync.lookupCentralColumns(refUrl, refGid, refName, projectIds, [colM, colN, colO]);
      if (r.ok && r.map) {
        Object.keys(r.map).forEach(pid => {
          const hit = r.map[pid];
          centralMap[pid] = { m: hit[colM] ?? '', n: hit[colN] ?? '', o: hit[colO] ?? '' };
        });
      } else if (!r.ok) {
        console.warn('M·N·O 참조 시트 lookup 실패:', r.error);
      }
    }

    // 3) 데이터 행 채우기 (5행부터 시작)
    const startRow = 5;
    const STYLE_COLS = ['B','C','D','E','F','G','H','I','J','K','L','M','N'];
    const templateStyles = {};
    STYLE_COLS.forEach(col => {
      const cell = ws[col + startRow];
      if (cell && cell.s) templateStyles[col] = JSON.parse(JSON.stringify(cell.s));
    });

    const parseFee = v => Number(String(v || '').replace(/[^0-9.-]/g, '')) || 0;
    const parseCap = v => {
      const n = Number(String(v || '').replace(/[^0-9.]/g, ''));
      return isNaN(n) ? '' : n;
    };

    filtered.forEach((row, i) => {
      const r = startRow + i;
      const central = centralMap[row.b] || {};
      const set = (col, value, type) => {
        const addr = col + r;
        ws[addr] = { v: value, t: type || 's' };
        if (templateStyles[col]) ws[addr].s = templateStyles[col];
      };
      const setFormula = (col, formula, value) => {
        const addr = col + r;
        ws[addr] = { f: formula, v: value, t: 'n' };
        if (templateStyles[col]) ws[addr].s = templateStyles[col];
      };

      const baseFee = parseFee(row.g);
      const vat = Math.round(baseFee * 0.1);
      const total = baseFee + vat;
      const cap = parseCap(row.f);

      // B: 번호
      set('B', i + 1, 'n');
      // C: 프로젝트ID
      set('C', row.b || '', 's');
      // D: 현장명 (이미 거점 suffix 포함된 e열)
      set('D', row.e || '', 's');
      // E: 용량
      set('E', cap, cap !== '' ? 'n' : 's');
      // F: 표준부담금
      set('F', baseFee, 'n');
      // G: 부가세
      setFormula('G', `F${r}*0.1`, vat);
      // H: 청구금액
      setFormula('H', `F${r}+G${r}`, total);
      // I: 고객번호
      set('I', row.j ? Utils.formatCustomerNumber(row.j) : '', 's');
      // J: 은행
      set('J', row.k || '', 's');
      // K: 계좌
      set('K', row.l ? Utils.formatAccountNumber(row.l) : '', 's');
      // L: 참조 시트 M열값
      set('L', central.m != null ? central.m : '', typeof central.m === 'number' ? 'n' : 's');
      // M: 참조 시트 N열값
      set('M', central.n != null ? central.n : '', typeof central.n === 'number' ? 'n' : 's');
      // N: 참조 시트 O열값
      set('N', central.o != null ? central.o : '', typeof central.o === 'number' ? 'n' : 's');
    });

    // 4) 시트 범위 확장
    const lastRow = startRow + filtered.length - 1;
    const ref = XLSX.utils.decode_range(ws['!ref'] || 'A1:N1');
    ref.e.r = Math.max(ref.e.r, lastRow - 1);
    ref.e.c = Math.max(ref.e.c, 13);
    ws['!ref'] = XLSX.utils.encode_range(ref);

    // 5) 합계 행
    const totalRow = lastRow + 1;
    const sumBase = filtered.reduce((s, x) => s + parseFee(x.g), 0);
    ws['B' + totalRow] = { v: '합계', t: 's' };
    ws['F' + totalRow] = { f: `SUM(F${startRow}:F${lastRow})`, v: sumBase, t: 'n' };
    ws['G' + totalRow] = { f: `SUM(G${startRow}:G${lastRow})`, v: Math.round(sumBase * 0.1), t: 'n' };
    ws['H' + totalRow] = { f: `SUM(H${startRow}:H${lastRow})`, v: sumBase + Math.round(sumBase * 0.1), t: 'n' };
    ref.e.r = Math.max(ref.e.r, totalRow - 1);
    ws['!ref'] = XLSX.utils.encode_range(ref);

    // 6) 저장
    const today = new Date();
    const ymd = Utils.toYMD(today);
    XLSX.writeFile(wb, `한전표준시설부담금납부_${ymd}.xlsx`);

    cfg.lastExcelExport = new Date().toISOString();
    Storage.setConfig(cfg);
  },

  async exportZip() {
    // 전체 제출 현황(= 납부대기 시트) 데이터 사용
    if (!this._dashboardPendingRows) {
      await this.loadDashboardPending();
    }
    const filtered = this._filteredPendingRows();
    if (filtered.length === 0) { alert('전체 제출 현황 데이터가 없습니다.'); return; }

    // 각 납부대기 행과 매칭되는 내부 sub (파일 보유) 수집
    const submissions = [];
    let unmatchedCount = 0;
    filtered.forEach(row => {
      const sub = this._findMatchingSub(row);
      if (sub) submissions.push(sub);
      else unmatchedCount++;
    });

    if (submissions.length === 0) {
      alert(`첨부파일이 있는 항목이 없습니다.\n(전체 제출 ${filtered.length}건 중 내부 매칭 0건)`);
      return;
    }

    const cfg = Storage.getConfig();
    const btn = document.getElementById('btn-export-zip');
    const origText = btn.textContent;
    btn.disabled = true;

    // 단일 파일 다운로드 헬퍼 (로컬 → Drive 프록시)
    const fetchFile = async (sub, docType, stats) => {
      const rawId  = sub.files && sub.files[docType];
      const rawUrl = sub.files && sub.files[docType + 'Url'];
      if (!rawId && !rawUrl) return null;

      const { driveId, driveUrl, localUuid } = this._resolveFile(rawId, rawUrl);

      let fileBuf = null;
      let mimeType = 'application/pdf';
      let originalName = `${docType}.pdf`;

      // 1) 로컬 IndexedDB 시도
      const localKey = localUuid || rawId;
      if (localKey) {
        const local = await FileDB.get(localKey).catch(() => null);
        if (local && local.data) {
          fileBuf = local.data;
          originalName = local.name || originalName;
          mimeType = local.type || mimeType;
          stats.local++;
        }
      }

      // 2) Drive 프록시 시도
      if (!fileBuf && Sync.enabled() && (driveId || driveUrl)) {
        const proxy = await Sync.downloadDriveFile(driveId, driveUrl, true);
        if (proxy.ok && proxy.arrayBuffer) {
          fileBuf = proxy.arrayBuffer;
          originalName = proxy.name || originalName;
          mimeType = proxy.mimeType || mimeType;
          stats.proxy++;
        } else {
          stats.errors.push(`[${sub.projectId} ${docType}] 프록시 실패: ${proxy.error}`);
        }
      }
      if (!fileBuf) return null;

      // 이미지면 PDF 변환
      if (!Utils.isPdf(mimeType, originalName) && Utils.isImage(mimeType, originalName)) {
        try {
          fileBuf = await Utils.imageToPdf(fileBuf, mimeType);
          stats.imgConv++;
        } catch (e) {
          stats.errors.push(`[${sub.projectId} ${docType}] PDF 변환 실패: ${e.message}`);
        }
      }
      return fileBuf;
    };

    try {
      // 1) 중앙 시트에서 대기번호 lookup
      let centralMap = {};
      if (Sync.enabled() && cfg.centralProjectSheetUrl) {
        btn.textContent = '⏳ 중앙 시트 조회 중...';
        const projectIds = [...new Set(submissions.map(s => s.projectId))];
        const r = await Sync.lookupCentralColumns(
          cfg.centralProjectSheetUrl,
          cfg.centralProjectSheetGid,
          cfg.centralProjectSheetName,
          projectIds,
          ['A'],
        );
        if (r.ok) centralMap = r.map || {};
      }

      // 2) 같은 projectId 끼리 그룹화
      const projectGroups = {};
      for (const sub of submissions) {
        if (!sub.files) continue;
        if (!projectGroups[sub.projectId]) projectGroups[sub.projectId] = [];
        projectGroups[sub.projectId].push(sub);
      }
      const groupKeys = Object.keys(projectGroups);
      if (groupKeys.length === 0) { alert('첨부된 파일이 없습니다.'); return; }

      // 3) 그룹별 처리
      const zip = new JSZip();
      const stats = { local: 0, proxy: 0, imgConv: 0, errors: [] };
      let mergeCount = 0;

      for (let gi = 0; gi < groupKeys.length; gi++) {
        const pid = groupKeys[gi];
        const group = projectGroups[pid];
        const groupSize = group.length;
        btn.textContent = `⏳ 프로젝트 ${gi + 1}/${groupKeys.length} (${pid})...`;

        // 대표 submission — 폴더/파일명용
        // 다중 거점 → "N거점" (총 거점 수), 단일 → 거점명 없음 (사용자 입력 무시)
        const rep = { ...group[0] };
        rep.location = groupSize > 1 ? `${groupSize}거점` : '';

        const folder = Utils.getFolderPath(rep);
        const waitingNumber = (centralMap[pid] && centralMap[pid].A) || '';
        const extra = { waitingNumber };

        // docType 별 처리
        for (const docType of ['applicationReceipt', 'feeNotice', 'transferReceipt']) {
          const eligibleSubs = group.filter(s =>
            s.files && (s.files[docType] || s.files[docType + 'Url'])
          );
          if (eligibleSubs.length === 0) continue;

          let finalBuf = null;

          if (docType === 'applicationReceipt') {
            // 접수증: 거점 간 동일 파일 → 첫번째만 사용
            finalBuf = await fetchFile(eligibleSubs[0], docType, stats);
          } else {
            // 고지서/이체증: 모든 거점에서 다운로드 후 병합
            const buffers = [];
            for (const sub of eligibleSubs) {
              const buf = await fetchFile(sub, docType, stats);
              if (buf) buffers.push(buf);
            }
            if (buffers.length === 0) continue;
            if (buffers.length === 1) {
              finalBuf = buffers[0];
            } else {
              try {
                finalBuf = await Utils.mergePdfs(buffers);
                mergeCount++;
              } catch (e) {
                stats.errors.push(`[${pid} ${docType}] PDF 병합 실패: ${e.message}`);
                finalBuf = buffers[0]; // 폴백
              }
            }
          }

          if (!finalBuf) continue;
          const newName = Utils.getFileName(rep, docType, 'merged.pdf', extra);
          zip.folder(folder).file(newName, finalBuf);
        }

        // 비고.txt 추가 (모든 거점의 비고 합치기)
        const allNotes = group
          .map(s => {
            if (!s.notes || !s.notes.trim()) return '';
            const locTag = s.location ? `[${s.location}] ` : '';
            return `${locTag}${s.notes.trim()}`;
          })
          .filter(Boolean)
          .join('\n\n');

        if (allNotes) {
          const today = new Date();
          const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
          const content = `[비고]\n${allNotes}\n\n` +
            `프로젝트ID: ${pid}\n` +
            `프로젝트명: ${rep.projectName || ''}\n` +
            `시공사: ${rep.contractor}\n` +
            `다운로드일: ${ymd}\n`;
          const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
          const buf = await blob.arrayBuffer();
          const txtName = Utils.getFileName(rep, 'notes', '비고.txt', extra);
          zip.folder(folder).file(txtName, buf);
        }
      }

      btn.textContent = '⏳ ZIP 생성 중...';
      const blob = await zip.generateAsync({ type: 'blob' });
      saveAs(blob, `한전불입금_파일_${Utils.toYMD(new Date())}.zip`);

      const unmatchedNote = unmatchedCount > 0
        ? `\n⚠ 내부 데이터 미매칭(파일 없음): ${unmatchedCount}건 — ZIP 제외됨`
        : '';
      const summary = `✓ ZIP 다운로드 완료\n\n프로젝트 그룹: ${groupKeys.length}개\nPDF 병합: ${mergeCount}건\n로컬: ${stats.local}개 / 프록시: ${stats.proxy}개\n이미지→PDF: ${stats.imgConv}개\n실패: ${stats.errors.length}건${unmatchedNote}`;
      console.log(summary);
      if (stats.errors.length > 0 || unmatchedCount > 0) {
        console.warn('실패 목록:', stats.errors);
        alert(summary + (stats.errors.length > 0 ? '\n\n실패한 항목은 콘솔(F12)에서 확인하세요.' : ''));
      } else {
        alert(summary);
      }
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  },

  checkAutoExcelExport() {
    const cfg = Storage.getConfig();
    if (Utils.shouldExportExcel(cfg)) {
      setTimeout(() => {
        if (confirm(`오늘은 엑셀 통합 정리일입니다 (${Utils.formatDowTime(cfg.excelDow, cfg.excelTime)}).\n지금 엑셀을 다운로드하시겠습니까?`)) {
          this.exportExcel();
        }
      }, 800);
    }
  },
};
