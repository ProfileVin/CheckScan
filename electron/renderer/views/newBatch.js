(function () {
  // Field key -> label for the Review Verification panel, in display order.
  const PANEL_FIELDS = [
    { key: 'legalAmount', label: 'Legal Amount', className: 'field-emphasis' },
    { key: 'amount', label: 'Numeric Amount', group: 'row2' },
    { key: 'date', label: 'Check Date', group: 'row2' },
    { key: 'memo', label: 'Memo Line' },
    { key: 'routingNumber', label: 'Routing Number' },
    { key: 'accountNumber', label: 'Account Number' },
    { key: 'donorName', label: 'Donor Name' },
    { key: 'checkNumber', label: 'Check Number' },
  ];
  const VALUE_KEYS = ['amount', 'legalAmount', 'date', 'bank', 'memo', 'routingNumber', 'accountNumber', 'donorName', 'checkNumber'];

  let rendered = false;
  let currentBatchId = null;
  let fundraisers = [];

  // Review model: checks[index] = { index, imagePath, imageDataUrl, confidence, values,
  //                                 fundraiserId, status, error }
  let checks = [];
  let selectedIndex = null;
  let zoom = 1;
  let panX = 0;
  let panY = 0;

  function root() {
    return document.getElementById('view-new-batch');
  }

  function render() {
    root().innerHTML = `
      <div id="nb-empty" class="panel empty-state">
        <button id="nb-start" class="btn btn-primary btn-lg" type="button">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
          Start New Scan
        </button>
      </div>

      <div id="nb-workspace" hidden>
        <div class="panel batch-header">
          <div>
            <div class="batch-title" id="nb-batch-title">Batch Processing</div>
            <div class="batch-sub" id="nb-batch-sub"></div>
          </div>
          <ol class="stepper" id="nb-stepper">
            <li class="step" data-step="1"><span class="dot">1</span><span>Load Feeder</span></li>
            <li class="step" data-step="2"><span class="dot">2</span><span>Scan</span></li>
            <li class="step" data-step="3"><span class="dot">3</span><span>Review</span></li>
            <li class="step" data-step="4"><span class="dot">4</span><span>Save</span></li>
          </ol>
        </div>

        <div class="panel workspace-body">
          <div id="nb-load" class="load-prompt" hidden>
            <p id="nb-load-text"></p>
            <button id="nb-scan-go" class="btn btn-primary btn-lg" type="button">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="3" y1="12" x2="21" y2="12"/></svg>
              Scan
            </button>
          </div>
          <div id="nb-scanning" class="scanning" hidden>
            <div class="spin" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.22-8.56"/><polyline points="21 4 21 10 15 10"/></svg>
            </div>
            <p>Scanning</p>
          </div>
          <div id="nb-checks"></div>
        </div>
      </div>

      <p id="nb-status" class="status"></p>
    `;

    document.getElementById('nb-start').addEventListener('click', startScan);
    document.getElementById('nb-scan-go').addEventListener('click', runScan);
  }

  /**
   * Picks the scanner to use - the saved preference, else the first one found - and
   * (re-)selects it on the API. The API's in-memory TWAIN session resets on every
   * restart, so this must run each time the view is opened, not just once.
   */
  async function ensureScannerSelected() {
    const [scanners, current] = await Promise.all([
      window.checkScan.listScanners(),
      window.checkScan.getCurrentScanner(),
    ]);

    if (scanners.length === 0) {
      setStatus('No TWAIN scanner found. Choose one in Settings.');
      return;
    }

    const pick = scanners.find((s) => current && current.sourceId === s.id) ?? scanners[0];
    await window.checkScan.selectScanner(pick.id, pick.name);
  }

  /** Marks the stepper: everything before `active` is done, `active` is current. */
  function setPhase(active) {
    document.querySelectorAll('#nb-stepper .step').forEach((el) => {
      const n = Number(el.dataset.step);
      el.classList.toggle('done', n < active);
      el.classList.toggle('active', n === active);
    });
  }

  function updateSub() {
    const scanned = checks.filter(Boolean).length;
    const pending = checks.filter((c) => c && c.status === 'pending').length;
    document.getElementById('nb-batch-sub').textContent =
      `${scanned} check${scanned === 1 ? '' : 's'} scanned. ${pending} pending review.`;
  }

  // Step 1: open the batch workspace and prompt the user to load checks. No scan fires yet.
  async function startScan() {
    const startButton = document.getElementById('nb-start');
    startButton.disabled = true;
    try {
      const { id } = await window.checkScan.createBatch();
      currentBatchId = id;
      checks = [];
      selectedIndex = null;
      fundraisers = await window.checkScan.listFundraisers();

      document.getElementById('nb-batch-title').textContent =
        `Batch Processing: B-${new Date().getFullYear()}-${String(id).padStart(4, '0')}`;
      updateSub();
      document.getElementById('nb-checks').innerHTML = '';
      document.getElementById('nb-empty').hidden = true;
      document.getElementById('nb-workspace').hidden = false;
      document.getElementById('nb-scanning').hidden = true;
      setStatus('');
      setPhase(1);

      let hasFeeder = false;
      try {
        ({ hasFeeder } = await window.checkScan.getFeederStatus());
      } catch {
        // Fall through to the flatbed wording if the status check fails.
      }
      document.getElementById('nb-load-text').textContent = hasFeeder
        ? 'Load the checks into the document feeder, then Scan.'
        : 'Place a check on the scanner glass, then Scan.';
      document.getElementById('nb-load').hidden = false;
    } catch (err) {
      setStatus(`Could not start batch: ${err.message}`);
      document.getElementById('nb-workspace').hidden = true;
      document.getElementById('nb-empty').hidden = false;
    } finally {
      startButton.disabled = false;
    }
  }

  // Step 2: the user has loaded their check(s) - trigger the scan.
  async function runScan() {
    document.getElementById('nb-load').hidden = true;
    document.getElementById('nb-scanning').hidden = false;
    setStatus('');
    setPhase(2);
    try {
      await window.checkScan.startScan();
    } catch (err) {
      setStatus(`Scan failed: ${err.message}`);
      document.getElementById('nb-scanning').hidden = true;
      document.getElementById('nb-load').hidden = false;
    }
  }

  function setStatus(text) {
    document.getElementById('nb-status').textContent = text;
  }

  function showSavedModal(message) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="nb-modal-title">
        <button class="modal-close" type="button" aria-label="Close">
          <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
        </button>
        <div class="modal-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="9 12 11 14 15 10"/></svg>
        </div>
        <h2 id="nb-modal-title" class="modal-title">Checks Saved</h2>
        <p class="modal-text">${message}</p>
        <button class="btn btn-primary modal-ok" type="button">Okay</button>
      </div>
    `;

    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    };
    function onKey(e) {
      if (e.key === 'Escape') close();
    }

    overlay.querySelector('.modal-close').addEventListener('click', close);
    overlay.querySelector('.modal-ok').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', onKey);

    document.body.appendChild(overlay);
    overlay.querySelector('.modal-ok').focus();
  }

  function fundraiserOptionsHtml(selectedId) {
    return fundraisers
      .map((f) => `<option value="${f.id}" ${f.id === selectedId ? 'selected' : ''}>${escapeHtml(f.name)}</option>`)
      .join('');
  }

  function normalizeForMatch(name) {
    return (name ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\b(the|fund|charitable|inc)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function matchFundraiserByName(name) {
    const normalized = normalizeForMatch(name);
    if (!normalized) return null;
    const exact = fundraisers.find((f) => normalizeForMatch(f.name) === normalized);
    if (exact) return exact;
    return fundraisers.find((f) => {
      const fNorm = normalizeForMatch(f.name);
      return fNorm && (fNorm.includes(normalized) || normalized.includes(fNorm));
    }) ?? null;
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function formatAmount(v) {
    const n = Number(v);
    return Number.isFinite(n) && v !== '' && v != null ? `$${n.toFixed(2)}` : (v || '—');
  }

  function confidencePercent(confidence) {
    const nums = Object.values(confidence || {}).map(Number).filter(Number.isFinite);
    if (nums.length === 0) return null;
    return Math.round(Math.min(...nums) * 100);
  }

  // ---------- Scan stream ----------

  async function handleCheckScanned(payload) {
    if (payload.type === 'scan-error') {
      setStatus(payload.message);
      document.getElementById('nb-scanning').hidden = true;
      return;
    }

    if (payload.done) {
      document.getElementById('nb-scanning').hidden = true;
      if (checks.filter(Boolean).length === 0) {
        setStatus('No checks were scanned. Check the feeder and try again.');
      } else {
        setPhase(3);
      }
      updateSub();
      return;
    }

    document.getElementById('nb-scanning').hidden = true;

    const entry = {
      index: payload.index,
      imagePath: payload.imagePath,
      imageDataUrl: null,
      confidence: {},
      values: Object.fromEntries(VALUE_KEYS.map((k) => [k, ''])),
      fundraiserId: null,
      autoMatched: false,
      status: 'pending',
      error: null,
      extracting: true,
    };
    checks[payload.index] = entry;
    updateSub();
    renderReview();
    if (selectedIndex == null) selectCheck(payload.index);

    // Load the preview image and run extraction in parallel.
    window.checkScan.getCheckImage(payload.imagePath).then((dataUrl) => {
      entry.imageDataUrl = dataUrl;
      renderRows();
      if (selectedIndex === entry.index) renderPanel();
    });

    try {
      const extracted = await window.checkScan.extractCheck(payload.imagePath);
      entry.confidence = extracted.confidence ?? {};
      for (const k of VALUE_KEYS) entry.values[k] = extracted[k] ?? '';
      const matched = matchFundraiserByName(extracted.bank);
      entry.fundraiserId = matched ? matched.id : null;
      entry.autoMatched = Boolean(matched);
      entry.extracting = false;
    } catch (err) {
      entry.extracting = false;
      entry.status = 'flagged';
      entry.error = err.message;
    }

    updateSub();
    renderRows();
    if (selectedIndex === entry.index) renderPanel();
    refreshSaveButton();
  }

  // ---------- Review workspace ----------

  function renderReview() {
    const host = document.getElementById('nb-checks');
    if (host.querySelector('.review-layout')) {
      renderRows();
      return;
    }
    host.innerHTML = `
      <div class="review-layout">
        <div class="review-table-wrap">
          <table class="review-table">
            <thead>
              <tr>
                <th>Preview</th>
                <th>Date / Bank</th>
                <th>Amount</th>
                <th>Fundraiser</th>
                <th class="col-status">Status</th>
              </tr>
            </thead>
            <tbody id="nb-review-rows"></tbody>
          </table>
        </div>
        <aside class="verification-panel">
          <h3>
            <svg viewBox="0 0 24 24" aria-hidden="true" class="panel-icon"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            Review Verification
          </h3>
          <div id="nb-verify-body" class="verify-body"></div>
        </aside>
      </div>
      <div class="review-footer">
        <button id="nb-save-batch" class="btn btn-primary" type="button" disabled>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          Confirm and Save Batch
        </button>
      </div>
    `;
    document.getElementById('nb-save-batch').addEventListener('click', confirmAndSaveBatch);
    renderRows();
    renderPanel();
  }

  function statusIcon(status) {
    if (status === 'verified' || status === 'saved') {
      return `<span class="status-icon is-verified" title="Verified"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="8 12.5 11 15.5 16 9"/></svg></span>`;
    }
    if (status === 'flagged') {
      return `<span class="status-icon is-flagged" title="Flagged for review"><svg viewBox="0 0 24 24"><path d="M12 3l9 16H3z"/><line x1="12" y1="10" x2="12" y2="14"/><line x1="12" y1="17" x2="12" y2="17"/></svg></span>`;
    }
    return `<span class="status-icon is-pending" title="Pending review"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6"/></svg></span>`;
  }

  function renderRows() {
    const tbody = document.getElementById('nb-review-rows');
    if (!tbody) return;
    tbody.innerHTML = '';
    checks.forEach((entry) => {
      if (!entry) return;
      const tr = document.createElement('tr');
      tr.dataset.index = String(entry.index);
      if (entry.index === selectedIndex) tr.classList.add('selected');
      tr.innerHTML = `
        <td class="col-preview">
          ${entry.imageDataUrl
            ? `<img class="review-thumb" src="${entry.imageDataUrl}" alt="Check ${entry.index + 1}" />`
            : `<div class="review-thumb is-placeholder"></div>`}
        </td>
        <td>
          <div>${escapeHtml(entry.values.date || '—')}</div>
          <div class="cell-sub">${escapeHtml(entry.values.bank || (entry.extracting ? 'Reading…' : '—'))}</div>
        </td>
        <td>${escapeHtml(formatAmount(entry.values.amount))}</td>
        <td class="col-fundraiser">
          <select data-role="fundraiser">
            <option value="">Assign Fundraiser…</option>
            ${fundraiserOptionsHtml(entry.fundraiserId)}
          </select>
        </td>
        <td class="col-status">${statusIcon(entry.status)}</td>
      `;
      tr.addEventListener('click', (e) => {
        if (e.target.closest('select')) return;
        selectCheck(entry.index);
      });
      tr.querySelector('[data-role="fundraiser"]').addEventListener('change', (e) => {
        entry.fundraiserId = Number(e.target.value) || null;
        if (selectedIndex === entry.index) renderPanel();
      });
      tbody.appendChild(tr);
    });
  }

  function selectCheck(index) {
    selectedIndex = index;
    zoom = 1;
    panX = 0;
    panY = 0;
    document.querySelectorAll('#nb-review-rows tr').forEach((tr) => {
      tr.classList.toggle('selected', Number(tr.dataset.index) === index);
    });
    renderPanel();
  }

  function fieldInputHtml(field, entry) {
    const raw = entry.confidence ? Number(entry.confidence[field.key]) : NaN;
    const low = Number.isFinite(raw) && raw < 0.75;
    return `
      <label class="field ${field.className || ''} ${low ? 'low-confidence' : ''}">
        <span>${field.label}</span>
        <input type="text" data-field="${field.key}" value="${escapeHtml(entry.values[field.key])}" />
      </label>
    `;
  }

  function renderPanel() {
    const body = document.getElementById('nb-verify-body');
    if (!body) return;

    if (selectedIndex == null || !checks[selectedIndex]) {
      body.innerHTML = `<p class="verify-empty">Select a check to review.</p>`;
      return;
    }

    const entry = checks[selectedIndex];
    const pct = confidencePercent(entry.confidence);
    const row2 = PANEL_FIELDS.filter((f) => f.group === 'row2');
    const singles = PANEL_FIELDS.filter((f) => f.group !== 'row2');

    body.innerHTML = `
      <div class="check-viewer" id="nb-viewer">
        ${entry.imageDataUrl
          ? `<img id="nb-viewer-img" src="${entry.imageDataUrl}" alt="Check ${entry.index + 1}" draggable="false" />`
          : `<div class="viewer-empty">${entry.extracting ? 'Loading preview…' : 'No preview available'}</div>`}
        ${pct != null ? `<span class="confidence-badge">Confidence: ${pct}%</span>` : ''}
      </div>

      ${entry.error ? `<p class="verify-error">Extraction failed: ${escapeHtml(entry.error)}</p>` : ''}
      ${entry.autoMatched ? `<p class="verify-hint">Fundraiser matched from the bank logo — verify before confirming.</p>` : ''}

      <div class="verify-fields">
        ${fieldInputHtml(singles[0], entry)}
        <div class="field-row-2">
          ${row2.map((f) => fieldInputHtml(f, entry)).join('')}
        </div>
        ${singles.slice(1).map((f) => fieldInputHtml(f, entry)).join('')}
      </div>

      <p class="verify-msg" data-role="verify-msg"></p>

      <div class="verify-actions">
        <button class="btn" type="button" data-role="flag">Flag for Review</button>
        <button class="btn btn-primary" type="button" data-role="verify">Verify &amp; Next</button>
      </div>
    `;

    body.querySelectorAll('input[data-field]').forEach((input) => {
      input.addEventListener('input', () => {
        entry.values[input.dataset.field] = input.value;
      });
      input.addEventListener('change', () => {
        const f = input.dataset.field;
        if (f === 'amount' || f === 'date' || f === 'bank') renderRows();
      });
    });

    body.querySelector('[data-role="flag"]').addEventListener('click', () => {
      entry.status = 'flagged';
      afterReviewAdvance(entry.index);
    });
    body.querySelector('[data-role="verify"]').addEventListener('click', () => {
      if (!entry.fundraiserId) {
        body.querySelector('[data-role="verify-msg"]').textContent = 'Pick a fundraiser before verifying.';
        return;
      }
      entry.status = 'verified';
      afterReviewAdvance(entry.index);
    });

    setupViewerZoom();
  }

  function afterReviewAdvance(fromIndex) {
    updateSub();
    renderRows();
    refreshSaveButton();
    const next = checks.find((c, i) => c && i > fromIndex && c.status === 'pending')
      ?? checks.find((c) => c && c.status === 'pending');
    if (next) selectCheck(next.index);
    else renderPanel();
  }

  function refreshSaveButton() {
    const btn = document.getElementById('nb-save-batch');
    if (!btn) return;
    const list = checks.filter(Boolean);
    const ready = list.length > 0 && list.every((c) => c.status !== 'pending');
    btn.disabled = !ready;
  }

  function setupViewerZoom() {
    const viewer = document.getElementById('nb-viewer');
    const img = document.getElementById('nb-viewer-img');
    if (!viewer || !img) return;

    const apply = () => {
      if (zoom <= 1.001) { panX = 0; panY = 0; }
      img.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
      viewer.classList.toggle('is-zoomed', zoom > 1.001);
    };
    apply();

    viewer.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      zoom = Math.min(6, Math.max(1, zoom * factor));
      apply();
    }, { passive: false });

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    viewer.addEventListener('pointerdown', (e) => {
      if (zoom <= 1.001) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      viewer.setPointerCapture(e.pointerId);
      viewer.classList.add('is-panning');
    });
    viewer.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      panX += e.clientX - lastX;
      panY += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      apply();
    });
    const endDrag = (e) => {
      dragging = false;
      viewer.classList.remove('is-panning');
      if (e.pointerId != null && viewer.hasPointerCapture?.(e.pointerId)) {
        viewer.releasePointerCapture(e.pointerId);
      }
    };
    viewer.addEventListener('pointerup', endDrag);
    viewer.addEventListener('pointercancel', endDrag);
  }

  async function confirmAndSaveBatch() {
    const btn = document.getElementById('nb-save-batch');
    btn.disabled = true;
    setStatus('Saving batch…');
    setPhase(4);

    // Verified checks save as "Verified"; flagged checks are persisted too, as
    // "Action Required", but only if a fundraiser was picked (the row FK requires one).
    const toSave = checks.filter((c) => c && (c.status === 'verified' || c.status === 'flagged') && c.fundraiserId);
    const skipped = checks.filter((c) => c && c.status === 'flagged' && !c.fundraiserId).length;
    const failures = [];
    let savedOk = 0;

    for (const entry of toSave) {
      try {
        await window.checkScan.saveCheck({
          fundraiserId: entry.fundraiserId,
          batchId: currentBatchId,
          amount: Number(entry.values.amount) || 0,
          legalAmount: entry.values.legalAmount || null,
          bank: entry.values.bank || '',
          checkDate: entry.values.date || new Date().toISOString(),
          memo: entry.values.memo || null,
          routingNumber: entry.values.routingNumber || null,
          accountNumber: entry.values.accountNumber || null,
          donorName: entry.values.donorName || null,
          checkNumber: entry.values.checkNumber || null,
          imagePath: entry.imagePath,
          confidenceJson: JSON.stringify(entry.confidence || {}),
          status: entry.status === 'flagged' ? 'Action Required' : 'Verified',
        });
        entry.status = 'saved';
        savedOk += 1;
      } catch (err) {
        failures.push(`Check ${entry.index + 1}: ${err.message}`);
      }
    }

    renderRows();

    if (failures.length) {
      setPhase(3);
      btn.disabled = false;
      setStatus(`Saved ${savedOk}/${toSave.length}. ` + failures.join(' | '));
      return;
    }

    const note = skipped ? ` ${skipped} flagged check${skipped === 1 ? '' : 's'} skipped (no fundraiser).` : '';
    setStatus(`Batch saved — ${savedOk} check${savedOk === 1 ? '' : 's'}.${note}`);

    if (savedOk > 0) {
      // The Reports and Fundraisers views cache their data across navigation - mark them stale
      // so the next visit re-fetches and shows the checks just saved.
      window.Views.reports?.invalidate?.();
      window.Views.fundraisers?.invalidate?.();

      const skipNote = skipped
        ? ` ${skipped} flagged check${skipped === 1 ? '' : 's'} ${skipped === 1 ? 'was' : 'were'} skipped because no fundraiser was assigned.`
        : '';
      showSavedModal(`Every check has been added to its fundraiser's history.${skipNote}`);
    }
  }

  window.checkScan.onCheckScanned(handleCheckScanned);

  window.Views = window.Views || {};
  window.Views.newBatch = {
    async init() {
      if (!rendered) {
        render();
        rendered = true;
      }
      await ensureScannerSelected();
    },
  };
})();
