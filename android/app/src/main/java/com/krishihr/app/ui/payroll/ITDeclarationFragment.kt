package com.krishihr.app.ui.payroll
import com.krishihr.app.AndroidMain

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.*
import android.widget.*
import androidx.activity.result.contract.ActivityResultContracts
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.krishihr.app.R
import com.krishihr.app.data.api.RetrofitClient
import com.krishihr.app.data.models.*
import com.krishihr.app.utils.Roles
import com.krishihr.app.utils.SessionManager
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.FileOutputStream
import java.text.NumberFormat
import java.util.*

class ITDeclarationFragment : Fragment() {

    private val api get() = RetrofitClient.instance
    private val fmtMoney = NumberFormat.getCurrencyInstance(Locale("en", "IN")).apply { maximumFractionDigits = 0 }
    private fun money(v: Double) = fmtMoney.format(v)

    private var currentDeclId: Int? = null
    private var currentFY = "2025-26"
    private val fyOptions = listOf("2024-25", "2025-26", "2026-27")

    private lateinit var session: SessionManager
    private lateinit var userRole: String

    private val isHROrAccounts get() = userRole in setOf(Roles.HR, Roles.ACCOUNTS)

    private var pendingUploadSection: String = ""
    private var pendingUploadSectionLabel: String = ""

    private val pickFileLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            result.data?.data?.let { uri -> uploadProofFile(uri) }
        }
    }

    private var hrDeclarations: List<ITDeclarationSummary> = emptyList()

    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View =
        i.inflate(R.layout.fragment_it_declaration, c, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        session = SessionManager(requireContext())
        userRole = session.getRole()

        val spinnerFY = view.findViewById<Spinner>(R.id.spinnerITFY)
        val btnSave   = view.findViewById<Button>(R.id.btnSaveDraft)
        val btnSubmit = view.findViewById<Button>(R.id.btnSubmitDecl)
        val tabLayout = view.findViewById<com.google.android.material.tabs.TabLayout>(R.id.tabsITDecl)

        spinnerFY.adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_dropdown_item, fyOptions)
        spinnerFY.setSelection(fyOptions.indexOf("2025-26").takeIf { it >= 0 } ?: 0)
        spinnerFY.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onNothingSelected(p: AdapterView<*>?) {}
            override fun onItemSelected(p: AdapterView<*>?, v: View?, pos: Int, id: Long) {
                currentFY = fyOptions[pos]
                loadDeclaration()
            }
        }

        tabLayout?.removeAllTabs()
        tabLayout?.addTab(tabLayout.newTab().setText("📋 Declaration"))
        tabLayout?.addTab(tabLayout.newTab().setText("📎 Upload Proof"))
        tabLayout?.addTab(tabLayout.newTab().setText("📊 Tax Calculator"))
        if (isHROrAccounts) {
            tabLayout?.addTab(tabLayout.newTab().setText("🧑‍💼 HR Review"))
        }

        tabLayout?.addOnTabSelectedListener(object : com.google.android.material.tabs.TabLayout.OnTabSelectedListener {
            override fun onTabSelected(tab: com.google.android.material.tabs.TabLayout.Tab?) {
                when (tab?.position) {
                    0 -> showPane(view, "declaration")
                    1 -> { showPane(view, "proof"); renderProofSections() }
                    2 -> { showPane(view, "tax"); loadTaxPreview() }
                    3 -> { showPane(view, "hr"); loadHRReview() }
                }
            }
            override fun onTabUnselected(tab: com.google.android.material.tabs.TabLayout.Tab?) {}
            override fun onTabReselected(tab: com.google.android.material.tabs.TabLayout.Tab?) {}
        })

        btnSave.setOnClickListener   { saveDeclaration("save") }
        btnSubmit.setOnClickListener { saveDeclaration("submit") }

        view.findViewById<Button>(R.id.btnRefreshHR)?.setOnClickListener { loadHRReview() }
        view.findViewById<Spinner>(R.id.spinnerHRStatus)?.apply {
            adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_dropdown_item,
                listOf("All", "submitted", "approved", "rejected", "draft"))
            onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
                override fun onNothingSelected(p: AdapterView<*>?) {}
                override fun onItemSelected(p: AdapterView<*>?, v: View?, pos: Int, id: Long) {
                    loadHRReview()
                }
            }
        }

        loadDeclaration()
    }

    // ── Pane switching ────────────────────────────────────────────────────────

    private fun showPane(view: View, pane: String) {
        view.findViewById<View>(R.id.paneDeclaration)?.visibility = if (pane == "declaration") View.VISIBLE else View.GONE
        view.findViewById<View>(R.id.paneProof)?.visibility       = if (pane == "proof") View.VISIBLE else View.GONE
        view.findViewById<View>(R.id.paneTax)?.visibility         = if (pane == "tax") View.VISIBLE else View.GONE
        view.findViewById<View>(R.id.paneHR)?.visibility          = if (pane == "hr") View.VISIBLE else View.GONE
    }

    // ── Declaration load/save ─────────────────────────────────────────────────

    private fun loadDeclaration() {
        lifecycleScope.launch {
            val resp = try { api.getITDeclaration(currentFY) } catch (e: Exception) { null }
            val d = resp?.body()?.data
            if (d != null) {
                currentDeclId = d.id
                populateForm(d)
                updateStatusBadge(d.status, d.hrComment)
            } else {
                currentDeclId = null
                updateStatusBadge("new", null)
            }
        }
    }

    private fun populateForm(d: ITDeclaration) {
        val v = view ?: return
        setNumField(v, R.id.etRent,        d.rentPaidMonthly)
        setTxtField(v, R.id.etLandlord,    d.landlordName ?: "")
        setTxtField(v, R.id.etLandlordPan, d.landlordPan ?: "")
        setNumField(v, R.id.et80cPf,       d.sec80cPf)
        setNumField(v, R.id.et80cPpf,      d.sec80cPpf)
        setNumField(v, R.id.et80cLic,      d.sec80cLic)
        setNumField(v, R.id.et80cElss,     d.sec80cElss)
        setNumField(v, R.id.et80cNsc,      d.sec80cNsc)
        setNumField(v, R.id.et80cHomeLoan, d.sec80cHomeLoan)
        setNumField(v, R.id.et80cTuition,  d.sec80cTuition)
        setNumField(v, R.id.et80cOther,    d.sec80cOther)
        setNumField(v, R.id.et80dSelf,     d.sec80dSelf)
        setNumField(v, R.id.et80dParents,  d.sec80dParents)
        setNumField(v, R.id.et80eEduLoan,  d.sec80eEduLoan)
        setNumField(v, R.id.et24bHomeLoan, d.sec24bHomeLoan)
        setNumField(v, R.id.et80gDonation, d.sec80gDonation)
        setNumField(v, R.id.et80ccdNps,    d.sec80ccdNps)
        val rg = v.findViewById<RadioGroup>(R.id.rgRegime)
        if (d.regime == "new") rg?.check(R.id.rbNew) else rg?.check(R.id.rbOld)
        updateSummary()
    }

    private fun setNumField(view: View, id: Int, value: Double) {
        view.findViewById<EditText>(id)?.setText(if (value > 0) value.toInt().toString() else "")
    }

    private fun setTxtField(view: View, id: Int, value: String) {
        view.findViewById<EditText>(id)?.setText(value)
    }

    private fun getDouble(id: Int): Double =
        view?.findViewById<EditText>(id)?.text?.toString()?.toDoubleOrNull() ?: 0.0

    private fun getStr(id: Int): String =
        view?.findViewById<EditText>(id)?.text?.toString()?.trim() ?: ""

    private fun updateSummary() {
        val c80c = minOf(
            getDouble(R.id.et80cPf) + getDouble(R.id.et80cPpf) + getDouble(R.id.et80cLic) +
                    getDouble(R.id.et80cElss) + getDouble(R.id.et80cNsc) + getDouble(R.id.et80cHomeLoan) +
                    getDouble(R.id.et80cTuition) + getDouble(R.id.et80cOther), 150000.0
        )
        val other = minOf(getDouble(R.id.et80dSelf), 25000.0) +
                minOf(getDouble(R.id.et80dParents), 50000.0) +
                getDouble(R.id.et80eEduLoan) +
                minOf(getDouble(R.id.et24bHomeLoan), 200000.0) +
                getDouble(R.id.et80gDonation) +
                minOf(getDouble(R.id.et80ccdNps), 50000.0)
        view?.findViewById<TextView>(R.id.tvTotal80c)?.text = "80C: ${money(c80c)}"
        view?.findViewById<TextView>(R.id.tvTotalDeductions)?.text = "Total Savings: ${money(c80c + other)}"
    }

    private fun updateStatusBadge(status: String, hrComment: String?) {
        val v = view ?: return
        val tvStatus = v.findViewById<TextView>(R.id.tvDeclStatus) ?: return
        tvStatus.text = status.uppercase()
        val (bgColor, textColor) = when (status) {
            "approved"  -> "#E8F5E9" to "#1B5E20"
            "submitted" -> "#E3F2FD" to "#1565C0"
            "rejected"  -> "#FFEBEE" to "#C62828"
            "draft"     -> "#FFF8E1" to "#E65100"
            else        -> "#F5F5F5" to "#757575"
        }
        tvStatus.setBackgroundColor(Color.parseColor(bgColor))
        tvStatus.setTextColor(Color.parseColor(textColor))
        val tvHr = v.findViewById<TextView>(R.id.tvHrComment)
        if (!hrComment.isNullOrBlank()) {
            tvHr?.visibility = View.VISIBLE; tvHr?.text = "HR: $hrComment"
        } else { tvHr?.visibility = View.GONE }
    }

    private fun saveDeclaration(action: String) {
        val v = view ?: return
        val regime = if (v.findViewById<RadioButton>(R.id.rbNew)?.isChecked == true) "new" else "old"
        val body: Map<String, Any?> = mapOf(
            "financial_year"    to currentFY,
            "regime"            to regime,
            "action"            to action,
            "rent_paid_monthly" to getDouble(R.id.etRent),
            "landlord_name"     to getStr(R.id.etLandlord),
            "landlord_pan"      to getStr(R.id.etLandlordPan).uppercase(),
            "sec80c_pf"         to getDouble(R.id.et80cPf),
            "sec80c_ppf"        to getDouble(R.id.et80cPpf),
            "sec80c_lic"        to getDouble(R.id.et80cLic),
            "sec80c_elss"       to getDouble(R.id.et80cElss),
            "sec80c_nsc"        to getDouble(R.id.et80cNsc),
            "sec80c_home_loan"  to getDouble(R.id.et80cHomeLoan),
            "sec80c_tuition"    to getDouble(R.id.et80cTuition),
            "sec80c_other"      to getDouble(R.id.et80cOther),
            "sec80d_self"       to getDouble(R.id.et80dSelf),
            "sec80d_parents"    to getDouble(R.id.et80dParents),
            "sec80e_edu_loan"   to getDouble(R.id.et80eEduLoan),
            "sec24b_home_loan"  to getDouble(R.id.et24bHomeLoan),
            "sec80g_donation"   to getDouble(R.id.et80gDonation),
            "sec80ccd_nps"      to getDouble(R.id.et80ccdNps)
        )
        lifecycleScope.launch {
            val resp = try { api.saveITDeclaration(body) } catch (e: Exception) { null }
            val msg = resp?.body()?.message ?: "Failed to save"
            Toast.makeText(context, msg, Toast.LENGTH_SHORT).show()
            if (resp?.body()?.success == true) {
                currentDeclId = resp.body()?.data?.id
                updateStatusBadge(resp.body()?.data?.status ?: "draft", null)
            }
        }
    }

    // ── Tax Preview ───────────────────────────────────────────────────────────

    private fun loadTaxPreview() {
        val tvOld   = view?.findViewById<TextView>(R.id.tvOldRegimeTax) ?: return
        val tvNew   = view?.findViewById<TextView>(R.id.tvNewRegimeTax) ?: return
        val tvRec   = view?.findViewById<TextView>(R.id.tvRecommended)
        val tvBreak = view?.findViewById<TextView>(R.id.tvTaxBreakdown)
        tvOld.text = "Calculating…"; tvNew.text = "Calculating…"

        lifecycleScope.launch {
            val resp = try { api.getTaxPreview(currentFY) } catch (e: Exception) { null }
            val d = resp?.body()?.data
            if (d == null) {
                tvOld.text = "N/A"; tvNew.text = "N/A"
                Toast.makeText(context, resp?.body()?.message ?: "Could not calculate tax", Toast.LENGTH_SHORT).show()
                return@launch
            }
            tvOld.text = "${money(d.oldRegime.tax)}\n(${money(d.oldRegime.monthlyTds)}/mo TDS)"
            tvNew.text = "${money(d.newRegime.tax)}\n(${money(d.newRegime.monthlyTds)}/mo TDS)"
            val saving = Math.abs(d.oldRegime.tax - d.newRegime.tax)
            tvRec?.text = "✅ ${d.recommended.uppercase()} REGIME saves you ${money(saving)}"
            tvRec?.setTextColor(Color.parseColor("#1B5E20"))
            tvBreak?.text = buildString {
                appendLine("Annual Gross:         ${money(d.annualGross)}")
                appendLine("Std Deduction:      - ${money(d.stdDeduction)}")
                appendLine("HRA Exemption:      - ${money(d.hraExemption)}")
                appendLine("VI-A Deductions:    - ${money(d.totalViA)}")
                appendLine("──────────────────────────────")
                appendLine("Old Taxable Income:   ${money(d.oldRegime.taxableIncome)}")
                appendLine("Old Tax (+ 4% cess):  ${money(d.oldRegime.tax)}")
                appendLine("──────────────────────────────")
                appendLine("New Taxable Income:   ${money(d.newRegime.taxableIncome)}")
                append(    "New Tax (+ 4% cess):  ${money(d.newRegime.tax)}")
            }
        }
    }

    // ── Upload Proof ──────────────────────────────────────────────────────────

    private fun renderProofSections() {
        val v = view ?: return
        val container = v.findViewById<LinearLayout>(R.id.llProofContainer) ?: return
        container.removeAllViews()

        val declId = currentDeclId
        if (declId == null) {
            val tvInfo = v.findViewById<TextView>(R.id.tvProofInfo)
            tvInfo?.text = "⚠️ Please save or submit your declaration first before uploading proofs."
            tvInfo?.setBackgroundColor(Color.parseColor("#FFF3E0"))
            tvInfo?.setTextColor(Color.parseColor("#E65100"))
            return
        }

        lifecycleScope.launch {
            val resp = try { api.getITDeclaration(currentFY) } catch (e: Exception) { null }
            val d = resp?.body()?.data ?: return@launch
            val proofs = d.proofDocuments ?: emptyList()

            val sections = listOf(
                "hra"       to "🏠 HRA – Rent Receipts / Agreement",
                "80c_pf"    to "💰 80C – PF Statement",
                "80c_ppf"   to "💰 80C – PPF Passbook",
                "80c_lic"   to "💰 80C – LIC Premium Receipt",
                "80c_elss"  to "💰 80C – ELSS / Mutual Fund Statement",
                "80c_other" to "💰 80C – Other Investments",
                "80d"       to "🏥 80D – Medical Insurance Premium",
                "24b"       to "🏦 24(b) – Home Loan Interest Certificate",
                "80e"       to "📚 80E – Education Loan Certificate",
                "80g"       to "🤝 80G – Donation Receipt",
                "nps"       to "📊 NPS – Contribution Statement"
            )

            for ((sectionKey, sectionLabel) in sections) {
                val sectionProofs = proofs.filter { it.section == sectionKey }
                addProofSection(container, declId, sectionKey, sectionLabel, sectionProofs)
            }
        }
    }

    private fun addProofSection(
        container: LinearLayout,
        declId: Int,
        sectionKey: String,
        sectionLabel: String,
        proofs: List<ITProofDoc>
    ) {
        val ctx = context ?: return
        val sectionLayout = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 24, 32, 24)
            setBackgroundColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = 16 }
        }

        val titleRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = 8 }
        }
        val tvTitle = TextView(ctx).apply {
            text = sectionLabel
            textSize = 13f
            setTextColor(Color.parseColor("#2E7D32"))
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val btnUpload = Button(ctx).apply {
            text = if (proofs.isEmpty()) "+ Upload" else "↩ Replace"
            textSize = 12f
            setTextColor(Color.WHITE)
            backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#2E7D32"))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
            setOnClickListener {
                pendingUploadSection = sectionKey
                pendingUploadSectionLabel = sectionLabel
                val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                    type = "*/*"
                    putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/pdf", "image/jpeg", "image/png"))
                }
                pickFileLauncher.launch(intent)
            }
        }
        titleRow.addView(tvTitle)
        titleRow.addView(btnUpload)
        sectionLayout.addView(titleRow)

        if (proofs.isEmpty()) {
            val tvEmpty = TextView(ctx).apply {
                text = "No documents uploaded yet"
                textSize = 12f
                setTextColor(Color.parseColor("#9E9E9E"))
            }
            sectionLayout.addView(tvEmpty)
        } else {
            for (proof in proofs) {
                addProofRow(sectionLayout, proof)
            }
        }

        val wrapper = androidx.cardview.widget.CardView(ctx).apply {
            radius = 24f
            cardElevation = 4f
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = 16 }
            addView(sectionLayout)
        }
        container.addView(wrapper)
    }

    private fun addProofRow(parent: LinearLayout, proof: ITProofDoc) {
        val ctx = context ?: return

        val wrapper = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }

        val row = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            setPadding(0, 8, 0, 4)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }

        val icon = TextView(ctx).apply {
            text = when {
                proof.mimeType?.contains("pdf") == true   -> "📄"
                proof.mimeType?.contains("image") == true -> "🖼️"
                else -> "📎"
            }
            textSize = 18f
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { marginEnd = 8 }
        }

        val tvName = TextView(ctx).apply {
            text = proof.originalName ?: proof.sectionLabel ?: proof.section
            textSize = 12f
            setTextColor(Color.parseColor("#212121"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }

        val (statusBg, statusFg) = when (proof.status) {
            "approved" -> "#E8F5E9" to "#1B5E20"
            "rejected" -> "#FFEBEE" to "#C62828"
            else       -> "#FFF8E1" to "#E65100"
        }
        val tvStatus = TextView(ctx).apply {
            text = proof.status.uppercase()
            textSize = 10f
            setTextColor(Color.parseColor(statusFg))
            setBackgroundColor(Color.parseColor(statusBg))
            setPadding(8, 4, 8, 4)
        }

        row.addView(icon)
        row.addView(tvName)
        row.addView(tvStatus)
        wrapper.addView(row)

        val btnView = Button(ctx).apply {
            text = "👁 View Document"
            textSize = 11f
            setTextColor(Color.parseColor("#1565C0"))
            backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#E3F2FD"))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = 2; bottomMargin = 4 }
            setOnClickListener { openProofDocument(proof) }
        }
        wrapper.addView(btnView)

        if (!proof.hrComment.isNullOrBlank()) {
            val tvComment = TextView(ctx).apply {
                text = "HR: ${proof.hrComment}"
                textSize = 11f
                setTextColor(Color.parseColor("#C62828"))
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply { topMargin = 2 }
            }
            wrapper.addView(tvComment)
        }

        parent.addView(wrapper)
    }

    // ── FIX: openProofDocument ────────────────────────────────────────────────
    //
    // The previous approach used Intent.ACTION_VIEW with an http:// URL containing
    // the token as a query param. Android rejects this because:
    //   1. No browser/app trusts an arbitrary http:// content URL for PDFs/images.
    //   2. Even Chrome won't pass auth headers for an Intent-launched URL.
    //
    // The correct approach:
    //   1. Download the binary via OkHttp with "Authorization: Bearer <token>" header.
    //   2. Save bytes to a cache file.
    //   3. Expose it via FileProvider (content:// URI).
    //   4. Launch Intent.ACTION_VIEW with the content:// URI — this works for any
    //      installed PDF viewer (Drive, Acrobat, Mi File Manager, etc.) or image viewer.
    //
    private fun openProofDocument(proof: ITProofDoc) {
        val ctx = context ?: return
        val token = session.getToken() ?: run {
            Toast.makeText(ctx, "Session expired. Please log in again.", Toast.LENGTH_SHORT).show()
            return
        }

        Toast.makeText(ctx, "Opening document…", Toast.LENGTH_SHORT).show()

        lifecycleScope.launch {
            try {
                // Step 1: Download bytes with auth header using OkHttp directly
                val baseUrl = AndroidMain.BASE_URL.trimEnd('/')
                val url = "$baseUrl/it-declaration/proof/${proof.id}"

                val client = okhttp3.OkHttpClient.Builder()
                    .connectTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
                    .readTimeout(60, java.util.concurrent.TimeUnit.SECONDS)
                    .build()

                val request = okhttp3.Request.Builder()
                    .url(url)
                    .addHeader("Authorization", "Bearer $token")
                    .build()

                val response = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                    client.newCall(request).execute()
                }

                if (!response.isSuccessful) {
                    Toast.makeText(ctx, "Could not load document (${response.code})", Toast.LENGTH_SHORT).show()
                    return@launch
                }

                val bytes = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                    response.body?.bytes()
                } ?: run {
                    Toast.makeText(ctx, "Empty response from server", Toast.LENGTH_SHORT).show()
                    return@launch
                }

                // Step 2: Write to cache file with correct extension
                val ext = when {
                    proof.mimeType?.contains("pdf")  == true -> "pdf"
                    proof.mimeType?.contains("png")  == true -> "png"
                    proof.mimeType?.contains("jpeg") == true -> "jpg"
                    proof.mimeType?.contains("jpg")  == true -> "jpg"
                    else -> "bin"
                }
                val safeFileName = (proof.originalName ?: "document").replace(Regex("[^a-zA-Z0-9._-]"), "_")
                val cacheFile = java.io.File(ctx.cacheDir, "proof_${proof.id}_$safeFileName")

                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                    cacheFile.writeBytes(bytes)
                }

                // Step 3: Get content:// URI via FileProvider
                // Make sure your AndroidManifest.xml has:
                //   <provider android:name="androidx.core.content.FileProvider"
                //             android:authorities="${applicationId}.fileprovider"
                //             android:exported="false" android:grantUriPermissions="true">
                //     <meta-data android:name="android.support.FILE_PROVIDER_PATHS"
                //                android:resource="@xml/file_paths"/>
                //   </provider>
                // And res/xml/file_paths.xml:
                //   <paths><cache-path name="cache" path="."/></paths>
                val contentUri = androidx.core.content.FileProvider.getUriForFile(
                    ctx,
                    "${ctx.packageName}.fileprovider",
                    cacheFile
                )

                // Step 4: Launch viewer
                val mimeType = proof.mimeType ?: "application/octet-stream"
                val intent = android.content.Intent(android.content.Intent.ACTION_VIEW).apply {
                    setDataAndType(contentUri, mimeType)
                    addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                }

                if (intent.resolveActivity(ctx.packageManager) != null) {
                    ctx.startActivity(intent)
                } else {
                    // Fallback: try with generic mime — lets system pick any viewer
                    val fallback = android.content.Intent(android.content.Intent.ACTION_VIEW).apply {
                        setDataAndType(contentUri, "*/*")
                        addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    ctx.startActivity(android.content.Intent.createChooser(fallback, "Open with"))
                }

            } catch (e: Exception) {
                Toast.makeText(ctx, "Could not open document: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun uploadProofFile(uri: Uri) {
        val ctx = context ?: return
        val declId = currentDeclId ?: run {
            Toast.makeText(ctx, "Please save your declaration first", Toast.LENGTH_SHORT).show()
            return
        }

        val fileName = getFileName(uri) ?: "document"
        val mimeType = ctx.contentResolver.getType(uri) ?: "application/octet-stream"
        val tempFile = File(ctx.cacheDir, "upload_${System.currentTimeMillis()}_$fileName")

        try {
            ctx.contentResolver.openInputStream(uri)?.use { input ->
                FileOutputStream(tempFile).use { output -> input.copyTo(output) }
            }
        } catch (e: Exception) {
            Toast.makeText(ctx, "Failed to read file", Toast.LENGTH_SHORT).show()
            return
        }

        Toast.makeText(ctx, "Uploading $fileName…", Toast.LENGTH_SHORT).show()

        lifecycleScope.launch {
            try {
                val filePart = MultipartBody.Part.createFormData(
                    // FIX 1: Field name MUST be "proof_file" — backend multer expects this exact name.
                    // Previously this was "file" which caused "Upload failed" every time.
                    "proof_file",
                    fileName,
                    tempFile.asRequestBody(mimeType.toMediaTypeOrNull())
                )
                val idBody      = declId.toString().toRequestBody("text/plain".toMediaTypeOrNull())
                val secBody     = pendingUploadSection.toRequestBody("text/plain".toMediaTypeOrNull())
                val secLblBody  = pendingUploadSectionLabel.toRequestBody("text/plain".toMediaTypeOrNull())

                val resp = api.uploadITProof(filePart, idBody, secBody, secLblBody)
                val msg = resp.body()?.message ?: if (resp.isSuccessful) "Uploaded!" else "Upload failed"
                Toast.makeText(ctx, msg, Toast.LENGTH_SHORT).show()
                if (resp.isSuccessful) {
                    renderProofSections()
                }
            } catch (e: Exception) {
                Toast.makeText(ctx, "Upload error: ${e.message}", Toast.LENGTH_SHORT).show()
            } finally {
                tempFile.delete()
            }
        }
    }

    private fun getFileName(uri: Uri): String? {
        var name: String? = null
        val cursor = context?.contentResolver?.query(uri, null, null, null, null)
        cursor?.use {
            if (it.moveToFirst()) {
                val idx = it.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (idx != -1) name = it.getString(idx)
            }
        }
        return name ?: uri.lastPathSegment
    }

    // ── HR Review ─────────────────────────────────────────────────────────────

    private fun loadHRReview() {
        if (!isHROrAccounts) return
        val container = view?.findViewById<LinearLayout>(R.id.llHRContainer) ?: return
        container.removeAllViews()

        val spinnerStatus = view?.findViewById<Spinner>(R.id.spinnerHRStatus)
        val statusFilter = spinnerStatus?.selectedItem?.toString()
            ?.takeIf { it != "All" }?.lowercase()

        lifecycleScope.launch {
            val resp = try { api.getAllITDeclarations(currentFY, statusFilter) } catch (e: Exception) { null }
            val list = resp?.body()?.data ?: emptyList()
            hrDeclarations = list

            if (list.isEmpty()) {
                val tv = TextView(requireContext()).apply {
                    text = "No declarations found"
                    textSize = 13f
                    setTextColor(Color.parseColor("#9E9E9E"))
                    gravity = android.view.Gravity.CENTER
                    setPadding(0, 32, 0, 0)
                }
                container.addView(tv)
                return@launch
            }

            for (decl in list) {
                addHRDeclCard(container, decl)
            }
        }
    }

    private fun addHRDeclCard(container: LinearLayout, decl: ITDeclarationSummary) {
        val ctx = context ?: return
        val cardLayout = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(28, 20, 28, 20)
            setBackgroundColor(Color.WHITE)
        }

        val headerRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = 4 }
        }
        val tvName = TextView(ctx).apply {
            text = "👤 ${decl.employeeName ?: "Employee #${decl.employeeId}"}"
            textSize = 14f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setTextColor(Color.parseColor("#212121"))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val (bgC, fgC) = when (decl.status) {
            "approved"  -> "#E8F5E9" to "#1B5E20"
            "submitted" -> "#E3F2FD" to "#1565C0"
            "rejected"  -> "#FFEBEE" to "#C62828"
            else        -> "#FFF8E1" to "#E65100"
        }
        val tvStatus = TextView(ctx).apply {
            text = decl.status.uppercase()
            textSize = 10f
            setTextColor(Color.parseColor(fgC))
            setBackgroundColor(Color.parseColor(bgC))
            setPadding(10, 4, 10, 4)
        }
        headerRow.addView(tvName)
        headerRow.addView(tvStatus)
        cardLayout.addView(headerRow)

        val tvMeta = TextView(ctx).apply {
            text = "FY: ${decl.financialYear}  |  Deductions: ${money(decl.totalDeductions ?: 0.0)}  |  Regime: ${decl.regime?.uppercase() ?: "-"}"
            textSize = 11f
            setTextColor(Color.parseColor("#757575"))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = 8 }
        }
        cardLayout.addView(tvMeta)

        val proofCount = decl.proofCount ?: 0
        val tvProofs = TextView(ctx).apply {
            text = "📎 $proofCount proof document${if (proofCount != 1) "s" else ""} uploaded"
            textSize = 11f
            setTextColor(Color.parseColor("#1565C0"))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = 12 }
        }
        cardLayout.addView(tvProofs)

        if (decl.status == "submitted") {
            val btnRow = LinearLayout(ctx).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.END
            }
            val btnReject = Button(ctx).apply {
                text = "❌ Reject"
                textSize = 12f
                setTextColor(Color.parseColor("#C62828"))
                backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#FFEBEE"))
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply { marginEnd = 10 }
                setOnClickListener { showReviewDialog(decl, "reject") }
            }
            val btnApprove = Button(ctx).apply {
                text = "✅ Approve"
                textSize = 12f
                setTextColor(Color.WHITE)
                backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#2E7D32"))
                setOnClickListener { showReviewDialog(decl, "approve") }
            }
            btnRow.addView(btnReject)
            btnRow.addView(btnApprove)
            cardLayout.addView(btnRow)
        }

        val btnPreview = Button(ctx).apply {
            text = "👁 Preview Declaration"
            textSize = 12f
            setTextColor(Color.parseColor("#1565C0"))
            backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#E3F2FD"))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = 6 }
            setOnClickListener { previewDeclaration(decl) }
        }
        cardLayout.addView(btnPreview)

        val wrapper = androidx.cardview.widget.CardView(ctx).apply {
            radius = 24f
            cardElevation = 4f
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = 16 }
            addView(cardLayout)
        }
        container.addView(wrapper)
    }

    private fun showReviewDialog(decl: ITDeclarationSummary, action: String) {
        val ctx = context ?: return
        val etComment = EditText(ctx).apply {
            hint = if (action == "reject") "Reason for rejection (required)" else "Comment (optional)"
            minLines = 2
        }
        val dlg = android.app.AlertDialog.Builder(ctx)
            .setTitle(if (action == "approve") "Approve Declaration" else "Reject Declaration")
            .setMessage("Employee: ${decl.employeeName ?: "ID ${decl.employeeId}"}  |  FY: ${decl.financialYear}")
            .setView(etComment)
            .setPositiveButton(if (action == "approve") "Approve" else "Reject") { _, _ ->
                val comment = etComment.text.toString().trim()
                if (action == "reject" && comment.isBlank()) {
                    Toast.makeText(ctx, "Please provide a rejection reason", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                submitHRReview(decl.id, action, comment)
            }
            .setNegativeButton("Cancel", null)
            .create()
        dlg.show()
        if (action == "approve") {
            dlg.getButton(android.app.AlertDialog.BUTTON_POSITIVE)
                ?.setTextColor(Color.parseColor("#2E7D32"))
        } else {
            dlg.getButton(android.app.AlertDialog.BUTTON_POSITIVE)
                ?.setTextColor(Color.parseColor("#C62828"))
        }
    }

    private fun submitHRReview(declId: Int, action: String, comment: String) {
        lifecycleScope.launch {
            val body: Map<String, Any?> = mapOf(
                "action"  to action,
                "comment" to comment.ifBlank { null }
            )
            val resp = try { api.reviewITDeclaration(declId, body) } catch (e: Exception) { null }
            val msg = resp?.body()?.message ?: if (resp?.isSuccessful == true) "Done!" else "Failed"
            Toast.makeText(context, msg, Toast.LENGTH_SHORT).show()
            if (resp?.isSuccessful == true || resp?.body()?.success == true) {
                loadHRReview()
            }
        }
    }

    /**
     * FIX 2: HR Declaration Preview now shows actual clickable attachments.
     *
     * The old version only had the declaration's proof_documents embedded in the
     * ITDeclaration response, which was sometimes empty. The web dashboard uses a
     * dedicated GET /it-declaration/proofs?declaration_id=X endpoint to load proofs
     * separately for the review modal. We now do the same — call both endpoints
     * in parallel, then build a proper scrollable dialog with a "View" button
     * per attachment, exactly matching the web behaviour.
     */
    private fun previewDeclaration(decl: ITDeclarationSummary) {
        val ctx = context ?: return

        lifecycleScope.launch {
            // Load declaration detail AND proof list simultaneously
            val declResp  = try { api.getITDeclarationById(decl.id) } catch (e: Exception) { null }
            val proofsResp = try { api.getProofsByDeclaration(decl.id) } catch (e: Exception) { null }

            val d = declResp?.body()?.data
            if (d == null) {
                Toast.makeText(ctx, "Could not load declaration details", Toast.LENGTH_SHORT).show()
                return@launch
            }

            // Use proofs from the dedicated endpoint; fall back to embedded list
            val proofs: List<ITProofDoc> = proofsResp?.body()?.data?.takeIf { it.isNotEmpty() }
                ?: d.proofDocuments ?: emptyList()

            val fmtLocal = NumberFormat.getCurrencyInstance(Locale("en", "IN")).apply { maximumFractionDigits = 0 }
            val m = { v: Double -> fmtLocal.format(v) }

            // ── Build the dialog view ─────────────────────────────────────
            val scrollView = android.widget.ScrollView(ctx)
            val root = LinearLayout(ctx).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(48, 24, 48, 24)
            }
            scrollView.addView(root)

            fun addInfoRow(label: String, value: String, valueColor: String = "#212121") {
                val row = LinearLayout(ctx).apply {
                    orientation = LinearLayout.HORIZONTAL
                    layoutParams = LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT,
                        LinearLayout.LayoutParams.WRAP_CONTENT
                    ).apply { bottomMargin = 6 }
                }
                row.addView(TextView(ctx).apply {
                    text = label
                    textSize = 12f
                    setTextColor(Color.parseColor("#757575"))
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                })
                row.addView(TextView(ctx).apply {
                    text = value
                    textSize = 12f
                    setTextColor(Color.parseColor(valueColor))
                    setTypeface(typeface, android.graphics.Typeface.BOLD)
                    gravity = android.view.Gravity.END
                })
                root.addView(row)
            }

            fun addDivider() {
                root.addView(View(ctx).apply {
                    layoutParams = LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT, 1
                    ).apply { topMargin = 12; bottomMargin = 12 }
                    setBackgroundColor(Color.parseColor("#E0E0E0"))
                })
            }

            fun addSectionHeader(title: String) {
                root.addView(TextView(ctx).apply {
                    text = title
                    textSize = 12f
                    setTextColor(Color.parseColor("#2E7D32"))
                    setTypeface(typeface, android.graphics.Typeface.BOLD)
                    layoutParams = LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
                    ).apply { topMargin = 8; bottomMargin = 6 }
                })
            }

            // Header
            addInfoRow("Employee", decl.employeeName ?: "ID ${decl.employeeId}")
            addInfoRow("FY / Regime", "${d.financialYear}  |  ${d.regime.uppercase()}")
            val (statusBg, statusFg) = when (d.status) {
                "approved"  -> "#E8F5E9" to "#1B5E20"
                "submitted" -> "#E3F2FD" to "#1565C0"
                "rejected"  -> "#FFEBEE" to "#C62828"
                else        -> "#FFF8E1" to "#E65100"
            }
            addInfoRow("Status", d.status.uppercase(), statusFg)
            addDivider()

            // HRA
            addSectionHeader("🏠 HRA")
            addInfoRow("Rent/Month", m(d.rentPaidMonthly))
            if (!d.landlordName.isNullOrBlank()) addInfoRow("Landlord", d.landlordName)
            addDivider()

            // 80C breakdown
            addSectionHeader("💰 Section 80C")
            addInfoRow("PF",        m(d.sec80cPf))
            addInfoRow("PPF",       m(d.sec80cPpf))
            addInfoRow("LIC",       m(d.sec80cLic))
            addInfoRow("ELSS",      m(d.sec80cElss))
            addInfoRow("NSC",       m(d.sec80cNsc))
            addInfoRow("Home Loan", m(d.sec80cHomeLoan))
            addInfoRow("Tuition",   m(d.sec80cTuition))
            addInfoRow("Other",     m(d.sec80cOther))
            addDivider()

            // Other deductions
            addSectionHeader("🏥 Other Deductions")
            addInfoRow("80D Self",    m(d.sec80dSelf))
            addInfoRow("80D Parents", m(d.sec80dParents))
            addInfoRow("80E Edu Loan",m(d.sec80eEduLoan))
            addInfoRow("24b Home Loan",m(d.sec24bHomeLoan))
            addInfoRow("80G Donation",m(d.sec80gDonation))
            addInfoRow("80CCD NPS",   m(d.sec80ccdNps))
            addDivider()

            // Totals
            addInfoRow("Total 80C",        m(d.total80c), "#1B5E20")
            addInfoRow("Total Deductions", m(d.totalDeductions), "#1B5E20")

            // HR comment
            if (!d.hrComment.isNullOrBlank()) {
                addDivider()
                root.addView(TextView(ctx).apply {
                    text = "💬 HR Comment: ${d.hrComment}"
                    textSize = 12f
                    setTextColor(Color.parseColor("#C62828"))
                })
            }

            // ── Proof Documents section ───────────────────────────────────
            addDivider()
            addSectionHeader("📎 Proof Documents (${proofs.size})")

            if (proofs.isEmpty()) {
                root.addView(TextView(ctx).apply {
                    text = "No proof documents uploaded."
                    textSize = 12f
                    setTextColor(Color.parseColor("#9E9E9E"))
                })
            } else {
                for (proof in proofs) {
                    val proofCard = LinearLayout(ctx).apply {
                        orientation = LinearLayout.HORIZONTAL
                        gravity = android.view.Gravity.CENTER_VERTICAL
                        setPadding(16, 12, 16, 12)
                        setBackgroundColor(Color.parseColor("#F5F5F5"))
                        layoutParams = LinearLayout.LayoutParams(
                            LinearLayout.LayoutParams.MATCH_PARENT,
                            LinearLayout.LayoutParams.WRAP_CONTENT
                        ).apply { bottomMargin = 8 }
                    }

                    val icon = TextView(ctx).apply {
                        text = when {
                            proof.mimeType?.contains("pdf") == true   -> "📄"
                            proof.mimeType?.contains("image") == true -> "🖼️"
                            else -> "📎"
                        }
                        textSize = 16f
                        layoutParams = LinearLayout.LayoutParams(
                            LinearLayout.LayoutParams.WRAP_CONTENT,
                            LinearLayout.LayoutParams.WRAP_CONTENT
                        ).apply { marginEnd = 10 }
                    }

                    val infoCol = LinearLayout(ctx).apply {
                        orientation = LinearLayout.VERTICAL
                        layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                    }
                    infoCol.addView(TextView(ctx).apply {
                        text = proof.sectionLabel ?: proof.section
                        textSize = 12f
                        setTextColor(Color.parseColor("#212121"))
                        setTypeface(typeface, android.graphics.Typeface.BOLD)
                    })
                    infoCol.addView(TextView(ctx).apply {
                        text = proof.originalName ?: "—"
                        textSize = 11f
                        setTextColor(Color.parseColor("#616161"))
                    })

                    val (pBg, pFg) = when (proof.status) {
                        "approved" -> "#E8F5E9" to "#1B5E20"
                        "rejected" -> "#FFEBEE" to "#C62828"
                        else       -> "#FFF8E1" to "#E65100"
                    }
                    val tvProofStatus = TextView(ctx).apply {
                        text = proof.status.uppercase()
                        textSize = 9f
                        setTextColor(Color.parseColor(pFg))
                        setBackgroundColor(Color.parseColor(pBg))
                        setPadding(8, 4, 8, 4)
                        layoutParams = LinearLayout.LayoutParams(
                            LinearLayout.LayoutParams.WRAP_CONTENT,
                            LinearLayout.LayoutParams.WRAP_CONTENT
                        ).apply { marginStart = 6; marginEnd = 6 }
                    }

                    // "View" button — opens the file via browser/viewer with token auth
                    val btnView = Button(ctx).apply {
                        text = "👁 View"
                        textSize = 10f
                        setTextColor(Color.parseColor("#1565C0"))
                        backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#E3F2FD"))
                        layoutParams = LinearLayout.LayoutParams(
                            LinearLayout.LayoutParams.WRAP_CONTENT,
                            LinearLayout.LayoutParams.WRAP_CONTENT
                        )
                        setOnClickListener { openProofDocument(proof) }
                    }

                    proofCard.addView(icon)
                    proofCard.addView(infoCol)
                    proofCard.addView(tvProofStatus)
                    proofCard.addView(btnView)
                    root.addView(proofCard)
                }
            }

            android.app.AlertDialog.Builder(ctx)
                .setTitle("IT Declaration Preview")
                .setView(scrollView)
                .setPositiveButton("Close", null)
                .show()
        }
    }
}