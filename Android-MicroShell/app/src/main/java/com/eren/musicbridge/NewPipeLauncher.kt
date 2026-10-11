package com.eren.musicbridge

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast

object NewPipeLauncher {
    /**
     * Şarkıyı NewPipe uygulamasında PC'de kaldığı saniyeden başlatır.
     */
    fun resumeTrack(context: Context, videoId: String, elapsedSeconds: Int) {
        val targetUrl = if (videoId.isNotBlank()) {
            "https://www.youtube.com/watch?v=$videoId&t=${elapsedSeconds}s"
        } else {
            "https://music.youtube.com"
        }

        val uri = Uri.parse(targetUrl)

        // Doğrudan NewPipe paketini hedefle
        val intent = Intent(Intent.ACTION_VIEW, uri).apply {
            setPackage("org.schabi.newpipe")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }

        try {
            context.startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            // NewPipe yüklü değilse genel tarayıcı/oynatıcı ile aç
            try {
                val genericIntent = Intent(Intent.ACTION_VIEW, uri).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(genericIntent)
            } catch (err: Exception) {
                Toast.makeText(context, "Bağlantı açılamadı: ${err.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }
}
