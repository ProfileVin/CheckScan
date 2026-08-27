(function () {
  function root() {
    return document.getElementById('view-reports');
  }

  function render() {
    root().innerHTML = `
      <div class="toolbar">
        <select id="rp-group-by">
          <option value="fundraiser">By fundraiser</option>
          <option value="bank">By bank</option>
          <option value="date">By date</option>
        </select>
        <input id="rp-from" type="date" />
        <input id="rp-to" type="date" />
        <button id="rp-run">Run</button>
        <button id="rp-export">Export CSV</button>
      </div>
      <p id="rp-status"></p>
      <table id="rp-table">
        <thead><tr><th>Group</th><th>Count</th><th>Total</th></tr></thead>
        <tbody></tbody>
      </table>
    `;

    document.getElementById('rp-run').addEventListener('click', runReport);
    document.getElementById('rp-export').addEventListener('click', exportReport);
  }

  function currentFilters() {
    return {
      groupBy: document.getElementById('rp-group-by').value,
      from: document.getElementById('rp-from').value || undefined,
      to: document.getElementById('rp-to').value || undefined,
    };
  }

  async function runReport() {
    const { groupBy, from, to } = currentFilters();
    const rows = await window.checkScan.getReportsSummary(groupBy, from, to);

    document.querySelector('#rp-table tbody').innerHTML = rows
      .map((r) => `<tr><td>${r.group}</td><td>${r.count}</td><td>$${r.total.toFixed(2)}</td></tr>`)
      .join('');
  }

  async function exportReport() {
    const { groupBy, from, to } = currentFilters();
    const status = document.getElementById('rp-status');
    try {
      const result = await window.checkScan.exportReportsCsv(groupBy, from, to);
      status.textContent = result.saved ? `Saved to ${result.filePath}` : 'Export canceled.';
    } catch (err) {
      status.textContent = `Export failed: ${err.message}`;
    }
  }

  window.Views = window.Views || {};
  window.Views.reports = {
    async init() {
      render();
      await runReport();
    },
  };
})();
