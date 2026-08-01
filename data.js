/* ============================================================
   기본 데이터 (씨드 데이터)
   이 파일만 교체/수정해도 대시보드가 그대로 새 데이터로 동작합니다.
   화면에서 추가/수정한 내용은 브라우저 localStorage에 별도로 쌓이고,
   이 파일의 내용과 합쳐져서 표시됩니다.
   ============================================================ */

const SEED_SITES = [
  { id: "SITE-A", name: "아산공장", location: "충남 아산", partCode: "CN-2201" },
  { id: "SITE-B", name: "대성전장", location: "베트남 하이퐁", partCode: "SH-4410" },
  { id: "SITE-C", name: "정우산업", location: "경북 구미", partCode: "TM-1187" },
];

const SEED_PRODUCTION = {
  "SITE-A": [
    { week: "W1", plan: 5000, actual: 4912, defect: 0.0114, util: 0.968 },
    { week: "W2", plan: 5000, actual: 5034, defect: 0.0097, util: 0.981 },
    { week: "W3", plan: 5200, actual: 5088, defect: 0.0132, util: 0.959 },
    { week: "W4", plan: 5000, actual: 4876, defect: 0.0108, util: 0.965 },
    { week: "W5", plan: 5100, actual: 5021, defect: 0.0121, util: 0.970 },
    { week: "W6", plan: 5000, actual: 4955, defect: 0.0095, util: 0.976 },
    { week: "W7", plan: 4900, actual: 4833, defect: 0.0118, util: 0.962 },
    { week: "W8", plan: 5000, actual: 4968, defect: 0.0105, util: 0.973 },
  ],
  "SITE-B": [
    { week: "W1", plan: 6000, actual: 5874, defect: 0.0122, util: 0.954 },
    { week: "W2", plan: 6000, actual: 5690, defect: 0.0131, util: 0.932 },
    { week: "W3", plan: 6100, actual: 5512, defect: 0.0119, util: 0.897 },
    { week: "W4", plan: 6000, actual: 5203, defect: 0.0124, util: 0.851 },
    { week: "W5", plan: 6000, actual: 4687, defect: 0.0128, util: 0.783 },
    { week: "W6", plan: 6000, actual: 4318, defect: 0.0115, util: 0.746 },
    { week: "W7", plan: 5800, actual: 4022, defect: 0.0120, util: 0.712 },
    { week: "W8", plan: 6000, actual: 3891, defect: 0.0117, util: 0.689 },
  ],
  "SITE-C": [
    { week: "W1", plan: 4000, actual: 3942, defect: 0.0138, util: 0.971 },
    { week: "W2", plan: 4000, actual: 3905, defect: 0.0147, util: 0.963 },
    { week: "W3", plan: 4100, actual: 3978, defect: 0.0162, util: 0.958 },
    { week: "W4", plan: 4000, actual: 3861, defect: 0.0184, util: 0.949 },
    { week: "W5", plan: 4000, actual: 3822, defect: 0.0241, util: 0.937 },
    { week: "W6", plan: 4000, actual: 3758, defect: 0.0315, util: 0.924 },
    { week: "W7", plan: 3900, actual: 3614, defect: 0.0387, util: 0.910 },
    { week: "W8", plan: 4000, actual: 3590, defect: 0.0462, util: 0.893 },
  ],
};

// sourceType: "official"(공식 통계) / "industry"(업계 추정) / "vendor"(협력사 자체 제시)
// 신뢰도는 이 순서로 높음 → 낮음. asOfDate는 그 지표를 확인한 기준일.
const SEED_COST_CASES = [
  {
    id: "case-1",
    siteId: "SITE-B",
    partCode: "SH-4410",
    label: "대성전장 · 서브하네스",
    requestedPrice: 13020,
    breakdown: [
      { category: "원재료비", basePrice: 7440, indexRate: 0.04, source: "LME 구리 가격지수", sourceType: "official", asOfDate: "2026-02-15" },
      { category: "노무비",   basePrice: 2480, indexRate: 0.05, source: "베트남 하이퐁 지역 최저임금 고시", sourceType: "official", asOfDate: "2026-01-01" },
      { category: "제조경비", basePrice: 1488, indexRate: 0.02, source: "산업용 전기요금 인상률(업계 리포트)", sourceType: "industry", asOfDate: "2026-01-20" },
      { category: "물류비",   basePrice: 620,  indexRate: 0.03, source: "동남아 해상운임지수", sourceType: "industry", asOfDate: "2026-02-01" },
      { category: "이윤/마진", basePrice: 372, indexRate: 0.00, source: "고정마진 정책 — 계약서 조항", sourceType: "official", asOfDate: "2025-12-01" },
    ],
  },
  {
    id: "case-2",
    siteId: "SITE-C",
    partCode: "TM-1187",
    label: "정우산업 · 터미널",
    requestedPrice: 10094,
    breakdown: [
      { category: "원재료비", basePrice: 5000, indexRate: 0.05, source: "황동 소재 가격지수", sourceType: "official", asOfDate: "2026-02-10" },
      { category: "노무비",   basePrice: 2500, indexRate: 0.08, source: "협력사가 자체 제시한 인건비 상승분", sourceType: "vendor", asOfDate: "2026-02-18" },
      { category: "제조경비", basePrice: 1300, indexRate: 0.04, source: "협력사가 자체 제시한 설비 감가상각", sourceType: "vendor", asOfDate: "2026-02-18" },
      { category: "물류비",   basePrice: 700,  indexRate: 0.05, source: "국내 화물 운임지수", sourceType: "industry", asOfDate: "2026-01-25" },
      { category: "이윤/마진", basePrice: 300, indexRate: 0.00, source: "고정마진 정책 — 계약서 조항", sourceType: "official", asOfDate: "2025-12-01" },
    ],
  },
  {
    id: "case-3",
    siteId: "SITE-A",
    partCode: "CN-2201",
    label: "아산공장 · 커넥터 유닛",
    requestedPrice: 8240,
    breakdown: [
      { category: "원재료비", basePrice: 4800, indexRate: 0.03, source: "PVC 소재 가격지수", sourceType: "official", asOfDate: "2026-02-12" },
      { category: "노무비",   basePrice: 1600, indexRate: 0.03, source: "정기 임금협상 결과(단체협약서)", sourceType: "official", asOfDate: "2026-01-05" },
      { category: "제조경비", basePrice: 800,  indexRate: 0.02, source: "산업용 전기요금 인상률(업계 리포트)", sourceType: "industry", asOfDate: "2026-01-20" },
      { category: "물류비",   basePrice: 400,  indexRate: 0.02, source: "국내 화물 운임지수", sourceType: "industry", asOfDate: "2026-01-25" },
      { category: "이윤/마진", basePrice: 400, indexRate: 0.00, source: "고정마진 정책 — 계약서 조항", sourceType: "official", asOfDate: "2025-12-01" },
    ],
  },
];

const SOURCE_TYPE_LABEL = {
  official: { label: "공식 통계", cls: "src-official" },
  industry: { label: "업계 추정", cls: "src-industry" },
  vendor:   { label: "협력사 자체 제시", cls: "src-vendor" },
};
