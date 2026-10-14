package com.eren.musicbridge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.view.KeyEvent
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
    private var wasPlayingBeforeCall: Boolean = false
    private var telephonyManager: android.telephony.TelephonyManager? = null
    private var phoneStateListener: android.telephony.PhoneStateListener? = null

    companion object {
        const val CHANNEL_ID = "musicbridge_playback_channel"
        const val NOTIFICATION_ID = 8765
        const val PREFS_NAME = "MusicBridgePrefs"
        const val KEY_SERVER_URL = "server_url"
        const val ACTION_TOGGLE_VOLUME_SYNC = "com.eren.musicbridge.ACTION_TOGGLE_VOLUME_SYNC"
        var instance: MediaBridgeService? = null

        // Tum akilli saatlerin destekledigi tam eylem listesi
        const val SUPPORTED_ACTIONS = PlaybackStateCompat.ACTION_PLAY or
                PlaybackStateCompat.ACTION_PAUSE or
                PlaybackStateCompat.ACTION_PLAY_PAUSE or
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                PlaybackStateCompat.ACTION_STOP
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

        // Akilli cagri duraklatma dinleyicisini baslat
        initCallStateListener()

        // Donanim & akilli saat ses senkronu durumunu yukle
        if (prefs.getBoolean("volume_sync_enabled", false)) {
            setVolumeSyncEnabled(true)
        }

        // Arka planda baglanti ve sarki senkronizasyonunu baslat (Pil dostu)
        startBackgroundSync()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_TOGGLE_VOLUME_SYNC) {
            val nextState = !isVolumeSyncEnabled
            setVolumeSyncEnabled(nextState)
            val msg = if (nextState) {
                "🔊 Ses Senkronu Açıldı: Telefonun ses tuşları PC sesini değiştirecek"
            } else {
                "🔇 Ses Senkronu Kapatıldı: Telefonun ses tuşları PC sesini etkilemeyecek"
            }
            android.widget.Toast.makeText(this, msg, android.widget.Toast.LENGTH_SHORT).show()
            return START_STICKY
        }
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
                    updatePlaybackStateOnly(true)
                    sendMediaCommandToPc("play")
                }

                override fun onPause() {
                    updatePlaybackStateOnly(false)
                    sendMediaCommandToPc("pause")
                }

                override fun onSkipToNext() {
                    sendMediaCommandToPc("next")
                }

                override fun onSkipToPrevious() {
                    sendMediaCommandToPc("previous")
                }

                override fun onStop() {
                    updatePlaybackStateOnly(false)
                    sendMediaCommandToPc("pause")
                }

                override fun onMediaButtonEvent(mediaButtonEvent: Intent?): Boolean {
                    val keyEvent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        mediaButtonEvent?.getParcelableExtra(Intent.EXTRA_KEY_EVENT, KeyEvent::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        mediaButtonEvent?.getParcelableExtra(Intent.EXTRA_KEY_EVENT)
                    }
                    if (keyEvent != null && keyEvent.action == KeyEvent.ACTION_DOWN) {
                        when (keyEvent.keyCode) {
                            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
                            KeyEvent.KEYCODE_HEADSETHOOK -> {
                                val nextState = !lastIsPlaying
                                updatePlaybackStateOnly(nextState)
                                sendMediaCommandToPc(if (nextState) "play" else "pause")
                                return true
                            }
                            KeyEvent.KEYCODE_MEDIA_PLAY -> {
                                updatePlaybackStateOnly(true)
                                sendMediaCommandToPc("play")
                                return true
                            }
                            KeyEvent.KEYCODE_MEDIA_PAUSE -> {
                                updatePlaybackStateOnly(false)
                                sendMediaCommandToPc("pause")
                                return true
                            }
                            KeyEvent.KEYCODE_MEDIA_NEXT -> {
                                sendMediaCommandToPc("next")
                                return true
                            }
                            KeyEvent.KEYCODE_MEDIA_PREVIOUS -> {
                                sendMediaCommandToPc("previous")
                                return true
                            }
                        }
                    }
                    return super.onMediaButtonEvent(mediaButtonEvent)
                }
            })

            // Saatin baslangicta "telefonda sarki yok" demesini onleyen gecerli baslangic durumu
            val initialMetadata = MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, "MusicBridge")
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, "Hazır")
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, 1000L)
                .build()
            setMetadata(initialMetadata)

            val initialState = PlaybackStateCompat.Builder()
                .setActions(SUPPORTED_ACTIONS)
                .setState(PlaybackStateCompat.STATE_PAUSED, 0L, 1.0f)
                .build()
            setPlaybackState(initialState)

            isActive = true
        }
    }

    private fun updatePlaybackStateOnly(isPlaying: Boolean) {
        lastIsPlaying = isPlaying
        val state = PlaybackStateCompat.Builder()
            .setActions(SUPPORTED_ACTIONS)
            .setState(
                if (isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
                0L,
                1.0f
            )
            .build()
        mediaSession.setPlaybackState(state)
    }

    /**
     * Akilli saat ve sistem bildirimi icin sarki bilgilerini gunceller.
     */
    fun updateTrackInfo(title: String, artist: String, durationMs: Long, isPlaying: Boolean) {
        lastTitle = title
        lastArtist = artist
        lastIsPlaying = isPlaying

        // 1. MediaSession Metadata
        val metadata = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, if (durationMs > 0) durationMs else 1000L)
            .build()
        mediaSession.setMetadata(metadata)

        // 2. Playback State (Akilli saatler icin daima 0L veya gecerli pozisyon, asla -1 verilmez)
        val state = PlaybackStateCompat.Builder()
            .setActions(SUPPORTED_ACTIONS)
            .setState(
                if (isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
                0L,
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
    fun sendMediaCommandToPc(action: String, data: Any? = null) {
        scope.launch {
            val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager
            val wakeLock = powerManager?.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "MusicBridge:MediaCommandWakeLock"
            )
                val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                val token = prefs.getString("auth_token", "") ?: ""

                wakeLock?.acquire(3000)
                val url = URL("$serverBaseUrl/api/control")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                if (token.isNotBlank()) {
                    conn.setRequestProperty("Authorization", "Bearer $token")
                }
                conn.doOutput = true
                conn.connectTimeout = 2000
                conn.readTimeout = 2000

                val body = if (data != null) {
                    "{\"action\":\"$action\",\"data\":$data,\"token\":\"$token\"}"
                } else {
                    "{\"action\":\"$action\",\"token\":\"$token\"}"
                }
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

    private var isVolumeSyncEnabled = false
    private var volumeReceiver: android.content.BroadcastReceiver? = null
    private var lastVolumeSentTime = 0L

    fun setVolumeSyncEnabled(enabled: Boolean) {
        isVolumeSyncEnabled = enabled
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean("volume_sync_enabled", enabled)
            .apply()

        if (enabled) {
            registerVolumeReceiver()
            syncHardwareVolumeToPc()
        } else {
            unregisterVolumeReceiver()
        }

        updateTileStateExternal()

        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.notify(
            NOTIFICATION_ID,
            buildNotification(lastTitle.ifEmpty { "MusicBridge" }, lastArtist.ifEmpty { "Hazır" })
        )
    }

    fun isVolumeSyncEnabled(): Boolean = isVolumeSyncEnabled

    private fun updateTileStateExternal() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            try {
                android.service.quicksettings.TileService.requestListeningState(
                    this,
                    ComponentName(this, MusicBridgeTileService::class.java)
                )
            } catch (e: Exception) {}
        }
    }

    private fun registerVolumeReceiver() {
        if (volumeReceiver != null) return
        volumeReceiver = object : android.content.BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                if (intent?.action == "android.media.VOLUME_CHANGED_ACTION") {
                    val streamType = intent.getIntExtra("android.media.EXTRA_VOLUME_STREAM_TYPE", -1)
                    if (streamType == android.media.AudioManager.STREAM_MUSIC) {
                        val now = System.currentTimeMillis()
                        // 120ms debounce (saat cevirmesinde veya seri tus basiminda agi tıkamaz)
                        if (now - lastVolumeSentTime > 120) {
                            lastVolumeSentTime = now
                            syncHardwareVolumeToPc()
                        }
                    }
                }
            }
        }
        val filter = android.content.IntentFilter("android.media.VOLUME_CHANGED_ACTION")
        try {
            registerReceiver(volumeReceiver, filter)
        } catch (e: Exception) {}
    }

    private fun unregisterVolumeReceiver() {
        volumeReceiver?.let {
            try { unregisterReceiver(it) } catch (e: Exception) {}
            volumeReceiver = null
        }
    }

    private fun syncHardwareVolumeToPc() {
        val am = audioManager ?: (getSystemService(Context.AUDIO_SERVICE) as? android.media.AudioManager)
        if (am != null) {
            val curr = am.getStreamVolume(android.media.AudioManager.STREAM_MUSIC)
            val max = am.getStreamMaxVolume(android.media.AudioManager.STREAM_MUSIC)
            if (max > 0) {
                val percent = (curr * 100) / max
                sendMediaCommandToPc("setVolume", percent)
            }
        }
    }

    private var audioManager: android.media.AudioManager? = null
    private var audioFocusChangeListener: android.media.AudioManager.OnAudioFocusChangeListener? = null

    /**
     * Telefon caldiginda veya WhatsApp/VoIP aramasi geldiginde muzigi otomatik duraklatir,
     * gorusme bitince devam ettirir (Smart Call & WhatsApp Auto-Pause).
     */
    @Suppress("DEPRECATION")
    private fun initCallStateListener() {
        // 1. GSM Hücresel Arama Dinleyicisi
        try {
            telephonyManager = getSystemService(Context.TELEPHONY_SERVICE) as? android.telephony.TelephonyManager
            phoneStateListener = object : android.telephony.PhoneStateListener() {
                override fun onCallStateChanged(state: Int, phoneNumber: String?) {
                    when (state) {
                        android.telephony.TelephonyManager.CALL_STATE_RINGING,
                        android.telephony.TelephonyManager.CALL_STATE_OFFHOOK -> {
                            if (lastIsPlaying) {
                                wasPlayingBeforeCall = true
                                updatePlaybackStateOnly(false)
                                sendMediaCommandToPc("pause")
                            }
                        }
                        android.telephony.TelephonyManager.CALL_STATE_IDLE -> {
                            if (wasPlayingBeforeCall) {
                                wasPlayingBeforeCall = false
                                updatePlaybackStateOnly(true)
                                sendMediaCommandToPc("play")
                            }
                        }
                    }
                }
            }
            phoneStateListener?.let {
                telephonyManager?.listen(it, android.telephony.PhoneStateListener.LISTEN_CALL_STATE)
            }
        } catch (e: Exception) {}

        // 2. WhatsApp / Telegram / VoIP İnternet Aramaları Dinleyicisi (Ses Odağı)
        try {
            audioManager = getSystemService(Context.AUDIO_SERVICE) as? android.media.AudioManager
            audioFocusChangeListener = android.media.AudioManager.OnAudioFocusChangeListener { focusChange ->
                when (focusChange) {
                    android.media.AudioManager.AUDIOFOCUS_LOSS,
                    android.media.AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
                    android.media.AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                        // WhatsApp veya VoIP aramasi ses odagini aldi, muzigi duraklat
                        if (lastIsPlaying) {
                            wasPlayingBeforeCall = true
                            updatePlaybackStateOnly(false)
                            sendMediaCommandToPc("pause")
                        }
                    }
                    android.media.AudioManager.AUDIOFOCUS_GAIN -> {
                        // Arama bitti, ses odagi geri geldi
                        if (wasPlayingBeforeCall) {
                            wasPlayingBeforeCall = false
                            updatePlaybackStateOnly(true)
                            sendMediaCommandToPc("play")
                        }
                    }
                }
            }

            // Baslangicta ses odagi dinleyicisini bagla
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val focusRequest = android.media.AudioFocusRequest.Builder(android.media.AudioManager.AUDIOFOCUS_GAIN)
                    .setOnAudioFocusChangeListener(audioFocusChangeListener!!)
                    .build()
                audioManager?.requestAudioFocus(focusRequest)
            } else {
                audioManager?.requestAudioFocus(
                    audioFocusChangeListener,
                    android.media.AudioManager.STREAM_MUSIC,
                    android.media.AudioManager.AUDIOFOCUS_GAIN
                )
            }
        } catch (e: Exception) {}
    }

    /**
     * Telefon kilitliyken veya uygulama kapaliyken Akilli Saat ve Bildirim senkronizasyonunu
     * son derece dusuk pil tuketimiyle guncel tutar (Akilli Backoff).
     */
    private fun startBackgroundSync() {
        backgroundSyncJob?.cancel()
        backgroundSyncJob = scope.launch {
            var failureCount = 0
            while (isActive) {
                var isSuccess = false
                try {
                    val url = URL("$serverBaseUrl/api/status")
                    val conn = url.openConnection() as HttpURLConnection
                    conn.connectTimeout = 1800
                    conn.readTimeout = 1800
                    conn.requestMethod = "GET"

                    if (conn.responseCode == 200) {
                        val responseText = BufferedReader(InputStreamReader(conn.inputStream)).use { it.readText() }
                        val json = JSONObject(responseText)
                        val media = json.optJSONObject("media")
                        if (media != null) {
                            val title = media.optString("title", "MusicBridge")
                            val artist = media.optString("artist", "YouTube Music")
                            val duration = media.optLong("duration", 0L) * 1000L
                            val isPlaying = media.optBoolean("isPlaying", false)

                            if (title != lastTitle || artist != lastArtist || isPlaying != lastIsPlaying) {
                                updateTrackInfo(title, artist, duration, isPlaying)
                            }
                            isSuccess = true
                        }
                    }
                    conn.disconnect()
                } catch (e: Exception) {
                    // PC kapaliysa veya ag yoksa
                }

                if (isSuccess) {
                    failureCount = 0
                    delay(if (lastIsPlaying) 2000L else 4000L)
                } else {
                    failureCount++
                    val backoffDelay = (2000L + (failureCount * 1000L)).coerceAtMost(8000L)
                    delay(backoffDelay)
                }
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
                description = "Akilli saat ve kilit ekrani muzik kontrollerini yonetir"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(title: String, subtitle: String): Notification {
        val toggleVolumeIntent = Intent(this, MediaBridgeService::class.java).apply {
            action = ACTION_TOGGLE_VOLUME_SYNC
        }
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val togglePending = PendingIntent.getService(this, 1002, toggleVolumeIntent, flags)

        val syncLabel = if (isVolumeSyncEnabled) "🔊 Ses Senkronu: Açık" else "🔇 Ses Senkronu: Kapalı"
        val syncIcon = if (isVolumeSyncEnabled) android.R.drawable.ic_lock_silent_mode_off else android.R.drawable.ic_lock_silent_mode

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(subtitle)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addAction(syncIcon, syncLabel, togglePending)
            .build()
    }

    @Suppress("DEPRECATION")
    override fun onDestroy() {
        instance = null
        backgroundSyncJob?.cancel()
        try {
            phoneStateListener?.let {
                telephonyManager?.listen(it, android.telephony.PhoneStateListener.LISTEN_NONE)
            }
            audioFocusChangeListener?.let {
                audioManager?.abandonAudioFocus(it)
            }
            unregisterVolumeReceiver()
        } catch (e: Exception) {}
        mediaSession.isActive = false
        mediaSession.release()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
