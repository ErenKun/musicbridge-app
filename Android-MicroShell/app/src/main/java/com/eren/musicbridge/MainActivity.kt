package com.eren.musicbridge

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private val PREFS_NAME = "MusicBridgePrefs"
    private val KEY_SERVER_URL = "server_url"

    private var hasPageLoaded = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Android 13+ bildirim ve cagri izinlerini kontrol et (Android 9'da sessizce atlanir)
        checkModernPermissions()

        // Arka Plan Servisini Baslat (Akilli Saat & Kilit Ekrani)
        val serviceIntent = Intent(this, MediaBridgeService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent)
        } else {
            startService(serviceIntent)
        }

        // Tam Ekran WebView Kurulumu
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.loadWithOverviewMode = true
            settings.useWideViewPort = true
            settings.cacheMode = WebSettings.LOAD_DEFAULT

            // Donanim Hizlandirma
            setLayerType(View.LAYER_TYPE_HARDWARE, null)

            // Web ile Kotlin Koprusu
            addJavascriptInterface(ErenBridge(this@MainActivity), "ErenBridge")

            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    hasPageLoaded = true
                }
            }
            webChromeClient = WebChromeClient()

            // Uzun basildiginda acil durum IP degistirme menusu
            setOnLongClickListener {
                showServerConfigDialog()
                true
            }
        }

        setContentView(webView)

        // Kayitli Sunucu Adresini Kontrol Et
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val savedUrl = prefs.getString(KEY_SERVER_URL, "")

        if (savedUrl.isNullOrBlank()) {
            // Kayitli IP yoksa once yerel agi otomatik tara, bulunamazsa dialog goster
            discoverPcOnLan { foundUrl ->
                if (!foundUrl.isNullOrBlank()) {
                    prefs.edit().putString(KEY_SERVER_URL, foundUrl).apply()
                    loadServer(foundUrl)
                } else {
                    showServerConfigDialog()
                }
            }
        } else {
            loadServer(savedUrl)
        }
    }

    private fun checkModernPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val permissionsToRequest = mutableListOf<String>()
            if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                permissionsToRequest.add(android.Manifest.permission.POST_NOTIFICATIONS)
            }
            if (permissionsToRequest.isNotEmpty()) {
                requestPermissions(permissionsToRequest.toTypedArray(), 1001)
            }
        }
    }

    /**
     * Sifir konfigürasyonlu yerel ag taramasi (UDP Discovery)
     */
    fun discoverPcOnLan(callback: (String?) -> Unit) {
        Thread {
            var foundUrl: String? = null
            try {
                val socket = java.net.DatagramSocket()
                socket.broadcast = true
                socket.soTimeout = 1800

                val sendData = "MUSICBRIDGE_DISCOVERY_PING".toByteArray(Charsets.UTF_8)
                val broadcastAddress = java.net.InetAddress.getByName("255.255.255.255")
                val sendPacket = java.net.DatagramPacket(sendData, sendData.size, broadcastAddress, 8766)
                socket.send(sendPacket)

                val buffer = ByteArray(512)
                val receivePacket = java.net.DatagramPacket(buffer, buffer.size)
                socket.receive(receivePacket)

                val response = String(receivePacket.data, 0, receivePacket.length, Charsets.UTF_8).trim()
                if (response.startsWith("MUSICBRIDGE_DISCOVERY_PONG")) {
                    val parts = response.split("|")
                    val port = if (parts.size > 1) parts[1] else "8765"
                    val senderIp = receivePacket.address.hostAddress
                    foundUrl = "http://$senderIp:$port"
                }
                socket.close()
            } catch (e: Exception) {
                // Zaman asimi veya agda yayin desteklenmiyor
            }

            runOnUiThread {
                callback(foundUrl)
            }
        }.start()
    }

    private fun loadServer(url: String) {
        val formattedUrl = if (!url.startsWith("http://") && !url.startsWith("https://")) {
            "http://$url"
        } else {
            url
        }

        MediaBridgeService.instance?.setServerUrl(formattedUrl)
        webView.loadUrl(formattedUrl)
    }

    /**
     * Web arayuzundeki Baglanti sekmesinden IP degistirildiginde cagrilir.
     */
    fun onServerUrlChangedFromWeb(newUrl: String) {
        val cleanUrl = newUrl.trim()
        if (cleanUrl.isNotBlank()) {
            val formattedUrl = if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) {
                "http://$cleanUrl"
            } else {
                cleanUrl
            }
            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_SERVER_URL, formattedUrl)
                .apply()

            MediaBridgeService.instance?.setServerUrl(formattedUrl)
            webView.loadUrl(formattedUrl)
        }
    }

    private fun showServerConfigDialog() {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val currentUrl = prefs.getString(KEY_SERVER_URL, "") ?: ""

        val input = EditText(this).apply {
            hint = "192.168.1.x:8765 veya Tailscale IP"
            setText(currentUrl)
            setSelection(text.length)
        }

        AlertDialog.Builder(this)
            .setTitle("MusicBridge PC Baglantisi")
            .setMessage("Bilgisayarinizin yerel Wi-Fi veya Tailscale IP adresini girin:")
            .setView(input)
            .setPositiveButton("Baglan") { _, _ ->
                val newUrl = input.text.toString().trim()
                if (newUrl.isNotBlank()) {
                    prefs.edit().putString(KEY_SERVER_URL, newUrl).apply()
                    loadServer(newUrl)
                }
            }
            .setNeutralButton("🔍 PC'yi Otomatik Bul") { _, _ ->
                android.widget.Toast.makeText(this, "Ağdaki PC taranıyor...", android.widget.Toast.LENGTH_SHORT).show()
                discoverPcOnLan { foundUrl ->
                    if (!foundUrl.isNullOrBlank()) {
                        prefs.edit().putString(KEY_SERVER_URL, foundUrl).apply()
                        loadServer(foundUrl)
                        android.widget.Toast.makeText(this, "Bağlandı: $foundUrl", android.widget.Toast.LENGTH_SHORT).show()
                    } else {
                        android.widget.Toast.makeText(this, "PC bulunamadı. Lütfen IP adresini elle girin.", android.widget.Toast.LENGTH_LONG).show()
                        showServerConfigDialog()
                    }
                }
            }
            .setCancelable(false)
            .show()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        webView.resumeTimers()

        val currentUrl = webView.url
        // Eger sayfa hic yuklenemediyse veya hata sayfasindaysa, kayitli adresi yeniden yukle
        if (currentUrl.isNullOrBlank() || currentUrl.startsWith("data:") || !hasPageLoaded) {
            val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val savedUrl = prefs.getString(KEY_SERVER_URL, "")
            if (!savedUrl.isNullOrBlank()) {
                loadServer(savedUrl)
            }
        } else {
            // Sayfa hazirsa JavaScript yasam dongusu fonksiyonunu tetikle
            webView.evaluateJavascript("if (typeof window.onAppResume === 'function') { window.onAppResume(); }", null)
        }
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            // Uygulamayi tamamen kapatmak yerine arka plana at (Muzik & Saat kesilmesin)
            moveTaskToBack(true)
        }
    }
}
