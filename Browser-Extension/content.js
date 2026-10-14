// MusicBridge Browser Extension - Content Script
// Eren Teknoloji - 2026

(function() {
  'use strict';

  let pendingNextTrackData = null;
  let lastReportedVideoId = '';

  // 1. Background Service Worker'dan gelen komutları dinle
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message && message.type === 'browser-command') {
        executeCommand(message.action, message.data);
      }
    });
  }

  // 2. Yedek Doğrudan WebSocket Bağlantısı
  let ws = null;
  function connectWs() {
    try {
      ws = new WebSocket('ws://localhost:8765');
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'browser-command') {
            executeCommand(msg.action, msg.data);
          }
        } catch (_) {}
      };
      ws.onclose = () => {
        ws = null;
        setTimeout(connectWs, 5000);
      };
      ws.onerror = () => {
        ws = null;
      };
    } catch (_) {}
  }
  connectWs();

  // -------------------------------------------------------------
  // KOMUT YÜRÜTME MOTORU
  // -------------------------------------------------------------
  function executeCommand(action, data) {
    const host = window.location.hostname;

    // A. YouTube Music Kontrolleri
    if (host.includes('music.youtube.com')) {
      const video = document.querySelector('video');
      if (!video) return;

      if (action === 'playPause') {
        if (video.paused) video.play(); else video.pause();
      } else if (action === 'play') {
        video.play();
      } else if (action === 'pause') {
        video.pause();
      } else if (action === 'next') {
        const nextBtn = document.querySelector('.next-button, tp-yt-paper-icon-button.next-button');
        if (nextBtn) nextBtn.click();
      } else if (action === 'previous') {
        const prevBtn = document.querySelector('.previous-button, tp-yt-paper-icon-button.previous-button');
        if (prevBtn) prevBtn.click();
      } else if (action === 'seekTo') {
        video.currentTime = Number(data);
      } else if (action === 'seekToQueueIndex') {
        // Doğrudan tıklayıp hemen o şarkıya geç
        jumpToYtMusicQueueIndex(data);
      } else if (action === 'setNextTrackIndex') {
        // Bu şarkı bitince bundan devam et (Sırada Çal)
        if (data === null || data === -1) {
          pendingNextTrackData = null;
          showOnPageNotification('Sıradaki şarkı seçimi kaldırıldı.');
        } else {
          pendingNextTrackData = data;
          const trackTitle = (typeof data === 'object' && data.title) ? data.title : 'Seçilen parça';
          showOnPageNotification(`⏭️ Sıradaki şarkı: ${trackTitle}`);
        }
      } else if (action === 'getLyrics') {
        loadAndSendYtMusicLyrics();
      }
    }

    // B. Normal YouTube.com Kontrolleri (Çalma Listesi & Video)
    else if (host.includes('youtube.com') && !host.includes('music.youtube.com')) {
      const video = document.querySelector('video');
      if (!video) return;

      if (action === 'playPause') {
        if (video.paused) video.play(); else video.pause();
      } else if (action === 'play') {
        video.play();
      } else if (action === 'pause') {
        video.pause();
      } else if (action === 'next') {
        const nextBtn = document.querySelector('.ytp-next-button, a.ytp-next-button');
        if (nextBtn) nextBtn.click();
      } else if (action === 'previous') {
        const prevBtn = document.querySelector('.ytp-prev-button, a.ytp-prev-button');
        if (prevBtn) prevBtn.click();
      } else if (action === 'seekTo') {
        video.currentTime = Number(data);
      } else if (action === 'seekToQueueIndex') {
        jumpToYtVideoQueueIndex(data);
      } else if (action === 'setNextTrackIndex') {
        if (data === null || data === -1) {
          pendingNextTrackData = null;
          showOnPageNotification('Sıradaki video seçimi kaldırıldı.');
        } else {
          pendingNextTrackData = data;
          const trackTitle = (typeof data === 'object' && data.title) ? data.title : 'Seçilen video';
          showOnPageNotification(`⏭️ Sıradaki video: ${trackTitle}`);
        }
      }
    }

    // C. Spotify Web Kontrolleri
    else if (host.includes('spotify.com')) {
      if (action === 'playPause' || action === 'play' || action === 'pause') {
        const playBtn = document.querySelector('[data-testid="control-button-playpause"]');
        if (playBtn) playBtn.click();
      } else if (action === 'next') {
        const nextBtn = document.querySelector('[data-testid="control-button-skip-forward"]');
        if (nextBtn) nextBtn.click();
      } else if (action === 'previous') {
        const prevBtn = document.querySelector('[data-testid="control-button-skip-back"]');
        if (prevBtn) prevBtn.click();
      }
    }

    // D. SoundCloud Kontrolleri
    else if (host.includes('soundcloud.com')) {
      if (action === 'playPause' || action === 'play' || action === 'pause') {
        const playBtn = document.querySelector('.playControl');
        if (playBtn) playBtn.click();
      } else if (action === 'next') {
        const nextBtn = document.querySelector('.skipControl__next');
        if (nextBtn) nextBtn.click();
      } else if (action === 'previous') {
        const prevBtn = document.querySelector('.skipControl__previous');
        if (prevBtn) prevBtn.click();
      }
    }
  }

  // -------------------------------------------------------------
  // YOUTUBE MUSIC KUYRUK & ŞARKI DEĞİŞTİRME (SHADOW DOM + BAŞLIK DESTEKLİ)
  // -------------------------------------------------------------
  function jumpToYtMusicQueueIndex(param) {
    let targetIdx = -1;
    let targetTitle = '';

    if (typeof param === 'object' && param !== null) {
      targetIdx = typeof param.index === 'number' ? param.index : -1;
      targetTitle = (param.title || '').trim().toLowerCase();
    } else if (typeof param === 'number') {
      targetIdx = param;
    } else if (typeof param === 'string' && !isNaN(Number(param)) && param.trim() !== '') {
      targetIdx = Number(param);
    } else if (typeof param === 'string') {
      targetTitle = param.trim().toLowerCase();
    }

    let queueItems = Array.from(document.querySelectorAll('ytmusic-player-queue-item'));

    // Eğer kuyruk elemanları DOM'da yoksa Up Next / Sonraki sekmesini açmayı dene
    if (!queueItems || queueItems.length === 0) {
      const tabs = document.querySelectorAll('ytmusic-player-page ytmusic-tab-header-renderer, ytmusic-player-page tp-yt-paper-tab');
      for (const tab of tabs) {
        const txt = (tab.textContent || '').toLowerCase();
        if (txt.includes('sonraki') || txt.includes('up next') || txt.includes('sıradaki') || txt.includes('kuyruk')) {
          tab.click();
          break;
        }
      }
      queueItems = Array.from(document.querySelectorAll('ytmusic-player-queue-item'));
    }

    if (!queueItems || queueItems.length === 0) return false;

    let target = null;

    // 1. Önce parça adına göre eşleşen öğeyi bul (İndeks kaymalarından etkilenmez!)
    if (targetTitle) {
      target = queueItems.find(el => {
        const root = el.shadowRoot || el;
        const tEl = el.querySelector('.song-title, .title') || root.querySelector('.title, .song-title');
        const txt = (tEl ? tEl.textContent : '').trim().toLowerCase();
        return txt && (txt === targetTitle || txt.includes(targetTitle) || targetTitle.includes(txt));
      });
    }

    // 2. Parça adına göre bulunamadıysa verilen indeksi kullan
    if (!target && targetIdx >= 0 && targetIdx < queueItems.length) {
      target = queueItems[targetIdx];
    }

    if (!target) return false;

    // 3. Görünürlüğe getir (IntersectionObserver ve Sanal liste için)
    try {
      target.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    } catch (_) {}

    const opts = { bubbles: true, cancelable: true, view: window, buttons: 1, composed: true };
    const root = target.shadowRoot;

    // 4. Shadow DOM ve Light DOM içindeki tüm olası tıklanabilir hedefleri topla
    const clickTargets = [
      root ? root.querySelector('.play-button') : null,
      root ? root.querySelector('.thumbnail-wrapper') : null,
      root ? root.querySelector('#layout') : null,
      root ? root.querySelector('.title, .song-title') : null,
      root ? root.querySelector('img') : null,
      root ? root.querySelector('a') : null,
      target.querySelector('ytmusic-play-button-renderer #button'),
      target.querySelector('ytmusic-play-button-renderer'),
      target.querySelector('.play-button'),
      target.querySelector('.left-items'),
      target.querySelector('.thumbnail-container'),
      target.querySelector('.song-title, .title, yt-formatted-string'),
      target.querySelector('a.yt-simple-endpoint, a'),
      target
    ].filter(Boolean);

    // 5. Çoklu mouse olayları ve doğrudan click() tetikle
    for (const el of clickTargets) {
      try {
        el.dispatchEvent(new MouseEvent('mouseover', opts));
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.dispatchEvent(new MouseEvent('click', opts));
        if (typeof el.click === 'function') el.click();
      } catch (_) {}
    }

    // 6. Masaüstü YouTube Music web standardı: Çift tıklama dispatch et
    try {
      target.dispatchEvent(new MouseEvent('dblclick', opts));
      if (root && root.querySelector('#layout')) {
        root.querySelector('#layout').dispatchEvent(new MouseEvent('dblclick', opts));
      }
    } catch (_) {}

    return true;
  }

  // -------------------------------------------------------------
  // NORMAL YOUTUBE.COM ÇALMA LİSTESİNDE ŞARKIYA GEÇİŞ
  // -------------------------------------------------------------
  function jumpToYtVideoQueueIndex(param) {
    let targetIdx = -1;
    let targetTitle = '';

    if (typeof param === 'object' && param !== null) {
      targetIdx = typeof param.index === 'number' ? param.index : -1;
      targetTitle = (param.title || '').trim().toLowerCase();
    } else if (typeof param === 'number') {
      targetIdx = param;
    } else if (typeof param === 'string' && !isNaN(Number(param)) && param.trim() !== '') {
      targetIdx = Number(param);
    } else if (typeof param === 'string') {
      targetTitle = param.trim().toLowerCase();
    }

    const queueItems = Array.from(document.querySelectorAll('ytd-playlist-panel-video-renderer'));
    if (!queueItems || queueItems.length === 0) return false;

    let target = null;
    if (targetTitle) {
      target = queueItems.find(el => {
        const tEl = el.querySelector('#video-title');
        const txt = (tEl ? tEl.textContent : '').trim().toLowerCase();
        return txt && (txt === targetTitle || txt.includes(targetTitle) || targetTitle.includes(txt));
      });
    }

    if (!target && targetIdx >= 0 && targetIdx < queueItems.length) {
      target = queueItems[targetIdx];
    }

    if (target) {
      try {
        target.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      } catch (_) {}

      const link = target.querySelector('a#wc-endpoint, a.yt-simple-endpoint, a#thumbnail, a') || target;
      const href = link.href || (target.querySelector('a') ? target.querySelector('a').href : null);
      const opts = { bubbles: true, cancelable: true, view: window, buttons: 1, composed: true };

      link.dispatchEvent(new MouseEvent('mousedown', opts));
      link.dispatchEvent(new MouseEvent('mouseup', opts));
      link.dispatchEvent(new MouseEvent('click', opts));
      try { link.click(); } catch (_) {}

      if (href && !href.includes('javascript:')) {
        setTimeout(() => {
          if (!window.location.href.includes(href)) {
            window.location.href = href;
          }
        }, 120);
      }
      return true;
    }
    return false;
  }

  // -------------------------------------------------------------
  // OTOMATİK SIRADAKİ PARÇAYA GEÇİŞ DİNLEYİCİSİ (0 Gecikmeli)
  // -------------------------------------------------------------
  function attachVideoListeners() {
    const video = document.querySelector('video');
    if (!video || video._mbListenersAttached) return;
    video._mbListenersAttached = true;

    const handleTrackEnd = () => {
      if (pendingNextTrackData !== null) {
        const nextData = pendingNextTrackData;
        pendingNextTrackData = null;
        console.log('🎵 MusicBridge: Parça bitti, belirlenen sıradaki şarkıya geçiliyor:', nextData);

        const host = window.location.hostname;
        if (host.includes('music.youtube.com')) {
          jumpToYtMusicQueueIndex(nextData);
        } else if (host.includes('youtube.com')) {
          jumpToYtVideoQueueIndex(nextData);
        }
      }
    };

    // 1. Video bittiğinde anında tetikle
    video.addEventListener('ended', handleTrackEnd);

    // 2. Video bitimine 1.0 sn kala (YouTube varsayılan rastgele sonrakine geçmeden önce)
    video.addEventListener('timeupdate', () => {
      if (pendingNextTrackData !== null && video.duration > 0) {
        if (video.currentTime >= video.duration - 1.0) {
          handleTrackEnd();
        }
      }
    });
  }

  // Sayfa içi küçük bildirim göster
  function showOnPageNotification(text) {
    let toast = document.getElementById('musicbridge-notif');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'musicbridge-notif';
      toast.style.cssText = 'position:fixed;bottom:80px;right:24px;background:#6366f1;color:#fff;padding:10px 18px;border-radius:12px;font-size:13px;font-weight:600;z-index:999999;box-shadow:0 8px 24px rgba(0,0,0,0.5);transition:opacity 0.3s;pointer-events:none;font-family:sans-serif;';
      document.body.appendChild(toast);
    }
    toast.innerText = text;
    toast.style.opacity = '1';
    setTimeout(() => { if (toast) toast.style.opacity = '0'; }, 2500);
  }

  // -------------------------------------------------------------
  // YOUTUBE MUSIC SÖZ ÇIKARICI (DOM & MUSIXMATCH)
  // -------------------------------------------------------------
  function extractYtMusicLyrics() {
    // 1. YouTube Music'in sağ sekmesindeki açıklama/söz rafını kontrol et
    const shelf = document.querySelector('ytmusic-description-shelf-renderer');
    if (shelf) {
      const desc = shelf.querySelector('.description, #description, yt-formatted-string.description');
      if (desc && desc.textContent.trim()) {
        const footer = shelf.querySelector('.footer');
        return {
          plainLyrics: desc.textContent.trim(),
          syncedLyrics: '',
          source: footer ? footer.textContent.trim() : 'Musixmatch'
        };
      }
    }

    // 2. Lyrics sekmesi kapsayıcısı
    const lyricsTab = document.querySelector('ytmusic-tab-renderer[page-type*="LYRICS"]');
    if (lyricsTab) {
      const desc = lyricsTab.querySelector('.description, yt-formatted-string');
      if (desc && desc.textContent.trim()) {
        return {
          plainLyrics: desc.textContent.trim(),
          syncedLyrics: '',
          source: 'YouTube Music'
        };
      }
    }

    return null;
  }

  // YouTube Music'te sözler sekmesini bulup arka planda tetikle
  function loadAndSendYtMusicLyrics() {
    const lyricsData = extractYtMusicLyrics();
    if (lyricsData) {
      sendToCore({ type: 'LYRICS_UPDATE', data: lyricsData });
      return;
    }

    // Eğer henüz söz sekmesine tıklanmadıysa, Sözler sekmesine tıkla
    const tabs = document.querySelectorAll('ytmusic-player-page ytmusic-tab-header-renderer, ytmusic-player-page tp-yt-paper-tab');
    for (const tab of tabs) {
      const txt = (tab.textContent || '').toLowerCase();
      if (txt.includes('sözler') || txt.includes('lyrics')) {
        tab.click();
        setTimeout(() => {
          const loadedLyrics = extractYtMusicLyrics();
          if (loadedLyrics) {
            sendToCore({ type: 'LYRICS_UPDATE', data: loadedLyrics });
          }
        }, 800);
        break;
      }
    }
  }

  // -------------------------------------------------------------
  // ÇALMA LİSTESİ VE KUYRUK ÇEKİCİLERİ
  // -------------------------------------------------------------
  // 1. YouTube Music Kuyruğu
  function extractYtMusicQueue() {
    const items = [];
    const queueElements = document.querySelectorAll('ytmusic-player-queue-item');
    queueElements.forEach((el, index) => {
      const titleEl = el.querySelector('.song-title, .title');
      const artistEl = el.querySelector('.byline');
      const durEl = el.querySelector('.duration');
      const isSelected = el.hasAttribute('selected') ||
                         el.classList.contains('selected') ||
                         el.getAttribute('play-button-state') === 'playing' ||
                         el.getAttribute('play-button-state') === 'paused' ||
                         !!el.querySelector('[aria-selected="true"]');

      if (titleEl && titleEl.textContent.trim()) {
        items.push({
          index,
          title: titleEl.textContent.trim(),
          artist: artistEl ? artistEl.textContent.trim() : '',
          duration: durEl ? durEl.textContent.trim() : '',
          isCurrent: isSelected,
          isRecommendation: false
        });
      }
    });
    return items;
  }

  // 2. Normal YouTube.com Çalma Listesi Kuyruğu
  function extractYtVideoQueue() {
    const items = [];
    const panel = document.querySelector('ytd-playlist-panel-renderer');
    if (!panel) return items;

    const queueElements = panel.querySelectorAll('ytd-playlist-panel-video-renderer');
    queueElements.forEach((el, index) => {
      const titleEl = el.querySelector('#video-title');
      const artistEl = el.querySelector('#byline, ytd-channel-name');
      const durEl = el.querySelector('#time-status span, .ytd-thumbnail-overlay-time-status-renderer');
      const isSelected = el.hasAttribute('selected') ||
                         el.classList.contains('selected') ||
                         el.getAttribute('is-selected') === 'true';

      if (titleEl && titleEl.textContent.trim()) {
        items.push({
          index,
          title: titleEl.textContent.trim(),
          artist: artistEl ? artistEl.textContent.trim() : 'YouTube',
          duration: durEl ? durEl.textContent.trim() : '',
          isCurrent: isSelected,
          isRecommendation: false
        });
      }
    });
    return items;
  }

  // -------------------------------------------------------------
  // -------------------------------------------------------------
  // EKLENTİ GEÇERLİLİK KONTROLÜ
  // -------------------------------------------------------------
  function isExtensionValid() {
    try {
      return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;
    } catch (_) {
      return false;
    }
  }

  // -------------------------------------------------------------
  // VERİ İLETİM KÖPRÜSÜ
  // -------------------------------------------------------------
  function sendToCore(payload) {
    if (!isExtensionValid()) return;
    try {
      chrome.runtime.sendMessage(payload, (res) => {
        if (!isExtensionValid()) return;
        if (chrome.runtime.lastError) return;
        if (res && res.data && Array.isArray(res.data.commands) && res.data.commands.length > 0) {
          for (const cmd of res.data.commands) {
            executeCommand(cmd.action, cmd.data);
          }
        }
      });
    } catch (_) {}
  }

  // -------------------------------------------------------------
  // PERİYODİK MEDYA DURUMU TAKİBİ (1 sn)
  // -------------------------------------------------------------
  const trackerTimer = setInterval(() => {
    if (!isExtensionValid()) {
      clearInterval(trackerTimer);
      return;
    }

    attachVideoListeners();
    const host = window.location.hostname;
    let trackInfo = null;

    // 1. YouTube Music Takibi
    if (host.includes('music.youtube.com')) {
      const video = document.querySelector('video');
      const titleEl = document.querySelector('ytmusic-player-bar .title');
      const artistEl = document.querySelector('ytmusic-player-bar .byline');
      const artEl = document.querySelector('ytmusic-player-bar .image');

      if (video && titleEl && titleEl.textContent.trim()) {
        const urlParams = new URLSearchParams(window.location.search);
        let art = artEl ? artEl.src : '';
        if (art) {
          art = art.replace(/=w\d+-h\d+[^=]*/, '=w600-h600-l90-rj').replace(/=s\d+[^=]*/, '=s800');
        }

        const currentVid = urlParams.get('v') || '';
        const queueList = extractYtMusicQueue();
        const lyricsData = extractYtMusicLyrics();

        trackInfo = {
          title: titleEl.textContent.trim(),
          artist: artistEl ? artistEl.textContent.trim() : 'YouTube Music',
          videoId: currentVid,
          isPlaying: !video.paused,
          currentTime: Math.floor(video.currentTime),
          duration: Math.floor(video.duration || 0),
          volume: Math.round(video.volume * 100),
          artwork: art,
          queue: queueList.length > 0 ? queueList : undefined,
          lyrics: lyricsData || undefined,
          sourceApp: 'YouTube Music'
        };

        // Otomatik Sıradaki Parça Atlaması (Bu şarkı bitince bundan devam et)
        if (pendingNextTrackData !== null && video.duration > 0) {
          if (video.ended || (video.currentTime >= video.duration - 1.0)) {
            const nextData = pendingNextTrackData;
            pendingNextTrackData = null;
            jumpToYtMusicQueueIndex(nextData);
          }
        }

        lastReportedVideoId = currentVid;
      }
    }

    // 2. Normal YouTube.com Takibi
    else if (host.includes('youtube.com') && !host.includes('music.youtube.com')) {
      const video = document.querySelector('video');
      const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, #above-the-fold #title h1, h1.title');
      const artistEl = document.querySelector('#owner #channel-name a, ytd-channel-name a, #upload-info #channel-name');

      if (video && titleEl && titleEl.textContent.trim()) {
        const urlParams = new URLSearchParams(window.location.search);
        const currentVid = urlParams.get('v') || '';
        const queueList = extractYtVideoQueue();

        trackInfo = {
          title: titleEl.textContent.trim(),
          artist: artistEl ? artistEl.textContent.trim() : 'YouTube',
          videoId: currentVid,
          isPlaying: !video.paused,
          currentTime: Math.floor(video.currentTime),
          duration: Math.floor(video.duration || 0),
          volume: Math.round(video.volume * 100),
          artwork: currentVid ? `https://i.ytimg.com/vi/${currentVid}/hqdefault.jpg` : '',
          queue: queueList.length > 0 ? queueList : undefined,
          sourceApp: 'YouTube'
        };

        // Çalma listesinde otomatik sıradaki parçaya geçiş kontrolü
        if (pendingNextTrackData !== null && video.duration > 0) {
          if (video.ended || (video.currentTime >= video.duration - 1.0)) {
            const nextData = pendingNextTrackData;
            pendingNextTrackData = null;
            jumpToYtVideoQueueIndex(nextData);
          }
        }

        lastReportedVideoId = currentVid;
      }
    }

    // 3. Spotify Web Takibi
    else if (host.includes('spotify.com')) {
      const titleEl = document.querySelector('[data-testid="context-item-info-title"]');
      const artistEl = document.querySelector('[data-testid="context-item-info-subtitles"]');
      const artEl = document.querySelector('[data-testid="cover-art-image"]');
      const playBtn = document.querySelector('[data-testid="control-button-playpause"]');

      if (titleEl && titleEl.textContent.trim()) {
        const isPlaying = playBtn ? playBtn.getAttribute('aria-label') === 'Duraklat' || playBtn.getAttribute('aria-label') === 'Pause' : false;
        trackInfo = {
          title: titleEl.textContent.trim(),
          artist: artistEl ? artistEl.textContent.trim() : 'Spotify',
          isPlaying: isPlaying,
          artwork: artEl ? artEl.src : '',
          sourceApp: 'Spotify'
        };
      }
    }

    if (trackInfo) {
      sendToCore({ type: 'BROWSER_UPDATE', data: trackInfo });
    }
  }, 1000);
})();
