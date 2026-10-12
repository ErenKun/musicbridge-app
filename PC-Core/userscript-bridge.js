// ==UserScript==
// @name         MusicBridge - Web Player Entegrasyonu
// @namespace    https://eren.tech/
// @version      1.1.0
// @description  Tarayıcıda çalan YouTube Music'i MusicBridge PC Core ile bağlar (Kuyruk, Yüksek Çözünürlüklü Kapak ve Çift Yönlü Kontrol).
// @author       Eren Teknoloji
// @match        https://music.youtube.com/*
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';
    const CORE_HTTP_URL = 'http://localhost:8765/api/browser-update';
    const CORE_WS_URL = 'ws://localhost:8765';
    let ws = null;

    // WebSocket bağlantısı kur (Çift Yönlü Hızlı Kontrol)
    function connectWs() {
        try {
            ws = new WebSocket(CORE_WS_URL);
            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'browser-command') {
                        handleCommand(msg.action, msg.data);
                    }
                } catch (e) {}
            };
            ws.onclose = () => {
                setTimeout(connectWs, 3000);
            };
            ws.onerror = () => {
                ws = null;
            };
        } catch (e) {}
    }
    connectWs();

    function handleCommand(action, data) {
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
        } else if (action === 'seekToQueueIndex') {
            const queueItems = document.querySelectorAll('ytmusic-player-queue-item');
            if (queueItems && queueItems[Number(data)]) {
                const target = queueItems[Number(data)];
                const playBtn = target.querySelector('.play-button') || target;
                playBtn.click();
            }
        }
    }

    // YouTube Music'ten Kuyruk Listesini Çek
    function extractQueue() {
        const items = [];
        const queueElements = document.querySelectorAll('ytmusic-player-queue-item');
        queueElements.forEach((el, index) => {
            const titleEl = el.querySelector('.song-title, .title');
            const artistEl = el.querySelector('.byline');
            const durEl = el.querySelector('.duration');
            if (titleEl && titleEl.textContent.trim()) {
                items.push({
                    index,
                    title: titleEl.textContent.trim(),
                    artist: artistEl ? artistEl.textContent.trim() : '',
                    duration: durEl ? durEl.textContent.trim() : '',
                    isRecommendation: false
                });
            }
        });
        return items;
    }

    // Durumu PC Core'a Düzenli Bildir
    setInterval(() => {
        const video = document.querySelector('video');
        const titleEl = document.querySelector('ytmusic-player-bar .title');
        const artistEl = document.querySelector('ytmusic-player-bar .byline');
        const artEl = document.querySelector('ytmusic-player-bar .image');

        if (!video || !titleEl) return;

        const currentTitle = titleEl.textContent.trim();
        const currentArtist = artistEl ? artistEl.textContent.trim() : '';

        // Video ID bul
        const urlParams = new URLSearchParams(window.location.search);
        const videoId = urlParams.get('v') || '';

        // Yüksek çözünürlüklü kapak adresi oluştur
        let artwork = artEl ? artEl.src : '';
        if (artwork) {
            artwork = artwork
                .replace(/=w\d+-h\d+[^=]*/, '=w600-h600-l90-rj')
                .replace(/=s\d+[^=]*/, '=s800');
        }

        const queue = extractQueue();

        const payload = {
            title: currentTitle,
            artist: currentArtist,
            videoId: videoId,
            isPlaying: !video.paused,
            currentTime: Math.floor(video.currentTime),
            duration: Math.floor(video.duration || 0),
            volume: Math.round(video.volume * 100),
            artwork: artwork,
            queue: queue.length > 0 ? queue : undefined
        };

        fetch(CORE_HTTP_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).catch(() => {});
    }, 1000);
})();
