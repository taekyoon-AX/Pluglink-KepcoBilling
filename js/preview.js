// ============================================================
// 파일 미리보기 (blob URL 또는 Drive URL)
// ============================================================

const Preview = {
  open(title, urlOrBuf, mime = 'application/pdf') {
    document.getElementById('preview-title').textContent = title || '파일 미리보기';
    const body = document.getElementById('preview-body');
    let url = urlOrBuf;
    if (urlOrBuf instanceof ArrayBuffer || (urlOrBuf && urlOrBuf.byteLength)) {
      url = Files.makeBlobUrl(urlOrBuf, mime);
    }
    if (/^image\//.test(mime)) {
      body.innerHTML = `<img src="${url}" style="max-width:100%;max-height:70vh;object-fit:contain;" />`;
    } else {
      body.innerHTML = `<iframe src="${url}" style="width:100%;height:75vh;border:none;"></iframe>`;
    }
    document.getElementById('preview-overlay').classList.add('active');
  },
  close() {
    document.getElementById('preview-overlay').classList.remove('active');
    document.getElementById('preview-body').innerHTML = '';
  },
};
