package com.watchcode

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import com.watchcode.ui.theme.WatchCodeTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            WatchCodeTheme {
                HelloWatchCode()
            }
        }
    }
}

@Composable
fun HelloWatchCode() {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center,
    ) {
        Text(text = "Hello WatchCode")
    }
}

@Preview(device = "id:wearos_small_round", showSystemUi = true)
@Composable
fun HelloWatchCodePreview() {
    WatchCodeTheme {
        HelloWatchCode()
    }
}
