const statusDot = document.getElementById('statusDot');
const statusBadge = document.getElementById('statusBadge');
const engineStatus = document.getElementById('engineStatus');
const toggleBtn = document.getElementById('toggleBtn');
const toggleBtnText = document.getElementById('toggleBtnText');
const currentTabCard = document.getElementById('currentTabCard');
const currentTabDomainEl = document.getElementById('currentTabDomain');
const toggleTabDomainBtn = document.getElementById('toggleTabDomainBtn');
const domainCountEl = document.getElementById('domainCount');
const domainInput = document.getElementById('domainInput');
const addDomainBtn = document.getElementById('addDomainBtn');
const domainListEl = document.getElementById('domainList');
const errorBox = document.getElementById('errorBox');

let isEnabled = false;
let directDomains = [];
let activeTabRootDomain = null;

function cleanDomain(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

function showError(msg) {
  if (!msg) {
    errorBox.style.display = 'none';
    errorBox.textContent = '';
    return;
  }
  errorBox.textContent = msg;
  errorBox.style.display = 'block';
}

function isDomainExcluded(host) {
  if (!host) return false;
  if (host.endsWith('.tr')) return true;
  return directDomains.some((d) => host === d || host.endsWith('.' + d));
}

function renderUI(state) {
  isEnabled = !!state.enabled;
  directDomains = Array.isArray(state.directDomains) ? state.directDomains : [];

  if (!state.serviceOnline) {
    statusDot.className = 'logo-dot';
    statusBadge.className = 'badge';
    statusBadge.textContent = 'SERVİS KAPALI';
    engineStatus.textContent = '1_Arka_Plan_Servisini_Kur.bat çalıştırın';
    showError('Yerel arka plan servisi (127.0.0.1:10808) çalışmıyor.');
  } else {
    showError('');
    if (isEnabled) {
      statusDot.className = 'logo-dot online';
      statusBadge.className = 'badge active';
      statusBadge.textContent = 'AKTİF';
      engineStatus.textContent = state.ciaPid
        ? `DPI Motoru Çalışıyor (PID: ${state.ciaPid})`
        : 'DPI + DoH Opera İçinde Aktif';
      toggleBtn.className = 'power-btn on';
      toggleBtnText.textContent = 'DURDUR';
    } else {
      statusDot.className = 'logo-dot';
      statusBadge.className = 'badge';
      statusBadge.textContent = 'DURDURULDU';
      engineStatus.textContent = 'DPI Motoru Kapalı (Standart Bağlantı)';
      toggleBtn.className = 'power-btn off';
      toggleBtnText.textContent = 'BAŞLAT';
    }
  }

  // Update active tab card
  if (activeTabRootDomain) {
    currentTabCard.style.display = 'flex';
    currentTabDomainEl.textContent = activeTabRootDomain;
    const excluded = isDomainExcluded(activeTabRootDomain);
    if (excluded) {
      toggleTabDomainBtn.className = 'small-btn excluded';
      toggleTabDomainBtn.textContent = '✓ Hariç Tutuldu (Çıkar)';
    } else {
      toggleTabDomainBtn.className = 'small-btn';
      toggleTabDomainBtn.textContent = '+ Doğrudan Bağlan (Hariç Tut)';
    }
  } else {
    currentTabCard.style.display = 'none';
  }

  // Render domain chips
  domainCountEl.textContent = String(directDomains.length);
  domainListEl.innerHTML = '';
  for (const d of directDomains) {
    const chip = document.createElement('span');
    chip.className = 'domain-chip';
    const text = document.createElement('span');
    text.textContent = d;
    const delBtn = document.createElement('button');
    delBtn.textContent = '×';
    delBtn.title = 'Listeden çıkar';
    delBtn.addEventListener('click', () => removeDomain(d));
    chip.appendChild(text);
    chip.appendChild(delBtn);
    domainListEl.appendChild(chip);
  }
}

async function saveDomains(newList) {
  chrome.runtime.sendMessage(
    { type: 'UPDATE_DOMAINS', directDomains: newList },
    (res) => {
      if (res && res.ok) {
        directDomains = res.directDomains;
        renderUI({
          serviceOnline: true,
          enabled: isEnabled,
          directDomains
        });
      }
    }
  );
}

function addDomain(raw) {
  const d = cleanDomain(raw);
  if (!d || !d.includes('.')) return;
  if (!directDomains.includes(d)) {
    saveDomains([d, ...directDomains]);
  }
  domainInput.value = '';
}

function removeDomain(d) {
  saveDomains(directDomains.filter((item) => item !== d));
}

toggleBtn.addEventListener('click', () => {
  const msgType = isEnabled ? 'STOP_DPI' : 'START_DPI';
  toggleBtn.disabled = true;
  chrome.runtime.sendMessage({ type: msgType }, (res) => {
    toggleBtn.disabled = false;
    if (res && res.ok) {
      chrome.runtime.sendMessage({ type: 'GET_STATE' }, renderUI);
    } else {
      showError((res && res.error) || 'Yerel servise ulaşılamadı.');
    }
  });
});

addDomainBtn.addEventListener('click', () => addDomain(domainInput.value));
domainInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addDomain(domainInput.value);
});

toggleTabDomainBtn.addEventListener('click', () => {
  if (!activeTabRootDomain) return;
  if (isDomainExcluded(activeTabRootDomain)) {
    removeDomain(activeTabRootDomain);
  } else {
    addDomain(activeTabRootDomain);
  }
});

// Detect active tab hostname
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs && tabs[0];
  if (tab && tab.url && /^https?:\/\//i.test(tab.url)) {
    try {
      const u = new URL(tab.url);
      activeTabRootDomain = cleanDomain(u.hostname);
    } catch {}
  }
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, (res) => {
    if (res) renderUI(res);
  });
});
