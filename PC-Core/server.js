const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
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

async function resolveHighResTrackInfo(title, artist) {
  if (!title || title === 'Müzik Bekleniyor...' || title === 'Bilinmiyor') return;
  const trackKey = `${title}|${artist}`;
  if (trackKey === lastResolvedTrack) return;
  lastResolvedTrack = trackKey;

  // Başlıktan parantez içi ekleri temizle (Örn: "Song Title (Official Video)" -> "Song Title")
  const cleanTitle = title.replace(/\(.*?\)|\[.*?\]/g, '').trim();
  const cleanArtist = (artist && artist !== 'YouTube Music' && artist !== 'Spotify') ? artist.trim() : '';
  const query = `${cleanTitle} ${cleanArtist}`.trim();

  let resolvedArtwork = null;
  let resolvedVideoId = null;

  // 1. iTunes Search API (Müzik albümleri için ultra kaliteli 600x600 kapak)
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

  // 2. YouTube Video ID Çözümleme (Telefonda doğrudan açabilsin ve YouTube kapağı)
  try {
    const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const ytRes = await fetch(ytUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(3500)
    });
    if (ytRes.ok) {
      const html = await ytRes.text();
      const match = html.match(/\/watch\?v=([a-zA-Z0-9_-]{11})/);
      if (match && match[1]) {
        resolvedVideoId = match[1];
        if (!resolvedArtwork) {
          resolvedArtwork = `https://i.ytimg.com/vi/${resolvedVideoId}/hqdefault.jpg`;
        }
      }
    }
  } catch (e) {}

  // Eğer parça hala değişmediyse bilgileri güncelle ve yayınla
  if (currentState.title === title && currentState.artist === artist) {
    let updated = false;
    if (resolvedArtwork) {
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

  // 3. Akıllı Kuyruk / Benzer Şarkılar (Kuyruk boşsa listeyi doldur)
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
            const trackChanged = currentState.title !== payload.title || currentState.artist !== payload.artist;
            const sessionsChanged = currentState.activeSessionIndex !== payload.activeSessionIndex ||
                                    currentState.totalSessions !== payload.totalSessions ||
                                    currentState.pinnedSource !== payload.pinnedSource ||
                                    currentState.sourceApp !== payload.sourceApp ||
                                    JSON.stringify(currentState.sessions) !== JSON.stringify(payload.sessions || []);

            const isChanged = trackChanged ||
                              sessionsChanged ||
                              currentState.isPlaying !== payload.isPlaying ||
                              currentState.volume !== payload.volume ||
                              currentState.currentTime !== payload.currentTime ||
                              currentState.duration !== payload.duration ||
                              (payload.artwork && currentState.artwork !== payload.artwork);

            currentState.title = payload.title || 'Müzik Bekleniyor...';
            currentState.artist = payload.artist || 'YouTube Music';
            currentState.album = payload.album || '';
            currentState.sourceApp = payload.sourceApp || 'Medya Oynatıcı';
            currentState.sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
            currentState.activeSessionIndex = typeof payload.activeSessionIndex === 'number' ? payload.activeSessionIndex : 0;
            currentState.totalSessions = typeof payload.totalSessions === 'number' ? payload.totalSessions : 0;
            currentState.pinnedSource = payload.pinnedSource || 'auto';
            
            // Eğer yeni parça geldiyse veya mevcut kapak boşsa GSMTC kapağını al
            if (payload.artwork && (!currentState.artwork || trackChanged)) {
              currentState.artwork = payload.artwork;
            }

            currentState.isPlaying = !!payload.isPlaying;
            currentState.currentTime = payload.currentTime || 0;
            currentState.duration = payload.duration || 0;
            if (typeof payload.volume === 'number') {
              currentState.volume = payload.volume;
            }

            // Yeni parça başladığında yüksek kaliteli görsel ve videoId çöz
            if (trackChanged && currentState.title !== 'Müzik Bekleniyor...') {
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
      startup: getStartupStatus()
    }));
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
});
