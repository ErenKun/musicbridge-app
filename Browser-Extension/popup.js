// MusicBridge Browser Extension - Popup Script
const CORE_URL = 'http://localhost:8765';

async function updateStatus() {
  try {
    const res = await fetch(`${CORE_URL}/api/status`);
    if (res.ok) {
      const data = await res.json();
      const media = data.media;
      if (media) {
        document.getElementById('track-title').innerText = media.title || 'Müzik Bekleniyor...';
        document.getElementById('track-artist').innerText = media.artist || 'Hazır';
      }
      document.getElementById('status-badge').innerText = 'Bağlı';
      document.getElementById('status-badge').style.color = '#10b981';
    }
  } catch (e) {
    document.getElementById('status-badge').innerText = 'PC Kapalı';
    document.getElementById('status-badge').style.color = '#f87171';
  }
}

function sendCmd(action) {
  fetch(`${CORE_URL}/api/control`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action })
  }).catch(() => {});
}

document.getElementById('btn-prev').addEventListener('click', () => sendCmd('previous'));
document.getElementById('btn-play').addEventListener('click', () => sendCmd('playPause'));
document.getElementById('btn-next').addEventListener('click', () => sendCmd('next'));

updateStatus();
setInterval(updateStatus, 2000);
