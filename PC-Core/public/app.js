let ws = null;
let currentTrack = {
  title: 'Müzik Bekleniyor...',
  artist: 'YouTube Music',
  currentTime: 0,
  duration: 0,
  isPlaying: false,
  volume: 75,
  videoId: ''
};

// Sayfa geçişleri
function switchView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

  const targetView = document.getElementById(viewId);
  if (targetView) targetView.classList.add('active');

  const tabIndex = viewId === 'player-view' ? 0 : viewId === 'queue-view' ? 1 : 2;
  const tabs = document.querySelectorAll('.tab-btn');
  if (tabs[tabIndex]) tabs[tabIndex].classList.add('active');
}

// WebSocket Bağlantısı
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    updateConnBadge(true);
    fetchNetworkStatus();
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'sync' || msg.type === 'track-change') {
        updateUI(msg.data);
      }
    } catch (err) {
      console.error('Mesaj işleme hatası:', err);
    }
  };

  ws.onclose = () => {
    updateConnBadge(false);
    setTimeout(connectWebSocket, 2000); // Otomatik yeniden bağlan
  };

  ws.onerror = () => {
    updateConnBadge(false);
  };
}

// Durum Rozetini Güncelle
function updateConnBadge(isOnline) {
  const badge = document.getElementById('conn-badge');
  const indicator = badge.querySelector('.status-indicator');
  const text = document.getElementById('conn-text');

  if (isOnline) {
    indicator.className = 'status-indicator online';
    text.innerText = 'Bağlandı';
  } else {
    indicator.className = 'status-indicator';
    text.innerText = 'Koptu';
  }
}

// Arayüzü Güncelle
function updateUI(data) {
  if (!data) return;
  currentTrack = { ...currentTrack, ...data };

  document.getElementById('track-title').innerText = currentTrack.title || 'Bilinmiyor';
  document.getElementById('track-artist').innerText = currentTrack.artist || 'YouTube Music';

  // Albüm Kapağı
  if (currentTrack.artwork) {
    document.getElementById('track-art').src = currentTrack.artwork;
  }

  // Oynat/Duraklat Simgesi
  const playIcon = document.getElementById('play-icon');
  if (currentTrack.isPlaying) {
    playIcon.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
  } else {
    playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
  }

  // Süreler
  document.getElementById('curr-time').innerText = formatTime(currentTrack.currentTime);
  document.getElementById('total-time').innerText = formatTime(currentTrack.duration);

  // İlerleme Çubuğu
  if (currentTrack.duration > 0) {
    const percent = (currentTrack.currentTime / currentTrack.duration) * 100;
    document.getElementById('progress-fill').style.width = `${Math.min(100, percent)}%`;
  }

  // Ses
  document.getElementById('vol-slider').value = currentTrack.volume || 75;
  document.getElementById('vol-label').innerText = `${currentTrack.volume || 75}%`;

  // Kuyruk Listesi
  renderQueue(currentTrack.queue);

  // ANDROID MICRO-SHELL (HUAWEI SAAT) SENKRONİZASYONU
  if (window.ErenBridge) {
    try {
      window.ErenBridge.syncTrack(
        currentTrack.title,
        currentTrack.artist,
        Math.floor(currentTrack.duration * 1000),
        currentTrack.isPlaying
      );
    } catch (e) {
      console.warn('ErenBridge senkron hatası:', e);
    }
  }
}

// Süre Biçimlendirme (mm:ss)
function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// Komut Gönder
function sendCmd(action, data = null) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action, data }));
  } else {
    fetch('/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, data })
    }).catch(() => {});
  }
}

// İlerleme Tıklaması
function handleSeek(event) {
  const container = event.currentTarget;
  const rect = container.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const ratio = Math.max(0, Math.min(1, clickX / rect.width));

  if (currentTrack.duration > 0) {
    const targetSec = Math.floor(ratio * currentTrack.duration);
    sendCmd('seekTo', targetSec);
  }
}

// Ses Değişimi
function handleVolume(val) {
  document.getElementById('vol-label').innerText = `${val}%`;
  sendCmd('setVolume', Number(val));
}

// Kuyruk Render
function renderQueue(queueItems) {
  const container = document.getElementById('queue-list');
  const countEl = document.getElementById('queue-count');

  if (!queueItems || queueItems.length === 0) {
    container.innerHTML = '<p class="empty-state">Kuyrukta şarkı yok.</p>';
    countEl.innerText = '0 Parça';
    return;
  }

  countEl.innerText = `${queueItems.length} Parça`;
  container.innerHTML = queueItems.map((item, idx) => `
    <div class="queue-item" onclick="sendCmd('seekToQueueIndex', ${idx})">
      <div>
        <div class="queue-item-title">${item.title || 'İsimsiz'}</div>
        <div class="queue-item-sub">${item.artist || 'Bilinmiyor'}</div>
      </div>
      <span class="queue-item-sub">${item.duration || ''}</span>
    </div>
  `).join('');
}

// NewPipe'ta Kaldığı Yerden Devam Et
function triggerNewPipeResume() {
  const videoId = currentTrack.videoId;
  const seconds = Math.floor(currentTrack.currentTime);

  if (window.ErenBridge) {
    // Android Shell içindeyse doğrudan yerel Intent ile aç
    window.ErenBridge.openNewPipe(videoId, seconds);
  } else {
    // Tarayıcıdaysa YouTube linkini aç
    const url = videoId 
      ? `https://www.youtube.com/watch?v=${videoId}&t=${seconds}s` 
      : 'https://music.youtube.com';
    window.open(url, '_blank');
  }
}

// Ağ Durumu Çek
async function fetchNetworkStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.network) {
      document.getElementById('net-host').innerText = data.network.lan[0] 
        ? `${data.network.lan[0]}:8765` 
        : 'Yerel Sunucu';
      document.getElementById('net-tailscale').innerText = data.network.tailscale[0] 
        ? `${data.network.tailscale[0]}:8765 (Aktif)` 
        : 'Bağlı Değil';
    }
  } catch (e) {}
}

// Başlat
window.addEventListener('DOMContentLoaded', () => {
  connectWebSocket();
});
