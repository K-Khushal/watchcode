package com.watchcode.net

import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * Thin wrapper over OkHttp WebSocket that emits parsed `ServerEvent` values.
 * The flow throws on socket failure so [Reconnector] can drive backoff.
 */
class WatchSocket(
    private val url: String,
    private val client: OkHttpClient = defaultClient(),
    private val json: Json = DEFAULT_JSON,
) {
    private val socket = AtomicReference<WebSocket?>(null)

    fun connect(): Flow<ServerEvent> = callbackFlow {
        val req = Request.Builder().url(url).build()
        val listener = object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                socket.set(webSocket)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val event = json.decodeFromString(ServerEvent.serializer(), text)
                    trySend(event)
                } catch (_: Throwable) {
                    // Ignore unrecognised messages — forward-compat with new types.
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, reason)
                close(IllegalStateException("ws closing: $code $reason"))
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                close(t)
            }
        }
        val ws = client.newWebSocket(req, listener)
        awaitClose {
            socket.set(null)
            ws.close(1000, "client closed")
        }
    }

    fun send(msg: ClientMessage): Boolean {
        val ws = socket.get() ?: return false
        val text = json.encodeToString(ClientMessage.serializer(), msg)
        return ws.send(text)
    }

    companion object {
        val DEFAULT_JSON = Json {
            ignoreUnknownKeys = true
            classDiscriminator = "type"
        }

        fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .pingInterval(20, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .build()
    }
}
