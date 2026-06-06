package com.krishihr.app.data.repository

import android.content.Context
import android.util.Log
import com.krishihr.app.data.api.RetrofitClient
import com.krishihr.app.data.local.LocationDatabase
import com.krishihr.app.data.local.LocationRecord
import com.krishihr.app.data.models.MovementLogRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * LocationRepository — single source of truth for location operations.
 *
 * Strategy:
 *  1. Always save to local Room DB first (offline-safe)
 *  2. Attempt immediate upload to backend
 *  3. If upload fails → leave in DB (unsynced)
 *  4. SyncWorker picks up unsynced records every 15 minutes
 *
 * Gate rules (applied ONLY for regular pings, NOT for punch-in):
 *  1. Dedup    : at least 25 seconds since last saved point
 *  2. Accuracy : GPS reading must be <= 50m
 *  3. Distance gate REMOVED — ping every 30s regardless of movement.
 *     Stationary employees must also be tracked (office, meetings etc.)
 *
 * Punch-in point (isPunchIn = true) bypasses ALL gates — it must
 * always be saved as the anchor point for the day's route.
 */
class LocationRepository(context: Context) {

    private val dao = LocationDatabase.getInstance(context).locationQueueDao()
    private val tag = "LocationRepository"

    /**
     * Save a location point locally and immediately attempt upload.
     *
     * @param isPunchIn  Set true for the punch-in first point — bypasses all
     *                   gates so the anchor is always recorded even indoors.
     */
    suspend fun saveAndSync(
        lat: Double,
        lng: Double,
        accuracy: Float,
        isOd: Boolean = false,
        isPunchIn: Boolean = false
    ): Boolean = withContext(Dispatchers.IO) {

        if (!isPunchIn) {
            val lastRecord = dao.getLastRecord()

            // Gate 1: Time dedup — reject if pinged < 25s ago
            if (lastRecord != null) {
                val secondsSinceLast = (System.currentTimeMillis() - lastRecord.timestamp) / 1000
                if (secondsSinceLast < 25) {
                    Log.d(tag, "Dedup: skipping — last was ${secondsSinceLast}s ago")
                    return@withContext false
                }
            }

            // Gate 2: Accuracy — reject readings worse than 50m (skip if accuracy=0 from service)
            if (accuracy > 0f && accuracy > 50f) {
                Log.d(tag, "Accuracy gate: skipping ${accuracy.toInt()}m > 50m")
                return@withContext false
            }

            // Gate 3: Distance gate REMOVED — always log every 30s even if stationary
            // Stationary employees (office workers, meetings) must still be tracked
            if (lastRecord != null) {
                val results = FloatArray(1)
                android.location.Location.distanceBetween(
                    lastRecord.lat, lastRecord.lng, lat, lng, results
                )
                Log.d(tag, "Distance from last point: ${results[0].toInt()}m (no gate — saving regardless)")
            }
        } else {
            Log.d(tag, "Punch-in point — bypassing all gates")
        }

        // All gates passed (or bypassed for punch-in) — persist locally first
        val id = dao.insert(LocationRecord(lat = lat, lng = lng, accuracy = accuracy, isOd = isOd))
        Log.d(tag, "Saved to queue: id=$id, isPunchIn=$isPunchIn, isOd=$isOd")

        return@withContext tryUploadSingle(id, lat, lng, accuracy, isOd)
    }

    /** Upload a single record to backend. Marks synced on success. */
    private suspend fun tryUploadSingle(
        id: Long,
        lat: Double,
        lng: Double,
        accuracy: Float,
        isOd: Boolean
    ): Boolean {
        return try {
            val resp = RetrofitClient.instance.logMovement(
                MovementLogRequest(lat = lat, lng = lng, accuracy = accuracy, isOd = isOd)
            )
            if (resp.isSuccessful) {
                dao.markSynced(listOf(id))
                Log.d(tag, "✅ Uploaded: $lat,$lng ±${accuracy.toInt()}m")
                true
            } else {
                dao.incrementRetry(listOf(id))
                Log.w(tag, "Upload failed: ${resp.code()} — queued for retry")
                false
            }
        } catch (e: Exception) {
            dao.incrementRetry(listOf(id))
            Log.e(tag, "Upload error: ${e.message} — queued for retry")
            false
        }
    }

    /**
     * Batch sync all pending records — called by SyncWorker every 15 min.
     */
    suspend fun syncPending(): SyncResult = withContext(Dispatchers.IO) {
        val pending = dao.getPendingRecords()
        if (pending.isEmpty()) return@withContext SyncResult(0, 0)

        var uploaded = 0
        var failed = 0

        pending.forEach { record ->
            val success = tryUploadSingle(
                record.id, record.lat, record.lng, record.accuracy, record.isOd
            )
            if (success) uploaded++ else failed++
        }

        dao.cleanup()
        Log.d(tag, "Sync complete: uploaded=$uploaded, failed=$failed")
        SyncResult(uploaded, failed)
    }

    suspend fun getPendingCount(): Int = dao.getPendingCount()

    data class SyncResult(val uploaded: Int, val failed: Int)
}