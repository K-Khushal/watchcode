package com.watchcode.service

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged

/**
 * Emits true while the watch has *any* validated network with internet
 * capability — WiFi, cellular, or a tethered companion. Used by
 * [com.watchcode.net.Reconnector] to short-circuit backoff when the watch
 * regains connectivity. Restricting to WiFi alone strands the watch when
 * it falls back to LTE on a real device (or when an emulator is on cellular).
 */
fun Context.wifiAvailableFlow(): Flow<Boolean> = callbackFlow {
    val cm = getSystemService(ConnectivityManager::class.java)
    if (cm == null) {
        trySend(false)
        awaitClose { }
        return@callbackFlow
    }
    val request = NetworkRequest.Builder()
        .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        .addCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        .build()
    val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) { trySend(true) }
        override fun onLost(network: Network) { trySend(false) }
    }
    cm.registerNetworkCallback(request, callback)
    // Seed with current state — any active network with internet means we can try.
    val seed = cm.activeNetwork
        ?.let(cm::getNetworkCapabilities)
        ?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
    trySend(seed)
    awaitClose { runCatching { cm.unregisterNetworkCallback(callback) } }
}.distinctUntilChanged()
