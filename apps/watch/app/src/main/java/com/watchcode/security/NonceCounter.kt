package com.watchcode.security

import android.content.Context
import android.content.SharedPreferences
import java.util.concurrent.atomic.AtomicLong

/**
 * Monotonic nonce counter persisted in plain SharedPreferences (not encrypted —
 * the nonce value is not secret, only the HMAC key is).
 *
 * The counter is incremented and persisted BEFORE the message is sent so that a
 * crash between persist and send advances the counter safely (next send uses
 * nonce+2, which the daemon accepts because it requires only nonce > last_nonce).
 *
 * Thread-safety: [AtomicLong.incrementAndGet] is lock-free, and
 * [SharedPreferences.Editor.commit] flushes synchronously. Together they make
 * [next] safe to call from any thread — including OkHttp's I/O thread inside
 * [okhttp3.WebSocketListener.onOpen] — without needing a coroutine scope or
 * runBlocking.
 *
 * Precision ceiling: nonces are [Long] (64-bit signed) on the watch side. The
 * daemon stores last_nonce as a JavaScript Number (IEEE-754 float64), which
 * represents integers exactly up to 2^53 − 1 ≈ 9 × 10¹⁵. At one message per
 * second, a watch would take ~285 million years to reach that ceiling, so this
 * is not a practical concern.
 */
class NonceCounter(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences(FILE_NAME, Context.MODE_PRIVATE)

    // Seed from persisted value so the counter survives app restarts.
    private val counter = AtomicLong(prefs.getLong(KEY_NONCE, 0L))

    /**
     * Returns the next nonce. The new value is committed to disk synchronously
     * before this function returns, ensuring durability across crashes.
     */
    fun next(): Long {
        val next = counter.incrementAndGet()
        prefs.edit().putLong(KEY_NONCE, next).commit()
        return next
    }

    /** Resets the counter to zero (used when re-pairing). */
    fun reset() {
        counter.set(0L)
        prefs.edit().remove(KEY_NONCE).apply()
    }

    companion object {
        private const val FILE_NAME = "watchcode_nonce"
        private const val KEY_NONCE = "nonce"
    }
}
