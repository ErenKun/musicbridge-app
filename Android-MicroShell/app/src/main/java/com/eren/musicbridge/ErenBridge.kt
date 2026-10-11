package com.eren.musicbridge

import android.content.Context
import android.webkit.JavascriptInterface

class ErenBridge(private val context: Context) {

    /**
     * Web arayüzü şarkı değiştiğinde çağırır.
     * Bu sayede Huawei Watch Fit 4 saatin ekranına bilgi aktarılır.
     */
    @JavascriptInterface
    fun syncTrack(title: String, artist: String, durationMs: Long, isPlaying: Boolean) {
        MediaBridgeService.instance?.updateTrackInfo(title, artist, durationMs, isPlaying)
    }

    /**
     * Web arayüzündeki "NewPipe'ta Aç" butonuna basıldığında çağrılır.
     */
    @JavascriptInterface
    fun openNewPipe(videoId: String, seconds: Int) {
        NewPipeLauncher.resumeTrack(context, videoId, seconds)
    }
}
