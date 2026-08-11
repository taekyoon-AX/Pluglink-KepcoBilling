// ============================================================
// 앱 상수 (배포 시 수정 가능)
// ============================================================

// Apps Script 웹앱 URL. 배포 후 여기에 넣으면 사용자가 설정 안해도 됨.
const CLOUD_SYNC_URL = '';

const APP = {
  name: '한전표준시설부담금 납부시스템',
  brand: 'PLUGLINK',
  version: '2.0.0',

  // 사업 구분 (시트에 자동 태깅)
  categories: [
    { id: 'env25',   label: '25년환경부', pill: 'pill-25env' },
    { id: 'private', label: '민자사업',   pill: 'pill-private' },
    { id: 'env26',   label: '26년환경부', pill: 'pill-26env' },
  ],

  // 시트 컬럼 스펙 (납부대기 · 납부내역 공통)
  // A: 시공사 · B: 프로젝트ID · C: 사업구분 · D: 현장명 · E: 도로명주소
  // F: 용량 · G: 표준시설부담금 · H: 부가세(수식) · I: 청구금액(수식)
  // J: 고객번호 · K: 은행 · L: 계좌번호
  // M: 대기번호 · N: 사업비(계약합계) · O: (여유)
  // P: 처리날짜 · Q: 완료확인(체크박스) · R: 비고
  // S: 접수증 URL · T: 고지서 URL · U: FLEX 지출결의서 ID
  sheetCols: {
    a: 1,  b: 2,  c: 3,  d: 4,  e: 5,
    f: 6,  g: 7,  h: 8,  i: 9,
    j: 10, k: 11, l: 12,
    m: 13, n: 14, o: 15,
    p: 16, q: 17, r: 18,
    s: 19, t: 20, u: 21,
  },

  // 시공사 입력 필드 (필수)
  contractorFields: ['b','f','g','j','k','l'],

  // 파일 종류
  docTypes: {
    applicationReceipt: { label: '전기사용신청접수증', short: '접수증' },
    feeNotice:          { label: '한전 표준시설부담금 고지서', short: '고지서' },
  },
};
