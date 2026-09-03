(function () {
  // Navigation cache: render()/bind once, keep the last scanner enumeration between visits and
  // paint from it instantly on re-entry while a fresh enumeration runs in the background.
  let rendered = false;
  let scannerCache = null; // { scanners: [{id,name}], current: {sourceId,sourceName}|null }

  function root() {
    return document.getElementById('view-settings');
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function setStatus(text, kind) {
    const el = document.getElementById('st-status');
    el.textContent = text || '';
    el.classList.toggle('is-error', kind === 'error');
    el.classList.toggle('is-ok', kind === 'ok');
  }

  function render() {
    root().innerHTML = `
      <div class="cfg-page">
        <div class="cfg-head">
          <h1 class="fr-title">Configuration</h1>
          <p class="fr-subtitle">Manage hardware connections and AI service credentials.</p>
        </div>

        <div class="cfg-card">
          <div class="cfg-card-head">
            <svg class="cfg-card-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="3" y1="12" x2="21" y2="12"/></svg>
            <h2>Scanner Settings</h2>
          </div>

          <div class="cfg-field">
            <label class="cfg-label" for="st-scanner">Hardware Interface</label>
            <select id="st-scanner" class="cfg-select"></select>
          </div>

          <div class="cfg-actions">
            <button id="st-detect" class="btn" type="button">Detect Scanners</button>
            <button id="st-test" class="btn btn-soft" type="button">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
              Test Connection
            </button>
          </div>

          <p id="st-status" class="cfg-status"></p>

          <div class="cfg-note">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            <p>Ensure your scanner is powered on and connected via USB or network before attempting to detect devices. TWAIN drivers must be installed locally.</p>
          </div>
        </div>
      </div>
    `;

    document.getElementById('st-scanner').addEventListener('change', selectScanner);
    document.getElementById('st-detect').addEventListener('click', detectScanners);
    document.getElementById('st-test').addEventListener('click', testConnection);
  }

  // Rebuild the dropdown + status line from scannerCache, preserving the current selection.
  function paintScanners() {
    if (!scannerCache) return;
    const { scanners, current } = scannerCache;
    const select = document.getElementById('st-scanner');
    const prev = select.value;

    select.innerHTML = scanners
      .map((s) => `<option value="${escapeHtml(s.id)}"${current && current.sourceId === s.id ? ' selected' : ''}>${escapeHtml(s.name)}</option>`)
      .join('');

    if (prev && [...select.options].some((o) => o.value === prev)) select.value = prev;

    if (current) {
      setStatus(`Currently selected: ${current.sourceName}`);
    } else if (scanners.length === 0) {
      setStatus('No TWAIN scanners found.');
    } else {
      setStatus('No scanner selected yet.');
    }
  }

  async function refresh({ background }) {
    try {
      const [scanners, current] = await Promise.all([
        window.checkScan.listScanners(),
        window.checkScan.getCurrentScanner(),
      ]);
      scannerCache = { scanners, current };
      paintScanners();
      return scanners;
    } catch (err) {
      // A failed background enumeration leaves the cached dropdown untouched.
      if (!background) setStatus(`Could not load scanners: ${err.message}`, 'error');
      return null;
    }
  }

  async function selectScanner() {
    const option = document.getElementById('st-scanner').selectedOptions[0];
    if (!option) return;
    try {
      await window.checkScan.selectScanner(option.value, option.textContent);
      setStatus(`Currently selected: ${option.textContent}`);
    } catch (err) {
      setStatus(`Could not select scanner: ${err.message}`, 'error');
    }
  }

  async function detectScanners() {
    const btn = document.getElementById('st-detect');
    btn.disabled = true;
    setStatus('Detecting scanners…');
    try {
      const scanners = await refresh({ background: false });
      if (scanners && scanners.length > 0) {
        setStatus(`Found ${scanners.length} scanner${scanners.length === 1 ? '' : 's'}.`);
      }
    } catch (err) {
      setStatus(`Detection failed: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  async function testConnection() {
    const btn = document.getElementById('st-test');
    btn.disabled = true;
    setStatus('Testing connection…');
    try {
      const r = await window.checkScan.testScanner();
      const feeder = r.hasFeeder
        ? `Document feeder ${r.feederLoaded ? 'loaded' : 'empty'}.`
        : 'No document feeder on this device.';
      setStatus(`Connected. ${feeder}`, 'ok');
    } catch (err) {
      setStatus(`Connection failed: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  window.Views = window.Views || {};
  window.Views.settings = {
    async init() {
      if (!rendered) {
        render();
        rendered = true;
      }
      if (scannerCache) {
        paintScanners();               // instant, from cache
        refresh({ background: true }); // fire-and-forget re-enumeration
      } else {
        await refresh({ background: false });
      }
    },
  };
})();
