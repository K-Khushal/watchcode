package com.watchcode.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import com.watchcode.net.Decision
import com.watchcode.net.ServerEvent

/**
 * One approval card sized for a Wear OS round screen.
 *
 * Layout (top → bottom):
 *  - slug + cwd pill (single line, ellipsised)
 *  - title (up to 3 lines)
 *  - body preview (up to 2 lines)
 *  - three full-width chips stacked vertically — they always fit on round
 *    screens, where a horizontal row of three buttons would clip.
 */
@Composable
fun ApprovalCard(
    request: ServerEvent.ApprovalRequest,
    onDecision: (Decision) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            text = request.session.slug ?: request.session.cwd_basename,
            style = MaterialTheme.typography.caption1,
            color = Color(0xFFBBBBBB),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = request.tool.title,
            style = MaterialTheme.typography.body2,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = request.tool.body,
            style = MaterialTheme.typography.caption2,
            color = Color(0xFF999999),
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(4.dp))
        Chip(
            label = { Text("Approve") },
            onClick = { onDecision(Decision.APPROVE) },
            colors = ChipDefaults.primaryChipColors(),
            modifier = Modifier.fillMaxWidth(0.85f),
        )
        Chip(
            label = { Text("Always") },
            onClick = { onDecision(Decision.ALWAYS) },
            colors = ChipDefaults.secondaryChipColors(),
            modifier = Modifier.fillMaxWidth(0.85f),
        )
        Chip(
            label = { Text("Deny") },
            onClick = { onDecision(Decision.DENY) },
            colors = ChipDefaults.secondaryChipColors(),
            modifier = Modifier.fillMaxWidth(0.85f),
        )
    }
}
