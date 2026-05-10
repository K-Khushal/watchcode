package com.watchcode.net

import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlin.math.min

/**
 * Drives the reconnect loop with exponential backoff [1, 2, 4, 8, 30] seconds.
 * Pure Kotlin — Android dependencies are injected so the class is unit-testable
 * without an emulator.
 *
 * Behavior contract:
 *  - On a successful `connect()` (returns normally) the attempt counter resets.
 *  - On failure the loop sleeps `BACKOFF_MS[min(attempt, last)]` ms, then
 *    waits for `wifiAvailable` to be true (short-circuit on resume).
 */
class Reconnector(
    private val backoffMs: List<Long> = DEFAULT_BACKOFF_MS,
    private val sleep: suspend (Long) -> Unit = { delay(it) },
    private val wifiAvailable: Flow<Boolean>,
    private val connect: suspend () -> Unit,
) {
    suspend fun run() {
        var attempt = 0
        while (true) {
            try {
                connect()
                attempt = 0
            } catch (e: Throwable) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                val wait = backoffMs[min(attempt, backoffMs.lastIndex)]
                attempt++
                sleep(wait)
                // Short-circuit when WiFi comes back: skip the rest of the
                // backoff and try immediately on the next iteration.
                wifiAvailable.first { it }
            }
        }
    }

    companion object {
        val DEFAULT_BACKOFF_MS: List<Long> = listOf(1_000, 2_000, 4_000, 8_000, 30_000)
    }
}
