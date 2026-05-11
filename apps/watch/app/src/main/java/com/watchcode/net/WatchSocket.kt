package com.watchcode.net

import android.util.Log
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
        Log.i(TAG, "ws connecting: $url")
        val req = Request.Builder().url(url).build()
        val listener = object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.i(TAG, "ws open")
                socket.set(webSocket)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                Log.d(TAG, "ws message: ${text.take(200)}")
                try {
                    val event = json.decodeFromString(ServerEvent.serializer(), text)
                    Log.d(TAG, "parsed ${event.javaClass.simpleName}")
                    trySend(event)
                } catch (t: Throwable) {
                    Log.w(TAG, "parse failed: ${t.message}")
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                Log.i(TAG, "ws closing: $code $reason")
                webSocket.close(code, reason)
                close(IllegalStateException("ws closing: $code $reason"))
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.w(TAG, "ws failure: ${t.message}")
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
        Log.i(TAG, "ws send: $text")
        return ws.send(text)
    }

    companion object {
        private const val TAG = "WatchSocket"

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
