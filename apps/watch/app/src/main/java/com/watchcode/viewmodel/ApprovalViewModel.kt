package com.watchcode.viewmodel

import android.content.Context
import android.content.Intent
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.watchcode.net.Decision
import com.watchcode.net.ServerEvent
import com.watchcode.service.ConnectionService
import com.watchcode.service.ConnectionState
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class ApprovalViewModel : ViewModel() {

    private val _approvals = MutableStateFlow<List<ServerEvent.ApprovalRequest>>(emptyList())
    val approvals: StateFlow<List<ServerEvent.ApprovalRequest>> = _approvals.asStateFlow()

    private val _connectionState = MutableStateFlow(ConnectionState.Disconnected)
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    private var bound: ConnectionService? = null
    private var appContext: Context? = null

    fun bind(service: ConnectionService) {
        bound = service
        appContext = service.applicationContext
        viewModelScope.launch { service.approvals.collect { _approvals.value = it } }
        viewModelScope.launch { service.connectionState.collect { _connectionState.value = it } }
    }

    fun unbind() {
        bound = null
    }

    fun respond(requestId: String, decision: Decision) {
        bound?.respond(requestId, decision.wire)
    }

    /** Called after successful pairing to restart the connection service. */
    fun restartService() {
        val ctx = appContext ?: return
        ctx.stopService(Intent(ctx, ConnectionService::class.java))
        ConnectionService.start(ctx)
    }
}
