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
 * Emits true while at least one validated WiFi network has internet capability.
 * Used by [com.watchcode.net.Reconnector] to short-circuit backoff when the
 * watch comes back to a usable network.
 */
fun Context.wifiAvailableFlow(): Flow<Boolean> = callbackFlow {
    val cm = getSystemService(ConnectivityManager::class.java)
    if (cm == null) {
        trySend(false)
        awaitClose { }
        return@callbackFlow
    }
    val request = NetworkRequest.Builder()
        .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
        .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        .addCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        .build()
    val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) { trySend(true) }
        override fun onLost(network: Network) { trySend(false) }
    }
    cm.registerNetworkCallback(request, callback)
    // Seed with current state.
    val seed = cm.activeNetwork
        ?.let(cm::getNetworkCapabilities)
        ?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
    trySend(seed)
    awaitClose { runCatching { cm.unregisterNetworkCallback(callback) } }
}.distinctUntilChanged()
