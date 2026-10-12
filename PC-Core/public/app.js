let ws = null;
let isUserInteractingWithVolume = false;
let volTimeout = null;
let progressTimer = null;
let lastPingTime = 0;

let currentTrack = {
  title: 'Müzik Bekleniyor...',
  artist: 'YouTube Music',
  currentTime: 0,
  duration: 0,
  isPlaying: false,
  volume: 50,
  videoId: '',
  artwork: '',
  queue: [],
  sourceApp: 'YouTube Music',
  sessions: [],
  activeSessionIndex: 0,
  totalSessions: 1,
  pinnedSource: 'auto'
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

  if (viewId === 'network-view') {
    fetchNetworkStatus();
  }
}

// Bildirim Göster (Toast)
function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.innerText = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2800);
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
    setTimeout(connectWebSocket, 2000);
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

// Akıcı İlerleme Çubuğu Zamanlayıcısı (Süre Çubuğunun Donmasını Kesin Olarak Önler)
function startProgressTimer() {
  if (progressTimer) clearInterval(progressTimer);
  progressTimer = setInterval(() => {
    if (currentTrack.isPlaying && currentTrack.duration > 0) {
      if (currentTrack.currentTime < currentTrack.duration) {
        currentTrack.currentTime += 1;
        updateProgressDisplay();
      }
    }
  }, 1000);
}

function updateProgressDisplay() {
  document.getElementById('curr-time').innerText = formatTime(currentTrack.currentTime);
  document.getElementById('total-time').innerText = formatTime(currentTrack.duration);

  if (currentTrack.duration > 0) {
    const percent = (currentTrack.currentTime / currentTrack.duration) * 100;
    document.getElementById('progress-fill').style.width = `${Math.min(100, Math.max(0, percent))}%`;
  } else {
    document.getElementById('progress-fill').style.width = '0%';
  }
}

// Arayüzü Güncelle
function updateUI(data) {
  if (!data) return;
  const isPlayingChanged = currentTrack.isPlaying !== data.isPlaying;
  currentTrack = { ...currentTrack, ...data };

  document.getElementById('track-title').innerText = currentTrack.title || 'Müzik Bekleniyor...';
  document.getElementById('track-artist').innerText = currentTrack.artist || 'YouTube Music';

  // Albüm Kapağı (Yüksek Kaliteli veya Standart)
  if (currentTrack.artwork) {
    const artImg = document.getElementById('track-art');
    if (artImg.src !== currentTrack.artwork) {
      artImg.src = currentTrack.artwork;
    }
  }

  // Oynat/Duraklat Simgesi
  const playIcon = document.getElementById('play-icon');
  if (currentTrack.isPlaying) {
    playIcon.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
  } else {
    playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
  }

  // Süreleri ve çubuğu güncelle
  updateProgressDisplay();

  // Oynatma durumu değiştiyse yerel zamanlayıcıyı garantiye al
  if (isPlayingChanged || !progressTimer) {
    startProgressTimer();
  }

  // Ses Seviyesi
  const volVal = (typeof currentTrack.volume === 'number') ? currentTrack.volume : 50;
  if (!isUserInteractingWithVolume) {
    document.getElementById('vol-slider').value = volVal;
    document.getElementById('vol-label').innerText = `${volVal}%`;
  }

  // Kuyruk Listesi
  renderQueue(currentTrack.queue);

  // Windows Medya Oturumu & Kaynak Seçici Arayüzü
  updateSessionUI();

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
  if (!seconds || isNaN(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// Komut Gönder
function sendCmd(action, data = null) {
  // Oynat/Duraklat basıldığında arayüzde anında tepki ver
  if (action === 'playPause') {
    currentTrack.isPlaying = !currentTrack.isPlaying;
    const playIcon = document.getElementById('play-icon');
    if (currentTrack.isPlaying) {
      playIcon.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
    } else {
      playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
    }
  }

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

// İlerleme Çubuğu Tıklaması
function handleSeek(event) {
  const container = event.currentTarget;
  const rect = container.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const ratio = Math.max(0, Math.min(1, clickX / rect.width));

  if (currentTrack.duration > 0) {
    const targetSec = Math.floor(ratio * currentTrack.duration);
    currentTrack.currentTime = targetSec;
    updateProgressDisplay();
    sendCmd('seekTo', targetSec);
  }
}

// Ses Değişimi
function handleVolume(val) {
  isUserInteractingWithVolume = true;
  document.getElementById('vol-label').innerText = `${val}%`;
  sendCmd('setVolume', Number(val));
  clearTimeout(volTimeout);
  volTimeout = setTimeout(() => {
    isUserInteractingWithVolume = false;
  }, 1000);
}

// Kuyruk Render
function renderQueue(queueItems) {
  const container = document.getElementById('queue-list');
  const countEl = document.getElementById('queue-count');
  const badgeEl = document.getElementById('queue-type-badge');

  if (!queueItems || queueItems.length === 0) {
    container.innerHTML = '<p class="empty-state">Kuyrukta şarkı yok veya oynatıcı kapalı.</p>';
    countEl.innerText = '0 Parça';
    if (badgeEl) badgeEl.innerText = 'Boş';
    return;
  }

  const isRec = queueItems[0]?.isRecommendation;
  if (badgeEl) {
    badgeEl.innerText = isRec ? '💡 Önerilenler' : '🎵 Oynatma Kuyruğu';
    badgeEl.style.background = isRec ? 'rgba(245, 158, 11, 0.15)' : 'rgba(99, 102, 241, 0.2)';
    badgeEl.style.color = isRec ? '#f59e0b' : '#818cf8';
  }

  countEl.innerText = `${queueItems.length} Parça`;
  container.innerHTML = queueItems.map((item, idx) => `
    <div class="queue-item" onclick="sendCmd('seekToQueueIndex', ${idx})">
      <div>
        <div class="queue-item-title">${escapeHtml(item.title || 'İsimsiz')}</div>
        <div class="queue-item-sub">${escapeHtml(item.artist || 'Bilinmiyor')}</div>
      </div>
      <span class="queue-item-sub">${item.duration ? (typeof item.duration === 'number' ? formatTime(item.duration) : item.duration) : ''}</span>
    </div>
  `).join('');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.innerText = text;
  return div.innerHTML;
}

// NewPipe'ta Kaldığı Yerden Devam Et (Tam Şarkı Parametreleriyle)
function triggerNewPipeResume() {
  const videoId = currentTrack.videoId || '';
  const seconds = Math.floor(currentTrack.currentTime) || 0;
  const title = currentTrack.title || '';
  const artist = currentTrack.artist || '';

  if (window.ErenBridge) {
    // Android Shell içindeyse yerel Intent ile doğrudan NewPipe'ta aç
    window.ErenBridge.openNewPipe(videoId, seconds, title, artist);
  } else {
    // Tarayıcıdaysa YouTube direkt bağlantısı aç
    const url = videoId 
      ? `https://www.youtube.com/watch?v=${videoId}&t=${seconds}s` 
      : `https://www.youtube.com/results?search_query=${encodeURIComponent(title + ' ' + artist)}`;
    window.open(url, '_blank');
  }
}

// Ağ & Sistem Durumu Çek
async function fetchNetworkStatus() {
  const startTime = Date.now();
  try {
    const res = await fetch('/api/status');
    const latency = Date.now() - startTime;
    const data = await res.json();

    const pingBadge = document.getElementById('ping-badge');
    if (pingBadge) pingBadge.innerText = `${latency} ms`;

    // Sunucu ve Tailscale IP alanlarını güncelle
    const netHostEl = document.getElementById('net-host');
    const netTailscaleEl = document.getElementById('net-tailscale');
    const customInput = document.getElementById('custom-ip-input');

    if (data.network) {
      const lanIp = data.network.lan[0] ? `${data.network.lan[0]}:8765` : window.location.host;
      const tailscaleIp = data.network.tailscale[0] ? `${data.network.tailscale[0]}:8765` : null;

      if (netHostEl) netHostEl.innerText = lanIp;
      if (netTailscaleEl) {
        netTailscaleEl.innerText = tailscaleIp ? `${tailscaleIp} (Aktif)` : 'Algılanmadı';
      }

      if (customInput && !customInput.value) {
        customInput.value = window.location.host;
      }

      renderQuickIps(data.network.lan, data.network.tailscale);
    }

    // Windows Başlangıç Durumu
    const startupToggle = document.getElementById('startup-toggle');
    if (startupToggle && typeof data.startup === 'boolean') {
      startupToggle.checked = data.startup;
    }
  } catch (e) {
    const pingBadge = document.getElementById('ping-badge');
    if (pingBadge) pingBadge.innerText = 'Koptu';
  }
}

// Hızlı IP Seçim Butonlarını Oluştur
function renderQuickIps(lanList, tailscaleList) {
  const container = document.getElementById('quick-ips-container');
  if (!container) return;

  const currentHost = window.location.host;
  let html = '';

  if (lanList && lanList.length > 0) {
    lanList.forEach(ip => {
      const fullUrl = `${ip}:8765`;
      const isCurrent = currentHost === fullUrl;
      html += `
        <div class="ip-pill-btn ${isCurrent ? 'active' : ''}" onclick="switchToServer('${fullUrl}')">
          <div>
            <span class="ip-pill-label">🏠 Ev Wi-Fi (Yerel Ağ)</span>
            <div class="ip-pill-val">${fullUrl}</div>
          </div>
          <span style="font-size: 0.75rem; font-weight: 700; color: ${isCurrent ? '#10b981' : '#6366f1'};">
            ${isCurrent ? 'Aktif' : 'Geçiş Yap ➔'}
          </span>
        </div>
      `;
    });
  }

  if (tailscaleList && tailscaleList.length > 0) {
    tailscaleList.forEach(ip => {
      const fullUrl = `${ip}:8765`;
      const isCurrent = currentHost === fullUrl;
      html += `
        <div class="ip-pill-btn ${isCurrent ? 'active' : ''}" onclick="switchToServer('${fullUrl}')">
          <div>
            <span class="ip-pill-label">🌐 Tailscale (Her Yerden)</span>
            <div class="ip-pill-val">${fullUrl}</div>
          </div>
          <span style="font-size: 0.75rem; font-weight: 700; color: ${isCurrent ? '#10b981' : '#6366f1'};">
            ${isCurrent ? 'Aktif' : 'Geçiş Yap ➔'}
          </span>
        </div>
      `;
    });
  } else {
    html += `
      <div style="font-size: 0.75rem; color: var(--text-muted); padding: 6px 0;">
        ⚠️ PC'de aktif Tailscale IP'si bulunamadı. Tailscale'i açtığınızda burada otomatik görünecektir.
      </div>
    `;
  }

  container.innerHTML = html;
}

// Sunucu Adresini Değiştir / Yönlendir
function switchToServer(targetHost) {
  const cleanTarget = targetHost.replace(/^https?:\/\//, '').trim();

  if (window.ErenBridge) {
    // Android Shell içinde doğrudan WebView ve Service IP'sini güncelle
    try {
      window.ErenBridge.updateServerUrl(cleanTarget);
      showToast(`Bağlantı güncellendi: ${cleanTarget}`);
    } catch (e) {
      window.location.href = `http://${cleanTarget}`;
    }
  } else {
    window.location.href = `http://${cleanTarget}`;
  }
}

// Özel Girilen IP'yi Test Et ve Uygula
async function applyCustomServerIp() {
  const input = document.getElementById('custom-ip-input');
  const feedback = document.getElementById('ip-test-feedback');
  if (!input) return;

  let val = input.value.trim().replace(/^https?:\/\//, '');
  if (!val) {
    feedback.className = 'feedback-text error';
    feedback.innerText = 'Lütfen geçerli bir IP veya adres girin.';
    return;
  }

  if (!val.includes(':')) {
    val = `${val}:8765`;
  }

  feedback.className = 'feedback-text';
  feedback.innerText = 'Sunucu test ediliyor...';

  try {
    const res = await fetch(`http://${val}/api/status`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      feedback.className = 'feedback-text success';
      feedback.innerText = '✅ Başarılı! Bağlanılıyor...';
      setTimeout(() => {
        switchToServer(val);
      }, 500);
    } else {
      feedback.className = 'feedback-text error';
      feedback.innerText = 'Sunucu yanıt verdi ancak durum okunamadı.';
    }
  } catch (err) {
    feedback.className = 'feedback-text error';
    feedback.innerText = '❌ Sunucuya ulaşılamadı. IP adresinin doğru ve PC\'nin açık olduğundan emin olun.';
  }
}

// Windows Başlangıçta Çalıştırma Ayarını Değiştir
async function toggleStartup(enable) {
  try {
    const res = await fetch('/api/system/startup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enable })
    });
    const data = await res.json();
    if (data.success) {
      showToast(enable ? '🚀 Windows Başlangıcına Eklendi!' : 'Başlangıçtan kaldırıldı.');
    }
  } catch (e) {
    showToast('Ayar kaydedilemedi.');
  }
}

// -------------------------------------------------------------
// WINDOWS MEDYA OTURUM YÖNETİMİ VE KAYNAK SABİTLEME
// -------------------------------------------------------------
function getSourceIcon(app) {
  if (!app) return '🎵';
  const lower = app.toLowerCase();
  if (lower.includes('youtube music')) return '🎵';
  if (lower.includes('youtube')) return '▶️';
  if (lower.includes('spotify')) return '🎧';
  if (lower.includes('tarayıcı') || lower.includes('chrome') || lower.includes('edge') || lower.includes('brave') || lower.includes('browser')) return '🌐';
  return '📻';
}

function updateSessionUI() {
  const iconEl = document.getElementById('session-icon');
  const nameEl = document.getElementById('session-name');
  const counterEl = document.getElementById('session-counter');
  const pinBadgeEl = document.getElementById('session-pin-badge');
  const prevBtn = document.getElementById('prev-session-btn');
  const nextBtn = document.getElementById('next-session-btn');

  const sourceApp = currentTrack.sourceApp || 'Medya Oynatıcı';
  if (iconEl) iconEl.innerText = getSourceIcon(sourceApp);
  if (nameEl) nameEl.innerText = sourceApp;

  const total = Math.max(1, currentTrack.totalSessions || (currentTrack.sessions ? currentTrack.sessions.length : 1));
  const activeIdx = Math.min(total - 1, Math.max(0, currentTrack.activeSessionIndex || 0));
  if (counterEl) counterEl.innerText = `(${activeIdx + 1}/${total})`;

  // Sabitleme rozeti
  const isPinned = currentTrack.pinnedSource === 'youtube_music' || currentTrack.pinnedSource === 'manual';
  if (pinBadgeEl) {
    if (isPinned) {
      pinBadgeEl.classList.add('show');
      pinBadgeEl.title = currentTrack.pinnedSource === 'youtube_music' ? 'Sabitlendi: YouTube Music' : 'Sabitlendi: Özel Oturum';
    } else {
      pinBadgeEl.classList.remove('show');
    }
  }

  // Ok tuşları opaklığı
  if (prevBtn) prevBtn.style.opacity = (total > 1) ? '1' : '0.35';
  if (nextBtn) nextBtn.style.opacity = (total > 1) ? '1' : '0.35';

  // Açılır menü aktiflik sınıfları
  const optAuto = document.getElementById('opt-pin-auto');
  const optYt = document.getElementById('opt-pin-ytmusic');
  if (optAuto) {
    if (currentTrack.pinnedSource === 'auto') optAuto.classList.add('active');
    else optAuto.classList.remove('active');
  }
  if (optYt) {
    if (currentTrack.pinnedSource === 'youtube_music') optYt.classList.add('active');
    else optYt.classList.remove('active');
  }

  // Oturum listesini oluştur
  renderSessionsList();
}

function renderSessionsList() {
  const listEl = document.getElementById('dropdown-sessions-list');
  if (!listEl) return;

  const sessions = currentTrack.sessions || [];
  if (sessions.length === 0) {
    listEl.innerHTML = '<div style="font-size:0.75rem; color:var(--text-muted); text-align:center; padding:8px 4px;">Aktif medya oturumu bulunamadı</div>';
    return;
  }

  let html = '';
  sessions.forEach((s, idx) => {
    const isCur = (s.id === currentTrack.activeSessionIndex) || (idx === currentTrack.activeSessionIndex);
    const sIcon = getSourceIcon(s.app);
    const badgeText = s.isPlaying ? 'Oynatılıyor' : 'Duraklatıldı';
    const badgeClass = s.isPlaying ? 'session-item-badge' : 'session-item-badge paused';
    const activeClass = isCur ? 'dropdown-item active' : 'dropdown-item';

    html += `
      <button class="${activeClass}" onclick="selectSession(${s.id})">
        <span class="item-icon">${sIcon}</span>
        <div class="item-text">
          <span class="item-title">${escapeHtml(s.title || 'Bilinmiyor')}</span>
          <span class="item-sub">${escapeHtml(s.artist || s.app)}</span>
        </div>
        <span class="${badgeClass}">${badgeText}</span>
        <span class="item-check">✓</span>
      </button>
    `;
  });
  listEl.innerHTML = html;
}

function toggleSessionMenu(force) {
  const dropdown = document.getElementById('session-dropdown');
  const pillBtn = document.getElementById('session-pill-btn');
  if (!dropdown) return;

  const shouldShow = (typeof force === 'boolean') ? force : !dropdown.classList.contains('show');
  if (shouldShow) {
    dropdown.classList.add('show');
    if (pillBtn) pillBtn.classList.add('open');
    renderSessionsList();
  } else {
    dropdown.classList.remove('show');
    if (pillBtn) pillBtn.classList.remove('open');
  }
}

function selectPinMode(mode) {
  sendCmd('pinSource', mode);
  toggleSessionMenu(false);
  if (mode === 'youtube_music') {
    showToast('📌 YouTube Music sabitlendi!');
  } else {
    showToast('⚡ Otomatik mod aktif');
  }
}

function selectSession(id) {
  sendCmd('selectSession', id);
  toggleSessionMenu(false);
  showToast('🎯 Medya oturumu seçildi');
}

// Menü dışına tıklandığında açılır menüyü kapat
document.addEventListener('click', (e) => {
  const container = document.querySelector('.session-selector-container');
  if (container && !container.contains(e.target)) {
    toggleSessionMenu(false);
  }
});

// Başlat
window.addEventListener('DOMContentLoaded', () => {
  connectWebSocket();
  startProgressTimer();
});
