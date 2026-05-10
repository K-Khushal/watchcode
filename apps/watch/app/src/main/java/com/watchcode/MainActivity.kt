package com.watchcode

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import com.watchcode.service.ConnectionService
import com.watchcode.ui.QueueScreen
import com.watchcode.ui.theme.WatchCodeTheme
import com.watchcode.viewmodel.ApprovalViewModel

class MainActivity : ComponentActivity() {

    private val viewModel: ApprovalViewModel by viewModels()

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName, binder: IBinder) {
            val svc = (binder as ConnectionService.Binder).service
            viewModel.bind(svc)
        }

        override fun onServiceDisconnected(name: ComponentName) {
            viewModel.unbind()
        }
    }

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { /* result intentionally ignored — service starts either way */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ensureNotificationPermission()
        ConnectionService.start(this)
        bindService(
            Intent(this, ConnectionService::class.java),
            serviceConnection,
            Context.BIND_AUTO_CREATE,
        )
        setContent {
            WatchCodeTheme {
                AppRoot(viewModel)
            }
        }
    }

    private fun ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val granted = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
        if (!granted) notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    override fun onDestroy() {
        runCatching { unbindService(serviceConnection) }
        viewModel.unbind()
        super.onDestroy()
    }
}

@Composable
private fun AppRoot(viewModel: ApprovalViewModel) {
    Box(modifier = Modifier.fillMaxSize()) {
        QueueScreen(viewModel)
    }
}
