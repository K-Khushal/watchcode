package com.watchcode.service

import android.content.Context
import android.content.Intent
import android.net.wifi.WifiManager
import android.os.IBinder
import android.util.Log
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
        Notifications.ensureChannels(this)
        startForeground(Notifications.NOTIFICATION_ID, Notifications.buildOngoing(this, ConnectionState.Connecting))
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
            is ServerEvent.ApprovalRequest -> {
                Log.i(TAG, "approval_request: id=${event.id} tool=${event.tool.name} title=${event.tool.title}")
                _approvals.update { it + event }
                postApprovalNotification(event)
            }
            is ServerEvent.ApprovalResolved -> {
                Log.i(TAG, "approval_resolved: id=${event.request_id} by=${event.resolved_by}")
                _approvals.update { list -> list.filter { it.id != event.request_id } }
                cancelApprovalNotification()
            }
            is ServerEvent.DaemonStatus -> Unit // heartbeat; quiet by design
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
            mgr?.notify(Notifications.NOTIFICATION_ID, Notifications.buildOngoing(this, state))
        } catch (_: Throwable) {
            // Notification updates are best-effort; never crash the loop.
        }
    }

    private fun postApprovalNotification(req: ServerEvent.ApprovalRequest) {
        try {
            val mgr = getSystemService(android.app.NotificationManager::class.java) ?: return
            mgr.notify(
                Notifications.APPROVAL_NOTIFICATION_ID,
                Notifications.buildApproval(this, req.id, req.tool.title, req.tool.body),
            )
        } catch (_: Throwable) {
            // Notification post is best-effort; the in-app card is the source of truth.
        }
    }

    private fun cancelApprovalNotification() {
        try {
            getSystemService(android.app.NotificationManager::class.java)
                ?.cancel(Notifications.APPROVAL_NOTIFICATION_ID)
        } catch (_: Throwable) {
            // ignore
        }
    }

    override fun onBind(intent: Intent): IBinder {
        super.onBind(intent)
        return binder
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_RESPOND) {
            val id = intent.getStringExtra(EXTRA_REQUEST_ID)
            val decision = intent.getStringExtra(EXTRA_DECISION)
            if (!id.isNullOrEmpty() && !decision.isNullOrEmpty()) {
                Log.i(TAG, "responding from notification: id=$id decision=$decision")
                respond(id, decision)
            }
        }
        return super.onStartCommand(intent, flags, startId)
    }

    override fun onDestroy() {
        destroyed = true
        loopJob?.cancel()
        wifiLock?.takeIf { it.isHeld }?.release()
        wifiLock = null
        super.onDestroy()
    }

    companion object {
        private const val TAG = "WatchCodeService"

        const val ACTION_RESPOND = "com.watchcode.action.RESPOND"
        const val EXTRA_REQUEST_ID = "request_id"
        const val EXTRA_DECISION = "decision"

        fun start(ctx: Context) {
            val intent = Intent(ctx, ConnectionService::class.java)
            androidx.core.content.ContextCompat.startForegroundService(ctx, intent)
        }
    }
}
