// ============================================================
// 검토 Drawer — 좌측 폼값 · 우측 파일 미리보기 · 하단 확인완료
// ============================================================

const Review = {
  _row: null,
  _onDone: null,
  _currentPreview: null, // 'app' or 'fee'

  open(row, onDone) {
    this._row = row;
    this._onDone = onDone || (() => {});
    document.getElementById('review-title').textContent = `${row.b} · ${row.d || row.e || ''}`;
    document.getElementById('review-subtitle').textContent = `${row.a || '시공사 미상'} 제출 요청`;
    this._render();
    document.getElementById('review-overlay').classList.add('active');
  },

  close() {
    document.getElementById('review-overlay').classList.remove('active');
    this._row = null;
    this._currentPreview = null;
  },

  _render() {
    const r = this._row;
    const total = Utils.calcTotal(r.g);
    const vat = Utils.calcVat(r.g);
    const catLabel = r.c || Utils.categoryLabel(Utils.detectCategory(r.d));
    const catId = APP.categories.find(c => c.label === catLabel)?.id || Utils.detectCategory(r.d);

    document.getElementById('review-body').innerHTML = `
      <div class="review-grid">
        <!-- 좌측: 폼값 -->
        <div class="review-form-col">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
            <span class="pill ${Utils.categoryPill(catId)}">${Utils.esc(catLabel)}</span>
            <span class="tag">시트 ${r.rowNumber}행</span>
          </div>

          <div class="info-strip">
            <div class="info-item"><div class="info-label">시공사</div><div class="info-value">${Utils.esc(r.a || '-')}</div></div>
            <div class="info-item"><div class="info-label">프로젝트ID</div><div class="info-value mono">${Utils.esc(r.b)}</div></div>
          </div>

          <div class="card" style="margin:0;">
            <div class="card-title">📌 프로젝트 정보</div>
            <div class="form-grid">
              <label class="field span-2 field-auto-filled"><span>현장명</span><input id="rv-d" type="text" value="${Utils.esc(r.d || '')}" readonly /></label>
              <label class="field span-2 field-auto-filled"><span>도로명 주소</span><input id="rv-e" type="text" value="${Utils.esc(r.e || '')}" readonly /></label>
              <label class="field"><span>대기번호</span><input id="rv-m" type="text" value="${Utils.esc(r.m || '')}" /></label>
              <label class="field"><span>계약합계</span><input id="rv-n" type="text" value="${Utils.esc(r.n || '')}" /></label>
            </div>
          </div>

          <div class="card">
            <div class="card-title">💰 납부 정보</div>
            <div class="form-grid">
              <label class="field"><span>용량</span><input id="rv-f" type="text" value="${Utils.esc(r.f || '')}" /></label>
              <label class="field"><span>표준시설부담금</span><input id="rv-g" type="number" value="${Utils.parseNum(r.g)}" /></label>
              <label class="field"><span>부가세 (자동)</span><input type="text" value="${Utils.fmtMoney(vat)}" readonly class="field-readonly"/></label>
              <label class="field"><span>청구금액 (자동)</span><input type="text" value="${Utils.fmtMoney(total)}" readonly class="field-readonly"/></label>
              <label class="field"><span>고객번호</span><input id="rv-j" type="text" value="${Utils.esc(r.j || '')}" /></label>
              <label class="field"><span>은행</span><input id="rv-k" type="text" value="${Utils.esc(r.k || '')}" /></label>
              <label class="field span-2"><span>계좌번호</span><input id="rv-l" type="text" value="${Utils.esc(r.l || '')}" /></label>
              <label class="field span-2"><span>비고</span><textarea id="rv-r" rows="2">${Utils.esc(r.r || '')}</textarea></label>
            </div>
          </div>
        </div>

        <!-- 우측: 파일 미리보기 -->
        <div class="review-preview-col">
          <div class="preview-tabs">
            <button class="preview-tab" data-doc="app" ${!r.s ? 'disabled' : ''}>📄 전기사용신청접수증 ${r.s ? '' : '<span class="muted">(없음)</span>'}</button>
            <button class="preview-tab" data-doc="fee" ${!r.t ? 'disabled' : ''}>📄 시설부담금 고지서 ${r.t ? '' : '<span class="muted">(없음)</span>'}</button>
          </div>
          <div id="preview-frame" class="preview-frame">
            <div class="preview-empty">파일을 선택하세요</div>
          </div>
        </div>
      </div>
    `;

    document.querySelectorAll('#review-body .preview-tab').forEach(btn => {
      btn.onclick = () => this._showPreview(btn.dataset.doc);
    });

    // g값 변경 시 부가세/합계 자동 재계산 (실시간)
    document.getElementById('rv-g').oninput = e => {
      const g = Utils.parseNum(e.target.value);
      const inputs = document.querySelectorAll('#review-body .field-readonly input');
      inputs[0].value = Utils.fmtMoney(Utils.calcVat(g));
      inputs[1].value = Utils.fmtMoney(Utils.calcTotal(g));
    };

    // 기본으로 첫 번째 사용 가능한 문서 표시
    if (r.s) this._showPreview('app');
    else if (r.t) this._showPreview('fee');

    // 하단 버튼 바인딩
    document.getElementById('btn-review-confirm').onclick = () => this._confirm();
    document.getElementById('btn-review-delete').onclick = () => this._delete();
    document.getElementById('btn-review-flex').onclick = () => this._flexStub();
  },

  _showPreview(doc) {
    this._currentPreview = doc;
    document.querySelectorAll('#review-body .preview-tab').forEach(b => b.classList.toggle('active', b.dataset.doc === doc));
    const frame = document.getElementById('preview-frame');
    const url = doc === 'app' ? this._row.s : this._row.t;
    if (!url) { frame.innerHTML = `<div class="preview-empty">파일이 없습니다</div>`; return; }
    if (/^https?:\/\//.test(url)) {
      // Drive URL: iframe 로 preview
      // /view → /preview 로 치환
      const embed = url.replace(/\/view.*$/, '/preview').replace(/\/edit.*$/, '/preview');
      frame.innerHTML = `<iframe src="${Utils.esc(embed)}" allow="autoplay"></iframe>`;
    } else {
      frame.innerHTML = `<div class="preview-empty">미리보기 불가</div>`;
    }
  },

  previewUrl(ev, url, title) {
    ev.stopPropagation();
    if (!url) return;
    Preview.open(title, url);
  },

  _readFormValues() {
    const $ = id => document.getElementById(id);
    return {
      f: $('rv-f').value.trim(),
      g: Utils.parseNum($('rv-g').value),
      j: $('rv-j').value.trim(),
      k: $('rv-k').value.trim(),
      l: $('rv-l').value.trim(),
      m: $('rv-m').value.trim(),
      n: $('rv-n').value.trim(),
      r: $('rv-r').value.trim(),
    };
  },

  async _confirm() {
    const r = this._row;
    if (!confirm('이 항목을 확인완료 처리하시겠습니까?\n납부내역 시트로 이동되고 파일은 G드라이브에 저장됩니다.')) return;

    Utils.showLoading('납부내역에 기록 중...');
    const cfg = Store.getConfig();
    const edits = this._readFormValues();
    const catLabel = r.c || Utils.categoryLabel(Utils.detectCategory(r.d));

    // 납부내역 append (기존 대기 데이터 + 편집값)
    const row = {
      a: r.a || '',
      b: r.b,
      c: catLabel,
      d: r.d || '',
      e: r.e || '',
      f: edits.f,
      g: edits.g,
      j: edits.j,
      k: edits.k,
      l: edits.l,
      m: edits.m,
      n: edits.n,
      o: r.o || '',
      p: Utils.toYMD(Utils.thisThursday()),
      r: edits.r,
      s: r.s || '',
      t: r.t || '',
    };
    const appR = await API.appendProcessing(row);
    if (!appR || !appR.ok) {
      Utils.hideLoading();
      Utils.toast('납부내역 기록 실패: ' + (appR && appR.error || ''));
      return;
    }

    // Drive 폴더에 파일 사본 저장 (있는 경우)
    if (cfg.processedFolderId && (r.s || r.t)) {
      Utils.showLoading('G드라이브 폴더에 저장 중...');
      const sub = { projectId: r.b, projectName: r.d || r.e, contractor: r.a || '' };
      const folderName = Utils.buildFolderName(sub);
      const files = [];
      if (r.s) {
        const id = this._extractDriveId(r.s);
        if (id) files.push({ sourceFileId: id, name: Utils.buildFileName(sub, 'applicationReceipt') });
      }
      if (r.t) {
        const id = this._extractDriveId(r.t);
        if (id) files.push({ sourceFileId: id, name: Utils.buildFileName(sub, 'feeNotice', { waitingNumber: r.m }) });
      }
      if (files.length > 0) {
        await API.copyToProcessedFolder(cfg.processedFolderId, folderName, files);
      }
    }

    // 납부대기에서 삭제
    Utils.showLoading('납부대기에서 제거 중...');
    await API.deletePendingMatching({ a: r.a || '', b: r.b, e: r.e || '' });

    Utils.hideLoading();
    Utils.toast('✓ 확인완료 처리되었습니다.');
    this.close();
    this._onDone();
  },

  _extractDriveId(url) {
    if (!url) return '';
    const m = String(url).match(/\/d\/([a-zA-Z0-9-_]{10,})|[?&]id=([a-zA-Z0-9-_]{10,})/);
    return m ? (m[1] || m[2]) : '';
  },

  async _delete() {
    if (!confirm('이 납부대기 항목을 삭제하시겠습니까?\n(납부내역으로 이동되지 않고 완전히 삭제)')) return;
    Utils.showLoading('삭제 중...');
    const r = this._row;
    await API.deletePendingMatching({ a: r.a || '', b: r.b, e: r.e || '' });
    Utils.hideLoading();
    this.close();
    this._onDone();
  },

  _flexStub() {
    Utils.toast('FLEX 지출결의서 연동은 다음 릴리즈에서 추가됩니다.\n\n지금은 관리자가 직접 FLEX에서 지출결의서를 작성해주세요.');
  },
};
