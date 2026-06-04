package com.krishihr.app.domain.usecase

import android.content.Context
import android.content.SharedPreferences
import com.krishihr.app.domain.model.TrackingPrefs
import com.krishihr.app.domain.model.TrackingSession
import java.util.Calendar

/**
 * TrackingManager — single authority for all tracking state.
 *
 * All reads/writes to TrackPrefs go through here.
 * No other class should directly access SharedPrefs for tracking state.
 */
class TrackingManager(context: Context) {

    private val prefs: SharedPreferences = context.getSharedPreferences(
        TrackingPrefs.PREFS_NAME, Context.MODE_PRIVATE
    )

    // ── State reads ─────────────────────────────────────────────────────────────

    fun isTracking(): Boolean = prefs.getBoolean(TrackingPrefs.KEY_IS_TRACKING, false)
    fun isOd(): Boolean = prefs.getBoolean(TrackingPrefs.KEY_IS_OD, false)
    fun isPunchedIn(): Boolean = prefs.getString(TrackingPrefs.KEY_PUNCH_IN_VALUE, "")?.isNotBlank() == true

    fun getSession(): TrackingSession = TrackingSession(
        isTracking    = isTracking(),
        isOd          = isOd(),
        punchInTime   = prefs.getLong(TrackingPrefs.KEY_PUNCH_IN_TIME, 0L),
        odStopTimeHour   = prefs.getInt(TrackingPrefs.KEY_OD_STOP_HOUR, 18),
        odStopTimeMinute = prefs.getInt(TrackingPrefs.KEY_OD_STOP_MINUTE, 30)
    )

    // ── State writes ────────────────────────────────────────────────────────────

    fun startTracking(isOd: Boolean = false) {
        prefs.edit()
            .putBoolean(TrackingPrefs.KEY_IS_TRACKING, true)
            .putBoolean(TrackingPrefs.KEY_IS_OD, isOd)
            .putLong(TrackingPrefs.KEY_PUNCH_IN_TIME, System.currentTimeMillis())
            .apply()
    }

    fun stopTracking() {
        prefs.edit()
            .putBoolean(TrackingPrefs.KEY_IS_TRACKING, false)
            .putBoolean(TrackingPrefs.KEY_IS_OD, false)
            .apply()
    }

    fun setOdFlag(isOd: Boolean) {
        prefs.edit().putBoolean(TrackingPrefs.KEY_IS_OD, isOd).apply()
    }

    fun setOdStopTime(hour: Int, minute: Int) {
        prefs.edit()
            .putInt(TrackingPrefs.KEY_OD_STOP_HOUR, hour)
            .putInt(TrackingPrefs.KEY_OD_STOP_MINUTE, minute)
            .apply()
    }

    fun setPunchInCache(time: String) {
        prefs.edit().putString(TrackingPrefs.KEY_PUNCH_IN_VALUE, time).apply()
    }

    fun clearPunchCache() {
        prefs.edit()
            .remove(TrackingPrefs.KEY_PUNCH_IN_VALUE)
            .remove(TrackingPrefs.KEY_PUNCH_OUT_VALUE)
            .apply()
    }

    // ── OD auto-stop logic ──────────────────────────────────────────────────────

    /**
     * Returns true if OD tracking should auto-stop right now.
     * Default: 6:30 PM. Can be configured via setOdStopTime().
     */
    fun shouldOdStopNow(): Boolean {
        if (!isOd()) return false
        val now = Calendar.getInstance()
        val stopHour   = prefs.getInt(TrackingPrefs.KEY_OD_STOP_HOUR, 18)
        val stopMinute = prefs.getInt(TrackingPrefs.KEY_OD_STOP_MINUTE, 30)
        val nowMinutes  = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE)
        val stopMinutes = stopHour * 60 + stopMinute
        return nowMinutes >= stopMinutes
    }

    /**
     * Returns milliseconds until OD stop time from now.
     * Used to schedule exact auto-stop alarm.
     */
    fun millisUntilOdStop(): Long {
        val now = Calendar.getInstance()
        val stopHour   = prefs.getInt(TrackingPrefs.KEY_OD_STOP_HOUR, 18)
        val stopMinute = prefs.getInt(TrackingPrefs.KEY_OD_STOP_MINUTE, 30)

        val stopTime = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, stopHour)
            set(Calendar.MINUTE, stopMinute)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }

        val diff = stopTime.timeInMillis - now.timeInMillis
        return if (diff < 0) 0L else diff  // already past stop time
    }
}