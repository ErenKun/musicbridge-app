const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
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
  volume: 75,
  videoId: '',
  queue: []
};

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

// HTTP Sunucusu (Statik dosyalar + API)
const server = http.createServer((req, res) => {
  // CORS başlıkları
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
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'online',
      media: currentState,
      network: getNetworkIps()
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
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
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
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Statik Dosyalar (public klasörü)
  let filePath = path.join(__dirname, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  };

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Bulunamadı');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Sunucu Hatası: ' + err.code);
      }
    } else {
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(content, 'utf-8');
    }
  });
});

// WebSocket Sunucusu
const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  // İlk bağlantıda mevcut durumu gönder
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

// Tüm bağlı istemcilere durum yayını (Broadcast)
function broadcast(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// Komut yürütme (th-ch API veya dahili işleyici)
async function executeMediaCommand(action, data) {
  // 1. Önce th-ch API'sini dene
  try {
    let commandBody = {};
    if (action === 'playPause') commandBody = { command: 'playPause' };
    else if (action === 'play') commandBody = { command: 'play' };
    else if (action === 'pause') commandBody = { command: 'pause' };
    else if (action === 'next') commandBody = { command: 'next' };
    else if (action === 'previous') commandBody = { command: 'previous' };
    else if (action === 'setVolume') commandBody = { command: 'setVolume', data: Number(data) };
    else if (action === 'seekTo') commandBody = { command: 'seekTo', data: Number(data) };

    const response = await fetch(`${TH_CH_URL}/api/v1/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(commandBody)
    });

    if (response.ok) {
      return;
    }
  } catch (err) {
    // th-ch açık değilse veya hata verdiyse sessiz kal
  }

  // 2. Tarayıcı Userscript'ine yayınla
  broadcast({ type: 'browser-command', action, data });
}

// th-ch/youtube-music API'sini periyodik yokla (Polling)
async function pollThChApi() {
  try {
    const songRes = await fetch(`${TH_CH_URL}/api/v1/song`);
    if (songRes.ok) {
      const song = await songRes.json();
      
      const isChanged = currentState.title !== song.title || 
                        currentState.artist !== song.artist ||
                        currentState.isPlaying !== !song.isPaused;

      currentState.title = song.title || 'Bilinmiyor';
      currentState.artist = song.artist || 'YouTube Music';
      currentState.album = song.album || '';
      currentState.artwork = song.imageSrc || '';
      currentState.duration = song.songDuration || 0;
      currentState.currentTime = song.elapsedSeconds || 0;
      currentState.isPlaying = !song.isPaused;
      currentState.videoId = song.videoId || '';

      if (isChanged) {
        broadcast({ type: 'track-change', data: currentState });
      }
    }

    // Sıradakileri çek
    const queueRes = await fetch(`${TH_CH_URL}/api/v1/queue-info`);
    if (queueRes.ok) {
      const queueData = await queueRes.json();
      if (Array.isArray(queueData.items)) {
        currentState.queue = queueData.items.map(item => ({
          title: item.title,
          artist: item.author || item.artist,
          videoId: item.videoId,
          duration: item.duration
        }));
      }
    }
  } catch (err) {
    // th-ch henüz açık değilse polling sessizce devam eder
  }
}

// Tarayıcı eklentisinden durum güncellemesi
function updateStateFromBrowser(data) {
  currentState = { ...currentState, ...data };
  broadcast({ type: 'track-change', data: currentState });
}

// 1 saniyede bir kontrol et
setInterval(pollThChApi, config.youtube_music.poll_interval_ms || 1000);

// Sunucuyu başlat
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
  console.log(`💻 YouTube Music API Hedefi    : ${TH_CH_URL}`);
  console.log('=============================================================\n');
});
