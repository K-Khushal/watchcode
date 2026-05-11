package com.watchcode.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.material.Text
import com.watchcode.net.Decision
import com.watchcode.viewmodel.ApprovalViewModel

@Composable
fun QueueScreen(vm: ApprovalViewModel) {
    val approvals by vm.approvals.collectAsState()
    val state by vm.connectionState.collectAsState()

    if (approvals.isEmpty()) {
        Box(
            modifier = Modifier.fillMaxSize().padding(16.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(text = "No pending approvals\n($state)")
        }
        return
    }

    ScalingLazyColumn(modifier = Modifier.fillMaxSize()) {
        items(
            count = approvals.size,
            key = { idx -> approvals[idx].id },
        ) { idx ->
            val req = approvals[idx]
            ApprovalCard(
                request = req,
                onDecision = { decision: Decision -> vm.respond(req.id, decision) },
            )
        }
    }
}
