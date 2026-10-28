package com.secondlook.android.debug

import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.meta.wearable.dat.core.types.Permission
import com.meta.wearable.dat.core.types.PermissionStatus
import com.meta.wearable.dat.mockdevice.MockDeviceKit
import com.meta.wearable.dat.mockdevice.api.GlassesModel

/**
 * Debug-only mock controls (this source set ships only in debug
 * builds; release carries a no-op stub). Pairs mock glasses so the
 * whole flow runs with no hardware.
 */
@Composable
fun MockPanel() {
    val context = LocalContext.current
    var status by remember { mutableStateOf("mock: idle") }
    fun note(message: String) {
        status = message
    }
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("Mock device (debug)", style = MaterialTheme.typography.titleSmall)
            Text(status, style = MaterialTheme.typography.bodySmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    onClick = {
                        MockDeviceKit.getInstance(context).enable()
                        note("mock: enabled")
                    },
                ) { Text("Enable") }
                OutlinedButton(
                    onClick = {
                        val kit = MockDeviceKit.getInstance(context)
                        kit.enable()
                        kit.pairGlasses(GlassesModel.RAYBAN_META).fold(
                            onSuccess = { glasses ->
                                glasses.powerOn()
                                glasses.unfold()
                                glasses.don()
                                kit.permissions.set(Permission.CAMERA, PermissionStatus.Granted)
                                note("mock: paired, worn, camera granted")
                            },
                            onFailure = { error, _ ->
                                note("mock pair failed: ${error.toString()}")
                            },
                        )
                    },
                ) { Text("Pair + don") }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    onClick = {
                        val kit = MockDeviceKit.getInstance(context)
                        kit.pairedDevices.forEach { kit.unpairDevice(it) }
                        note("mock: unpaired")
                    },
                ) { Text("Unpair all") }
                OutlinedButton(
                    onClick = {
                        Toast.makeText(context, status, Toast.LENGTH_SHORT).show()
                    },
                ) { Text("Status") }
            }
        }
    }
}
