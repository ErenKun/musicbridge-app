let ws = null;
let isUserInteractingWithVolume = false;
let volTimeout = null;
let progressTimer = null;
let lastPingTime = 0;
let lastServerSyncSec = 0;
let lastSyncTimestamp = performance.now();
let isSeeking = false;
let seekTimeout = null;
let authToken = localStorage.getItem('mb_auth_token') || '';
let isAuthModalOpen = false;
let pendingNextTrackIndex = null;

const DEFAULT_ARTWORK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 24 24'%3E%3Cpath fill='%236366f1' d='M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z'/%3E%3C/svg%3E";

function sanitizeTurkish(str) {
  if (!str || typeof str !== 'string') return str;
  return str
    .replace(/MÃ¼zik/g, 'Müzik')
    .replace(/mÃ¼zik/g, 'müzik')
    .replace(/BoÅŸta/g, 'Boşta')
    .replace(/boÅŸta/g, 'boşta')
    .replace(/OynatÄ±cÄ±/g, 'Oynatıcı')
    .replace(/TarayÄ±cÄ±/g, 'Tarayıcı');
}

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

  const tabIndex = viewId === 'player-view' ? 0 : viewId === 'queue-view' ? 1 : viewId === 'lyrics-view' ? 2 : 3;
  const tabs = document.querySelectorAll('.tab-btn');
  if (tabs[tabIndex]) tabs[tabIndex].classList.add('active');

  if (viewId === 'network-view') {
    fetchNetworkStatus();
  } else if (viewId === 'lyrics-view') {
    fetchCurrentLyrics();
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

// -------------------------------------------------------------
// GÜVENLİK PIN DOĞRULAMA (SIFIR-GÜVEN KORUMASI)
// -------------------------------------------------------------
function showPinModal(errorText = '') {
  const modal = document.getElementById('pin-modal');
  const errorEl = document.getElementById('pin-error-msg');
  const input = document.getElementById('pin-input');
  if (modal) {
    modal.classList.add('show');
    isAuthModalOpen = true;
    if (errorEl) errorEl.innerText = errorText;
    if (input) {
      input.value = '';
      setTimeout(() => input.focus(), 250);
    }
  }
}

function hidePinModal() {
  const modal = document.getElementById('pin-modal');
  if (modal) {
    modal.classList.remove('show');
    isAuthModalOpen = false;
  }
}

async function submitPinAuth() {
  const input = document.getElementById('pin-input');
  const rememberCheck = document.getElementById('pin-remember-check');
  const errorEl = document.getElementById('pin-error-msg');
  if (!input) return;

  const pinVal = input.value.trim();
  if (!pinVal) {
    if (errorEl) errorEl.innerText = 'Lütfen 4 haneli PIN kodunu girin.';
    return;
  }

  if (errorEl) errorEl.innerText = 'Doğrulanıyor...';

  try {
    const res = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pinVal, remember: rememberCheck ? rememberCheck.checked : true })
    });
    const data = await res.json();
    if (data.success && data.token) {
      authToken = data.token;
      if (!rememberCheck || rememberCheck.checked) {
        localStorage.setItem('mb_auth_token', authToken);
      }
      if (window.ErenBridge && typeof window.ErenBridge.saveAuthToken === 'function') {
        try { window.ErenBridge.saveAuthToken(authToken); } catch(_) {}
      }
      hidePinModal();
      showToast('✅ Doğrulama Başarılı! Cihaz eşleştirildi.');
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'auth', token: authToken }));
      }
      fetchCurrentState();
    } else {
      if (errorEl) errorEl.innerText = data.error || 'Hatalı PIN kodu!';
    }
  } catch (err) {
    if (errorEl) errorEl.innerText = 'Bağlantı hatası: ' + err.message;
  }
}

// -------------------------------------------------------------
// AKILLI ARKA PLAN / ÖN PLAN BAĞLANTI & SENKRONİZASYON MOTORU
// -------------------------------------------------------------
let reconnectTimer = null;
let lastWsMessageTime = performance.now();
let isSyncing = false;
let syncRetryTimeout = null;

// REST API üzerinden anında son medya durumunu al (0 gecikme)
async function fetchCurrentState(isRetry = false) {
  if (isSyncing) return;
  isSyncing = true;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    const headers = { 'Cache-Control': 'no-store' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

    const res = await fetch('/api/status', {
      cache: 'no-store',
      headers,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (res.ok) {
      const json = await res.json();
      if (json.requiresPin && !isAuthModalOpen) {
        showPinModal();
      } else if (json.isAuthorized) {
        hidePinModal();
      }

      if (json.pin) {
        const pinEl = document.getElementById('net-pin');
        if (pinEl) pinEl.innerText = json.pin;
        const pinDisplayEl = document.getElementById('net-pin-display');
        if (pinDisplayEl) pinDisplayEl.innerText = json.pin;
      }

      if (json.media) {
        updateUI(json.media);
      }
      if (syncRetryTimeout) {
        clearTimeout(syncRetryTimeout);
        syncRetryTimeout = null;
      }
    } else if (!isRetry && document.visibilityState === 'visible') {
      scheduleSyncRetry();
    }
  } catch (err) {
    if (!isRetry && document.visibilityState === 'visible') {
      scheduleSyncRetry();
    }
  } finally {
    isSyncing = false;
  }
}

function scheduleSyncRetry() {
  if (syncRetryTimeout) clearTimeout(syncRetryTimeout);
  syncRetryTimeout = setTimeout(() => {
    syncRetryTimeout = null;
    fetchCurrentState(true);
  }, 1200);
}

function ensureWebSocketConnected() {
  if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
    connectWebSocket();
  } else if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({ action: 'sync' }));
    } catch (e) {
      connectWebSocket(true);
    }
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWebSocket();
  }, 2000);
}

// WebSocket Bağlantısı
function connectWebSocket(forceNew = false) {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (!forceNew && ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  if (ws) {
    try {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
    } catch (_) {}
    ws = null;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  try {
    ws = new WebSocket(wsUrl);
  } catch (err) {
    updateConnBadge(false);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    lastWsMessageTime = performance.now();
    updateConnBadge(true);
    fetchNetworkStatus();
    try {
      if (authToken) {
        ws.send(JSON.stringify({ action: 'auth', token: authToken }));
      }
      ws.send(JSON.stringify({ action: 'sync' }));
    } catch (_) {}
  };

  ws.onmessage = (event) => {
    lastWsMessageTime = performance.now();
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'auth-required') {
        showPinModal('PIN doğrulaması gerekli.');
        return;
      }
      if (msg.type === 'auth-success') {
        hidePinModal();
        return;
      }
      if (msg.type === 'lyrics-change' && msg.data) {
        renderLyrics(msg.data);
        return;
      }
      if (msg.type === 'pin-updated' && msg.pin) {
        const pinEl = document.getElementById('net-pin');
        if (pinEl) pinEl.innerText = msg.pin;
        const pinDisplayEl = document.getElementById('net-pin-display');
        if (pinDisplayEl) pinDisplayEl.innerText = msg.pin;
        showToast(`🔑 Güvenlik PIN Güncellendi: ${msg.pin}`);
        return;
      }
      if (msg.type === 'sync' || msg.type === 'track-change') {
        updateUI(msg.data);
      }
    } catch (err) {
      console.error('Mesaj işleme hatası:', err);
    }
  };

  ws.onclose = () => {
    updateConnBadge(false);
    scheduleReconnect();
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

// Akıcı ve Kesintisiz İlerleme Çubuğu Motoru (Geri Sıçrama ve Donmaları Tamamen Önler)
function startProgressTimer() {
  if (progressTimer) clearInterval(progressTimer);
  progressTimer = setInterval(() => {
    if (currentTrack.isPlaying && currentTrack.duration > 0 && !isSeeking) {
      const now = performance.now();
      const elapsed = (now - lastSyncTimestamp) / 1000;
      const smoothTime = Math.min(currentTrack.duration, lastServerSyncSec + elapsed);
      currentTrack.currentTime = smoothTime;
      updateProgressDisplay();
    }
  }, 250);
}

function updateProgressDisplay() {
  const displaySec = Math.floor(currentTrack.currentTime || 0);
  document.getElementById('curr-time').innerText = formatTime(displaySec);
  document.getElementById('total-time').innerText = formatTime(currentTrack.duration);

  if (currentTrack.duration > 0) {
    const percent = (currentTrack.currentTime / currentTrack.duration) * 100;
    document.getElementById('progress-fill').style.width = `${Math.min(100, Math.max(0, percent))}%`;
  } else {
    document.getElementById('progress-fill').style.width = '0%';
  }

  // Senkronize şarkı sözü satırını güncelle
  updateActiveLyricLine();
}

// Arayüzü Güncelle
function updateUI(data) {
  if (!data) return;
  const isPlayingChanged = currentTrack.isPlaying !== data.isPlaying;
  const trackChanged = (currentTrack.title !== data.title) || (currentTrack.artist !== data.artist);

  if (trackChanged) {
    // Parça değiştiğinde şarkı sözlerini arka planda tazele
    fetchCurrentLyrics();
  }

  // Gelen sunucu süresini akıllıca filtrele (Geri sıçrama ve jitter koruması)
  const incomingSec = (typeof data.currentTime === 'number') ? data.currentTime : 0;
  
  if (trackChanged) {
    // Parça değiştiyse süreyi sıfırla veya gelen değere anında kitle
    currentTrack.currentTime = incomingSec;
    lastServerSyncSec = incomingSec;
    lastSyncTimestamp = performance.now();
  } else if (!isSeeking) {
    const currentEstimated = lastServerSyncSec + ((performance.now() - lastSyncTimestamp) / 1000);
    const diff = incomingSec - currentEstimated;

    // Eğer fark 4 saniyeden fazlaysa kullanıcı gerçekten ileri/geri sarmıştır (Seek)
    if (Math.abs(diff) >= 4) {
      currentTrack.currentTime = incomingSec;
      lastServerSyncSec = incomingSec;
      lastSyncTimestamp = performance.now();
    } else if (diff < -0.5 && diff > -4 && currentTrack.isPlaying) {
      // Sunucu 1-3 saniye geride bir veri gönderdiyse (Chrome arka plan gecikmesi),
      // Akıcı süreyi asla geriye fırlatma! Mevcut akışı koru.
    } else if (Math.abs(diff) > 0.8) {
      // Küçük fark varsa hafifçe hizala
      lastServerSyncSec = incomingSec;
      lastSyncTimestamp = performance.now();
      currentTrack.currentTime = incomingSec;
    }
  }

  // data'nın diğer alanlarını kopyala (currentTime'ı yukarıda akıllıca koruduk)
  const { currentTime: _, ...restData } = data;
  currentTrack = { ...currentTrack, ...restData };

  currentTrack.title = sanitizeTurkish(currentTrack.title);
  currentTrack.artist = sanitizeTurkish(currentTrack.artist);
  currentTrack.sourceApp = sanitizeTurkish(currentTrack.sourceApp);

  const isWaitingTrack = !currentTrack.title || currentTrack.title.includes('Bekleniyor') || currentTrack.sourceApp === 'Boşta';
  if (isWaitingTrack) {
    currentTrack.artwork = '';
    currentTrack.videoId = '';
  }

  // Şarkı başlığı ve sanatçı (Akıllı Kayan Yazı)
  const titleEl = document.getElementById('track-title');
  const artistEl = document.getElementById('track-artist');
  const newTitle = currentTrack.title || 'Müzik Bekleniyor...';
  const newArtist = currentTrack.artist || 'YouTube Music';

  if (titleEl && titleEl.innerText !== newTitle) {
    titleEl.innerText = newTitle;
    setupMarquee('title-marquee-container', titleEl);
  }
  if (artistEl && artistEl.innerText !== newArtist) {
    artistEl.innerText = newArtist;
    setupMarquee('artist-marquee-container', artistEl);
  }

  // Albüm Kapağı (Yüksek Kaliteli veya Temiz Placeholder)
  const artImg = document.getElementById('track-art');
  if (artImg) {
    const targetArt = (currentTrack.artwork && currentTrack.artwork.trim() && !isWaitingTrack)
      ? currentTrack.artwork
      : DEFAULT_ARTWORK;
    if (artImg.src !== targetArt) {
      artImg.src = targetArt;
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

  // ANDROID MICRO-SHELL (AKILLI SAAT) SENKRONİZASYONU
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

  const payload = { action, data, token: authToken };

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  } else {
    fetch('/api/control', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authToken ? `Bearer ${authToken}` : ''
      },
      body: JSON.stringify(payload)
    }).then(async res => {
      if (res.status === 401) {
        const d = await res.json().catch(() => ({}));
        if (d.needAuth) showPinModal('Bu işlemi yapmak için lütfen PIN kodunu doğrulayın.');
      }
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
    isSeeking = true;
    currentTrack.currentTime = targetSec;
    lastServerSyncSec = targetSec;
    lastSyncTimestamp = performance.now();
    updateProgressDisplay();
    sendCmd('seekTo', targetSec);

    clearTimeout(seekTimeout);
    seekTimeout = setTimeout(() => {
      isSeeking = false;
    }, 1000);
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

// -------------------------------------------------------------
// AKILLI KUYRUK & ŞARKI LİSTESİ YÖNETİMİ
// -------------------------------------------------------------
let rawQueueItems = [];
let queueFilterQuery = '';
let currentQueueActiveIndex = -1;

function filterQueue(query) {
  queueFilterQuery = (query || '').trim().toLowerCase();
  const clearBtn = document.getElementById('queue-search-clear');
  if (clearBtn) {
    clearBtn.style.display = queueFilterQuery ? 'inline-block' : 'none';
  }
  renderQueue(rawQueueItems);
}

function clearQueueSearch() {
  const input = document.getElementById('queue-search-input');
  if (input) input.value = '';
  filterQueue('');
}

// Akıllı Kuyruk Atlama & Sıradaki Parça Motoru
let isJumpingTrack = false;

// 1. Şarkının üstüne tıklandığında O ŞARKIYA HEMEN GEÇ
function jumpToQueueIndex(targetIdx) {
  if (isJumpingTrack) return;
  if (targetIdx === currentQueueActiveIndex) {
    showToast('▶ Bu parça zaten şu anda çalıyor.');
    return;
  }

  isJumpingTrack = true;
  setTimeout(() => { isJumpingTrack = false; }, 800);

  // Tarayıcı eklentisine doğrudan anında çalma komutu gönder
  sendCmd('seekToQueueIndex', targetIdx);
  showToast('▶ Parçaya geçiliyor...');
}

// 2. "Sıradaki Yap / Bundan Devam Et": Bu şarkı bittikten sonra bundan devam et
function setNextInQueue(targetIdx) {
  if (pendingNextTrackIndex === targetIdx) {
    // Tıklanırsa iptal et
    pendingNextTrackIndex = null;
    sendCmd('setNextTrackIndex', -1);
    renderQueue(rawQueueItems);
    showToast('Sıradaki parça seçimi kaldırıldı.');
    return;
  }

  pendingNextTrackIndex = targetIdx;
  sendCmd('setNextTrackIndex', targetIdx);
  renderQueue(rawQueueItems);
  showToast(`⏭️ Sıraya alındı: Mevcut parça bitince ${targetIdx + 1}. parçadan devam edecek.`);
}

// Kuyruk Render
function renderQueue(queueItems) {
  rawQueueItems = Array.isArray(queueItems) ? queueItems : [];
  const container = document.getElementById('queue-list');
  const countEl = document.getElementById('queue-count');
  const badgeEl = document.getElementById('queue-type-badge');

  if (!rawQueueItems || rawQueueItems.length === 0) {
    container.innerHTML = '<p class="empty-state">Kuyrukta şarkı yok veya oynatıcı kapalı.</p>';
    countEl.innerText = '0 Parça';
    if (badgeEl) badgeEl.innerText = 'Boş';
    currentQueueActiveIndex = -1;
    return;
  }

  const isRec = rawQueueItems[0]?.isRecommendation;
  if (badgeEl) {
    badgeEl.innerText = isRec ? '💡 Önerilenler' : '🎵 Oynatma Kuyruğu';
    badgeEl.style.background = isRec ? 'rgba(245, 158, 11, 0.15)' : 'rgba(99, 102, 241, 0.2)';
    badgeEl.style.color = isRec ? '#f59e0b' : '#818cf8';
  }

  // 1. Yinelenen parçaları temizle
  const deduplicated = [];
  for (let i = 0; i < rawQueueItems.length; i++) {
    const item = rawQueueItems[i];
    const prev = deduplicated[deduplicated.length - 1];
    if (prev && prev.title && item.title &&
        prev.title.trim().toLowerCase() === item.title.trim().toLowerCase() &&
        (prev.artist || '').trim().toLowerCase() === (item.artist || '').trim().toLowerCase()) {
      continue;
    }
    deduplicated.push({ ...item, originalIndex: i });
  }

  // 2. Şu an çalan şarkının kuyruktaki yerini tespit et
  const curTitle = (currentTrack.title || '').trim().toLowerCase();
  const curArtist = (currentTrack.artist || '').trim().toLowerCase();
  currentQueueActiveIndex = -1;

  let foundIdx = deduplicated.findIndex(it => it.isCurrent);
  if (foundIdx === -1 && curTitle && !curTitle.includes('bekleniyor')) {
    foundIdx = deduplicated.findIndex(it => {
      const t = (it.title || '').trim().toLowerCase();
      const a = (it.artist || '').trim().toLowerCase();
      return (t === curTitle && (!curArtist || !a || a.includes(curArtist) || curArtist.includes(a)));
    });
  }
  if (foundIdx === -1 && curTitle && !curTitle.includes('bekleniyor')) {
    foundIdx = deduplicated.findIndex(it => {
      const t = (it.title || '').trim().toLowerCase();
      return t && (curTitle.includes(t) || t.includes(curTitle));
    });
  }
  if (foundIdx !== -1) {
    currentQueueActiveIndex = deduplicated[foundIdx].originalIndex;
  }

  // 3. Arama Filtresi Uygula
  let displayItems = deduplicated;
  if (queueFilterQuery) {
    displayItems = deduplicated.filter(it => {
      const t = (it.title || '').toLowerCase();
      const a = (it.artist || '').toLowerCase();
      return t.includes(queueFilterQuery) || a.includes(queueFilterQuery);
    });
  }

  countEl.innerText = `${displayItems.length} Parça`;

  if (displayItems.length === 0) {
    container.innerHTML = '<p class="empty-state">Aramanızla eşleşen parça bulunamadı.</p>';
    return;
  }

  container.innerHTML = displayItems.map((item, displayIdx) => {
    const isPlaying = (foundIdx !== -1 && deduplicated[foundIdx] === item);
    const targetIndex = item.originalIndex;
    const isNextUp = (pendingNextTrackIndex === targetIndex);
    const durationStr = item.duration ? (typeof item.duration === 'number' ? formatTime(item.duration) : item.duration) : '';
    const itemNumber = displayIdx + 1;

    return `
      <div class="queue-item ${isPlaying ? 'playing' : ''} ${isNextUp ? 'next-up' : ''}" onclick="jumpToQueueIndex(${targetIndex})" title="${isPlaying ? 'Şu an çalıyor' : 'Hemen çalmak için tıklayın'}">
        <div class="queue-item-left">
          <span class="queue-index-badge">${itemNumber}</span>
          <div class="eq-bars">
            <span class="eq-bar eq-bar-1"></span>
            <span class="eq-bar eq-bar-2"></span>
            <span class="eq-bar eq-bar-3"></span>
          </div>
          <div class="queue-item-details">
            <div class="queue-item-title-row">
              <span class="queue-item-title">${escapeHtml(item.title || 'İsimsiz')}</span>
              ${isPlaying ? '<span class="now-playing-tag">Çalıyor</span>' : ''}
              ${isNextUp ? '<span class="next-up-tag">⏭️ Sıradaki</span>' : ''}
            </div>
            <div class="queue-item-sub">${escapeHtml(item.artist || 'Bilinmiyor')}</div>
          </div>
        </div>
        <div class="queue-item-right">
          ${durationStr ? `<span class="queue-duration">${durationStr}</span>` : ''}
          ${!isPlaying ? `
            <div class="queue-btn-group">
              <button class="btn-next-up ${isNextUp ? 'active' : ''}" onclick="event.stopPropagation(); setNextInQueue(${targetIndex})" title="Bu şarkı bittikten sonra bundan devam et">
                ${isNextUp ? '✓ Sırada' : '⏭️ Sıradaki Yap'}
              </button>
              <button class="btn-jump" onclick="event.stopPropagation(); jumpToQueueIndex(${targetIndex})" title="Hemen şimdi çal">
                ▶ Hemen Çal
              </button>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.innerText = text;
  return div.innerHTML;
}

// -------------------------------------------------------------
// ŞARKI SÖZLERİ MOTORU (LRCLIB & SENKRONİZASYON)
// -------------------------------------------------------------
let currentLyricsData = null;
let parsedSyncedLyrics = [];
let lastLyricsTrackKey = '';

async function fetchCurrentLyrics(force = false) {
  const title = currentTrack.title || '';
  const artist = currentTrack.artist || '';
  if (!title || title.includes('Bekleniyor') || title.includes('Boşta')) {
    renderLyrics({ plainLyrics: 'Şarkı çalındığında sözler burada görünecektir.' });
    return;
  }

  const trackKey = `${title}|${artist}`;
  if (!force && trackKey === lastLyricsTrackKey && currentLyricsData) {
    renderLyrics(currentLyricsData);
    return;
  }

  const titleEl = document.getElementById('lyrics-track-title');
  const artistEl = document.getElementById('lyrics-track-artist');
  const contentEl = document.getElementById('lyrics-content');

  if (titleEl) titleEl.innerText = title;
  if (artistEl) artistEl.innerText = artist;
  if (contentEl) contentEl.innerHTML = '<p class="lyrics-loading">Şarkı sözleri aranıyor...</p>';

  try {
    const res = await fetch(`/api/lyrics?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.lyrics) {
        lastLyricsTrackKey = trackKey;
        currentLyricsData = data.lyrics;
        renderLyrics(data.lyrics);
        return;
      }
    }
    renderLyrics({ plainLyrics: 'Şarkı sözü bulunamadı.' });
  } catch (err) {
    renderLyrics({ plainLyrics: 'Şarkı sözleri yüklenirken hata oluştu.' });
  }
}

function parseLrc(lrcText) {
  if (!lrcText) return [];
  const lines = lrcText.split('\n');
  const result = [];
  const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;

  for (const line of lines) {
    const match = timeRegex.exec(line.trim());
    if (match) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const ms = parseFloat('0.' + match[3]);
      const totalSec = min * 60 + sec + ms;
      const text = match[4].trim();
      if (text) {
        result.push({ time: totalSec, text });
      }
    }
  }
  return result;
}

function requestBrowserLyrics() {
  sendCmd('getLyrics');
  showToast('🎵 YouTube Music sözleri taranıyor...');
  const contentEl = document.getElementById('lyrics-content');
  if (contentEl) contentEl.innerHTML = '<p class="lyrics-loading">YouTube Music sözleri taranıyor...</p>';
  setTimeout(() => {
    fetchCurrentLyrics(true);
  }, 1200);
}

async function searchCustomLyrics() {
  const input = document.getElementById('lyrics-search-input');
  if (!input) return;
  const q = input.value.trim();
  if (!q) {
    showToast('Lütfen aranacak şarkı veya türkü adını yazın.');
    return;
  }

  const contentEl = document.getElementById('lyrics-content');
  const titleEl = document.getElementById('lyrics-track-title');
  const artistEl = document.getElementById('lyrics-track-artist');

  if (titleEl) titleEl.innerText = q;
  if (artistEl) artistEl.innerText = 'Özel Arama';
  if (contentEl) contentEl.innerHTML = '<p class="lyrics-loading">Sözler aranıyor...</p>';

  try {
    const res = await fetch(`/api/lyrics?title=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (data.lyrics && (data.lyrics.plainLyrics || data.lyrics.syncedLyrics)) {
      renderLyrics(data.lyrics);
    } else {
      renderLyrics({ plainLyrics: 'Aramanız için şarkı sözü bulunamadı.' });
    }
  } catch (err) {
    renderLyrics({ plainLyrics: 'Arama yapılırken hata oluştu: ' + err.message });
  }
}

function renderLyrics(lyrics) {
  const contentEl = document.getElementById('lyrics-content');
  const badgeEl = document.getElementById('lyrics-badge');
  if (!contentEl) return;

  if (lyrics.syncedLyrics) {
    parsedSyncedLyrics = parseLrc(lyrics.syncedLyrics);
    if (badgeEl) {
      badgeEl.innerText = '⚡ Canlı Senkronize';
      badgeEl.style.color = '#10b981';
    }
    contentEl.innerHTML = parsedSyncedLyrics.map((item, idx) => `
      <div class="lyrics-line" id="lrc-line-${idx}" onclick="sendCmd('seekTo', ${Math.floor(item.time)})">${escapeHtml(item.text)}</div>
    `).join('');
    updateActiveLyricLine();
  } else if (lyrics.plainLyrics) {
    parsedSyncedLyrics = [];
    if (badgeEl) {
      badgeEl.innerText = lyrics.source ? `🎵 ${lyrics.source}` : 'Musixmatch / Düz Metin';
      badgeEl.style.color = '#818cf8';
    }
    contentEl.innerHTML = `<div class="lyrics-plain">${escapeHtml(lyrics.plainLyrics)}</div>`;
  } else {
    parsedSyncedLyrics = [];
    contentEl.innerHTML = '<p class="lyrics-empty">Bu parça için şarkı sözü bulunamadı.</p>';
  }
}

function updateActiveLyricLine() {
  if (!parsedSyncedLyrics || parsedSyncedLyrics.length === 0) return;
  const currentSec = currentTrack.currentTime || 0;

  let activeIdx = -1;
  for (let i = 0; i < parsedSyncedLyrics.length; i++) {
    if (currentSec >= parsedSyncedLyrics[i].time) {
      activeIdx = i;
    } else {
      break;
    }
  }

  const lines = document.querySelectorAll('.lyrics-line');
  lines.forEach((line, idx) => {
    if (idx === activeIdx) {
      if (!line.classList.contains('active')) {
        line.classList.add('active');
        line.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else {
      line.classList.remove('active');
    }
  });
}

// Telefonda Kaldığı Yerden Devam Et (Tam Şarkı Parametreleriyle)
function triggerNewPipeResume() {
  const videoId = currentTrack.videoId || '';
  const seconds = Math.floor(currentTrack.currentTime) || 0;
  const title = currentTrack.title || '';
  const artist = currentTrack.artist || '';

  if (window.ErenBridge) {
    // Android Shell içindeyse yerel Intent ile doğrudan telefonda aç
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

      const pinEl = document.getElementById('net-pin');
      if (pinEl && data.pin) {
        pinEl.innerText = data.pin;
      }
      const pinDisplayEl = document.getElementById('net-pin-display');
      if (pinDisplayEl && data.pin) {
        pinDisplayEl.innerText = data.pin;
      }

      renderQuickIps(data.network.lan, data.network.tailscale);
    }

    // Windows Başlangıç Durumu
    const startupToggle = document.getElementById('startup-toggle');
    if (startupToggle && typeof data.startup === 'boolean') {
      startupToggle.checked = data.startup;
    }

    // Telefon Donanım Ses Senkronu Kontrolü
    checkVolumeSyncUI();
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

// PIN Kopyala
function copyCurrentPin() {
  const pinEl = document.getElementById('net-pin-display') || document.getElementById('net-pin');
  const pin = pinEl ? pinEl.innerText.trim() : '';
  if (pin && pin !== '----') {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(pin).then(() => {
        showToast(`📋 PIN panoya kopyalandı: ${pin}`);
      }).catch(() => {
        showToast(`PIN: ${pin}`);
      });
    } else {
      showToast(`PIN: ${pin}`);
    }
  }
}

// Özel Sabit PIN Belirle & Kaydet
async function updateCustomPin() {
  const input = document.getElementById('custom-pin-input');
  const feedback = document.getElementById('pin-change-feedback');
  if (!input) return;

  const pin = input.value.trim();
  if (!/^\d{4}$/.test(pin)) {
    if (feedback) {
      feedback.className = 'feedback-text error';
      feedback.innerText = 'Lütfen tam 4 haneli rakamlardan oluşan bir PIN girin (örn: 1234).';
    }
    return;
  }

  if (feedback) {
    feedback.className = 'feedback-text';
    feedback.innerText = 'PIN güncelleniyor ve kaydediliyor...';
  }

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

    const res = await fetch('/api/auth/pin', {
      method: 'POST',
      headers,
      body: JSON.stringify({ pin, token: authToken })
    });
    const data = await res.json();
    if (data.success && data.pin) {
      input.value = '';
      if (feedback) {
        feedback.className = 'feedback-text success';
        feedback.innerText = `✅ PIN başarıyla "${data.pin}" olarak kaydedildi ve sabitlendi!`;
      }
      const pinEl = document.getElementById('net-pin');
      if (pinEl) pinEl.innerText = data.pin;
      const pinDisplayEl = document.getElementById('net-pin-display');
      if (pinDisplayEl) pinDisplayEl.innerText = data.pin;
      showToast(`🔑 Yeni PIN: ${data.pin}`);
    } else {
      if (feedback) {
        feedback.className = 'feedback-text error';
        feedback.innerText = data.error || 'PIN güncellenemedi.';
      }
    }
  } catch (err) {
    if (feedback) {
      feedback.className = 'feedback-text error';
      feedback.innerText = 'Bağlantı hatası: ' + err.message;
    }
  }
}

// Rastgele Yeni PIN Üret (Sıfırla)
async function generateRandomPin() {
  const feedback = document.getElementById('pin-change-feedback');
  if (feedback) {
    feedback.className = 'feedback-text';
    feedback.innerText = 'Yeni rastgele PIN üretiliyor...';
  }

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

    const res = await fetch('/api/auth/pin', {
      method: 'POST',
      headers,
      body: JSON.stringify({ pin: 'random', token: authToken })
    });
    const data = await res.json();
    if (data.success && data.pin) {
      if (feedback) {
        feedback.className = 'feedback-text success';
        feedback.innerText = `✅ Yeni rastgele PIN üretildi: "${data.pin}"`;
      }
      const pinEl = document.getElementById('net-pin');
      if (pinEl) pinEl.innerText = data.pin;
      const pinDisplayEl = document.getElementById('net-pin-display');
      if (pinDisplayEl) pinDisplayEl.innerText = data.pin;
      showToast(`🎲 Yeni PIN: ${data.pin}`);
    } else {
      if (feedback) {
        feedback.className = 'feedback-text error';
        feedback.innerText = data.error || 'PIN sıfırlanamadı.';
      }
    }
  } catch (err) {
    if (feedback) {
      feedback.className = 'feedback-text error';
      feedback.innerText = 'Bağlantı hatası: ' + err.message;
    }
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

// Telefon & PC Donanım Ses Senkronu
function checkVolumeSyncUI() {
  if (window.ErenBridge && typeof window.ErenBridge.isVolumeSyncEnabled === 'function') {
    const card = document.getElementById('volume-sync-card');
    const toggle = document.getElementById('volume-sync-toggle');
    if (card) card.style.display = 'block';
    if (toggle) toggle.checked = window.ErenBridge.isVolumeSyncEnabled();
  }
}

function toggleVolumeSync(enabled) {
  if (window.ErenBridge && typeof window.ErenBridge.setVolumeSyncEnabled === 'function') {
    window.ErenBridge.setVolumeSyncEnabled(enabled);
    showToast(enabled ? '🔊 PC Ses Senkronu Açıldı' : '🔇 PC Ses Senkronu Kapatıldı');
  }
}

// -------------------------------------------------------------
// WINDOWS MEDYA OTURUM YÖNETİMİ VE KAYNAK SABİTLEME
// -------------------------------------------------------------
function getSourceIcon(app) {
  if (!app) return '🎵';
  const lower = sanitizeTurkish(app).toLowerCase();
  if (lower.includes('boşta') || lower.includes('bosta')) return '💤';
  if (lower.includes('youtube music')) return '🎵';
  if (lower.includes('youtube')) return '▶️';
  if (lower.includes('spotify')) return '🎧';
  if (lower.includes('tarayıcı') || lower.includes('tarayici') || lower.includes('chrome') || lower.includes('edge') || lower.includes('brave') || lower.includes('browser')) return '🌐';
  return '📻';
}

function updateSessionUI() {
  const iconEl = document.getElementById('session-icon');
  const nameEl = document.getElementById('session-name');
  const counterEl = document.getElementById('session-counter');
  const pinBadgeEl = document.getElementById('session-pin-badge');
  const prevBtn = document.getElementById('prev-session-btn');
  const nextBtn = document.getElementById('next-session-btn');

  const sourceApp = sanitizeTurkish(currentTrack.sourceApp || 'Medya Oynatıcı');
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
          <span class="item-title">${escapeHtml(sanitizeTurkish(s.title || 'Bilinmiyor'))}</span>
          <span class="item-sub">${escapeHtml(sanitizeTurkish(s.artist || s.app))}</span>
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

// -------------------------------------------------------------
// AKILLI KAYAN YAZI MOTORU (MARQUEE)
// -------------------------------------------------------------
function setupMarquee(containerId, textElement) {
  if (!textElement) return;
  const container = document.getElementById(containerId);
  if (!container) return;

  // Önceki animasyonu sıfırla
  textElement.classList.remove('marquee-scroll');
  textElement.style.removeProperty('--marquee-translate');
  textElement.style.removeProperty('--marquee-duration');
  container.classList.remove('has-overflow');

  // DOM yerleşimi sonrası boyutları hesapla
  requestAnimationFrame(() => {
    const containerWidth = container.clientWidth;
    const textWidth = textElement.scrollWidth;

    if (textWidth > containerWidth + 6) {
      const overflowDiff = textWidth - containerWidth + 24;
      container.classList.add('has-overflow');
      textElement.style.setProperty('--marquee-translate', `-${overflowDiff}px`);
      // Hız hesaplama: daha uzun metinler için orantılı süre (min 6s, max 18s)
      const durationSec = Math.max(6, Math.min(18, Math.round(overflowDiff / 20) + 4));
      textElement.style.setProperty('--marquee-duration', `${durationSec}s`);
      textElement.classList.add('marquee-scroll');
    }
  });
}

window.addEventListener('resize', () => {
  setupMarquee('title-marquee-container', document.getElementById('track-title'));
  setupMarquee('artist-marquee-container', document.getElementById('track-artist'));
});

// -------------------------------------------------------------
// HAKKINDA & AFİŞ MODAL KONTROLÜ
// -------------------------------------------------------------
function openAboutModal() {
  const modal = document.getElementById('about-modal');
  if (modal) {
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
  }
}

function closeAboutModal(event) {
  if (event && event.target && event.target !== event.currentTarget && !event.target.classList.contains('about-close-btn')) {
    return;
  }
  const modal = document.getElementById('about-modal');
  if (modal) {
    modal.classList.remove('show');
    document.body.style.overflow = '';
  }
}

// -------------------------------------------------------------
// TAILSCALE KILAVUZ MODAL KONTROLÜ
// -------------------------------------------------------------
function openTailscaleGuideModal() {
  const modal = document.getElementById('tailscale-modal');
  if (modal) {
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
  }
}

function closeTailscaleGuideModal(event) {
  if (event && event.target && event.target !== event.currentTarget && !event.target.classList.contains('guide-close-btn')) {
    return;
  }
  const modal = document.getElementById('tailscale-modal');
  if (modal) {
    modal.classList.remove('show');
    document.body.style.overflow = '';
  }
}

// -------------------------------------------------------------
// AKILLI SAAT & TELEFON DONANIM SES SENKRONİZASYONU
// -------------------------------------------------------------
let isVolumeSyncEnabled = false;

function initVolumeSync() {
  if (window.ErenBridge && typeof window.ErenBridge.isVolumeSyncEnabled === 'function') {
    try {
      isVolumeSyncEnabled = !!window.ErenBridge.isVolumeSyncEnabled();
    } catch (e) {
      isVolumeSyncEnabled = localStorage.getItem('mb_vol_sync') === 'true';
    }
  } else {
    isVolumeSyncEnabled = localStorage.getItem('mb_vol_sync') === 'true';
  }
  updateVolumeSyncUI();
}

function toggleVolumeSync() {
  isVolumeSyncEnabled = !isVolumeSyncEnabled;
  localStorage.setItem('mb_vol_sync', isVolumeSyncEnabled ? 'true' : 'false');
  if (window.ErenBridge && typeof window.ErenBridge.setVolumeSyncEnabled === 'function') {
    try {
      window.ErenBridge.setVolumeSyncEnabled(isVolumeSyncEnabled);
    } catch (e) {}
  }
  updateVolumeSyncUI();
  if (isVolumeSyncEnabled) {
    showToast('⌚ Ses Senkronu Açık: Telefon & Saat sesi PC ana sesini yönetir');
  } else {
    showToast('⌚ Ses Senkronu Kapatıldı');
  }
}

function updateVolumeSyncUI() {
  const btn = document.getElementById('vol-sync-btn');
  const text = document.getElementById('vol-sync-text');
  if (!btn) return;
  if (isVolumeSyncEnabled) {
    btn.classList.add('active');
    if (text) text.innerText = 'Ses Senk: Açık';
    btn.title = 'Akıllı Saat / Telefon Ses Senkronu: Açık (Kapatmak için tıklayın)';
  } else {
    btn.classList.remove('active');
    if (text) text.innerText = 'Ses Senk: Kapalı';
    btn.title = 'Akıllı Saat / Telefon Ses Senkronu: Kapalı (Açmak için tıklayın)';
  }
}

// -------------------------------------------------------------
// YAŞAM DÖNGÜSÜ (LIFECYCLE) & ARKA PLANDAN ÖN PLANA DÖNÜŞ KONTROLLERİ
// -------------------------------------------------------------
window.onAppResume = function() {
  // 1. HTTP REST ile anında son durumu çek ve arayüzü güncelle (0 gecikme)
  fetchCurrentState();

  // 2. Ses Senkron durumunu tazele
  initVolumeSync();

  // 3. WebSocket bağlantısının sağlığını kontrol et / zombiyse anında yenile
  const timeSinceLastMsg = performance.now() - lastWsMessageTime;
  if (!ws || ws.readyState !== WebSocket.OPEN || timeSinceLastMsg > 8000) {
    connectWebSocket(true);
  } else {
    try {
      ws.send(JSON.stringify({ action: 'sync' }));
    } catch (_) {
      connectWebSocket(true);
    }
  }

  // 4. İlerleme sayacını yeniden canlandır
  startProgressTimer();
};

// Tarayıcı ve WebView görünürlük olayları
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    window.onAppResume();
  }
});

window.addEventListener('focus', () => {
  window.onAppResume();
});

window.addEventListener('pageshow', () => {
  window.onAppResume();
});

window.addEventListener('online', () => {
  window.onAppResume();
});

// Arka planda donmuş olabilecek bağlantılar için koruma bekçisi (Watchdog)
setInterval(() => {
  if (document.visibilityState === 'visible') {
    const timeSinceLastMsg = performance.now() - lastWsMessageTime;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      ensureWebSocketConnected();
    } else if (timeSinceLastMsg > 6000) {
      // 6 saniyedir sunucudan mesaj gelmediyse senkronize et
      try {
        ws.send(JSON.stringify({ action: 'sync' }));
      } catch (_) {
        connectWebSocket(true);
      }
    }
    if (timeSinceLastMsg > 15000) {
      // 15 saniyedir hiç veri gelmediyse bağlantı zombileşmiştir, sıfırla
      connectWebSocket(true);
      fetchCurrentState();
    }
  }
}, 3000);

// Başlat
window.addEventListener('DOMContentLoaded', () => {
  if (!authToken && window.ErenBridge && typeof window.ErenBridge.getAuthToken === 'function') {
    try { authToken = window.ErenBridge.getAuthToken() || ''; } catch(_) {}
  }
  fetchCurrentState(); // Sayfa açılır açılmaz anında ilk veriyi getir
  initVolumeSync();    // Donanım / Akıllı saat ses senkronu butonunu yükle
  connectWebSocket();
  startProgressTimer();
  setupMarquee('title-marquee-container', document.getElementById('track-title'));
  setupMarquee('artist-marquee-container', document.getElementById('track-artist'));
});
