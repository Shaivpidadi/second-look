package com.secondlook.android

import android.app.Application
import android.util.Log
import com.meta.wearable.dat.core.Wearables

private const val TAG = "SecondLook"

/**
 * Initializes the Wearables Device Access Toolkit once per process,
 * before any other SDK call.
 */
class SecondLookApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Wearables.initialize(this).onFailure { error, _ ->
            Log.e(TAG, "Wearables.initialize failed: ${error.toString()}")
        }
    }
}
