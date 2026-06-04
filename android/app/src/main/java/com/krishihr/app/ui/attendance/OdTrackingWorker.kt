package com.krishihr.app.ui.attendance

import android.content.Context
import android.util.Log
import androidx.work.*
import com.krishihr.app.data.api.RetrofitClient
import com.krishihr.app.domain.model.StopReason
import com.krishihr.app.domain.model.TrackingPrefs
import com.krishihr.app.domain.usecase.TrackingManager
import com.krishihr.app.service.LocationTrackingService
import com.krishihr.app.utils.SessionManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.TimeUnit

/**
 * Runs once per day to check if the employee has an approved OD for today.
 * If yes — starts movement tracking automatically and marks locations as OD type.
 * Also handles future-dated OD: on that day this worker detects it and starts tracking.
 */
class OdTrackingWorker(
    private val ctx: Context,
    params: WorkerParameters
) : CoroutineWorker(ctx, params) {

    companion object {
        private const val TAG      = "OdTrackingWorker"
        private const val WORK_TAG = "od_tracking_check"

        fun scheduleDailyCheck(ctx: Context) {
            val request = PeriodicWorkRequestBuilder<OdTrackingWorker>(24, TimeUnit.HOURS)
                .addTag(WORK_TAG)
                .setInitialDelay(0, TimeUnit.SECONDS)
                .setBackoffCriteria(BackoffPolicy.LINEAR, 15, TimeUnit.MINUTES)
                .build()

            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(
                WORK_TAG,
                ExistingPeriodicWorkPolicy.KEEP,
                request
            )
            Log.d(TAG, "Daily OD check scheduled")
        }

        fun cancel(ctx: Context) {
            WorkManager.getInstance(ctx).cancelAllWorkByTag(WORK_TAG)
        }
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val session = SessionManager(ctx)
        if (!session.isLoggedIn()) {
            Log.d(TAG, "Not logged in — skipping OD check")
            return@withContext Result.success()
        }

        RetrofitClient.init(session, ctx)

        val todayStr = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())
        val trackingManager = TrackingManager(ctx)

        return@withContext try {
            val res  = RetrofitClient.instance.getMyODRequests(status = "approved")
            val list = res.body()?.data ?: emptyList()

            val hasODToday = list.any { od ->
                // ✅ FIX: od_requests returns single "date" per row not fromDate/toDate
                od.date?.take(10) == todayStr ||
                        ((od.fromDate?.take(10) ?: "") <= todayStr &&
                                (od.toDate?.take(10)   ?: "") >= todayStr)
            }

            if (hasODToday) {
                Log.d(TAG, "✅ Employee has approved OD today ($todayStr)")
                trackingManager.setOdFlag(true)

                val isPunchedIn = trackingManager.isPunchedIn()
                if (isPunchedIn && !LocationTrackingService.isRunning(ctx)) {
                    Log.d(TAG, "Punched in + OD → starting tracking")
                    LocationTrackingService.start(ctx, isOd = true)
                } else if (LocationTrackingService.isRunning(ctx)) {
                    Log.d(TAG, "Already tracking — OD flag updated")
                } else {
                    Log.d(TAG, "OD found but not yet punched in — flag set")
                }
            } else {
                if (trackingManager.isOd()) {
                    Log.d(TAG, "OD expired — clearing flag")
                    trackingManager.setOdFlag(false)
                }
                Log.d(TAG, "No approved OD for today ($todayStr)")
            }

            Result.success()
        } catch (e: Exception) {
            Log.e(TAG, "OD check failed: ${e.message}")
            Result.retry()
        }
    }
}