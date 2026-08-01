/* ============================================================
   저장소 계층
   최초 실행 시 data.js의 씨드 데이터를 localStorage에 복사해두고,
   이후에는 전부 localStorage 기준으로 읽고 쓴다.
   → 화면에서 추가/수정한 내용이 바로 반영되고, 새로고침해도 유지된다.
   → data.js만 통째로 교체하면(협력사가 바뀌면) "초기화" 버튼으로 새 데이터로 리셋할 수 있다.
   ============================================================ */

const KEYS = {
  sites: "hanbit_sites",
  production: "hanbit_production",
  costCases: "hanbit_cost_cases",
  log: "hanbit_decision_log",
};

function loadStore(key, seed) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  const copy = JSON.parse(JSON.stringify(seed));
  saveStore(key, copy);
  return copy;
}

function saveStore(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
}

let sitesStore = loadStore(KEYS.sites, SEED_SITES);
let productionStore = loadStore(KEYS.production, SEED_PRODUCTION);
let costCasesStore = loadStore(KEYS.costCases, SEED_COST_CASES);
let decisionLog = loadStore(KEYS.log, []);

function resetAllData() {
  if (!confirm("모든 데이터를 초기 예시 데이터로 되돌립니다. 화면에서 추가/수정한 내용과 검토 이력이 사라집니다. 계속할까요?")) return;
  sitesStore = JSON.parse(JSON.stringify(SEED_SITES));
  productionStore = JSON.parse(JSON.stringify(SEED_PRODUCTION));
  costCasesStore = JSON.parse(JSON.stringify(SEED_COST_CASES));
  decisionLog = [];
  saveStore(KEYS.sites, sitesStore);
  saveStore(KEYS.production, productionStore);
  saveStore(KEYS.costCases, costCasesStore);
  saveStore(KEYS.log, decisionLog);
  currentSelectedSite = sitesStore[0] ? sitesStore[0].id : null;
  currentCaseId = costCasesStore[0] ? costCasesStore[0].id : null;
  render();
}

function genId(prefix) {
  return prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/* ============================================================
   계산 로직
   ============================================================ */

function computeCostReview(costCase) {
  const baseTotal = costCase.breakdown.reduce((sum, r) => sum + r.basePrice, 0);
  const justifiedDelta = costCase.breakdown.reduce((sum, r) => sum + r.basePrice * r.indexRate, 0);
  const justifiedTotal = baseTotal + justifiedDelta;
  const justifiedRate = baseTotal ? justifiedDelta / baseTotal : 0;

  const requestedDelta = costCase.requestedPrice - baseTotal;
  const requestedRate = baseTotal ? requestedDelta / baseTotal : 0;

  const gap = requestedRate - justifiedRate;

  let verdict, verdictType;
  if (gap > 0.01) {
    verdict = "요청 인상률이 근거지표 대비 과다합니다. 협력사에 항목별 소명을 요청해야 합니다.";
    verdictType = "reject-lean";
  } else if (gap < -0.01) {
    verdict = "근거지표상 타당 인상률이 요청보다 높습니다. 오히려 협상 여지가 있습니다.";
    verdictType = "negotiate";
  } else {
    verdict = "요청 인상률이 근거지표와 대체로 일치합니다. 승인을 검토할 수 있습니다.";
    verdictType = "approve-lean";
  }

  // 신뢰도 요약: vendor(협력사 자체 제시) 비중이 높을수록 추가 검증 필요
  const vendorWeight = costCase.breakdown
    .filter(r => r.sourceType === "vendor")
    .reduce((s, r) => s + r.basePrice, 0) / (baseTotal || 1);

  return { baseTotal, justifiedDelta, justifiedTotal, justifiedRate, requestedRate, gap, verdict, verdictType, vendorWeight };
}

function analyzeSite(siteId) {
  const records = productionStore[siteId] || [];
  if (records.length === 0) {
    return { records: [], tag: "데이터 없음", status: "데이터 없음", statusColor: "gray", subText: "생산 실적 데이터가 없습니다", actualChangeRate: 0, utilChangeRate: 0, lastUtil: 0 };
  }
  const first = records[0];
  const last = records[records.length - 1];

  const actualChangeRate = (last.actual - first.actual) / first.actual;
  const defectChangeAbs = last.defect - first.defect;

  let consecutiveDefectRise = 0;
  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1].defect;
    const cur = records[i].defect;
    if (prev > 0 && (cur - prev) / prev >= 0.15) {
      consecutiveDefectRise++;
    } else {
      consecutiveDefectRise = 0;
    }
  }

  let tag, status, statusColor, subText;

  if (actualChangeRate <= -0.10 && Math.abs(defectChangeAbs) <= 0.003) {
    tag = "자재/설비 의심";
    status = "생산량 크게 감소";
    statusColor = "red";
    subText = `불량률 안정적 · 가동률 ${Math.round(last.util * 100)}% → 원자재·설비 문제로 추정`;
  } else if (consecutiveDefectRise >= 3) {
    tag = "품질/공정 의심";
    status = "불량률 지속 상승";
    statusColor = "amber";
    subText = `생산량 안정적 · 가동률 ${Math.round(last.util * 100)}% → 품질·공정 문제로 추정`;
  } else {
    tag = "정상";
    status = "정상 가동 중";
    statusColor = "green";
    subText = `계획 대비 실적 안정 · 가동률 ${Math.round(last.util * 100)}%`;
  }

  return { records, tag, status, statusColor, subText, actualChangeRate, lastUtil: last.util };
}

/* ============================================================
   SVG 차트
   ============================================================ */

function buildBarChart(records) {
  if (records.length === 0) return `<p class="empty">표시할 데이터가 없습니다</p>`;

  const W = 640, H = 190, padL = 36, padR = 8, padT = 10, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxVal = Math.max(...records.map(r => Math.max(r.plan, r.actual))) * 1.08;
  const n = records.length;
  const groupW = plotW / n;
  const barW = groupW * 0.32;

  const yFor = v => padT + plotH - (v / maxVal) * plotH;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(t => {
    const y = padT + plotH - t * plotH;
    const label = Math.round(maxVal * t).toLocaleString();
    return `
      <line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" class="grid-line" />
      <text x="${padL - 6}" y="${y + 3}" class="axis-label" text-anchor="end">${label}</text>
    `;
  }).join("");

  const bars = records.map((r, i) => {
    const x0 = padL + i * groupW + (groupW - barW * 2 - 4) / 2;
    const planY = yFor(r.plan);
    const actualY = yFor(r.actual);
    const ratio = r.plan ? r.actual / r.plan : 1;
    const actualCls = ratio < 0.9 ? "bar-actual-warn" : "bar-actual-ok";
    const achieveRate = r.plan ? Math.round((r.actual / r.plan) * 100) : 0;

    return `
      <g>
        <rect x="${x0}" y="${planY}" width="${barW}" height="${padT + plotH - planY}" class="bar-plan bar-hit"
          data-week="${r.week}" data-label="계획" data-value="${Math.round(r.plan).toLocaleString()}개"></rect>
        <rect x="${x0 + barW + 4}" y="${actualY}" width="${barW}" height="${padT + plotH - actualY}" class="${actualCls} bar-hit"
          data-week="${r.week}" data-label="실적" data-value="${Math.round(r.actual).toLocaleString()}개 (달성률 ${achieveRate}%)"></rect>
        <text x="${x0 + barW + 2}" y="${H - 8}" class="axis-label" text-anchor="middle">${r.week}</text>
      </g>
    `;
  }).join("");

  return `
    <div class="chart-wrap-inner">
      <svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="주차별 계획 대비 실적 차트">
        ${gridLines}
        ${bars}
        <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" class="axis-line" />
      </svg>
      <div class="chart-tooltip" id="chart-tooltip"></div>
    </div>
    <div class="chart-legend">
      <span class="legend-item"><span class="legend-dot plan"></span>계획</span>
      <span class="legend-item"><span class="legend-dot ok"></span>실적(정상)</span>
      <span class="legend-item"><span class="legend-dot warn"></span>실적(계획 대비 90% 미만)</span>
    </div>
  `;
}

function attachChartTooltip(container) {
  const tooltip = container.querySelector("#chart-tooltip");
  const wrap = container.querySelector(".chart-wrap-inner");
  if (!tooltip || !wrap) return;

  wrap.querySelectorAll(".bar-hit").forEach(bar => {
    bar.addEventListener("mouseenter", () => {
      tooltip.textContent = `${bar.dataset.week} · ${bar.dataset.label} ${bar.dataset.value}`;
      tooltip.style.opacity = "1";
    });
    bar.addEventListener("mousemove", (e) => {
      const rect = wrap.getBoundingClientRect();
      tooltip.style.left = (e.clientX - rect.left + 12) + "px";
      tooltip.style.top = (e.clientY - rect.top - 8) + "px";
    });
    bar.addEventListener("mouseleave", () => {
      tooltip.style.opacity = "0";
    });
  });
}

/* ============================================================
   렌더링 — 현황판
   ============================================================ */

let currentSelectedSite = sitesStore[0] ? sitesStore[0].id : null;
let currentCaseId = costCasesStore[0] ? costCasesStore[0].id : null;

function render() {
  const analyses = {};
  sitesStore.forEach(s => { analyses[s.id] = analyzeSite(s.id); });

  renderBanner(analyses);
  renderCards(analyses);
  renderDrilldown(analyses[currentSelectedSite], currentSelectedSite);
  renderCostReview();
  renderLog();
  renderManage();
}

function renderBanner(analyses) {
  const el = document.getElementById("summary-banner");
  const total = sitesStore.length;
  const problemCount = Object.values(analyses).filter(a => a.tag !== "정상" && a.tag !== "데이터 없음").length;
  if (total === 0) {
    el.innerHTML = `<span>등록된 생산처가 없습니다. 아래 "관리"에서 추가해보세요.</span>`;
    el.className = "banner banner-neutral";
  } else if (problemCount === 0) {
    el.innerHTML = `<span>모든 생산처가 정상 범위에서 운영되고 있습니다</span>`;
    el.className = "banner banner-ok";
  } else {
    el.innerHTML = `<span>생산처 ${total}곳 중 ${problemCount}곳에서 이상 징후가 확인되었습니다</span>`;
    el.className = "banner banner-warn";
  }
}

function renderCards(analyses) {
  const container = document.getElementById("site-cards");
  container.innerHTML = "";

  sitesStore.forEach(site => {
    const a = analyses[site.id];
    const card = document.createElement("div");
    card.className = "card" + (site.id === currentSelectedSite ? " active" : "");
    card.onclick = () => { currentSelectedSite = site.id; render(); };
    card.innerHTML = `
      <div class="card-top">
        <span class="dot ${a.statusColor}"></span>
        <span class="card-site">${site.name}</span>
      </div>
      <div class="card-status ${a.statusColor}">${a.status}</div>
      <div class="card-sub">${a.subText}</div>
    `;
    container.appendChild(card);
  });
}

function renderDrilldown(analysis, siteId) {
  const site = sitesStore.find(s => s.id === siteId);
  const panel = document.getElementById("drilldown-panel");
  if (!site || !analysis) {
    panel.innerHTML = `<p class="panel-title">생산처를 선택해주세요</p>`;
    return;
  }

  const declinePct = Math.round(analysis.actualChangeRate * 100);
  const trendLabel = declinePct < 0
    ? `${site.name} — 최근 생산량이 ${Math.abs(declinePct)}% 감소했습니다`
    : `${site.name} — 생산량 추이`;

  panel.innerHTML = `
    <p class="panel-title">${trendLabel}</p>
    <p class="panel-sub">막대에 마우스를 올리면 정확한 수치가 바로 옆에 표시됩니다</p>
    <div class="chart-wrap">${buildBarChart(analysis.records)}</div>
  `;

  attachChartTooltip(panel);
}

/* ============================================================
   렌더링 — 원가 검토
   ============================================================ */

function getCurrentCase() {
  return costCasesStore.find(c => c.id === currentCaseId);
}

function renderCostReview() {
  const panel = document.getElementById("cost-review-panel");
  const costCase = getCurrentCase();

  if (!costCase) {
    panel.innerHTML = `
      <p class="panel-title">협력사 단가 인상 요청 검토</p>
      <p class="panel-sub">등록된 검토 건이 없습니다. 아래 "관리"에서 추가해보세요.</p>
    `;
    return;
  }

  const site = sitesStore.find(s => s.id === costCase.siteId);
  const siteName = site ? site.name : "(생산처 미지정)";
  const r = computeCostReview(costCase);
  const pct = v => (v * 100).toFixed(1) + "%";
  const won = v => Math.round(v).toLocaleString() + "원";

  const tabs = costCasesStore.map(c => `
    <button class="case-tab ${c.id === currentCaseId ? "active" : ""}" data-case="${c.id}">${c.label}</button>
  `).join("");

  const rows = costCase.breakdown.map((item, idx) => {
    const delta = item.basePrice * item.indexRate;
    const justified = item.basePrice + delta;
    const st = SOURCE_TYPE_LABEL[item.sourceType] || SOURCE_TYPE_LABEL.industry;
    return `
      <tr>
        <td>${item.category}</td>
        <td class="num">${won(item.basePrice)}</td>
        <td class="num">
          <input type="number" class="rate-input" data-idx="${idx}" value="${(item.indexRate * 100).toFixed(1)}" step="0.1">%
        </td>
        <td class="num">${won(justified)}</td>
        <td class="src">
          <span class="src-badge ${st.cls}">${st.label}</span>
          <div class="src-text">${item.source}</div>
          <div class="src-date">기준일 ${item.asOfDate || "미기재"}</div>
        </td>
      </tr>`;
  }).join("");

  const vendorNote = r.vendorWeight > 0.15
    ? `<div class="vendor-note">⚠ 원가 구성의 ${Math.round(r.vendorWeight * 100)}%가 협력사가 자체적으로 제시한 근거입니다. 별도 검증 자료(견적서, 계약서 등)를 요청하는 것을 권장합니다.</div>`
    : "";

  panel.innerHTML = `
    <div class="panel-title">협력사 단가 인상 요청 검토</div>
    <p class="panel-sub">지표 변동률과 요청 단가를 직접 바꿔서 판정이 어떻게 달라지는지 확인할 수 있습니다</p>

    <div class="case-tabs">${tabs}</div>

    <div class="case-meta">
      ${siteName} (${costCase.partCode}) ·
      요청 단가
      <input type="number" id="requested-price-input" class="price-input" value="${costCase.requestedPrice}">원
    </div>

    <div class="table-scroll">
      <table class="cost-table">
        <thead>
          <tr><th>원가항목</th><th>기존단가</th><th>지표변동률</th><th>타당단가</th><th>근거 및 신뢰도</th></tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td>합계</td>
            <td class="num">${won(r.baseTotal)}</td>
            <td></td>
            <td class="num">${won(r.justifiedTotal)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>

    <p class="source-legend">
      근거 신뢰도:
      <span class="src-badge src-official">공식 통계</span> 정부·공인기관 지표 &gt;
      <span class="src-badge src-industry">업계 추정</span> 협회·리포트 기반 &gt;
      <span class="src-badge src-vendor">협력사 자체 제시</span> 검증 필요
    </p>

    ${vendorNote}

    <div class="review-summary">
      요청 인상률 <b>${pct(r.requestedRate)}</b> · 근거지표 타당 인상률 <b>${pct(r.justifiedRate)}</b> ·
      차이 <b>${pct(r.gap)}p</b>
    </div>

    <div class="verdict ${r.verdictType}">${r.verdict}</div>

    <div class="decision-form">
      <textarea id="decision-comment" placeholder="검토 의견을 남기세요 (예: 원자재는 인정, 노무비 근거 추가 요청)"></textarea>
      <div class="decision-buttons">
        <button class="btn approve" id="btn-approve">승인</button>
        <button class="btn reject" id="btn-reject">반려</button>
      </div>
    </div>
  `;

  panel.querySelectorAll(".case-tab").forEach(btn => {
    btn.onclick = () => { currentCaseId = btn.dataset.case; render(); };
  });

  panel.querySelectorAll(".rate-input").forEach(input => {
    input.onchange = () => {
      const idx = Number(input.dataset.idx);
      const val = parseFloat(input.value);
      costCase.breakdown[idx].indexRate = isNaN(val) ? 0 : val / 100;
      saveStore(KEYS.costCases, costCasesStore);
      renderCostReview();
    };
  });

  const priceInput = document.getElementById("requested-price-input");
  priceInput.onchange = () => {
    const val = parseInt(priceInput.value, 10);
    costCase.requestedPrice = isNaN(val) ? costCase.requestedPrice : val;
    saveStore(KEYS.costCases, costCasesStore);
    renderCostReview();
  };

  document.getElementById("btn-approve").onclick = () => recordDecision("승인");
  document.getElementById("btn-reject").onclick = () => recordDecision("반려");
}

function recordDecision(decision) {
  const costCase = getCurrentCase();
  if (!costCase) return;
  const r = computeCostReview(costCase);
  const comment = document.getElementById("decision-comment").value.trim();

  decisionLog.unshift({
    time: new Date().toLocaleString("ko-KR"),
    caseLabel: costCase.label,
    partCode: costCase.partCode,
    requestedRate: r.requestedRate,
    justifiedRate: r.justifiedRate,
    gap: r.gap,
    decision,
    comment: comment || "(의견 없음)",
  });
  saveStore(KEYS.log, decisionLog);
  render();
}

function renderLog() {
  const panel = document.getElementById("log-panel");
  const pct = v => (v * 100).toFixed(1) + "%";

  if (decisionLog.length === 0) {
    panel.innerHTML = `
      <div class="panel-title">검토 이력</div>
      <p class="panel-sub">아직 기록된 검토 이력이 없습니다. 위에서 승인/반려를 누르면 여기 남습니다.</p>
    `;
    return;
  }

  const rows = decisionLog.map(e => `
    <div class="log-entry">
      <div class="log-top">
        <span class="log-decision ${e.decision === "승인" ? "approve" : "reject"}">${e.decision}</span>
        <span class="log-case">${e.caseLabel} (${e.partCode})</span>
        <span class="log-time">${e.time}</span>
      </div>
      <div class="log-detail">요청 ${pct(e.requestedRate)} · 근거 ${pct(e.justifiedRate)} · 차이 ${pct(e.gap)}p</div>
      <div class="log-comment">${e.comment}</div>
    </div>
  `).join("");

  panel.innerHTML = `
    <div class="panel-title">검토 이력 (${decisionLog.length}건)</div>
    <p class="panel-sub">누가 언제 어떤 근거로 승인/반려했는지 남긴 기록입니다</p>
    <div class="log-list">${rows}</div>
  `;
}

/* ============================================================
   관리 (생산처 / 원가 검토 케이스 추가·수정·삭제)
   ============================================================ */

function renderManage() {
  const siteList = document.getElementById("manage-sites-list");
  siteList.innerHTML = sitesStore.map(s => `
    <div class="manage-row">
      <span>${s.name} <span class="muted">(${s.partCode} · ${s.location})</span></span>
      <span class="manage-actions">
        <button class="link-btn" data-edit-site="${s.id}">수정</button>
        <button class="link-btn danger" data-delete-site="${s.id}">삭제</button>
      </span>
    </div>
  `).join("") || `<p class="panel-sub">등록된 생산처가 없습니다.</p>`;

  siteList.querySelectorAll("[data-edit-site]").forEach(btn => {
    btn.onclick = () => openSiteModal(btn.dataset.editSite);
  });
  siteList.querySelectorAll("[data-delete-site]").forEach(btn => {
    btn.onclick = () => deleteSite(btn.dataset.deleteSite);
  });

  const caseList = document.getElementById("manage-cases-list");
  caseList.innerHTML = costCasesStore.map(c => `
    <div class="manage-row">
      <span>${c.label} <span class="muted">(${c.partCode})</span></span>
      <span class="manage-actions">
        <button class="link-btn" data-edit-case="${c.id}">수정</button>
        <button class="link-btn danger" data-delete-case="${c.id}">삭제</button>
      </span>
    </div>
  `).join("") || `<p class="panel-sub">등록된 검토 건이 없습니다.</p>`;

  caseList.querySelectorAll("[data-edit-case]").forEach(btn => {
    btn.onclick = () => openCaseModal(btn.dataset.editCase);
  });
  caseList.querySelectorAll("[data-delete-case]").forEach(btn => {
    btn.onclick = () => deleteCase(btn.dataset.deleteCase);
  });
}

function deleteSite(id) {
  if (!confirm("이 생산처와 관련 생산 데이터를 삭제할까요?")) return;
  sitesStore = sitesStore.filter(s => s.id !== id);
  delete productionStore[id];
  saveStore(KEYS.sites, sitesStore);
  saveStore(KEYS.production, productionStore);
  if (currentSelectedSite === id) currentSelectedSite = sitesStore[0] ? sitesStore[0].id : null;
  render();
}

function deleteCase(id) {
  if (!confirm("이 검토 건을 삭제할까요?")) return;
  costCasesStore = costCasesStore.filter(c => c.id !== id);
  saveStore(KEYS.costCases, costCasesStore);
  if (currentCaseId === id) currentCaseId = costCasesStore[0] ? costCasesStore[0].id : null;
  render();
}

function closeModal() {
  document.getElementById("modal-root").innerHTML = "";
}

function weeklyRecordsToText(records) {
  return (records || []).map(r =>
    `${r.week},${r.plan},${r.actual},${(r.defect * 100).toFixed(2)},${(r.util * 100).toFixed(1)}`
  ).join("\n");
}

function parseWeeklyText(text) {
  return text.split("\n").map(l => l.trim()).filter(Boolean).map(line => {
    const [week, plan, actual, defect, util] = line.split(",").map(s => s.trim());
    return {
      week: week || "",
      plan: Number(plan) || 0,
      actual: Number(actual) || 0,
      defect: (Number(defect) || 0) / 100,
      util: (Number(util) || 0) / 100,
    };
  });
}

function openSiteModal(editId) {
  const editing = editId ? sitesStore.find(s => s.id === editId) : null;
  const records = editing ? productionStore[editing.id] : [];

  document.getElementById("modal-root").innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal">
        <div class="modal-title">${editing ? "생산처 수정" : "생산처 추가"}</div>

        <label class="field-label">생산처 이름</label>
        <input type="text" id="m-site-name" class="field-input" value="${editing ? editing.name : ""}" placeholder="예: 신흥전자">

        <label class="field-label">위치</label>
        <input type="text" id="m-site-location" class="field-input" value="${editing ? editing.location : ""}" placeholder="예: 경기 화성">

        <label class="field-label">담당 부품 코드</label>
        <input type="text" id="m-site-part" class="field-input" value="${editing ? editing.partCode : ""}" placeholder="예: WH-3301">

        <label class="field-label">주차별 생산 데이터</label>
        <p class="field-hint">한 줄에 하나씩, 형식: 주차,계획수량,실적수량,불량률(%),가동률(%)</p>
        <textarea id="m-site-weeks" class="field-textarea" placeholder="W1,5000,4900,1.2,96
W2,5000,4850,1.3,95">${weeklyRecordsToText(records)}</textarea>

        <div class="modal-actions">
          <button class="btn" id="m-cancel">취소</button>
          <button class="btn approve" id="m-save">저장</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById("m-cancel").onclick = closeModal;
  document.getElementById("modal-backdrop").onclick = (e) => { if (e.target.id === "modal-backdrop") closeModal(); };

  document.getElementById("m-save").onclick = () => {
    const name = document.getElementById("m-site-name").value.trim();
    const location = document.getElementById("m-site-location").value.trim();
    const partCode = document.getElementById("m-site-part").value.trim();
    const weeks = parseWeeklyText(document.getElementById("m-site-weeks").value);

    if (!name) { alert("생산처 이름을 입력해주세요."); return; }
    if (weeks.length === 0) { alert("주차별 데이터를 1줄 이상 입력해주세요."); return; }

    const id = editing ? editing.id : genId("SITE");
    const newSite = { id, name, location, partCode };

    if (editing) {
      sitesStore = sitesStore.map(s => s.id === id ? newSite : s);
    } else {
      sitesStore.push(newSite);
    }
    productionStore[id] = weeks;

    saveStore(KEYS.sites, sitesStore);
    saveStore(KEYS.production, productionStore);
    currentSelectedSite = id;
    closeModal();
    render();
  };
}

function openCaseModal(editId) {
  const editing = editId ? costCasesStore.find(c => c.id === editId) : null;
  const breakdown = editing ? JSON.parse(JSON.stringify(editing.breakdown)) : [
    { category: "원재료비", basePrice: 0, indexRate: 0, source: "", sourceType: "industry", asOfDate: "" },
  ];

  const siteOptions = sitesStore.map(s =>
    `<option value="${s.id}" ${editing && editing.siteId === s.id ? "selected" : ""}>${s.name}</option>`
  ).join("");

  function breakdownRowHtml(item, idx) {
    return `
      <div class="breakdown-row" data-row="${idx}">
        <input type="text" class="bd-category field-input" placeholder="항목명(예: 원재료비)" value="${item.category}">
        <input type="number" class="bd-base field-input" placeholder="기존단가" value="${item.basePrice}">
        <input type="number" class="bd-rate field-input" placeholder="지표변동률(%)" value="${(item.indexRate * 100).toFixed(1)}" step="0.1">
        <select class="bd-type field-input">
          <option value="official" ${item.sourceType === "official" ? "selected" : ""}>공식 통계</option>
          <option value="industry" ${item.sourceType === "industry" ? "selected" : ""}>업계 추정</option>
          <option value="vendor" ${item.sourceType === "vendor" ? "selected" : ""}>협력사 자체 제시</option>
        </select>
        <input type="text" class="bd-source field-input" placeholder="근거(예: 구리 가격지수)" value="${item.source}">
        <input type="text" class="bd-date field-input" placeholder="기준일(YYYY-MM-DD)" value="${item.asOfDate || ""}">
        <button class="link-btn danger bd-remove" type="button">삭제</button>
      </div>
    `;
  }

  function renderRows() {
    document.getElementById("m-breakdown-rows").innerHTML = breakdown.map(breakdownRowHtml).join("");
    document.querySelectorAll(".bd-remove").forEach((btn, idx) => {
      btn.onclick = () => { breakdown.splice(idx, 1); renderRows(); };
    });
  }

  document.getElementById("modal-root").innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal modal-wide">
        <div class="modal-title">${editing ? "검토 건 수정" : "검토 건 추가"}</div>

        <label class="field-label">생산처</label>
        <select id="m-case-site" class="field-input">${siteOptions || "<option value=''>생산처를 먼저 추가해주세요</option>"}</select>

        <label class="field-label">부품 코드</label>
        <input type="text" id="m-case-part" class="field-input" value="${editing ? editing.partCode : ""}" placeholder="예: WH-3301">

        <label class="field-label">협력사 요청 단가(원)</label>
        <input type="number" id="m-case-price" class="field-input" value="${editing ? editing.requestedPrice : ""}">

        <label class="field-label">원가 항목별 분해</label>
        <div id="m-breakdown-rows"></div>
        <button class="link-btn" id="m-add-row" type="button">+ 항목 추가</button>

        <div class="modal-actions">
          <button class="btn" id="m-cancel">취소</button>
          <button class="btn approve" id="m-save">저장</button>
        </div>
      </div>
    </div>
  `;

  renderRows();

  document.getElementById("m-add-row").onclick = () => {
    breakdown.push({ category: "", basePrice: 0, indexRate: 0, source: "", sourceType: "industry", asOfDate: "" });
    renderRows();
  };

  document.getElementById("m-cancel").onclick = closeModal;
  document.getElementById("modal-backdrop").onclick = (e) => { if (e.target.id === "modal-backdrop") closeModal(); };

  document.getElementById("m-save").onclick = () => {
    const siteId = document.getElementById("m-case-site").value;
    const partCode = document.getElementById("m-case-part").value.trim();
    const requestedPrice = parseInt(document.getElementById("m-case-price").value, 10) || 0;

    const rows = Array.from(document.querySelectorAll(".breakdown-row")).map(rowEl => ({
      category: rowEl.querySelector(".bd-category").value.trim() || "기타",
      basePrice: Number(rowEl.querySelector(".bd-base").value) || 0,
      indexRate: (Number(rowEl.querySelector(".bd-rate").value) || 0) / 100,
      sourceType: rowEl.querySelector(".bd-type").value,
      source: rowEl.querySelector(".bd-source").value.trim() || "미기재",
      asOfDate: rowEl.querySelector(".bd-date").value.trim(),
    }));

    if (!siteId) { alert("생산처를 선택해주세요."); return; }
    if (rows.length === 0) { alert("원가 항목을 1개 이상 추가해주세요."); return; }

    const site = sitesStore.find(s => s.id === siteId);
    const id = editing ? editing.id : genId("CASE");
    const newCase = {
      id, siteId, partCode, requestedPrice, breakdown: rows,
      label: `${site ? site.name : ""} · ${partCode || "미지정"}`,
    };

    if (editing) {
      costCasesStore = costCasesStore.map(c => c.id === id ? newCase : c);
    } else {
      costCasesStore.push(newCase);
    }
    saveStore(KEYS.costCases, costCasesStore);
    currentCaseId = id;
    closeModal();
    render();
  };
}

/* ============================================================
   안내 모달 — 이 도구를 만든 이유 / 사용법 / 사용 시나리오 / 판정 근거를
   한 화면에서 볼 수 있게 정리
   ============================================================ */

function openInfoModal() {
  document.getElementById("modal-root").innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal modal-wide">
        <div class="modal-title">이 도구에 대해</div>

        <div class="info-section">
          <div class="info-heading">왜 만들었나요</div>
          <p class="info-text">
            협력사가 단가 인상을 요청했을 때 감으로 승인·반려하지 않고, 원재료비·노무비·
            제조경비·물류비 같은 항목별 데이터로 근거를 검증하기 위해 만들었습니다.
            동시에 여러 생산처의 계획 대비 실적을 한눈에 점검하고, 이상이 생기면
            원인을 추정할 수 있게 설계했습니다.
          </p>
        </div>

        <div class="info-section">
          <div class="info-heading">사용법</div>
          <ol class="info-list">
            <li>상단 생산처 카드에서 이상 징후가 있는 곳을 먼저 확인합니다.</li>
            <li>카드를 클릭하면 아래 차트에서 최근 생산량 추이를 볼 수 있습니다.</li>
            <li>"협력사 단가 검토"에서 건을 선택하고 항목별 근거와 신뢰도를 확인합니다.</li>
            <li>필요하면 지표 변동률·요청 단가를 직접 수정해 판정이 어떻게 바뀌는지
              시뮬레이션할 수 있습니다.</li>
            <li>승인 또는 반려를 누르면 검토 이력에 기록됩니다.</li>
            <li>협력사나 데이터가 바뀌면 "관리"에서 추가·수정하거나, "데이터 초기화"로
              기본 예시 데이터로 되돌릴 수 있습니다.</li>
          </ol>
        </div>

        <div class="info-section">
          <div class="info-heading">이런 상황에 씁니다</div>
          <ul class="info-list">
            <li>여러 생산처의 실적을 정기적으로 한눈에 점검하고 싶을 때</li>
            <li>협력사의 단가 인상 요청을 데이터 근거로 판단하고 싶을 때</li>
            <li>나중에 "왜 그때 승인/반려했는지" 설명할 근거 기록이 필요할 때</li>
          </ul>
        </div>

        <div class="info-section">
          <div class="info-heading">판정은 어떤 근거로 나오나요</div>
          <p class="info-text">
            <b>생산처 상태</b> — 실적이 10% 이상 줄었는데 불량률은 안정적이면
            "자재·설비 의심", 불량률이 최근 3주 연속 15%씩 상승하면 "품질·공정 의심"으로
            분류합니다.
          </p>
          <p class="info-text">
            <b>단가 인상 판정</b> — 원가 항목마다 관련 외부지표 변동률을 곱해
            "근거상 타당한 인상률"을 계산하고, 협력사의 실제 요청 인상률과 비교합니다.
            차이가 1%p를 넘으면 "과다", -1%p보다 작으면 "협상 여지", 그 사이면 "적정"으로 판정합니다.
          </p>
          <p class="info-text">
            <b>근거 신뢰도</b> — 각 항목의 출처를 공식 통계 &gt; 업계 추정 &gt; 협력사
            자체 제시 순으로 구분해 표시하고, 협력사 자체 제시 비중이 15%를 넘으면
            추가 검증을 권장하는 경고를 띄웁니다.
          </p>
        </div>

        <p class="info-disclaimer">
          이 도구의 모든 생산처·데이터는 가상이며, 실존 기업의 경영정보와 무관합니다.
        </p>

        <div class="modal-actions">
          <button class="btn approve" id="m-info-close">닫기</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById("m-info-close").onclick = closeModal;
  document.getElementById("modal-backdrop").onclick = (e) => { if (e.target.id === "modal-backdrop") closeModal(); };
}

document.getElementById("info-btn").onclick = openInfoModal;
document.getElementById("add-site-btn").onclick = () => openSiteModal(null);
document.getElementById("add-case-btn").onclick = () => openCaseModal(null);
document.getElementById("reset-data-btn").onclick = resetAllData;

render();
