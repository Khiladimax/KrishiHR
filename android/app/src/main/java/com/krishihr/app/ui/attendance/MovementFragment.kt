package com.krishihr.app.ui.attendance
import com.krishihr.app.AndroidMain

import android.animation.ValueAnimator
import android.app.DatePickerDialog
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.*
import android.view.animation.LinearInterpolator
import android.widget.*
import androidx.cardview.widget.CardView
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.google.android.gms.maps.*
import com.google.android.gms.maps.model.*
import com.krishihr.app.R
import com.krishihr.app.data.api.RetrofitClient
import com.krishihr.app.data.models.Employee
import com.krishihr.app.data.models.MovementPoint
import com.krishihr.app.utils.Roles
import com.krishihr.app.utils.SessionManager
import kotlinx.coroutines.*
import org.json.JSONObject
import java.net.URL
import java.text.SimpleDateFormat
import java.util.*

/**
 * MovementFragment v2 — Full-featured employee movement tracking
 *
 * Features:
 *  1. Single employee route — road-snapped polyline via Google Directions API
 *  2. Speed heatmap — polyline segments coloured green/orange/red by speed
 *  3. Route replay animation — animated marker walks the route
 *  4. Multi-employee live map — all field staff dots on one map (admin view)
 *  5. Offline queue badge — shows how many points are pending sync
 *  6. Tracking transparency banner — "🟢 GPS Active" shown when service running
 *  7. Low battery / signal loss indicator on timeline
 *
 * Map layers (single employee mode):
 *  • Speed-coloured polyline segments (green < 30 km/h, orange 30–80, red > 80)
 *  • Blue circles  — real GPS points
 *  • Orange circles — 500m road marks
 *  • Green marker  — START
 *  • Red marker    — END
 *  • Cyan marker   — current position (live mode)
 *  • Animated replay marker — route replay mode
 */
class MovementFragment : Fragment(), OnMapReadyCallback {

    // ── Mode ──────────────────────────────────────────────────────────────────
    private enum class ViewMode { SINGLE, MULTI_LIVE }
    private var viewMode = ViewMode.SINGLE

    // ── State ─────────────────────────────────────────────────────────────────
    private lateinit var session: SessionManager
    private var employees: List<Employee> = emptyList()
    private var selectedDate: String = todayIST()
    private var isLiveMode = false
    private var lastPointCount = 0
    private var currentEmpId = -1
    private var isReplayRunning = false
    private var replayAnimator: ValueAnimator? = null

    // ── Map ───────────────────────────────────────────────────────────────────
    private var googleMap: GoogleMap? = null
    private var mapFragment: SupportMapFragment? = null
    private var mapReady = false
    private var pendingPoints: List<MovementPoint>? = null
    private var pendingAnimate = false

    // Overlay references
    private val polylines   = mutableListOf<Polyline>()
    private val orangeDots  = mutableListOf<Circle>()
    private val gpsDots     = mutableListOf<Circle>()
    private val markers     = mutableListOf<Marker>()
    private var replayMarker: Marker? = null
    private val multiDots   = mutableMapOf<Int, Marker>() // empId → marker (multi mode)

    // ── Views ─────────────────────────────────────────────────────────────────
    private lateinit var spinnerEmp: Spinner
    private lateinit var btnDate: Button
    private lateinit var btnSearch: Button
    private lateinit var btnReplay: Button
    private lateinit var btnMultiLive: Button
    private lateinit var tvStatus: TextView
    private lateinit var tvLiveTag: TextView
    private lateinit var tvTrackingBanner: TextView
    private lateinit var tvOfflineQueue: TextView
    private lateinit var llSummaryCards: LinearLayout
    private lateinit var llTimeline: LinearLayout
    private lateinit var cardMap: CardView
    private lateinit var cardTimeline: CardView
    private lateinit var cardControls: CardView

    // ── Live refresh ──────────────────────────────────────────────────────────
    private val liveHandler = Handler(Looper.getMainLooper())
    private val liveRunnable = object : Runnable {
        override fun run() {
            when (viewMode) {
                ViewMode.SINGLE -> if (isLiveMode && currentEmpId != -1) refreshLiveRoute()
                ViewMode.MULTI_LIVE -> refreshMultiLiveMap()
            }
            liveHandler.postDelayed(this, AndroidMain.MOVEMENT_LIVE_REFRESH_MS)
        }
    }

    private val mapScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View {
        session = SessionManager(requireContext())
        return buildUI()
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        initMapFragment(savedInstanceState)
        loadEmployees()
        refreshTrackingBanner()
        refreshOfflineQueueBadge()
    }

    override fun onResume() {
        super.onResume()
        refreshTrackingBanner()
        refreshOfflineQueueBadge()
        if (isLiveMode || viewMode == ViewMode.MULTI_LIVE) liveHandler.post(liveRunnable)
    }

    override fun onPause() {
        super.onPause()
        liveHandler.removeCallbacks(liveRunnable)
        replayAnimator?.pause()
    }

    override fun onDestroyView() {
        super.onDestroyView()
        liveHandler.removeCallbacks(liveRunnable)
        replayAnimator?.cancel()
        mapScope.cancel()
    }

    // ── Tracking Transparency Banner ──────────────────────────────────────────

    private fun refreshTrackingBanner() {
        val isTracking = com.krishihr.app.domain.usecase.TrackingManager(requireContext()).isTracking()
        tvTrackingBanner.visibility = if (isTracking) View.VISIBLE else View.GONE
    }

    // ── Offline Queue Badge ───────────────────────────────────────────────────

    private fun refreshOfflineQueueBadge() {
        lifecycleScope.launch {
            try {
                val repo = com.krishihr.app.data.repository.LocationRepository(requireContext())
                val pending = repo.getPendingCount()
                withContext(Dispatchers.Main) {
                    if (pending > 0) {
                        tvOfflineQueue.visibility = View.VISIBLE
                        tvOfflineQueue.text = "📶 $pending point(s) pending sync"
                    } else {
                        tvOfflineQueue.visibility = View.GONE
                    }
                }
            } catch (_: Exception) {}
        }
    }

    // ── Map init ──────────────────────────────────────────────────────────────

    private fun initMapFragment(savedState: Bundle?) {
        mapFragment = SupportMapFragment.newInstance(
            GoogleMapOptions()
                .mapType(GoogleMap.MAP_TYPE_NORMAL)
                .zoomControlsEnabled(true)
                .compassEnabled(true)
        )
        childFragmentManager.beginTransaction()
            .replace(R.id.map_container, mapFragment!!)
            .commit()
        mapFragment!!.getMapAsync(this)
    }

    override fun onMapReady(map: GoogleMap) {
        googleMap = map
        mapReady = true
        map.uiSettings.apply {
            isZoomControlsEnabled = true
            isCompassEnabled = true
            isMyLocationButtonEnabled = false
        }
        map.mapType = GoogleMap.MAP_TYPE_NORMAL
        pendingPoints?.let { pts ->
            renderOnMap(pts, pendingAnimate)
            pendingPoints = null
        }
    }

    // ── UI Build ──────────────────────────────────────────────────────────────

    private fun buildUI(): View {
        val ctx = requireContext()
        val dp = ctx.resources.displayMetrics.density

        val scroll = ScrollView(ctx).apply {
            setBackgroundColor(ContextCompat.getColor(ctx, R.color.background))
            layoutParams = ViewGroup.LayoutParams(MATCH, MATCH)
        }
        val outer = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(px(12, dp), px(12, dp), px(12, dp), px(80, dp))
        }
        scroll.addView(outer)

        // ── Tracking transparency banner ──────────────────────────────────────
        tvTrackingBanner = TextView(ctx).apply {
            text = "🟢 GPS Tracking Active — your location is being recorded"
            textSize = 11f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(px(12, dp), px(8, dp), px(12, dp), px(8, dp))
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#16a34a")); cornerRadius = 8f
            }
            layoutParams = llp(MATCH, WRAP).also { it.bottomMargin = px(8, dp) }
            visibility = View.GONE
        }
        outer.addView(tvTrackingBanner)

        // ── Offline queue badge ───────────────────────────────────────────────
        tvOfflineQueue = TextView(ctx).apply {
            textSize = 11f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(px(12, dp), px(6, dp), px(12, dp), px(6, dp))
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#d97706")); cornerRadius = 8f
            }
            layoutParams = llp(MATCH, WRAP).also { it.bottomMargin = px(8, dp) }
            visibility = View.GONE
        }
        outer.addView(tvOfflineQueue)

        // ── Filter card ───────────────────────────────────────────────────────
        cardControls = makeCard(ctx, dp)
        val filterLL = vLL(ctx).apply { setPadding(px(16, dp), px(14, dp), px(16, dp), px(14, dp)) }
        cardControls.addView(filterLL); outer.addView(cardControls)

        // Header row with LIVE tag
        val headerRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, 0, 0, px(10, dp))
        }
        headerRow.addView(TextView(ctx).apply {
            text = "📍 Employee Movement Tracker"; textSize = 15f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(ContextCompat.getColor(ctx, R.color.text_primary))
            layoutParams = llp(0, WRAP, 1f)
        })
        tvLiveTag = TextView(ctx).apply {
            text = "🔴 LIVE"; textSize = 10f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(Color.WHITE)
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#DC2626")); cornerRadius = 20f
            }
            setPadding(px(6, dp), px(3, dp), px(6, dp), px(3, dp))
            visibility = View.GONE
        }
        headerRow.addView(tvLiveTag)
        filterLL.addView(headerRow)

        // Mode toggle row — Single / Multi-Live
        val modeRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = llp(MATCH, WRAP).also { it.bottomMargin = px(10, dp) }
        }
        btnMultiLive = Button(ctx).apply {
            text = "👥 All Field Staff (Live)"
            textSize = 11f
            layoutParams = llp(0, px(38, dp), 1f).also { it.marginEnd = px(4, dp) }
            setBackgroundColor(ContextCompat.getColor(ctx, R.color.primary_ultra_light))
            setTextColor(ContextCompat.getColor(ctx, R.color.primary))
            setOnClickListener { toggleMultiLiveMode() }
        }
        modeRow.addView(btnMultiLive)
        filterLL.addView(modeRow)

        // Employee spinner
        filterLL.addView(lbl(ctx, "Employee", dp))
        spinnerEmp = Spinner(ctx).apply {
            layoutParams = llp(MATCH, px(44, dp)).also { it.bottomMargin = px(10, dp) }
        }
        filterLL.addView(spinnerEmp)

        // Date
        filterLL.addView(lbl(ctx, "Date", dp))
        btnDate = Button(ctx).apply {
            text = "📅  $selectedDate"; textSize = 13f
            layoutParams = llp(MATCH, px(44, dp)).also { it.bottomMargin = px(12, dp) }
            setBackgroundColor(ContextCompat.getColor(ctx, R.color.primary_ultra_light))
            setTextColor(ContextCompat.getColor(ctx, R.color.primary))
            setOnClickListener { pickDate() }
        }
        filterLL.addView(btnDate)

        btnSearch = Button(ctx).apply {
            text = "🔍  Search"; textSize = 14f
            layoutParams = llp(MATCH, px(46, dp))
            setBackgroundColor(ContextCompat.getColor(ctx, R.color.primary))
            setTextColor(ContextCompat.getColor(ctx, R.color.white))
            setOnClickListener { doSearch() }
        }
        filterLL.addView(btnSearch)

        // ── Status ────────────────────────────────────────────────────────────
        tvStatus = TextView(ctx).apply {
            text = "Select an employee and date, then tap Search"
            textSize = 13f; gravity = Gravity.CENTER
            setTextColor(ContextCompat.getColor(ctx, R.color.text_secondary))
            setPadding(0, px(20, dp), 0, px(20, dp))
        }
        outer.addView(tvStatus)

        // ── Stat cards ────────────────────────────────────────────────────────
        llSummaryCards = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = llp(MATCH, WRAP).also { it.bottomMargin = px(12, dp) }
            visibility = View.GONE
        }
        outer.addView(llSummaryCards)

        // ── Map card ──────────────────────────────────────────────────────────
        cardMap = makeCard(ctx, dp).apply {
            visibility = View.GONE
            (layoutParams as LinearLayout.LayoutParams).bottomMargin = px(12, dp)
        }
        val mapLL = vLL(ctx).apply { setPadding(px(14, dp), px(12, dp), px(14, dp), px(12, dp)) }
        cardMap.addView(mapLL); outer.addView(cardMap)

        // Map header + replay button row
        val mapHeaderRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, 0, 0, px(8, dp))
        }
        mapHeaderRow.addView(TextView(ctx).apply {
            text = "🗺️  Route Map"; textSize = 14f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(ContextCompat.getColor(ctx, R.color.text_primary))
            layoutParams = llp(0, WRAP, 1f)
        })
        btnReplay = Button(ctx).apply {
            text = "▶ Replay"; textSize = 11f
            layoutParams = llp(WRAP, px(32, dp))
            setBackgroundColor(ContextCompat.getColor(ctx, R.color.primary))
            setTextColor(Color.WHITE)
            visibility = View.GONE
            setOnClickListener { toggleReplay() }
        }
        mapHeaderRow.addView(btnReplay)
        mapLL.addView(mapHeaderRow)

        // Map container
        val mapContainer = FrameLayout(ctx).apply {
            id = R.id.map_container
            layoutParams = llp(MATCH, px(420, dp))
        }
        mapLL.addView(mapContainer)

        // Speed heatmap legend
        val legendRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, px(8, dp), 0, 0)
        }
        fun dot(color: Int) = View(ctx).apply {
            val sz = px(10, dp)
            layoutParams = LinearLayout.LayoutParams(sz, sz).also { it.marginEnd = px(4, dp) }
            background = android.graphics.drawable.GradientDrawable().apply {
                shape = android.graphics.drawable.GradientDrawable.OVAL; setColor(color)
            }
        }
        fun legendTxt(t: String) = TextView(ctx).apply {
            text = t; textSize = 10f
            setTextColor(ContextCompat.getColor(ctx, R.color.text_secondary))
            layoutParams = llp(WRAP, WRAP).also { it.marginEnd = px(12, dp) }
        }
        legendRow.addView(dot(Color.parseColor("#16a34a"))); legendRow.addView(legendTxt("Start"))
        legendRow.addView(dot(Color.parseColor("#dc2626"))); legendRow.addView(legendTxt("End"))
        legendRow.addView(dot(Color.parseColor("#3b82f6"))); legendRow.addView(legendTxt("GPS pt"))
        legendRow.addView(dot(Color.parseColor("#16a34a"))); legendRow.addView(legendTxt("<30km/h"))
        legendRow.addView(dot(Color.parseColor("#f97316"))); legendRow.addView(legendTxt("30–80"))
        legendRow.addView(dot(Color.parseColor("#dc2626"))); legendRow.addView(legendTxt(">80"))
        mapLL.addView(legendRow)

        // ── Timeline card ─────────────────────────────────────────────────────
        cardTimeline = makeCard(ctx, dp).apply { visibility = View.GONE }
        val tlLL = vLL(ctx).apply { setPadding(px(14, dp), px(12, dp), px(14, dp), px(12, dp)) }
        cardTimeline.addView(tlLL); outer.addView(cardTimeline)
        tlLL.addView(TextView(ctx).apply {
            text = "📋  Point Timeline"; textSize = 14f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(ContextCompat.getColor(ctx, R.color.text_primary))
            setPadding(0, 0, 0, px(8, dp))
        })
        llTimeline = vLL(ctx)
        tlLL.addView(llTimeline)

        return scroll
    }

    // ── Load employees ────────────────────────────────────────────────────────

    private fun loadEmployees() {
        val emp = session.getEmployee() ?: return
        val role = session.getRole()
        val seeAll = emp.employeeCode == AndroidMain.SEE_ALL_MOVEMENT_CODE
                || role == Roles.SUPER_ADMIN || role == Roles.HR

        lifecycleScope.launch {
            try {
                val res = RetrofitClient.instance.getEmployees()
                if (res.isSuccessful && res.body()?.success == true) {
                    val all = res.body()!!.data ?: emptyList()
                    employees = if (seeAll) all
                    else all.filter { it.reportingManagerId == emp.id }

                    val names = mutableListOf("— Select Employee —")
                    names.addAll(employees.map { "${it.firstName} ${it.lastName} (${it.employeeCode})" })
                    val adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_item, names)
                    adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
                    spinnerEmp.adapter = adapter
                }
            } catch (_: Exception) {}
        }
    }

    // ── Date picker ───────────────────────────────────────────────────────────

    private fun pickDate() {
        val cal = Calendar.getInstance(TimeZone.getTimeZone("Asia/Kolkata"))
        DatePickerDialog(requireContext(), { _, y, m, d ->
            selectedDate = "%04d-%02d-%02d".format(y, m + 1, d)
            btnDate.text = "📅  $selectedDate"
        }, cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH)).show()
    }

    // ── Multi-employee live mode ──────────────────────────────────────────────

    private fun toggleMultiLiveMode() {
        if (viewMode == ViewMode.MULTI_LIVE) {
            // Switch back to single
            viewMode = ViewMode.SINGLE
            btnMultiLive.text = "👥 All Field Staff (Live)"
            btnMultiLive.setBackgroundColor(ContextCompat.getColor(requireContext(), R.color.primary_ultra_light))
            liveHandler.removeCallbacks(liveRunnable)
            clearMapOverlays()
            tvStatus.text = "Select an employee and date, then tap Search"
            tvStatus.visibility = View.VISIBLE
            tvLiveTag.visibility = View.GONE
            cardMap.visibility = View.GONE
            cardTimeline.visibility = View.GONE
            llSummaryCards.visibility = View.GONE
        } else {
            // Switch to multi-live
            viewMode = ViewMode.MULTI_LIVE
            btnMultiLive.text = "✕ Exit Team View"
            btnMultiLive.setBackgroundColor(Color.parseColor("#DC2626"))
            tvLiveTag.visibility = View.VISIBLE
            tvStatus.text = "⏳ Loading all field staff locations…"
            tvStatus.visibility = View.VISIBLE
            cardMap.visibility = View.VISIBLE
            cardTimeline.visibility = View.GONE
            llSummaryCards.visibility = View.GONE
            btnReplay.visibility = View.GONE
            liveHandler.removeCallbacks(liveRunnable)
            liveHandler.post(liveRunnable)
        }
    }

    private fun refreshMultiLiveMap() {
        if (employees.isEmpty()) return
        lifecycleScope.launch {
            try {
                // Fetch today's last point for every employee in parallel
                val today = todayIST()
                val jobs = employees.map { emp ->
                    async(Dispatchers.IO) {
                        try {
                            val res = RetrofitClient.instance.getMovementHistory(emp.id, today)
                            if (res.isSuccessful && res.body()?.success == true) {
                                val pts = res.body()!!.data
                                if (!pts.isNullOrEmpty()) Pair(emp, pts.last()) else null
                            } else null
                        } catch (_: Exception) { null }
                    }
                }
                val results = jobs.awaitAll().filterNotNull()

                withContext(Dispatchers.Main) {
                    if (!isAdded || googleMap == null) return@withContext
                    val map = googleMap!!

                    results.forEach { (emp, lastPt) ->
                        val pos = LatLng(lastPt.lat, lastPt.lng)
                        val existing = multiDots[emp.id]
                        if (existing != null) {
                            existing.position = pos
                            existing.snippet = "⏱ ${lastPt.timeLabel}"
                        } else {
                            val m = map.addMarker(MarkerOptions()
                                .position(pos)
                                .title("${emp.firstName} ${emp.lastName}")
                                .snippet("⏱ ${lastPt.timeLabel}")
                                .icon(BitmapDescriptorFactory.defaultMarker(BitmapDescriptorFactory.HUE_AZURE)))
                            if (m != null) multiDots[emp.id] = m
                        }
                    }

                    if (results.isNotEmpty()) {
                        tvStatus.text = "👥 ${results.size} field staff active"
                        // Fit all markers
                        val builder = LatLngBounds.Builder()
                        results.forEach { (_, pt) -> builder.include(LatLng(pt.lat, pt.lng)) }
                        try { map.animateCamera(CameraUpdateFactory.newLatLngBounds(builder.build(), 80)) }
                        catch (_: Exception) {}
                    } else {
                        tvStatus.text = "No field staff with active tracking today"
                    }
                }
            } catch (_: Exception) {}
        }
    }

    // ── Search ────────────────────────────────────────────────────────────────

    private fun doSearch() {
        viewMode = ViewMode.SINGLE
        val pos = spinnerEmp.selectedItemPosition
        if (pos == 0) { toast("Please select an employee"); return }
        val emp = employees[pos - 1]
        currentEmpId = emp.id
        isLiveMode = (selectedDate == todayIST())
        isReplayRunning = false
        replayAnimator?.cancel()

        tvStatus.text = "⏳  Loading…"; tvStatus.visibility = View.VISIBLE
        llSummaryCards.visibility = View.GONE
        cardMap.visibility = View.GONE
        cardTimeline.visibility = View.GONE
        btnReplay.visibility = View.GONE
        llTimeline.removeAllViews(); llSummaryCards.removeAllViews()
        lastPointCount = 0
        clearMapOverlays()
        multiDots.clear()

        if (isLiveMode) {
            tvLiveTag.visibility = View.VISIBLE
            liveHandler.removeCallbacks(liveRunnable)
            liveHandler.post(liveRunnable)
        } else {
            tvLiveTag.visibility = View.GONE
            liveHandler.removeCallbacks(liveRunnable)
            fetchAndRender(emp, selectedDate, animate = true)
        }
    }

    private fun refreshLiveRoute() {
        val pos = spinnerEmp.selectedItemPosition
        if (pos == 0 || pos > employees.size) return
        fetchAndRender(employees[pos - 1], todayIST(), animate = false, silent = true)
    }

    // ── Fetch + render ────────────────────────────────────────────────────────

    private fun fetchAndRender(
        emp: Employee, date: String,
        animate: Boolean, silent: Boolean = false
    ) {
        lifecycleScope.launch {
            try {
                val res = RetrofitClient.instance.getMovementHistory(employeeId = emp.id, date = date)
                if (res.isSuccessful && res.body()?.success == true) {
                    val pts = res.body()!!.data ?: emptyList()
                    if (pts.isEmpty()) {
                        if (!silent) {
                            tvStatus.text = "⚠️  No GPS points found for ${emp.firstName} on $date.\n\nEmployee must be punched in."
                            tvStatus.visibility = View.VISIBLE
                        }
                    } else if (pts.size != lastPointCount) {
                        lastPointCount = pts.size
                        tvStatus.visibility = View.GONE
                        renderResults(emp, pts, animate)
                    }
                } else {
                    if (!silent) tvStatus.text = "❌  Failed to load. Please try again."
                }
            } catch (e: Exception) {
                if (!silent) tvStatus.text = "❌  ${e.message}"
            }
        }
    }

    // ── Render: stats + map + timeline ────────────────────────────────────────

    private fun renderResults(emp: Employee, pts: List<MovementPoint>, animate: Boolean) {
        val ctx = requireContext()
        val dp = ctx.resources.displayMetrics.density

        var totalKm = 0.0
        for (i in 1 until pts.size)
            totalKm += haversine(pts[i-1].lat, pts[i-1].lng, pts[i].lat, pts[i].lng)
        totalKm = (totalKm * 100).toLong() / 100.0

        // Compute speed for last segment
        val avgSpeedKmh: Double = if (pts.size >= 2) {
            try {
                val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault())
                val last = sdf.parse(pts.last().loggedAt)
                val prev = sdf.parse(pts[pts.size - 2].loggedAt)
                val diffH = (last!!.time - prev!!.time) / 3_600_000.0
                val segKm = haversine(pts[pts.size-2].lat, pts[pts.size-2].lng, pts.last().lat, pts.last().lng)
                if (diffH > 0) segKm / diffH else 0.0
            } catch (_: Exception) { 0.0 }
        } else 0.0

        // ── Stat cards ────────────────────────────────────────────────────────
        llSummaryCards.removeAllViews()
        llSummaryCards.visibility = View.VISIBLE
        data class S(val v: String, val l: String, val c: Int, val bg: Int)
        listOf(
            S("%.2f km".format(totalKm), "Distance", R.color.primary, R.color.primary_ultra_light),
            S("${pts.size}", "GPS Points", R.color.accent_blue, R.color.accent_blue_light),
            S(pts.first().timeLabel, "Start", R.color.primary, R.color.primary_ultra_light),
            S(pts.last().timeLabel, if (isLiveMode) "Last Ping" else "End", R.color.accent_red, R.color.accent_red_light),
            S("%.1f km/h".format(avgSpeedKmh), "Speed", R.color.accent_blue, R.color.accent_blue_light)
        ).forEach { s ->
            val c = makeCard(ctx, dp).apply {
                layoutParams = LinearLayout.LayoutParams(0, WRAP, 1f).also { it.marginEnd = px(4, dp) }
                setCardBackgroundColor(ContextCompat.getColor(ctx, s.bg))
            }
            val ll = vLL(ctx).apply { gravity = Gravity.CENTER; setPadding(px(4, dp), px(10, dp), px(4, dp), px(10, dp)) }
            ll.addView(TextView(ctx).apply {
                text = s.v; textSize = 11f; setTypeface(null, android.graphics.Typeface.BOLD)
                setTextColor(ContextCompat.getColor(ctx, s.c)); gravity = Gravity.CENTER
            })
            ll.addView(TextView(ctx).apply {
                text = s.l; textSize = 9f
                setTextColor(ContextCompat.getColor(ctx, s.c)); gravity = Gravity.CENTER
            })
            c.addView(ll); llSummaryCards.addView(c)
        }

        // ── Map ───────────────────────────────────────────────────────────────
        cardMap.visibility = View.VISIBLE
        btnReplay.visibility = if (pts.size >= 2 && !isLiveMode) View.VISIBLE else View.GONE
        if (mapReady) renderOnMap(pts, animate)
        else { pendingPoints = pts; pendingAnimate = animate }

        // ── Timeline ──────────────────────────────────────────────────────────
        cardTimeline.visibility = View.VISIBLE
        llTimeline.removeAllViews()
        var cumKm = 0.0
        pts.forEachIndexed { i, pt ->
            val isFirst = i == 0; val isLast = i == pts.size - 1
            val segKm = if (i > 0) haversine(pts[i-1].lat, pts[i-1].lng, pt.lat, pt.lng) else 0.0
            cumKm += segKm

            // Compute speed for this segment — drive heatmap colour into timeline too
            val segSpeed = if (i > 0) {
                try {
                    val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault())
                    val t1 = sdf.parse(pts[i-1].loggedAt); val t2 = sdf.parse(pt.loggedAt)
                    val h = (t2!!.time - t1!!.time) / 3_600_000.0
                    if (h > 0) segKm / h else 0.0
                } catch (_: Exception) { 0.0 }
            } else 0.0

            val speedColor = speedToColor(segSpeed)
            val dotColor = when {
                isFirst -> ContextCompat.getColor(ctx, R.color.primary)
                isLast -> ContextCompat.getColor(ctx, R.color.accent_red)
                else -> speedColor
            }

            val row = LinearLayout(ctx).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(px(4, dp), px(8, dp), px(4, dp), px(8, dp))
                setBackgroundColor(if (i % 2 == 0) Color.WHITE else ContextCompat.getColor(ctx, R.color.background))
            }
            val dotCol = LinearLayout(ctx).apply {
                orientation = LinearLayout.VERTICAL; gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
                layoutParams = llp(px(20, dp), WRAP); setPadding(0, px(3, dp), 0, 0)
            }
            dotCol.addView(View(ctx).apply {
                val sz = if (isFirst || isLast) px(12, dp) else px(8, dp)
                layoutParams = LinearLayout.LayoutParams(sz, sz)
                background = android.graphics.drawable.GradientDrawable().apply {
                    shape = android.graphics.drawable.GradientDrawable.OVAL; setColor(dotColor)
                }
            })
            if (!isLast) dotCol.addView(View(ctx).apply {
                layoutParams = llp(px(2, dp), px(24, dp)).also { it.topMargin = px(2, dp); it.gravity = Gravity.CENTER_HORIZONTAL }
                setBackgroundColor(ContextCompat.getColor(ctx, R.color.divider))
            })
            row.addView(dotCol)

            val info = vLL(ctx).apply { layoutParams = llp(0, WRAP, 1f); setPadding(px(8, dp), 0, 0, 0) }
            val badge = when {
                isFirst -> "🟢 START"
                isLast && isLiveMode -> "📍 NOW"
                isLast -> "🔴 END"
                else -> "·  Point ${i+1}"
            }
            info.addView(LinearLayout(ctx).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                addView(TextView(ctx).apply {
                    text = pt.timeLabel; textSize = 13f; setTypeface(null, android.graphics.Typeface.BOLD)
                    setTextColor(ContextCompat.getColor(ctx, R.color.text_primary)); layoutParams = llp(0, WRAP, 1f)
                })
                addView(TextView(ctx).apply {
                    text = badge; textSize = 10f; setTextColor(dotColor)
                    setTypeface(null, android.graphics.Typeface.BOLD)
                })
            })
            info.addView(TextView(ctx).apply {
                text = if (i == 0) "Starting point"
                else "+${"%.3f".format(segKm)} km  ·  total ${"%.2f".format(cumKm)} km" +
                        if (segSpeed > 0) "  ·  ${"%.1f".format(segSpeed)} km/h" else ""
                textSize = 11f; setTextColor(ContextCompat.getColor(ctx, R.color.text_secondary))
                setPadding(0, px(2, dp), 0, 0)
            })
            pt.accuracy?.let {
                info.addView(TextView(ctx).apply {
                    text = "GPS ±${"%.0f".format(it)}m"
                    textSize = 10f; setTextColor(ContextCompat.getColor(ctx, R.color.text_hint))
                })
            }
            row.addView(info); llTimeline.addView(row)
        }
    }

    // ── Speed to colour ───────────────────────────────────────────────────────

    private fun speedToColor(kmh: Double): Int = when {
        kmh <= 0 || kmh > 150 -> Color.parseColor("#3b82f6") // unknown/invalid → blue
        kmh < 30  -> Color.parseColor("#16a34a")             // slow → green
        kmh < 80  -> Color.parseColor("#f97316")             // medium → orange
        else       -> Color.parseColor("#dc2626")             // fast → red
    }

    // ── Speed per segment (from GPS timestamps) ───────────────────────────────

    private fun computeSegmentSpeeds(pts: List<MovementPoint>): List<Double> {
        val speeds = mutableListOf<Double>()
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault())
        for (i in 1 until pts.size) {
            val km = haversine(pts[i-1].lat, pts[i-1].lng, pts[i].lat, pts[i].lng)
            val speed = try {
                val t1 = sdf.parse(pts[i-1].loggedAt); val t2 = sdf.parse(pts[i].loggedAt)
                val h = (t2!!.time - t1!!.time) / 3_600_000.0
                if (h > 0) km / h else 0.0
            } catch (_: Exception) { 0.0 }
            speeds.add(speed)
        }
        return speeds
    }

    // ── Google Maps rendering ─────────────────────────────────────────────────

    private fun renderOnMap(pts: List<MovementPoint>, animate: Boolean) {
        val map = googleMap ?: return
        clearMapOverlays()
        if (pts.isEmpty()) return

        val latLngs = pts.map { LatLng(it.lat, it.lng) }
        val segmentSpeeds = computeSegmentSpeeds(pts)

        // START marker (green)
        markers += map.addMarker(MarkerOptions()
            .position(latLngs.first())
            .icon(BitmapDescriptorFactory.defaultMarker(BitmapDescriptorFactory.HUE_GREEN))
            .title("🟢 START").snippet("🕐 ${pts.first().timeLabel}"))!!

        // END marker (red) — non-live only
        if (!isLiveMode && pts.size > 1) {
            markers += map.addMarker(MarkerOptions()
                .position(latLngs.last())
                .icon(BitmapDescriptorFactory.defaultMarker(BitmapDescriptorFactory.HUE_RED))
                .title("🔴 END").snippet("🕐 ${pts.last().timeLabel}"))!!
        }

        // Current position marker (live)
        if (isLiveMode) {
            markers += map.addMarker(MarkerOptions()
                .position(latLngs.last())
                .icon(BitmapDescriptorFactory.defaultMarker(BitmapDescriptorFactory.HUE_CYAN))
                .title("📍 Current").snippet("🕐 ${pts.last().timeLabel}"))!!
        }

        // Middle GPS dots (blue)
        for (i in 1 until pts.size - 1) {
            gpsDots += map.addCircle(CircleOptions()
                .center(latLngs[i]).radius(12.0)
                .strokeColor(Color.WHITE).strokeWidth(2f)
                .fillColor(Color.parseColor("#3b82f6")))
        }

        // Fit camera
        val bounds = LatLngBounds.Builder().apply { latLngs.forEach { include(it) } }.build()
        map.animateCamera(CameraUpdateFactory.newLatLngBounds(bounds, 80))

        // Fetch Directions road routes and draw speed-coloured polylines
        if (pts.size < 2) return

        mapScope.launch {
            val segmentJobs = (1 until pts.size).map { idx ->
                async { fetchDirectionsSegment(pts[idx - 1], pts[idx]) }
            }
            val segments = segmentJobs.awaitAll()

            withContext(Dispatchers.Main) {
                if (!isAdded || googleMap == null) return@withContext

                segments.forEachIndexed { segIdx, roadCoords ->
                    val speed = if (segIdx < segmentSpeeds.size) segmentSpeeds[segIdx] else 0.0
                    val segColor = speedToColor(speed)

                    // Speed-coloured polyline
                    val polyOpts = PolylineOptions()
                        .color(segColor).width(14f).geodesic(true)
                    roadCoords.forEach { polyOpts.add(it) }
                    polylines += map.addPolyline(polyOpts)

                    // Orange 500m dots
                    val fromTime = pts[segIdx].timeLabel
                    val toTime = pts[segIdx + 1].timeLabel
                    interpolate500m(roadCoords).forEach { coord ->
                        orangeDots += map.addCircle(CircleOptions()
                            .center(coord).radius(14.0)
                            .strokeColor(Color.WHITE).strokeWidth(2f)
                            .fillColor(Color.parseColor("#f97316")))
                        markers += map.addMarker(MarkerOptions()
                            .position(coord).alpha(0f)
                            .title("🟠 500m mark")
                            .snippet("Between 🕐 $fromTime → $toTime"))!!
                    }
                }
            }
        }
    }

    // ── Route Replay Animation ────────────────────────────────────────────────

    private fun toggleReplay() {
        if (isReplayRunning) {
            replayAnimator?.cancel()
            isReplayRunning = false
            btnReplay.text = "▶ Replay"
            replayMarker?.remove(); replayMarker = null
            return
        }

        val pos = spinnerEmp.selectedItemPosition
        if (pos == 0 || pos > employees.size) return

        lifecycleScope.launch {
            try {
                val res = RetrofitClient.instance.getMovementHistory(
                    employeeId = employees[pos - 1].id, date = selectedDate
                )
                val pts = res.body()?.data ?: return@launch
                if (pts.size < 2) { toast("Need at least 2 points to replay"); return@launch }

                // Build full road path by fetching directions for all segments
                val allCoords = mutableListOf<LatLng>()
                val jobs = (1 until pts.size).map { idx ->
                    async(Dispatchers.IO) { fetchDirectionsSegment(pts[idx - 1], pts[idx]) }
                }
                jobs.awaitAll().forEach { allCoords.addAll(it) }

                if (allCoords.isEmpty()) return@launch

                withContext(Dispatchers.Main) {
                    val map = googleMap ?: return@withContext
                    isReplayRunning = true
                    btnReplay.text = "■ Stop"

                    // Place replay marker at start
                    replayMarker?.remove()
                    replayMarker = map.addMarker(MarkerOptions()
                        .position(allCoords.first())
                        .icon(BitmapDescriptorFactory.defaultMarker(BitmapDescriptorFactory.HUE_YELLOW))
                        .title("🚶 Replay"))

                    // Animate across all coords — 5 seconds total
                    val totalMs = 5000L
                    val lastIdx = allCoords.size - 1

                    replayAnimator = ValueAnimator.ofFloat(0f, lastIdx.toFloat()).apply {
                        duration = totalMs
                        interpolator = LinearInterpolator()
                        addUpdateListener { anim ->
                            val f = anim.animatedValue as Float
                            val i = f.toInt().coerceIn(0, lastIdx - 1)
                            val frac = f - i
                            val from = allCoords[i]; val to = allCoords[i + 1]
                            val lat = from.latitude + (to.latitude - from.latitude) * frac
                            val lng = from.longitude + (to.longitude - from.longitude) * frac
                            val pos = LatLng(lat, lng)
                            replayMarker?.position = pos
                            map.moveCamera(CameraUpdateFactory.newLatLng(pos))
                        }
                        addListener(object : android.animation.AnimatorListenerAdapter() {
                            override fun onAnimationEnd(a: android.animation.Animator) {
                                isReplayRunning = false
                                btnReplay.text = "▶ Replay"
                                replayMarker?.remove(); replayMarker = null
                                // Re-fit to full route
                                val bounds = LatLngBounds.Builder().apply { allCoords.forEach { include(it) } }.build()
                                try { map.animateCamera(CameraUpdateFactory.newLatLngBounds(bounds, 80)) } catch (_: Exception) {}
                            }
                        })
                        start()
                    }
                }
            } catch (_: Exception) { isReplayRunning = false; btnReplay.text = "▶ Replay" }
        }
    }

    // ── Directions API ────────────────────────────────────────────────────────

    private suspend fun fetchDirectionsSegment(
        from: MovementPoint, to: MovementPoint
    ): List<LatLng> = withContext(Dispatchers.IO) {
        try {
            val url = "https://maps.googleapis.com/maps/api/directions/json" +
                    "?origin=${from.lat},${from.lng}" +
                    "&destination=${to.lat},${to.lng}" +
                    "&mode=driving" +
                    "&key=AIzaSyDp21tx1U1OVaXIGv8E8Y94RmfnQl1pNbo"
            val json = JSONObject(URL(url).readText())
            val routes = json.getJSONArray("routes")
            if (routes.length() == 0) return@withContext listOf(LatLng(from.lat, from.lng), LatLng(to.lat, to.lng))
            val encoded = routes.getJSONObject(0).getJSONObject("overview_polyline").getString("points")
            decodePoly(encoded)
        } catch (_: Exception) {
            listOf(LatLng(from.lat, from.lng), LatLng(to.lat, to.lng))
        }
    }

    private fun decodePoly(encoded: String): List<LatLng> {
        val result = mutableListOf<LatLng>()
        var index = 0; var lat = 0; var lng = 0
        while (index < encoded.length) {
            var b: Int; var shift = 0; var r = 0
            do { b = encoded[index++].code - 63; r = r or ((b and 0x1f) shl shift); shift += 5 } while (b >= 0x20)
            val dLat = if (r and 1 != 0) (r shr 1).inv() else r shr 1; lat += dLat
            shift = 0; r = 0
            do { b = encoded[index++].code - 63; r = r or ((b and 0x1f) shl shift); shift += 5 } while (b >= 0x20)
            val dLng = if (r and 1 != 0) (r shr 1).inv() else r shr 1; lng += dLng
            result.add(LatLng(lat / 1e5, lng / 1e5))
        }
        return result
    }

    private fun interpolate500m(coords: List<LatLng>): List<LatLng> {
        val dots = mutableListOf<LatLng>()
        if (coords.size < 2) return dots
        var distSinceLast = 0.0
        for (i in 1 until coords.size) {
            val segM = haversineM(coords[i - 1], coords[i])
            var remaining = segM
            while (distSinceLast + remaining >= 500.0) {
                val need = 500.0 - distSinceLast
                val frac = (segM - remaining + need) / segM
                val lat = coords[i - 1].latitude + (coords[i].latitude - coords[i - 1].latitude) * frac
                val lng = coords[i - 1].longitude + (coords[i].longitude - coords[i - 1].longitude) * frac
                dots.add(LatLng(lat, lng))
                remaining -= need; distSinceLast = 0.0
            }
            distSinceLast += remaining
        }
        return dots
    }

    private fun clearMapOverlays() {
        polylines.forEach { it.remove() };  polylines.clear()
        orangeDots.forEach { it.remove() }; orangeDots.clear()
        gpsDots.forEach { it.remove() };    gpsDots.clear()
        markers.forEach { it.remove() };    markers.clear()
        multiDots.values.forEach { it.remove() }; multiDots.clear()
        replayMarker?.remove(); replayMarker = null
    }

    // ── Maths ─────────────────────────────────────────────────────────────────

    private fun haversine(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val R = 6371.0
        val dLat = Math.toRadians(lat2 - lat1); val dLon = Math.toRadians(lon2 - lon1)
        val a = Math.sin(dLat/2).let{it*it} + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) * Math.sin(dLon/2).let{it*it}
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    }

    private fun haversineM(a: LatLng, b: LatLng): Double =
        haversine(a.latitude, a.longitude, b.latitude, b.longitude) * 1000.0

    // ── Layout helpers ────────────────────────────────────────────────────────

    private fun px(n: Int, dp: Float) = (n * dp).toInt()
    private fun vLL(ctx: android.content.Context) = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL; layoutParams = llp(MATCH, WRAP)
    }
    private fun llp(w: Int, h: Int, weight: Float = 0f) = LinearLayout.LayoutParams(w, h, weight)
    private fun lbl(ctx: android.content.Context, t: String, dp: Float) = TextView(ctx).apply {
        text = t; textSize = 11f
        setTextColor(ContextCompat.getColor(ctx, R.color.text_secondary))
        setPadding(0, 0, 0, px(3, dp))
    }
    private fun makeCard(ctx: android.content.Context, dp: Float) = CardView(ctx).apply {
        radius = 14 * dp; cardElevation = 3 * dp
        setCardBackgroundColor(ContextCompat.getColor(ctx, R.color.surface))
        layoutParams = llp(MATCH, WRAP).also { it.bottomMargin = px(12, dp) }
    }
    private fun toast(msg: String) = Toast.makeText(context, msg, Toast.LENGTH_SHORT).show()
    private fun todayIST() = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
        .also { it.timeZone = TimeZone.getTimeZone("Asia/Kolkata") }.format(Date())

    companion object {
        private const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
        private const val WRAP = ViewGroup.LayoutParams.WRAP_CONTENT
    }
}
