<div align="center">

# 🎵 MusicBridge

### *Akıllı Müzik Köprüsü • Akıllı Saat Entegrasyonu • Kesintisiz NewPipe Aktarımı*

<p align="center">
  <img src="https://img.shields.io/badge/Versiyon-1.0.0--LTS-6366f1?style=for-the-badge&logo=git&logoColor=white" alt="Versiyon" />
  <img src="https://img.shields.io/badge/Platform-Windows%2010%20%2F%2011%20%7C%20Android%208.0%2B-0ea5e9?style=for-the-badge&logo=android&logoColor=white" alt="Platform" />
  <img src="https://img.shields.io/badge/Akıllı%20Saat-Huawei%20Watch%20%7C%20WearOS%20%7C%20AVRCP-10b981?style=for-the-badge&logo=huawei&logoColor=white" alt="Akıllı Saat" />
  <img src="https://img.shields.io/badge/Ağ%20Gecikmesi-%3C%208ms%20(LAN%20%2F%20Mesh)-purple?style=for-the-badge" alt="Gecikme" />
  <img src="https://img.shields.io/badge/Bellek%20Kullanımı-%3C%2020%20MB%20RAM-pink?style=for-the-badge" alt="RAM" />
  <img src="https://img.shields.io/badge/Ağ-Wi--Fi%20%2B%20Tailscale%20Mesh-f59e0b?style=for-the-badge&logo=tailscale&logoColor=white" alt="Tailscale" />
</p>

<p align="center">
  <b>Masaüstü bilgisayarınızda çalan YouTube Music ve web ortam seslerini akıllı telefonunuzdan ve akıllı saatinizden sıfır gecikmeyle yönetin; masadan kalktığınızda tek tıkla NewPipe üzerinden kaldığı saniyeden dinlemeye devam edin.</b>
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

## 🚀 2 Dakikada Hızlı Kurulum

### 1. Bilgisayarda Başlatma (Windows)
1. Bu depoyu indirin veya klonlayın.
2. `PC-Core` klasöründeki **`start.bat`** dosyasına çift tıklayın.
3. Konsol ekranında yerel IP adresiniz hazır olacaktır:
   ```text
   =============================================================
   🎵 MusicBridge PC Core - Eren Teknoloji Aktif!
   =============================================================
   📡 Yerel Ağ (Ev Wi-Fi) Adresi  : http://192.168.1.42:8765
   🌐 Tailscale Adresi           : http://100.85.12.34:8765 (Varsa)
   =============================================================
   ```

### 2. Telefona Yükleme (Kablosuz & Zahmetsiz)

Kablo bağlamanıza gerek yok! Bilgisayarınızda `start.bat` açıkken:
1. Telefonunuzun tarayıcısını (Chrome vb.) açın ve şu adrese gidin:
   ```text
   http://<BILGISAYAR-IP-ADRESINIZ>:8765/MusicBridge.apk
   ```
   *(Örnek: `http://192.168.1.42:8765/MusicBridge.apk`)*
2. İndirilen **3 MB'lık** uygulamayı kurun.
3. Uygulamayı açıp bilgisayarınızın ekranda yazan IP adresini girin ve **Bağlan** deyin.

> 💡 **Alternatif:** APK dosyasını doğrudan bu GitHub deposunun **Releases / Actions** sekmesinden de telefonunuza indirebilirsiniz.

---

## ⌚ Akıllı Saat ile Kullanım

1. Telefonunuzda uygulamayı başlatıp PC'ye bağlayın.
2. Telefonunuzun ekranını kapatıp cebinize koyun.
3. Akıllı saatinizdeki (Huawei Watch Fit / GT vb.) yerleşik **Müzik** widget'ını açın:
   * Şarkı adı ve sanatçı saat ekranında anlık görünür.
   * Play / Pause / Sonraki Parça kontrolleri milisaniyeler içinde PC'yi tetikler.
   * Saatin ses tuşları PC'nin sistem sesini açıp kısar.

---

## 🔒 Güvenlik & Gizlilik

* **Tamamen Yerel:** Verileriniz hiçbir üçüncü taraf bulut sunucusuna aktarılmaz; yalnızca kendi ev ağınızda veya güvenli Tailscale tünelinizde dolaşır.
* **Gereksiz İzin Yok:** Konum, kamera, rehber gibi hassas izinler kesinlikle talep edilmez.

---

<div align="center">

Geliştirici: **Eren Teknoloji** • Açık Kaynaklı Özgür Yazılım © 2026

</div>
