// MusicBridge Browser Extension - Background Service Worker
chrome.runtime.onInstalled.addListener(() => {
  console.log('🎵 MusicBridge Web Controller Eklentisi Yüklendi!');
});

// Content Script'ten gelen güncellemeleri arka plan yetkisiyle PC-Core'a ilet
// Background Service Worker web sayfasının CSP ve Mixed-Content kısıtlamalarına tabi DEĞİLDİR.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'BROWSER_UPDATE') {
    fetch('http://127.0.0.1:8765/api/browser-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message.data)
    })
      .then(res => res.json())
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Asenkron yanıt için true dönülmeli
  }
});
