package com.watchcode.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.Card
import androidx.wear.compose.material.CompactChip
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import com.watchcode.net.Decision
import com.watchcode.net.ServerEvent

@Composable
fun ApprovalCard(
    request: ServerEvent.ApprovalRequest,
    onDecision: (Decision) -> Unit,
) {
    Card(
        onClick = { /* card body is not tappable; only buttons act */ },
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
    ) {
        Column(modifier = Modifier.padding(8.dp)) {
            // Slug heading
            Text(
                text = request.session.slug ?: request.session.cwd_basename,
                style = MaterialTheme.typography.title3,
            )
            // cwd_basename pill
            Text(
                text = request.session.cwd_basename,
                style = MaterialTheme.typography.caption2,
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .padding(horizontal = 6.dp, vertical = 2.dp),
                color = Color.Gray,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = request.tool.title,
                style = MaterialTheme.typography.body2,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = request.tool.body,
                style = MaterialTheme.typography.caption1,
                color = Color.LightGray,
            )
            Spacer(Modifier.height(8.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly,
            ) {
                CompactChip(
                    label = { Text("Deny") },
                    onClick = { onDecision(Decision.DENY) },
                )
                CompactChip(
                    label = { Text("Always") },
                    onClick = { onDecision(Decision.ALWAYS) },
                )
                CompactChip(
                    label = { Text("Approve") },
                    onClick = { onDecision(Decision.APPROVE) },
                )
            }
        }
    }
}
