package com.krishihr.app.ui
import com.krishihr.app.AndroidMain

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.appcompat.app.AppCompatActivity
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import com.krishihr.app.R
import com.krishihr.app.data.api.RetrofitClient
import com.krishihr.app.databinding.ActivityMainBinding
import com.krishihr.app.ui.attendance.AttendanceFragment
import com.krishihr.app.ui.dashboard.DashboardFragment
import com.krishihr.app.ui.leave.LeaveFragment
import com.krishihr.app.ui.login.LoginActivity
import com.krishihr.app.ui.more.ApprovalsFragment
import com.krishihr.app.ui.more.MoreFragment
import com.krishihr.app.utils.Roles
import com.krishihr.app.utils.SessionManager
import java.util.Calendar

class MainActivity : AppCompatActivity() {

    internal lateinit var binding: ActivityMainBinding
    lateinit var sessionManager: SessionManager

    // ── Midnight cache-clear scheduler ───────────────────────────────────────
    private val midnightHandler = Handler(Looper.getMainLooper())
    private val midnightRunnable = Runnable { onMidnight() }

    // ── Date-change broadcast receiver (catches date change while app is open) ─
    // When date changes at midnight: clear stale cache + reload dashboard fresh
    // No logout needed — just wipe yesterday's punch data and refresh UI
    private val dateChangeReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context?, intent: Intent?) {
            if (intent?.action == Intent.ACTION_DATE_CHANGED ||
                intent?.action == Intent.ACTION_TIMEZONE_CHANGED) {
                clearAttendanceCache()
                lastKnownDate = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.getDefault())
                    .also { it.timeZone = java.util.TimeZone.getTimeZone("Asia/Kolkata") }
                    .format(java.util.Date())
                // Reload to dashboard so punch-in shows fresh for the new day
                loadTab(DashboardFragment())
                binding.bottomNavView.selectedItemId = R.id.nav_dashboard
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        sessionManager = SessionManager(this)
        RetrofitClient.init(sessionManager, this)

        // Schedule daily OD check — detects approved OD for today and auto-starts tracking
        if (sessionManager.isLoggedIn()) {
            com.krishihr.app.ui.attendance.OdTrackingWorker.scheduleDailyCheck(this)

            // ── Auto-restart tracking on login ──────────────────────────────
            // If employee was punched in before logout, restart tracking automatically.
            // No need to ask permissions again — they were already granted.
            val trackingMgr = com.krishihr.app.domain.usecase.TrackingManager(this)
            val alreadyRunning = com.krishihr.app.service.LocationTrackingService.isRunning(this)
            val hasPerm        = com.krishihr.app.permission.PermissionManager.hasForegroundPermission(this)
            val isPunchedIn    = trackingMgr.isPunchedIn()

            if (isPunchedIn && !alreadyRunning && hasPerm) {
                val session = trackingMgr.getSession()
                com.krishihr.app.service.LocationTrackingService.start(this, isOd = session.isOd)
                android.util.Log.d("MainActivity", "✅ Auto-restarted tracking on login (isOd=${session.isOd})")
            }
        }

        // Show Approvals tab to everyone except regular employees
        // Manager/TL: can approve requests
        // HR/Admin/Accounts/SuperAdmin: can VIEW requests (read-only, backend enforces approval rules)
        val role = sessionManager.getRole()
        binding.bottomNavView.menu.findItem(R.id.nav_approvals)?.isVisible =
            role != Roles.EMPLOYEE

        setupBottomNav()
        scheduleMidnightLogout()
        registerDateChangeReceiver()

        if (savedInstanceState == null) {
            // Check for deep link from Splash/email tap
            val deepLinkHandled = intent?.data?.scheme == AndroidMain.DEEP_LINK_SCHEME
            if (deepLinkHandled) {
                handleDeepLink(intent)
            } else {
                loadTab(DashboardFragment())
                binding.bottomNavView.selectedItemId = R.id.nav_dashboard
            }
        }
    }

    // ── Schedule midnight cache-clear (no logout — just wipe yesterday's data) ─
    private fun scheduleMidnightLogout() {
        midnightHandler.removeCallbacks(midnightRunnable)
        val now = Calendar.getInstance(java.util.TimeZone.getTimeZone("Asia/Kolkata"))
        val midnight = Calendar.getInstance(java.util.TimeZone.getTimeZone("Asia/Kolkata")).apply {
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 5)   // 5 sec past midnight
            set(Calendar.MILLISECOND, 0)
            add(Calendar.DAY_OF_MONTH, 1)
        }
        val msUntilMidnight = midnight.timeInMillis - now.timeInMillis
        midnightHandler.postDelayed(midnightRunnable, msUntilMidnight)
    }

    // Called at midnight: clear stale cache + reload UI fresh for the new day
    private fun onMidnight() {
        clearAttendanceCache()
        lastKnownDate = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.getDefault())
            .also { it.timeZone = java.util.TimeZone.getTimeZone("Asia/Kolkata") }
            .format(java.util.Date())
        // Refresh to dashboard so the new day's punch state is correct
        loadTab(DashboardFragment())
        binding.bottomNavView.selectedItemId = R.id.nav_dashboard
        // Reschedule for NEXT midnight
        scheduleMidnightLogout()
    }

    private fun registerDateChangeReceiver() {
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_DATE_CHANGED)
            addAction(Intent.ACTION_TIME_CHANGED)
            addAction(Intent.ACTION_TIMEZONE_CHANGED)
        }
        registerReceiver(dateChangeReceiver, filter)
    }

    // ── Detect date change when app comes back from background ──────────────
    // e.g. employee punched out yesterday evening, opens app next morning
    // onResume fires → we check if date changed → force full UI refresh
    private var lastKnownDate: String = ""

    override fun onResume() {
        super.onResume()
        val todayIST = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.getDefault())
            .also { it.timeZone = java.util.TimeZone.getTimeZone("Asia/Kolkata") }
            .format(java.util.Date())

        if (lastKnownDate.isNotEmpty() && lastKnownDate != todayIST) {
            // Date changed while app was in background — clear all caches and reload
            clearAttendanceCache()
            // Reload current tab so fresh data shows immediately
            val current = supportFragmentManager.findFragmentById(R.id.navHostFragment)
            when (current) {
                is DashboardFragment  -> loadTab(DashboardFragment())
                is AttendanceFragment -> loadTab(AttendanceFragment())
                else                  -> loadTab(DashboardFragment())
            }
            binding.bottomNavView.selectedItemId = R.id.nav_dashboard
        }
        lastKnownDate = todayIST
    }

    // Clear both attendance and dashboard cache so stale yesterday data never shows
    private fun clearAttendanceCache() {
        getSharedPreferences(AndroidMain.PREFS_ATT_CACHE, android.content.Context.MODE_PRIVATE)
            .edit().clear().apply()
        getSharedPreferences(AndroidMain.PREFS_DASH_CACHE, android.content.Context.MODE_PRIVATE)
            .edit().clear().apply()
    }

    override fun onDestroy() {
        super.onDestroy()
        midnightHandler.removeCallbacks(midnightRunnable)
        try { unregisterReceiver(dateChangeReceiver) } catch (_: Exception) {}
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleDeepLink(intent)
    }

    private fun handleDeepLink(intent: Intent?) {
        val uri = intent?.data ?: return
        if (uri.scheme != AndroidMain.DEEP_LINK_SCHEME) return
        val path = uri.host ?: uri.path?.trimStart('/') ?: return
        val tabIndex = uri.getQueryParameter("tab")?.toIntOrNull()

        when (path.lowercase()) {
            "approvals" -> {
                val frag = com.krishihr.app.ui.more.ApprovalsFragment()
                loadTab(frag)
                binding.bottomNavView.selectedItemId = R.id.nav_approvals
                // Switch to sub-tab after fragment loads (0=Leave,1=OD/WFH,2=Reg,3=Advance)
                if (tabIndex != null) {
                    android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                        frag.switchToTab(tabIndex)
                    }, 350)
                }
            }
            "leave" -> {
                loadTab(LeaveFragment())
                binding.bottomNavView.selectedItemId = R.id.nav_leave
            }
            "attendance" -> {
                loadTab(AttendanceFragment())
                binding.bottomNavView.selectedItemId = R.id.nav_attendance
            }
            "more", "profile" -> {
                loadTab(MoreFragment())
                binding.bottomNavView.selectedItemId = R.id.nav_more
            }
            else -> {
                loadTab(DashboardFragment())
                binding.bottomNavView.selectedItemId = R.id.nav_dashboard
            }
        }
    }

    private fun setupBottomNav() {
        binding.bottomNavView.setOnItemSelectedListener { item ->
            when (item.itemId) {
                R.id.nav_dashboard  -> { loadTab(DashboardFragment()); true }
                R.id.nav_attendance -> { loadTab(AttendanceFragment()); true }
                R.id.nav_leave      -> { loadTab(LeaveFragment()); true }
                R.id.nav_approvals  -> { loadTab(ApprovalsFragment()); true }
                R.id.nav_more       -> { loadTab(MoreFragment()); true }
                else -> false
            }
        }
    }

    // isTab=true for bottom nav (no back stack), isTab=false for sub-screens (back stack)
    fun loadFragment(fragment: Fragment, addToBack: Boolean = true) {
        val tx = supportFragmentManager.beginTransaction()
            .setCustomAnimations(android.R.anim.fade_in, android.R.anim.fade_out)
            .replace(R.id.navHostFragment, fragment)
        if (addToBack) tx.addToBackStack(null)
        tx.commit()
    }

    // Bottom nav tabs - no back stack (replace root)
    fun loadTab(fragment: Fragment) {
        // Clear entire back stack when switching tabs
        supportFragmentManager.popBackStack(null, androidx.fragment.app.FragmentManager.POP_BACK_STACK_INCLUSIVE)
        supportFragmentManager.beginTransaction()
            .setCustomAnimations(android.R.anim.fade_in, android.R.anim.fade_out)
            .replace(R.id.navHostFragment, fragment)
            .commit()
    }

    /** Called when user opens NotificationsFragment — instantly clears the bell badge */
    fun refreshDashboardBadge() {
        val frag = supportFragmentManager.findFragmentById(R.id.navHostFragment)
        if (frag is com.krishihr.app.ui.dashboard.DashboardFragment) {
            frag.clearNotifBadge()
        }
    }

    fun logout() {
        // Mark offline before clearing session
        lifecycleScope.launch(Dispatchers.IO) {
            try { RetrofitClient.instance.markOffline() } catch (_: Exception) {}
        }
        sessionManager.clearSession()
        startActivity(Intent(this, LoginActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        })
        finish()
    }

    override fun onBackPressed() {
        if (supportFragmentManager.backStackEntryCount > 0) {
            supportFragmentManager.popBackStack()
        } else {
            // If we're not on dashboard, go to dashboard instead of closing
            val current = supportFragmentManager.findFragmentById(R.id.navHostFragment)
            if (current !is com.krishihr.app.ui.dashboard.DashboardFragment) {
                binding.bottomNavView.selectedItemId = R.id.nav_dashboard
            } else {
                // On dashboard — minimize app (don't close)
                moveTaskToBack(true)
            }
        }
    }
}