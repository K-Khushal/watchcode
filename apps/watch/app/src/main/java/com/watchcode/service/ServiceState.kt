package com.watchcode.service

enum class ConnectionState {
    /** Watch is not yet paired with any daemon. */
    NeedsPairing,
    /** Performing mDNS discovery for the daemon. */
    Searching,
    Disconnected,
    Connecting,
    Connected,
    Reconnecting,
}
