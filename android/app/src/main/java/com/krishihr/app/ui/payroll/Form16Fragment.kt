package com.krishihr.app.ui.payroll
import com.krishihr.app.AndroidMain

import android.content.Context
import android.graphics.*
import android.os.Bundle
import android.print.PrintAttributes
import android.print.PrintManager
import android.view.*
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.*
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.krishihr.app.R
import com.krishihr.app.data.api.RetrofitClient
import com.krishihr.app.data.models.*
import kotlinx.coroutines.launch
import java.text.NumberFormat
import java.util.*

class Form16Fragment : Fragment() {

    private val api get() = RetrofitClient.instance
    private val fmt = NumberFormat.getCurrencyInstance(Locale("en", "IN")).apply { maximumFractionDigits = 0 }
    private fun money(v: Double) = fmt.format(v)

    private var loadedData: Form16Data? = null
    private var loadedFY: String = ""

    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View =
        i.inflate(R.layout.fragment_form16, c, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        val spinnerFY   = view.findViewById<Spinner>(R.id.spinnerFY16)
        val btnLoad     = view.findViewById<Button>(R.id.btnLoadForm16)
        val btnDownload = view.findViewById<Button>(R.id.btnDownloadPdf)
        val scrollArea  = view.findViewById<ScrollView>(R.id.scrollForm16)
        val tvLoading   = view.findViewById<TextView>(R.id.tvForm16Loading)
        val containerA  = view.findViewById<LinearLayout>(R.id.containerPartA)
        val containerB  = view.findViewById<LinearLayout>(R.id.containerPartB)
        val containerM  = view.findViewById<LinearLayout>(R.id.containerMonthly)

        btnDownload?.visibility = View.GONE

        lifecycleScope.launch {
            val resp = try { api.getForm16Years() } catch (e: Exception) { null }
            val fys = resp?.body()?.data?.takeIf { it.isNotEmpty() } ?: listOf("2024-25", "2025-26")
            spinnerFY.adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_dropdown_item, fys)
            val idx = fys.indexOf("2025-26"); if (idx >= 0) spinnerFY.setSelection(idx)
        }

        btnLoad.setOnClickListener {
            val fy = spinnerFY.selectedItem?.toString() ?: return@setOnClickListener
            loadedFY = fy
            tvLoading.visibility = View.VISIBLE; scrollArea.visibility = View.GONE; btnDownload?.visibility = View.GONE
            lifecycleScope.launch {
                val resp = try { api.getForm16(fy) } catch (e: Exception) { null }
                tvLoading.visibility = View.GONE
                val data = resp?.body()?.data
                if (data == null) { Toast.makeText(context, resp?.body()?.message ?: "No data found for FY $fy", Toast.LENGTH_SHORT).show(); return@launch }
                loadedData = data
                renderForm16(data, containerA, containerB, containerM)
                scrollArea.visibility = View.VISIBLE; btnDownload?.visibility = View.VISIBLE
            }
        }

        btnDownload?.setOnClickListener {
            val data = loadedData ?: run { Toast.makeText(context, "Please load Form 16 first", Toast.LENGTH_SHORT).show(); return@setOnClickListener }
            downloadForm16AsPdf(data, loadedFY)
        }
    }

    private fun renderForm16(d: Form16Data, containerA: LinearLayout, containerB: LinearLayout, containerM: LinearLayout) {
        val v = view ?: return
        v.findViewById<TextView>(R.id.tvF16FY)?.apply { text = "FY ${d.financialYear}  |  AY ${d.assessmentYear}"; setTextColor(Color.parseColor("#2E7D32")) }
        v.findViewById<TextView>(R.id.tvF16EmpName)?.text  = d.employee.name
        v.findViewById<TextView>(R.id.tvF16EmpCode)?.text  = "Code: ${d.employee.code}"
        v.findViewById<TextView>(R.id.tvF16Pan)?.apply { text = "PAN: ${d.employee.pan ?: "NOT PROVIDED"}"; setTextColor(if (d.employee.pan.isNullOrBlank()) Color.parseColor("#E53935") else Color.parseColor("#212121")) }
        v.findViewById<TextView>(R.id.tvF16Uan)?.text  = "UAN: ${d.employee.uan ?: "—"}"
        v.findViewById<TextView>(R.id.tvF16PfNo)?.text = "PF No: ${d.employee.pfNumber ?: "—"}"
        v.findViewById<TextView>(R.id.tvF16Dept)?.text = "${d.employee.department ?: "—"}  ·  ${d.employee.designation ?: "—"}"
        v.findViewById<TextView>(R.id.tvF16Employer)?.text = d.partA.employerName
        v.findViewById<TextView>(R.id.tvF16TAN)?.text = "TAN: ${d.partA.employerTan}"

        containerA.removeAllViews()
        val qGrid = LinearLayout(requireContext()).apply { orientation = LinearLayout.HORIZONTAL; layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = 12 } }
        d.partA.quarterSummary.forEach { q ->
            val qBox = LinearLayout(requireContext()).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.parseColor("#F3F8F0")); setPadding(12,12,12,12); layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = 6 } }
            qBox.addView(TextView(requireContext()).apply { text = q.quarter; textSize = 11f; setTypeface(typeface, Typeface.BOLD); setTextColor(Color.parseColor("#2E7D32")); layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = 6 } })
            qBox.addView(makeQRow("Deducted", money(q.tdsDeducted))); qBox.addView(makeQRow("Deposited", money(q.tdsDeposited))); qGrid.addView(qBox)
        }
        containerA.addView(qGrid)
        val totRow = LinearLayout(requireContext()).apply { orientation = LinearLayout.HORIZONTAL; setBackgroundColor(Color.parseColor("#E8F5E9")); setPadding(16,12,16,12) }
        totRow.addView(TextView(requireContext()).apply { text = "Total TDS Deducted & Deposited"; textSize = 13f; setTypeface(typeface, Typeface.BOLD); setTextColor(Color.parseColor("#1B5E20")); layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f) })
        totRow.addView(TextView(requireContext()).apply { text = money(d.partA.totalTdsDeducted); textSize = 14f; setTypeface(typeface, Typeface.BOLD); setTextColor(Color.parseColor("#1B5E20")) })
        containerA.addView(totRow)

        containerB.removeAllViews()
        addSectionHeader(containerB, "1. Gross Salary")
        addRow(containerB, "(a) Basic Salary", money(d.partB.basic)); addRow(containerB, "(b) HRA", money(d.partB.hra))
        addRow(containerB, "(c) Conveyance Allowance", money(d.partB.conveyance)); addRow(containerB, "(d) Special Allowance", money(d.partB.specialAllowance))
        addRow(containerB, "Total Gross Salary", money(d.partB.grossSalary), isTotal = true)
        addSectionHeader(containerB, "2. Less: Deductions u/s 16")
        addRow(containerB, "Standard Deduction u/s 16(ia)", "- ${money(d.partB.standardDeduction)}")
        addRow(containerB, "Income Chargeable under \"Salaries\"", money(d.partB.incomeChargeable), isTotal = true)
        addSectionHeader(containerB, "3. Deductions under Chapter VI-A")
        addRow(containerB, "Section 80C — PF Contribution", "- ${money(d.partB.sec80cPf)}")
        addRow(containerB, "Total Deductions (Chapter VI-A)", "- ${money(d.partB.totalDeductionsViA)}", isTotal = true)
        val netRow = LinearLayout(requireContext()).apply { orientation = LinearLayout.HORIZONTAL; setBackgroundColor(Color.parseColor("#FFF8E1")); setPadding(8,12,8,12) }
        netRow.addView(TextView(requireContext()).apply { text = "Net Taxable Income"; textSize = 14f; setTypeface(typeface, Typeface.BOLD); setTextColor(Color.parseColor("#E65100")); layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f) })
        netRow.addView(TextView(requireContext()).apply { text = money(d.partB.netTaxableIncome); textSize = 15f; setTypeface(typeface, Typeface.BOLD); setTextColor(Color.parseColor("#E65100")) })
        containerB.addView(netRow); containerB.addView(divider())
        addSectionHeader(containerB, "4. Tax Deducted at Source (TDS)"); addRow(containerB, "Total TDS Deducted on Salary", money(d.partB.totalTds), isTotal = true)
        addSectionHeader(containerB, "5. Statutory Deductions (For Reference)")
        addRow(containerB, "PF Employee Contribution", money(d.partB.pfEmployeeTotal)); addRow(containerB, "PF Employer Contribution", money(d.partB.pfEmployerTotal))
        addRow(containerB, "ESI Employee Contribution", money(d.partB.esiEmployeeTotal)); addRow(containerB, "Professional Tax", money(d.partB.professionalTaxTotal))
        addRow(containerB, "Labour Welfare Fund (LWF)", money(d.partB.lwfTotal)); addRow(containerB, "Net Salary Paid (Annual)", money(d.partB.netSalaryTotal), isTotal = true)

        containerM.removeAllViews(); addMonthHeader(containerM)
        var tB=0.0;var tH=0.0;var tG=0.0;var tP=0.0;var tE=0.0;var tPt=0.0;var tT=0.0;var tN=0.0
        d.monthlyBreakdown.forEach { mo ->
            addMonthRow(containerM, "${mo.month} ${mo.year}", mo.basic, mo.hra, mo.gross, mo.pfEmployee, mo.esiEmployee, mo.professionalTax, mo.tds, mo.netSalary)
            tB+=mo.basic;tH+=mo.hra;tG+=mo.gross;tP+=mo.pfEmployee;tE+=mo.esiEmployee;tPt+=mo.professionalTax;tT+=mo.tds;tN+=mo.netSalary
        }
        addMonthRow(containerM, "TOTAL", tB, tH, tG, tP, tE, tPt, tT, tN, isTotal = true)
    }

    private fun makeQRow(label: String, value: String): LinearLayout {
        val row = LinearLayout(requireContext()).apply { orientation = LinearLayout.HORIZONTAL; layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = 2 } }
        row.addView(TextView(requireContext()).apply { text = label; textSize = 11f; setTextColor(Color.parseColor("#616161")); layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f) })
        row.addView(TextView(requireContext()).apply { text = value; textSize = 11f; setTextColor(Color.parseColor("#212121")) }); return row
    }
    private fun addSectionHeader(container: LinearLayout, title: String) {
        container.addView(TextView(requireContext()).apply { text = title; setTextColor(Color.parseColor("#2E7D32")); textSize = 12f; typeface = Typeface.DEFAULT_BOLD; setBackgroundColor(Color.parseColor("#F9FBE7")); setPadding(8,12,8,8); layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = 8 } })
        container.addView(divider("#C8E6C9"))
    }
    private fun addRow(container: LinearLayout, label: String, value: String, isTotal: Boolean = false) {
        val row = LinearLayout(requireContext()).apply { orientation = LinearLayout.HORIZONTAL; setPadding(8,10,8,10); if (isTotal) setBackgroundColor(Color.parseColor("#E8F5E9")) }
        row.addView(TextView(requireContext()).apply { text = label; textSize = 13f; layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f); if (isTotal) setTypeface(typeface, Typeface.BOLD); setTextColor(Color.parseColor("#424242")) })
        row.addView(TextView(requireContext()).apply { text = value; textSize = 13f; typeface = if (isTotal) Typeface.DEFAULT_BOLD else Typeface.DEFAULT; setTextColor(if (isTotal) Color.parseColor("#1B5E20") else Color.parseColor("#212121")) })
        container.addView(row); container.addView(divider())
    }
    private fun divider(color: String = "#F1F8E9"): View = View(requireContext()).apply { layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 1); setBackgroundColor(Color.parseColor(color)) }
    private fun addMonthHeader(container: LinearLayout) {
        val row = LinearLayout(requireContext()).apply { orientation = LinearLayout.HORIZONTAL; setPadding(4,10,4,10); setBackgroundColor(Color.parseColor("#E8F5E9")) }
        listOf("Month","Basic","HRA","Gross","PF","ESI","PT","TDS","Net").forEach { h ->
            row.addView(TextView(requireContext()).apply { text = h; textSize = 10f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.parseColor("#2E7D32")); layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f); gravity = if (h == "Month") android.view.Gravity.START else android.view.Gravity.END })
        }; container.addView(row)
    }
    private fun addMonthRow(container: LinearLayout, month: String, basic: Double, hra: Double, gross: Double, pf: Double, esi: Double, pt: Double, tds: Double, net: Double, isTotal: Boolean = false) {
        val row = LinearLayout(requireContext()).apply { orientation = LinearLayout.HORIZONTAL; setPadding(4,8,4,8); if (isTotal) setBackgroundColor(Color.parseColor("#E8F5E9")) }
        val bold = if (isTotal) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
        listOf(month, money(basic), money(hra), money(gross), money(pf), money(esi), money(pt), money(tds), money(net)).forEachIndexed { i, v ->
            row.addView(TextView(requireContext()).apply { text = v; textSize = 10f; typeface = bold; setTextColor(when { isTotal && i == 8 -> Color.parseColor("#1B5E20"); i == 7 -> Color.parseColor("#C62828"); else -> Color.parseColor("#212121") }); layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f); gravity = if (i == 0) android.view.Gravity.START else android.view.Gravity.END })
        }; container.addView(row); container.addView(divider())
    }

    // ── PDF — pixel-perfect match with web ───────────────────────────────────

    private fun downloadForm16AsPdf(d: Form16Data, fy: String) {
        val ctx = context ?: return
        Toast.makeText(ctx, "Opening print dialog — choose Save as PDF…", Toast.LENGTH_LONG).show()
        val html = buildForm16Html(d, fy)
        val webView = WebView(ctx)
        webView.settings.javaScriptEnabled = false
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                try {
                    val printManager = ctx.getSystemService(Context.PRINT_SERVICE) as PrintManager
                    val jobName = "Form16_${d.employee.name.replace(" ", "_")}_$fy"
                    val attrs = PrintAttributes.Builder()
                        .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                        .setResolution(PrintAttributes.Resolution("pdf", "pdf", 300, 300))
                        .setMinMargins(PrintAttributes.Margins(24000, 24000, 24000, 24000))
                        .build()
                    printManager.print(jobName, webView.createPrintDocumentAdapter(jobName), attrs)
                } catch (e: Exception) {
                    Toast.makeText(ctx, "PDF error: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
        webView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null)
    }

    private fun buildForm16Html(d: Form16Data, fy: String): String {
        val m = { v: Double -> "₹${"%.0f".format(v).reversed().chunked(3).joinToString(",").reversed()}" }
        val B = d.partB; val emp = d.employee; val A = d.partA
        val logoB64 = "data:image/jpeg;base64,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"
        val panColor = if (emp.pan.isNullOrBlank()) "#e53935" else "#1a1a1a"

        val quarterRows = A.quarterSummary.joinToString("") { q ->
            """<div class="qb"><div class="qt">${q.quarter}</div>
               <div class="qr"><span>TDS Deducted</span><span>${m(q.tdsDeducted)}</span></div>
               <div class="qr"><span>TDS Deposited</span><span>${m(q.tdsDeposited)}</span></div></div>"""
        }
        val monthRows = d.monthlyBreakdown.joinToString("") { mo ->
            "<tr><td>${mo.month} ${mo.year}</td><td>${m(mo.basic)}</td><td>${m(mo.hra)}</td>" +
                    "<td style=\"font-weight:600\">${m(mo.gross)}</td><td>${m(mo.pfEmployee)}</td><td>${m(mo.esiEmployee)}</td>" +
                    "<td>${m(mo.professionalTax)}</td><td style=\"color:#c62828\">${m(mo.tds)}</td>" +
                    "<td style=\"font-weight:700;color:#1b5e20\">${m(mo.netSalary)}</td></tr>"
        }
        var tB=0.0;var tH=0.0;var tG=0.0;var tP=0.0;var tE=0.0;var tPt=0.0;var tT=0.0;var tN=0.0
        d.monthlyBreakdown.forEach { mo -> tB+=mo.basic;tH+=mo.hra;tG+=mo.gross;tP+=mo.pfEmployee;tE+=mo.esiEmployee;tPt+=mo.professionalTax;tT+=mo.tds;tN+=mo.netSalary }

        return """<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#333;background:#fff}
.hw{display:flex;align-items:stretch;background:#f3f8f0;border-bottom:2px solid #c8e6c9}
.la{display:flex;align-items:center;padding:16px 14px 16px 18px;flex-shrink:0}
.la img{width:72px;height:72px;object-fit:contain;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.15)}
.dv{width:1.5px;background:#c8e6c9;margin:14px 0;flex-shrink:0}
.ca{flex:1;padding:14px 16px;display:flex;flex-direction:column;justify-content:center}
.cn{font-size:15px;font-weight:800;color:#1B5E20;margin-bottom:6px}.ct{font-size:11px;color:#444;margin-bottom:4px}
.cad{font-size:10.5px;color:#555;line-height:1.5;margin-bottom:4px}.cw{font-size:10.5px;color:#555}
.fb{background:linear-gradient(145deg,#1B5E20,#2E7D32);min-width:150px;flex-shrink:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px 20px;clip-path:polygon(18% 0%,100% 0%,100% 100%,0% 100%)}
.ft{font-size:28px;font-weight:900;color:#fff;letter-spacing:2px;text-align:center}
.fyp{margin-top:10px;background:rgba(255,255,255,.15);border:1.5px solid rgba(255,255,255,.4);border-radius:20px;padding:3px 14px}
.fyp span{font-size:11.5px;font-weight:700;color:#fff}
.cb{display:flex;align-items:center;padding:10px 18px;gap:12px;border-bottom:1.5px solid #e8f5e9}
.ci{width:38px;height:38px;background:#f3f8f0;border-radius:50%;display:flex;align-items:center;justify-content:center;border:1.5px solid #c8e6c9;font-size:17px;flex-shrink:0;text-align:center;line-height:38px}
.ctit{font-size:13px;font-weight:700;color:#1B5E20}.csub{font-size:11px;color:#555;margin-top:2px}.csub2{font-size:10px;color:#888;margin-top:1px}
.eg{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid #c8e6c9}
.ec{padding:14px 18px}.ec:first-child{border-right:1px solid #c8e6c9}
.ec h4{font-size:10px;font-weight:700;color:#2E7D32;margin-bottom:10px;text-transform:uppercase;letter-spacing:1px}
.ec table{width:100%;border-collapse:collapse;font-size:11.5px}.ec td{padding:3px 0;vertical-align:top}
.ec td:first-child{color:#777;width:115px}.ec td:last-child{font-weight:600}
.sec{border:1px solid #c8e6c9;border-radius:8px;margin:12px 16px;overflow:hidden}
.st{padding:9px 14px;font-size:13px;font-weight:700;color:#fff}.st.g{background:#2E7D32}.st.b{background:#1565C0}.st.p{background:#6A1B9A}
.subt{background:#f9fbe7;color:#2E7D32;padding:6px 14px;font-size:11.5px;font-weight:700;border-top:1px solid #c8e6c9}
.qg{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:14px}
.qb{background:#f3f8f0;border-radius:6px;padding:12px}.qt{font-size:12px;font-weight:700;color:#2E7D32;margin-bottom:8px}
.qr{display:flex;justify-content:space-between;font-size:11px;color:#555;margin-bottom:3px}
.tr2{display:flex;justify-content:space-between;align-items:center;background:#e8f5e9;border-radius:6px;padding:10px 16px;margin:0 14px 14px}
.tr2 span:first-child{font-weight:700;color:#1B5E20;font-size:14px}.tr2 span:last-child{font-weight:800;color:#1B5E20;font-size:16px}
table.d{width:100%;border-collapse:collapse;font-size:12px}table.d td{padding:8px 14px;border-bottom:1px solid #f1f8e9}
table.d td:last-child{text-align:right}table.d tr.tot td{background:#e8f5e9;font-weight:700;color:#1B5E20}
table.d tr.net td{background:#fff8e1;font-weight:700;color:#e65100;font-size:14px}
table.mo{width:100%;border-collapse:collapse;font-size:10.5px}
table.mo th{background:#e8f5e9;color:#2E7D32;font-weight:700;padding:7px 10px;text-align:right}
table.mo th:first-child{text-align:left}table.mo td{padding:5px 10px;border-bottom:1px solid #f1f8e9;text-align:right}
table.mo td:first-child{text-align:left}table.mo tr.tot td{background:#e8f5e9;font-weight:700}
.ftr{margin:16px;font-size:10px;color:#999;text-align:center;padding-top:10px;border-top:1px solid #e0e0e0}
</style></head><body>
<div class="hw">
  <div class="la"><img src="${logoB64}" alt="Logo"></div>
  <div class="dv"></div>
  <div class="ca">
    <div class="cn">${A.employerName}</div>
    <div class="ct">TAN: <strong style="color:#2E7D32">${A.employerTan}</strong></div>
    <div class="cad">Office No. 617, 6th Floor, Hubtown Viva, Western Express Highway, Shankarwadi, Jogeshwari (East), Mumbai – 400060</div>
    <div class="cw">hr@krishicare.in | www.krishicare.in</div>
  </div>
  <div class="fb"><div class="ft">FORM<br>16</div><div class="fyp"><span>FY ${fy}</span></div></div>
</div>
<div class="cb">
  <div class="ci">📋</div>
  <div>
    <div class="ctit">Certificate of Tax Deducted at Source on Salary</div>
    <div class="csub">Assessment Year <strong>${d.assessmentYear}</strong></div>
    <div class="csub2">[As per Section 203 of Income Tax Act, 1961]</div>
  </div>
</div>
<div class="eg">
  <div class="ec"><h4>Employee Details</h4>
    <table>
      <tr><td>Name</td><td>${emp.name}</td></tr>
      <tr><td>Employee Code</td><td>${emp.code}</td></tr>
      <tr><td>PAN</td><td style="color:${panColor}">${emp.pan ?: "NOT PROVIDED"}</td></tr>
      <tr><td>UAN</td><td>${emp.uan ?: "—"}</td></tr>
      <tr><td>PF Number</td><td>${emp.pfNumber ?: "—"}</td></tr>
      <tr><td>Department</td><td>${emp.department ?: "—"}</td></tr>
      <tr><td>Designation</td><td>${emp.designation ?: "—"}</td></tr>
    </table>
  </div>
  <div class="ec"><h4>Employer Details</h4>
    <table>
      <tr><td>Name</td><td>${A.employerName}</td></tr>
      <tr><td>TAN</td><td>${A.employerTan}</td></tr>
      <tr><td>Address</td><td style="font-size:10.5px">Office No. 617, 6th Floor, Hubtown Viva, Western Express Highway, Shankarwadi, Jogeshwari (East), Mumbai – 400060</td></tr>
      <tr><td>Financial Year</td><td>FY ${fy}</td></tr>
      <tr><td>Assessment Year</td><td>${d.assessmentYear}</td></tr>
    </table>
  </div>
</div>
<div class="sec">
  <div class="st g">📋 Part A — Details of Tax Deducted and Deposited in Central Government Account</div>
  <div class="qg">${quarterRows}</div>
  <div class="tr2"><span>Total TDS Deducted &amp; Deposited</span><span>${m(A.totalTdsDeducted)}</span></div>
</div>
<div class="sec">
  <div class="st b">📑 Part B — Details of Salary Paid and Any Other Income and Tax Deducted</div>
  <div class="subt">1. Gross Salary</div>
  <table class="d"><tr><td>(a) Basic Salary</td><td>${m(B.basic)}</td></tr><tr><td>(b) House Rent Allowance (HRA)</td><td>${m(B.hra)}</td></tr><tr><td>(c) Conveyance Allowance</td><td>${m(B.conveyance)}</td></tr><tr><td>(d) Special Allowance</td><td>${m(B.specialAllowance)}</td></tr><tr class="tot"><td>Total Gross Salary</td><td>${m(B.grossSalary)}</td></tr></table>
  <div class="subt">2. Less: Deduction u/s 16</div>
  <table class="d"><tr><td>Standard Deduction u/s 16(ia)</td><td>- ${m(B.standardDeduction)}</td></tr><tr class="tot"><td>Income Chargeable under Head "Salaries"</td><td>${m(B.incomeChargeable)}</td></tr></table>
  <div class="subt">3. Deductions under Chapter VI-A</div>
  <table class="d"><tr><td>Section 80C — PF Employee Contribution</td><td>- ${m(B.sec80cPf)}</td></tr><tr class="tot"><td>Total Deductions (Chapter VI-A)</td><td>- ${m(B.totalDeductionsViA)}</td></tr></table>
  <table class="d"><tr class="net"><td>Net Taxable Income</td><td>${m(B.netTaxableIncome)}</td></tr></table>
  <div class="subt">4. Tax Deducted at Source (TDS)</div>
  <table class="d"><tr class="tot"><td>Total TDS Deducted on Salary</td><td>${m(B.totalTds)}</td></tr></table>
  <div class="subt">5. Statutory Deductions (For Reference)</div>
  <table class="d">
    <tr><td>PF Employee Contribution</td><td>${m(B.pfEmployeeTotal)}</td></tr>
    <tr><td>PF Employer Contribution</td><td>${m(B.pfEmployerTotal)}</td></tr>
    <tr><td>ESI Employee Contribution</td><td>${m(B.esiEmployeeTotal)}</td></tr>
    <tr><td>Professional Tax</td><td>${m(B.professionalTaxTotal)}</td></tr>
    <tr><td>Labour Welfare Fund (LWF)</td><td>${m(B.lwfTotal)}</td></tr>
    <tr class="tot"><td>Net Salary Paid (Annual)</td><td>${m(B.netSalaryTotal)}</td></tr>
  </table>
</div>
<div class="sec">
  <div class="st p">📅 Monthly Salary Breakdown — FY ${fy}</div>
  <div style="overflow-x:auto"><table class="mo">
    <thead><tr><th>Month</th><th>Basic</th><th>HRA</th><th>Gross</th><th>PF(Emp)</th><th>ESI</th><th>PT</th><th>TDS</th><th>Net Salary</th></tr></thead>
    <tbody>${monthRows}<tr class="tot"><td>TOTAL</td><td>${m(tB)}</td><td>${m(tH)}</td><td>${m(tG)}</td><td>${m(tP)}</td><td>${m(tE)}</td><td>${m(tPt)}</td><td style="color:#c62828">${m(tT)}</td><td style="color:#1b5e20">${m(tN)}</td></tr></tbody>
  </table></div>
</div>
<div class="ftr">${AndroidMain.PDF_FOOTER_PREFIX} &nbsp;·&nbsp; ${emp.name} &nbsp;·&nbsp; FY ${fy}</div>
</body></html>"""
    }
}