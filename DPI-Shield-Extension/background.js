const API_BASE = 'http://127.0.0.1:10808/__dpi_control';

async function updateBadge(enabled) {
  try {
    await chrome.action.setBadgeText({ text: enabled ? 'ON' : 'OFF' });
    await chrome.action.setBadgeBackgroundColor({
      color: enabled ? '#10b981' : '#475569'
    });
  } catch {}
}

async function applyOperaProxy(pacScript) {
  return new Promise((resolve) => {
    chrome.proxy.settings.set(
      {
        value: {
          mode: 'pac_script',
          pacScript: {
            data: pacScript
          }
        },
        scope: 'regular'
      },
      () => resolve()
    );
  });
}

async function clearOperaProxy() {
  return new Promise((resolve) => {
    chrome.proxy.settings.clear({ scope: 'regular' }, () => resolve());
  });
}

async function startDpiEngine() {
  const res = await fetch(`${API_BASE}/start`, { method: 'POST' });
  const data = await res.json();
  if (data && data.ok && data.pacScript) {
    await applyOperaProxy(data.pacScript);
    await chrome.storage.local.set({ enabled: true });
    await updateBadge(true);
    return { ...data, enabled: true };
  }
  throw new Error('Yerel servis yanıt vermedi.');
}

async function stopDpiEngine() {
  await clearOperaProxy();
  await chrome.storage.local.set({ enabled: false });
  await updateBadge(false);
  try {
    const res = await fetch(`${API_BASE}/stop`, { method: 'POST' });
    const data = await res.json();
    return { ...data, enabled: false };
  } catch {
    return { ok: true, running: false, enabled: false };
  }
}

// Restore state when Opera starts up
async function syncStartupState() {
  const { enabled = false } = await chrome.storage.local.get(['enabled']);
  if (enabled) {
    try {
      await startDpiEngine();
    } catch {
      await clearOperaProxy();
      await updateBadge(false);
    }
  } else {
    await clearOperaProxy();
    await updateBadge(false);
  }
}

chrome.runtime.onStartup.addListener(syncStartupState);
chrome.runtime.onInstalled.addListener(syncStartupState);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'GET_STATE') {
        const { enabled = false } = await chrome.storage.local.get(['enabled']);
        await updateBadge(enabled);
        try {
          const res = await fetch(`${API_BASE}/status`);
          const data = await res.json();
          sendResponse({
            ok: true,
            serviceOnline: true,
            enabled,
            running: data.running,
            ciaPid: data.ciaPid,
            directDomains: data.directDomains || []
          });
        } catch {
          sendResponse({
            ok: true,
            serviceOnline: false,
            enabled: false,
            running: false,
            ciaPid: null,
            directDomains: []
          });
        }
        return;
      }

      if (msg.type === 'START_DPI') {
        const out = await startDpiEngine();
        sendResponse({ ok: true, serviceOnline: true, ...out });
        return;
      }

      if (msg.type === 'STOP_DPI') {
        const out = await stopDpiEngine();
        sendResponse({ ok: true, serviceOnline: true, ...out });
        return;
      }

      if (msg.type === 'UPDATE_DOMAINS') {
        const res = await fetch(`${API_BASE}/domains`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ directDomains: msg.directDomains })
        });
        const data = await res.json();
        const { enabled = false } = await chrome.storage.local.get(['enabled']);
        if (enabled && data.pacScript) {
          await applyOperaProxy(data.pacScript);
        }
        sendResponse({ ok: true, directDomains: data.directDomains || [] });
        return;
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message || 'İşlem başarısız' });
    }
  })();
  return true; // keep async message channel open
});
