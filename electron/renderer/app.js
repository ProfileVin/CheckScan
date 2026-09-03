const TABS = ['new-batch', 'fundraisers', 'reports', 'settings'];

function showTab(tab) {
  for (const name of TABS) {
    document.getElementById(`view-${name}`).hidden = name !== tab;
    document.querySelector(`nav a[data-tab="${name}"]`).classList.toggle('active', name === tab);
  }
}

function currentTab() {
  const hash = location.hash.replace('#', '');
  return TABS.includes(hash) ? hash : 'new-batch';
}

async function navigate() {
  const tab = currentTab();
  showTab(tab);

  switch (tab) {
    case 'new-batch':
      return window.Views.newBatch.init();
    case 'fundraisers':
      return window.Views.fundraisers.init();
    case 'reports':
      return window.Views.reports.init();
    case 'settings':
      return window.Views.settings.init();
  }
}

window.addEventListener('hashchange', navigate);
navigate();

// Sidebar CTA: jump to New Batch and kick off a scan via that view's own button.
document.getElementById('sidebar-scan').addEventListener('click', () => {
  location.hash = 'new-batch';
  setTimeout(() => document.getElementById('nb-start')?.click(), 0);
});
