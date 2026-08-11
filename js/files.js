// ============================================================
// 파일 처리 (이미지/PDF → PDF, 미리보기용 blob URL, 이름변경)
// ============================================================

const Files = {
  /**
   * File 객체 → PDF ArrayBuffer.
   * 이미지면 PDF로 변환. PDF면 그대로.
   */
  async toPdf(file) {
    if (!file) return null;
    const buf = await file.arrayBuffer();
    if (Utils.isPdf(file.type, file.name)) return buf;
    if (Utils.isImage(file.type, file.name)) {
      return await Utils.imageToPdf(buf, file.type);
    }
    return null;
  },

  /** PDF ArrayBuffer + 파일명 → File 객체 */
  toFile(arrayBuffer, name, mime = 'application/pdf') {
    return new File([arrayBuffer], name, { type: mime });
  },

  /** blob URL 생성 (미리보기용) */
  makeBlobUrl(arrayBuffer, mime = 'application/pdf') {
    const blob = new Blob([arrayBuffer], { type: mime });
    return URL.createObjectURL(blob);
  },

  /** 여러 PDF 병합 (pdf-lib) */
  async mergePdfs(bufs) {
    if (!bufs || bufs.length === 0) return null;
    if (bufs.length === 1) return bufs[0];
    const { PDFDocument } = window.PDFLib;
    const merged = await PDFDocument.create();
    for (const buf of bufs) {
      try {
        const src = await PDFDocument.load(buf, { ignoreEncryption: true });
        const pages = await merged.copyPages(src, src.getPageIndices());
        pages.forEach(p => merged.addPage(p));
      } catch (e) { console.warn('merge skip:', e.message); }
    }
    return await merged.save();
  },

  /** ArrayBuffer → base64 (chunk 방식) */
  toBase64(buf) {
    const bytes = new Uint8Array(buf);
    const chunk = 8192;
    let bin = '';
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    }
    return btoa(bin);
  },
};
