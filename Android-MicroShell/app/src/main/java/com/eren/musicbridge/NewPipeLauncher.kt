package com.eren.musicbridge

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import java.net.URLEncoder

object NewPipeLauncher {
    // Bilinen tum NewPipe, ReVanced, ViMusic ve alternatif oynatici paketleri
    private val PLAYER_PACKAGES = listOf(
        "org.schabi.newpipe",                    // Resmi NewPipe
        "org.polymorphicshade.newpipe",          // NewPipe x SponsorBlock
        "Infinity.Player",                       // PipePipe
        "app.revanced.android.apps.youtube.music", // YouTube Music ReVanced
        "app.revanced.android.youtube",          // YouTube ReVanced
        "it.vfsfitvnm.vimusic",                  // ViMusic
        "it.fast4x.rimusic",                     // RiMusic
        "com.zionhuang.music",                   // InnerTune
        "com.google.android.apps.youtube.music", // Resmi YouTube Music
        "com.google.android.youtube",            // Resmi YouTube
        "org.schabi.newpipe.debug"               // Debug
    )

    /**
     * Sarkiyi NewPipe uygulamasinda PC'de kaldigi saniyeden veya dogrudan arama ile baslatir.
     */
    fun resumeTrack(context: Context, videoId: String?, elapsedSeconds: Int, title: String? = null, artist: String? = null) {
        val cleanVideoId = videoId?.trim() ?: ""

        val targetUrl = if (cleanVideoId.isNotBlank() && cleanVideoId.length == 11) {
            "https://www.youtube.com/watch?v=$cleanVideoId&t=${elapsedSeconds}s"
        } else {
            // Video ID yoksa kesinlikle music.youtube.com degil, YouTube arama URL'si olustur
            val queryParts = listOfNotNull(title?.trim(), artist?.trim()).filter { it.isNotBlank() && it != "YouTube Music" }
            val query = if (queryParts.isNotEmpty()) queryParts.joinToString(" ") else "YouTube Music"
            val encodedQuery = try {
                URLEncoder.encode(query, "UTF-8")
            } catch (e: Exception) {
                "music"
            }
            "https://www.youtube.com/results?search_query=$encodedQuery"
        }

        val uri = Uri.parse(targetUrl)

        // 1. Once yuklu oynatici paketlerini tek tek dene
        for (pkg in PLAYER_PACKAGES) {
            try {
                val intent = Intent(Intent.ACTION_VIEW, uri).apply {
                    setPackage(pkg)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(intent)
                return
            } catch (e: Exception) {
                // Bu paket yuklu degil, sonrakini dene
            }
        }

        // 2. Eger NewPipe paketleri bulunamazsa genel YouTube Intent'i ile ac
        try {
            val genericIntent = Intent(Intent.ACTION_VIEW, uri).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(genericIntent)
        } catch (err: Exception) {
            Toast.makeText(context, "NewPipe veya oynatici acilamadi: ${err.message}", Toast.LENGTH_LONG).show()
        }
    }
}
