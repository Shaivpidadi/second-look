package com.secondlook.android.ui

import android.app.Activity
import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import com.secondlook.android.debug.MockPanel
import com.secondlook.android.session.SessionViewModel
import com.secondlook.core.api.LiveVerdict
import com.secondlook.core.api.verdictLabel

/** Root: registration until REGISTERED, then the camera screen. */
@Composable
fun MainScreen(viewModel: SessionViewModel, activity: Activity) {
    val registered by viewModel.isRegistered.collectAsState()
    var showPreflight by remember { mutableStateOf(false) }
    if (showPreflight) {
        PreflightScreen(viewModel, onBack = { showPreflight = false })
    } else if (registered) {
        CameraScreen(viewModel, onPreflight = { showPreflight = true })
    } else {
        RegistrationScreen(viewModel, activity, onPreflight = { showPreflight = true })
    }
}

@Composable
fun RegistrationScreen(viewModel: SessionViewModel, activity: Activity, onPreflight: () -> Unit) {
    val granted by viewModel.cameraGranted.collectAsState()
    val failure by viewModel.failure.collectAsState()
    var url by remember { mutableStateOf(viewModel.serverUrl) }
    Column(
        modifier = Modifier.fillMaxSize().padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Second Look", style = MaterialTheme.typography.headlineMedium)
        Text(
            "Register with Meta AI, grant the camera permission, then stream.",
            style = MaterialTheme.typography.bodyMedium,
        )
        OutlinedTextField(
            value = url,
            onValueChange = {
                url = it
                viewModel.setServerUrl(it)
            },
            label = { Text("Server URL") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Text("Session: ${viewModel.sessionId}", style = MaterialTheme.typography.bodySmall)
        Text(
            "Camera permission: ${granted?.let { if (it) "granted" else "denied" } ?: "unknown"}",
            style = MaterialTheme.typography.bodySmall,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { viewModel.register(activity) }) { Text("Register") }
            OutlinedButton(onClick = { viewModel.refreshPermission() }) { Text("Check camera") }
            OutlinedButton(onClick = onPreflight) { Text("Check setup") }
        }
        failure?.let {
            Text(it.detail, color = MaterialTheme.colorScheme.error)
            OutlinedButton(onClick = { viewModel.clearFailure() }) { Text("Dismiss") }
        }
        MockPanel()
    }
}

@Composable
fun CameraScreen(viewModel: SessionViewModel, onPreflight: () -> Unit) {
    val sessionState by viewModel.sessionState.collectAsState()
    val streaming by viewModel.streaming.collectAsState()
    val preview by viewModel.preview.collectAsState()
    val verdicts by viewModel.verdicts.collectAsState()
    val frames by viewModel.framesPosted.collectAsState()
    val failure by viewModel.failure.collectAsState()
    val usePhone by viewModel.usePhoneCamera.collectAsState()
    val fps by viewModel.streamFps.collectAsState()
    val swapped by viewModel.chromaSwapped.collectAsState()
    val speak by viewModel.speakVerdicts.collectAsState()
    val tone by viewModel.cleanTone.collectAsState()
    Column(
        modifier = Modifier.fillMaxSize().padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Session ${viewModel.sessionId.take(8)} · $sessionState")
        PreviewFrame(preview)
        Text("Frames posted: $frames", style = MaterialTheme.typography.bodySmall)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { viewModel.toggleCameraSource() }, enabled = !streaming) {
                Text(if (usePhone) "Source: phone" else "Source: glasses")
            }
            OutlinedButton(onClick = { viewModel.toggleChromaSwapped() }) {
                Text(if (swapped) "Chroma: swapped" else "Chroma: normal")
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { viewModel.setStreamFps(fps - 1) }, enabled = fps > 2) {
                Text("-")
            }
            Text("$fps fps", modifier = Modifier.padding(vertical = 8.dp))
            OutlinedButton(onClick = { viewModel.setStreamFps(fps + 1) }, enabled = fps < 7) {
                Text("+")
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { viewModel.toggleSpeakVerdicts() }) {
                Text(if (speak) "Speech: on" else "Speech: off")
            }
            OutlinedButton(onClick = { viewModel.toggleCleanTone() }) {
                Text(if (tone) "Clean tone: on" else "Clean tone: off")
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { viewModel.start() }, enabled = !streaming) { Text("Start") }
            OutlinedButton(onClick = { viewModel.stop() }, enabled = streaming) { Text("Stop") }
            OutlinedButton(onClick = onPreflight, enabled = !streaming) { Text("Check setup") }
        }
        failure?.let {
            Text(it.detail, color = MaterialTheme.colorScheme.error)
            OutlinedButton(onClick = { viewModel.clearFailure() }) { Text("Dismiss") }
        }
        Text("Verdicts", style = MaterialTheme.typography.titleMedium)
        VerdictList(verdicts)
        MockPanel()
    }
}

@Composable
fun PreviewFrame(bitmap: Bitmap?) {
    Card(modifier = Modifier.fillMaxWidth().height(220.dp)) {
        if (bitmap == null) {
            Text(
                "No frames yet",
                modifier = Modifier.padding(16.dp),
                style = MaterialTheme.typography.bodyMedium,
            )
        } else {
            Image(
                bitmap = remember(bitmap) { bitmap.asImageBitmap() },
                contentDescription = "Latest glasses frame",
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

@Composable
fun VerdictList(verdicts: List<LiveVerdict>) {
    if (verdicts.isEmpty()) {
        Text("Verdicts stream here once frames upload.", style = MaterialTheme.typography.bodyMedium)
        return
    }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items(verdicts, key = { it.seq }) { verdict ->
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Text(
                        "#${verdict.seq} ${verdictLabel(verdict.state)} · ${verdict.fieldId}",
                        style = MaterialTheme.typography.titleSmall,
                    )
                    Spacer(Modifier.height(4.dp))
                    if (verdict.failures.isEmpty()) {
                        Text("No failures.", style = MaterialTheme.typography.bodySmall)
                    } else {
                        verdict.failures.forEach { failure ->
                            Text(
                                "${failure.fieldId}: ${failure.message}" +
                                    (failure.fix?.let { " -> fix $it" } ?: ""),
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                    }
                }
            }
        }
    }
}

/** Demo-day setup check: one pass/fail row per item, with fix hints. */
@Composable
fun PreflightScreen(viewModel: SessionViewModel, onBack: () -> Unit) {
    val report by viewModel.preflight.collectAsState()
    val running by viewModel.preflightRunning.collectAsState()
    LaunchedEffect(Unit) {
        viewModel.runPreflight()
    }
    Column(
        modifier = Modifier.fillMaxSize().padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Check setup", style = MaterialTheme.typography.headlineMedium)
        if (running && report == null) {
            Text("Checking...", style = MaterialTheme.typography.bodyMedium)
        }
        report?.let {
            Text(
                if (it.allPass) "All checks pass." else "Fix the failures, then re-check.",
                style = MaterialTheme.typography.bodyMedium,
            )
            it.items.forEach { item ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text(
                            "${if (item.pass) "PASS" else "FAIL"}: ${item.label}",
                            style = MaterialTheme.typography.titleSmall,
                            color = if (item.pass) MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.error,
                        )
                        Text(item.hint, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = onBack) { Text("Back") }
            Button(onClick = { viewModel.runPreflight() }, enabled = !running) {
                Text(if (running) "Checking..." else "Re-check")
            }
        }
    }
}
