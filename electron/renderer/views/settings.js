(function () {
  function root() {
    return document.getElementById('view-settings');
  }

  function render() {
    root().innerHTML = `
      <section class="settings-block">
        <h2>Scanner</h2>
        <select id="st-scanner"></select>
        <p id="st-scanner-status"></p>
      </section>

      <section class="settings-block">
        <h2>AI Extraction (Anthropic)</h2>
        <p id="st-key-status"></p>
        <input id="st-api-key" type="password" placeholder="sk-ant-..." autocomplete="off" />
        <button id="st-save-key">Save Key</button>
        <p id="st-key-save-status"></p>
      </section>

      <section class="settings-block">
        <h2>Database (Azure SQL)</h2>
        <p id="st-db-status"></p>
        <input id="st-db-conn" type="password" placeholder="Server=tcp:...database.windows.net,1433;Database=CheckScan;..." autocomplete="off" />
        <button id="st-save-db">Save Connection</button>
        <p id="st-db-save-status"></p>
      </section>

      <section class="settings-block">
        <h2>Azure Blob Storage</h2>
        <p id="st-blob-status"></p>
        <input id="st-blob-conn" type="password" placeholder="DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=core.windows.net" autocomplete="off" />
        <button id="st-save-blob">Save Connection</button>
        <p id="st-blob-save-status"></p>
        <small>Used only when the API runs with <code>ImageStorage:Provider = AzureBlob</code>.</small>
      </section>
    `;

    document.getElementById('st-scanner').addEventListener('change', selectScanner);
    document.getElementById('st-save-key').addEventListener('click', saveKey);
    document.getElementById('st-save-db').addEventListener('click', saveDbConnection);
    document.getElementById('st-save-blob').addEventListener('click', saveBlobConnection);
  }

  async function loadScanner() {
    const select = document.getElementById('st-scanner');
    const [scanners, current] = await Promise.all([
      window.checkScan.listScanners(),
      window.checkScan.getCurrentScanner(),
    ]);

    select.innerHTML = scanners
      .map((s) => `<option value="${s.id}" ${current && current.sourceId === s.id ? 'selected' : ''}>${s.name}</option>`)
      .join('');

    document.getElementById('st-scanner-status').textContent = current
      ? `Currently selected: ${current.sourceName}`
      : scanners.length === 0
        ? 'No TWAIN scanners found.'
        : 'No scanner selected yet.';
  }

  async function selectScanner() {
    const select = document.getElementById('st-scanner');
    const option = select.selectedOptions[0];
    if (!option) return;
    await window.checkScan.selectScanner(option.value, option.textContent);
    document.getElementById('st-scanner-status').textContent = `Currently selected: ${option.textContent}`;
  }

  async function loadKeyStatus() {
    const isSet = await window.checkScan.getAiKeyStatus();
    document.getElementById('st-key-status').textContent = isSet
      ? 'Anthropic API key: set ✓'
      : 'Anthropic API key: not set';
  }

  async function saveKey() {
    const input = document.getElementById('st-api-key');
    const key = input.value.trim();
    const status = document.getElementById('st-key-save-status');
    if (!key) {
      status.textContent = 'Enter a key first.';
      return;
    }

    try {
      await window.checkScan.saveAiKey(key);
      input.value = '';
      status.textContent = 'Saved.';
      await loadKeyStatus();
    } catch (err) {
      status.textContent = `Failed to save: ${err.message}`;
    }
  }

  async function loadConnectionStatus() {
    let dbSet = false;
    let blobSet = false;
    try {
      const status = await window.checkScan.getSettingsStatus();
      dbSet = Boolean(status && status.db);
      blobSet = Boolean(status && status.blob);
    } catch {
      // API not reachable yet - fall through to "not set".
    }
    document.getElementById('st-db-status').textContent = dbSet
      ? 'Database connection: configured ✓'
      : 'Database connection: not set';
    document.getElementById('st-blob-status').textContent = blobSet
      ? 'Azure Blob connection: configured ✓'
      : 'Azure Blob connection: not set';
  }

  async function saveConnection({ inputId, statusId, save, reload }) {
    const input = document.getElementById(inputId);
    const value = input.value.trim();
    const status = document.getElementById(statusId);
    if (!value) {
      status.textContent = 'Enter a connection string first.';
      return;
    }

    status.textContent = 'Checking...';
    try {
      await save(value);
      input.value = '';
      status.textContent = 'Saved.';
      await reload();
    } catch (err) {
      status.textContent = `Failed to save: ${err.message}`;
    }
  }

  function saveDbConnection() {
    return saveConnection({
      inputId: 'st-db-conn',
      statusId: 'st-db-save-status',
      save: (v) => window.checkScan.saveDbConnection(v),
      reload: loadConnectionStatus,
    });
  }

  function saveBlobConnection() {
    return saveConnection({
      inputId: 'st-blob-conn',
      statusId: 'st-blob-save-status',
      save: (v) => window.checkScan.saveBlobConnection(v),
      reload: loadConnectionStatus,
    });
  }

  window.Views = window.Views || {};
  window.Views.settings = {
    async init() {
      render();
      await Promise.all([loadScanner(), loadKeyStatus(), loadConnectionStatus()]);
    },
  };
})();
