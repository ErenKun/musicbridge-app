package com.eren.musicbridge

import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import androidx.annotation.RequiresApi

@RequiresApi(Build.VERSION_CODES.N)
class MusicBridgeTileService : TileService() {

    override fun onStartListening() {
        super.onStartListening()
        updateTileState()
    }

    override fun onClick() {
        super.onClick()
        val isRunning = MediaBridgeService.instance != null

        if (isRunning) {
            // Servisi durdur
            val intent = Intent(this, MediaBridgeService::class.java)
            stopService(intent)
        } else {
            // Servisi baslat
            val intent = Intent(this, MediaBridgeService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent)
            } else {
                startService(intent)
            }
        }

        // Kisa gecikme sonrasi guncelle
        qsTile?.let {
            it.state = if (isRunning) Tile.STATE_INACTIVE else Tile.STATE_ACTIVE
            it.label = if (isRunning) "MusicBridge (Kapalı)" else "MusicBridge (Aktif)"
            it.updateTile()
        }
    }

    private fun updateTileState() {
        val tile = qsTile ?: return
        val isRunning = MediaBridgeService.instance != null

        tile.state = if (isRunning) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        tile.label = if (isRunning) "MusicBridge (Aktif)" else "MusicBridge"
        tile.updateTile()
    }
}
