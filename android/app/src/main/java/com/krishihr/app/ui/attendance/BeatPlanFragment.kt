package com.krishihr.app.ui.attendance
import com.krishihr.app.AndroidMain

import android.app.DatePickerDialog
import android.graphics.Color
import android.os.Bundle
import android.view.*
import android.widget.*
import androidx.cardview.widget.CardView
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.google.android.gms.maps.*
import com.google.android.gms.maps.model.*
import com.krishihr.app.R
import com.krishihr.app.data.api.RetrofitClient
import com.krishihr.app.data.models.*
import com.krishihr.app.utils.Roles
import com.krishihr.app.utils.SessionManager
import kotlinx.coroutines.*
import org.json.JSONObject
import java.net.URL
import java.text.SimpleDateFormat
import java.util.*

/**
 * BeatPlanFragment — Feature #7 Beat Plan / PJP
 *
 * Shows:
 *  - Employee + date selector
 *  - Planned stops list (numbered pins on map)
 *  - Actual GPS route overlaid on the same map
 *  - Coverage summary: X/Y stops visited, coverage %
 *
 * Map layers:
 *  • Numbered blue markers   — planned stops
 *  • Green/red dot per stop  — visited (green) or missed (red)
 *  • Orange polyline         — actual GPS route
 *  • Coverage bar            — % of planned stops reached
 */
class BeatPlanFragment : Fragment(), OnMapReadyCallback {

    private lateinit var session: SessionManager
    private var employees: List<Employee> = emptyList()
    private var selectedDate = todayIST()

    // Map
    private var googleMap: GoogleMap? = null
    private var mapFragment: SupportMapFragment? = null
    private var mapReady = false
    private val mapMarkers  = mutableListOf<Marker>()
    private val mapPolylines = mutableListOf<com.google.android.gms.maps.model.Polyline>()
    private val mapCircles  = mutableListOf<Circle>()
    private var pendingCompare: BeatPlanCompare? = null

    // Views
    private lateinit var spinnerEmp: Spinner
    private lateinit var btnDate: Button
    private lateinit var btnSearch: Button
    private lateinit var tvStatus: TextView
    private lateinit var cardMap: CardView
    private lateinit var cardSummary: CardView
    private lateinit var cardStops: CardView
    private lateinit var llSummary: LinearLayout
    private lateinit var llStops: LinearLayout

    private val mapScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View {
        session = SessionManager(requireContext())
        return buildUI()
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        initMap()
        loadEmployees()
    }

    override fun onDestroyView() {
        super.onDestroyView()
        mapScope.cancel()
    }

    private fun initMap() {
        mapFragment = SupportMapFragment.newInstance(
            GoogleMapOptions().mapType(GoogleMap.MAP_TYPE_NORMAL)
                .zoomControlsEnabled(true).compassEnabled(true)
        )
        childFragmentManager.beginTransaction()
            .replace(R.id.beat_map_container, mapFragment!!).commit()
        mapFragment!!.getMapAsync(this)
    }

    override fun onMapReady(map: GoogleMap) {
        googleMap = map; mapReady = true
        map.uiSettings.isZoomControlsEnabled = true
        pendingCompare?.let { render(it); pendingCompare = null }
    }

    private fun buildUI(): View {
        val ctx = requireContext()
        val dp  = ctx.resources.displayMetrics.density

        val scroll = ScrollView(ctx).apply {
            setBackgroundColor(ContextCompat.getColor(ctx, R.color.background))
            layoutParams = ViewGroup.LayoutParams(MATCH, MATCH)
        }
        val outer = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(px(12,dp), px(12,dp), px(12,dp), px(80,dp))
        }
        scroll.addView(outer)

        // ── Filter card ───────────────────────────────────────────────────────
        val filterCard = makeCard(ctx, dp)
        val filterLL = vLL(ctx).apply { setPadding(px(16,dp), px(14,dp), px(16,dp), px(14,dp)) }
        filterCard.addView(filterLL); outer.addView(filterCard)

        filterLL.addView(TextView(ctx).apply {
            text = "📋 Beat Plan — Planned vs Actual"; textSize = 15f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(ContextCompat.getColor(ctx, R.color.text_primary))
            setPadding(0, 0, 0, px(12,dp))
        })

        filterLL.addView(lbl(ctx, "Employee", dp))
        spinnerEmp = Spinner(ctx).apply {
            layoutParams = llp(MATCH, px(44,dp)).also { it.bottomMargin = px(10,dp) }
        }
        filterLL.addView(spinnerEmp)

        filterLL.addView(lbl(ctx, "Date", dp))
        btnDate = Button(ctx).apply {
            text = "📅  $selectedDate"; textSize = 13f
            layoutParams = llp(MATCH, px(44,dp)).also { it.bottomMargin = px(12,dp) }
            setBackgroundColor(ContextCompat.getColor(ctx, R.color.primary_ultra_light))
            setTextColor(ContextCompat.getColor(ctx, R.color.primary))
            setOnClickListener { pickDate() }
        }
        filterLL.addView(btnDate)

        btnSearch = Button(ctx).apply {
            text = "🔍  Load Plan"; textSize = 14f
            layoutParams = llp(MATCH, px(46,dp))
            setBackgroundColor(ContextCompat.getColor(ctx, R.color.primary))
            setTextColor(ContextCompat.getColor(ctx, R.color.white))
            setOnClickListener { doLoad() }
        }
        filterLL.addView(btnSearch)

        // Status
        tvStatus = TextView(ctx).apply {
            text = "Select employee and date to view beat plan"
            textSize = 13f; gravity = Gravity.CENTER
            setTextColor(ContextCompat.getColor(ctx, R.color.text_secondary))
            setPadding(0, px(16,dp), 0, px(16,dp))
        }
        outer.addView(tvStatus)

        // ── Summary card ──────────────────────────────────────────────────────
        cardSummary = makeCard(ctx, dp).apply { visibility = View.GONE }
        llSummary = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(px(14,dp), px(12,dp), px(14,dp), px(12,dp))
        }
        cardSummary.addView(llSummary); outer.addView(cardSummary)

        // ── Map card ──────────────────────────────────────────────────────────
        cardMap = makeCard(ctx, dp).apply { visibility = View.GONE }
        val mapLL = vLL(ctx).apply { setPadding(px(14,dp), px(12,dp), px(14,dp), px(12,dp)) }
        cardMap.addView(mapLL); outer.addView(cardMap)

        mapLL.addView(TextView(ctx).apply {
            text = "🗺️  Planned Route vs Actual Route"; textSize = 14f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(ContextCompat.getColor(ctx, R.color.text_primary))
            setPadding(0, 0, 0, px(8,dp))
        })

        val mapContainer = FrameLayout(ctx).apply {
            id = R.id.beat_map_container
            layoutParams = llp(MATCH, px(400,dp))
        }
        mapLL.addView(mapContainer)

        // Legend
        val legRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(0, px(8,dp), 0, 0)
        }
        fun dot(color: Int) = View(ctx).apply {
            val sz = px(10,dp)
            layoutParams = LinearLayout.LayoutParams(sz,sz).also { it.marginEnd = px(4,dp) }
            background = android.graphics.drawable.GradientDrawable().apply {
                shape = android.graphics.drawable.GradientDrawable.OVAL; setColor(color)
            }
        }
        fun legTxt(t: String) = TextView(ctx).apply {
            text = t; textSize = 10f
            setTextColor(ContextCompat.getColor(ctx, R.color.text_secondary))
            layoutParams = llp(WRAP,WRAP).also { it.marginEnd = px(12,dp) }
        }
        legRow.addView(dot(Color.parseColor("#3b82f6"))); legRow.addView(legTxt("Planned Stop"))
        legRow.addView(dot(Color.parseColor("#16a34a"))); legRow.addView(legTxt("Visited"))
        legRow.addView(dot(Color.parseColor("#dc2626"))); legRow.addView(legTxt("Missed"))
        legRow.addView(dot(Color.parseColor("#f97316"))); legRow.addView(legTxt("Actual Route"))
        mapLL.addView(legRow)

        // ── Stops card ────────────────────────────────────────────────────────
        cardStops = makeCard(ctx, dp).apply { visibility = View.GONE }
        val stopsLL = vLL(ctx).apply { setPadding(px(14,dp), px(12,dp), px(14,dp), px(12,dp)) }
        cardStops.addView(stopsLL); outer.addView(cardStops)
        stopsLL.addView(TextView(ctx).apply {
            text = "📍  Stop Details"; textSize = 14f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(ContextCompat.getColor(ctx, R.color.text_primary))
            setPadding(0, 0, 0, px(8,dp))
        })
        llStops = vLL(ctx)
        stopsLL.addView(llStops)

        return scroll
    }

    private fun loadEmployees() {
        val emp  = session.getEmployee() ?: return
        val role = session.getRole()
        val seeAll = emp.employeeCode == AndroidMain.SEE_ALL_MOVEMENT_CODE
                || role == Roles.SUPER_ADMIN || role == Roles.HR

        lifecycleScope.launch {
            try {
                val res = RetrofitClient.instance.getEmployees()
                if (res.isSuccessful && res.body()?.success == true) {
                    val all = res.body()!!.data ?: emptyList()
                    employees = if (seeAll) all else all.filter { it.reportingManagerId == emp.id }
                    val names = mutableListOf("— Select Employee —")
                    names.addAll(employees.map { "${it.firstName} ${it.lastName} (${it.employeeCode})" })
                    spinnerEmp.adapter = ArrayAdapter(requireContext(),
                        android.R.layout.simple_spinner_item, names).also {
                        it.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
                    }
                }
            } catch (_: Exception) {}
        }
    }

    private fun pickDate() {
        val cal = Calendar.getInstance(TimeZone.getTimeZone("Asia/Kolkata"))
        DatePickerDialog(requireContext(), { _, y, m, d ->
            selectedDate = "%04d-%02d-%02d".format(y, m+1, d)
            btnDate.text = "📅  $selectedDate"
        }, cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH)).show()
    }

    private fun doLoad() {
        val pos = spinnerEmp.selectedItemPosition
        if (pos == 0) { toast("Please select an employee"); return }
        val emp = employees[pos - 1]

        tvStatus.text = "⏳ Loading…"; tvStatus.visibility = View.VISIBLE
        cardSummary.visibility = View.GONE
        cardMap.visibility = View.GONE
        cardStops.visibility = View.GONE

        lifecycleScope.launch {
            try {
                val res = RetrofitClient.instance.getBeatPlanCompare(emp.id, selectedDate)
                if (res.isSuccessful && res.body()?.success == true) {
                    val compare = res.body()!!.data!!
                    tvStatus.visibility = View.GONE
                    if (compare.plan == null && compare.stops.isEmpty()) {
                        tvStatus.text = "⚠️  No beat plan assigned for ${emp.firstName} on $selectedDate"
                        tvStatus.visibility = View.VISIBLE
                        return@launch
                    }
                    renderSummary(compare)
                    cardMap.visibility = View.VISIBLE
                    if (mapReady) render(compare) else pendingCompare = compare
                    renderStops(compare)
                } else {
                    tvStatus.text = "❌ Failed to load"
                }
            } catch (e: Exception) {
                tvStatus.text = "❌ ${e.message}"
            }
        }
    }

    private fun renderSummary(compare: BeatPlanCompare) {
        val ctx = requireContext()
        val dp  = ctx.resources.displayMetrics.density
        llSummary.removeAllViews()
        cardSummary.visibility = View.VISIBLE

        val s = compare.summary
        data class Card(val value: String, val label: String, val color: Int, val bg: Int)
        val cards = listOf(
            Card("${s?.plannedStops ?: compare.stops.size}", "Planned", R.color.primary, R.color.primary_ultra_light),
            Card("${s?.visitedStops ?: 0}", "Visited", R.color.accent_blue, R.color.accent_blue_light),
            Card("${s?.missedStops  ?: 0}", "Missed",  R.color.accent_red,  R.color.accent_red_light),
            Card("${s?.coveragePct  ?: 0}%", "Coverage", R.color.primary,  R.color.primary_ultra_light)
        )
        cards.forEach { sc ->
            val c = makeCard(ctx, dp).apply {
                layoutParams = LinearLayout.LayoutParams(0, WRAP, 1f).also { it.marginEnd = px(4,dp) }
                setCardBackgroundColor(ContextCompat.getColor(ctx, sc.bg))
            }
            val ll = vLL(ctx).apply { gravity = Gravity.CENTER; setPadding(px(4,dp), px(10,dp), px(4,dp), px(10,dp)) }
            ll.addView(TextView(ctx).apply {
                text = sc.value; textSize = 14f; setTypeface(null, android.graphics.Typeface.BOLD)
                setTextColor(ContextCompat.getColor(ctx, sc.color)); gravity = Gravity.CENTER
            })
            ll.addView(TextView(ctx).apply {
                text = sc.label; textSize = 9f
                setTextColor(ContextCompat.getColor(ctx, sc.color)); gravity = Gravity.CENTER
            })
            c.addView(ll); llSummary.addView(c)
        }
    }

    private fun render(compare: BeatPlanCompare) {
        val map = googleMap ?: return
        mapMarkers.forEach { it.remove() };   mapMarkers.clear()
        mapPolylines.forEach { it.remove() }; mapPolylines.clear()
        mapCircles.forEach { it.remove() };   mapCircles.clear()

        val bounds = LatLngBounds.Builder()
        var hasPoints = false

        // ── Planned stops — numbered markers ──────────────────────────────────
        compare.stops.forEachIndexed { idx, stop ->
            if (stop.lat == null || stop.lng == null) return@forEachIndexed
            val pos = LatLng(stop.lat, stop.lng)
            bounds.include(pos); hasPoints = true

            val visited = stop.visited == true || stop.visitStatus == "visited"
            val color = if (visited) BitmapDescriptorFactory.HUE_GREEN else BitmapDescriptorFactory.HUE_RED

            mapMarkers += map.addMarker(MarkerOptions()
                .position(pos)
                .icon(BitmapDescriptorFactory.defaultMarker(color))
                .title("${idx+1}. ${stop.locationName}")
                .snippet(if (visited) "✅ Visited${stop.nearestTime?.let { " at $it" } ?: ""}"
                         else "❌ Missed${stop.nearestDistM?.let { " (nearest: ${it}m)" } ?: ""}"))!!
        }

        // ── Actual GPS route — orange polyline ────────────────────────────────
        if (compare.actualPoints.size >= 2) {
            mapScope.launch {
                val jobs = (1 until compare.actualPoints.size).map { i ->
                    async { fetchSegment(compare.actualPoints[i-1], compare.actualPoints[i]) }
                }
                val segments = jobs.awaitAll()
                withContext(Dispatchers.Main) {
                    if (!isAdded || googleMap == null) return@withContext
                    segments.forEach { coords ->
                        val opts = PolylineOptions().color(Color.parseColor("#f97316")).width(10f).geodesic(true)
                        coords.forEach { opts.add(it) }
                        mapPolylines += map.addPolyline(opts)
                        coords.forEach { bounds.include(it); }
                    }
                }
            }
        }

        compare.actualPoints.forEach { pt ->
            val pos = LatLng(pt.lat, pt.lng)
            bounds.include(pos); hasPoints = true
            mapCircles += map.addCircle(CircleOptions()
                .center(pos).radius(8.0)
                .fillColor(Color.parseColor("#f97316"))
                .strokeColor(Color.WHITE).strokeWidth(1f))
        }

        if (hasPoints) {
            try { map.animateCamera(CameraUpdateFactory.newLatLngBounds(bounds.build(), 80)) }
            catch (_: Exception) {}
        }
    }

    private fun renderStops(compare: BeatPlanCompare) {
        val ctx = requireContext()
        val dp  = ctx.resources.displayMetrics.density
        llStops.removeAllViews()
        cardStops.visibility = View.VISIBLE

        if (compare.stops.isEmpty()) {
            llStops.addView(TextView(ctx).apply {
                text = "No stops defined in this beat plan"
                textSize = 13f; setTextColor(ContextCompat.getColor(ctx, R.color.text_secondary))
            })
            return
        }

        compare.stops.forEachIndexed { idx, stop ->
            val visited = stop.visited == true || stop.visitStatus == "visited"
            val row = LinearLayout(ctx).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(px(4,dp), px(10,dp), px(4,dp), px(10,dp))
                setBackgroundColor(if (idx % 2 == 0) Color.WHITE else ContextCompat.getColor(ctx, R.color.background))
            }
            // Number badge
            val badge = TextView(ctx).apply {
                text = "${idx+1}"; textSize = 13f; gravity = Gravity.CENTER
                setTypeface(null, android.graphics.Typeface.BOLD)
                setTextColor(Color.WHITE)
                background = android.graphics.drawable.GradientDrawable().apply {
                    shape = android.graphics.drawable.GradientDrawable.OVAL
                    setColor(if (visited) Color.parseColor("#16a34a") else Color.parseColor("#dc2626"))
                }
                layoutParams = LinearLayout.LayoutParams(px(28,dp), px(28,dp)).also { it.marginEnd = px(10,dp) }
            }
            row.addView(badge)

            val info = vLL(ctx).apply { layoutParams = llp(0, WRAP, 1f) }
            info.addView(TextView(ctx).apply {
                text = stop.locationName; textSize = 13f
                setTypeface(null, android.graphics.Typeface.BOLD)
                setTextColor(ContextCompat.getColor(ctx, R.color.text_primary))
            })
            stop.address?.let {
                info.addView(TextView(ctx).apply {
                    text = it; textSize = 11f
                    setTextColor(ContextCompat.getColor(ctx, R.color.text_secondary))
                })
            }
            val statusText = when {
                visited -> "✅ Visited${stop.nearestTime?.let { t -> " at $t" } ?: ""}"
                else    -> "❌ Missed${stop.nearestDistM?.let { m -> " (closest: ${m}m away)" } ?: ""}"
            }
            info.addView(TextView(ctx).apply {
                text = statusText; textSize = 11f
                setTextColor(if (visited) Color.parseColor("#16a34a") else Color.parseColor("#dc2626"))
            })
            row.addView(info)
            llStops.addView(row)
        }
    }

    private suspend fun fetchSegment(from: MovementPoint, to: MovementPoint): List<LatLng> =
        withContext(Dispatchers.IO) {
            try {
                val url = "https://maps.googleapis.com/maps/api/directions/json" +
                        "?origin=${from.lat},${from.lng}" +
                        "&destination=${to.lat},${to.lng}" +
                        "&mode=driving&key=AIzaSyDp21tx1U1OVaXIGv8E8Y94RmfnQl1pNbo"
                val json = JSONObject(URL(url).readText())
                val routes = json.getJSONArray("routes")
                if (routes.length() == 0) return@withContext listOf(LatLng(from.lat, from.lng), LatLng(to.lat, to.lng))
                val encoded = routes.getJSONObject(0).getJSONObject("overview_polyline").getString("points")
                decodePoly(encoded)
            } catch (_: Exception) { listOf(LatLng(from.lat, from.lng), LatLng(to.lat, to.lng)) }
        }

    private fun decodePoly(encoded: String): List<LatLng> {
        val result = mutableListOf<LatLng>()
        var index = 0; var lat = 0; var lng = 0
        while (index < encoded.length) {
            var b: Int; var shift = 0; var r = 0
            do { b = encoded[index++].code - 63; r = r or ((b and 0x1f) shl shift); shift += 5 } while (b >= 0x20)
            lat += if (r and 1 != 0) (r shr 1).inv() else r shr 1
            shift = 0; r = 0
            do { b = encoded[index++].code - 63; r = r or ((b and 0x1f) shl shift); shift += 5 } while (b >= 0x20)
            lng += if (r and 1 != 0) (r shr 1).inv() else r shr 1
            result.add(LatLng(lat / 1e5, lng / 1e5))
        }
        return result
    }

    private fun px(n: Int, dp: Float) = (n * dp).toInt()
    private fun vLL(ctx: android.content.Context) = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL; layoutParams = llp(MATCH, WRAP) }
    private fun llp(w: Int, h: Int, weight: Float = 0f) = LinearLayout.LayoutParams(w, h, weight)
    private fun lbl(ctx: android.content.Context, t: String, dp: Float) = TextView(ctx).apply {
        text = t; textSize = 11f
        setTextColor(ContextCompat.getColor(ctx, R.color.text_secondary))
        setPadding(0, 0, 0, px(3,dp)) }
    private fun makeCard(ctx: android.content.Context, dp: Float) = CardView(ctx).apply {
        radius = 14 * dp; cardElevation = 3 * dp
        setCardBackgroundColor(ContextCompat.getColor(ctx, R.color.surface))
        layoutParams = llp(MATCH, WRAP).also { it.bottomMargin = px(12,dp) } }
    private fun toast(msg: String) = Toast.makeText(context, msg, Toast.LENGTH_SHORT).show()
    private fun todayIST() = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
        .also { it.timeZone = TimeZone.getTimeZone("Asia/Kolkata") }.format(Date())

    companion object {
        private const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
        private const val WRAP  = ViewGroup.LayoutParams.WRAP_CONTENT
    }
}
