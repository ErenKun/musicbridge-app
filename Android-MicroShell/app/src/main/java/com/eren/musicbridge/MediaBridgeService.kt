package com.eren.musicbridge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

class MediaBridgeService : Service() {

    private lateinit var mediaSession: MediaSessionCompat
    private var serverBaseUrl: String = "http://127.0.0.1:8765"
    private val scope = CoroutineScope(Dispatchers.IO)
    private var backgroundSyncJob: Job? = null

    private var lastTitle: String = ""
    private var lastArtist: String = ""
    private var lastIsPlaying: Boolean = false

    companion object {
        const val CHANNEL_ID = "musicbridge_playback_channel"
        const val NOTIFICATION_ID = 8765
        const val PREFS_NAME = "MusicBridgePrefs"
        const val KEY_SERVER_URL = "server_url"
        var instance: MediaBridgeService? = null
    }

    override fun onCreate() {
        super.onCreate()
        instance = this

        // Kayitli sunucu adresini yukle
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val saved = prefs.getString(KEY_SERVER_URL, "")
        if (!saved.isNullOrBlank()) {
            serverBaseUrl = if (!saved.startsWith("http://") && !saved.startsWith("https://")) "http://$saved" else saved
        }

        createNotificationChannel()
        initMediaSession()
        startForeground(NOTIFICATION_ID, buildNotification("MusicBridge", "PC'ye baglaniyor..."))

        // Arka planda baglanti ve sarki senkronizasyonunu baslat (Pil dostu)
        startBackgroundSync()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        intent?.getStringExtra("SERVER_URL")?.let {
            setServerUrl(it)
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
                    // Saatte aninda tepki icin oynatma durumunu hemen guncelle
                    setOptimisticPlaybackState(true)
                    sendMediaCommandToPc("play")
                }

                override fun onPause() {
                    setOptimisticPlaybackState(false)
                    sendMediaCommandToPc("pause")
                }

                override fun onSkipToNext() {
                    sendMediaCommandToPc("next")
                }

                override fun onSkipToPrevious() {
                    sendMediaCommandToPc("previous")
                }

                override fun onStop() {
                    setOptimisticPlaybackState(false)
                    sendMediaCommandToPc("pause")
                }
            })

            isActive = true
        }
    }

    private fun setOptimisticPlaybackState(isPlaying: Boolean) {
        val state = PlaybackStateCompat.Builder()
            .setActions(
                PlaybackStateCompat.ACTION_PLAY or
                PlaybackStateCompat.ACTION_PAUSE or
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
            )
            .setState(
                if (isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
                PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN,
                1.0f
            )
            .build()
        mediaSession.setPlaybackState(state)
        lastIsPlaying = isPlaying
    }

    /**
     * Huawei Watch Fit 4 ve sistem bildirimi icin sarki bilgilerini gunceller.
     */
    fun updateTrackInfo(title: String, artist: String, durationMs: Long, isPlaying: Boolean) {
        lastTitle = title
        lastArtist = artist
        lastIsPlaying = isPlaying

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
                PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN,
                1.0f
            )
            .build()
        mediaSession.setPlaybackState(state)

        // 3. Bildirimi guncelle
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.notify(NOTIFICATION_ID, buildNotification(title, artist))
    }

    fun setServerUrl(url: String) {
        val formatted = if (!url.startsWith("http://") && !url.startsWith("https://")) "http://$url" else url
        this.serverBaseUrl = formatted
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_SERVER_URL, formatted)
            .apply()
    }

    /**
     * Saatten veya bildirimden gelen komutlari PC'ye iletir.
     * Uygulama kapaliyken veya ekran kilitliyken Android'in Doze moduna takilmamasi icin
     * sadece istek suresince gecici (max 3 sn) bir Partial WakeLock alir.
     */
    private fun sendMediaCommandToPc(action: String) {
        scope.launch {
            val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager
            val wakeLock = powerManager?.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "MusicBridge:MediaCommandWakeLock"
            )
            try {
                wakeLock?.acquire(3000) // 3 saniye guvenlik limiti (pil tuketmez)
                val url = URL("$serverBaseUrl/api/control")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.doOutput = true
                conn.connectTimeout = 2000
                conn.readTimeout = 2000

                val body = "{\"action\":\"$action\"}"
                OutputStreamWriter(conn.outputStream).use { it.write(body) }
                conn.responseCode
                conn.disconnect()
            } catch (err: Exception) {
                // Hata durumunda sessiz kal
            } finally {
                if (wakeLock?.isHeld == true) {
                    try { wakeLock.release() } catch (e: Exception) {}
                }
            }
        }
    }

    /**
     * Telefon kilitliyken veya uygulama kapaliyken Huawei Saat ve Bildirim senkronizasyonunu
     * son derece dusuk pil tuketimiyle guncel tutar.
     */
    private fun startBackgroundSync() {
        backgroundSyncJob?.cancel()
        backgroundSyncJob = scope.launch {
            while (isActive) {
                try {
                    val url = URL("$serverBaseUrl/api/status")
                    val conn = url.openConnection() as HttpURLConnection
                    conn.connectTimeout = 2000
                    conn.readTimeout = 2000
                    conn.requestMethod = "GET"

                    if (conn.responseCode == 200) {
                        val responseText = BufferedReader(InputStreamReader(conn.inputStream)).use { it.readText() }
                        val json = JSONObject(responseText)
                        val media = json.optJSONObject("media")
                        if (media != null) {
                            val title = media.optString("title", "Muzik Bekleniyor...")
                            val artist = media.optString("artist", "YouTube Music")
                            val duration = media.optLong("duration", 0L) * 1000L
                            val isPlaying = media.optBoolean("isPlaying", false)

                            if (title != lastTitle || artist != lastArtist || isPlaying != lastIsPlaying) {
                                updateTrackInfo(title, artist, duration, isPlaying)
                            }
                        }
                    }
                    conn.disconnect()
                } catch (e: Exception) {
                    // PC kapaliysa veya ag yoksa
                }

                // Muzik caliyorsa 2.5 sn, calmiyorsa 5 sn bekle (Sifira yakin pil kullanimi)
                delay(if (lastIsPlaying) 2500L else 5000L)
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
                description = "Huawei Watch ve kilit ekrani muzik kontrollerini yonetir"
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
        backgroundSyncJob?.cancel()
        mediaSession.isActive = false
        mediaSession.release()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
