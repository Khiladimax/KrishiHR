package com.krishihr.app.utils

import android.app.Activity
import android.content.Context
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.widget.Toast
import androidx.fragment.app.Fragment
import java.text.NumberFormat
import java.text.ParseException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// ── Toast Helpers ─────────────────────────────────────────────────────────────
fun Context.toast(msg: String?, length: Int = Toast.LENGTH_SHORT) {
    if (!msg.isNullOrBlank()) Toast.makeText(this, msg, length).show()
}
fun Fragment.toast(msg: String?) = requireContext().toast(msg)

// ── Date Formatting ───────────────────────────────────────────────────────────
private val ISO_IN  = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).also {
    it.timeZone = java.util.TimeZone.getTimeZone("UTC")
}
private val DISPLAY = SimpleDateFormat("dd MMM yyyy", Locale.getDefault()).also {
    it.timeZone = java.util.TimeZone.getTimeZone("UTC")  // keep UTC to prevent day shift
}
private val TIME_IN  = SimpleDateFormat("HH:mm:ss", Locale.getDefault())
private val TIME_OUT = SimpleDateFormat("h:mm a", Locale.getDefault())

fun String.toDisplayDate(): String = try {
    val monthNames = arrayOf("Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec")

    // If string contains 'T' (ISO timestamp), parse and convert to IST before extracting date
    val datePart = if (this.contains('T') || this.contains('Z')) {
        // Parse as UTC milliseconds, add IST offset (+5:30 = +19800000 ms)
        val sdf = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.getDefault())
        sdf.timeZone = java.util.TimeZone.getTimeZone("UTC")
        val cleanStr = this.replace("Z","").replace(".000","").take(19)
        val d = try { sdf.parse(cleanStr) } catch (_: Exception) { null }
        if (d != null) {
            // Add IST offset and format as yyyy-MM-dd
            val istMs = d.time + 19800000L  // +5:30 hours in ms
            val cal = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("UTC"))
            cal.timeInMillis = istMs
            String.format("%04d-%02d-%02d", cal.get(java.util.Calendar.YEAR),
                cal.get(java.util.Calendar.MONTH) + 1, cal.get(java.util.Calendar.DAY_OF_MONTH))
        } else this.take(10)
    } else {
        this.take(10)
    }

    val parts = datePart.split("-")
    if (parts.size == 3) {
        val year  = parts[0]
        val month = parts[1].toIntOrNull() ?: 0
        val day   = parts[2].toIntOrNull() ?: 0
        if (month == 0 || day == 0) datePart
        else {
            val monthName = if (month in 1..12) monthNames[month - 1] else parts[1]
            String.format("%02d %s %s", day, monthName, year)
        }
    } else this
} catch (e: Exception) { this }

fun String.toDisplayTime(): String = try {
    // Handle both "HH:mm:ss" and "HH:mm" and full ISO timestamps
    val t = this.substringAfterLast("T").substringBefore(".")
    val src = if (t.length >= 8) "HH:mm:ss" else "HH:mm"
    val sdf = SimpleDateFormat(src, Locale.getDefault())
    val d = sdf.parse(t)
    if (d != null) TIME_OUT.format(d) else this
} catch (e: Exception) { this.take(5) }

fun getMonthName(month: Int): String = SimpleDateFormat("MMMM", Locale.getDefault())
    .format(SimpleDateFormat("M", Locale.getDefault()).parse(month.toString()) ?: Date())

// ── Currency Formatting ───────────────────────────────────────────────────────
fun Double.toRupees(): String {
    val nf = NumberFormat.getNumberInstance(Locale("en", "IN"))
    nf.minimumFractionDigits = 2
    nf.maximumFractionDigits = 2
    return "₹${nf.format(this)}"
}

fun Double.toRupeesShort(): String {
    return when {
        this >= 100000 -> "₹${String.format("%.1f", this/100000)}L"
        this >= 1000   -> "₹${String.format("%.1f", this/1000)}K"
        else           -> "₹${String.format("%.0f", this)}"
    }
}

// ── View Helpers ──────────────────────────────────────────────────────────────
fun View.show() { visibility = View.VISIBLE }
fun View.hide() { visibility = View.GONE }
fun View.invisible() { visibility = View.INVISIBLE }

fun Activity.hideKeyboard() {
    val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
    currentFocus?.let { imm.hideSoftInputFromWindow(it.windowToken, 0) }
}

fun Fragment.hideKeyboard() = activity?.hideKeyboard()

// ── String Helpers ────────────────────────────────────────────────────────────
fun String.capitalize(): String = replaceFirstChar { it.uppercase() }

fun String?.orDash(): String = if (isNullOrBlank()) "—" else this

fun getGreeting(): String {
    val hour = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)
    return when {
        hour < 12 -> "Good Morning"
        hour < 17 -> "Good Afternoon"
        else      -> "Good Evening"
    }
}

// ── Status Color ──────────────────────────────────────────────────────────────
fun getStatusColor(context: Context, status: String?): Int {
    val colorRes = when (status?.lowercase()?.trim()) {
        "present", "approved", "confirmed", "paid"  -> com.krishihr.app.R.color.status_present
        "absent", "rejected"                         -> com.krishihr.app.R.color.status_absent
        "late"                                       -> com.krishihr.app.R.color.status_late
        "half-day", "half_day"                       -> com.krishihr.app.R.color.status_halfday
        "pending"                                    -> com.krishihr.app.R.color.status_pending
        "wfh"                                        -> com.krishihr.app.R.color.status_wfh
        "missing_punch_out"                          -> com.krishihr.app.R.color.status_late
        else                                         -> com.krishihr.app.R.color.text_secondary
    }
    return context.getColor(colorRes)
}

fun getStatusBgColor(context: Context, status: String?): Int {
    val colorRes = when (status?.lowercase()?.trim()) {
        "present", "approved", "confirmed", "paid"  -> com.krishihr.app.R.color.primary_ultra_light
        "absent", "rejected"                         -> com.krishihr.app.R.color.accent_red_light
        "late"                                       -> com.krishihr.app.R.color.accent_amber_light
        "half-day", "half_day"                       -> com.krishihr.app.R.color.accent_blue_light
        "pending"                                    -> com.krishihr.app.R.color.accent_orange_light
        "wfh"                                        -> com.krishihr.app.R.color.accent_purple_light
        "missing_punch_out"                          -> com.krishihr.app.R.color.accent_amber_light
        else                                         -> com.krishihr.app.R.color.background
    }
    return context.getColor(colorRes)
}

// ── Aliases (compat) ──────────────────────────────────────────────────────────
fun View.visible() { visibility = View.VISIBLE }
fun View.gone()    { visibility = View.GONE }