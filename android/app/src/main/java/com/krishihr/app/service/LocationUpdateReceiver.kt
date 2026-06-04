package com.krishihr.app.service
import com.krishihr.app.AndroidMain

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.PowerManager
import android.util.Log
import com.google.android.gms.location.LocationAvailability
import com.google.android.gms.location.LocationResult
import com.krishihr.app.data.api.RetrofitClient
import com.krishihr.app.data.repository.LocationRepository
import com.krishihr.app.domain.model.TrackingPrefs
import com.krishihr.app.domain.usecase.TrackingManager
import com.krishihr.app.utils.SessionManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * LocationUpdateReceiver — Layer 1 background location delivery.
 *
 * The OS delivers location here every 30 seconds via the PendingIntent registered
 * in LocationTrackingService.startBackgroundLocationUpdates().
 *
 * This fires even when the app is COMPLETELY KILLED — the OS wakes this receiver
 * directly. This is the most reliable background tracking method on Android.
 *
 * Uses goAsync() to perform async work (Room + network) without ANR risk.
 * WakeLock acquired to keep CPU awake during the network call.
 */
class LocationUpdateReceiver : BroadcastReceiver() {

    companion object {
        val ACTION_LOCATION_UPDATE get() = AndroidMain.ACTION_LOCATION_UPDATE
        private const val TAG            = "LocationUpdateReceiver"
        private const val MAX_ACCURACY   = 500f   // raised from 200m — 200m too strict indoors
        private const val WAKELOCK_MS    = 15_000L  // safety timeout
    }

    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != ACTION_LOCATION_UPDATE) return

        val trackingManager = TrackingManager(ctx)

        // Guard: if not tracking (punched out) — do nothing
        if (!trackingManager.isTracking()) {
            Log.d(TAG, "Not tracking — skipping")
            return
        }

        // OD auto-stop check — in case alarm didn't fire
        if (trackingManager.shouldOdStopNow()) {
            Log.d(TAG, "OD time exceeded — stopping tracking")
            LocationTrackingService.stop(ctx)
            return
        }

        // Check location availability
        if (LocationAvailability.hasLocationAvailability(intent)) {
            val avail = LocationAvailability.extractLocationAvailability(intent)
            if (avail?.isLocationAvailable == false) {
                Log.d(TAG, "Location not available")
                return
            }
        }

        if (!LocationResult.hasResult(intent)) return
        val result = LocationResult.extractResult(intent) ?: return
        val loc    = result.lastLocation ?: return

        if (loc.accuracy > MAX_ACCURACY) {
            Log.d(TAG, "Poor accuracy ${loc.accuracy}m — skip")
            return
        }

        Log.d(TAG, "📍 Layer 1 delivery: ${loc.latitude},${loc.longitude} ±${loc.accuracy.toInt()}m")

        // Acquire WakeLock — keep CPU alive during async work
        val wakeLock = (ctx.getSystemService(Context.POWER_SERVICE) as PowerManager)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, AndroidMain.WAKELOCK_TAG_RECEIVER)
            .apply { acquire(WAKELOCK_MS) }

        // goAsync() = tell system this BroadcastReceiver needs more time
        val pendingResult = goAsync()

        val session = SessionManager(ctx)
        if (!session.isLoggedIn()) {
            wakeLock.safeRelease()
            pendingResult.finish()
            return
        }
        RetrofitClient.init(session, ctx)

        val repository = LocationRepository(ctx)

        CoroutineScope(Dispatchers.IO).launch {
            try {
                repository.saveAndSync(
                    lat      = loc.latitude,
                    lng      = loc.longitude,
                    accuracy = loc.accuracy,
                    isOd     = trackingManager.isOd()
                )
            } catch (e: Exception) {
                Log.e(TAG, "Layer 1 error: ${e.message}")
                // Record already saved locally by repository — will sync later
            } finally {
                wakeLock.safeRelease()
                pendingResult.finish()
            }
        }
    }

    private fun PowerManager.WakeLock.safeRelease() {
        try { if (isHeld) release() } catch (_: Exception) {}
    }
}