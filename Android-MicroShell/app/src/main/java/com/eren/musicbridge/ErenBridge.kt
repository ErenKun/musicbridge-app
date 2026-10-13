package com.eren.musicbridge

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface

class ErenBridge(private val context: Context) {

    /**
     * Web arayuzu sarki degistiginde cagirir.
     * Bu sayede akilli saatin ekranina bilgi aktarilir.
     */
    @JavascriptInterface
    fun syncTrack(title: String, artist: String, durationMs: Long, isPlaying: Boolean) {
        MediaBridgeService.instance?.updateTrackInfo(title, artist, durationMs, isPlaying)
    }

    /**
     * Web arayuzundeki "Telefonda Ac" butonuna basildiginda cagirilir.
     */
    @JavascriptInterface
    fun openNewPipe(videoId: String?, seconds: Int, title: String?, artist: String?) {
        NewPipeLauncher.resumeTrack(context, videoId, seconds, title, artist)
    }

    // Geriye donuk uyumluluk overload
    @JavascriptInterface
    fun openNewPipe(videoId: String?, seconds: Int) {
        NewPipeLauncher.resumeTrack(context, videoId, seconds, null, null)
    }

    /**
     * Web arayuzunden sunucu IP'si guncellendiginde cagirilir.
     */
    @JavascriptInterface
    fun updateServerUrl(newUrl: String): Boolean {
        if (context is MainActivity) {
            Handler(Looper.getMainLooper()).post {
                context.onServerUrlChangedFromWeb(newUrl)
            }
            return true
        }
        return false
    }

    @JavascriptInterface
    fun getSavedServerUrl(): String {
        val prefs = context.getSharedPreferences("MusicBridgePrefs", Context.MODE_PRIVATE)
        return prefs.getString("server_url", "") ?: ""
    }

    /**
     * Akilli saat ve telefon donanim ses senkronu durumu
     */
    @JavascriptInterface
    fun isVolumeSyncEnabled(): Boolean {
        val prefs = context.getSharedPreferences("MusicBridgePrefs", Context.MODE_PRIVATE)
        return prefs.getBoolean("volume_sync_enabled", false)
    }

    @JavascriptInterface
    fun setVolumeSyncEnabled(enabled: Boolean) {
        val prefs = context.getSharedPreferences("MusicBridgePrefs", Context.MODE_PRIVATE)
        prefs.edit().putBoolean("volume_sync_enabled", enabled).apply()
        MediaBridgeService.instance?.setVolumeSyncEnabled(enabled)
    }
}
