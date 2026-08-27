(function () {
  function root() {
    return document.getElementById('view-fundraisers');
  }

  function render() {
    root().innerHTML = `
      <div class="toolbar">
        <input id="fr-new-name" type="text" placeholder="New fundraiser name" />
        <button id="fr-add">Add fundraiser</button>
      </div>
      <div class="two-column">
        <ul id="fr-list"></ul>
        <div id="fr-detail"><p>Select a fundraiser to see their history.</p></div>
      </div>
    `;

    document.getElementById('fr-add').addEventListener('click', addFundraiser);
  }

  async function addFundraiser() {
    const input = document.getElementById('fr-new-name');
    const name = input.value.trim();
    if (!name) return;
    await window.checkScan.createFundraiser(name);
    input.value = '';
    await loadList();
  }

  async function loadList() {
    const fundraisers = await window.checkScan.listFundraisers();
    const list = document.getElementById('fr-list');
    list.innerHTML = fundraisers
      .map((f) => `<li data-id="${f.id}">${f.name} - $${f.total.toFixed(2)}</li>`)
      .join('');

    list.querySelectorAll('li').forEach((li) => {
      li.addEventListener('click', () => showDetail(Number(li.dataset.id)));
    });
  }

  async function showDetail(id) {
    const detail = document.getElementById('fr-detail');
    const fundraiser = await window.checkScan.getFundraiser(id);

    if (fundraiser.checks.length === 0) {
      detail.innerHTML = `<h2>${fundraiser.name}</h2><p>No checks yet.</p>`;
      return;
    }

    const rows = fundraiser.checks
      .map((c) => `<tr><td>${new Date(c.checkDate).toLocaleDateString()}</td><td>${c.bank}</td><td>$${c.amount.toFixed(2)}</td></tr>`)
      .join('');

    detail.innerHTML = `
      <h2>${fundraiser.name}</h2>
      <table>
        <thead><tr><th>Date</th><th>Bank</th><th>Amount</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  window.Views = window.Views || {};
  window.Views.fundraisers = {
    async init() {
      render();
      await loadList();
    },
  };
})();
