package com.secondlook.android.frames

import android.content.Context
import android.media.AudioManager
import android.media.ToneGenerator
import android.speech.tts.TextToSpeech
import android.util.Log
import java.util.Locale

private const val TAG = "VerdictSpeaker"

/**
 * Speaks verdict phrases through the system audio route, which is the
 * glasses speakers when the glasses are the connected Bluetooth audio
 * device. Forcing a Bluetooth SCO channel would add setup latency and
 * drop quality for no benefit, so routing stays with the system.
 * Clean verdicts get a short beep when the tone setting is on.
 */
class VerdictSpeaker(context: Context) {
    private var tts: TextToSpeech? = null
    private var tone: ToneGenerator? = null
    private var ready = false
    private var pending: String? = null

    init {
        try {
            tts = TextToSpeech(context.applicationContext) { status ->
                if (status == TextToSpeech.SUCCESS) {
                    ready = true
                    tts?.language = Locale.US
                    pending?.let { speak(it) }
                    pending = null
                } else {
                    Log.w(TAG, "text to speech init failed with status $status")
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "text to speech unavailable", e)
        }
    }

    /** Speak one phrase, replacing anything in progress. Never throws. */
    fun speak(text: String) {
        try {
            val engine = tts
            if (engine == null || !ready) {
                pending = text
                return
            }
            pending = null
            engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, "verdict")
        } catch (e: Exception) {
            Log.w(TAG, "speak failed", e)
        }
    }

    /** Short clean-verdict beep. Never throws. */
    fun beep() {
        try {
            var generator = tone
            if (generator == null) {
                generator = ToneGenerator(AudioManager.STREAM_MUSIC, 80)
                tone = generator
            }
            generator.startTone(ToneGenerator.TONE_PROP_BEEP, 150)
        } catch (e: Exception) {
            Log.w(TAG, "beep failed", e)
        }
    }

    fun shutdown() {
        try {
            tts?.shutdown()
        } catch (e: Exception) {
            Log.w(TAG, "tts shutdown failed", e)
        }
        tts = null
        try {
            tone?.release()
        } catch (e: Exception) {
            Log.w(TAG, "tone release failed", e)
        }
        tone = null
        ready = false
    }
}
