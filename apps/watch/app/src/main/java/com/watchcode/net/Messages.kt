package com.watchcode.net

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * Mirrors `packages/shared/src/protocol.ts`.
 * Slice 4: HMAC + nonce fields required on all outbound messages.
 */

@Serializable
data class SessionInfo(
    val id: String,
    val slug: String? = null,
    val cwd_basename: String,
    // Slice 5: `.watchcode.json { "name": ... }` upward-walk override.
    // Takes precedence over slug as the heading on the watch card.
    val project_name: String? = null,
)

@Serializable
data class ToolInfo(
    val name: String,
    val title: String,
    val body: String,
    val raw_input: JsonObject = JsonObject(emptyMap()),
)

@Serializable
sealed class ServerEvent {
    @Serializable
    @SerialName("approval_request")
    data class ApprovalRequest(
        val id: String,
        val session: SessionInfo,
        val tool: ToolInfo,
        val timestamp: String,
    ) : ServerEvent()

    @Serializable
    @SerialName("approval_resolved")
    data class ApprovalResolved(
        val request_id: String,
        val resolved_by: String,
        val decision: String,
    ) : ServerEvent()

    @Serializable
    @SerialName("daemon_status")
    data class DaemonStatus(
        val active_sessions: Int,
        val pending_count: Int,
        val version: String,
    ) : ServerEvent()
}

@Serializable
sealed class ClientMessage {
    @Serializable
    @SerialName("client_hello")
    data class ClientHello(
        val watch_id: String,
        val protocol_version: Int = 1,
        val nonce: Long,
        val hmac: String,
    ) : ClientMessage()

    @Serializable
    @SerialName("approval_response")
    data class ApprovalResponse(
        val watch_id: String,
        val request_id: String,
        val decision: String,
        val nonce: Long,
        val hmac: String,
    ) : ClientMessage()
}

enum class Decision(val wire: String) {
    APPROVE("approve"),
    ALWAYS("always"),
    DENY("deny"),
}
