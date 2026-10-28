package com.secondlook.android

import android.Manifest
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.darkColorScheme
import com.meta.wearable.dat.core.Wearables
import com.meta.wearable.dat.core.types.PermissionStatus
import com.secondlook.android.session.SessionViewModel
import com.secondlook.android.ui.MainScreen
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

/**
 * Single-activity host. Owns the DAT permission contract launcher
 * and the Android camera permission launcher (activities own
 * Activity Result APIs) and hands the ViewModel suspend functions
 * for permission requests, plus the lifecycle CameraX binds to.
 */
class MainActivity : ComponentActivity() {
    private val viewModel: SessionViewModel by viewModels()

    private var pendingPermission: ((PermissionStatus) -> Unit)? = null

    private val permissionLauncher =
        registerForActivityResult(Wearables.RequestPermissionContract()) { result ->
            val status = result.getOrDefault(PermissionStatus.Denied)
            pendingPermission?.invoke(status)
            pendingPermission = null
        }

    private var pendingCamera: ((Boolean) -> Unit)? = null

    private val cameraLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            pendingCamera?.invoke(granted)
            pendingCamera = null
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        viewModel.permissionRequester = { permission ->
            suspendCoroutine { continuation ->
                pendingPermission = { status -> continuation.resume(status) }
                permissionLauncher.launch(permission)
            }
        }
        viewModel.phoneLifecycleOwner = this
        viewModel.phonePermissionRequester = {
            suspendCoroutine { continuation ->
                pendingCamera = { granted -> continuation.resume(granted) }
                cameraLauncher.launch(Manifest.permission.CAMERA)
            }
        }
        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                Surface {
                    MainScreen(viewModel = viewModel, activity = this)
                }
            }
        }
    }

}
