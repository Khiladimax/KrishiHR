package com.krishihr.app.domain.model
import com.krishihr.app.AndroidMain

data class TrackingSession(
    val isTracking: Boolean = false,
    val isOd: Boolean = false,
    val punchInTime: Long = 0L,
    val odStopTimeHour: Int = 18,
    val odStopTimeMinute: Int = 30
)

object TrackingPrefs {
    val PREFS_NAME get() = AndroidMain.PREFS_TRACK
    const val KEY_IS_TRACKING     = "is_tracking"
    const val KEY_IS_OD           = "is_od"
    const val KEY_PUNCH_IN_TIME   = "punch_in_time"
    const val KEY_OD_STOP_HOUR    = "od_stop_hour"
    const val KEY_OD_STOP_MINUTE  = "od_stop_minute"
    const val KEY_PUNCH_IN_VALUE  = "punch_in"
    const val KEY_PUNCH_OUT_VALUE = "punch_out"
}

enum class StopReason {
    PUNCH_OUT,
    OD_TIME_EXCEEDED,
    SESSION_EXPIRED,
    MANUAL
}
