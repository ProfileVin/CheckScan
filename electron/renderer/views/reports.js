(function () {
  const PAGE_SIZE = 12;

  let all = [];
  let filtered = [];
  let page = 0;

  // Navigation cache: render()/bind once, keep `all` between visits, and on re-entry paint
  // instantly from it while a fresh fetch runs in the background. `stale` (set by invalidate()
  // after a batch save) forces the next visit to await fresh data before painting.
  let rendered = false;
  let loaded = false;
  let stale = false;

  function root() {
    return document.getElementById('view-reports');
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fmtMoney(v) {
    return `$${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function fmtCount(v) {
    return Number(v || 0).toLocaleString('en-US');
  }

  function dayOf(iso) {
    return iso ? String(iso).slice(0, 10) : '';
  }

  function fmtDate(iso) {
    return dayOf(iso) || '—';
  }

  function csvCell(v) {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function render() {
    root().innerHTML = `
      <div class="rp-page">
        <div class="rp-head">
          <h1 class="fr-title">Reports &amp; Analytics</h1>
          <p class="fr-subtitle">Review scanning volume and fundraising metrics across every batch.</p>
        </div>

        <div class="rp-kpis">
          <div class="rp-kpi">
            <span class="rp-kpi-label">Total Amount Processed</span>
            <strong id="rp-kpi-amount" class="rp-kpi-value">$0.00</strong>
            <span id="rp-kpi-amount-sub" class="rp-kpi-sub"></span>
          </div>
          <div class="rp-kpi">
            <span class="rp-kpi-label">Total Checks Scanned</span>
            <strong id="rp-kpi-count" class="rp-kpi-value">0</strong>
            <span id="rp-kpi-count-sub" class="rp-kpi-sub"></span>
          </div>
        </div>

        <div class="fr-card rp-card">
          <div class="rp-card-head">
            <h2>Transaction Report</h2>
            <div class="rp-tools">
              <select id="rp-fundraiser" aria-label="Filter by fundraiser">
                <option value="">All Fundraisers</option>
              </select>
              <select id="rp-bank" aria-label="Filter by bank">
                <option value="">All Banks</option>
              </select>
              <div class="rp-daterange">
                <button id="rp-range-toggle" class="btn rp-range-btn" type="button">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                  <span id="rp-range-label">Date Range</span>
                </button>
                <div id="rp-range-pop" class="rp-range-pop" hidden>
                  <label>From<input id="rp-from" type="date" /></label>
                  <label>To<input id="rp-to" type="date" /></label>
                  <div class="rp-range-actions">
                    <button id="rp-range-clear" class="btn" type="button">Clear</button>
                    <button id="rp-range-apply" class="btn btn-primary" type="button">Apply</button>
                  </div>
                </div>
              </div>
              <button id="rp-export" class="btn" type="button">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Export to CSV
              </button>
            </div>
          </div>

          <table class="fr-table rp-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Fundraiser</th>
                <th>Bank</th>
                <th class="rp-amount-col">Amount</th>
              </tr>
            </thead>
            <tbody id="rp-rows"></tbody>
          </table>

          <div class="fr-footer">
            <span id="rp-count"></span>
            <div class="fr-pager">
              <button id="rp-prev" class="fr-pager-btn" type="button" aria-label="Previous page">
                <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <button id="rp-next" class="fr-pager-btn" type="button" aria-label="Next page">
                <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
          </div>

          <p id="rp-status" class="fd-export-msg"></p>
        </div>
      </div>
    `;

    document.getElementById('rp-fundraiser').addEventListener('change', applyFilter);
    document.getElementById('rp-bank').addEventListener('change', applyFilter);
    document.getElementById('rp-export').addEventListener('click', exportCsv);

    document.getElementById('rp-prev').addEventListener('click', () => {
      if (page > 0) { page -= 1; renderRows(); }
    });
    document.getElementById('rp-next').addEventListener('click', () => {
      if ((page + 1) * PAGE_SIZE < filtered.length) { page += 1; renderRows(); }
    });

    const pop = document.getElementById('rp-range-pop');
    document.getElementById('rp-range-toggle').addEventListener('click', (e) => {
      e.stopPropagation();
      pop.hidden = !pop.hidden;
    });
    document.getElementById('rp-range-apply').addEventListener('click', () => {
      pop.hidden = true;
      applyFilter();
    });
    document.getElementById('rp-range-clear').addEventListener('click', () => {
      document.getElementById('rp-from').value = '';
      document.getElementById('rp-to').value = '';
      pop.hidden = true;
      applyFilter();
    });

    bindOutsideClose();
  }

  // init() re-runs on every visit to the tab, so guard the document-level listener
  // against stacking up one copy per visit.
  let outsideCloseBound = false;
  function bindOutsideClose() {
    if (outsideCloseBound) return;
    outsideCloseBound = true;
    document.addEventListener('click', (e) => {
      const pop = document.getElementById('rp-range-pop');
      if (pop && !pop.hidden && !e.target.closest('.rp-daterange')) pop.hidden = true;
    });
  }

  function populateFilters() {
    const frSel = document.getElementById('rp-fundraiser');
    const bkSel = document.getElementById('rp-bank');
    // Preserve the operator's current selection across an option-list rebuild (background refresh).
    const frPrev = frSel.value;
    const bkPrev = bkSel.value;
    const fundraisers = [...new Set(all.map((t) => t.fundraiser).filter(Boolean))].sort();
    const banks = [...new Set(all.map((t) => t.bank).filter(Boolean))].sort();

    frSel.innerHTML = '<option value="">All Fundraisers</option>' +
      fundraisers.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    bkSel.innerHTML = '<option value="">All Banks</option>' +
      banks.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');

    if ([...frSel.options].some((o) => o.value === frPrev)) frSel.value = frPrev;
    if ([...bkSel.options].some((o) => o.value === bkPrev)) bkSel.value = bkPrev;
  }

  function currentFilters() {
    return {
      fundraiser: document.getElementById('rp-fundraiser').value,
      bank: document.getElementById('rp-bank').value,
      from: document.getElementById('rp-from').value,
      to: document.getElementById('rp-to').value,
    };
  }

  function computeFiltered() {
    const { fundraiser, bank, from, to } = currentFilters();
    filtered = all.filter((t) => {
      if (fundraiser && t.fundraiser !== fundraiser) return false;
      if (bank && t.bank !== bank) return false;
      const d = dayOf(t.date);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
    updateRangeLabel(from, to);
  }

  // A filter/date control changed - recompute and jump back to the first page.
  function applyFilter() {
    computeFiltered();
    page = 0;
    renderKpis();
    renderRows();
  }

  // Re-render at the current filter + page (tab re-entry, background refresh). Keeps the page
  // the operator was on, clamped if the row count shrank.
  function repaint() {
    computeFiltered();
    const maxPage = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1);
    if (page > maxPage) page = maxPage;
    renderKpis();
    renderRows();
  }

  function updateRangeLabel(from, to) {
    const label = document.getElementById('rp-range-label');
    label.textContent = from || to ? `${from || '…'} – ${to || '…'}` : 'Date Range';
  }

  function renderKpis() {
    const totalAmount = filtered.reduce((sum, t) => sum + Number(t.amount || 0), 0);
    const count = filtered.length;
    const avg = count ? totalAmount / count : 0;
    const fundraiserCount = new Set(filtered.map((t) => t.fundraiser)).size;

    document.getElementById('rp-kpi-amount').textContent = fmtMoney(totalAmount);
    document.getElementById('rp-kpi-count').textContent = fmtCount(count);
    document.getElementById('rp-kpi-amount-sub').textContent =
      count ? `${fmtMoney(avg)} average per check` : 'No checks in selection';
    document.getElementById('rp-kpi-count-sub').textContent =
      count ? `Across ${fundraiserCount} fundraiser${fundraiserCount === 1 ? '' : 's'}` : '—';
  }

  function renderRows() {
    const tbody = document.getElementById('rp-rows');
    const total = filtered.length;
    const start = page * PAGE_SIZE;
    const pageRows = filtered.slice(start, start + PAGE_SIZE);

    tbody.innerHTML = total === 0
      ? `<tr><td colspan="4" class="fr-empty">No transactions found.</td></tr>`
      : pageRows
          .map((t) => `
            <tr>
              <td>${fmtDate(t.date)}</td>
              <td class="fr-name">${escapeHtml(t.fundraiser || '—')}</td>
              <td>${escapeHtml(t.bank || '—')}</td>
              <td class="rp-amount-col">${fmtMoney(t.amount)}</td>
            </tr>`)
          .join('');

    const shownFrom = total === 0 ? 0 : start + 1;
    const shownTo = Math.min(start + PAGE_SIZE, total);
    document.getElementById('rp-count').textContent =
      total === 0
        ? 'No transactions'
        : `Showing ${shownFrom}-${shownTo} of ${total} transaction${total === 1 ? '' : 's'}`;
    document.getElementById('rp-prev').disabled = page === 0;
    document.getElementById('rp-next').disabled = start + PAGE_SIZE >= total;
  }

  async function exportCsv() {
    const status = document.getElementById('rp-status');
    const header = ['Date', 'Fundraiser', 'Bank', 'Amount', 'Status'];
    const lines = [header.join(',')].concat(
      filtered.map((t) =>
        [
          fmtDate(t.date),
          csvCell(t.fundraiser),
          csvCell(t.bank),
          Number(t.amount || 0).toFixed(2),
          csvCell(t.status || 'Verified'),
        ].join(',')),
    );
    const csv = lines.join('\r\n');
    try {
      const result = await window.checkScan.saveCsvFile('checkscan-transactions.csv', csv);
      status.textContent = result.saved ? `Saved to ${result.filePath}` : 'Export canceled.';
    } catch (err) {
      status.textContent = `Export failed: ${err.message}`;
    }
  }

  async function refresh({ background }) {
    try {
      all = await window.checkScan.getReportTransactions();
      loaded = true;
      populateFilters();
      repaint();
    } catch (err) {
      // A background refresh that fails leaves the cached rows on screen untouched.
      if (!background) {
        document.getElementById('rp-rows').innerHTML =
          `<tr><td colspan="4" class="fr-empty">Could not load report: ${escapeHtml(err.message)}</td></tr>`;
      }
    }
  }

  window.Views = window.Views || {};
  window.Views.reports = {
    async init() {
      if (!rendered) {
        render();
        rendered = true;
      }
      if (loaded && !stale) {
        repaint();                    // instant, from the cached `all`
        refresh({ background: true }); // fire-and-forget
      } else {
        await refresh({ background: false });
      }
      stale = false;
    },
    // Called after a batch save so the next visit re-fetches before painting.
    invalidate() {
      stale = true;
    },
  };
})();
