const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const dgram = require('dgram');
const { spawn, execSync } = require('child_process');
const { WebSocketServer, WebSocket } = require('ws');

// Ayarları yükle
const configPath = path.join(__dirname, 'config.json');
let config = {
  server: { http_port: 8765, host: '0.0.0.0' },
  youtube_music: { th_ch_api_url: 'http://127.0.0.1:13091', poll_interval_ms: 1000 }
};

if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    console.error('config.json okunamadı, varsayılanlar kullanılıyor:', err.message);
  }
}

const PORT = config.server.http_port || 8765;
const TH_CH_URL = config.youtube_music.th_ch_api_url || 'http://127.0.0.1:13091';

// Aktif medya durumu
let currentState = {
  title: 'Müzik Bekleniyor...',
  artist: 'YouTube Music',
  album: '',
  artwork: '',
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 50,
  videoId: '',
  queue: [],
  sourceApp: 'YouTube Music',
  sessions: [],
  activeSessionIndex: 0,
  totalSessions: 1,
  pinnedSource: 'auto'
};

// Güvenlik PIN Kodu ve Yetkilendirme
let serverPin = (config.server && config.server.pin) ? String(config.server.pin) : String(Math.floor(1000 + Math.random() * 9000));
const authorizedTokens = new Set();

// Windows Başlangıç Kısayolu Yolu
const startupDir = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'
);
const startupShortcutPath = path.join(startupDir, 'MusicBridge.lnk');

function getStartupStatus() {
  try {
    return fs.existsSync(startupShortcutPath);
  } catch {
    return false;
  }
}

function setStartupStatus(enable) {
  try {
    if (!enable) {
      if (fs.existsSync(startupShortcutPath)) {
        fs.unlinkSync(startupShortcutPath);
      }
      return false;
    } else {
      const vbsPath = path.join(__dirname, 'MusicBridge-ArkaPlanda-Baslat.vbs');
      const escapedLnk = startupShortcutPath.replace(/'/g, "''");
      const escapedVbs = vbsPath.replace(/'/g, "''");
      const escapedDir = __dirname.replace(/'/g, "''");

      const psCmd = `powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('${escapedLnk}'); $s.TargetPath = '${escapedVbs}'; $s.WorkingDirectory = '${escapedDir}'; $s.WindowStyle = 7; $s.Save()"`;
      execSync(psCmd, { windowsHide: true });
      return true;
    }
  } catch (err) {
    console.error('Başlangıç ayarı değiştirilemedi:', err.message);
    return getStartupStatus();
  }
}

// Yerel IP ve Tailscale IP adreslerini tespit et
function getNetworkIps() {
  const interfaces = os.networkInterfaces();
  const addresses = { lan: [], tailscale: [] };

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        if (name.toLowerCase().includes('tailscale') || iface.address.startsWith('100.')) {
          addresses.tailscale.push(iface.address);
        } else {
          addresses.lan.push(iface.address);
        }
      }
    }
  }
  return addresses;
}

// -------------------------------------------------------------
// YÜKSEK ÇÖZÜNÜRLÜKLÜ KAPAK VE VIDEO ID ÇÖZÜCÜ (iTunes & YouTube)
// -------------------------------------------------------------
let lastResolvedTrack = '';

function fixEncoding(str) {
  if (!str || typeof str !== 'string') return str;
  if (str.includes('Ã¼') || str.includes('ÅŸ') || str.includes('Ä±') || str.includes('Ã§') || str.includes('Ã¶') || str.includes('ÄŸ')) {
    try {
      return Buffer.from(str, 'latin1').toString('utf8');
    } catch (_) {}
  }
  return str
    .replace(/MÃ¼zik/g, 'Müzik')
    .replace(/mÃ¼zik/g, 'müzik')
    .replace(/BoÅŸta/g, 'Boşta')
    .replace(/boÅŸta/g, 'boşta')
    .replace(/OynatÄ±cÄ±/g, 'Oynatıcı')
    .replace(/TarayÄ±cÄ±/g, 'Tarayıcı');
}

async function resolveHighResTrackInfo(title, artist) {
  if (!title || title.includes('Bekleniyor') || title.includes('Bilinmiyor') || title === 'Boşta') return;
  const trackKey = `${title}|${artist}`;
  if (trackKey === lastResolvedTrack) return;
  lastResolvedTrack = trackKey;

  // Başlıktan parantez içi ekleri ve "feat" kısımlarını temizle
  let cleanTitle = title.replace(/\(.*?\)|\[.*?\]/g, '').replace(/feat\..*/i, '').trim();
  let cleanArtist = (artist && !artist.includes('YouTube') && !artist.includes('Spotify')) ? artist.trim() : '';

  // Eğer başlık "Sanatçı - Şarkı" formatındaysa parçala
  if (cleanTitle.includes(' - ') && !cleanArtist) {
    const parts = cleanTitle.split(' - ');
    cleanArtist = parts[0].trim();
    cleanTitle = parts.slice(1).join(' - ').trim();
  }

  const query = `${cleanTitle} ${cleanArtist}`.trim();

  let resolvedArtwork = null;
  let resolvedVideoId = null;

  // 1. iTunes Search API (Müzik albümleri için kristal netliğinde 600x600 resmi kare kapak)
  try {
    const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=1`;
    const itunesRes = await fetch(itunesUrl, { signal: AbortSignal.timeout(3000) });
    if (itunesRes.ok) {
      const itunesData = await itunesRes.json();
      if (itunesData.results && itunesData.results.length > 0) {
        const item = itunesData.results[0];
        if (item.artworkUrl100) {
          resolvedArtwork = item.artworkUrl100.replace('100x100bb', '600x600bb');
        }
      }
    }
  } catch (e) {}

  // 2. Deezer API (iTunes bulamazsa alternatif resmi 1000x1000 kare kapak)
  if (!resolvedArtwork) {
    try {
      const dzUrl = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=1`;
      const dzRes = await fetch(dzUrl, { signal: AbortSignal.timeout(3000) });
      if (dzRes.ok) {
        const dzData = await dzRes.json();
        if (dzData.data && dzData.data.length > 0) {
          const item = dzData.data[0];
          resolvedArtwork = item.album?.cover_xl || item.album?.cover_big;
        }
      }
    } catch (e) {}
  }

  // 3. YouTube Search (Telefonda açmak için Video ID ve Doğrulanmış HD Görsel)
  try {
    const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const ytRes = await fetch(ytUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(3500)
    });
    if (ytRes.ok) {
      const html = await ytRes.text();
      const regex = /"videoRenderer":\{"videoId":"([a-zA-Z0-9_-]{11})",.*?"title":\{"runs":\[\{"text":"(.*?)"\}/;
      const match = regex.exec(html);
      if (match && match[1]) {
        const vid = match[1];
        const vTitle = match[2];
        resolvedVideoId = vid;

        // GÜVENLİK FİLTRESİ: Video başlığı aranan şarkı veya sanatçı sözcüklerini gerçekten içeriyor mu?
        // Bu sayede vlog, karşılaştırma vb. rastgele alakasız videoların kapakları ASLA çekilmez!
        const titleWords = cleanTitle.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const artistWords = cleanArtist.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const searchPool = [...titleWords, ...artistWords];
        const vTitleLower = vTitle.toLowerCase();
        const isLegitMatch = searchPool.length === 0 || searchPool.some(w => vTitleLower.includes(w));

        if (isLegitMatch && !resolvedArtwork) {
          // sddefault (640x480) yüksek çözünürlük desteğini test et
          try {
            const sdUrl = `https://i.ytimg.com/vi/${vid}/sddefault.jpg`;
            const checkRes = await fetch(sdUrl, { method: 'HEAD', signal: AbortSignal.timeout(2000) });
            if (checkRes.status === 200) {
              resolvedArtwork = sdUrl;
            } else {
              resolvedArtwork = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
            }
          } catch (_) {
            resolvedArtwork = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
          }
        }
      }
    }
  } catch (e) {}

  // Eğer parça hala aynıysa yüksek çözünürlüklü kapak ve videoId bilgilerini yayınla
  if (currentState.title === title && currentState.artist === artist) {
    let updated = false;
    if (resolvedArtwork && currentState.artwork !== resolvedArtwork) {
      currentState.artwork = resolvedArtwork;
      updated = true;
    }
    if (resolvedVideoId && currentState.videoId !== resolvedVideoId) {
      currentState.videoId = resolvedVideoId;
      updated = true;
    }
    if (updated) {
      broadcast({ type: 'track-change', data: currentState });
    }
  }

  // 4. Akıllı Kuyruk / Benzer Şarkılar (Kuyruk boşsa listeyi doldur)
  if (!currentState.queue || currentState.queue.length === 0 || currentState.queue[0]?.isRecommendation) {
    fetchRecommendedQueue(cleanTitle, cleanArtist);
  }
}

// Akıllı Kuyruk Önerileri (Kuyruk boş olduğunda şarkıya göre liste oluşturur)
async function fetchRecommendedQueue(title, artist) {
  try {
    const term = artist || title;
    if (!term) return;
    const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=15`;
    const res = await fetch(itunesUrl, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        const items = data.results
          .filter(r => r.trackName && r.trackName.toLowerCase() !== title.toLowerCase())
          .map(r => ({
            title: r.trackName,
            artist: r.artistName,
            duration: r.trackTimeMillis ? Math.floor(r.trackTimeMillis / 1000) : 0,
            isRecommendation: true
          }));

        if (items.length > 0 && (!currentState.queue || currentState.queue.length === 0 || currentState.queue[0]?.isRecommendation)) {
          currentState.queue = items;
          broadcast({ type: 'track-change', data: currentState });
        }
      }
    }
  } catch (e) {}
}

// -------------------------------------------------------------
// SENKRONİZE ŞARKI SÖZLERİ ÇÖZÜCÜ (LRCLIB API)
// -------------------------------------------------------------
const lyricsCache = new Map();

async function fetchLyrics(title, artist) {
  if (!title || title.includes('Bekleniyor') || title.includes('Bilinmiyor') || title === 'Boşta') return null;
  const cleanTitle = title.replace(/\(.*?\)|\[.*?\]/g, '').replace(/feat\..*/i, '').trim();
  const cleanArtist = (artist && !artist.includes('YouTube') && !artist.includes('Spotify')) ? artist.trim() : '';
  const cacheKey = `${cleanTitle}|${cleanArtist}`.toLowerCase();

  if (lyricsCache.has(cacheKey)) {
    return lyricsCache.get(cacheKey);
  }

  try {
    const query = new URLSearchParams({ track_name: cleanTitle });
    if (cleanArtist) query.append('artist_name', cleanArtist);
    const url = `https://lrclib.net/api/get?${query.toString()}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MusicBridge-Core/2.0 (Eren Teknoloji)' },
      signal: AbortSignal.timeout(3000)
    });
    if (res.ok) {
      const data = await res.json();
      const result = {
        title: data.trackName || cleanTitle,
        artist: data.artistName || cleanArtist,
        plainLyrics: data.plainLyrics || '',
        syncedLyrics: data.syncedLyrics || '',
        instrumental: !!data.instrumental
      };
      if (result.plainLyrics || result.syncedLyrics) {
        lyricsCache.set(cacheKey, result);
        return result;
      }
    }
  } catch (e) {}

  // 2. Fallback: Türkçe Müzik, Türkü ve Web Arama Motoru
  const trResult = await fetchTurkishAndWebLyrics(cleanTitle, cleanArtist);
  if (trResult) {
    lyricsCache.set(cacheKey, trResult);
    return trResult;
  }

  return null;
}

// Türkçe Şarkı ve Türkü Sözleri Çözücü
async function fetchTurkishAndWebLyrics(cleanTitle, cleanArtist) {
  try {
    const searchTerms = [
      `${cleanTitle} ${cleanArtist} sözleri`,
      `${cleanTitle} türkü sözleri`
    ];

    for (const term of searchTerms) {
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(term)}`;
      const res = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        signal: AbortSignal.timeout(3500)
      });
      if (res.ok) {
        const html = await res.text();
        const snippetMatch = html.match(/class="result__snippet[^>]*>([\s\S]*?)<\/a>/i);
        if (snippetMatch && snippetMatch[1]) {
          const rawSnippet = snippetMatch[1]
            .replace(/<[^>]+>/g, '')
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&#x27;/g, "'")
            .trim();

          if (rawSnippet.length > 40) {
            return {
              title: cleanTitle,
              artist: cleanArtist,
              plainLyrics: rawSnippet,
              syncedLyrics: '',
              instrumental: false
            };
          }
        }
      }
    }
  } catch (_) {}
  return null;
}

// -------------------------------------------------------------
// SIFIR-KONFİGÜRASYON UDP AĞ KEŞFİ (AUTO-DISCOVERY ENGINE)
// -------------------------------------------------------------
const DISCOVERY_PORT = 8766;
function startUdpDiscoveryServer() {
  try {
    const udpServer = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    udpServer.on('error', err => {
      // Port kullanımda olabilir veya izin kısıtı, sessizce geç
    });

    udpServer.on('message', (msg, rinfo) => {
      const text = msg.toString('utf8').trim();
      if (text.startsWith('MUSICBRIDGE_DISCOVERY_PING')) {
        const hostName = os.hostname();
        const responseMsg = `MUSICBRIDGE_DISCOVERY_PONG|${PORT}|${hostName}`;
        udpServer.send(responseMsg, rinfo.port, rinfo.address, () => {});
      }
    });

    udpServer.bind(DISCOVERY_PORT, '0.0.0.0', () => {
      try { udpServer.setBroadcast(true); } catch (_) {}
      console.log(`📡 Otomatik Cihaz Keşif Motoru (UDP Discovery :${DISCOVERY_PORT}) Devrede!`);
    });
  } catch (err) {}
}

// -------------------------------------------------------------
// YEREL WINDOWS MEDYA VE SES KÖPRÜSÜ (GSMTC & CoreAudio)
// -------------------------------------------------------------
let psProcess = null;

function startWindowsMediaBridge() {
  const psScriptPath = path.join(__dirname, 'windows-media-bridge.ps1');
  if (!fs.existsSync(psScriptPath)) {
    console.warn('[WindowsMediaBridge] Script bulunamadı:', psScriptPath);
    return;
  }

  try {
    psProcess = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', psScriptPath
    ], {
      stdio: ['pipe', 'pipe', 'inherit'],
      windowsHide: true
    });

    let buffer = '';
    psProcess.stdout.on('data', chunk => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('{')) continue;
        try {
          const payload = JSON.parse(trimmed);
          if (payload.type === 'media') {
            const cleanTitle = fixEncoding(payload.title || '').trim();
            const cleanArtist = fixEncoding(payload.artist || '').trim();
            const cleanSourceApp = fixEncoding(payload.sourceApp || '').trim();
            const isWaiting = !cleanTitle || cleanTitle.includes('Bekleniyor') || cleanTitle === 'Bilinmiyor' || cleanSourceApp === 'Boşta';

            const normalizedTitle = isWaiting ? 'Müzik Bekleniyor...' : cleanTitle;
            const normalizedArtist = isWaiting ? 'YouTube Music / Spotify' : (cleanArtist || 'YouTube Music');

            const trackChanged = currentState.title !== normalizedTitle || currentState.artist !== normalizedArtist;
            const sessionsChanged = currentState.activeSessionIndex !== payload.activeSessionIndex ||
                                    currentState.totalSessions !== payload.totalSessions ||
                                    currentState.pinnedSource !== payload.pinnedSource ||
                                    currentState.sourceApp !== cleanSourceApp ||
                                    JSON.stringify(currentState.sessions) !== JSON.stringify(payload.sessions || []);

            const isChanged = trackChanged ||
                              sessionsChanged ||
                              currentState.isPlaying !== payload.isPlaying ||
                              currentState.volume !== payload.volume ||
                              currentState.currentTime !== payload.currentTime ||
                              currentState.duration !== payload.duration ||
                              (payload.artwork && currentState.artwork !== payload.artwork);

            currentState.title = normalizedTitle;
            currentState.artist = normalizedArtist;
            currentState.album = fixEncoding(payload.album || '');
            currentState.sourceApp = isWaiting ? 'Boşta' : (cleanSourceApp || 'Medya Oynatıcı');
            currentState.sessions = Array.isArray(payload.sessions) ? payload.sessions.map(s => ({
              ...s,
              title: fixEncoding(s.title),
              artist: fixEncoding(s.artist),
              app: fixEncoding(s.app)
            })) : [];
            currentState.activeSessionIndex = typeof payload.activeSessionIndex === 'number' ? payload.activeSessionIndex : 0;
            currentState.totalSessions = typeof payload.totalSessions === 'number' ? payload.totalSessions : 0;
            currentState.pinnedSource = payload.pinnedSource || 'auto';
            
            if (isWaiting) {
              // Müzik çalmıyorken / boşta iken eski görseli veya rastgele kapağı kesinlikle temizle
              currentState.artwork = '';
              currentState.videoId = '';
              currentState.currentTime = 0;
              currentState.duration = 0;
              lastResolvedTrack = '';
            } else {
              if (trackChanged) {
                // Yeni parça başladığında ilk başta GSMTC kapağını göster (varsa)
                currentState.artwork = payload.artwork || '';
              } else if (!currentState.artwork && payload.artwork) {
                // Henüz hiçbir kapak yoksa GSMTC kapağını al
                currentState.artwork = payload.artwork;
              }
              // Eğer resolveHighResTrackInfo tarafından HD kapak atandıysa, GSMTC'nin düşük çözünürlüklü kapağı HD kapağı ezmez!
            }

            currentState.isPlaying = isWaiting ? false : !!payload.isPlaying;
            currentState.currentTime = isWaiting ? 0 : (payload.currentTime || 0);
            currentState.duration = isWaiting ? 0 : (payload.duration || 0);
            if (typeof payload.volume === 'number') {
              currentState.volume = payload.volume;
            }

            // Çalan parça henüz HD çözülmediyse videoId ve HD albüm kapağını getir
            if (!isWaiting && lastResolvedTrack !== `${currentState.title}|${currentState.artist}`) {
              resolveHighResTrackInfo(currentState.title, currentState.artist);
            }

            if (isChanged) {
              broadcast({ type: 'track-change', data: currentState });
            }
          }
        } catch (e) {}
      }
    });

    psProcess.on('exit', code => {
      console.log(`[WindowsMediaBridge] Köprü kapandı (kod: ${code}), yeniden başlatılıyor...`);
      setTimeout(startWindowsMediaBridge, 2000);
    });

    console.log('✅ Yerel Windows Medya & Sistem Sesi Köprüsü (GSMTC & CoreAudio) devrede!');
  } catch (err) {
    console.error('Windows Medya Köprüsü başlatılamadı:', err.message);
  }
}

// Uygulama kapanırken arka plan powershell sürecini temizle
process.on('exit', () => {
  if (psProcess) {
    try { psProcess.kill(); } catch (e) {}
  }
});

// HTTP Sunucusu (Statik dosyalar + API)
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // API Uç Noktaları
  if (url.pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      status: 'online',
      media: currentState,
      network: getNetworkIps(),
      startup: getStartupStatus(),
      pin: serverPin
    }));
    return;
  }

  // PIN Eşleştirme & Doğrulama
  if (url.pathname === '/api/auth/verify' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { pin } = JSON.parse(body);
        if (String(pin).trim() === serverPin) {
          const token = 'mb_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
          authorizedTokens.add(token);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: true, token }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: 'Hatalı PIN kodu!' }));
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Windows Başlangıç Durumu & Ayarı
  if (url.pathname === '/api/system/startup') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { enable } = JSON.parse(body);
          const current = setStartupStatus(!!enable);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: true, enabled: current }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ enabled: getStartupStatus() }));
      return;
    }
  }

  // Sunucuyu Güvenli Kapat
  if (url.pathname === '/api/system/shutdown' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, message: 'Sunucu kapatılıyor...' }));
    setTimeout(() => {
      process.exit(0);
    }, 500);
    return;
  }

  // Albüm Kapağı Akışı (Base64 yerine doğrudan Binary HTTP Servisi)
  if (url.pathname === '/api/artwork') {
    if (currentState.artwork && currentState.artwork.startsWith('data:image/')) {
      try {
        const matches = currentState.artwork.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          const mimeType = matches[1];
          const buffer = Buffer.from(matches[2], 'base64');
          res.writeHead(200, {
            'Content-Type': mimeType,
            'Content-Length': buffer.length,
            'Cache-Control': 'no-cache, max-age=0'
          });
          res.end(buffer);
          return;
        }
      } catch (_) {}
    } else if (currentState.artwork && currentState.artwork.startsWith('http')) {
      res.writeHead(302, { 'Location': currentState.artwork });
      res.end();
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Kapak görseli yok');
    return;
  }

  // Senkronize Şarkı Sözleri (LRCLIB API)
  if (url.pathname === '/api/lyrics') {
    const title = url.searchParams.get('title') || currentState.title;
    const artist = url.searchParams.get('artist') || currentState.artist;
    fetchLyrics(title, artist)
      .then(lyrics => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: true,
          lyrics: lyrics || { plainLyrics: 'Şarkı sözü bulunamadı.', syncedLyrics: '' }
        }));
      })
      .catch(err => {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }

  // Sıfır-Konfigürasyon Keşif Bilgisi
  if (url.pathname === '/api/discovery') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      service: 'musicbridge',
      version: '2.0.0',
      port: PORT,
      hostname: os.hostname(),
      ips: getNetworkIps()
    }));
    return;
  }

  if (url.pathname === '/api/control' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const cmd = JSON.parse(body);
        await executeMediaCommand(cmd.action, cmd.data);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Tarayıcı eklentisinden (Userscript) gelen durum güncellemesi
  if (url.pathname === '/api/browser-update' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        updateStateFromBrowser(data);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Statik Dosyalar (public klasörü)
  let filePath = path.join(__dirname, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  };

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Bulunamadı');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Sunucu Hatası: ' + err.code);
      }
    } else {
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(content);
    }
  });
});

// WebSocket Sunucusu
const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'sync', data: currentState }));

  ws.on('message', async message => {
    try {
      const msg = JSON.parse(message);
      if (msg.action === 'sync') {
        ws.send(JSON.stringify({ type: 'sync', data: currentState }));
        return;
      }
      if (msg.action === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }
      if (msg.action === 'browser-update') {
        updateStateFromBrowser(msg.data);
        return;
      }
      if (msg.action) {
        await executeMediaCommand(msg.action, msg.data);
      }
    } catch (err) {
      console.error('WebSocket komut hatası:', err.message);
    }
  });
});

// Tüm bağlı istemcilere durum yayını
function broadcast(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// Komut yürütme (Windows GSMTC + Master Ses + th-ch API + Userscript)
async function executeMediaCommand(action, data) {
  // 1. Yerel Windows Medya & Master Ses Köprüsü
  if (psProcess && psProcess.stdin && psProcess.stdin.writable) {
    try {
      psProcess.stdin.write(JSON.stringify({ action, data }) + '\n');
    } catch (e) {
      console.error('Windows köprüsüne komut iletilemedi:', e.message);
    }
  }

  // Ses komutu geldiyse hemen currentState.volume'u güncelle ve anında yay
  if (action === 'setVolume') {
    currentState.volume = Math.round(Number(data));
    broadcast({ type: 'track-change', data: currentState });
  }

  // Konum değiştirme komutu geldiyse anında yansıt
  if (action === 'seekTo') {
    currentState.currentTime = Math.floor(Number(data));
    broadcast({ type: 'track-change', data: currentState });
  }

  // Kaynak sabitleme ve oturum seçme komutlarını anında yansıt
  if (action === 'pinSource') {
    currentState.pinnedSource = String(data);
    broadcast({ type: 'track-change', data: currentState });
  }

  if (action === 'selectSession') {
    if (data === 'auto') {
      currentState.pinnedSource = 'auto';
    } else {
      currentState.pinnedSource = 'manual';
      currentState.activeSessionIndex = Number(data);
    }
    broadcast({ type: 'track-change', data: currentState });
  }

  // 2. Açık kaynak th-ch API'sini dene (kurulu ve açıksa)
  try {
    let commandBody = {};
    if (action === 'playPause') commandBody = { command: 'playPause' };
    else if (action === 'play') commandBody = { command: 'play' };
    else if (action === 'pause') commandBody = { command: 'pause' };
    else if (action === 'next') commandBody = { command: 'next' };
    else if (action === 'previous') commandBody = { command: 'previous' };
    else if (action === 'setVolume') commandBody = { command: 'setVolume', data: Number(data) };
    else if (action === 'seekTo') commandBody = { command: 'seekTo', data: Number(data) };

    fetch(`${TH_CH_URL}/api/v1/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(commandBody)
    }).catch(() => {});
  } catch (err) {}

  // 3. Tarayıcı Userscript'ine yayınla (bağlıysa doğrudan web player'ı tetikler)
  broadcast({ type: 'browser-command', action, data });
}

// th-ch/youtube-music API'sini periyodik yokla
async function pollThChApi() {
  try {
    const queueRes = await fetch(`${TH_CH_URL}/api/v1/queue-info`);
    if (queueRes.ok) {
      const queueData = await queueRes.json();
      if (Array.isArray(queueData.items) && queueData.items.length > 0) {
        currentState.queue = queueData.items.map(item => ({
          title: item.title,
          artist: item.author || item.artist,
          videoId: item.videoId,
          duration: item.duration,
          isRecommendation: false
        }));
      }
    }
  } catch (err) {}
}

// Tarayıcı eklentisinden durum güncellemesi
function updateStateFromBrowser(data) {
  if (data.artwork) {
    // Küçük boyutlu kapak parametrelerini yüksek çözünürlüğe çevir
    data.artwork = data.artwork
      .replace(/=w\d+-h\d+[^=]*/, '=w600-h600-l90-rj')
      .replace(/=s\d+[^=]*/, '=s800');
  }

  currentState = { ...currentState, ...data };
  broadcast({ type: 'track-change', data: currentState });
}

// 2 saniyede bir masaüstü th-ch kuyruk kontrolü
setInterval(pollThChApi, 2000);

// Sunucuyu başlat ve Windows Medya Köprüsünü ayağa kaldır
server.listen(PORT, '0.0.0.0', () => {
  const ips = getNetworkIps();
  console.log('\n=============================================================');
  console.log('🎵 MusicBridge PC Core - Eren Teknoloji Aktif!');
  console.log('=============================================================');
  console.log(`📡 Yerel Ağ (Ev Wi-Fi) Adresi : http://${ips.lan[0] || 'localhost'}:${PORT}`);
  if (ips.tailscale.length > 0) {
    console.log(`🌐 Tailscale (Her Yerden) Adresi: http://${ips.tailscale[0]}:${PORT}`);
  } else {
    console.log('🌐 Tailscale IP tespit edilmedi (Aktif olduğunda otomatik tanınır)');
  }
  console.log(`💻 Windows Başlangıç Durumu   : ${getStartupStatus() ? 'Açık (Otomatik Başlatılıyor)' : 'Kapalı'}`);
  console.log(`💻 Yerel Windows Medya Desteği : Aktif (Sıfır Eklenti & Tam Otomatik)`);
  console.log('=============================================================\n');

  // Windows yerel medya köprüsünü başlat
  startWindowsMediaBridge();

  // Sıfır-konfigürasyon otomatik cihaz keşfini başlat (UDP port 8766)
  startUdpDiscoveryServer();
});
