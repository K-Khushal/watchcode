package com.watchcode.ui.theme

import androidx.compose.runtime.Composable
import androidx.wear.compose.material.MaterialTheme

@Composable
fun WatchCodeTheme(content: @Composable () -> Unit) {
    MaterialTheme(content = content)
}
