package com.watchcode.net

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ReconnectorTest {

    @Test
    fun `backoff sequence follows 1-2-4-8-30 then caps at 30`() = runTest {
        val sleeps = mutableListOf<Long>()
        val r = Reconnector(
            sleep = { sleeps.add(it) },
            wifiAvailable = flowOf(true),
            connect = { throw RuntimeException("fail") },
        )
        val job = launch { r.run() }
        // Let the loop spin enough times to cover the cap.
        advanceUntilIdle()
        job.cancel()

        // Take only the first 7 to assert; loop continues forever.
        val taken = sleeps.take(7)
        assertEquals(
            listOf(1_000L, 2_000L, 4_000L, 8_000L, 30_000L, 30_000L, 30_000L),
            taken,
        )
    }

    @Test
    fun `success resets attempt counter so next failure starts at 1s`() = runTest {
        val sleeps = mutableListOf<Long>()
        var calls = 0
        val r = Reconnector(
            sleep = { sleeps.add(it) },
            wifiAvailable = flowOf(true),
            connect = {
                calls++
                when (calls) {
                    1, 2 -> throw RuntimeException("fail $calls") // expects 1s, 2s
                    3 -> Unit                                     // success → reset
                    4 -> throw RuntimeException("fail again")     // expects 1s again
                    else -> { /* success thereafter */ }
                }
            },
        )
        val job = launch { r.run() }
        advanceUntilIdle()
        job.cancel()

        // First two failures: 1s, 2s. After reset, next failure: 1s again.
        assertEquals(listOf(1_000L, 2_000L, 1_000L), sleeps.take(3))
    }

    @Test
    fun `wifi-resume short-circuits the post-sleep wait`() = runTest {
        val wifi = MutableStateFlow(false)
        val attempts = CompletableDeferred<Unit>()
        var calls = 0
        val r = Reconnector(
            backoffMs = listOf(1_000),
            sleep = { /* skip the timed sleep */ },
            wifiAvailable = wifi,
            connect = {
                calls++
                if (calls == 1) throw RuntimeException("first fails")
                attempts.complete(Unit)
            },
        )
        val job = launch { r.run() }
        // While wifi is false the loop is parked at `wifiAvailable.first { it }`
        advanceUntilIdle()
        assertTrue("should not have reconnected yet", !attempts.isCompleted)

        wifi.value = true
        advanceUntilIdle()
        assertTrue("should have reconnected after wifi resume", attempts.isCompleted)
        job.cancel()
    }
}
