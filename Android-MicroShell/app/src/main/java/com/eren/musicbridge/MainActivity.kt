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

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Arka Plan Servisini Başlat (Huawei Saat & Kilit Ekranı)
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

            // Donanım Hızlandırma
            setLayerType(View.LAYER_TYPE_HARDWARE, null)

            // Web ile Kotlin Köprüsü
            addJavascriptInterface(ErenBridge(this@MainActivity), "ErenBridge")

            webViewClient = WebViewClient()
            webChromeClient = WebChromeClient()

            // Uzun basıldığında IP değiştirme menüsü
            setOnLongClickListener {
                showServerConfigDialog()
                true
            }
        }

        setContentView(webView)

        // Kayıtlı Sunucu Adresini Kontrol Et
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val savedUrl = prefs.getString(KEY_SERVER_URL, "")

        if (savedUrl.isNullOrBlank()) {
            showServerConfigDialog()
        } else {
            loadServer(savedUrl)
        }
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

    private fun showServerConfigDialog() {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val currentUrl = prefs.getString(KEY_SERVER_URL, "192.168.1.42:8765")

        val input = EditText(this).apply {
            hint = "192.168.1.x:8765 veya Tailscale IP"
            setText(currentUrl)
            setSelection(text.length)
        }

        AlertDialog.Builder(this)
            .setTitle("MusicBridge PC Bağlantısı")
            .setMessage("Bilgisayarınızın yerel Wi-Fi veya Tailscale IP adresini girin:")
            .setView(input)
            .setPositiveButton("Bağlan") { _, _ ->
                val newUrl = input.text.toString().trim()
                if (newUrl.isNotBlank()) {
                    prefs.edit().putString(KEY_SERVER_URL, newUrl).apply()
                    loadServer(newUrl)
                }
            }
            .setCancelable(false)
            .show()
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            // Uygulamayı tamamen kapatmak yerine arka plana at (Müzik & Saat kesilmesin)
            moveTaskToBack(true)
        }
    }
}
