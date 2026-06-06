package com.krishihr.app.permission
import com.krishihr.app.AndroidMain

import android.Manifest
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment

/**
 * PermissionManager — handles the full location permission flow.
 *
 * Android location permission flow (3 steps):
 *   Step 1: ACCESS_FINE_LOCATION + ACCESS_COARSE_LOCATION  (foreground)
 *   Step 2: ACCESS_BACKGROUND_LOCATION                     (Android 10+)
 *           Must be asked SEPARATELY after Step 1 is granted
 *   Step 3: SCHEDULE_EXACT_ALARM                           (Android 12+, optional)
 *           Needed for OD auto-stop precision
 *
 * OFFSITE vs ONSITE behaviour:
 *   - OFFSITE employees: background permission is MANDATORY — "Skip" button
 *     is replaced with "Open Settings". The dialog makes it clear they MUST
 *     grant it for tracking to work, and they cannot proceed without it.
 *   - ONSITE employees: background permission is OPTIONAL — they can tap
 *     "Skip" and tracking will still work in foreground-only mode.
 *
 * Usage:
 *   val pm = PermissionManager(fragment)
 *   pm.checkAndRequestAll(isOffsiteEmployee = true) { granted -> startTracking() }
 */
class PermissionManager(private val fragment: Fragment) {

    private val tag = "PermissionManager"
    private var onComplete: ((Boolean) -> Unit)? = null

    /**
     * Whether the current employee is offsite/field.
     * Set by checkAndRequestAll() before any dialog is shown.
     * When true:
     *   • Background permission dialog has no "Skip" — only "Open Settings"
     *   • Denied background permission shows "Open Settings" instead of "Continue Anyway"
     */
    private var isOffsite = false

    // Step 1: Foreground location
    private val foregroundLauncher: ActivityResultLauncher<Array<String>> =
        fragment.registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { results ->
            val granted = results[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
                    results[Manifest.permission.ACCESS_COARSE_LOCATION] == true

            if (!granted) {
                Log.w(tag, "Foreground location denied")
                showGoToSettingsDialog("Location permission is required for attendance tracking.")
                onComplete?.invoke(false)
                return@registerForActivityResult
            }

            // Step 2: Request background (Android 10+) — must be separate request
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                requestBackgroundPermission()
            } else {
                onComplete?.invoke(true)
            }
        }

    // Step 2: Background location
    private val backgroundLauncher: ActivityResultLauncher<String> =
        fragment.registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (!granted) {
                Log.w(tag, "Background location denied (isOffsite=$isOffsite)")
                if (isOffsite) {
                    // Offsite: CANNOT skip — show mandatory settings dialog
                    showOffsiteBackgroundDeniedDialog()
                    onComplete?.invoke(false)
                    return@registerForActivityResult
                } else {
                    // Onsite: warn but allow to continue with foreground tracking
                    showBackgroundDeniedWarning()
                }
            }
            onComplete?.invoke(true)
        }

    /**
     * Main entry point.
     *
     * @param isOffsiteEmployee  true for field/offsite employees — background
     *                           location becomes mandatory and cannot be skipped.
     * @param callback           called with true when tracking can start.
     */
    fun checkAndRequestAll(isOffsiteEmployee: Boolean = false, callback: (Boolean) -> Unit) {
        this.isOffsite  = isOffsiteEmployee
        this.onComplete = callback

        when {
            hasForegroundPermission() && hasBackgroundPermission() -> {
                Log.d(tag, "All permissions already granted")
                callback(true)
            }
            hasForegroundPermission() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q -> {
                // Foreground OK, background missing
                requestBackgroundPermission()
            }
            !hasForegroundPermission() -> {
                requestForegroundPermission()
            }
            else -> callback(true)
        }
    }

    /** Step 1: Request foreground location with explanation */
    private fun requestForegroundPermission() {
        val ctx = fragment.requireContext()

        val shouldShowRationale =
            fragment.shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_FINE_LOCATION)

        if (shouldShowRationale) {
            AlertDialog.Builder(ctx)
                .setTitle("Location Permission Required")
                .setMessage(
                    AndroidMain.PERMISSION_LOCATION_RATIONALE +
                            "• Record your attendance punch-in location\n" +
                            "• Track movement during working hours\n" +
                            "• Verify on-duty (OD) activities\n\n" +
                            "Your location is only recorded during your active work session."
                )
                .setPositiveButton("Allow") { _, _ ->
                    foregroundLauncher.launch(
                        arrayOf(
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION
                        )
                    )
                }
                .setNegativeButton("Cancel") { _, _ -> onComplete?.invoke(false) }
                .setCancelable(false)
                .show()
        } else {
            foregroundLauncher.launch(
                arrayOf(
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION
                )
            )
        }
    }

    /**
     * Step 2: Request background location.
     *
     * Offsite employees see NO "Skip" button — they must grant or open Settings.
     * Onsite employees see a "Skip" button and can continue with foreground-only tracking.
     */
    @androidx.annotation.RequiresApi(Build.VERSION_CODES.Q)
    private fun requestBackgroundPermission() {
        val ctx = fragment.requireContext()

        if (isOffsite) {
            // ── OFFSITE: mandatory — no skip allowed ──────────────────────────
            AlertDialog.Builder(ctx)
                .setTitle("⚠️ Background Location Required")
                .setMessage(
                    "As a field employee, background location access is REQUIRED for attendance tracking.\n\n" +
                            "To enable it:\n" +
                            "1. Tap 'Open Settings' below\n" +
                            "2. Tap 'Permissions' → 'Location'\n" +
                            "3. Select 'Allow all the time'\n\n" +
                            "Without this permission, your movement cannot be tracked and your " +
                            "attendance may be marked incomplete."
                )
                .setPositiveButton("Open Settings") { _, _ ->
                    backgroundLauncher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                }
                // NO negative/skip button for offsite employees
                .setCancelable(false)
                .show()
        } else {
            // ── ONSITE: optional — skip allowed ──────────────────────────────
            AlertDialog.Builder(ctx)
                .setTitle("Enable Background Location")
                .setMessage(
                    "To track your location while the app is in the background:\n\n" +
                            "1. Tap 'Open Settings' below\n" +
                            "2. Tap 'Permissions' → 'Location'\n" +
                            "3. Select 'Allow all the time'\n\n" +
                            "This ensures your location is recorded even when you switch apps " +
                            "during working hours. Office employees can skip this."
                )
                .setPositiveButton("Open Settings") { _, _ ->
                    backgroundLauncher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                }
                .setNegativeButton("Skip") { _, _ ->
                    // Onsite can skip background — foreground tracking still works
                    onComplete?.invoke(true)
                }
                .setCancelable(false)
                .show()
        }
    }

    /**
     * Shown to offsite employees when background permission is denied.
     * Forces them to open Settings — cannot dismiss without going to settings.
     */
    private fun showOffsiteBackgroundDeniedDialog() {
        AlertDialog.Builder(fragment.requireContext())
            .setTitle("⚠️ Permission Required")
            .setMessage(
                "Background location is mandatory for field employees.\n\n" +
                        "Please go to Settings → Apps → KrishiHR → Permissions → Location " +
                        "and select 'Allow all the time'.\n\n" +
                        "You cannot punch in without this permission."
            )
            .setPositiveButton("Open Settings") { _, _ -> openAppSettings() }
            .setCancelable(false)
            .show()
    }

    /** Shown to onsite employees when background permission is denied (warning only). */
    private fun showBackgroundDeniedWarning() {
        AlertDialog.Builder(fragment.requireContext())
            .setTitle("Limited Tracking")
            .setMessage(
                "Background location was not granted. Your location will only be tracked " +
                        "while the app is open.\n\n" +
                        AndroidMain.PERMISSION_BACKGROUND_SETTINGS_HINT
            )
            .setPositiveButton("Open Settings") { _, _ -> openAppSettings() }
            .setNegativeButton("Continue Anyway") { _, _ -> }
            .show()
    }

    private fun showGoToSettingsDialog(message: String) {
        AlertDialog.Builder(fragment.requireContext())
            .setTitle("Permission Required")
            .setMessage("$message\n\nPlease enable location permission in Settings.")
            .setPositiveButton("Open Settings") { _, _ -> openAppSettings() }
            .setNegativeButton("Cancel") { _, _ -> }
            .show()
    }

    private fun openAppSettings() {
        fragment.startActivity(
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.parse("package:${fragment.requireContext().packageName}")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
        )
    }

    // ── Permission state checks ────────────────────────────────────────────────

    fun hasForegroundPermission(): Boolean {
        val ctx = fragment.requireContext()
        return ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) ==
                PackageManager.PERMISSION_GRANTED ||
                ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) ==
                PackageManager.PERMISSION_GRANTED
    }

    fun hasBackgroundPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true
        return ContextCompat.checkSelfPermission(
            fragment.requireContext(), Manifest.permission.ACCESS_BACKGROUND_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
    }

    fun hasAllPermissions(): Boolean = hasForegroundPermission() && hasBackgroundPermission()

    companion object {
        /** Static check — can be used from Service/Worker without Fragment */
        fun hasForegroundPermission(ctx: Context): Boolean =
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) ==
                    PackageManager.PERMISSION_GRANTED ||
                    ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) ==
                    PackageManager.PERMISSION_GRANTED

        /**
         * Returns true if the employee's employment_type indicates they are a
         * field / offsite worker who requires mandatory background tracking.
         *
         * Backend values expected for offsite: "field", "offsite", "field_employee",
         * "sales", "remote_field" — anything that is NOT "office" / "onsite" / null.
         *
         * We use a whitelist for onsite (safer than blacklist) so new backend types
         * default to OFFSITE (stricter) rather than accidentally skipping tracking.
         */
        fun isOffsiteEmployee(employmentType: String?): Boolean {
            if (employmentType.isNullOrBlank()) return false
            val t = employmentType.trim().lowercase()
            // Onsite / office types — these employees CAN skip tracking
            val onsiteTypes = setOf("office", "onsite", "on_site", "wfh", "work_from_home", "hybrid")
            return t !in onsiteTypes
        }
    }
}
