// ==UserScript==
// @name         MusicBridge - Web Player Entegrasyonu
// @namespace    https://eren.tech/
// @version      1.0.0
// @description  Tarayıcıda çalan YouTube Music'i MusicBridge PC Core ile bağlar.
// @author       Eren Teknoloji
// @match        https://music.youtube.com/*
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';
    const CORE_URL = 'http://localhost:8765/api/browser-update';
    let lastTrack = '';

    setInterval(() => {
        const video = document.querySelector('video');
        const titleEl = document.querySelector('ytmusic-player-bar .title');
        const artistEl = document.querySelector('ytmusic-player-bar .byline');
        const artEl = document.querySelector('ytmusic-player-bar .image');

        if (!video || !titleEl) return;

        const currentTitle = titleEl.textContent.trim();
        const currentArtist = artistEl ? artistEl.textContent.trim() : '';

        // Durumu PC Core'a bildir
        fetch(CORE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: currentTitle,
                artist: currentArtist,
                isPlaying: !video.paused,
                currentTime: Math.floor(video.currentTime),
                duration: Math.floor(video.duration || 0),
                volume: Math.round(video.volume * 100),
                artwork: artEl ? artEl.src : ''
            })
        }).catch(() => {});
    }, 1000);
})();
