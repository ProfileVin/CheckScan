(function () {
  const PAGE_SIZE = 10;

  let all = [];
  let filtered = [];
  let page = 0;

  // Navigation cache: render()/bind once, keep `all` between visits, paint instantly from it on
  // re-entry while a fresh fetch runs in the background. `stale` (set by invalidate() after a
  // batch save) forces the next visit to await fresh data first.
  let rendered = false;
  let loaded = false;
  let stale = false;

  function root() {
    return document.getElementById('view-fundraisers');
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

  function fmtDate(d) {
    return d ? new Date(d).toISOString().slice(0, 10) : '—';
  }

  function render() {
    root().innerHTML = `
      <div class="fr-page">
        <div class="fr-head">
          <div>
            <h1 class="fr-title">Fundraiser Directory</h1>
            <p class="fr-subtitle">Manage people, monitor aggregate check scanning volumes, and track historical financial verification data.</p>
          </div>
          <button id="fr-add" class="btn btn-primary" type="button">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21h18M6 21V9l6-4 6 4v12"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/></svg>
            Add Fundraiser
          </button>
        </div>

        <div class="fr-search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input id="fr-search-input" type="search" placeholder="Search fundraisers, date, or amounts..." autocomplete="off" />
        </div>

        <div id="fr-add-form" class="fr-add-form" hidden>
          <input id="fr-new-name" type="text" placeholder="Fundraiser name" />
          <button id="fr-add-save" class="btn btn-primary" type="button">Save</button>
          <button id="fr-add-cancel" class="btn" type="button">Cancel</button>
          <span id="fr-add-msg" class="fr-add-msg"></span>
        </div>

        <div class="fr-card">
          <table class="fr-table">
            <thead>
              <tr>
                <th>Fundraiser Name</th>
                <th>Total Check Scanned</th>
                <th>Total Amount Donated</th>
                <th>Last Donation</th>
                <th class="fr-actions-col">Actions</th>
              </tr>
            </thead>
            <tbody id="fr-rows"></tbody>
          </table>
          <div class="fr-footer">
            <span id="fr-count"></span>
            <div class="fr-pager">
              <button id="fr-prev" class="fr-pager-btn" type="button" aria-label="Previous page">
                <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <button id="fr-next" class="fr-pager-btn" type="button" aria-label="Next page">
                <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div id="fr-detail" class="fr-detail" hidden></div>
    `;

    document.getElementById('fr-add').addEventListener('click', () => toggleAddForm());
    document.getElementById('fr-add-cancel').addEventListener('click', () => toggleAddForm(false));
    document.getElementById('fr-add-save').addEventListener('click', addFundraiser);
    document.getElementById('fr-new-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addFundraiser();
    });

    const search = document.getElementById('fr-search-input');
    search.addEventListener('input', () => applyFilter(search.value));

    document.getElementById('fr-prev').addEventListener('click', () => {
      if (page > 0) { page -= 1; renderRows(); }
    });
    document.getElementById('fr-next').addEventListener('click', () => {
      if ((page + 1) * PAGE_SIZE < filtered.length) { page += 1; renderRows(); }
    });
  }

  function toggleAddForm(show) {
    const form = document.getElementById('fr-add-form');
    const next = typeof show === 'boolean' ? show : form.hidden;
    form.hidden = !next;
    document.getElementById('fr-add-msg').textContent = '';
    if (next) {
      const input = document.getElementById('fr-new-name');
      input.value = '';
      input.focus();
    }
  }

  async function addFundraiser() {
    const input = document.getElementById('fr-new-name');
    const msg = document.getElementById('fr-add-msg');
    const name = input.value.trim();
    if (!name) {
      msg.textContent = 'Enter a name.';
      return;
    }
    try {
      await window.checkScan.createFundraiser(name);
      toggleAddForm(false);
      document.getElementById('fr-search-input').value = '';
      await refresh({ background: false });
    } catch (err) {
      msg.textContent = `Could not add: ${err.message}`;
    }
  }

  async function refresh({ background }) {
    try {
      all = await window.checkScan.listFundraisers();
      loaded = true;
    } catch (err) {
      // A failed background refresh leaves the cached rows on screen.
      if (!background) {
        document.getElementById('fr-rows').innerHTML =
          `<tr><td colspan="5" class="fr-empty">Could not load fundraisers: ${escapeHtml(err.message)}</td></tr>`;
      }
      return;
    }
    repaint();

    // If a fundraiser's detail is open, refresh it too (cheap; avoids a stale detail after a
    // batch save).
    const detail = document.getElementById('fr-detail');
    if (detailData && detail && !detail.hidden) {
      try {
        detailData = await window.checkScan.getFundraiser(detailData.id);
        renderDetail();
      } catch {
        // Keep the detail currently on screen.
      }
    }
  }

  function computeFiltered(term) {
    const q = (term || '').trim().toLowerCase();
    filtered = !q
      ? all.slice()
      : all.filter((f) => {
          const haystack = [
            f.name,
            fmtCount(f.checkCount),
            String(f.checkCount),
            fmtMoney(f.total),
            String(f.total),
            fmtDate(f.lastDonation),
          ].join(' ').toLowerCase();
          return haystack.includes(q);
        });
  }

  // Search box changed - recompute and jump to the first page.
  function applyFilter(term) {
    computeFiltered(term);
    page = 0;
    renderRows();
  }

  // Re-render at the current search + page (tab re-entry, background refresh); clamp the page
  // if the row count shrank.
  function repaint() {
    const input = document.getElementById('fr-search-input');
    computeFiltered(input ? input.value : '');
    const maxPage = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1);
    if (page > maxPage) page = maxPage;
    renderRows();
  }

  function renderRows() {
    const tbody = document.getElementById('fr-rows');
    const total = filtered.length;
    const start = page * PAGE_SIZE;
    const pageRows = filtered.slice(start, start + PAGE_SIZE);

    if (total === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="fr-empty">No fundraisers found.</td></tr>`;
    } else {
      tbody.innerHTML = pageRows
        .map((f) => `
          <tr data-id="${f.id}">
            <td class="fr-name">${escapeHtml(f.name)}</td>
            <td>${fmtCount(f.checkCount)}</td>
            <td>${fmtMoney(f.total)}</td>
            <td>${fmtDate(f.lastDonation)}</td>
            <td class="fr-actions-col">
              <button class="fr-open" type="button" aria-label="Open ${escapeHtml(f.name)}">
                <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
              </button>
            </td>
          </tr>
        `)
        .join('');

      tbody.querySelectorAll('tr[data-id]').forEach((tr) => {
        const id = Number(tr.dataset.id);
        tr.querySelector('.fr-open').addEventListener('click', () => openDetail(id));
        tr.addEventListener('click', (e) => {
          if (!e.target.closest('.fr-open')) openDetail(id);
        });
      });
    }

    const shownFrom = total === 0 ? 0 : start + 1;
    const shownTo = Math.min(start + PAGE_SIZE, total);
    document.getElementById('fr-count').textContent =
      `Showing ${shownFrom}-${shownTo} of ${total} fundraiser${total === 1 ? '' : 's'}`;
    document.getElementById('fr-prev').disabled = page === 0;
    document.getElementById('fr-next').disabled = start + PAGE_SIZE >= total;
  }

  let detailData = null;

  function fmtDateTime(d) {
    if (!d) return '—';
    const t = new Date(d);
    const p = (n) => String(n).padStart(2, '0');
    return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
  }

  function fmtDay(d) {
    return d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  }

  function csvCell(v) {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function statusBadge(status) {
    const s = status || 'Verified';
    if (/action/i.test(s)) {
      return `<span class="fd-badge is-action"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9 16H3z"/><line x1="12" y1="9" x2="12" y2="14"/><line x1="12" y1="17" x2="12" y2="17"/></svg>Action Required</span>`;
    }
    if (/process/i.test(s)) {
      return `<span class="fd-badge is-processing"><span class="fd-dot"></span>Processing</span>`;
    }
    return `<span class="fd-badge is-verified"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polyline points="8 12.5 11 15.5 16 9"/></svg>Verified</span>`;
  }

  // Fundraiser detail navigation lives in the top app bar, not in the page body.
  function setTopbarCrumb(name) {
    const el = document.getElementById('topbar-crumb');
    if (!el) return;
    if (!name) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = `
      <button class="tc-back" type="button" aria-label="Back to directory">
        <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
      </button>
      <button class="tc-link" type="button">Fundraisers</button>
      <span class="tc-sep">/</span>
      <span class="tc-current">${escapeHtml(name)}</span>
    `;
    el.querySelector('.tc-back').addEventListener('click', closeDetail);
    el.querySelector('.tc-link').addEventListener('click', closeDetail);
  }

  async function openDetail(id) {
    const detail = document.getElementById('fr-detail');
    document.querySelector('.fr-page').hidden = true;
    detail.hidden = false;
    detail.innerHTML = `<p class="fr-detail-loading">Loading…</p>`;

    try {
      detailData = await window.checkScan.getFundraiser(id);
    } catch (err) {
      detail.innerHTML = `
        <button class="fr-back" type="button">&larr; Back to directory</button>
        <p class="fr-empty">Could not load: ${escapeHtml(err.message)}</p>`;
      detail.querySelector('.fr-back').addEventListener('click', closeDetail);
      return;
    }

    renderDetail();
  }

  function renderDetail() {
    const detail = document.getElementById('fr-detail');
    const f = detailData;
    const count = f.checks.length;
    const total = f.checks.reduce((sum, c) => sum + Number(c.amount || 0), 0);
    const avg = count ? total / count : 0;
    const lastScan = count
      ? f.checks.reduce((max, c) => Math.max(max, new Date(c.createdAt).getTime()), 0)
      : null;

    detail.innerHTML = `
      <div class="fd-head">
        <h1 class="fd-name">${escapeHtml(f.name)}</h1>
        <div class="fd-total">
          <div class="fd-total-label">Total Donations</div>
          <div class="fd-total-value">${fmtMoney(total)}</div>
        </div>
      </div>

      <div class="fd-stats">
        <div class="fd-stat"><span>Total Checks Scanned</span><strong>${fmtCount(count)}</strong></div>
        <div class="fd-stat"><span>Average Check Amount</span><strong>${fmtMoney(avg)}</strong></div>
        <div class="fd-stat"><span>Last Active Scan</span><strong>${lastScan ? fmtDay(lastScan) : '—'}</strong></div>
      </div>

      <div class="fd-registry">
        <div class="fd-registry-head">
          <h2>Scanned Checks Registry</h2>
          <div class="fd-registry-tools">
            <div class="fd-search">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input id="fd-search" type="search" placeholder="Search checks..." autocomplete="off" />
            </div>
            <button id="fd-export" class="btn" type="button">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Export to CSV
            </button>
          </div>
        </div>
        <table class="fr-table fd-table">
          <thead>
            <tr>
              <th>Scan Date</th>
              <th>Issuing Bank</th>
              <th class="fd-amount-col">Amount</th>
              <th class="fd-status-col">Status</th>
            </tr>
          </thead>
          <tbody id="fd-rows"></tbody>
        </table>
        <p id="fd-export-msg" class="fd-export-msg"></p>
      </div>
    `;

    setTopbarCrumb(f.name);
    const search = detail.querySelector('#fd-search');
    search.addEventListener('input', () => renderDetailRows(search.value));
    detail.querySelector('#fd-export').addEventListener('click', exportDetailCsv);

    renderDetailRows('');
  }

  function renderDetailRows(term) {
    const tbody = document.getElementById('fd-rows');
    if (!tbody) return;
    const q = (term || '').trim().toLowerCase();
    const rows = detailData.checks.filter((c) => {
      if (!q) return true;
      return [fmtDateTime(c.createdAt), c.bank, fmtMoney(c.amount), c.status]
        .join(' ').toLowerCase().includes(q);
    });

    tbody.innerHTML = rows.length
      ? rows
          .map((c) => `
            <tr>
              <td>${fmtDateTime(c.createdAt)}</td>
              <td>${escapeHtml(c.bank || '—')}</td>
              <td class="fd-amount-col">${fmtMoney(c.amount)}</td>
              <td class="fd-status-col">${statusBadge(c.status)}</td>
            </tr>`)
          .join('')
      : `<tr><td colspan="4" class="fr-empty">No checks found.</td></tr>`;
  }

  async function exportDetailCsv() {
    const msg = document.getElementById('fd-export-msg');
    const header = ['Scan Date', 'Issuing Bank', 'Amount', 'Status'];
    const lines = [header.join(',')].concat(
      detailData.checks.map((c) =>
        [
          fmtDateTime(c.createdAt),
          csvCell(c.bank),
          Number(c.amount || 0).toFixed(2),
          csvCell(c.status || 'Verified'),
        ].join(',')),
    );
    const csv = lines.join('\r\n');
    const fileName = `${(detailData.name || 'fundraiser').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-checks.csv`;
    try {
      const result = await window.checkScan.saveCsvFile(fileName, csv);
      msg.textContent = result.saved ? `Saved to ${result.filePath}` : 'Export canceled.';
    } catch (err) {
      msg.textContent = `Export failed: ${err.message}`;
    }
  }

  function closeDetail() {
    document.getElementById('fr-detail').hidden = true;
    document.querySelector('.fr-page').hidden = false;
    setTopbarCrumb(null);
  }

  window.Views = window.Views || {};
  window.Views.fundraisers = {
    async init() {
      if (!rendered) {
        render();
        rendered = true;
      }
      // Coming back to this tab while a fundraiser detail is still open - re-show its crumb.
      const detail = document.getElementById('fr-detail');
      if (detailData && detail && !detail.hidden) {
        setTopbarCrumb(detailData.name);
      }
      if (loaded && !stale) {
        repaint();                     // instant, from the cached `all`
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
