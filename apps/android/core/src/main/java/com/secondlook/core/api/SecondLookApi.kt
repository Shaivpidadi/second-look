package com.secondlook.core.api

import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Thin client for the existing Second Look web routes. No new
 * server surface: frames go out as `POST /api/events`, verdicts
 * come back over `GET /api/verdicts` SSE.
 */
class SecondLookApi(
    private val baseUrl: String,
    private val connectTimeoutMs: Int = 10_000,
    private val readTimeoutMs: Int = 0,
) {
    fun eventsUrl(): String = "$baseUrl/api/events"

    fun verdictsUrl(sessionId: String): String = "$baseUrl/api/verdicts?sessionId=$sessionId"

    /**
     * POST one frame event and parse its verdicts. Throws [ApiException]
     * on transport, non-2xx status, or an unparsable response body.
     */
    suspend fun postFrame(event: FrameEvent): FramePostResult = withContext(Dispatchers.IO) {
        val connection = URL(eventsUrl()).openConnection() as HttpURLConnection
        try {
            val body = event.toJson().toByteArray(StandardCharsets.UTF_8)
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.connectTimeout = connectTimeoutMs
            connection.readTimeout = readTimeoutMs
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(body) }
            val status = connection.responseCode
            if (status !in 200..299) {
                throw ApiException("POST /api/events failed with status $status")
            }
            val text = try {
                connection.inputStream.use { String(it.readBytes(), StandardCharsets.UTF_8) }
            } catch (e: Exception) {
                throw ApiException("frame response unreadable: ${e.message}")
            }
            val payload = try {
                parseJson(text) as? Map<String, Any?>
            } catch (_: Exception) {
                null
            }
            payload?.let { parseFramePostResponse(it) }
                ?: throw ApiException("bad frame response from ${eventsUrl()}")
        } finally {
            connection.disconnect()
        }
    }

    /** Stream live verdicts for a session; closes when the flow cancels. */
    fun verdicts(sessionId: String): Flow<LiveVerdict> = callbackFlow {
        val connection = URL(verdictsUrl(sessionId)).openConnection() as HttpURLConnection
        connection.requestMethod = "GET"
        connection.connectTimeout = connectTimeoutMs
        connection.readTimeout = readTimeoutMs
        connection.setRequestProperty("Accept", "text/event-stream")
        val job = launch(Dispatchers.IO) {
            try {
                val status = connection.responseCode
                if (status !in 200..299) {
                    close(ApiException("GET /api/verdicts failed with status $status"))
                    return@launch
                }
                val reader = BufferedReader(
                    InputStreamReader(connection.inputStream, StandardCharsets.UTF_8),
                )
                val block = StringBuilder()
                var line = reader.readLine()
                while (line != null) {
                    if (line.isEmpty()) {
                        emitBlock(block)
                        block.clear()
                    } else {
                        block.append(line).append('\n')
                    }
                    line = reader.readLine()
                }
                emitBlock(block)
                close()
            } catch (e: Exception) {
                close(e)
            }
        }
        awaitClose {
            job.cancel()
            connection.disconnect()
        }
    }

    private suspend fun kotlinx.coroutines.channels.SendChannel<LiveVerdict>.emitBlock(
        block: StringBuilder,
    ) {
        for (data in parseSseData(block.toString())) {
            val decoded = try {
                parseJson(data) as? Map<String, Any?>
            } catch (_: JsonException) {
                continue
            } ?: continue
            val verdict = try {
                parseVerdict(decoded)
            } catch (_: IllegalArgumentException) {
                continue
            } ?: continue
            trySend(verdict)
        }
    }
}

class ApiException(message: String) : RuntimeException(message)
