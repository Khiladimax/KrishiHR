package com.krishihr.app.ui.payroll
import com.krishihr.app.AndroidMain

import android.annotation.SuppressLint
import android.content.ContentValues
import android.content.Context
import android.graphics.*
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.view.*
import android.webkit.WebSettings
import android.widget.*
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.krishihr.app.R
import com.krishihr.app.data.api.RetrofitClient
import com.krishihr.app.data.models.*
import com.krishihr.app.databinding.FragmentPayrollBinding
import com.krishihr.app.utils.*
import kotlinx.coroutines.launch
import java.util.*

class PayrollFragment : Fragment() {
    private var _b: FragmentPayrollBinding? = null
    private val binding get() = _b!!
    private var spinnersReady = false
    private var currentSlip: Payslip? = null
    private var currentMonth = 0
    private var currentYear  = 0
    private val months = listOf(
        "January","February","March","April","May","June",
        "July","August","September","October","November","December"
    )

    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View {
        _b = FragmentPayrollBinding.inflate(i, c, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        val cal = Calendar.getInstance()
        setupSpinners(cal.get(Calendar.MONTH), cal.get(Calendar.YEAR))
        loadPayslip(cal.get(Calendar.MONTH) + 1, cal.get(Calendar.YEAR))

        binding.fabDownload.setOnClickListener {
            val slip = currentSlip ?: run { toast("No payslip loaded"); return@setOnClickListener }
            downloadPayslipAsImage(slip, currentMonth, currentYear)
        }
    }

    private fun setupSpinners(curMonth: Int, curYear: Int) {
        spinnersReady = false
        val years = (curYear downTo curYear - 3).map { it.toString() }
        binding.spinnerMonth.adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_dropdown_item, months)
        binding.spinnerYear.adapter  = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_dropdown_item, years)
        binding.spinnerMonth.setSelection(curMonth, false)
        binding.spinnerYear.setSelection(0, false)
        val listener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(a: AdapterView<*>?, v: View?, pos: Int, id: Long) {
                if (!spinnersReady) return
                val month = binding.spinnerMonth.selectedItemPosition + 1
                val year  = years[binding.spinnerYear.selectedItemPosition].toInt()
                loadPayslip(month, year)
            }
            override fun onNothingSelected(a: AdapterView<*>?) {}
        }
        binding.spinnerMonth.onItemSelectedListener = listener
        binding.spinnerYear.onItemSelectedListener  = listener
        spinnersReady = true
    }

    fun loadPayslip(month: Int, year: Int) {
        currentMonth = month
        currentYear  = year
        binding.progressPayroll.visibility = View.VISIBLE
        binding.cardPayslip.visibility     = View.GONE
        binding.tvNoPayslip.visibility     = View.GONE
        lifecycleScope.launch {
            try {
                val res = RetrofitClient.instance.getPayslip(month, year)
                if (_b == null) return@launch
                binding.progressPayroll.visibility = View.GONE
                if (res.isSuccessful && res.body()?.success == true) {
                    val slip = res.body()!!.data!!
                    currentSlip = slip
                    renderPayslip(slip, month, year)
                } else {
                    binding.tvNoPayslip.text = "No payslip for ${months[month-1]} $year"
                    binding.tvNoPayslip.visibility = View.VISIBLE
                }
            } catch (_: Exception) {
                if (_b == null) return@launch
                binding.progressPayroll.visibility = View.GONE
                binding.tvNoPayslip.text = "Could not load payslip"
                binding.tvNoPayslip.visibility = View.VISIBLE
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RENDER — shows the full web-style payslip inside a WebView
    // This matches the web version exactly (same table, same colours, same rows)
    // ─────────────────────────────────────────────────────────────────────────
    @SuppressLint("SetJavaScriptEnabled")
    private fun renderPayslip(slip: Payslip, month: Int, year: Int) {
        binding.cardPayslip.visibility = View.VISIBLE

        // Update the summary header above the WebView
        binding.tvPayslipTitle.text    = "${months[month-1]} $year Payslip"
        binding.tvNetSalary.text       = slip.effectiveNet.toRupees()
        binding.tvGrossSalary.text     = "Gross: ${slip.effectiveGross.toRupees()}"
        binding.tvTotalDeductions.text = "Deductions: ${slip.effectiveDed.toRupees()}"
        val statusColor = getStatusColor(requireContext(), slip.status)
        binding.tvPayslipStatus.text = slip.status?.replaceFirstChar { it.uppercase() } ?: "—"
        binding.tvPayslipStatus.setTextColor(statusColor)

        val pd = slip.presentDays ?: slip.daysPresent?.toDouble()
        if (pd != null) {
            val absent  = slip.absentDays ?: slip.daysAbsent?.toDouble() ?: 0.0
            val working = slip.workingDays ?: 0.0
            binding.tvDaysInfo.text = "Present: ${pd.toInt()} | Absent: ${absent.toInt()} | Working Days: ${working.toInt()}"
            binding.tvDaysInfo.visibility = View.VISIBLE
        }

        // ── Hide RecyclerView, load full web-style HTML into the WebView ──
        binding.rvComponents.visibility = View.GONE
        binding.webPayslip.apply {
            isScrollContainer = false
            settings.apply {
                loadWithOverviewMode = true
                useWideViewPort      = true
                setSupportZoom(false)
                builtInZoomControls  = false
                layoutAlgorithm      = WebSettings.LayoutAlgorithm.TEXT_AUTOSIZING
            }
            setBackgroundColor(Color.TRANSPARENT)
            val session  = SessionManager(requireContext())
            val employee = session.getEmployee()
            val html     = buildPayslipHtml(slip, employee, month, year)
            loadDataWithBaseURL(null, html, "text/html", "UTF-8", null)
            visibility = View.VISIBLE
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HTML builder — mirrors the web payslip table pixel-for-pixel
    // ─────────────────────────────────────────────────────────────────────────
    /** Convert ic_logo drawable to base64 PNG for embedding in HTML (matches web version) */
    private fun logoAsBase64(ctx: android.content.Context): String {
        return try {
            val drawable = androidx.core.content.ContextCompat.getDrawable(ctx, R.drawable.ic_logo)
                ?: return ""
            val size = 88
            val bmp  = android.graphics.Bitmap.createBitmap(size, size, android.graphics.Bitmap.Config.ARGB_8888)
            val cnv  = android.graphics.Canvas(bmp)
            drawable.setBounds(0, 0, size, size)
            drawable.draw(cnv)
            val baos = java.io.ByteArrayOutputStream()
            bmp.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, baos)
            bmp.recycle()
            android.util.Base64.encodeToString(baos.toByteArray(), android.util.Base64.NO_WRAP)
        } catch (_: Exception) { "" }
    }

    private fun buildPayslipHtml(slip: Payslip, emp: Employee?, month: Int, year: Int): String {
        val session = SessionManager(requireContext())
        val e       = emp ?: session.getEmployee()
        val logoB64 = logoAsBase64(requireContext())
        // Build logo tag exactly like the web version - img with base64 src
        val logoTag = if (logoB64.isNotEmpty())
            """<img src="data:image/png;base64,$logoB64" alt="${AndroidMain.COMPANY_SHORT_NAME}" style="height:88px;width:88px;object-fit:contain;display:block;background:transparent;">"""
        else
            """<div style="width:88px;height:88px;background:#2E7D32;border-radius:8px;display:flex;align-items:center;justify-content:center;text-align:center;"><span style="color:#fff;font-weight:800;font-size:11px;">KRISHI<br>CARE</span></div>"""

        // Employee info fields (prefer payslip JOIN, fall back to session)
        val name   = slip.employeeName  ?: e?.fullName         ?: "—"
        val empId  = slip.employeeCode  ?: e?.employeeCode     ?: "—"
        val desig  = slip.designationTitle ?: e?.designationTitle ?: e?.designation ?: "—"
        val dept   = slip.departmentName   ?: e?.departmentName   ?: e?.department  ?: "—"
        val doj    = (slip.slipDoj ?: e?.effectiveJoiningDate)?.toDisplayDate() ?: "—"
        val dob    = (slip.slipDob ?: e?.dateOfBirth)?.toDisplayDate()          ?: "—"
        val uan    = slip.uanNumber?.takeIf { it.isNotBlank() } ?: "—"
        val pfNo   = slip.pfNumber?.takeIf  { it.isNotBlank() } ?: "—"
        val pan    = slip.panNumber?.takeIf  { it.isNotBlank() } ?: "—"
        val acct   = slip.bankAccount?.takeIf { it.isNotBlank() } ?: "—"
        val bank   = slip.bankName?.takeIf    { it.isNotBlank() } ?: "—"
        val ifsc   = slip.bankIfsc?.takeIf    { it.isNotBlank() } ?: "—"

        val pd  = (slip.presentDays ?: slip.daysPresent?.toDouble())?.toInt()?.toString() ?: "—"
        // FIX: "Days in Month" must be CALENDAR days (e.g. 31 for January), not working days.
        // Web uses: new Date(year, month, 0).getDate() — last day of the month.
        // Android was incorrectly showing slip.workingDays (e.g. 26) here.
        val wd  = Calendar.getInstance().apply { set(year, month - 1, 1) }
            .getActualMaximum(Calendar.DAY_OF_MONTH).toString()
        val lwp = if ((slip.lopDays ?: 0.0) > 0) slip.lopDays!!.toInt().toString() else "-"

        // Earnings list
        val earnings = buildEarnings(slip)
        // Deductions list
        val deductions = buildDeductions(slip)

        val tableRows = maxOf(earnings.size, deductions.size)
        val grossPay     = slip.effectiveGross
        val totalEarning = slip.effectiveGross + (slip.pfEmployer ?: 0.0)
        val totalDed     = slip.effectiveDed
        val netSalary    = slip.effectiveNet

        fun fmt(v: Double): String {
            if (v == 0.0) return "—"
            val l = v.toLong()
            return if (v == l.toDouble()) "%,d".format(l) else "%,.2f".format(v)
        }

        // Build earnings/deductions table rows HTML — matching web payslip.html exactly
        val rowsHtml = buildString {
            for (i in 0 until tableRows) {
                val earn = earnings.getOrNull(i)
                val ded  = deductions.getOrNull(i)
                append("<tr>")
                if (earn != null) {
                    append("<td style='padding:6px 10px;font-size:14px;border:1px solid #ccc'>${earn.first}</td>")
                    append("<td style='padding:6px 10px;font-size:14px;border:1px solid #ccc;text-align:center'>${fmt(earn.second)}</td>")
                } else {
                    append("<td style='padding:6px 10px;font-size:14px;border:1px solid #ccc'></td>")
                    append("<td style='padding:6px 10px;font-size:14px;border:1px solid #ccc;text-align:center'></td>")
                }
                if (ded != null) {
                    append("<td style='padding:6px 10px;font-size:14px;border:1px solid #ccc'>${ded.first}</td>")
                    append("<td style='padding:6px 10px;font-size:14px;border:1px solid #ccc;text-align:center'>${fmt(ded.second)}</td>")
                } else {
                    append("<td style='padding:6px 10px;font-size:14px;border:1px solid #ccc'></td>")
                    append("<td style='padding:6px 10px;font-size:14px;border:1px solid #ccc;text-align:center'></td>")
                }
                append("</tr>")
            }
        }

        return """<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, 'Helvetica Neue', sans-serif; font-size: 12px; background: #fff; color: #111; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
</style>
</head>
<body>

<div style="font-family:Arial,'Helvetica Neue',sans-serif;background:#fff !important;color:#111 !important;max-width:794px;margin:0 auto;border:2px solid #2E7D32 !important;padding:0;box-shadow:0 2px 12px rgba(0,0,0,.08)">

<!-- COMPANY HEADER -->
<table style="width:100%;border-collapse:collapse;border-bottom:2px solid #2E7D32 !important">
  <tr>
    <td style="padding:16px 20px;width:15%;vertical-align:middle;background:#F1F8E9 !important;border:none;">
        $logoTag
    </td>
    <td style="padding:16px 20px;text-align:center;vertical-align:middle;background:#F1F8E9 !important;">
      <div style="font-size:19px;font-weight:800;color:#000;letter-spacing:0.2px;text-align:center;">${AndroidMain.COMPANY_NAME}</div>
      <div style="font-size:13px;margin-top:6px;color:#222;text-align:center;">Office Address: 617, 6th Floor, Viva Hubtown, Western Express Highway,</div>
      <div style="font-size:13px;color:#222;text-align:center;">Shankarwadi Jogeshwari(East), Mumbai - 400060.</div>
    </td>
  </tr>
</table>

<!-- TITLE -->
<div style="text-align:center;padding:10px;border-bottom:2px solid #2E7D32;font-size:15px;font-weight:700;background:#E8F5E9;color:#000;">
  Pay Slip For The Month Of - ${months[month-1]} $year
</div>

<!-- EMPLOYEE INFO TABLE -->
<table style="width:100%;border-collapse:collapse;border-bottom:1.5px solid #bbb">
  <tr>
    <td style="padding:5px 10px;width:16%;font-size:14px;font-weight:700;border:1px solid #ccc;background:#F1F8E9 !important;color:#1B5E20">Name</td>
    <td style="padding:5px 10px;width:34%;font-size:14px;border:1px solid #ccc;text-align:center">$name</td>
    <td style="padding:5px 10px;width:16%;font-size:14px;font-weight:700;border:1px solid #ccc;background:#F1F8E9 !important;color:#1B5E20">Designation</td>
    <td style="padding:5px 10px;width:34%;font-size:14px;border:1px solid #ccc;text-align:center">$desig</td>
  </tr>
  <tr>
    <td style="padding:5px 10px;font-size:14px;font-weight:700;border:1px solid #ccc;background:#F1F8E9 !important;color:#1B5E20">EMP ID</td>
    <td style="padding:5px 10px;font-size:14px;font-family:monospace;border:1px solid #ccc;text-align:center">$empId</td>
    <td style="padding:5px 10px;font-size:14px;font-weight:700;border:1px solid #ccc;background:#F1F8E9 !important;color:#1B5E20">Department</td>
    <td style="padding:5px 10px;font-size:14px;border:1px solid #ccc;text-align:center">$dept</td>
  </tr>
  <tr>
    <td style="padding:5px 10px;font-size:14px;font-weight:700;border:1px solid #ccc;background:#F1F8E9 !important;color:#1B5E20">U.A.N</td>
    <td style="padding:5px 10px;font-size:14px;font-family:monospace;border:1px solid #ccc;text-align:center">$uan</td>
    <td style="padding:5px 10px;font-size:14px;font-weight:700;border:1px solid #ccc;background:#F1F8E9 !important;color:#1B5E20">EMP D.O.J</td>
    <td style="padding:5px 10px;font-size:14px;border:1px solid #ccc;text-align:center">$doj</td>
  </tr>
  <tr>
    <td style="padding:5px 10px;font-size:14px;font-weight:700;border:1px solid #ccc;background:#F1F8E9 !important;color:#1B5E20">PF No.</td>
    <td style="padding:5px 10px;font-size:14px;font-family:monospace;border:1px solid #ccc;text-align:center">$pfNo</td>
    <td style="padding:5px 10px;font-size:14px;font-weight:700;border:1px solid #ccc;background:#F1F8E9 !important;color:#1B5E20">Location</td>
    <td style="padding:5px 10px;font-size:14px;border:1px solid #ccc;text-align:center">Mumbai</td>
  </tr>
  <tr>
    <td style="padding:5px 10px;font-size:14px;font-weight:700;border:1px solid #ccc;background:#F1F8E9 !important;color:#1B5E20">EMP Pan</td>
    <td style="padding:5px 10px;font-size:14px;font-family:monospace;border:1px solid #ccc;text-align:center">$pan</td>
    <td style="padding:5px 10px;font-size:14px;font-weight:700;border:1px solid #ccc;background:#F1F8E9 !important;color:#1B5E20">Day's Worked</td>
    <td style="padding:5px 10px;font-size:14px;border:1px solid #ccc;text-align:center">$pd</td>
  </tr>
  <tr>
    <td style="padding:5px 10px;font-size:14px;font-weight:700;border:1px solid #ccc;background:#F1F8E9 !important;color:#1B5E20">EMP D.O.B</td>
    <td style="padding:5px 10px;font-size:14px;border:1px solid #ccc;text-align:center">$dob</td>
    <td style="padding:5px 10px;font-size:14px;font-weight:700;border:1px solid #ccc;background:#F1F8E9 !important;color:#1B5E20">Days in Month</td>
    <td style="padding:5px 10px;font-size:14px;border:1px solid #ccc;text-align:center">$wd</td>
  </tr>
  <tr>
    <td style="padding:5px 10px;font-size:14px;font-weight:700;border:1px solid #ccc;background:#F1F8E9 !important;color:#1B5E20">A/C Number</td>
    <td style="padding:5px 10px;font-size:14px;font-family:monospace;border:1px solid #ccc;text-align:center">$acct</td>
    <td style="padding:5px 10px;font-size:14px;font-weight:700;border:1px solid #ccc;background:#F1F8E9 !important;color:#1B5E20">LWP</td>
    <td style="padding:5px 10px;font-size:14px;border:1px solid #ccc;text-align:center">$lwp</td>
  </tr>
  <tr>
    <td style="padding:5px 10px;font-size:14px;font-weight:700;border:1px solid #ccc;background:#F1F8E9 !important;color:#1B5E20">Bank</td>
    <td style="padding:5px 10px;font-size:14px;border:1px solid #ccc;text-align:center">$bank</td>
    <td style="padding:5px 10px;font-size:14px;font-weight:700;border:1px solid #ccc;background:#F1F8E9 !important;color:#1B5E20">IFSC</td>
    <td style="padding:5px 10px;font-size:14px;font-family:monospace;border:1px solid #ccc;text-align:center">$ifsc</td>
  </tr>
</table>

<!-- EARNINGS & DEDUCTIONS -->
<table style="width:100%;border-collapse:collapse">
  <tr style="background:#f5f5f5">
    <td colspan="2" style="padding:7px 10px;font-size:13px;font-weight:700;text-align:center;border:1px solid #ccc;width:50%;background:#C8E6C9 !important;color:#1B5E20 !important">Earnings</td>
    <td colspan="2" style="padding:7px 10px;font-size:13px;font-weight:700;text-align:center;border:1px solid #ccc;width:50%;background:#FFCDD2 !important;color:#B71C1C !important">Deductions</td>
  </tr>
  <tr style="background:#F9FBE7">
    <td style="padding:7px 10px;font-size:14px;font-weight:700;border:1px solid #ccc;width:34%">Particulars</td>
    <td style="padding:7px 10px;font-size:14px;font-weight:700;border:1px solid #ccc;width:16%;text-align:center">Rs.</td>
    <td style="padding:7px 10px;font-size:14px;font-weight:700;border:1px solid #ccc;width:34%">Particulars</td>
    <td style="padding:7px 10px;font-size:14px;font-weight:700;border:1px solid #ccc;width:16%;text-align:center">Rs.</td>
  </tr>
  $rowsHtml
  <tr style="background:#E8F5E9 !important">
    <td style="padding:7px 10px;font-size:14px;font-weight:700;border:1px solid #ccc;color:#000 !important">Gross Pay</td>
    <td style="padding:6px 10px;font-size:14px;font-weight:700;border:1px solid #ccc;text-align:center">${fmt(grossPay)}</td>
    <td style="padding:6px 10px;font-size:14px;border:1px solid #ccc"></td>
    <td style="padding:6px 10px;font-size:14px;border:1px solid #ccc"></td>
  </tr>
  <tr><td style="padding:3px 10px;border:1px solid #ccc" colspan="4"></td></tr>
  <tr style="background:#f5f5f5">
    <td style="padding:7px 10px;font-size:14px;font-weight:700;border:1px solid #ccc;background:#F1F8E9 !important;color:#1B5E20 !important">Total Earning</td>
    <td style="padding:6px 10px;font-size:14px;font-weight:700;border:1px solid #ccc;text-align:center">${fmt(totalEarning)}</td>
    <td style="padding:7px 10px;font-size:14px;font-weight:700;border:1px solid #ccc;background:#FFEBEE !important;color:#B71C1C !important">Total Deductions</td>
    <td style="padding:6px 10px;font-size:14px;font-weight:700;border:1px solid #ccc;text-align:center">${fmt(totalDed)}</td>
  </tr>
</table>

<!-- NET SALARY -->
<table style="width:100%;border-collapse:collapse;border-top:1.5px solid #bbb">
  <tr>
    <td style="padding:9px 10px;font-size:13px;font-weight:700;border:2px solid #2E7D32 !important;width:34%;background:#2E7D32 !important;color:#fff !important">Net Salary (Rs.)</td>
    <td style="padding:9px 10px;font-size:14px;font-weight:800;border:2px solid #2E7D32 !important;text-align:center;background:#E8F5E9 !important;color:#1B5E20 !important" colspan="3">${fmt(netSalary)}</td>
  </tr>
</table>

<div style="padding:10px 12px;font-size:11px;color:#555;font-style:italic">
  It is computer generated statement signature is not required.
</div>
</div>

</body>
</html>"""
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DOWNLOAD — renders pixel-perfect web-style payslip image → Gallery
    // ─────────────────────────────────────────────────────────────────────────
    @android.annotation.SuppressLint("SetJavaScriptEnabled")
    private fun downloadPayslipAsImage(slip: Payslip, month: Int, year: Int) {
        val session  = SessionManager(requireContext())
        val employee = session.getEmployee()
        binding.fabDownload.isEnabled = false
        binding.fabDownload.text = "Generating..."

        // Step 1: render HTML → Bitmap via off-screen WebView attached to window
        val html     = buildPayslipHtml(slip, employee, month, year)
        val filename = "Payslip_${months[month-1]}_$year"
        val widthPx  = 2480  // A4 at 300dpi = 2480×3508

        val wv = android.webkit.WebView(requireContext())
        wv.visibility = android.view.View.INVISIBLE
        wv.settings.apply {
            javaScriptEnabled = false
            loadWithOverviewMode = true
            useWideViewPort    = true
        }
        // Must be attached to a window for onPageFinished to fire
        val container = binding.root as? android.view.ViewGroup
        container?.addView(wv, android.view.ViewGroup.LayoutParams(widthPx, android.view.ViewGroup.LayoutParams.WRAP_CONTENT))

        wv.webViewClient = object : android.webkit.WebViewClient() {
            override fun onPageFinished(view: android.webkit.WebView, url: String?) {
                // Wait longer to ensure full render on all devices
                // 1200ms gives slow/mid-range Android devices enough time to fully render
                view.postDelayed({
                    try {
                        // Force a proper measure+layout at full A4 width
                        // contentHeight can be 0 before layout — measure first, then read
                        view.measure(
                            android.view.View.MeasureSpec.makeMeasureSpec(widthPx, android.view.View.MeasureSpec.EXACTLY),
                            android.view.View.MeasureSpec.makeMeasureSpec(0, android.view.View.MeasureSpec.UNSPECIFIED)
                        )
                        val measuredH = view.measuredHeight.coerceAtLeast(100)
                        // Also check contentHeight as a fallback (use whichever is larger)
                        val rawContentH = view.contentHeight
                        val density = resources.displayMetrics.density
                        val scaledContentH = (rawContentH * density).toInt()
                        val contentH = maxOf(measuredH, scaledContentH, 500)

                        view.layout(0, 0, widthPx, contentH)

                        // Step 2: draw WebView → Bitmap
                        val bmp = android.graphics.Bitmap.createBitmap(widthPx, contentH, android.graphics.Bitmap.Config.ARGB_8888)
                        val canvas = android.graphics.Canvas(bmp)
                        canvas.drawColor(android.graphics.Color.WHITE)
                        view.draw(canvas)
                        container?.removeView(view)

                        // Step 3: Bitmap → PDF using android.graphics.pdf.PdfDocument
                        val pdfDoc = android.graphics.pdf.PdfDocument()
                        // A4 at 300dpi: 2480 x 3508. Split bitmap into A4 pages.
                        val pageH   = 3508
                        val pageCount = Math.ceil(contentH.toDouble() / pageH).toInt().coerceAtLeast(1)
                        for (i in 0 until pageCount) {
                            val info = android.graphics.pdf.PdfDocument.PageInfo.Builder(widthPx, pageH, i + 1).create()
                            val page = pdfDoc.startPage(info)
                            val pc   = page.canvas
                            pc.drawColor(android.graphics.Color.WHITE)
                            pc.translate(0f, -(i * pageH).toFloat())
                            pc.drawBitmap(bmp, 0f, 0f, null)
                            pdfDoc.finishPage(page)
                        }
                        bmp.recycle()

                        // Step 4: save PDF to Downloads/KrishiHR
                        val ctx = requireContext()
                        val values = ContentValues().apply {
                            put(MediaStore.Downloads.DISPLAY_NAME, "$filename.pdf")
                            put(MediaStore.Downloads.MIME_TYPE, "application/pdf")
                            put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + AndroidMain.DOWNLOADS_FOLDER)
                            put(MediaStore.Downloads.IS_PENDING, 1)
                        }
                        val uri = ctx.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                        if (uri != null) {
                            ctx.contentResolver.openOutputStream(uri)?.use { out -> pdfDoc.writeTo(out) }
                            values.clear()
                            values.put(MediaStore.Downloads.IS_PENDING, 0)
                            ctx.contentResolver.update(uri, values, null, null)
                            pdfDoc.close()
                            if (_b != null) {
                                binding.fabDownload.isEnabled = true
                                binding.fabDownload.text = "Download"
                                toast(AndroidMain.PDF_SAVED_TOAST)
                            }
                        } else {
                            pdfDoc.close()
                            if (_b != null) {
                                binding.fabDownload.isEnabled = true
                                binding.fabDownload.text = "Download"
                                toast("❌ PDF save failed")
                            }
                        }
                    } catch (e: Exception) {
                        container?.removeView(view)
                        if (_b != null) {
                            binding.fabDownload.isEnabled = true
                            binding.fabDownload.text = "Download"
                            toast("❌ ${e.message}")
                        }
                    }
                }, 1200)
            }
        }
        wv.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Core bitmap builder — mirrors the web payslip 1:1 (used for Download)
    // ─────────────────────────────────────────────────────────────────────────
    // Core bitmap builder — mirrors the web payslip 1:1 (used for Download)
    // ─────────────────────────────────────────────────────────────────────────
    private fun buildPayslipBitmap(
        ctx: Context,
        slip: Payslip,
        emp: Employee?,
        month: Int,
        year: Int
    ): Bitmap {

        val cDarkGreen   = Color.parseColor("#1B5E20")
        val cGreen       = Color.parseColor("#2E7D32")
        val cLtGreen     = Color.parseColor("#E8F5E9")
        val cBorder      = Color.parseColor("#A5D6A7")
        val cDivider     = Color.parseColor("#C8E6C9")
        val cPink        = Color.parseColor("#FCE4EC")
        val cRed         = Color.parseColor("#C62828")
        val cGrey        = Color.parseColor("#555555")
        val cLightGrey   = Color.parseColor("#777777")

        val sc  = 3f
        val W   = (820 * sc).toInt()
        val pad = 18 * sc

        fun fill(color: Int) = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color }
        fun stroke(color: Int, w: Float = sc) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = color; style = Paint.Style.STROKE; strokeWidth = w
        }
        // FIX: Load Poppins font to match WebView payslip rendering.
        // Previously used Typeface.DEFAULT (system Roboto) causing font/size differences.
        val poppinsRegular = try {
            androidx.core.content.res.ResourcesCompat.getFont(ctx, R.font.poppins_regular)
        } catch (_: Exception) { null }
        val poppinsSemiBold = try {
            androidx.core.content.res.ResourcesCompat.getFont(ctx, R.font.poppins_semibold)
        } catch (_: Exception) { null }

        fun txt(sp: Float, color: Int = Color.BLACK, bold: Boolean = false) =
            Paint(Paint.ANTI_ALIAS_FLAG).apply {
                this.color = color
                textSize   = sp * sc
                typeface   = when {
                    bold && poppinsSemiBold != null -> poppinsSemiBold
                    !bold && poppinsRegular != null -> poppinsRegular
                    bold -> Typeface.DEFAULT_BOLD
                    else -> Typeface.DEFAULT
                }
            }

        val hdrH    = 100 * sc
        val titleH  = 38  * sc
        val rh      = 28  * sc   // FIX: was 26 — extra 2px prevents text clipping with Poppins font
        val colHdrH = 28  * sc   // FIX: match rh
        val subHdrH = 24  * sc   // FIX: was 22

        val infoRows = buildInfoRows(ctx, slip, emp, month, year)
        val earnList = buildEarnings(slip)
        val dedList  = buildDeductions(slip)
        val tableR   = maxOf(earnList.size, dedList.size)

        val totalH = (hdrH + titleH +
                infoRows.size * rh +
                colHdrH + subHdrH +
                tableR * rh +
                rh +
                rh +
                42 * sc +
                26 * sc +
                4 * sc).toInt()

        val bmp    = Bitmap.createBitmap(W, totalH, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        canvas.drawColor(Color.WHITE)

        var y  = 0f
        val hw = W / 2f

        fun hLine(yy: Float) = canvas.drawLine(0f, yy, W.toFloat(), yy, stroke(cBorder))
        fun vLine(xx: Float, y1: Float, y2: Float) = canvas.drawLine(xx, y1, xx, y2, stroke(cDivider))
        fun rowBg(y1: Float, y2: Float, color: Int) =
            canvas.drawRect(0f, y1, W.toFloat(), y2, fill(color))
        fun drawRight(text: String, rightX: Float, yy: Float, p: Paint) =
            canvas.drawText(text, rightX - p.measureText(text), yy, p)

        // 1. Company header
        rowBg(y, y + hdrH, cLtGreen)
        canvas.drawRect(0f, y, W.toFloat(), y + hdrH, stroke(cBorder))
        val logoX = pad; val logoY = y + 10 * sc; val logoW = 80 * sc; val logoH = 80 * sc
        try {
            // FIX: Use ContextCompat.getDrawable() instead of BitmapFactory.decodeResource().
            // BitmapFactory fails silently on some devices (returns null without exception),
            // causing the green fallback box to appear instead of the real logo.
            // ContextCompat properly loads PNGs and handles density scaling correctly.
            val logoDrawable = androidx.core.content.ContextCompat.getDrawable(ctx, R.drawable.ic_logo)
            if (logoDrawable != null) {
                val logoBmpScaled = Bitmap.createBitmap(logoW.toInt(), logoH.toInt(), Bitmap.Config.ARGB_8888)
                val logoCanvas    = Canvas(logoBmpScaled)
                logoDrawable.setBounds(0, 0, logoW.toInt(), logoH.toInt())
                logoDrawable.draw(logoCanvas)
                val dst = RectF(logoX, logoY, logoX + logoW, logoY + logoH)
                canvas.drawBitmap(logoBmpScaled, null, dst, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
                logoBmpScaled.recycle()
            } else {
                val logoR = RectF(logoX, logoY, logoX + logoW, logoY + logoH)
                canvas.drawRoundRect(logoR, 10 * sc, 10 * sc, fill(cGreen))
                drawLogoFallback(canvas, logoX, logoY, logoW, logoH, sc)
            }
        } catch (_: Exception) {
            val logoR = RectF(logoX, logoY, logoX + logoW, logoY + logoH)
            canvas.drawRoundRect(logoR, 10 * sc, 10 * sc, fill(cGreen))
            drawLogoFallback(canvas, logoX, logoY, logoW, logoH, sc)
        }
        // FIX: Center the company name/address in the remaining space (after logo),
        // matching the web version which uses text-align:center in that cell.
        val textX    = logoX + logoW + 16 * sc
        val textAreaW = W.toFloat() - textX - pad
        val companyP  = txt(13f, cDarkGreen, true)
        val addr1P    = txt(7.5f, cGrey)
        val addr2P    = txt(7.5f, cGrey)
        val companyStr = "Krishi Care & Management Services Pvt. Ltd."
        val addr1Str   = "Office Address: 617, 6th Floor, Viva Hubtown, Western Express Highway,"
        val addr2Str   = "Shankarwadi Jogeshwari(East), Mumbai - 400060."
        // Center each line within the text area
        val companyX = textX + (textAreaW - companyP.measureText(companyStr)) / 2f
        val addr1X   = textX + (textAreaW - addr1P.measureText(addr1Str)) / 2f
        val addr2X   = textX + (textAreaW - addr2P.measureText(addr2Str)) / 2f
        canvas.drawText(companyStr, companyX.coerceAtLeast(textX), y + 38 * sc, companyP)
        canvas.drawText(addr1Str,   addr1X.coerceAtLeast(textX),   y + 58 * sc, addr1P)
        canvas.drawText(addr2Str,   addr2X.coerceAtLeast(textX),   y + 74 * sc, addr2P)
        y += hdrH

        // 2. Title
        rowBg(y, y + titleH, cLtGreen)
        canvas.drawRect(0f, y, W.toFloat(), y + titleH, stroke(cBorder))
        val ttxt = "Pay Slip For The Month Of - ${months[month-1]} $year"
        val ttp  = txt(11f, cDarkGreen, true)
        canvas.drawText(ttxt, (W - ttp.measureText(ttxt)) / 2f, y + 26 * sc, ttp)
        y += titleH

        // 3. Info rows
        // FIX: Each label cell gets its OWN green background (#F1F8E9) regardless of row parity.
        // Web version does NOT alternate full rows — it gives each label cell a green bg individually.
        // Value cells always stay white.
        val c1 = W * 0.22f; val c2 = W * 0.50f; val c3 = W * 0.72f
        infoRows.forEachIndexed { idx, row ->
            val ry = y + idx * rh; val ry2 = ry + rh
            // Value cells: white background
            canvas.drawRect(0f, ry, W.toFloat(), ry2, fill(Color.WHITE))
            // Label cells: individual green background
            canvas.drawRect(0f,  ry, c1, ry2, fill(cLtGreen))
            canvas.drawRect(c2,  ry, c3, ry2, fill(cLtGreen))
            // Borders
            hLine(ry2)
            vLine(c1, ry, ry2); vLine(c2, ry, ry2); vLine(c3, ry, ry2)
            canvas.drawRect(0f, ry, W.toFloat(), ry2, stroke(cBorder))
            val ty = ry + 17 * sc
            canvas.drawText(row[0], pad,            ty, txt(8f, cDarkGreen, true))
            canvas.drawText(row[1], c1 + pad * 0.6f, ty, txt(8f))
            canvas.drawText(row[2], c2 + pad * 0.6f, ty, txt(8f, cDarkGreen, true))
            canvas.drawText(row[3], c3 + pad * 0.6f, ty, txt(8f))
        }
        y += infoRows.size * rh

        // 4. Earnings | Deductions headers
        // FIX: Text should be CENTERED in each half, matching web's text-align:center
        rowBg(y, y + colHdrH, cLtGreen)
        canvas.drawRect(RectF(hw, y, W.toFloat(), y + colHdrH), fill(cPink))
        canvas.drawRect(0f, y, W.toFloat(), y + colHdrH, stroke(cBorder))
        vLine(hw, y, y + colHdrH)
        val earnLblP = txt(10f, cGreen, true)
        val dedLblP  = txt(10f, Color.parseColor("#B71C1C"), true)
        val earnLbl = "Earnings"; val dedLbl = "Deductions"
        canvas.drawText(earnLbl, (hw - earnLblP.measureText(earnLbl)) / 2f,       y + 18 * sc, earnLblP)
        canvas.drawText(dedLbl,  hw + (hw - dedLblP.measureText(dedLbl)) / 2f,    y + 18 * sc, dedLblP)
        y += colHdrH

        // 5. Sub-header
        rowBg(y, y + subHdrH, cLtGreen)
        canvas.drawRect(0f, y, W.toFloat(), y + subHdrH, stroke(cBorder))
        vLine(hw, y, y + subHdrH)
        val rsRightE = hw - pad * 0.5f; val rsRightD = W.toFloat() - pad * 0.5f
        canvas.drawText("Particulars", pad,      y + 15 * sc, txt(8f, Color.BLACK, true))
        drawRight("Rs.", rsRightE, y + 15 * sc, txt(8f, Color.BLACK, true))
        canvas.drawText("Particulars", hw + pad, y + 15 * sc, txt(8f, Color.BLACK, true))
        drawRight("Rs.", rsRightD, y + 15 * sc, txt(8f, Color.BLACK, true))
        y += subHdrH

        // 6. Earn/Deduct rows
        for (i in 0 until tableR) {
            val ry = y + i * rh; val ry2 = ry + rh
            hLine(ry2); vLine(hw, ry, ry2)
            val ty = ry + 17 * sc
            earnList.getOrNull(i)?.let { (name, amt) ->
                canvas.drawText(name, pad, ty, txt(8f))
                drawRight(fmtAmt(amt), rsRightE, ty, txt(8f))
            }
            dedList.getOrNull(i)?.let { (name, amt) ->
                canvas.drawText(name, hw + pad, ty, txt(8f))
                drawRight(fmtAmt(amt), rsRightD, ty, txt(8f, cRed))
            }
        }
        y += tableR * rh

        // 7. Gross Pay
        rowBg(y, y + rh, cLtGreen)
        canvas.drawRect(0f, y, W.toFloat(), y + rh, stroke(cBorder))
        vLine(hw, y, y + rh)
        canvas.drawText("Gross Pay", pad, y + 17 * sc, txt(9f, Color.BLACK, true))
        drawRight(fmtAmt(slip.effectiveGross), rsRightE, y + 17 * sc, txt(9f, Color.BLACK, true))
        y += rh

        // 8. Total Earning | Total Deductions
        // FIX: "Total Earning" label cell → green bg (#F1F8E9), "Total Deductions" label → pink bg (#FFEBEE)
        // This matches the web version exactly.
        canvas.drawRect(0f, y, W.toFloat(), y + rh, fill(Color.WHITE)) // value cells white
        canvas.drawRect(0f,  y, hw, y + rh, fill(cLtGreen))            // left half label bg
        canvas.drawRect(hw,  y, W.toFloat(), y + rh, fill(Color.parseColor("#FFEBEE"))) // right half pink
        canvas.drawRect(0f, y, W.toFloat(), y + rh, stroke(cBorder))
        vLine(hw, y, y + rh)
        val totalEarning = slip.effectiveGross + (slip.pfEmployer ?: 0.0)
        canvas.drawText("Total Earning",     pad,      y + 17 * sc, txt(9f, cDarkGreen, true))
        drawRight(fmtAmt(totalEarning),      rsRightE, y + 17 * sc, txt(9f, Color.BLACK, true))
        canvas.drawText("Total Deductions",  hw + pad, y + 17 * sc, txt(9f, Color.parseColor("#B71C1C"), true))
        drawRight(fmtAmt(slip.effectiveDed), rsRightD, y + 17 * sc, txt(9f, Color.parseColor("#B71C1C"), true))
        y += rh

        // 9. Net Salary
        val netH = 42 * sc
        canvas.drawRect(0f, y, W.toFloat(), y + netH, fill(cGreen))
        val netLbl = txt(11f, Color.WHITE, true)
        canvas.drawText("Net Salary (Rs.)", pad, y + 28 * sc, netLbl)
        val netVal = fmtAmt(slip.effectiveNet)
        val netP   = txt(13f, Color.WHITE, true)
        canvas.drawText(netVal, hw + (hw - netP.measureText(netVal)) / 2f, y + 29 * sc, netP)
        y += netH

        // 10. Disclaimer
        val footH = 26 * sc
        rowBg(y, y + footH, Color.WHITE)
        canvas.drawRect(0f, y, W.toFloat(), y + footH, stroke(cBorder))
        canvas.drawText("It is computer generated statement signature is not required.", pad, y + 18 * sc, txt(7f, cLightGrey))

        return bmp
    }

    private fun drawLogoFallback(canvas: Canvas, lx: Float, ly: Float, lw: Float, lh: Float, sc: Float) {
        val white = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE; textSize = 9f * sc; typeface = Typeface.DEFAULT_BOLD
        }
        canvas.drawText("KRISHI", lx + 6 * sc, ly + 30 * sc, white)
        canvas.drawText("CARE",   lx + 14 * sc, ly + 47 * sc, white)
        val leafPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
        val cx = lx + lw / 2f; val baseY = ly + lh - 14 * sc
        val path = Path().apply {
            moveTo(cx, baseY)
            cubicTo(cx - 10 * sc, baseY - 12 * sc, cx - 14 * sc, baseY - 20 * sc, cx, baseY - 24 * sc)
            cubicTo(cx + 14 * sc, baseY - 20 * sc, cx + 10 * sc, baseY - 12 * sc, cx, baseY)
            close()
        }
        canvas.drawPath(path, leafPaint)
    }

    private fun buildInfoRows(
        ctx: Context, slip: Payslip, emp: Employee?, month: Int, year: Int
    ): List<Array<String>> {
        val s   = SessionManager(ctx)
        val e   = emp ?: s.getEmployee()
        val pd  = (slip.presentDays ?: slip.daysPresent?.toDouble())?.toInt()?.toString() ?: "—"
        // FIX: "Days in Month" = total calendar days, NOT working days (matches web version)
        val wd  = Calendar.getInstance().apply { set(year, month - 1, 1) }
            .getActualMaximum(Calendar.DAY_OF_MONTH).toString()
        val lwp = if ((slip.lopDays ?: 0.0) > 0) slip.lopDays!!.toInt().toString() else "-"
        val name  = slip.employeeName  ?: e?.fullName         ?: "—"
        val empId = slip.employeeCode  ?: e?.employeeCode     ?: "—"
        val desig = slip.designationTitle ?: e?.designationTitle ?: e?.designation ?: "—"
        val dept  = slip.departmentName   ?: e?.departmentName   ?: e?.department  ?: "—"
        val doj   = (slip.slipDoj ?: e?.effectiveJoiningDate)?.toDisplayDate() ?: "—"
        val dob   = (slip.slipDob ?: e?.dateOfBirth)?.toDisplayDate()          ?: "—"
        val uan   = slip.uanNumber?.takeIf { it.isNotBlank() } ?: "—"
        val pfNo  = slip.pfNumber?.takeIf  { it.isNotBlank() } ?: "—"
        val pan   = slip.panNumber?.takeIf  { it.isNotBlank() } ?: "—"
        val acct  = slip.bankAccount?.takeIf { it.isNotBlank() } ?: "—"
        val bank  = slip.bankName?.takeIf    { it.isNotBlank() } ?: "—"
        val ifsc  = slip.bankIfsc?.takeIf    { it.isNotBlank() } ?: "—"
        return listOf(
            arrayOf("Name",       name,  "Designation",   desig),
            arrayOf("EMP ID",     empId, "Department",    dept),
            arrayOf("U.A.N",      uan,   "EMP D.O.J",    doj),
            arrayOf("PF No.",     pfNo,  "Location",     "Mumbai"),
            arrayOf("EMP Pan",    pan,   "Day's Worked", pd),
            arrayOf("EMP D.O.B",  dob,   "Days in Month",wd),
            arrayOf("A/C Number", acct,  "LWP",          lwp),
            arrayOf("Bank",       bank,  "IFSC",         ifsc)
        )
    }

    private fun buildEarnings(slip: Payslip): List<Pair<String, Double>> {
        val list = mutableListOf<Pair<String, Double>>()
        (slip.basic ?: slip.basicSalary)?.let  { if (it > 0) list += "Basic Salary"    to it }
        slip.hra?.let                           { if (it > 0) list += "HRA"             to it }
        slip.gratuity?.let                      { if (it > 0) list += "Gratuity"        to it }
        slip.specialAllowance?.let              { if (it > 0) list += "Other Allowance" to it }
        slip.conveyance?.let                    { if (it > 0) list += "Conveyance"      to it }
        slip.components
            ?.filter { it.type.lowercase() in listOf("earning","earnings","allowance") }
            ?.forEach { c ->
                if (list.none { it.first.equals(c.name, ignoreCase = true) } && c.amount > 0)
                    list += c.name to c.amount
            }
        return list
    }

    private fun buildDeductions(slip: Payslip): List<Pair<String, Double>> {
        val list = mutableListOf<Pair<String, Double>>()
        slip.pfEmployee?.let      { if (it > 0) list += "Provident Fund - Employee contribution" to it }
        slip.professionalTax?.let { if (it > 0) list += "Professional Tax"                       to it }
        slip.emiRecovery?.let     { if (it > 0) list += "EMI Recovery"                           to it }
        slip.pfEmployer?.let      { if (it > 0) list += "Provident Fund - Employer contribution" to it }
        val adminAmt = slip.adminCharges ?: slip.pfAdmin ?: 0.0
        if (adminAmt > 0) list += "Admin Charges" to adminAmt
        slip.esiEmployee?.let     { if (it > 0) list += "ESI (Employee)"                         to it }
        slip.tds?.let             { if (it > 0) list += "TDS"                                    to it }
        slip.lwf?.let             { if (it > 0) list += "LWF"                                    to it }
        slip.components
            ?.filter { it.type.lowercase() in listOf("deduction","deductions") }
            ?.forEach { c ->
                if (list.none { it.first.equals(c.name, ignoreCase = true) } && c.amount > 0)
                    list += c.name to c.amount
            }
        return list
    }

    private fun fmtAmt(v: Double): String {
        if (v == 0.0) return "-"
        val l = v.toLong()
        return if (v == l.toDouble()) "%,d".format(l) else "%,.2f".format(v)
    }

    private fun saveBitmapToGallery(bmp: Bitmap, filename: String) {
        val ctx = requireContext()
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, "$filename.png")
            put(MediaStore.Images.Media.MIME_TYPE, "image/png")
            put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/KrishiHR")
            put(MediaStore.Images.Media.IS_PENDING, 1)
        }
        val uri = ctx.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
            ?: throw Exception("Could not create media store entry")
        ctx.contentResolver.openOutputStream(uri)?.use { out ->
            bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
        }
        values.clear()
        values.put(MediaStore.Images.Media.IS_PENDING, 0)
        ctx.contentResolver.update(uri, values, null, null)
    }

    override fun onDestroyView() { super.onDestroyView(); _b = null }
}

// ── In-app preview list adapter (kept for reference / other uses) ─────────────
class PayComponentAdapter(private val items: List<PayComponent>) :
    RecyclerView.Adapter<PayComponentAdapter.VH>() {

    inner class VH(val root: android.widget.LinearLayout) : RecyclerView.ViewHolder(root)

    override fun onCreateViewHolder(p: ViewGroup, t: Int): VH {
        val ctx = p.context; val dp = ctx.resources.displayMetrics.density
        val ll = android.widget.LinearLayout(ctx).apply {
            orientation = android.widget.LinearLayout.HORIZONTAL
            gravity     = android.view.Gravity.CENTER_VERTICAL
            setPadding((4*dp).toInt(), (8*dp).toInt(), (4*dp).toInt(), (8*dp).toInt())
            layoutParams = RecyclerView.LayoutParams(
                RecyclerView.LayoutParams.MATCH_PARENT, RecyclerView.LayoutParams.WRAP_CONTENT)
        }
        return VH(ll)
    }

    override fun getItemCount() = items.size

    override fun onBindViewHolder(h: VH, pos: Int) {
        val it  = items[pos]; val ctx = h.root.context; val dp = ctx.resources.displayMetrics.density
        h.root.removeAllViews()
        val isBig = it.type in listOf("total","net","deduction_total")
        if (isBig) h.root.setPadding((4*dp).toInt(), (10*dp).toInt(), (4*dp).toInt(), (10*dp).toInt())
        val amtColor = when (it.type) {
            "earning"   -> ctx.getColor(R.color.primary)
            "deduction" -> ctx.getColor(R.color.accent_red)
            "net"       -> ctx.getColor(R.color.accent_blue)
            else        -> ctx.getColor(R.color.text_primary)
        }
        h.root.addView(android.widget.TextView(ctx).apply {
            text     = it.name
            textSize = if (isBig) 14f else 13f
            setTypeface(null, if (isBig) android.graphics.Typeface.BOLD else android.graphics.Typeface.NORMAL)
            setTextColor(ctx.getColor(R.color.text_primary))
            layoutParams = android.widget.LinearLayout.LayoutParams(
                0, android.widget.LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        })
        h.root.addView(android.widget.TextView(ctx).apply {
            text     = it.amount.toRupees()
            textSize = if (isBig) 14f else 13f
            setTypeface(null, if (isBig) android.graphics.Typeface.BOLD else android.graphics.Typeface.NORMAL)
            setTextColor(amtColor)
        })
    }
}

// ── Payroll Management Fragment ───────────────────────────────────────────────
class PayrollMgmtFragment : Fragment() {
    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View {
        val ctx = requireContext(); val dp = ctx.resources.displayMetrics.density
        val sv   = android.widget.ScrollView(ctx)
        val root = android.widget.LinearLayout(ctx).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding((16*dp).toInt(), (16*dp).toInt(), (16*dp).toInt(), (80*dp).toInt())
        }
        sv.addView(root)
        root.addView(android.widget.TextView(ctx).apply {
            text = "Payroll Management"; textSize = 20f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setPadding(0,0,0,(16*dp).toInt())
        })
        fun card(title: String, sub: String, color: Int, click: () -> Unit) {
            val card = androidx.cardview.widget.CardView(ctx).apply {
                radius = 14*dp; cardElevation = 3*dp
                setCardBackgroundColor(ctx.getColor(color))
                layoutParams = android.widget.LinearLayout.LayoutParams(
                    android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                    android.widget.LinearLayout.LayoutParams.WRAP_CONTENT
                ).also { it.bottomMargin = (12*dp).toInt() }
                setOnClickListener { click() }
            }
            val ll = android.widget.LinearLayout(ctx).apply {
                orientation = android.widget.LinearLayout.VERTICAL
                setPadding((16*dp).toInt(), (16*dp).toInt(), (16*dp).toInt(), (16*dp).toInt())
            }
            ll.addView(android.widget.TextView(ctx).apply {
                text = title; textSize = 16f
                setTypeface(null, android.graphics.Typeface.BOLD)
                setTextColor(ctx.getColor(R.color.text_primary))
            })
            ll.addView(android.widget.TextView(ctx).apply {
                text = sub; textSize = 12f
                setTextColor(ctx.getColor(R.color.text_secondary))
            })
            card.addView(ll); root.addView(card)
        }
        card("Salary Structures", "View & edit employee salary components", R.color.accent_blue_light) {
            toast("Salary structures management — use web panel for full edit")
        }
        card("All Payslips", "View payslips for all employees", R.color.primary_ultra_light) {
            (activity as? com.krishihr.app.ui.MainActivity)?.loadFragment(AllPayslipsFragment())
        }
        card("Upload Payroll", "Upload processed payroll Excel", R.color.accent_amber_light) {
            toast("Upload payroll via the web panel or API")
        }
        return sv
    }
}

class AllPayslipsFragment : Fragment() {
    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View {
        val ctx = requireContext(); val dp = ctx.resources.displayMetrics.density
        val cal = Calendar.getInstance()
        val months = arrayOf("Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec")
        val root = android.widget.LinearLayout(ctx).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setBackgroundColor(ctx.getColor(R.color.background))
            setPadding((16*dp).toInt(),(16*dp).toInt(),(16*dp).toInt(),(16*dp).toInt())
        }
        root.addView(android.widget.TextView(ctx).apply {
            text = "All Payslips"; textSize = 18f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setPadding(0,0,0,(12*dp).toInt())
        })
        val spMonth = android.widget.Spinner(ctx).apply {
            adapter = ArrayAdapter(ctx, android.R.layout.simple_spinner_dropdown_item, months)
            setSelection(cal.get(Calendar.MONTH))
        }
        root.addView(spMonth)
        val rv = RecyclerView(ctx).apply { layoutManager = LinearLayoutManager(ctx) }
        root.addView(rv)
        fun load() {
            val m = spMonth.selectedItemPosition + 1
            lifecycleScope.launch {
                try {
                    val res   = RetrofitClient.instance.getPayroll(m, cal.get(Calendar.YEAR))
                    val slips = res.body()?.data ?: emptyList()
                    rv.adapter = object : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
                        override fun getItemCount() = slips.size
                        override fun onCreateViewHolder(p: ViewGroup, t: Int): RecyclerView.ViewHolder {
                            val ll = android.widget.LinearLayout(p.context).apply {
                                orientation = android.widget.LinearLayout.VERTICAL
                                setPadding((12*dp).toInt(),(10*dp).toInt(),(12*dp).toInt(),(10*dp).toInt())
                                setBackgroundColor(p.context.getColor(R.color.surface))
                                layoutParams = RecyclerView.LayoutParams(
                                    RecyclerView.LayoutParams.MATCH_PARENT,
                                    RecyclerView.LayoutParams.WRAP_CONTENT
                                ).also { it.bottomMargin = (8*dp).toInt() }
                            }
                            return object : RecyclerView.ViewHolder(ll) {}
                        }
                        override fun onBindViewHolder(h: RecyclerView.ViewHolder, pos: Int) {
                            val s = slips[pos]
                            val ll = h.itemView as android.widget.LinearLayout
                            ll.removeAllViews()
                            ll.addView(android.widget.TextView(ctx).apply {
                                text = s.employeeName ?: "—"; textSize = 14f
                                setTypeface(null, android.graphics.Typeface.BOLD)
                            })
                            ll.addView(android.widget.TextView(ctx).apply {
                                text = "Net: ${s.netSalary.toRupees()}  |  ${s.status ?: ""}"
                                textSize = 12f
                                setTextColor(ctx.getColor(R.color.text_secondary))
                            })
                        }
                    }
                } catch (_: Exception) {}
            }
        }
        spMonth.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(a: AdapterView<*>?, v: View?, p: Int, id: Long) { load() }
            override fun onNothingSelected(a: AdapterView<*>?) {}
        }
        load()
        return root
    }
}