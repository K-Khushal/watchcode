package com.watchcode.net

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.util.Log
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume

private const val TAG = "DaemonDiscovery"
private const val SERVICE_TYPE = "_watchcode._tcp."
// 4 s is enough for a real LAN mDNS response; on the emulator mDNS
// never resolves so we fail fast and fall back to 127.0.0.1 / 10.0.2.2.
private const val DISCOVERY_TIMEOUT_MS = 4_000L

/**
 * Discovers a running watchcode daemon on the local network via mDNS.
 *
 * Returns all resolved service addresses (host:port) within the discovery
 * window. If no services are found, returns an empty list.
 */
class DaemonDiscovery(private val context: Context) {

    suspend fun discover(): List<String> {
        val nsdManager = context.getSystemService(Context.NSD_SERVICE) as? NsdManager
            ?: return emptyList()

        val found = mutableListOf<NsdServiceInfo>()
        val resolvedUrls = mutableListOf<String>()

        // Guards against multiple onServiceResolved callbacks racing to resume
        // the continuation.  stopServiceDiscovery is asynchronous, so a second
        // resolved callback can arrive before discovery actually stops.
        val resumed = AtomicBoolean(false)

        // Collect all discovered services within the timeout window.
        val firstResult = withTimeoutOrNull(DISCOVERY_TIMEOUT_MS) {
            suspendCancellableCoroutine { cont ->
                // lateinit var instead of val so the object body can reference
                // `listener` itself (e.g. to call stopServiceDiscovery).
                // The variable is assigned before discoverServices is called,
                // so all callbacks see the fully-initialized reference.
                lateinit var listener: NsdManager.DiscoveryListener
                listener = object : NsdManager.DiscoveryListener {
                    override fun onStartDiscoveryFailed(type: String, code: Int) {
                        Log.w(TAG, "startDiscovery failed: $code")
                        if (cont.isActive) cont.resume(null)
                    }

                    override fun onStopDiscoveryFailed(type: String, code: Int) {
                        Log.w(TAG, "stopDiscovery failed: $code")
                    }

                    override fun onDiscoveryStarted(type: String) {
                        Log.i(TAG, "discovery started for $type")
                    }

                    override fun onDiscoveryStopped(type: String) {
                        Log.i(TAG, "discovery stopped")
                    }

                    override fun onServiceFound(info: NsdServiceInfo) {
                        Log.i(TAG, "found: ${info.serviceName}")
                        nsdManager.resolveService(info, object : NsdManager.ResolveListener {
                            override fun onResolveFailed(i: NsdServiceInfo, code: Int) {
                                Log.w(TAG, "resolve failed: $code for ${i.serviceName}")
                            }

                            override fun onServiceResolved(resolved: NsdServiceInfo) {
                                Log.i(TAG, "resolved: ${resolved.serviceName} → ${resolved.host}:${resolved.port}")
                                // compareAndSet ensures only the first resolved service
                                // resumes the coroutine; subsequent callbacks are ignored.
                                if (resumed.compareAndSet(false, true)) {
                                    found.add(resolved)
                                    // Stop discovery before resuming so the listener isn't
                                    // left running after the coroutine exits.
                                    try { nsdManager.stopServiceDiscovery(listener) } catch (_: Throwable) {}
                                    if (cont.isActive) cont.resume(resolved)
                                }
                            }
                        })
                    }

                    override fun onServiceLost(info: NsdServiceInfo) {
                        Log.i(TAG, "lost: ${info.serviceName}")
                    }
                }

                nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
                cont.invokeOnCancellation {
                    try { nsdManager.stopServiceDiscovery(listener) } catch (_: Throwable) {}
                }
            }
        }

        for (info in found) {
            val host = info.host?.hostAddress ?: continue
            resolvedUrls.add("ws://$host:${info.port}/ws")
        }
        if (firstResult != null && resolvedUrls.isEmpty()) {
            val host = firstResult.host?.hostAddress ?: return emptyList()
            resolvedUrls.add("ws://$host:${firstResult.port}/ws")
        }

        return resolvedUrls
    }
}
