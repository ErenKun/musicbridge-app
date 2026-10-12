<div align="center">

# 🎵 MusicBridge

### *Akıllı Müzik Köprüsü • Akıllı Saat Entegrasyonu • Kesintisiz NewPipe Aktarımı*

<p align="center">
  <img src="https://img.shields.io/badge/Versiyon-1.0.0--LTS-6366f1?style=for-the-badge&logo=git&logoColor=white" alt="Versiyon" />
  <img src="https://img.shields.io/badge/Platform-Windows%2010%20%2F%2011%20%7C%20Android%208.0%2B-0ea5e9?style=for-the-badge&logo=android&logoColor=white" alt="Platform" />
  <img src="https://img.shields.io/badge/Akıllı%20Saat-Huawei%20Watch%20%7C%20WearOS%20%7C%20AVRCP-10b981?style=for-the-badge&logo=huawei&logoColor=white" alt="Akıllı Saat" />
  <img src="https://img.shields.io/badge/Ağ%20Gecikmesi-%3C%208ms%20(LAN%20%2F%20Mesh)-purple?style=for-the-badge" alt="Gecikme" />
  <img src="https://img.shields.io/badge/Bellek%20Kullanımı-%3C%2020%20MB%20RAM-pink?style=for-the-badge" alt="RAM" />
  <a href="https://linktr.ee/erennkun" target="_blank"><img src="https://img.shields.io/badge/Geliştirici-Eren%20Teknoloji-43e55e?style=for-the-badge&logo=linktree&logoColor=white" alt="Eren Teknoloji Linktree" /></a>
</p>
  <b>Masaüstü bilgisayarınızda çalan YouTube Music ve web ortam seslerini akıllı telefonunuzdan ve akıllı saatinizden sıfır gecikmeyle yönetin; masadan kalktığınızda tek tıkla NewPipe üzerinden kaldığı saniyeden dinlemeye devam edin.</b>
</p>

<p align="center">
  <img src="MusicBridge-Afis.png" alt="MusicBridge Tanıtım Afişi" style="max-width: 100%; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.6);" />
</p>

---

</div>

## 💡 Genel Bakış

**MusicBridge**, masaüstü müzik deneyimi ile mobil ekosistem arasındaki kopukluğu ortadan kaldıran yeni nesil bir medya köprüsüdür.

Geleneksel uzaktan kumanda araçlarının aksine, **saatinize harici hiçbir uygulama veya mod yüklemenize gerek kalmaz.** Android'in yerel `MediaSession` mimarisini kullanarak telefonunuzun kilit ekranını ve akıllı saatinizin (Huawei Watch Fit serisi, GT serisi, WearOS veya standart Bluetooth kulaklıklar) yerleşik medya denetleyicisini doğrudan PC'ye bağlar.

```
┌─────────────────────────────────┐           Yerel Wi-Fi / Tailscale Mesh          ┌──────────────────────────────────┐
│         🖥️ WINDOWS PC           │ ◄─────────────────────────────────────────────► │       📱 ANDROID TELEFON         │
│  • YouTube Music / Web Player   │            Çift Yönlü WebSocket                 │  • MusicBridge Micro-Shell       │
│  • PC-Core Sunucusu (:8765)     │                 (< 8ms)                         │  • Virtual MediaSession Engine   │
└─────────────────────────────────┘                                                 └────────────────┬─────────────────┘
                                                                                                     │ 
                                                                    ┌────────────────────────────────┴────────────────┐
                                                                    │ Bluetooth                                       │ Android Intent
                                                                    ▼                                                 ▼
                                                     ┌──────────────────────────────┐                  ┌──────────────────────────────┐
                                                     │    ⌚ AKILLI SAAT            │                  │    🎧 NEWPIPE OYNATICI       │
                                                     │ • Huawei Watch Fit / GT      │                  │ • PC'deki saniyeden başlar   │
                                                     │ • Yerleşik Müzik Denetimi    │                  │ • Sıfır kayıp, anında devam  │
                                                     └──────────────────────────────┘                  └──────────────────────────────┘
```

---

## ✨ Öne Çıkan Özellikler

* ⌚ **Sıfır Kurulumlu Saat Kontrolü:** Saatinize APK/Widget kurmadan; Play, Pause, Sonraki Parça ve PC Sistem Sesini doğrudan bileğinizden yönetin.
* 🔄 **NewPipe Anında Devam:** Bilgisayar başından ayrılırken tek tıkla şarkıyı telefonunuzdaki NewPipe uygulamasında **kaldığı saniyeden** (örn: `02:18`) kulaklığınızda başlatın.
* 🌐 **Tailscale & Uzaktan Erişim:** Sadece ev Wi-Fi ağında değil; Tailscale Mesh entegrasyonu sayesinde mobil veride (4.5G) sokaktayken dahi bilgisayarınızdaki müziği yönetin.
* 🪶 **Ultra Hafif Mimari:** Ağır arayüz motorları barındırmaz. Arka planda yalnızca **~15 MB RAM** tüketir; pili sömürmez, eski ve yeni tüm Android cihazlarda (Android 8.0 - 15+) yağ gibi akar.
* 📋 **Canlı Kuyruk Senkronizasyonu:** Bilgisayardaki çalma listesini telefonunuzda anlık listeleyin ve istediğiniz parçaya tek dokunuşla atlayın.
* 📲 **Kablosuz Tek Tıkla Kurulum:** Telefondan doğrudan PC'nin yerel adresine girerek APK'yı saniyeler içinde kablosuz indirin.

---

## ⚡ Karşılaştırma Tablosu

| Özellik | Klasik Uzaktan Kumandalar | KDE Connect / Unified | 🎵 MusicBridge |
|:---|:---:|:---:|:---:|
| **Saate Ek Uygulama Gerekir Mi?** | Evet | Evet | ❌ **Gerekmez (Yerel Destek)** |
| **NewPipe'a Saniyesinden Aktarma** | ❌ Yok | ❌ Yok | ✅ **Tek Tıkla Doğrudan** |
| **RAM Tüketimi** | ~60-120 MB | ~50-80 MB | 🚀 **~15 MB (Ultra Hafif)** |
| **Tailscale / Ev Dışı Erişim** | Karmaşık Port Ayarı | Kısıtlı | 🌐 **Doğal Destek** |
| **Arka Planda Kapanma Riski** | Yüksek | Orta | 🛡️ **Sıfır (Foreground Service)** |

---

## 🚀 Hızlı Başlatma ve Kullanım Seçenekleri

### 1. Bilgisayarda Başlatma (Windows)
`PC-Core` klasöründe ihtiyacınıza göre 3 farklı çalıştırma seçeneği mevcuttur:

* **Sessiz Arka Plan (Sıfır Açık Pencere):**
  * **`MusicBridge-ArkaPlanda-Baslat.vbs`** dosyasına çift tıklayın. Hiçbir konsol veya siyah pencere açılmadan doğrudan arka planda gizlice çalışır.
* **Windows Başlangıçta Otomatik Başlatma:**
  * **`Baslangicta-Calistir-Kur.bat`** dosyasına çift tıklayın veya Web Arayüzündeki "Windows Başlangıçta Çalıştır" anahtarını açın. PC her açıldığında arka planda otomatik başlar.
* **Bildirim Alanı (System Tray):**
  * **`MusicBridge-Tray.vbs`** dosyasına çift tıklayın. Görev çubuğunun sağ altındaki sistem tepsisinde simge belirir; sağ tıklayarak web arayüzünü açabilir, IP kopyalayabilir ve sunucuyu kapatabilirsiniz.
* **Geliştirici Konsolu (Canlı Loglar):**
  * **`start.bat`** ile canlı konsol çıktısıyla başlatabilirsiniz.
* **Durdurmak İçin:**
  * **`MusicBridge-Durdur.bat`** dosyasını çalıştırarak tüm arka plan süreçlerini anında kapatabilirsiniz.

### 2. Telefonda Kullanım

1. Telefonunuzun tarayıcısından veya **MusicBridge Android** uygulamasından PC'nin adresine bağlanın (`http://192.168.1.x:8765` veya Tailscale `100.x.x.x:8765`).
2. **Bağlantı sekmesinden** Wi-Fi ve Tailscale arasında tek dokunuşla geçiş yapabilir, IP adresini doğrudan arayüzden güncelleyebilirsiniz.
3. Masadan kalktığınızda **"Telefonda Aç"** butonuna dokunarak NewPipe ile kaldığı saniyeden dinlemeye devam edin.

---

## ⌚ Akıllı Saat ile Kullanım

1. Telefonunuzda uygulamayı başlatıp PC'ye bağlayın.
2. Telefonunuzun ekranını kapatıp cebinize koyun.
3. Akıllı saatinizdeki (Huawei Watch Fit / GT vb.) yerleşik **Müzik** widget'ını açın:
   * Şarkı adı ve sanatçı saat ekranında anlık görünür.
   * Play / Pause / Sonraki Parça kontrolleri milisaniyeler içinde PC'yi tetikler.
   * Saatin ses tuşları PC'nin sistem sesini açıp kısar.

---

## 📱 Uygulama Ekran Görüntüleri

<div align="center">

| Mobil Oynatıcı | Huawei Saat Senkronu | Canlı Kuyruk | NewPipe Aktarımı |
|:---:|:---:|:---:|:---:|
| <img src="MusicBridge-Player-Screenshot.png" width="220" style="border-radius:14px;" /> | <img src="MusicBridge-Watch-Screenshot.png" width="220" style="border-radius:14px;" /> | <img src="MusicBridge-Queue-Screenshot.png" width="220" style="border-radius:14px;" /> | <img src="MusicBridge-NewPipe-Screenshot.png" width="220" style="border-radius:14px;" /> |

</div>

---

## 🔒 Güvenlik & Gizlilik

* **Tamamen Yerel:** Verileriniz hiçbir üçüncü taraf bulut sunucusuna aktarılmaz; yalnızca kendi ev ağınızda veya güvenli Tailscale tünelinizde dolaşır.
* **Gereksiz İzin Yok:** Konum, kamera, rehber gibi hassas izinler kesinlikle talep edilmez.

---

## 🔗 İletişim & Ekosistem

<div align="center">

<a href="https://linktr.ee/erennkun" target="_blank">
  <img src="https://img.shields.io/badge/Linktree-Eren%20Teknoloji-43e55e?style=for-the-badge&logo=linktree&logoColor=white" alt="Linktree" />
</a>
<a href="https://github.com/ErenKun" target="_blank">
  <img src="https://img.shields.io/badge/GitHub-ErenKun-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub" />
</a>

<br/><br/>

Geliştirici: [**Eren Teknoloji**](https://linktr.ee/erennkun) • Açık Kaynaklı Özgür Yazılım © 2026

</div>
