package com.watchcode.ui

import android.util.Log
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TextField
import com.watchcode.net.DaemonDiscovery
import com.watchcode.security.NonceCounter
import com.watchcode.security.SecretStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.URL

private const val TAG = "PairingScreen"

@Composable
fun PairingScreen(onPaired: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var code by remember { mutableStateOf("") }
    var statusMsg by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 12.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(text = "Enter pairing code", textAlign = TextAlign.Center)
        Spacer(Modifier.height(8.dp))

        TextField(
            value = code,
            onValueChange = { v ->
                val filtered = v.filter { it.isDigit() || it == '-' }.take(7)
                code = filtered
            },
            placeholder = { Text("000-000") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(8.dp))

        if (loading) {
            CircularProgressIndicator()
        } else {
            Button(
                onClick = {
                    val trimmed = code.trim()
                    if (!trimmed.matches(Regex("\\d{3}-\\d{3}"))) {
                        statusMsg = "Invalid format — use NNN-NNN"
                        return@Button
                    }
                    loading = true
                    statusMsg = "Discovering daemon…"
                    scope.launch {
                        val result = discoverAndPair(context, trimmed)
                        loading = false
                        when (result) {
                            PairResult.NoDaemon -> statusMsg = "No daemon found. Is watchcode running?"
                            PairResult.WrongCode -> statusMsg = "Wrong or expired code. Try again."
                            is PairResult.Success -> {
                                SecretStore(context).save(result.watchId, result.secret)
                                // Reset the nonce counter so the new daemon entry
                                // (last_nonce = 0) and the watch counter are in sync.
                                NonceCounter(context).reset()
                                Log.i(TAG, "paired: watchId=${result.watchId}")
                                onPaired()
                            }
                        }
                    }
                },
                enabled = code.matches(Regex("\\d{3}-\\d{3}")),
            ) {
                Text("Pair")
            }
        }

        if (statusMsg.isNotEmpty()) {
            Spacer(Modifier.height(4.dp))
            Text(text = statusMsg, textAlign = TextAlign.Center)
        }
    }
}

private sealed class PairResult {
    data object NoDaemon : PairResult()
    data object WrongCode : PairResult()
    data class Success(val watchId: String, val secret: String) : PairResult()
}

private suspend fun discoverAndPair(
    context: android.content.Context,
    code: String,
): PairResult = withContext(Dispatchers.IO) {
    val urls = DaemonDiscovery(context).discover()
    if (urls.isEmpty()) return@withContext PairResult.NoDaemon

    // Try each discovered daemon until one accepts the code.
    for (wsUrl in urls) {
        val httpBase = wsUrl.replaceFirst("ws://", "http://").removeSuffix("/ws")
        val result = postPairComplete(httpBase, code)
        if (result != null) return@withContext result
    }
    PairResult.WrongCode
}

private fun postPairComplete(httpBase: String, code: String): PairResult.Success? {
    return try {
        val url = URL("$httpBase/pair/complete")
        val conn = url.openConnection() as java.net.HttpURLConnection
        conn.requestMethod = "POST"
        conn.setRequestProperty("Content-Type", "application/json")
        conn.doOutput = true
        val body = JSONObject().apply {
            put("code", code)
            put("device_name", android.os.Build.MODEL)
        }.toString()
        conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        if (conn.responseCode != 200) return null
        val response = conn.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
        val json = JSONObject(response)
        PairResult.Success(json.getString("watch_id"), json.getString("secret"))
    } catch (t: Throwable) {
        Log.w(TAG, "pair request failed: ${t.message}")
        null
    }
}
