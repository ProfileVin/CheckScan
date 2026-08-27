(function () {
  const FIELDS = ['amount', 'date', 'bank', 'routingNumber', 'accountNumber', 'donorName', 'checkNumber'];

  let rendered = false;
  let currentBatchId = null;
  let fundraisers = [];
  let checkCount = 0;

  function root() {
    return document.getElementById('view-new-batch');
  }

  function render() {
    root().innerHTML = `
      <div class="toolbar">
        <select id="nb-scanner"></select>
        <button id="nb-new-batch">New Batch</button>
        <button id="nb-scan-single" disabled>Scan 1</button>
        <button id="nb-scan-batch" disabled>Scan Batch</button>
      </div>
      <p id="nb-status"></p>
      <div id="nb-checks"></div>
    `;

    document.getElementById('nb-new-batch').addEventListener('click', startNewBatch);
    document.getElementById('nb-scan-single').addEventListener('click', () => scanBatch(true));
    document.getElementById('nb-scan-batch').addEventListener('click', () => scanBatch(false));
    document.getElementById('nb-scanner').addEventListener('change', selectCurrentScanner);
  }

  async function loadScanners() {
    const select = document.getElementById('nb-scanner');
    const [scanners, current] = await Promise.all([
      window.checkScan.listScanners(),
      window.checkScan.getCurrentScanner(),
    ]);

    select.innerHTML = '';
    for (const scanner of scanners) {
      const option = document.createElement('option');
      option.value = scanner.id;
      option.textContent = scanner.name;
      if (current && current.sourceId === scanner.id) option.selected = true;
      select.appendChild(option);
    }

    if (scanners.length === 0) {
      setStatus('No TWAIN scanners found.');
    } else {
      // The remembered preference is just a DB row - the API's in-memory TWAIN session
      // resets on every restart, so the source must always be (re-)selected here regardless
      // of whether a saved preference already made the dropdown look pre-selected.
      await selectCurrentScanner();
    }
  }

  async function selectCurrentScanner() {
    const select = document.getElementById('nb-scanner');
    const option = select.selectedOptions[0];
    if (!option) return;
    await window.checkScan.selectScanner(option.value, option.textContent);
  }

  async function startNewBatch() {
    const { id } = await window.checkScan.createBatch();
    currentBatchId = id;
    checkCount = 0;
    document.getElementById('nb-checks').innerHTML = '';
    document.getElementById('nb-scan-single').disabled = false;
    document.getElementById('nb-scan-batch').disabled = false;
    fundraisers = await window.checkScan.listFundraisers();
    setStatus(`Batch #${id} started. Load the feeder and click "Scan Batch".`);
  }

  async function scanBatch(singleScan) {
    setStatus(singleScan ? 'Scanning 1 check...' : 'Scanning...');
    try {
      await window.checkScan.startScan(singleScan);
    } catch (err) {
      setStatus(`Scan failed: ${err.message}`);
    }
  }

  function setStatus(text) {
    document.getElementById('nb-status').textContent = text;
  }

  function fundraiserOptionsHtml(selectedId) {
    return fundraisers
      .map((f) => `<option value="${f.id}" ${f.id === selectedId ? 'selected' : ''}>${f.name}</option>`)
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

  function fieldRowHtml(field, value, confidence) {
    const level = typeof confidence === 'string' ? confidence.toLowerCase() : null;
    const lowConfidence = level === 'low';
    const label = field.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
    return `
      <label class="field ${lowConfidence ? 'low-confidence' : ''}">
        <span>${label}${level ? ` (${level})` : ''}</span>
        <input type="text" data-field="${field}" value="${value ?? ''}" />
      </label>
    `;
  }

  function addCheckRow(index, imagePath) {
    const card = document.createElement('div');
    card.className = 'check-card';
    card.id = `check-${index}`;
    card.innerHTML = `<p>Check ${index + 1}: scanned, extracting details...</p>`;
    document.getElementById('nb-checks').appendChild(card);
    return card;
  }

  async function handleCheckScanned(payload) {
    if (payload.type === 'scan-error') {
      setStatus(payload.message);
      return;
    }

    if (payload.done) {
      setStatus(`Batch complete: ${payload.index} check(s) scanned.`);
      return;
    }

    checkCount = Math.max(checkCount, payload.index + 1);
    const card = addCheckRow(payload.index, payload.imagePath);

    let extracted;
    try {
      extracted = await window.checkScan.extractCheck(payload.imagePath);
    } catch (err) {
      card.innerHTML = `<p>Check ${payload.index + 1}: extraction failed (${err.message})</p>`;
      return;
    }

    const confidence = extracted.confidence ?? {};
    const matchedFundraiser = matchFundraiserByName(extracted.bank);
    card.innerHTML = `
      <h3>Check ${payload.index + 1}</h3>
      <div class="fields">
        ${FIELDS.map((f) => fieldRowHtml(f, extracted[f], confidence[f])).join('')}
      </div>
      <label class="field">
        <span>Fundraiser</span>
        <select data-role="fundraiser">
          <option value="">-- select --</option>
          ${fundraiserOptionsHtml(matchedFundraiser ? matchedFundraiser.id : null)}
        </select>
        ${matchedFundraiser ? '<small data-role="fundraiser-match-hint">Matched from logo &mdash; verify before confirming.</small>' : ''}
      </label>
      <button data-role="new-fundraiser" type="button">+ New fundraiser</button>
      <button data-role="confirm" type="button">Confirm</button>
      <p data-role="save-status"></p>
    `;

    card.querySelector('[data-role="new-fundraiser"]').addEventListener('click', async () => {
      const name = prompt('New fundraiser name:', extracted.bank || '');
      if (!name) return;
      const created = await window.checkScan.createFundraiser(name);
      fundraisers.push(created);
      const select = card.querySelector('[data-role="fundraiser"]');
      const option = document.createElement('option');
      option.value = created.id;
      option.textContent = created.name;
      option.selected = true;
      select.appendChild(option);
    });

    card.querySelector('[data-role="confirm"]').addEventListener('click', async () => {
      const fundraiserId = Number(card.querySelector('[data-role="fundraiser"]').value);
      if (!fundraiserId) {
        card.querySelector('[data-role="save-status"]').textContent = 'Pick a fundraiser first.';
        return;
      }

      const values = {};
      card.querySelectorAll('input[data-field]').forEach((input) => {
        values[input.dataset.field] = input.value;
      });

      try {
        await window.checkScan.saveCheck({
          fundraiserId,
          batchId: currentBatchId,
          amount: Number(values.amount) || 0,
          bank: values.bank || '',
          checkDate: values.date || new Date().toISOString(),
          routingNumber: values.routingNumber || null,
          accountNumber: values.accountNumber || null,
          donorName: values.donorName || null,
          checkNumber: values.checkNumber || null,
          imagePath: payload.imagePath,
          confidenceJson: JSON.stringify(confidence),
        });
        card.querySelector('[data-role="save-status"]').textContent = 'Saved.';
        card.querySelector('[data-role="confirm"]').disabled = true;
      } catch (err) {
        card.querySelector('[data-role="save-status"]').textContent = `Save failed: ${err.message}`;
      }
    });
  }

  window.checkScan.onCheckScanned(handleCheckScanned);

  window.Views = window.Views || {};
  window.Views.newBatch = {
    async init() {
      if (!rendered) {
        render();
        rendered = true;
      }
      await loadScanners();
    },
  };
})();
