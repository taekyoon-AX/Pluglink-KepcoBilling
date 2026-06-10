// ============================================================
// Contractor View Logic
// ============================================================

const ContractorView = {
  projectBlockCount: 0,
  locRowCount: 0,
  pendingFiles: {},  // { blockId: { applicationReceipt: File, locations: { locId: { feeNotice: File } } } }
  remoteProjects: {},  // contractor's project sheet (id -> name)

  async init() {
    const auth = Auth.current();
    document.getElementById('contractor-badge').textContent = auth.name;
    document.getElementById('contractor-badge').className = 'badge contractor';

    // 탭 바인딩
    document.querySelectorAll('#view-contractor .tab').forEach(btn => {
      btn.onclick = () => this.switchTab(btn.dataset.tab);
    });

    document.getElementById('btn-contractor-logout').onclick = () => App.logout();
    document.getElementById('btn-add-row').onclick = () => this.addProjectBlock();
    document.getElementById('btn-submit-all').onclick = () => this.submitAll();
    document.getElementById('btn-import-excel').onclick = () => {
      document.getElementById('excel-import-input').click();
    };
    document.getElementById('excel-import-input').onchange = (e) => this.importExcel(e.target.files[0]);
    document.getElementById('btn-download-template').onclick = () => this.downloadTemplate();
    const filterStatusEl = document.getElementById('history-filter-status');
    if (filterStatusEl) filterStatusEl.onchange = () => this.renderHistory();
    const refreshHistBtn = document.getElementById('btn-refresh-history');
    if (refreshHistBtn) refreshHistBtn.onclick = () => this.loadPaymentHistory();

    this.projectBlockCount = 0;
    this.locRowCount = 0;
    this.pendingFiles = {};
    document.getElementById('submit-rows').innerHTML = '';

    this.renderDeadlineInfo();
    this.loadPaymentHistory();

    // 시공사 프로젝트 시트 로드
    await this.loadContractorProjects();

    this.addProjectBlock(); // 기본 1개 블록
  },

  async loadContractorProjects() {
    const auth = Auth.current();
    const globalCfg = Storage.getConfig();
    const contractorCfg = Storage.getContractorConfig(auth.id);
    const sourceEl = document.getElementById('contractor-project-source');

    // 1순위: 중앙 프로젝트 시트 (시공사별 필터)
    if (globalCfg.centralProjectSheetUrl) {
      sourceEl.innerHTML = '⏳ 중앙 프로젝트 시트에서 시공사 매칭 중...';
      const r = await Sync.fetchProjectsForContractor(
        globalCfg.centralProjectSheetUrl,
        globalCfg.centralProjectSheetGid,
        globalCfg.centralProjectSheetName,
        auth.name,
      );
      if (r.ok) {
        this.remoteProjects = r.projects || {};
        const count = Object.keys(this.remoteProjects).length;
        sourceEl.innerHTML = `<span style="color:var(--success)">✓ 중앙 시트 매칭: ${count}개 프로젝트 로드됨</span> <span class="muted">(${auth.name} 관련, 읽기 전용)</span>`;
        return;
      } else {
        sourceEl.innerHTML = `<span style="color:var(--warning)">⚠ 중앙 시트 실패: ${r.error}</span> — 시공사별 시트를 시도합니다...`;
      }
    }

    // 2순위: 시공사별 전용 시트
    if (contractorCfg && contractorCfg.projectSheetUrl) {
      const r = await Sync.fetchContractorProjects(contractorCfg.projectSheetUrl, contractorCfg.projectSheetGid);
      if (r.ok) {
        this.remoteProjects = r.projects || {};
        const count = Object.keys(this.remoteProjects).length;
        sourceEl.innerHTML = `<span style="color:var(--success)">✓ 시공사 시트: ${count}개 프로젝트 로드됨</span>`;
        return;
      } else {
        sourceEl.innerHTML = `<span style="color:var(--danger)">✗ 프로젝트 시트 로드 실패: ${r.error || '알 수 없음'}</span>`;
        this.remoteProjects = {};
        return;
      }
    }

    // 3순위: 연결된 시트 없음 → 로컬 프로젝트만
    sourceEl.innerHTML = '<span style="color:var(--muted)">연결된 프로젝트 시트가 없습니다. 관리자 설정에서 중앙 시트 URL 을 입력하세요.</span>';
    this.remoteProjects = {};
  },

  switchTab(tab) {
    document.querySelectorAll('#view-contractor .tab').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    document.querySelectorAll('#view-contractor .panel').forEach(p => {
      p.classList.toggle('active', p.id === `panel-${tab}`);
    });
    if (tab === 'history') this.loadPaymentHistory();
  },

  renderDeadlineInfo() {
    const cfg = Storage.getConfig();
    const deadline = Utils.getCurrentDeadline(cfg);
    const processDate = Utils.getCurrentProcessDate(cfg);
    const now = new Date();
    const hoursLeft = Math.max(0, Math.floor((deadline - now) / (1000 * 60 * 60)));
    const info = `📅 금주 입력 마감: <strong>${Utils.describeDate(deadline)} ${cfg.deadlineTime}</strong>` +
      ` (${hoursLeft}시간 남음) · 마감 내 제출 시 처리예정일: <strong>${Utils.describeDate(processDate)}</strong>`;
    document.getElementById('contractor-deadline-info').innerHTML = info;
  },

  // ================== 프로젝트 블록 ==================
  getProjectOptions() {
    const combined = { ...Storage.getProjects(), ...this.remoteProjects };
    return Object.entries(combined)
      .map(([id, name]) => `<option value="${id}">${id} — ${name}</option>`)
      .join('');
  },

  addProjectBlock(prefill = null) {
    const blockId = 'pb-' + (++this.projectBlockCount);
    this.pendingFiles[blockId] = { applicationReceipt: null, locations: {} };
    const projectOptions = this.getProjectOptions();

    const block = document.createElement('div');
    block.className = 'submit-row project-block';
    block.dataset.blockId = blockId;
    block.innerHTML = `
      <div class="submit-row-header">
        <h4>프로젝트 #${this.projectBlockCount}</h4>
        <button class="ghost small" onclick="ContractorView.removeProjectBlock('${blockId}')">✕ 이 프로젝트 삭제</button>
      </div>
      <div class="submit-grid project-head">
        <label>
          <span class="req">프로젝트 ID</span>
          <input list="project-datalist-${blockId}" class="f-projectId" placeholder="프로젝트 ID" />
          <datalist id="project-datalist-${blockId}">${projectOptions}</datalist>
        </label>
        <label>
          <span>프로젝트명 (자동)</span>
          <input class="f-projectName" readonly placeholder="프로젝트 ID 입력 시 자동 입력" />
        </label>
        <label style="grid-column: span 2;">
          <span class="req">전기사용신청접수증 (프로젝트 공통)</span>
          <label class="file-input-wrap" data-target="applicationReceipt">
            <span>📎 파일 선택</span>
            <input type="file" accept="application/pdf,image/*" />
            <span class="file-name"></span>
          </label>
        </label>
      </div>
      <div class="loc-list" data-block="${blockId}"></div>
      <div class="loc-add-bar">
        <button class="small primary" onclick="ContractorView.addLocation('${blockId}')">+ 거점 추가</button>
      </div>
    `;
    document.getElementById('submit-rows').appendChild(block);

    // 프로젝트 ID 자동매칭
    const projInput = block.querySelector('.f-projectId');
    projInput.addEventListener('input', () => {
      const id = projInput.value.trim();
      const merged = { ...Storage.getProjects(), ...this.remoteProjects };
      const name = merged[id];
      block.querySelector('.f-projectName').value = name || '';
    });

    // 접수증 파일
    const apReceipt = block.querySelector('.file-input-wrap[data-target="applicationReceipt"]');
    const apInput = apReceipt.querySelector('input[type=file]');
    const apName = apReceipt.querySelector('.file-name');
    apInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        this.pendingFiles[blockId].applicationReceipt = file;
        apName.textContent = file.name;
        apReceipt.classList.add('has-file');
      }
    });

    // prefill 값 적용
    if (prefill) {
      if (prefill.projectId) {
        projInput.value = prefill.projectId;
        projInput.dispatchEvent(new Event('input'));
      }
      if (prefill.projectName) {
        block.querySelector('.f-projectName').value = prefill.projectName;
      }
    }

    // 기본 거점 1개
    this.addLocation(blockId, prefill && prefill.locations && prefill.locations[0]);

    // prefill에 거점이 더 있으면 추가
    if (prefill && prefill.locations) {
      for (let i = 1; i < prefill.locations.length; i++) {
        this.addLocation(blockId, prefill.locations[i]);
      }
    }

    return blockId;
  },

  removeProjectBlock(blockId) {
    const blocks = document.querySelectorAll('#submit-rows .project-block');
    if (blocks.length <= 1) {
      alert('최소 1개의 프로젝트는 필요합니다.');
      return;
    }
    document.querySelector(`[data-block-id="${blockId}"]`).remove();
    delete this.pendingFiles[blockId];
  },

  // ================== 거점 서브 행 ==================
  addLocation(blockId, prefill = null) {
    const locId = 'loc-' + (++this.locRowCount);
    this.pendingFiles[blockId].locations[locId] = { feeNotice: null };
    const list = document.querySelector(`.loc-list[data-block="${blockId}"]`);

    const idx = list.children.length + 1;
    const row = document.createElement('div');
    row.className = 'loc-row';
    row.dataset.locId = locId;
    row.innerHTML = `
      <div class="loc-head">
        <span class="loc-num">거점 ${idx}</span>
        <button class="ghost small" onclick="ContractorView.removeLocation('${blockId}', '${locId}')">✕</button>
      </div>
      <div class="submit-grid loc-grid">
        <label>
          <span>거점명</span>
          <input class="f-location" placeholder="(선택)" />
        </label>
        <label>
          <span>용량 (kW)</span>
          <input class="f-capacity" type="number" step="1" min="0" placeholder="(선택, 정수)"
                 oninput="this.value = this.value.replace(/[^0-9]/g, '').slice(0, 6)" />
        </label>
        <label>
          <span class="req">고객번호</span>
          <input class="f-customerNumber" placeholder="예: 10-3200-1323" />
        </label>
        <label>
          <span class="req">은행</span>
          <input class="f-customerBank" list="bank-list" placeholder="예: 신한" />
        </label>
        <label>
          <span class="req">계좌번호</span>
          <input class="f-customerAccount" placeholder="예: 562-17444-026400" />
        </label>
        <label>
          <span class="req">표준시설부담금 (원)</span>
          <input class="f-baseFee" type="text" placeholder="예: 1,000,000" />
        </label>
        <label>
          <span>부가세 (자동 10%)</span>
          <input class="f-vat" readonly />
        </label>
        <label>
          <span>청구금액 (자동)</span>
          <input class="f-total" readonly />
        </label>
        <label style="grid-column: span 2;">
          <span class="req">시설부담금고지서</span>
          <label class="file-input-wrap" data-target="feeNotice">
            <span>📎 파일 선택</span>
            <input type="file" accept="application/pdf,image/*" />
            <span class="file-name"></span>
          </label>
        </label>
        <label style="grid-column: 1 / -1;">
          <span>비고 (선택, 메모)</span>
          <textarea class="f-notes" rows="2"
            placeholder="중요한 정보가 있으면 메모해주세요. 처리 시 비고.txt 파일로 폴더에 저장됩니다."
            style="width:100%;padding:7px 9px;font-size:13px;border:1px solid var(--border);border-radius:5px;font-family:inherit;resize:vertical"></textarea>
        </label>
      </div>
    `;
    list.appendChild(row);

    // baseFee 자동계산
    const baseFeeInput = row.querySelector('.f-baseFee');
    baseFeeInput.addEventListener('input', () => {
      const raw = Utils.parseMoney(baseFeeInput.value);
      if (raw > 0) {
        baseFeeInput.value = Utils.formatMoneyRaw(raw);
        row.querySelector('.f-vat').value = Utils.formatMoneyRaw(Utils.calcVat(raw));
        row.querySelector('.f-total').value = Utils.formatMoneyRaw(Utils.calcTotal(raw));
      } else {
        row.querySelector('.f-vat').value = '';
        row.querySelector('.f-total').value = '';
      }
    });

    // 고지서 파일
    const fnWrap = row.querySelector('.file-input-wrap[data-target="feeNotice"]');
    const fnInput = fnWrap.querySelector('input[type=file]');
    const fnName = fnWrap.querySelector('.file-name');
    fnInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        this.pendingFiles[blockId].locations[locId].feeNotice = file;
        fnName.textContent = file.name;
        fnWrap.classList.add('has-file');
      }
    });

    // prefill
    if (prefill) {
      if (prefill.location) row.querySelector('.f-location').value = prefill.location;
      if (prefill.capacity != null && prefill.capacity !== '') row.querySelector('.f-capacity').value = prefill.capacity;
      if (prefill.customerNumber) row.querySelector('.f-customerNumber').value = prefill.customerNumber;
      if (prefill.customerBank) row.querySelector('.f-customerBank').value = prefill.customerBank;
      if (prefill.customerAccount) row.querySelector('.f-customerAccount').value = prefill.customerAccount;
      if (prefill.baseFee) {
        baseFeeInput.value = Utils.formatMoneyRaw(prefill.baseFee);
        baseFeeInput.dispatchEvent(new Event('input'));
      }
      if (prefill.notes) row.querySelector('.f-notes').value = prefill.notes;
    }

    return locId;
  },

  removeLocation(blockId, locId) {
    const list = document.querySelector(`.loc-list[data-block="${blockId}"]`);
    if (list.children.length <= 1) {
      alert('최소 1개의 거점은 필요합니다.');
      return;
    }
    list.querySelector(`[data-loc-id="${locId}"]`).remove();
    delete this.pendingFiles[blockId].locations[locId];
    // 번호 재계산
    list.querySelectorAll('.loc-row').forEach((r, i) => {
      r.querySelector('.loc-num').textContent = `거점 ${i + 1}`;
    });
  },

  // ================== 일괄 제출 ==================
  async submitAll() {
    const auth = Auth.current();
    const blocks = document.querySelectorAll('#submit-rows .project-block');
    const cfg = Storage.getConfig();
    const errors = [];
    const toSubmit = [];

    blocks.forEach((block, bIdx) => {
      const blockId = block.dataset.blockId;
      const projectId = block.querySelector('.f-projectId').value.trim();
      const projectName = block.querySelector('.f-projectName').value.trim();
      const applicationReceipt = this.pendingFiles[blockId].applicationReceipt;

      const locRows = block.querySelectorAll('.loc-row');
      locRows.forEach((row, lIdx) => {
        const locId = row.dataset.locId;
        const location = row.querySelector('.f-location').value.trim();
        const capacity = row.querySelector('.f-capacity').value.trim();
        const customerNumber = row.querySelector('.f-customerNumber').value.trim();
        const customerBank = row.querySelector('.f-customerBank').value.trim();
        const customerAccount = row.querySelector('.f-customerAccount').value.trim();
        const baseFee = Utils.parseMoney(row.querySelector('.f-baseFee').value);
        const notes = row.querySelector('.f-notes').value.trim();
        const feeNotice = this.pendingFiles[blockId].locations[locId].feeNotice;

        const rowErrs = [];
        if (!projectId) rowErrs.push('프로젝트 ID');
        if (!customerNumber) rowErrs.push('고객번호');
        if (!customerBank) rowErrs.push('은행');
        if (!customerAccount) rowErrs.push('계좌번호');
        if (!baseFee || baseFee <= 0) rowErrs.push('표준시설부담금');
        if (!applicationReceipt) rowErrs.push('접수증');
        if (!feeNotice) rowErrs.push('고지서');

        if (rowErrs.length > 0) {
          errors.push(`프로젝트 #${bIdx + 1} · 거점 ${lIdx + 1}: ${rowErrs.join(', ')} 필요`);
        } else {
          toSubmit.push({
            data: {
              id: Utils.uuid(),
              contractor: auth.id,
              submittedAt: new Date().toISOString(),
              projectId,
              projectName: projectName || ({ ...Storage.getProjects(), ...this.remoteProjects }[projectId]) || '',
              location,
              capacity,
              customerNumber,
              customerBank,
              customerAccount,
              baseFee,
              notes,
              scheduledProcessDate: Utils.calcScheduledDate(new Date(), cfg).toISOString(),
              files: {},
            },
            files: { applicationReceipt, feeNotice },
          });
        }
      });
    });

    if (errors.length > 0) {
      document.getElementById('submit-msg').innerHTML =
        `<span class="error">필수값 누락:<br>${errors.join('<br>')}</span>`;
      return;
    }

    // 기납부 중복 검사 — 본인 시공사의 제출 이력에 같은 프로젝트ID 있으면 경고
    const myHistory = Storage.getSubmissions(auth.id);
    const dupWarnings = [];
    toSubmit.forEach((t, i) => {
      const d = t.data;
      const dupes = myHistory.filter(h => h.projectId === d.projectId);
      if (dupes.length > 0) {
        const dupDates = dupes.map(h => Utils.toYMD(new Date(h.submittedAt))).join(', ');
        dupWarnings.push(`#${i + 1} 프로젝트 ${d.projectId} (이전 제출일: ${dupDates})`);
      }
    });
    if (dupWarnings.length > 0) {
      const msg = `⚠️ 기납부된 건이 있습니다. 확인 부탁드립니다.\n\n${dupWarnings.join('\n')}\n\n그래도 제출하시겠습니까?`;
      if (!confirm(msg)) {
        document.getElementById('submit-msg').innerHTML =
          `<span class="error">제출이 취소되었습니다.</span>`;
        return;
      }
    }

    // 같은 프로젝트ID 다중 거점 → 자동 1거점/2거점 부여 (사용자가 거점명 입력하면 그대로)
    const autoLocations = Utils.assignAutoLocations(toSubmit.map(t => t.data));
    toSubmit.forEach((t, i) => { t.data.location = autoLocations[i]; });

    const msgEl = document.getElementById('submit-msg');
    for (let i = 0; i < toSubmit.length; i++) {
      const item = toSubmit[i];
      msgEl.innerHTML = `<span class="info">⏳ 업로드 중... (${i + 1}/${toSubmit.length})</span>`;

      for (const [docType, file] of Object.entries(item.files)) {
        if (!file) continue;
        const fileId = Utils.uuid();
        await FileDB.save(fileId, file);
        item.data.files[docType] = fileId;

        if (Sync.enabled()) {
          const up = await Sync.uploadFile(file, item.data, docType);
          if (up.ok) {
            item.data.files[docType] = up.fileId;
            item.data.files[docType + 'Url'] = up.url;
          }
        }
      }
      Storage.addSubmission(item.data);
      if (Sync.enabled()) await Sync.pushSubmission(item.data);

      // 납부대기 시트에도 행 추가 (best-effort)
      if (Sync.enabled()) {
        try {
          const d = item.data;
          // 현장명: admin recordToProcessingSheet 와 동일한 포맷 (차수 제외, 거점만 suffix)
          // → 차수까지 포함하면 admin 측 매칭 실패로 납부대기 삭제가 안 되므로 동일하게 맞춤
          const parsed = Utils.parseProjectName(d.projectName || '');
          const cleanName = parsed.name || d.projectName || '';
          const locSuffix = d.location ? `-${d.location}` : '';
          const pendingRow = {
            a: auth.name || auth.id,            // A = 시공사 (서버에서 강제 덮어씀)
            b: d.projectId,                      // B = 프로젝트ID
            e: cleanName + locSuffix,            // E = 현장명
            f: d.capacity ? `${d.capacity} kW` : '', // F = 용량
            g: Number(d.baseFee) || 0,           // G = 표준시설부담금
            j: d.customerNumber || '',           // J = 고객번호
            k: d.customerBank || '',             // K = 은행
            l: d.customerAccount || '',          // L = 고객지정계좌
            r: d.notes || '',                    // R = 비고
          };
          const pr = await Sync.appendPendingRow(pendingRow);
          if (!pr.ok) console.warn('납부대기 추가 실패:', pr.error);
          else console.log(`✓ 납부대기 ${pr.rowNumber}행 추가 (${d.projectId})`);
        } catch (e) {
          console.warn('납부대기 추가 예외:', e);
        }
      }
    }

    msgEl.innerHTML =
      `<span class="info">✓ ${toSubmit.length}건이 제출되었습니다. 처리예정일: ${Utils.describeDate(toSubmit[0].data.scheduledProcessDate)}</span>`;

    // 폼 초기화
    this.projectBlockCount = 0;
    this.locRowCount = 0;
    this.pendingFiles = {};
    document.getElementById('submit-rows').innerHTML = '';
    this.addProjectBlock();
    this.loadPaymentHistory();
  },

  // ================== Excel 일괄 업로드 ==================
  async importExcel(file) {
    if (!file) return;
    const msgEl = document.getElementById('submit-msg');
    msgEl.innerHTML = '⏳ 엑셀 파싱 중...';

    try {
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab, { type: 'array' });
      const sheetName = wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });

      // 헤더 행 찾기 (프로젝트ID, 프로젝트명 이 들어있는 행)
      let headerRow = -1;
      for (let r = 0; r < Math.min(10, json.length); r++) {
        const joined = json[r].map(v => String(v || '')).join('|');
        if (/프로젝트ID|프로젝트\s*ID|프로젝트번호/.test(joined) && /프로젝트명|프로젝트\s*명/.test(joined)) {
          headerRow = r;
          break;
        }
      }
      if (headerRow < 0) {
        msgEl.innerHTML = '<span class="error">엑셀 양식을 인식하지 못했습니다. "📄 양식 다운로드" 버튼으로 표준 양식을 받아 사용하세요.</span>';
        return;
      }

      const header = json[headerRow].map(v => String(v || '').trim().replace(/\s/g, ''));
      const colIdx = {
        projectId: header.findIndex(h => /프로젝트ID|프로젝트번호/.test(h)),
        projectName: header.findIndex(h => /프로젝트명|프로젝트이름/.test(h)),
        location: header.findIndex(h => /거점|거점명/.test(h)),
        capacity: header.findIndex(h => /용량/.test(h)),
        baseFee: header.findIndex(h => /공급가|표준시설부담금|부담금$/.test(h)),
        customerNumber: header.findIndex(h => /고객번호/.test(h)),
        customerBank: header.findIndex(h => /^은행$/.test(h)),
        customerAccount: header.findIndex(h => /계좌$|계좌번호/.test(h)),
      };

      const rawRows = [];
      for (let r = headerRow + 1; r < json.length; r++) {
        const row = json[r];
        const pid = String(row[colIdx.projectId] || '').trim();
        if (!pid) continue;
        rawRows.push({
          projectId: pid,
          projectName: String(row[colIdx.projectName] || '').trim(),
          location: colIdx.location >= 0 ? String(row[colIdx.location] || '').trim() : '',
          capacity: colIdx.capacity >= 0 ? String(row[colIdx.capacity] || '').trim() : '',
          baseFee: colIdx.baseFee >= 0 ? Utils.parseMoney(row[colIdx.baseFee]) : 0,
          customerNumber: colIdx.customerNumber >= 0 ? String(row[colIdx.customerNumber] || '').trim() : '',
          customerBank: colIdx.customerBank >= 0 ? String(row[colIdx.customerBank] || '').trim() : '',
          customerAccount: colIdx.customerAccount >= 0 ? String(row[colIdx.customerAccount] || '').trim() : '',
        });
      }

      if (rawRows.length === 0) {
        msgEl.innerHTML = '<span class="error">엑셀에서 데이터 행을 찾지 못했습니다.</span>';
        return;
      }

      // 프로젝트 ID 로 그룹화
      const groups = {};
      for (const r of rawRows) {
        const key = r.projectId;
        if (!groups[key]) groups[key] = { projectId: r.projectId, projectName: r.projectName, locations: [] };
        groups[key].locations.push({
          location: r.location,
          capacity: r.capacity,
          baseFee: r.baseFee,
          customerNumber: r.customerNumber,
          customerBank: r.customerBank,
          customerAccount: r.customerAccount,
        });
      }

      // 폼 초기화 후 각 그룹을 블록으로 추가
      this.projectBlockCount = 0;
      this.locRowCount = 0;
      this.pendingFiles = {};
      document.getElementById('submit-rows').innerHTML = '';

      Object.values(groups).forEach(g => this.addProjectBlock(g));

      const totalLocations = rawRows.length;
      const projectCount = Object.keys(groups).length;
      msgEl.innerHTML = `<span class="info">✓ 프로젝트 ${projectCount}개, 거점 ${totalLocations}개가 불러와졌습니다. 각 거점의 첨부파일(접수증/고지서)을 수동으로 선택하고 제출하세요.</span>`;

      // 파일 입력 리셋
      document.getElementById('excel-import-input').value = '';
    } catch (err) {
      msgEl.innerHTML = `<span class="error">엑셀 파싱 실패: ${err.message || err}</span>`;
    }
  },

  async downloadTemplate() {
    // 원본 양식 (플러그링크 시공 준공 공식 양식)
    try {
      const res = await fetch('assets/한전표준시설부담금납부_양식.xlsx');
      if (!res.ok) throw new Error('양식 파일을 찾을 수 없습니다');
      const blob = await res.blob();
      const today = new Date();
      const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `한전표준시설부담금납부_${ymd}.xlsx`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1000);
    } catch (e) {
      alert('양식 다운로드 실패: ' + (e.message || e));
    }
  },

  // ================== 이력 ==================
  _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  },

  /**
   * 납부대기 + 납부내역 두 시트에서 본인 시공사 행을 동시 로드 (서버가 A열 필터링)
   */
  async loadPaymentHistory() {
    const statusEl = document.getElementById('history-status');
    if (!Sync.enabled()) {
      this._paymentHistoryRows = [];
      this._pendingHistoryRows = [];
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--warning)">⚠ 서버 연결이 설정되지 않아 납부 이력을 불러올 수 없습니다.</span>';
      this.renderHistory();
      return;
    }
    if (statusEl) statusEl.innerHTML = '⏳ 납부 이력 로드 중...';

    const [paidRes, pendingRes] = await Promise.all([
      Sync.readProcessingRows('', '', ''),
      Sync.readPendingRows('', '', ''),
    ]);

    if (paidRes.ok) {
      this._paymentHistoryRows = [...(paidRes.rows || [])].reverse();
    } else {
      this._paymentHistoryRows = [];
      console.warn('납부내역 로드 실패:', paidRes.error);
    }
    if (pendingRes.ok) {
      this._pendingHistoryRows = [...(pendingRes.rows || [])].reverse();
    } else {
      this._pendingHistoryRows = [];
      // 납부대기 시트 미설정은 경고 수준 (필수 X)
      console.warn('납부대기 로드:', pendingRes.error);
    }

    if (statusEl) {
      const parts = [];
      parts.push(`납부대기 ${this._pendingHistoryRows.length}건`);
      parts.push(`납부완료 ${this._paymentHistoryRows.length}건`);
      statusEl.innerHTML = `<span style="color:var(--success)">✓ ${parts.join(' · ')}</span>`;
    }
    this.renderHistory();
  },

  renderHistory() {
    this._renderPendingTable();
    this._renderPaidTable();
  },

  /** 카드 1: 납부 대기 (납부대기 시트) */
  _renderPendingTable() {
    const rows = this._pendingHistoryRows || [];
    const tbody = document.getElementById('contractor-pending-tbody');
    const countEl = document.getElementById('pending-count');
    if (!tbody) return;
    if (countEl) countEl.textContent = `(${rows.length}건)`;

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--muted);">대기 중인 납부 건이 없습니다.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(row => {
      const feeNum = row.g ? Number(String(row.g).replace(/[^0-9.-]/g, '')) : 0;
      const noteText = row.r || '';
      const noteDisplay = noteText
        ? (noteText.length > 14 ? this._esc(noteText.slice(0, 14)) + '…' : this._esc(noteText))
        : '✏️ 추가';
      return `
        <tr>
          <td><code>${this._esc(row.b)}</code></td>
          <td>${this._esc(row.e)}</td>
          <td>${this._esc(row.f)}</td>
          <td class="num">${feeNum ? feeNum.toLocaleString('ko-KR') : ''}</td>
          <td>${this._esc(Utils.formatCustomerNumber(row.j))}</td>
          <td>${this._esc(row.k)}</td>
          <td>${this._esc(Utils.formatAccountNumber(row.l))}</td>
          <td title="${this._esc(noteText)}" style="cursor:pointer;color:${noteText ? 'var(--primary)' : 'var(--muted)'}"
              onclick="ContractorView.editPendingNote(${row.rowNumber})">${noteDisplay}</td>
        </tr>
      `;
    }).join('');
  },

  /** 카드 2: 납부 완료 (납부내역 시트) */
  _renderPaidTable() {
    const rows = this._paymentHistoryRows || [];
    const tbody = document.getElementById('contractor-tbody');
    const countEl = document.getElementById('paid-count');
    if (!tbody) return;
    if (countEl) countEl.textContent = `(${rows.length}건)`;

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--muted);">완료된 납부 건이 없습니다.</td></tr>`;
      return;
    }

    const statusOf = (row) => row.q ? '처리완료' : '처리예정';
    tbody.innerHTML = rows.map(row => {
      const status = statusOf(row);
      const feeNum = row.g ? Number(String(row.g).replace(/[^0-9.-]/g, '')) : 0;
      const noteText = row.r || '';
      const noteDisplay = noteText
        ? (noteText.length > 14 ? this._esc(noteText.slice(0, 14)) + '…' : this._esc(noteText))
        : '✏️ 추가';
      return `
        <tr>
          <td><code>${this._esc(row.b)}</code></td>
          <td>${this._esc(row.e)}</td>
          <td>${this._esc(row.f)}</td>
          <td class="num">${feeNum ? feeNum.toLocaleString('ko-KR') : ''}</td>
          <td>${this._esc(Utils.formatCustomerNumber(row.j))}</td>
          <td>${this._esc(row.k)}</td>
          <td>${this._esc(Utils.formatAccountNumber(row.l))}</td>
          <td>${this._esc(row.p)}</td>
          <td><span class="status-pill status-${status}">${status}</span></td>
          <td title="${this._esc(noteText)}" style="cursor:pointer;color:${noteText ? 'var(--primary)' : 'var(--muted)'}"
              onclick="ContractorView.editNote(${row.rowNumber})">${noteDisplay}</td>
        </tr>
      `;
    }).join('');
  },

  /** 납부내역 시트 R열 비고 수정 */
  async editNote(rowNumber) {
    const rows = this._paymentHistoryRows || [];
    const row = rows.find(r => r.rowNumber === rowNumber);
    if (!row) return;
    const newNote = prompt('비고 입력:', row.r || '');
    if (newNote === null) return;
    const r = await Sync.updateProcessingNote(rowNumber, newNote);
    if (!r.ok) { alert('비고 저장 실패: ' + (r.error || '')); return; }
    row.r = newNote;
    this._renderPaidTable();
  },

  /** 납부대기 시트 R열 비고 수정 — 현재는 미지원 알림 (향후 update_pending_note 추가 시 가능) */
  async editPendingNote(rowNumber) {
    // 납부대기는 일괄제출 직후의 임시 상태로 admin 처리 전까지 짧게 머무름.
    // 비고 수정은 admin 확인완료 후 납부내역 카드에서 가능.
    alert('납부 대기 중인 항목의 비고는 관리자 처리 완료 후 "납부 완료" 카드에서 수정 가능합니다.');
  },

  shortNote(notes) {
    if (!notes) return '<span class="file-missing">-</span>';
    const s = String(notes);
    return s.length > 15 ? s.slice(0, 15) + '…' : s;
  },

  fileCell(sub, docType, isTransfer) {
    const fileId = sub.files && sub.files[docType];
    const fileUrl = sub.files && sub.files[docType + 'Url'];
    if (fileUrl) {
      return `<a class="file-btn" href="${fileUrl}" target="_blank">보기</a>`;
    }
    if (fileId) {
      return `<button class="file-btn" onclick="AdminView.viewFile('${fileId}')">보기</button>`;
    }
    return isTransfer
      ? '<span class="file-missing">처리 전</span>'
      : '<span class="file-missing">없음</span>';
  },
};
