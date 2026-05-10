package com.watchcode.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.Text

/**
 * Placeholder until Slice 4 (#5) replaces with the real 6-digit pairing flow.
 * Until then the watch connects to a hardcoded BuildConfig.DAEMON_URL.
 */
@Composable
fun PairingScreen() {
    Box(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text = "Pairing comes in Slice 4")
    }
}
