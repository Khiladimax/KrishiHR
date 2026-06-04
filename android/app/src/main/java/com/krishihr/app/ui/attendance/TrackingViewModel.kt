package com.krishihr.app.ui.attendance

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.krishihr.app.data.api.RetrofitClient
import com.krishihr.app.data.models.PunchRequest
import com.krishihr.app.domain.model.StopReason
import com.krishihr.app.domain.usecase.TrackingManager
import com.krishihr.app.service.LocationTrackingService
import com.krishihr.app.utils.SessionManager
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

/**
 * TrackingViewModel — MVVM ViewModel for punch-in/out and tracking state.
 *
 * Exposes:
 *   - trackingState: StateFlow<TrackingUiState>
 *   - events: SharedFlow<TrackingEvent> (one-shot UI events)
 *
 * Does NOT hold Context directly — uses Application context safely.
 */
class TrackingViewModel(app: Application) : AndroidViewModel(app) {

    private val ctx: Context = app.applicationContext
    private val trackingManager = TrackingManager(ctx)
    private val session = SessionManager(ctx)

    // ── UI State ───────────────────────────────────────────────────────────────

    private val _state = MutableStateFlow(TrackingUiState())
    val state: StateFlow<TrackingUiState> = _state.asStateFlow()

    private val _events = MutableSharedFlow<TrackingEvent>()
    val events: SharedFlow<TrackingEvent> = _events.asSharedFlow()

    init {
        // Sync UI state with current tracking state on init
        _state.update {
            it.copy(
                isTracking = trackingManager.isTracking(),
                isOd       = trackingManager.isOd()
            )
        }
    }

    // ── Punch In ───────────────────────────────────────────────────────────────

    fun punchIn(
        lat: Double,
        lng: Double,
        locLabel: String,
        geofenceValid: Boolean,
        isOd: Boolean = false
    ) {
        viewModelScope.launch {
            _state.update { it.copy(isLoading = true, error = null) }

            val punchTime = java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault())
                .format(java.util.Date())
            val punchDate = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.getDefault())
                .format(java.util.Date())

            var success = false
            var lastError = "Failed"

            // Retry 3 times (handles Render cold start)
            repeat(3) { attempt ->
                try {
                    val req = PunchRequest(
                        lat = lat, lng = lng,
                        punchInLocation = locLabel, punchOutLocation = null,
                        punchTime = punchTime, punchDate = punchDate,
                        source = "mobile", geofenceValid = geofenceValid
                    )
                    val res = RetrofitClient.instance.punchIn(req)
                    if (res.isSuccessful && res.body()?.success == true) {
                        success = true
                        return@repeat
                    } else {
                        lastError = res.body()?.message ?: "Server error ${res.code()}"
                        if (attempt < 2) {
                            _state.update { it.copy(retryMessage = "Waking server… (${attempt+1}/3)") }
                            delay(15_000L)
                        }
                    }
                } catch (e: Exception) {
                    lastError = e.message ?: "Network error"
                    if (attempt < 2) delay(15_000L)
                }
            }

            if (success) {
                // Start tracking
                trackingManager.startTracking(isOd)
                trackingManager.setPunchInCache(punchTime)
                LocationTrackingService.start(ctx, isOd)
                LocationTrackingService.requestBatteryExemption(ctx)

                _state.update {
                    it.copy(
                        isLoading    = false,
                        hasPunchedIn = true,
                        isTracking   = true,
                        isOd         = isOd,
                        retryMessage = null
                    )
                }
                _events.emit(TrackingEvent.PunchSuccess("Punched In Successfully ✅"))
            } else {
                _state.update { it.copy(isLoading = false, error = lastError, retryMessage = null) }
                _events.emit(TrackingEvent.Error(lastError))
            }
        }
    }

    // ── Punch Out ──────────────────────────────────────────────────────────────

    fun punchOut(
        lat: Double,
        lng: Double,
        locLabel: String,
        geofenceValid: Boolean
    ) {
        viewModelScope.launch {
            _state.update { it.copy(isLoading = true, error = null) }

            val punchTime = java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault())
                .format(java.util.Date())
            val punchDate = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.getDefault())
                .format(java.util.Date())

            var success = false
            var lastError = "Failed"

            repeat(3) { attempt ->
                try {
                    val req = PunchRequest(
                        lat = lat, lng = lng,
                        punchInLocation = null, punchOutLocation = locLabel,
                        punchTime = punchTime, punchDate = punchDate,
                        source = "mobile", geofenceValid = geofenceValid
                    )
                    val res = RetrofitClient.instance.punchOut(req)
                    if (res.isSuccessful && res.body()?.success == true) {
                        success = true
                        return@repeat
                    } else {
                        lastError = res.body()?.message ?: "Server error ${res.code()}"
                        if (attempt < 2) {
                            _state.update { it.copy(retryMessage = "Waking server… (${attempt+1}/3)") }
                            delay(15_000L)
                        }
                    }
                } catch (e: Exception) {
                    lastError = e.message ?: "Network error"
                    if (attempt < 2) delay(15_000L)
                }
            }

            if (success) {
                // Stop all tracking layers
                LocationTrackingService.stop(ctx, StopReason.PUNCH_OUT)
                trackingManager.clearPunchCache()

                _state.update {
                    it.copy(
                        isLoading     = false,
                        hasPunchedIn  = false,
                        hasPunchedOut = true,
                        isTracking    = false,
                        isOd          = false,
                        retryMessage  = null
                    )
                }
                _events.emit(TrackingEvent.PunchSuccess("Punched Out Successfully ✅"))
            } else {
                _state.update { it.copy(isLoading = false, error = lastError, retryMessage = null) }
                _events.emit(TrackingEvent.Error(lastError))
            }
        }
    }
}

// ── UI State ───────────────────────────────────────────────────────────────────

data class TrackingUiState(
    val isLoading: Boolean    = false,
    val hasPunchedIn: Boolean = false,
    val hasPunchedOut: Boolean = false,
    val isTracking: Boolean   = false,
    val isOd: Boolean         = false,
    val error: String?        = null,
    val retryMessage: String? = null
)

// ── One-shot events ────────────────────────────────────────────────────────────

sealed class TrackingEvent {
    data class PunchSuccess(val message: String) : TrackingEvent()
    data class Error(val message: String)        : TrackingEvent()
    object NeedLocationPermission                : TrackingEvent()
    object NeedGpsEnabled                        : TrackingEvent()
}