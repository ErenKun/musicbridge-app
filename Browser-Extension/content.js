// MusicBridge Browser Extension - Content Script
// Eren Teknoloji - 2026

(function() {
  'use strict';

  const CORE_WS_URL = 'ws://localhost:8765';
  const CORE_HTTP_URL = 'http://localhost:8765/api/browser-update';
  let ws = null;
  let isConnected = false;

  function connectWs() {
    try {
      ws = new WebSocket(CORE_WS_URL);
      ws.onopen = () => {
        isConnected = true;
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'browser-command') {
            executeCommand(msg.action, msg.data);
          }
        } catch (_) {}
      };
      ws.onclose = () => {
        isConnected = false;
        setTimeout(connectWs, 3000);
      };
      ws.onerror = () => {
        ws = null;
      };
    } catch (_) {}
  }

  connectWs();

  function executeCommand(action, data) {
    const host = window.location.hostname;

    // 1. YouTube Music Kontrolleri
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
        const nextBtn = document.querySelector('.next-button') || document.querySelector('tp-yt-paper-icon-button.next-button');
        if (nextBtn) nextBtn.click();
      } else if (action === 'previous') {
        const prevBtn = document.querySelector('.previous-button') || document.querySelector('tp-yt-paper-icon-button.previous-button');
        if (prevBtn) prevBtn.click();
      } else if (action === 'seekTo') {
        video.currentTime = Number(data);
      }
    }

    // 2. Spotify Web Kontrolleri
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

    // 3. SoundCloud Kontrolleri
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

  // Durumu PC-Core'a Düzenli İlet (1 sn periyot)
  setInterval(() => {
    const host = window.location.hostname;
    let trackInfo = null;

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

        trackInfo = {
          title: titleEl.textContent.trim(),
          artist: artistEl ? artistEl.textContent.trim() : 'YouTube Music',
          videoId: urlParams.get('v') || '',
          isPlaying: !video.paused,
          currentTime: Math.floor(video.currentTime),
          duration: Math.floor(video.duration || 0),
          volume: Math.round(video.volume * 100),
          artwork: art,
          sourceApp: 'YouTube Music'
        };
      }
    } else if (host.includes('spotify.com')) {
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
      fetch(CORE_HTTP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trackInfo)
      }).catch(() => {});
    }
  }, 1000);
})();
