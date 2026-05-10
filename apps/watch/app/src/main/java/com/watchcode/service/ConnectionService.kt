package com.watchcode.service

import android.content.Context
import android.content.Intent
import android.net.wifi.WifiManager
import android.os.IBinder
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import com.watchcode.BuildConfig
import com.watchcode.net.ClientMessage
import com.watchcode.net.Reconnector
import com.watchcode.net.ServerEvent
import com.watchcode.net.WatchSocket
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Foreground service holding a [WifiManager.WifiLock] and the WebSocket
 * lifecycle. UI binds and consumes [approvals] / [connectionState].
 */
class ConnectionService : LifecycleService() {

    inner class Binder : android.os.Binder() {
        val service: ConnectionService get() = this@ConnectionService
    }

    private val binder = Binder()
    private var wifiLock: WifiManager.WifiLock? = null
    private var loopJob: Job? = null
    private lateinit var socket: WatchSocket
    @Volatile private var destroyed = false

    private val _connectionState = MutableStateFlow(ConnectionState.Disconnected)
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    private val _approvals = MutableStateFlow<List<ServerEvent.ApprovalRequest>>(emptyList())
    val approvals: StateFlow<List<ServerEvent.ApprovalRequest>> = _approvals.asStateFlow()

    override fun onCreate() {
        super.onCreate()
        Notifications.ensureChannel(this)
        startForeground(Notifications.NOTIFICATION_ID, Notifications.build(this, ConnectionState.Connecting))
        wifiLock = (getSystemService(Context.WIFI_SERVICE) as WifiManager)
            .createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "watchcode:wifi")
            .apply { setReferenceCounted(false); acquire() }

        socket = WatchSocket(BuildConfig.DAEMON_URL)
        loopJob = lifecycleScope.launch { runConnectionLoop() }
    }

    private suspend fun runConnectionLoop() {
        val reconnector = Reconnector(
            wifiAvailable = applicationContext.wifiAvailableFlow(),
            connect = { connectAndPump() },
        )
        try {
            reconnector.run()
        } finally {
            updateState(ConnectionState.Disconnected)
        }
    }

    private suspend fun connectAndPump() {
        updateState(ConnectionState.Connecting)
        socket.connect().collect { event ->
            // First message confirms the connection is live.
            if (_connectionState.value != ConnectionState.Connected) {
                updateState(ConnectionState.Connected)
            }
            handle(event)
        }
        // The flow completed without throwing → server closed cleanly. Move to
        // reconnecting and let the loop body retry.
        updateState(ConnectionState.Reconnecting)
        throw IllegalStateException("ws closed")
    }

    private fun handle(event: ServerEvent) {
        when (event) {
            is ServerEvent.ApprovalRequest -> _approvals.update { it + event }
            is ServerEvent.ApprovalResolved -> _approvals.update { list ->
                list.filter { it.id != event.request_id }
            }
            is ServerEvent.DaemonStatus -> Unit // heartbeat; reserved for UI in slice 5
        }
    }

    fun respond(requestId: String, decision: String) {
        val sent = socket.send(ClientMessage.ApprovalResponse(requestId, decision))
        if (sent) {
            // Daemon's `approval_resolved` broadcast will also remove the card,
            // but optimistic removal on a confirmed send keeps the UI snappy.
            _approvals.update { list -> list.filter { it.id != requestId } }
        }
    }

    private fun updateState(state: ConnectionState) {
        if (_connectionState.value == state) return
        _connectionState.value = state
        if (destroyed) return
        // After the initial startForeground in onCreate the system has the
        // notification in foreground state; later updates are safer via the
        // notification manager so we don't accidentally re-promote a service
        // that was just torn down.
        try {
            val mgr = getSystemService(android.app.NotificationManager::class.java)
            mgr?.notify(Notifications.NOTIFICATION_ID, Notifications.build(this, state))
        } catch (_: Throwable) {
            // Notification updates are best-effort; never crash the loop.
        }
    }

    override fun onBind(intent: Intent): IBinder {
        super.onBind(intent)
        return binder
    }

    override fun onDestroy() {
        destroyed = true
        loopJob?.cancel()
        wifiLock?.takeIf { it.isHeld }?.release()
        wifiLock = null
        super.onDestroy()
    }

    companion object {
        fun start(ctx: Context) {
            val intent = Intent(ctx, ConnectionService::class.java)
            androidx.core.content.ContextCompat.startForegroundService(ctx, intent)
        }
    }
}
