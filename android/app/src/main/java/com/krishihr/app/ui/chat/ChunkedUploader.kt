package com.krishihr.app.ui.chat

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.InputStream

/**
 * ChunkedUploader — uploads files up to 1 GB in 5 MB chunks.
 *
 * Usage:
 *   val uploader = ChunkedUploader(context, baseUrl, token)
 *   val result = uploader.upload(groupId, uri, onProgress = { pct -> })
 *
 * Cross-platform: the same chunked API is used by web and Android.
 * Works on Android 8+.
 */
class ChunkedUploader(
    private val context: Context,
    private val baseUrl: String,  // e.g. "https://your-backend.onrender.com"
    private val token: String
) {
    companion object {
        const val CHUNK_SIZE       = 5 * 1024 * 1024L  // 5 MB
        const val MAX_FILE_BYTES   = 1024 * 1024 * 1024L // 1 GB
        const val DIRECT_THRESHOLD = 50 * 1024 * 1024L  // ≤ 50 MB → direct upload
        const val MAX_RETRIES      = 3
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
        .writeTimeout(120, java.util.concurrent.TimeUnit.SECONDS)
        .readTimeout(120, java.util.concurrent.TimeUnit.SECONDS)
        .build()

    data class UploadResult(val success: Boolean, val message: String? = null, val messageData: Any? = null)

    @Volatile private var aborted = false

    fun abort() { aborted = true }

    suspend fun upload(
        groupId: Int,
        uri: Uri,
        onProgress: (pct: Int, bytesUploaded: Long, totalBytes: Long) -> Unit = { _, _, _ -> }
    ): UploadResult = withContext(Dispatchers.IO) {
        aborted = false
        val cr = context.contentResolver

        // Resolve file metadata
        var fileName = "file"
        var fileSize  = 0L
        cr.query(uri, null, null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (nameIdx >= 0) fileName = cursor.getString(nameIdx) ?: "file"
                if (sizeIdx >= 0) fileSize  = cursor.getLong(sizeIdx)
            }
        }
        // Fallback size calculation
        if (fileSize <= 0L) {
            cr.openInputStream(uri)?.use { fileSize = it.available().toLong() }
        }

        val mimeType = cr.getType(uri) ?: "application/octet-stream"

        if (fileSize > MAX_FILE_BYTES)
            return@withContext UploadResult(false, "File exceeds 1 GB limit")

        if (fileSize <= DIRECT_THRESHOLD) {
            // Small file — single POST (backwards compat with existing Retrofit call)
            return@withContext directUpload(groupId, uri, fileName, mimeType, fileSize, onProgress)
        }

        // Large file — chunked
        return@withContext chunkedUpload(groupId, uri, fileName, mimeType, fileSize, onProgress)
    }

    // ── Direct upload (≤ 50 MB) ───────────────────────────────────────────────
    private fun directUpload(
        groupId: Int, uri: Uri, fileName: String, mimeType: String, fileSize: Long,
        onProgress: (Int, Long, Long) -> Unit
    ): UploadResult {
        val bytes = context.contentResolver.openInputStream(uri)?.readBytes()
            ?: return UploadResult(false, "Could not read file")

        val body = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("file", fileName, object : RequestBody() {
                override fun contentType() = mimeType.toMediaType()
                override fun contentLength() = bytes.size.toLong()
                override fun writeTo(sink: okio.BufferedSink) {
                    val total = bytes.size.toLong()
                    var written = 0L
                    val buf = ByteArray(64 * 1024)
                    bytes.inputStream().use { stream ->
                        while (true) {
                            val read = stream.read(buf)
                            if (read == -1 || aborted) break
                            sink.write(buf, 0, read)
                            written += read
                            val pct = (written * 100 / total).toInt()
                            onProgress(pct, written, total)
                        }
                    }
                }
            })
            .build()

        val request = Request.Builder()
            .url("${baseUrl.trimEnd('/')}/api/chat/groups/$groupId/files")
            .header("Authorization", "Bearer $token")
            .post(body)
            .build()

        val resp = client.newCall(request).execute()
        val json = JSONObject(resp.body?.string() ?: "{}")
        return UploadResult(json.optBoolean("success"), json.optString("message"))
    }

    // ── Chunked upload (> 50 MB, up to 1 GB) ─────────────────────────────────
    private fun chunkedUpload(
        groupId: Int, uri: Uri, fileName: String, mimeType: String, fileSize: Long,
        onProgress: (Int, Long, Long) -> Unit
    ): UploadResult {
        val totalChunks = ((fileSize + CHUNK_SIZE - 1) / CHUNK_SIZE).toInt()

        // 1. Init session
        val initBody = JSONObject().apply {
            put("groupId", groupId); put("fileName", fileName); put("fileSize", fileSize)
            put("mimeType", mimeType); put("totalChunks", totalChunks)
        }.toString().toRequestBody("application/json".toMediaType())

        val initReq = Request.Builder()
            .url("${baseUrl.trimEnd('/')}/api/chat/upload/init")
            .header("Authorization", "Bearer $token")
            .post(initBody)
            .build()

        val initResp = client.newCall(initReq).execute()
        val initJson = JSONObject(initResp.body?.string() ?: "{}")
        if (!initJson.optBoolean("success"))
            return UploadResult(false, "Init failed: ${initJson.optString("message")}")

        val uploadId = initJson.optString("uploadId")

        // 2. Upload chunks
        context.contentResolver.openInputStream(uri)?.use { stream ->
            var bytesUploaded = 0L
            for (i in 0 until totalChunks) {
                if (aborted) {
                    abortUploadSession(uploadId)
                    return UploadResult(false, "Cancelled")
                }

                val chunkEnd  = minOf((i + 1) * CHUNK_SIZE, fileSize)
                val chunkSize = (chunkEnd - i * CHUNK_SIZE).toInt()
                val buf = ByteArray(chunkSize)
                var read = 0
                while (read < chunkSize) {
                    val n = stream.read(buf, read, chunkSize - read)
                    if (n == -1) break
                    read += n
                }

                val chunkBytes = buf.copyOf(read)
                var success = false
                var retries = 0

                while (!success && retries < MAX_RETRIES) {
                    try {
                        val chunkBody = MultipartBody.Builder()
                            .setType(MultipartBody.FORM)
                            .addFormDataPart("chunkIndex", i.toString())
                            .addFormDataPart("chunk", fileName, chunkBytes.toRequestBody(mimeType.toMediaType()))
                            .build()

                        val chunkReq = Request.Builder()
                            .url("${baseUrl.trimEnd('/')}/api/chat/upload/chunk/$uploadId")
                            .header("Authorization", "Bearer $token")
                            .post(chunkBody)
                            .build()

                        val r = client.newCall(chunkReq).execute()
                        val j = JSONObject(r.body?.string() ?: "{}")
                        success = j.optBoolean("success")
                        if (!success) retries++
                    } catch (e: Exception) {
                        retries++
                        if (retries < MAX_RETRIES) Thread.sleep(1000L * retries)
                    }
                }

                if (!success) {
                    abortUploadSession(uploadId)
                    return UploadResult(false, "Chunk $i failed after $MAX_RETRIES retries")
                }

                bytesUploaded += read
                val pct = (bytesUploaded * 100 / fileSize).toInt()
                onProgress(pct, bytesUploaded, fileSize)
            }
        } ?: return UploadResult(false, "Could not read file")

        // 3. Complete
        val completeReq = Request.Builder()
            .url("${baseUrl.trimEnd('/')}/api/chat/upload/complete/$uploadId")
            .header("Authorization", "Bearer $token")
            .post("{}".toRequestBody("application/json".toMediaType()))
            .build()

        val completeResp = client.newCall(completeReq).execute()
        val completeJson = JSONObject(completeResp.body?.string() ?: "{}")
        return UploadResult(
            completeJson.optBoolean("success"),
            completeJson.optString("message")
        )
    }

    private fun abortUploadSession(uploadId: String) {
        try {
            val req = Request.Builder()
                .url("${baseUrl.trimEnd('/')}/api/chat/upload/abort/$uploadId")
                .header("Authorization", "Bearer $token")
                .delete()
                .build()
            client.newCall(req).execute()
        } catch (_: Exception) {}
    }
}
