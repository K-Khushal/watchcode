package com.watchcode.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat

object Notifications {
    const val CHANNEL_ID = "watchcode_connection"
    const val NOTIFICATION_ID = 1001

    fun ensureChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val mgr = ctx.getSystemService(NotificationManager::class.java) ?: return
        if (mgr.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "WatchCode connection",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Persistent connection to the WatchCode daemon"
            setShowBadge(false)
        }
        mgr.createNotificationChannel(channel)
    }

    fun build(ctx: Context, state: ConnectionState): Notification =
        NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setContentTitle("WatchCode")
            .setContentText(stateText(state))
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()

    private fun stateText(state: ConnectionState): String = when (state) {
        ConnectionState.Disconnected -> "Disconnected"
        ConnectionState.Connecting -> "Connecting…"
        ConnectionState.Connected -> "Connected"
        ConnectionState.Reconnecting -> "Reconnecting…"
    }
}
