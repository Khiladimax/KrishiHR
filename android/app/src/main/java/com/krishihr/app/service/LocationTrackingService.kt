package com.krishihr.app.service
import com.krishihr.app.AndroidMain

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.*
import com.google.android.gms.tasks.CancellationTokenSource
import com.krishihr.app.R
import com.krishihr.app.data.api.RetrofitClient
import com.krishihr.app.data.repository.LocationRepository
import com.krishihr.app.domain.model.StopReason
import com.krishihr.app.domain.model.TrackingPrefs
import com.krishihr.app.domain.usecase.TrackingManager
import com.krishihr.app.utils.SessionManager
import kotlinx.coroutines.*

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * LocationTrackingService — Production Foreground Service
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Architecture:
 *   LAYER 1 (PRIMARY):   FusedLocationProviderClient + PendingIntent
 *                        → LocationUpdateReceiver (BroadcastReceiver)
 *                        Works even when app is COMPLETELY KILLED
 *                        30-second OS-managed updates
 *
 *   LAYER 2 (SECONDARY): This ForegroundService + coroutine loop
 *                        Shows persistent notification
 *                        Immediate ping on punch-in
 *                        Fallback when PendingIntent layer is delayed
 *
 *   LAYER 3 (SAFETY NET): SyncWorker (WorkManager, 15-min periodic)
 *                        Uploads any records stuck in offline queue
 *
 * Adaptive tracking:
 *   - Stationary (< 50m movement in last 3 pings): reduce to 60-sec interval
 *   - Moving (> 50m): use 30-sec interval
 *   - OD mode: always 30-sec (employee must be tracked precisely)
 *
 * OD auto-stop:
 *   - Schedules AlarmManager to stop at configured time (default 6:30 PM)
 *   - Checks shouldOdStopNow() on every ping
 * ─────────────────────────────────────────────────────────────────────────────
 */
class LocationTrackingService : Service() {

    companion object {
        private const val TAG         = "LocationTrackingService"
        private val CHANNEL_ID  get() = AndroidMain.NOTIF_CHANNEL_ID
        private val NOTIF_ID    get() = AndroidMain.NOTIF_ID
        private val ACTION_STOP get() = AndroidMain.ACTION_STOP_TRACKING

        // Tracking intervals
        private val INTERVAL_NORMAL_MS     get() = AndroidMain.TRACK_INTERVAL_MOVING_MS   // 30 sec — 1 point per 30s
        private val INTERVAL_STATIONARY_MS get() = AndroidMain.TRACK_INTERVAL_STATIONARY_MS   // 60 sec — stationary
        private const val GPS_TIMEOUT_MS         = 12_000L
        private const val MAX_ACCURACY_M         = 50f       // ignore readings > 50m accuracy — tighter filter reduces GPS jump artifacts

        // Adaptive: if displacement < this in 3 consecutive pings → stationary
        private val STATIONARY_THRESHOLD_M get() = AndroidMain.TRACK_STATIONARY_THRESHOLD_M
        private const val STATIONARY_PING_COUNT  = 3

        fun start(ctx: Context, isOd: Boolean = false) {
            try {
                val trackingManager = TrackingManager(ctx)
                trackingManager.startTracking(isOd)

                // Register OS-level background location updates (Layer 1)
                startBackgroundLocationUpdates(ctx)

                // Start foreground service (Layer 2)
                val intent = Intent(ctx, LocationTrackingService::class.java)
                ContextCompat.startForegroundService(ctx, intent)

                // Start WorkManager safety-net (Layer 3)
                LocationSyncWorker.schedule(ctx)

                // If OD — schedule auto-stop alarm
                if (isOd) scheduleOdAutoStop(ctx, trackingManager)

                Log.d(TAG, "✅ All tracking layers started (isOd=$isOd)")
            } catch (e: Exception) {
                Log.e(TAG, "start() error: ${e.message}")
                // Even if service fails, Layer 1 might still work
                startBackgroundLocationUpdates(ctx)
            }
        }

        fun stop(ctx: Context, reason: StopReason = StopReason.PUNCH_OUT) {
            try {
                TrackingManager(ctx).stopTracking()
                stopBackgroundLocationUpdates(ctx)
                ctx.stopService(Intent(ctx, LocationTrackingService::class.java))
                LocationSyncWorker.cancel(ctx)
                cancelOdAutoStop(ctx)
                Log.d(TAG, "✅ Tracking stopped (reason=$reason)")
            } catch (e: Exception) {
                Log.e(TAG, "stop() error: ${e.message}")
            }
        }

        fun isRunning(ctx: Context): Boolean = TrackingManager(ctx).isTracking()

        // ── Layer 1: OS background location via PendingIntent ─────────────────

        private fun startBackgroundLocationUpdates(ctx: Context) {
            if (!hasLocationPermission(ctx)) {
                Log.w(TAG, "No location permission — Layer 1 skipped")
                return
            }
            try {
                val fusedClient = LocationServices.getFusedLocationProviderClient(ctx)
                val isOd = TrackingManager(ctx).isOd()
                val interval = if (isOd) INTERVAL_NORMAL_MS else INTERVAL_NORMAL_MS

                val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, interval)
                    .setMinUpdateIntervalMillis(interval)
                    .setMaxUpdateDelayMillis(interval)       // no batching delay — deliver every 30s exactly
                    .setWaitForAccurateLocation(false)
                    .build()

                fusedClient.requestLocationUpdates(request, getPendingIntent(ctx))
                    .addOnSuccessListener {
                        Log.d(TAG, "✅ Layer 1: OS background updates registered (${interval/1000}s)")
                    }
                    .addOnFailureListener { e ->
                        Log.e(TAG, "Layer 1 failed: ${e.message} — trying BALANCED fallback")
                        try {
                            val fallback = LocationRequest.Builder(
                                Priority.PRIORITY_BALANCED_POWER_ACCURACY, interval
                            )
                                .setMinUpdateIntervalMillis(interval)
                                .setMaxUpdateDelayMillis(interval)
                                .build()
                            fusedClient.requestLocationUpdates(fallback, getPendingIntent(ctx))
                            Log.d(TAG, "⚠️ Layer 1 fallback: BALANCED_POWER registered")
                        } catch (fe: Exception) {
                            Log.e(TAG, "Layer 1 fallback also failed: ${fe.message}")
                        }
                    }
            } catch (e: Exception) {
                Log.e(TAG, "startBackgroundLocationUpdates: ${e.message}")
            }
        }

        private fun stopBackgroundLocationUpdates(ctx: Context) {
            try {
                LocationServices.getFusedLocationProviderClient(ctx)
                    .removeLocationUpdates(getPendingIntent(ctx))
                    .addOnSuccessListener { Log.d(TAG, "Layer 1: OS updates removed") }
            } catch (e: Exception) {
                Log.e(TAG, "stopBackgroundLocationUpdates: ${e.message}")
            }
        }

        private fun getPendingIntent(ctx: Context): PendingIntent {
            val intent = Intent(ctx, LocationUpdateReceiver::class.java).apply {
                action = LocationUpdateReceiver.ACTION_LOCATION_UPDATE
            }
            return PendingIntent.getBroadcast(
                ctx, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            )
        }

        // ── OD auto-stop via AlarmManager ─────────────────────────────────────

        private fun scheduleOdAutoStop(ctx: Context, manager: TrackingManager) {
            val millis = manager.millisUntilOdStop()
            if (millis <= 0) {
                // Already past stop time — stop immediately
                stop(ctx, StopReason.OD_TIME_EXCEEDED)
                return
            }
            val alarm = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val pi = getOdStopPendingIntent(ctx)
            try {
                alarm.setExactAndAllowWhileIdle(
                    AlarmManager.RTC_WAKEUP,
                    System.currentTimeMillis() + millis,
                    pi
                )
                Log.d(TAG, "OD auto-stop scheduled in ${millis/60000} minutes")
            } catch (e: Exception) {
                Log.e(TAG, "scheduleOdAutoStop: ${e.message}")
            }
        }

        private fun cancelOdAutoStop(ctx: Context) {
            val alarm = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            alarm.cancel(getOdStopPendingIntent(ctx))
        }

        private fun getOdStopPendingIntent(ctx: Context): PendingIntent {
            val intent = Intent(ctx, OdStopReceiver::class.java)
            return PendingIntent.getBroadcast(
                ctx, 1001, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        // ── Permission helpers ─────────────────────────────────────────────────

        fun hasLocationPermission(ctx: Context): Boolean =
            ContextCompat.checkSelfPermission(
                ctx, android.Manifest.permission.ACCESS_FINE_LOCATION
            ) == PackageManager.PERMISSION_GRANTED ||
                    ContextCompat.checkSelfPermission(
                        ctx, android.Manifest.permission.ACCESS_COARSE_LOCATION
                    ) == PackageManager.PERMISSION_GRANTED

        // ── Battery optimization ───────────────────────────────────────────────

        fun requestBatteryExemption(ctx: Context) {
            try {
                val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
                if (!pm.isIgnoringBatteryOptimizations(ctx.packageName)) {
                    ctx.startActivity(
                        Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                            .apply {
                                data = android.net.Uri.parse("package:${ctx.packageName}")
                                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            }
                    )
                }
            } catch (e: Exception) {
                Log.w(TAG, "Battery exemption: ${e.message}")
            }
        }

        /** Brand-specific battery/autostart settings page */
        fun getBrandBatteryIntent(): Intent? {
            val brand = android.os.Build.MANUFACTURER.lowercase()
            return try {
                when {
                    brand.contains("xiaomi") || brand.contains("redmi") -> Intent().apply {
                        component = android.content.ComponentName(
                            "com.miui.securitycenter",
                            "com.miui.permcenter.autostart.AutoStartManagementActivity"
                        )
                    }
                    brand.contains("oppo") || brand.contains("realme") -> Intent().apply {
                        component = android.content.ComponentName(
                            "com.coloros.safecenter",
                            "com.coloros.safecenter.permission.startup.FakeActivity"
                        )
                    }
                    brand.contains("vivo") -> Intent().apply {
                        component = android.content.ComponentName(
                            "com.vivo.permissionmanager",
                            "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"
                        )
                    }
                    brand.contains("huawei") || brand.contains("honor") -> Intent().apply {
                        component = android.content.ComponentName(
                            "com.huawei.systemmanager",
                            "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"
                        )
                    }
                    brand.contains("samsung") -> Intent().apply {
                        action = "com.samsung.android.lool.ACTION_OPEN_BATTERY_OPTIMIZATION"
                    }
                    brand.contains("oneplus") -> Intent().apply {
                        component = android.content.ComponentName(
                            "com.oneplus.security",
                            "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity"
                        )
                    }
                    else -> null
                }?.apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
            } catch (e: Exception) { null }
        }
    }

    // ── Service implementation (Layer 2) ───────────────────────────────────────

    private val serviceScope  = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var pingJob: Job? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var fusedClient: FusedLocationProviderClient? = null
    private lateinit var repository: LocationRepository
    private lateinit var trackingManager: TrackingManager

    // Adaptive tracking state
    private val recentLocations = ArrayDeque<Location>(STATIONARY_PING_COUNT + 1)
    private var currentIntervalMs = INTERVAL_NORMAL_MS
    private var isFirstPing = true   // FIX: skip accuracy filter on very first ping (punch-in point)

    override fun onCreate() {
        super.onCreate()
        fusedClient    = LocationServices.getFusedLocationProviderClient(this)
        repository     = LocationRepository(this)
        trackingManager = TrackingManager(this)
        createNotificationChannel()
        wakeLock = (getSystemService(Context.POWER_SERVICE) as PowerManager)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, AndroidMain.WAKELOCK_TAG_GPS)
            .apply { setReferenceCounted(false) }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Handle stop action from notification button
        if (intent?.action == ACTION_STOP) {
            stop(this, StopReason.MANUAL)
            return START_NOT_STICKY
        }

        try {
            startForeground(NOTIF_ID, buildNotification())
        } catch (e: Exception) {
            Log.e(TAG, "startForeground failed: ${e.message}")
            return START_NOT_STICKY
        }

        // FIX: Only start ping loop if not already running.
        // onStartCommand fires every time start() is called (e.g. on each loadToday()).
        // Without this guard, each call restarts the loop causing a burst of pings at the same timestamp.
        if (pingJob == null || pingJob?.isActive == false) {
            startPingLoop()
        } else {
            Log.d(TAG, "Ping loop already active — skipping restart")
        }
        return START_STICKY
    }

    /**
     * Ping loop with adaptive interval:
     * - Immediate ping on start
     * - Adapts interval based on movement (30s moving, 60s stationary)
     * - Checks OD auto-stop condition on every cycle
     */
    private fun startPingLoop() {
        pingJob?.cancel()
        pingJob = serviceScope.launch {
            // Immediate ping so first data point is logged right on punch-in
            doPing()

            while (isActive) {
                // OD auto-stop check
                if (trackingManager.shouldOdStopNow()) {
                    Log.d(TAG, "OD auto-stop time reached — stopping")
                    stop(this@LocationTrackingService, StopReason.OD_TIME_EXCEEDED)
                    break
                }
                if (!trackingManager.isTracking()) break

                delay(currentIntervalMs)
                if (trackingManager.isTracking()) doPing()
            }
        }
    }

    private suspend fun doPing() {
        val client = fusedClient ?: return
        if (!hasLocationPermission(this)) { stop(this, StopReason.SESSION_EXPIRED); return }

        acquireWakeLock()
        try {
            val loc = getBestLocation(client) ?: run {
                Log.d(TAG, "Ping: no location available")
                return
            }

            // FIX: Reject location fixes whose GPS timestamp is stale.
            // Android can return a Location object with a timestamp from hours ago
            // (e.g. the morning room fix) even via getCurrentLocation() on some OEMs.
            // 5-minute hard cap — if the fix is older than this, it is not the current position.
            val fixAgeMs = System.currentTimeMillis() - loc.time
            if (fixAgeMs > 5 * 60 * 1000L) {
                Log.w(TAG, "Ping: GPS fix is ${fixAgeMs / 60000}min old — rejecting stale location")
                return
            }

            // FIX: Never drop the very first ping (punch-in point).
            // Indoor GPS accuracy on punch-in is often 200–500m.
            // Dropping it means the employee shows "Not Tracking" until they step outside.
            // For subsequent pings, allow up to 500m accuracy (was 200m — too strict indoors).
            val maxAccuracy = if (isFirstPing) Float.MAX_VALUE else MAX_ACCURACY_M
            if (loc.accuracy > maxAccuracy) {
                Log.d(TAG, "Ping: poor accuracy ${loc.accuracy}m — skip")
                return
            }
            isFirstPing = false

            // Adaptive tracking — check if stationary
            updateAdaptiveInterval(loc)

            val session = SessionManager(this)
            if (!session.isLoggedIn()) { stop(this, StopReason.SESSION_EXPIRED); return }
            RetrofitClient.init(session, this)

            val uploaded = repository.saveAndSync(
                lat      = loc.lat(),
                lng      = loc.lng(),
                accuracy = loc.accuracy,
                isOd     = trackingManager.isOd()
            )

            Log.d(TAG, "Ping: ${loc.lat()},${loc.lng()} ±${loc.accuracy.toInt()}m | uploaded=$uploaded | interval=${currentIntervalMs/1000}s")

            // Update notification with latest info
            updateNotification(loc)

        } catch (e: Exception) {
            Log.e(TAG, "doPing error: ${e.message}")
        } finally {
            releaseWakeLock()
        }
    }

    /**
     * Adaptive interval logic:
     * Track last N locations. If displacement between oldest and newest < threshold → stationary.
     * Stationary = reduce ping frequency to save battery.
     * OD mode always uses normal interval.
     */
    // ✅ FIX: Always use 30s interval — never reduce for stationary employees.
    // Old code reduced to 60s when employee didn't move 50m in 3 pings.
    // This caused missing points for office/stationary employees.
    private fun updateAdaptiveInterval(newLoc: Location) {
        recentLocations.addLast(newLoc)
        if (recentLocations.size > STATIONARY_PING_COUNT) recentLocations.removeFirst()
        currentIntervalMs = INTERVAL_NORMAL_MS
    }

    private suspend fun getBestLocation(client: FusedLocationProviderClient): Location? {
        return try {
            // FIX: Try lastLocation FIRST — it is instant and has no cold-start delay.
            // This is critical for the punch-in first ping: GPS cold-start can take 10–30s,
            // during which getCurrentLocation times out and returns null, dropping the point.
            val cached = suspendCancellableCoroutine<Location?> { cont ->
                client.lastLocation
                    .addOnSuccessListener { cont.resume(it, null) }
                    .addOnFailureListener { cont.resume(null, null) }
            }
            // Use cached if it's fresh enough.
            // Hard cap: NEVER use a cached fix older than 90 seconds, regardless of config.
            // This prevents Android returning a location from hours ago (e.g. morning room fix)
            // as "last known location" during the workday.
            val cacheAgeMs = System.currentTimeMillis() - (cached?.time ?: 0L)
            val maxCacheMs = minOf(AndroidMain.TRACK_LOCATION_CACHE_MS, 90_000L)
            if (cached != null && cacheAgeMs < maxCacheMs) {
                Log.d(TAG, "Using fresh cached location ±${cached.accuracy.toInt()}m (age=${cacheAgeMs/1000}s)")
                return cached
            }

            // Try HIGH_ACCURACY (GPS)
            val gpsLoc = withTimeoutOrNull(GPS_TIMEOUT_MS) {
                suspendCancellableCoroutine<Location?> { cont ->
                    val cts = CancellationTokenSource()
                    cont.invokeOnCancellation { cts.cancel() }
                    client.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cts.token)
                        .addOnSuccessListener { cont.resume(it, null) }
                        .addOnFailureListener { cont.resume(null, null) }
                }
            }
            if (gpsLoc != null) return gpsLoc

            // Fallback: BALANCED (network/WiFi)
            val networkLoc = withTimeoutOrNull(8_000L) {
                suspendCancellableCoroutine<Location?> { cont ->
                    val cts = CancellationTokenSource()
                    cont.invokeOnCancellation { cts.cancel() }
                    client.getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, cts.token)
                        .addOnSuccessListener { cont.resume(it, null) }
                        .addOnFailureListener { cont.resume(null, null) }
                }
            }
            if (networkLoc != null) {
                Log.d(TAG, "⚠️ Using network/WiFi location ±${networkLoc.accuracy.toInt()}m")
                return networkLoc
            }

            // Last resort: DO NOT use stale cached location.
            // A cached location from hours ago (e.g. morning room fix) would appear
            // as a false position mid-day. Returning null causes doPing() to skip
            // this cycle cleanly — far better than a phantom location.
            Log.w(TAG, "⚠️ GPS and network both timed out — skipping ping (no stale fallback)")
            null
        } catch (e: Exception) {
            Log.e(TAG, "getBestLocation error: ${e.message}")
            null
        }
    }

    private fun updateNotification(loc: Location) {
        val mode = if (trackingManager.isOd()) " • OD Mode" else ""
        val notification = buildNotificationWithText(
            "Tracking Active$mode",
            "±${loc.accuracy.toInt()}m  •  ${currentIntervalMs/1000}s interval"
        )
        val nm = getSystemService(NotificationManager::class.java)
        nm?.notify(NOTIF_ID, notification)
    }

    private fun acquireWakeLock() {
        try { if (wakeLock?.isHeld == false) wakeLock?.acquire(AndroidMain.TRACK_WAKELOCK_TIMEOUT_MS) } catch (_: Exception) {}
    }

    private fun releaseWakeLock() {
        try { if (wakeLock?.isHeld == true) wakeLock?.release() } catch (_: Exception) {}
    }

    override fun onDestroy() {
        pingJob?.cancel()
        serviceScope.cancel()
        releaseWakeLock()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ── Notification ───────────────────────────────────────────────────────────

    private fun createNotificationChannel() {
        NotificationChannel(CHANNEL_ID, AndroidMain.NOTIF_CHANNEL_NAME, NotificationManager.IMPORTANCE_DEFAULT)
            .apply {
                description = "Tracks location while you are punched in"
                setShowBadge(false)
            }.also {
                getSystemService(NotificationManager::class.java)?.createNotificationChannel(it)
            }
    }

    private fun buildNotification(): Notification =
        buildNotificationWithText(AndroidMain.NOTIF_TITLE, AndroidMain.NOTIF_TEXT)

    private fun buildNotificationWithText(title: String, text: String): Notification {
        // Stop action in notification — lets user stop tracking from notification shade
        val stopIntent = Intent(this, LocationTrackingService::class.java).apply {
            action = ACTION_STOP
        }
        val stopPi = PendingIntent.getService(
            this, 0, stopIntent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_location)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(Notification.CATEGORY_SERVICE)
            .addAction(R.drawable.ic_location, "Stop Tracking", stopPi)
            .setContentIntent(
                PendingIntent.getActivity(
                    this, 0,
                    packageManager.getLaunchIntentForPackage(packageName),
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
                )
            ).build()
    }
}

// Extension helpers (keep Location API cleaner)
private fun Location.lat() = latitude
private fun Location.lng() = longitude

private suspend fun <T> suspendCancellableCoroutine(
    block: (kotlinx.coroutines.CancellableContinuation<T>) -> Unit
): T = kotlinx.coroutines.suspendCancellableCoroutine(block)