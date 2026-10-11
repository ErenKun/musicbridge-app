package com.eren.musicbridge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

class MediaBridgeService : Service() {

    private lateinit var mediaSession: MediaSessionCompat
    private var serverBaseUrl: String = "http://127.0.0.1:8765"
    private val scope = CoroutineScope(Dispatchers.IO)

    companion object {
        const val CHANNEL_ID = "musicbridge_playback_channel"
        const val NOTIFICATION_ID = 8765
        var instance: MediaBridgeService? = null
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        createNotificationChannel()
        initMediaSession()
        startForeground(NOTIFICATION_ID, buildNotification("MusicBridge", "PC'ye bağlanıyor..."))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        intent?.getStringExtra("SERVER_URL")?.let {
            serverBaseUrl = it
        }
        return START_STICKY
    }

    private fun initMediaSession() {
        mediaSession = MediaSessionCompat(this, "MusicBridgeSession").apply {
            setFlags(
                MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS or
                MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
            )

            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() {
                    sendMediaCommandToPc("play")
                }

                override fun onPause() {
                    sendMediaCommandToPc("pause")
                }

                override fun onSkipToNext() {
                    sendMediaCommandToPc("next")
                }

                override fun onSkipToPrevious() {
                    sendMediaCommandToPc("previous")
                }

                override fun onStop() {
                    sendMediaCommandToPc("pause")
                }
            })

            isActive = true
        }
    }

    /**
     * Huawei Watch Fit 4 ve sistem bildirimi için şarkı bilgilerini günceller.
     */
    fun updateTrackInfo(title: String, artist: String, durationMs: Long, isPlaying: Boolean) {
        // 1. MediaSession Metadata
        val metadata = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs)
            .build()
        mediaSession.setMetadata(metadata)

        // 2. Playback State
        val state = PlaybackStateCompat.Builder()
            .setActions(
                PlaybackStateCompat.ACTION_PLAY or
                PlaybackStateCompat.ACTION_PAUSE or
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
            )
            .setState(
                if (isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
                0,
                1.0f
            )
            .build()
        mediaSession.setPlaybackState(state)

        // 3. Bildirimi güncelle
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.notify(NOTIFICATION_ID, buildNotification(title, artist))
    }

    fun setServerUrl(url: String) {
        this.serverBaseUrl = url
    }

    private fun sendMediaCommandToPc(action: String) {
        scope.launch {
            try {
                val url = URL("$serverBaseUrl/api/control")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.doOutput = true
                conn.connectTimeout = 3000
                conn.readTimeout = 3000

                val body = "{\"action\":\"$action\"}"
                OutputStreamWriter(conn.outputStream).use { it.write(body) }
                conn.responseCode
                conn.disconnect()
            } catch (err: Exception) {
                // Bağlantı hatası durumunda sessiz kal
            }
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "MusicBridge Oynatma Servisi",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Huawei Watch ve kilit ekranı müzik kontrollerini yönetir"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(title: String, subtitle: String): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(subtitle)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build()
    }

    override fun onDestroy() {
        instance = null
        mediaSession.isActive = false
        mediaSession.release()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
