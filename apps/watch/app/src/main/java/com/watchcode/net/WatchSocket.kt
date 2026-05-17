package com.watchcode.net

import android.util.Log
import com.watchcode.security.HmacSigner
import com.watchcode.security.NonceCounter
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
 * Thin wrapper over OkHttp WebSocket that emits parsed [ServerEvent] values.
 *
 * On connect, immediately sends a signed `client_hello` using [watchId],
 * [secretHex], and [nonceCounter]. All subsequent [send] calls are also
 * HMAC-signed.
 */
class WatchSocket(
    private val url: String,
    private val watchId: String,
    private val secretHex: String,
    private val nonceCounter: NonceCounter,
    private val client: OkHttpClient = defaultClient(),
    private val json: Json = DEFAULT_JSON,
) {
    private val socket = AtomicReference<WebSocket?>(null)

    fun connect(): Flow<ServerEvent> = callbackFlow {
        Log.i(TAG, "ws connecting: $url")
        val req = Request.Builder().url(url).build()
        val listener = object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.i(TAG, "ws open — sending client_hello")
                socket.set(webSocket)
                // NonceCounter.next() is thread-safe (AtomicLong + synchronous
                // SharedPreferences commit), so it is safe to call here on the
                // OkHttp I/O thread without needing runBlocking or a coroutine.
                // The hello must arrive at the daemon within 5 seconds.
                val nonce = nonceCounter.next()
                val hmac = HmacSigner.sign(
                    type = "client_hello",
                    watchId = watchId,
                    nonce = nonce,
                    secretHex = secretHex,
                    extraFields = mapOf("protocol_version" to 1),
                )
                val hello = ClientMessage.ClientHello(
                    watch_id = watchId,
                    protocol_version = 1,
                    nonce = nonce,
                    hmac = hmac,
                )
                webSocket.send(json.encodeToString(ClientMessage.serializer(), hello))
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val event = json.decodeFromString(ServerEvent.serializer(), text)
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

    fun send(requestId: String, decision: String): Boolean {
        val ws = socket.get() ?: return false
        val nonce = nonceCounter.next()
        val hmac = HmacSigner.sign(
            type = "approval_response",
            watchId = watchId,
            nonce = nonce,
            secretHex = secretHex,
            extraFields = mapOf("decision" to decision, "request_id" to requestId),
        )
        val msg = ClientMessage.ApprovalResponse(
            watch_id = watchId,
            request_id = requestId,
            decision = decision,
            nonce = nonce,
            hmac = hmac,
        )
        return ws.send(json.encodeToString(ClientMessage.serializer(), msg))
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
