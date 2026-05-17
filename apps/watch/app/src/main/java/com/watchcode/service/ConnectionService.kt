package com.watchcode.service

import android.content.Context
import android.content.Intent
import android.net.wifi.WifiManager
import android.os.IBinder
import android.util.Log
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import com.watchcode.net.ClientMessage
import com.watchcode.net.DaemonDiscovery
import com.watchcode.net.Reconnector
import com.watchcode.net.ServerEvent
import com.watchcode.net.WatchSocket
import com.watchcode.security.NonceCounter
import com.watchcode.security.SecretStore
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Foreground service holding a [WifiManager.WifiLock] and the WebSocket
 * lifecycle. UI binds and consumes [approvals] / [connectionState].
 *
 * Slice 4: uses [DaemonDiscovery] (mDNS) to find the daemon URL and
 * [SecretStore] + [NonceCounter] for HMAC-signed messages.
 */
class ConnectionService : LifecycleService() {

    inner class Binder : android.os.Binder() {
        val service: ConnectionService get() = this@ConnectionService
    }

    private val binder = Binder()
    private var wifiLock: WifiManager.WifiLock? = null
    private var loopJob: Job? = null
    private var socket: WatchSocket? = null
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

        loopJob = lifecycleScope.launch { runConnectionLoop() }
    }

    private suspend fun runConnectionLoop() {
        val secretStore = SecretStore(this)
        if (!secretStore.isPaired) {
            Log.i(TAG, "not paired — waiting for pairing")
            updateState(ConnectionState.NeedsPairing)
            return
        }

        val reconnector = Reconnector(
            wifiAvailable = applicationContext.wifiAvailableFlow(),
            connect = { connectAndPump(secretStore) },
        )
        try {
            reconnector.run()
        } finally {
            updateState(ConnectionState.Disconnected)
        }
    }

    private suspend fun connectAndPump(secretStore: SecretStore) {
        updateState(ConnectionState.Searching)
        val discovery = DaemonDiscovery(this)
        val urls = discovery.discover()
        if (urls.isEmpty()) {
            Log.w(TAG, "mDNS: no daemon found")
            throw IllegalStateException("no daemon found via mDNS")
        }

        val url = urls.first()
        Log.i(TAG, "connecting to $url")

        val nonceCounter = NonceCounter(this)
        val ws = WatchSocket(
            url = url,
            watchId = secretStore.watchId!!,
            secretHex = secretStore.secret!!,
            nonceCounter = nonceCounter,
        )
        socket = ws

        updateState(ConnectionState.Connecting)
        ws.connect().collect { event ->
            if (_connectionState.value != ConnectionState.Connected) {
                updateState(ConnectionState.Connected)
            }
            handle(event)
        }
        updateState(ConnectionState.Reconnecting)
        throw IllegalStateException("ws closed")
    }

    private fun handle(event: ServerEvent) {
        when (event) {
            is ServerEvent.ApprovalRequest -> {
                Log.i(TAG, "approval_request: id=${event.id} tool=${event.tool.name}")
                _approvals.update { it + event }
                postApprovalNotification(event)
            }
            is ServerEvent.ApprovalResolved -> {
                Log.i(TAG, "approval_resolved: id=${event.request_id} by=${event.resolved_by}")
                _approvals.update { list -> list.filter { it.id != event.request_id } }
                cancelApprovalNotification()
            }
            is ServerEvent.DaemonStatus -> Unit
        }
    }

    fun respond(requestId: String, decision: String) {
        val ws = socket ?: return
        lifecycleScope.launch {
            val sent = ws.send(requestId, decision)
            if (sent) {
                _approvals.update { list -> list.filter { it.id != requestId } }
            }
        }
    }

    private fun updateState(state: ConnectionState) {
        if (_connectionState.value == state) return
        _connectionState.value = state
        if (destroyed) return
        try {
            val mgr = getSystemService(android.app.NotificationManager::class.java)
            mgr?.notify(Notifications.NOTIFICATION_ID, Notifications.buildOngoing(this, state))
        } catch (_: Throwable) {}
    }

    private fun postApprovalNotification(req: ServerEvent.ApprovalRequest) {
        try {
            getSystemService(android.app.NotificationManager::class.java)?.notify(
                Notifications.APPROVAL_NOTIFICATION_ID,
                Notifications.buildApproval(this, req.id, req.tool.title, req.tool.body),
            )
        } catch (_: Throwable) {}
    }

    private fun cancelApprovalNotification() {
        try {
            getSystemService(android.app.NotificationManager::class.java)
                ?.cancel(Notifications.APPROVAL_NOTIFICATION_ID)
        } catch (_: Throwable) {}
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
            androidx.core.content.ContextCompat.startForegroundService(ctx, Intent(ctx, ConnectionService::class.java))
        }
    }
}
