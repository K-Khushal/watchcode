package com.watchcode.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.watchcode.MainActivity

object Notifications {
    private const val ONGOING_CHANNEL_ID = "watchcode_connection"
    private const val APPROVAL_CHANNEL_ID = "watchcode_approvals"
    const val NOTIFICATION_ID = 1001
    const val APPROVAL_NOTIFICATION_ID = 1002

    fun ensureChannels(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val mgr = ctx.getSystemService(NotificationManager::class.java) ?: return
        if (mgr.getNotificationChannel(ONGOING_CHANNEL_ID) == null) {
            mgr.createNotificationChannel(
                NotificationChannel(
                    ONGOING_CHANNEL_ID,
                    "WatchCode connection",
                    NotificationManager.IMPORTANCE_LOW,
                ).apply {
                    description = "Persistent connection to the WatchCode daemon"
                    setShowBadge(false)
                },
            )
        }
        if (mgr.getNotificationChannel(APPROVAL_CHANNEL_ID) == null) {
            mgr.createNotificationChannel(
                NotificationChannel(
                    APPROVAL_CHANNEL_ID,
                    "Approval requests",
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = "Buzz + heads-up when Claude needs a permission decision"
                    enableVibration(true)
                },
            )
        }
    }

    fun buildOngoing(ctx: Context, state: ConnectionState): Notification =
        NotificationCompat.Builder(ctx, ONGOING_CHANNEL_ID)
            .setContentTitle("WatchCode")
            .setContentText(stateText(state))
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(openAppIntent(ctx))
            .build()

    fun buildApproval(ctx: Context, requestId: String, title: String, body: String): Notification {
        val approve = action(ctx, requestId, "approve", "Approve")
        val always = action(ctx, requestId, "always", "Always")
        val deny = action(ctx, requestId, "deny", "Deny")
        val wearable = NotificationCompat.WearableExtender()
            .addAction(approve)
            .addAction(always)
            .addAction(deny)
            .setContentAction(0)
        return NotificationCompat.Builder(ctx, APPROVAL_CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(ctx))
            .setFullScreenIntent(openAppIntent(ctx), true)
            // Phone-style actions are kept on the notification too for parity.
            .addAction(approve)
            .addAction(always)
            .addAction(deny)
            .extend(wearable)
            .build()
    }

    private fun openAppIntent(ctx: Context): PendingIntent {
        val intent = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        return PendingIntent.getActivity(
            ctx,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun action(
        ctx: Context,
        requestId: String,
        decision: String,
        label: String,
    ): NotificationCompat.Action {
        val intent = Intent(ctx, ConnectionService::class.java).apply {
            action = ConnectionService.ACTION_RESPOND
            putExtra(ConnectionService.EXTRA_REQUEST_ID, requestId)
            putExtra(ConnectionService.EXTRA_DECISION, decision)
        }
        // Distinct request code per (id, decision) so the three actions don't
        // collide in the PendingIntent cache.
        val rc = (requestId.hashCode() * 31 + decision.hashCode())
        val pi = PendingIntent.getService(
            ctx,
            rc,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Action.Builder(0, label, pi).build()
    }

    private fun stateText(state: ConnectionState): String = when (state) {
        ConnectionState.Disconnected -> "Disconnected"
        ConnectionState.Connecting -> "Connecting…"
        ConnectionState.Connected -> "Connected"
        ConnectionState.Reconnecting -> "Reconnecting…"
    }
}
