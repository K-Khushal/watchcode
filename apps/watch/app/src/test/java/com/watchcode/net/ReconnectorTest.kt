package com.watchcode.net

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Used to break out of the reconnector's infinite loop after observing the
 * required number of events. Throwing this from `connect` propagates out of
 * the loop (it's not a CancellationException, so `r.run()` will not swallow
 * it, but it IS a Throwable so the loop's catch will sleep + backoff first).
 * To exit cleanly we throw it from `sleep` instead, which is uncaught.
 */
private class StopTest : RuntimeException()

@OptIn(ExperimentalCoroutinesApi::class)
class ReconnectorTest {

    @Test
    fun `backoff sequence follows 1-2-4-8-30 then caps at 30`() = runTest {
        val sleeps = mutableListOf<Long>()
        val target = 7
        val r = Reconnector(
            sleep = {
                sleeps.add(it)
                if (sleeps.size >= target) throw StopTest()
            },
            wifiAvailable = flowOf(true),
            connect = { throw RuntimeException("fail") },
        )
        try { r.run() } catch (_: StopTest) {}

        assertEquals(
            listOf(1_000L, 2_000L, 4_000L, 8_000L, 30_000L, 30_000L, 30_000L),
            sleeps,
        )
    }

    @Test
    fun `success resets attempt counter so next failure starts at 1s`() = runTest {
        val sleeps = mutableListOf<Long>()
        var calls = 0
        val r = Reconnector(
            sleep = {
                sleeps.add(it)
                if (sleeps.size >= 3) throw StopTest()
            },
            wifiAvailable = flowOf(true),
            connect = {
                calls++
                when (calls) {
                    1, 2 -> throw RuntimeException("fail $calls") // 1s, 2s backoff
                    3 -> Unit                                     // success → reset
                    4 -> throw RuntimeException("fail again")     // 1s again
                    else -> Unit
                }
            },
        )
        try { r.run() } catch (_: StopTest) {}

        // First two failures: 1s, 2s. After reset, next failure: 1s again.
        assertEquals(listOf(1_000L, 2_000L, 1_000L), sleeps)
    }

    @Test
    fun `wifi-resume short-circuits the post-sleep wait`() = runTest {
        val wifi = MutableStateFlow(false)
        var calls = 0
        val r = Reconnector(
            backoffMs = listOf(1_000),
            sleep = { /* virtual no-op */ },
            wifiAvailable = wifi,
            connect = {
                calls++
                when (calls) {
                    1 -> throw RuntimeException("first fails")
                    // Use CancellationException so Reconnector's own
                    // `if (e is CancellationException) throw e` cooperatively
                    // exits the loop instead of catching + backing off again.
                    else -> throw kotlinx.coroutines.CancellationException("stop")
                }
            },
        )
        val job = launch {
            try { r.run() } catch (_: kotlinx.coroutines.CancellationException) {}
        }
        advanceUntilIdle()
        assertEquals("should still be parked on wifi.first { it }", 1, calls)
        assertTrue("job should not have finished yet", job.isActive)

        // Wifi resume should unblock the suspended `first { it }`.
        wifi.value = true
        advanceUntilIdle()
        job.join()
        assertEquals("second attempt should have fired after wifi-resume", 2, calls)
    }
}
