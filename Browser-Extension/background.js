// MusicBridge Browser Extension - Background Service Worker (Bi-directional Bridge)
// Eren Teknoloji - 2026

let ws = null;
const CORE_PORT = 8765;
let reconnectTimer = null;
let isConnected = false;
let isCheckingHealth = false;

// Sunucunun çalışıp çalışmadığını sessizce kontrol eder (Chrome Hatalar ekranında ERR_CONNECTION_REFUSED çıkmasını engeller)
async function checkCoreAlive() {
  try {
    const res = await fetch(`http://127.0.0.1:${CORE_PORT}/api/status`, {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(1200)
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}

async function connectCoreWs() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  if (isCheckingHealth) return;
  isCheckingHealth = true;

  // 1. Önce sunucunun ayakta olup olmadığını sessizce test et
  const isAlive = await checkCoreAlive();
  isCheckingHealth = false;

  if (!isAlive) {
    // Sunucu henüz başlatılmamış; 3 saniye sonra sessizce tekrar yokla
    reconnectTimer = setTimeout(connectCoreWs, 3000);
    return;
  }

  // 2. Sunucu aktifse WebSocket bağlantısını aç
  try {
    ws = new WebSocket(`ws://127.0.0.1:${CORE_PORT}`);

    ws.onopen = () => {
      isConnected = true;
      console.log(`🎵 MusicBridge PC Core WebSocket Bağlantısı Başarılı (Port: ${CORE_PORT})`);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'browser-command') {
          // Komutu ilgili müzik sekmelerine dağıt
          broadcastCommandToTabs(msg);
        }
      } catch (_) {}
    };

    ws.onclose = () => {
      isConnected = false;
      ws = null;
      reconnectTimer = setTimeout(connectCoreWs, 3000);
    };

    ws.onerror = () => {
      if (ws) {
        try { ws.close(); } catch (_) {}
        ws = null;
      }
    };
  } catch (_) {
    reconnectTimer = setTimeout(connectCoreWs, 3000);
  }
}

connectCoreWs();

// Gelen komutları (seekToQueueIndex, playNext, playPause vb.) açık müzik sekmelerine ilet
function broadcastCommandToTabs(msg) {
  if (!chrome.tabs) return;
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id && tab.url && (
        tab.url.includes('music.youtube.com') ||
        tab.url.includes('youtube.com') ||
        tab.url.includes('spotify.com') ||
        tab.url.includes('soundcloud.com')
      )) {
        chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
      }
    }
  });
}

// Content Script'ten gelen güncellemeleri PC Core'a ilet
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;

  if (message.type === 'BROWSER_UPDATE' || message.type === 'LYRICS_UPDATE') {
    // 1. WebSocket açıksa doğrudan ve anında WS üzerinden gönder (0 gecikme)
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({
          action: message.type === 'LYRICS_UPDATE' ? 'lyrics-update' : 'browser-update',
          data: message.data
        }));
        sendResponse({ success: true, via: 'ws' });
        return true;
      } catch (_) {}
    }

    // 2. WebSocket kapalıysa HTTP POST ile ilet
    const endpoint = message.type === 'LYRICS_UPDATE' ? '/api/lyrics/update' : '/api/browser-update';
    fetch(`http://127.0.0.1:${CORE_PORT}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message.data)
    })
      .then(res => res.json())
      .then(data => sendResponse({ success: true, via: 'http', data }))
      .catch(e => sendResponse({ success: false, error: e.message }));

    return true; // Asenkron yanıt
  }
});
