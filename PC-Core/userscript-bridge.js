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
            jumpToYtMusicQueueIndex(data);
        } else if (action === 'setNextTrackIndex') {
            pendingNextTrackData = data;
        }
    }

    let pendingNextTrackData = null;

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

        if (!queueItems || queueItems.length === 0) return;

        let target = null;
        if (targetTitle) {
            target = queueItems.find(el => {
                const root = el.shadowRoot || el;
                const tEl = el.querySelector('.song-title, .title') || root.querySelector('.title, .song-title');
                const txt = (tEl ? tEl.textContent : '').trim().toLowerCase();
                return txt && (txt === targetTitle || txt.includes(targetTitle) || targetTitle.includes(txt));
            });
        }

        if (!target && targetIdx >= 0 && targetIdx < queueItems.length) {
            target = queueItems[targetIdx];
        }

        if (!target) return;

        try { target.scrollIntoView({ block: 'nearest', behavior: 'instant' }); } catch (_) {}

        const opts = { bubbles: true, cancelable: true, view: window, buttons: 1, composed: true };
        const root = target.shadowRoot;
        const clickTargets = [
            root ? root.querySelector('.play-button') : null,
            root ? root.querySelector('.thumbnail-wrapper') : null,
            root ? root.querySelector('#layout') : null,
            root ? root.querySelector('.title, .song-title') : null,
            target.querySelector('ytmusic-play-button-renderer #button'),
            target.querySelector('ytmusic-play-button-renderer'),
            target.querySelector('.play-button'),
            target.querySelector('.song-title, .title'),
            target
        ].filter(Boolean);

        for (const el of clickTargets) {
            try {
                el.dispatchEvent(new MouseEvent('mouseover', opts));
                el.dispatchEvent(new MouseEvent('mousedown', opts));
                el.dispatchEvent(new MouseEvent('mouseup', opts));
                el.dispatchEvent(new MouseEvent('click', opts));
                if (typeof el.click === 'function') el.click();
            } catch (_) {}
        }

        try {
            target.dispatchEvent(new MouseEvent('dblclick', opts));
        } catch (_) {}
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
