package com.watchcode.net

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * Mirrors `packages/shared/src/protocol.ts`. HMAC fields are reserved for
 * Slice 4 and ignored by the daemon in Slice 3.
 */

@Serializable
data class SessionInfo(
    val id: String,
    val slug: String? = null,
    val cwd_basename: String,
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
    @SerialName("approval_response")
    data class ApprovalResponse(
        val request_id: String,
        val decision: String,
    ) : ClientMessage()
}

enum class Decision(val wire: String) {
    APPROVE("approve"),
    ALWAYS("always"),
    DENY("deny"),
}
