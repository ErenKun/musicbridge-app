package com.eren.musicbridge

import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.widget.Toast
import androidx.annotation.RequiresApi

@RequiresApi(Build.VERSION_CODES.N)
class MusicBridgeTileService : TileService() {

    override fun onStartListening() {
        super.onStartListening()
        updateTileState()
    }

    override fun onClick() {
        super.onClick()
        val prefs = getSharedPreferences(MediaBridgeService.PREFS_NAME, Context.MODE_PRIVATE)
        val currentlyEnabled = MediaBridgeService.instance?.isVolumeSyncEnabled()
            ?: prefs.getBoolean("volume_sync_enabled", false)
        val newTarget = !currentlyEnabled

        // 1. Tercihlere kaydet
        prefs.edit().putBoolean("volume_sync_enabled", newTarget).apply()

        // 2. Servis aktifse anında devreye sok/kapat; servis kapalıysa başlat
        if (MediaBridgeService.instance != null) {
            MediaBridgeService.instance?.setVolumeSyncEnabled(newTarget)
        } else {
            val intent = Intent(this, MediaBridgeService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent)
            } else {
                startService(intent)
            }
        }

        // 3. Tile görsel durumunu güncelle
        qsTile?.let { tile ->
            tile.state = if (newTarget) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
            tile.label = "PC Ses Senkronu"
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                tile.subtitle = if (newTarget) "Açık (Tel ↔ PC)" else "Kapalı"
            }
            tile.icon = Icon.createWithResource(
                this,
                if (newTarget) android.R.drawable.ic_lock_silent_mode_off else android.R.drawable.ic_lock_silent_mode
            )
            tile.updateTile()
        }

        // 4. Kullanıcıya net bilgi veren geri bildirim (Toast)
        val msg = if (newTarget) {
            "🔊 Ses Senkronu Açıldı: Telefonun ses tuşları PC sesini değiştirecek"
        } else {
            "🔇 Ses Senkronu Kapatıldı: Telefonun ses tuşları PC sesini etkilemeyecek"
        }
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
    }

    private fun updateTileState() {
        val tile = qsTile ?: return
        val prefs = getSharedPreferences(MediaBridgeService.PREFS_NAME, Context.MODE_PRIVATE)
        val isEnabled = MediaBridgeService.instance?.isVolumeSyncEnabled()
            ?: prefs.getBoolean("volume_sync_enabled", false)

        tile.state = if (isEnabled) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        tile.label = "PC Ses Senkronu"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.subtitle = if (isEnabled) "Açık (Tel ↔ PC)" else "Kapalı"
        }
        tile.icon = Icon.createWithResource(
            this,
            if (isEnabled) android.R.drawable.ic_lock_silent_mode_off else android.R.drawable.ic_lock_silent_mode
        )
        tile.updateTile()
    }
}
