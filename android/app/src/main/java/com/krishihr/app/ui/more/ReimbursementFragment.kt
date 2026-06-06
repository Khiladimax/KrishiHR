package com.krishihr.app.ui.more

import android.app.DatePickerDialog
import android.os.Bundle
import android.view.*
import android.widget.*
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import com.google.android.material.button.MaterialButton
import com.krishihr.app.R
import com.krishihr.app.data.api.RetrofitClient
import com.krishihr.app.data.models.*
import com.krishihr.app.utils.*
import kotlinx.coroutines.launch
import java.util.*

// ═══════════════════════════════════════════════════════════════════════════════
// REIMBURSEMENT FRAGMENT
// ═══════════════════════════════════════════════════════════════════════════════
class ReimbursementFragment : Fragment() {

    private var activeTab = "mine"
    private val session by lazy { SessionManager(requireContext()) }
    private val role get() = session.getEmployee()?.role?.lowercase()?.trim() ?: Roles.EMPLOYEE
    private val canApprove get() = role in listOf(Roles.ADMIN, Roles.HR, Roles.SUPER_ADMIN, "manager", "tl", "accounts")

    private lateinit var rvList: RecyclerView
    private lateinit var tvEmpty: TextView
    private lateinit var swipeRefresh: androidx.swiperefreshlayout.widget.SwipeRefreshLayout
    private lateinit var tabMine: TextView
    private lateinit var tabPending: TextView
    private lateinit var fabApply: com.google.android.material.floatingactionbutton.FloatingActionButton

    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View {
        val v = i.inflate(R.layout.fragment_reimbursement, c, false)
        _view        = v
        rvList       = v.findViewById(R.id.rvReimbursements)
        tvEmpty      = v.findViewById(R.id.tvNoReimbursements)
        swipeRefresh = v.findViewById(R.id.swipeRefreshReimbursement)
        tabMine      = v.findViewById(R.id.tabMyReimbursements)
        tabPending   = v.findViewById(R.id.tabPendingReimbursements)
        fabApply     = v.findViewById(R.id.fabApplyReimbursement)
        return v
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        rvList.layoutManager = LinearLayoutManager(requireContext())

        fabApply.setOnClickListener {
            ApplyReimbursementBottomSheet { loadList() }.show(childFragmentManager, "apply_reimb")
        }

        tabMine.setOnClickListener    { switchTab("mine") }
        tabPending.setOnClickListener { switchTab("pending") }

        tabPending.visibility = if (canApprove) View.VISIBLE else View.GONE

        swipeRefresh.setOnRefreshListener { loadList() }
        switchTab("mine")
    }

    private fun switchTab(tab: String) {
        activeTab = tab
        val activeColor   = requireContext().getColor(R.color.primary)
        val inactiveColor = requireContext().getColor(R.color.text_secondary)
        val activeBg      = android.graphics.Color.parseColor("#E8F5E9")
        val inactiveBg    = requireContext().getColor(R.color.surface)

        if (tab == "mine") {
            tabMine.setTextColor(activeColor);     tabMine.setBackgroundColor(activeBg)
            tabPending.setTextColor(inactiveColor); tabPending.setBackgroundColor(inactiveBg)
        } else {
            tabPending.setTextColor(activeColor);  tabPending.setBackgroundColor(activeBg)
            tabMine.setTextColor(inactiveColor);   tabMine.setBackgroundColor(inactiveBg)
        }
        loadList()
    }

    private fun loadList() {
        lifecycleScope.launch {
            swipeRefresh.isRefreshing = true
            try {
                val myId = session.getEmployee()?.id
                val res = if (activeTab == "mine") {
                    RetrofitClient.instance.getReimbursements(employeeId = myId)
                } else {
                    RetrofitClient.instance.getReimbursements(status = "pending")
                }
                val list = res.body()?.data ?: emptyList()
                if (_view == null) return@launch
                tvEmpty.visibility = if (list.isEmpty()) View.VISIBLE else View.GONE
                rvList.adapter = ReimbursementAdapter(list, role) { loadList() }
            } catch (e: Exception) {
                android.util.Log.e("ReimbursementFragment", "loadList error", e)
                if (_view != null) requireContext().toast("Error: ${e.message}")
            } finally {
                if (_view != null) swipeRefresh.isRefreshing = false
            }
        }
    }

    private var _view: View? = null
    override fun onDestroyView() { super.onDestroyView(); _view = null }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADAPTER
// ═══════════════════════════════════════════════════════════════════════════════
class ReimbursementAdapter(
    private val items: List<ReimbursementApplication>,
    private val role: String,
    private val onRefresh: () -> Unit
) : RecyclerView.Adapter<ReimbursementAdapter.VH>() {

    inner class VH(v: View) : RecyclerView.ViewHolder(v) {
        val tvTitle:    TextView = v.findViewById(R.id.tvReimbTitle)
        val tvAmount:   TextView = v.findViewById(R.id.tvReimbAmount)
        val tvStatus:   TextView = v.findViewById(R.id.tvReimbStatus)
        val tvDate:     TextView = v.findViewById(R.id.tvReimbDate)
        val tvEmployee: TextView = v.findViewById(R.id.tvReimbEmployee)
        val tvItems:    TextView = v.findViewById(R.id.tvReimbItemCount)
        val btnAction:  MaterialButton = v.findViewById(R.id.btnReimbAction)
    }

    override fun onCreateViewHolder(p: ViewGroup, t: Int) =
        VH(LayoutInflater.from(p.context).inflate(R.layout.item_reimbursement, p, false))

    override fun getItemCount() = items.size

    override fun onBindViewHolder(h: VH, pos: Int) {
        val r   = items[pos]
        val ctx = h.itemView.context

        h.tvTitle.text    = r.title
        h.tvAmount.text   = "₹${String.format("%,.2f", r.totalAmount)}"
        h.tvDate.text     = r.requestedAt?.take(10)?.toDisplayDate() ?: ""
        h.tvItems.text    = "${r.items.size} item${if (r.items.size != 1) "s" else ""}"
        h.tvEmployee.text = if (r.employeeName != null) "${r.employeeName} · ${r.employeeCode ?: ""}" else ""
        h.tvEmployee.visibility = if (r.employeeName != null) View.VISIBLE else View.GONE

        val (statusText, statusColor) = when (r.status) {
            "approved"  -> "✅ Approved"  to android.graphics.Color.parseColor("#10b981")
            "rejected"  -> "❌ Rejected"  to android.graphics.Color.parseColor("#ef4444")
            "disbursed" -> "💰 Disbursed" to android.graphics.Color.parseColor("#6366f1")
            else        -> "⏳ Pending"   to android.graphics.Color.parseColor("#f59e0b")
        }
        h.tvStatus.text = statusText
        h.tvStatus.setTextColor(statusColor)

        val canAct = r.status == "pending" &&
                role in listOf(Roles.ADMIN, Roles.HR, Roles.SUPER_ADMIN, "manager", "tl", "accounts")
        h.btnAction.visibility = if (canAct) View.VISIBLE else View.GONE
        if (canAct) {
            h.btnAction.setOnClickListener {
                ReimbursementActionBottomSheet(r, onRefresh)
                    .show((ctx as androidx.fragment.app.FragmentActivity).supportFragmentManager, "reimb_action")
            }
        }

        h.itemView.setOnClickListener {
            ReimbursementDetailBottomSheet(r, role, onRefresh)
                .show((ctx as androidx.fragment.app.FragmentActivity).supportFragmentManager, "reimb_detail")
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// APPLY BOTTOM SHEET — with attachment per expense item (matches web)
// ═══════════════════════════════════════════════════════════════════════════════
class ApplyReimbursementBottomSheet(private val onDone: () -> Unit) : BottomSheetDialogFragment() {

    // ── Expense entry — matches web's itemAttachments object ─────────────────
    data class ExpenseEntry(
        var category: String,
        var description: String,
        var amount: String,
        var date: String,
        var attachmentData: String? = null,  // base64 (no prefix)
        var attachmentName: String? = null,  // original filename
        var attachmentMime: String? = null,  // e.g. "image/jpeg"
        var attachmentSize: Long?   = null   // bytes
    )

    private val expenseItems = mutableListOf<ExpenseEntry>()
    private val attachBtnMap = mutableMapOf<Int, TextView>()  // idx → attach button
    private var pendingPickIdx = -1  // which item is waiting for file

    private lateinit var etTitle:    EditText
    private lateinit var llItems:    LinearLayout
    private lateinit var btnAddItem: MaterialButton
    private lateinit var btnSubmit:  MaterialButton

    private val categories = arrayOf(
        "travel", "food", "accommodation", "fuel", "transport",
        "train", "flight", "medical", "stationery", "internet",
        "client_entertainment", "printing", "repair", "training", "miscellaneous"
    )
    private val categoryLabels = arrayOf(
        "🚗 Travel", "🍽️ Food & Beverages", "🏨 Accommodation", "⛽ Fuel / Petrol",
        "🚕 Local Transport", "🚆 Train / Bus Fare", "✈️ Flight", "💊 Medical",
        "📋 Stationery / Office", "🌐 Internet / Phone", "🤝 Client Entertainment",
        "🖨️ Printing", "🔧 Repair / Maintenance", "📚 Training / Course",
        "📦 Miscellaneous", "✏️ Other (specify)"
    )

    // ── File picker (image/* or PDF) ─────────────────────────────────────────
    private val fileLauncher = registerForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == android.app.Activity.RESULT_OK && pendingPickIdx >= 0) {
            val uri = result.data?.data ?: return@registerForActivityResult
            val ctx = requireContext()
            try {
                val cr    = ctx.contentResolver
                val mime  = cr.getType(uri) ?: "application/octet-stream"
                val name  = getFileName(uri) ?: "attachment"
                val bytes = cr.openInputStream(uri)?.readBytes() ?: return@registerForActivityResult
                val b64   = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)

                val entry = expenseItems.getOrNull(pendingPickIdx) ?: return@registerForActivityResult
                entry.attachmentData = b64
                entry.attachmentName = name
                entry.attachmentMime = mime
                entry.attachmentSize = bytes.size.toLong()

                val sizeKb = bytes.size / 1024.0
                attachBtnMap[pendingPickIdx]?.apply {
                    text = "📎 $name  (${String.format("%.1f", sizeKb)} KB)  — Long-press to remove"
                    setTextColor(android.graphics.Color.parseColor("#2e7d32"))
                    background = android.graphics.drawable.GradientDrawable().apply {
                        setColor(android.graphics.Color.parseColor("#E8F5E9"))
                        cornerRadius = 8 * requireContext().resources.displayMetrics.density
                        setStroke(1, android.graphics.Color.parseColor("#A5D6A7"))
                    }
                }
            } catch (e: Exception) {
                ctx.toast("Could not read file: ${e.message}")
            }
            pendingPickIdx = -1
        }
    }

    private fun getFileName(uri: android.net.Uri): String? {
        val cursor = requireContext().contentResolver.query(uri, null, null, null, null)
        return cursor?.use {
            val idx = it.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
            if (it.moveToFirst() && idx >= 0) it.getString(idx) else null
        }
    }

    private var projectList = listOf<Project>()
    private var selectedProjectId: Int? = null
    private lateinit var spinnerProject: Spinner

    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View {
        val v = i.inflate(R.layout.bottom_sheet_apply_reimbursement, c, false)
        etTitle    = v.findViewById(R.id.etReimbTitle)
        llItems    = v.findViewById(R.id.llExpenseItems)
        btnAddItem = v.findViewById(R.id.btnAddExpenseItem)
        btnSubmit  = v.findViewById(R.id.btnSubmitReimbursement)

        // ── Project spinner — inject above llExpenseItems ──────────────────────
        val ctx = requireContext(); val dp = ctx.resources.displayMetrics.density
        spinnerProject = Spinner(ctx).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).also { it.bottomMargin = (8*dp).toInt() }
        }
        val lbl = TextView(ctx).apply {
            text = "🗂 Link to Project (optional)"
            textSize = 12f
            setTextColor(android.graphics.Color.parseColor("#555555"))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).also { it.topMargin = (10*dp).toInt(); it.bottomMargin = (4*dp).toInt() }
        }
        // Find the parent of llItems and insert label + spinner just before llItems
        val parent = llItems.parent as? LinearLayout
        if (parent != null) {
            val itemsIdx = (0 until parent.childCount).firstOrNull { parent.getChildAt(it) == llItems } ?: 0
            parent.addView(lbl, itemsIdx)
            parent.addView(spinnerProject, itemsIdx + 1)
        } else {
            // Fallback: just add to root view if it's a LinearLayout
            (v as? LinearLayout)?.apply { addView(lbl, childCount - 1); addView(spinnerProject, childCount - 1) }
        }

        return v
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        addItemRow()
        btnAddItem.setOnClickListener { addItemRow() }
        btnSubmit.setOnClickListener  { submit() }

        // Load active projects into spinner
        lifecycleScope.launch {
            try {
                val res = RetrofitClient.instance.getProjects(status = "active")
                projectList = res.body()?.data ?: emptyList()
                val names = mutableListOf("-- No Project --")
                names.addAll(projectList.map { "${it.name}${if (it.code != null) " (${it.code})" else ""}" })
                spinnerProject.adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_item, names).also { it.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item) }
            } catch (_: Exception) {}
        }
    }

    private fun addItemRow() {
        val entry = ExpenseEntry("Travel", "", "", "")
        expenseItems.add(entry)
        val idx = expenseItems.size - 1

        val ctx = requireContext()
        val dp  = ctx.resources.displayMetrics.density

        val card = androidx.cardview.widget.CardView(ctx).apply {
            radius = 10 * dp; cardElevation = 2 * dp
            setContentPadding((14*dp).toInt(), (12*dp).toInt(), (14*dp).toInt(), (12*dp).toInt())
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).also { it.bottomMargin = (10*dp).toInt() }
        }

        val inner = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }

        // ── Header ────────────────────────────────────────────────────────────
        val headerRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
        }
        headerRow.addView(TextView(ctx).apply {
            text = "Expense #${idx + 1}"; textSize = 13f
            setTypeface(null, android.graphics.Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        })
        val btnRemove = TextView(ctx).apply {
            text = "✕ Remove"; textSize = 12f
            setTextColor(android.graphics.Color.parseColor("#ef4444"))
        }
        headerRow.addView(btnRemove)
        inner.addView(headerRow)

        // ── Category ──────────────────────────────────────────────────────────
        inner.addView(fieldLabel(ctx, dp, "Category"))
        val catContainer = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        }
        // Wrap spinner in a bordered frame so we keep the native dropdown arrow
        val spinnerFrame = android.widget.FrameLayout(ctx).apply {
            background = fieldBg(dp)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        }
        val spinner = Spinner(ctx).apply {
            adapter = ArrayAdapter(ctx, android.R.layout.simple_spinner_item, categoryLabels).also {
                it.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
            }
            setSelection(0)
            setPadding((8*dp).toInt(), (8*dp).toInt(), (8*dp).toInt(), (8*dp).toInt())
            layoutParams = android.widget.FrameLayout.LayoutParams(
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                android.widget.FrameLayout.LayoutParams.WRAP_CONTENT
            )
        }
        spinnerFrame.addView(spinner)
        val etOtherCat = EditText(ctx).apply {
            hint = "Specify category…"; textSize = 13f; background = fieldBg(dp)
            setPadding((12*dp).toInt(), (10*dp).toInt(), (12*dp).toInt(), (10*dp).toInt())
            visibility = View.GONE
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                .also { it.topMargin = (4*dp).toInt() }
            addTextChangedListener(simpleWatcher { if (text.isNotBlank()) entry.category = text.toString().trim() })
        }
        spinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(p: AdapterView<*>?, v: View?, pos: Int, id: Long) {
                if (pos == categoryLabels.size - 1) { // "Other"
                    etOtherCat.visibility = View.VISIBLE
                    entry.category = etOtherCat.text.toString().ifBlank { "other" }
                } else {
                    etOtherCat.visibility = View.GONE
                    entry.category = categories[pos]
                }
            }
            override fun onNothingSelected(p: AdapterView<*>?) {}
        }
        catContainer.addView(spinnerFrame)
        catContainer.addView(etOtherCat)
        inner.addView(catContainer)

        // ── Description ───────────────────────────────────────────────────────
        inner.addView(fieldLabel(ctx, dp, "Description"))
        val etDesc = EditText(ctx).apply {
            hint = "Brief description"; textSize = 14f; background = fieldBg(dp)
            setPadding((12*dp).toInt(), (10*dp).toInt(), (12*dp).toInt(), (10*dp).toInt())
            addTextChangedListener(simpleWatcher { entry.description = it })
        }
        inner.addView(etDesc)

        // ── Amount + Date (side by side) ──────────────────────────────────────
        val row2 = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        }
        val amtCol = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).also { it.marginEnd = (8*dp).toInt() }
        }
        amtCol.addView(fieldLabel(ctx, dp, "Amount (₹)"))
        val etAmt = EditText(ctx).apply {
            hint = "0.00"
            inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL
            textSize = 14f; background = fieldBg(dp)
            setPadding((12*dp).toInt(), (10*dp).toInt(), (12*dp).toInt(), (10*dp).toInt())
            addTextChangedListener(simpleWatcher { entry.amount = it })
        }
        amtCol.addView(etAmt)

        val dateCol = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        dateCol.addView(fieldLabel(ctx, dp, "Expense Date"))
        val etDate = EditText(ctx).apply {
            hint = "YYYY-MM-DD"; textSize = 14f; isFocusable = false; background = fieldBg(dp)
            setPadding((12*dp).toInt(), (10*dp).toInt(), (12*dp).toInt(), (10*dp).toInt())
            setOnClickListener {
                val cal = Calendar.getInstance()
                DatePickerDialog(ctx, { _, y, m, d ->
                    val s = "%04d-%02d-%02d".format(y, m + 1, d)
                    setText(s); entry.date = s
                }, cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH)).show()
            }
        }
        dateCol.addView(etDate)
        row2.addView(amtCol); row2.addView(dateCol)
        inner.addView(row2)

        // ── Attachment (Image / PDF) ───────────────────────────────────────────
        inner.addView(fieldLabel(ctx, dp, "Attachment (Receipt / Photo / PDF)"))

        val attachBtn = TextView(ctx).apply {
            text = "📎  Tap to attach file"
            textSize = 13f
            setTextColor(android.graphics.Color.parseColor("#1565C0"))
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(android.graphics.Color.parseColor("#E3F2FD"))
                cornerRadius = 8 * dp
                setStroke(1, android.graphics.Color.parseColor("#90CAF9"))
            }
            setPadding((12*dp).toInt(), (12*dp).toInt(), (12*dp).toInt(), (12*dp).toInt())
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).also { it.topMargin = (2*dp).toInt(); it.bottomMargin = (4*dp).toInt() }

            // Tap = open file picker
            setOnClickListener {
                pendingPickIdx = idx
                val intent = android.content.Intent(android.content.Intent.ACTION_GET_CONTENT).apply {
                    type = "*/*"
                    putExtra(android.content.Intent.EXTRA_MIME_TYPES, arrayOf("image/*", "application/pdf"))
                    addCategory(android.content.Intent.CATEGORY_OPENABLE)
                }
                fileLauncher.launch(android.content.Intent.createChooser(intent, "Select Receipt"))
            }

            // Long-press = clear attachment
            setOnLongClickListener {
                if (entry.attachmentData != null) {
                    entry.attachmentData = null; entry.attachmentName = null
                    entry.attachmentMime = null; entry.attachmentSize = null
                    text = "📎  Tap to attach file"
                    setTextColor(android.graphics.Color.parseColor("#1565C0"))
                    background = android.graphics.drawable.GradientDrawable().apply {
                        setColor(android.graphics.Color.parseColor("#E3F2FD"))
                        cornerRadius = 8 * dp
                        setStroke(1, android.graphics.Color.parseColor("#90CAF9"))
                    }
                    ctx.toast("Attachment removed")
                }
                true
            }
        }
        attachBtnMap[idx] = attachBtn
        inner.addView(attachBtn)

        card.addView(inner)
        llItems.addView(card)

        // ── Remove card ───────────────────────────────────────────────────────
        btnRemove.setOnClickListener {
            if (expenseItems.size > 1) {
                expenseItems.removeAt(idx)
                attachBtnMap.remove(idx)
                llItems.removeView(card)
                for (i in 0 until llItems.childCount) {
                    val c = llItems.getChildAt(i) as? androidx.cardview.widget.CardView
                    val innerL = c?.getChildAt(0) as? LinearLayout
                    val headerL = innerL?.getChildAt(0) as? LinearLayout
                    (headerL?.getChildAt(0) as? TextView)?.text = "Expense #${i + 1}"
                }
            } else {
                ctx.toast("At least one expense item is required")
            }
        }
    }

    private fun submit() {
        val title = etTitle.text.toString().trim()
        if (title.isEmpty()) { requireContext().toast("Please enter a title"); return }

        val validItems = expenseItems.filter { it.amount.isNotEmpty() && it.date.isNotEmpty() }
        if (validItems.isEmpty()) { requireContext().toast("Add at least one expense with amount and date"); return }

        // Build items JSON — same structure as web (attachment_data / name / mime / size)
        val itemsJson = org.json.JSONArray().apply {
            validItems.forEach { e ->
                put(org.json.JSONObject().apply {
                    put("category",        e.category)
                    put("description",     e.description)
                    put("amount",          e.amount.toDoubleOrNull() ?: 0.0)
                    put("expense_date",    e.date)
                    put("attachment_data", e.attachmentData)  // null if none
                    put("attachment_name", e.attachmentName)
                    put("attachment_mime", e.attachmentMime)
                    put("attachment_size", e.attachmentSize)
                })
            }
        }.toString()

        lifecycleScope.launch {
            btnSubmit.isEnabled = false
            btnSubmit.text = "Submitting…"
            try {
                val body = mapOf<String, Any?>(
                    "title" to title,
                    "items" to itemsJson,
                    "project_id" to (if (spinnerProject.selectedItemPosition > 0) projectList.getOrNull(spinnerProject.selectedItemPosition - 1)?.id else null)
                )
                val res = RetrofitClient.instance.applyReimbursement(body)
                if (res.isSuccessful && res.body()?.success == true) {
                    requireContext().toast("✅ Reimbursement submitted!")
                    onDone(); dismiss()
                } else {
                    requireContext().toast(res.body()?.message ?: "Failed to submit")
                }
            } catch (e: Exception) {
                requireContext().toast("Error: ${e.message}")
            } finally {
                btnSubmit.isEnabled = true
                btnSubmit.text = "Submit Request"
            }
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    private fun fieldLabel(ctx: android.content.Context, dp: Float, text: String) = TextView(ctx).apply {
        this.text = text; textSize = 11f
        setTextColor(android.graphics.Color.parseColor("#64748b"))
        setPadding(0, (8*dp).toInt(), 0, (2*dp).toInt())
    }

    private fun fieldBg(dp: Float) = android.graphics.drawable.GradientDrawable().apply {
        setColor(android.graphics.Color.parseColor("#F8F9FA"))
        cornerRadius = 8 * dp
        setStroke(1, android.graphics.Color.parseColor("#E2E8F0"))
    }

    private fun simpleWatcher(onChange: (String) -> Unit) = object : android.text.TextWatcher {
        override fun afterTextChanged(s: android.text.Editable?) { onChange(s.toString()) }
        override fun beforeTextChanged(s: CharSequence?, st: Int, c: Int, a: Int) {}
        override fun onTextChanged(s: CharSequence?, st: Int, b: Int, c: Int) {}
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DETAIL BOTTOM SHEET
// ═══════════════════════════════════════════════════════════════════════════════
class ReimbursementDetailBottomSheet(
    private val reimb: ReimbursementApplication,
    private val role: String,
    private val onRefresh: () -> Unit
) : BottomSheetDialogFragment() {

    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View =
        i.inflate(R.layout.bottom_sheet_reimbursement_detail, c, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        val ctx = requireContext()
        val dp  = ctx.resources.displayMetrics.density

        view.findViewById<TextView>(R.id.tvDetailTitle).text    = reimb.title
        view.findViewById<TextView>(R.id.tvDetailAmount).text   = "₹${String.format("%,.2f", reimb.totalAmount)}"
        view.findViewById<TextView>(R.id.tvDetailStatus).text   = reimb.status.replaceFirstChar { it.uppercase() }
        view.findViewById<TextView>(R.id.tvDetailDate).text     = reimb.requestedAt?.take(10)?.toDisplayDate() ?: ""
        view.findViewById<TextView>(R.id.tvDetailEmployee).text = reimb.employeeName ?: ""

        if (reimb.approvedAmount != null && reimb.approvedAmount != reimb.totalAmount) {
            view.findViewById<TextView>(R.id.tvDetailApproved).apply {
                text = "Approved: ₹${String.format("%,.2f", reimb.approvedAmount)}"
                visibility = View.VISIBLE
            }
        }

        val llItems = view.findViewById<LinearLayout>(R.id.llDetailItems)
        reimb.items.forEach { item ->
            val row = LinearLayout(ctx).apply {
                orientation = LinearLayout.VERTICAL
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(android.graphics.Color.parseColor("#F8FAFC"))
                    cornerRadius = 8 * dp
                    setStroke(1, android.graphics.Color.parseColor("#E2E8F0"))
                }
                setPadding((12*dp).toInt(), (10*dp).toInt(), (12*dp).toInt(), (10*dp).toInt())
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
                ).also { it.bottomMargin = (8*dp).toInt() }
            }
            row.addView(LinearLayout(ctx).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(TextView(ctx).apply {
                    text = item.category; textSize = 13f
                    setTypeface(null, android.graphics.Typeface.BOLD)
                    layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                })
                addView(TextView(ctx).apply {
                    text = "₹${String.format("%,.2f", item.amount)}"; textSize = 13f
                    setTypeface(null, android.graphics.Typeface.BOLD)
                })
            })
            if (!item.description.isNullOrBlank()) {
                row.addView(TextView(ctx).apply {
                    text = item.description; textSize = 12f
                    setTextColor(android.graphics.Color.parseColor("#64748b"))
                })
            }
            row.addView(TextView(ctx).apply {
                text = item.expenseDate.toDisplayDate(); textSize = 11f
                setTextColor(android.graphics.Color.parseColor("#94a3b8"))
            })
            // Attachment badge
            if (item.hasAttachment) {
                row.addView(TextView(ctx).apply {
                    text = "📎 ${item.attachmentName ?: "Attachment"}"
                    textSize = 11f
                    setTextColor(android.graphics.Color.parseColor("#2e7d32"))
                    background = android.graphics.drawable.GradientDrawable().apply {
                        setColor(android.graphics.Color.parseColor("#E8F5E9"))
                        cornerRadius = 6 * dp
                    }
                    setPadding((8*dp).toInt(), (4*dp).toInt(), (8*dp).toInt(), (4*dp).toInt())
                    layoutParams = LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
                    ).also { it.topMargin = (4*dp).toInt() }
                })
            }
            llItems.addView(row)
        }

        val myId = SessionManager(ctx).getEmployee()?.id
        val isMyPendingRequest = reimb.status == "pending" && reimb.employeeId == myId

        val btnRevoke = view.findViewById<MaterialButton>(R.id.btnRevokeReimb)

        if (isMyPendingRequest) {
            btnRevoke.visibility = View.VISIBLE
            btnRevoke.text = "↩ Revoke"
            btnRevoke.setOnClickListener {
                androidx.appcompat.app.AlertDialog.Builder(ctx)
                    .setTitle("Revoke Request")
                    .setMessage("Are you sure you want to revoke this reimbursement request?")
                    .setPositiveButton("Revoke") { _, _ ->
                        lifecycleScope.launch {
                            try {
                                val res = RetrofitClient.instance.revokeReimbursement(reimb.id)
                                if (res.isSuccessful && res.body()?.success == true) {
                                    ctx.toast("✅ Reimbursement revoked")
                                    onRefresh(); dismiss()
                                } else ctx.toast(res.body()?.message ?: "Failed")
                            } catch (e: Exception) { ctx.toast("Error: ${e.message}") }
                        }
                    }
                    .setNegativeButton("Cancel", null).show()
            }

            // ── Edit & Resubmit button ─────────────────────────────────────
            val btnEdit = com.google.android.material.button.MaterialButton(ctx).apply {
                text = "✏️ Edit & Resubmit"
                textSize = 13f
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).also { it.topMargin = (8*dp).toInt() }
            }
            // Insert Edit button above Revoke
            val parent = btnRevoke.parent as? android.view.ViewGroup
            parent?.addView(btnEdit, parent.indexOfChild(btnRevoke))

            btnEdit.setOnClickListener {
                dismiss()
                EditReimbursementBottomSheet(reimb, onRefresh)
                    .show((ctx as androidx.fragment.app.FragmentActivity).supportFragmentManager, "edit_reimb")
            }
        } else {
            btnRevoke.visibility = View.GONE
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION BOTTOM SHEET (Approve / Reject)
// ═══════════════════════════════════════════════════════════════════════════════
class ReimbursementActionBottomSheet(
    private val reimb: ReimbursementApplication,
    private val onDone: () -> Unit
) : BottomSheetDialogFragment() {

    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View =
        i.inflate(R.layout.bottom_sheet_reimbursement_action, c, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        view.findViewById<TextView>(R.id.tvActionTitle).text =
            "Review: ${reimb.title} · ₹${String.format("%,.2f", reimb.totalAmount)}"
        view.findViewById<TextView>(R.id.tvActionEmployee).text = reimb.employeeName ?: ""

        val etRemarks       = view.findViewById<EditText>(R.id.etActionRemarks)
        val etRevisedAmount = view.findViewById<EditText>(R.id.etRevisedAmount)
        val btnApprove      = view.findViewById<MaterialButton>(R.id.btnReimbApprove)
        val btnReject       = view.findViewById<MaterialButton>(R.id.btnReimbReject)

        btnApprove.setOnClickListener { doAction("approve", etRemarks.text.toString(), etRevisedAmount.text.toString()) }
        btnReject.setOnClickListener  { doAction("reject",  etRemarks.text.toString(), null) }
    }

    private fun doAction(action: String, remarks: String, revisedAmount: String?) {
        lifecycleScope.launch {
            try {
                val body = mutableMapOf<String, Any?>("action" to action, "remarks" to remarks.ifBlank { null })
                if (!revisedAmount.isNullOrBlank()) body["revised_amount"] = revisedAmount.toDoubleOrNull()
                val res = RetrofitClient.instance.reimbursementAction(reimb.id, body)
                val ok  = res.isSuccessful && res.body()?.success == true
                requireContext().toast(if (ok) "✅ ${res.body()?.message ?: "Done"}" else "❌ ${res.body()?.message ?: "Failed"}")
                if (ok) { onDone(); dismiss() }
            } catch (e: Exception) {
                requireContext().toast("Error: ${e.message}")
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EDIT & RESUBMIT BOTTOM SHEET
// ═══════════════════════════════════════════════════════════════════════════════
class EditReimbursementBottomSheet(
    private val reimb: ReimbursementApplication,
    private val onDone: () -> Unit
) : BottomSheetDialogFragment() {

    data class ExpenseEntry(
        var category: String,
        var description: String,
        var amount: String,
        var date: String,
        var attachmentData: String? = null,
        var attachmentName: String? = null,
        var attachmentMime: String? = null,
        var attachmentSize: Long?   = null
    )

    private val expenseItems = mutableListOf<ExpenseEntry>()
    private val attachBtnMap = mutableMapOf<Int, TextView>()
    private var pendingPickIdx = -1

    private lateinit var etTitle:   EditText
    private lateinit var llItems:   LinearLayout
    private lateinit var btnAddItem: com.google.android.material.button.MaterialButton
    private lateinit var btnSubmit:  com.google.android.material.button.MaterialButton

    private val categories = arrayOf(
        "travel", "food", "accommodation", "fuel", "transport",
        "train", "flight", "medical", "stationery", "internet",
        "client_entertainment", "printing", "repair", "training", "miscellaneous"
    )
    private val categoryLabels = arrayOf(
        "🚗 Travel", "🍽️ Food & Beverages", "🏨 Accommodation", "⛽ Fuel / Petrol",
        "🚕 Local Transport", "🚆 Train / Bus Fare", "✈️ Flight", "💊 Medical",
        "📋 Stationery / Office", "🌐 Internet / Phone", "🤝 Client Entertainment",
        "🖨️ Printing", "🔧 Repair / Maintenance", "📚 Training / Course",
        "📦 Miscellaneous", "✏️ Other (specify)"
    )

    private val fileLauncher = registerForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == android.app.Activity.RESULT_OK && pendingPickIdx >= 0) {
            val uri = result.data?.data ?: return@registerForActivityResult
            val ctx = requireContext()
            try {
                val cr    = ctx.contentResolver
                val mime  = cr.getType(uri) ?: "application/octet-stream"
                val name  = getFileName(uri) ?: "attachment"
                val bytes = cr.openInputStream(uri)?.readBytes() ?: return@registerForActivityResult
                val b64   = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
                val entry = expenseItems.getOrNull(pendingPickIdx) ?: return@registerForActivityResult
                entry.attachmentData = b64; entry.attachmentName = name
                entry.attachmentMime = mime; entry.attachmentSize = bytes.size.toLong()
                val sizeKb = bytes.size / 1024.0
                attachBtnMap[pendingPickIdx]?.apply {
                    text = "📎 $name  (${String.format("%.1f", sizeKb)} KB)  — Long-press to remove"
                    setTextColor(android.graphics.Color.parseColor("#2e7d32"))
                    background = android.graphics.drawable.GradientDrawable().apply {
                        setColor(android.graphics.Color.parseColor("#E8F5E9")); cornerRadius = 8 * resources.displayMetrics.density
                        setStroke(1, android.graphics.Color.parseColor("#A5D6A7"))
                    }
                }
            } catch (e: Exception) { ctx.toast("Could not read file: ${e.message}") }
            pendingPickIdx = -1
        }
    }

    private fun getFileName(uri: android.net.Uri): String? {
        val cursor = requireContext().contentResolver.query(uri, null, null, null, null)
        return cursor?.use { val idx = it.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME); if (it.moveToFirst() && idx >= 0) it.getString(idx) else null }
    }

    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View {
        val v = i.inflate(R.layout.bottom_sheet_apply_reimbursement, c, false)
        etTitle    = v.findViewById(R.id.etReimbTitle)
        llItems    = v.findViewById(R.id.llExpenseItems)
        btnAddItem = v.findViewById(R.id.btnAddExpenseItem)
        btnSubmit  = v.findViewById(R.id.btnSubmitReimbursement)
        return v
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        btnSubmit.text = "Update Request"

        // Pre-fill title
        etTitle.setText(reimb.title)

        // Pre-fill existing items
        reimb.items.forEach { item ->
            val entry = ExpenseEntry(
                category    = item.category,
                description = item.description ?: "",
                amount      = item.amount.toString(),
                date        = item.expenseDate
            )
            expenseItems.add(entry)
            addItemRow(entry, expenseItems.size - 1, item.attachmentName)
        }
        if (expenseItems.isEmpty()) addItemRow(ExpenseEntry("travel", "", "", ""), 0, null)

        btnAddItem.setOnClickListener {
            val entry = ExpenseEntry("travel", "", "", "")
            expenseItems.add(entry)
            addItemRow(entry, expenseItems.size - 1, null)
        }
        btnSubmit.setOnClickListener { submit() }
    }

    private fun addItemRow(entry: ExpenseEntry, idx: Int, existingAttachName: String?) {
        val ctx = requireContext()
        val dp  = ctx.resources.displayMetrics.density

        val card = androidx.cardview.widget.CardView(ctx).apply {
            radius = 10 * dp; cardElevation = 2 * dp
            setContentPadding((14*dp).toInt(), (12*dp).toInt(), (14*dp).toInt(), (12*dp).toInt())
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.bottomMargin = (10*dp).toInt() }
        }
        val inner = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }

        val headerRow = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = android.view.Gravity.CENTER_VERTICAL }
        headerRow.addView(TextView(ctx).apply {
            text = "Expense #${idx + 1}"; textSize = 13f; setTypeface(null, android.graphics.Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        })
        val btnRemove = TextView(ctx).apply { text = "✕ Remove"; textSize = 12f; setTextColor(android.graphics.Color.parseColor("#ef4444")) }
        headerRow.addView(btnRemove); inner.addView(headerRow)

        // Category spinner
        inner.addView(fieldLabel(ctx, dp, "Category"))
        val catContainer = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        }
        val isOtherCat = categories.none { it.equals(entry.category, ignoreCase = true) }
        val spinnerFrame = android.widget.FrameLayout(ctx).apply {
            background = fieldBg(dp)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        }
        val spinner = android.widget.Spinner(ctx).apply {
            adapter = android.widget.ArrayAdapter(ctx, android.R.layout.simple_spinner_item, categoryLabels).also {
                it.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
            }
            val selIdx = if (isOtherCat) categoryLabels.size - 1 else (categories.indexOfFirst { it.equals(entry.category, ignoreCase = true) }.takeIf { it >= 0 } ?: 0)
            setSelection(selIdx)
            setPadding((8*dp).toInt(), (8*dp).toInt(), (8*dp).toInt(), (8*dp).toInt())
            layoutParams = android.widget.FrameLayout.LayoutParams(
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                android.widget.FrameLayout.LayoutParams.WRAP_CONTENT
            )
        }
        spinnerFrame.addView(spinner)
        val etOtherCat = EditText(ctx).apply {
            hint = "Specify category…"; textSize = 13f; background = fieldBg(dp)
            setPadding((12*dp).toInt(), (10*dp).toInt(), (12*dp).toInt(), (10*dp).toInt())
            visibility = if (isOtherCat) View.VISIBLE else View.GONE
            if (isOtherCat) setText(entry.category)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                .also { it.topMargin = (4*dp).toInt() }
            addTextChangedListener(simpleWatcher { if (text.isNotBlank()) entry.category = text.toString().trim() })
        }
        spinner.onItemSelectedListener = object : android.widget.AdapterView.OnItemSelectedListener {
            override fun onItemSelected(p: android.widget.AdapterView<*>?, v: android.view.View?, pos: Int, id: Long) {
                if (pos == categoryLabels.size - 1) {
                    etOtherCat.visibility = View.VISIBLE
                    entry.category = etOtherCat.text.toString().ifBlank { "other" }
                } else {
                    etOtherCat.visibility = View.GONE
                    entry.category = categories[pos]
                }
            }
            override fun onNothingSelected(p: android.widget.AdapterView<*>?) {}
        }
        catContainer.addView(spinnerFrame)
        catContainer.addView(etOtherCat)
        inner.addView(catContainer)

        // Description
        inner.addView(fieldLabel(ctx, dp, "Description"))
        val etDesc = EditText(ctx).apply {
            setText(entry.description); hint = "Brief description"; textSize = 14f; background = fieldBg(dp)
            setPadding((12*dp).toInt(), (10*dp).toInt(), (12*dp).toInt(), (10*dp).toInt())
            addTextChangedListener(simpleWatcher { entry.description = it })
        }
        inner.addView(etDesc)

        // Amount + Date
        val row2 = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT) }
        val amtCol = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).also { it.marginEnd = (8*dp).toInt() } }
        amtCol.addView(fieldLabel(ctx, dp, "Amount (₹)"))
        val etAmt = EditText(ctx).apply {
            setText(entry.amount); hint = "0.00"; inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL
            textSize = 14f; background = fieldBg(dp); setPadding((12*dp).toInt(), (10*dp).toInt(), (12*dp).toInt(), (10*dp).toInt())
            addTextChangedListener(simpleWatcher { entry.amount = it })
        }
        amtCol.addView(etAmt)

        val dateCol = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f) }
        dateCol.addView(fieldLabel(ctx, dp, "Expense Date"))
        val etDate = EditText(ctx).apply {
            setText(entry.date); hint = "YYYY-MM-DD"; textSize = 14f; isFocusable = false; background = fieldBg(dp)
            setPadding((12*dp).toInt(), (10*dp).toInt(), (12*dp).toInt(), (10*dp).toInt())
            setOnClickListener {
                val cal = java.util.Calendar.getInstance()
                android.app.DatePickerDialog(ctx, { _, y, m, d ->
                    val s = "%04d-%02d-%02d".format(y, m + 1, d); setText(s); entry.date = s
                }, cal.get(java.util.Calendar.YEAR), cal.get(java.util.Calendar.MONTH), cal.get(java.util.Calendar.DAY_OF_MONTH)).show()
            }
        }
        dateCol.addView(etDate); row2.addView(amtCol); row2.addView(dateCol); inner.addView(row2)

        // Attachment
        inner.addView(fieldLabel(ctx, dp, "Attachment (Receipt / Photo / PDF)"))
        val attachBtn = TextView(ctx).apply {
            text = if (existingAttachName != null) "📎 $existingAttachName (existing)  — Tap to replace" else "📎  Tap to attach file"
            textSize = 13f
            setTextColor(if (existingAttachName != null) android.graphics.Color.parseColor("#2e7d32") else android.graphics.Color.parseColor("#1565C0"))
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(if (existingAttachName != null) android.graphics.Color.parseColor("#E8F5E9") else android.graphics.Color.parseColor("#E3F2FD"))
                cornerRadius = 8 * dp
                setStroke(1, if (existingAttachName != null) android.graphics.Color.parseColor("#A5D6A7") else android.graphics.Color.parseColor("#90CAF9"))
            }
            setPadding((12*dp).toInt(), (12*dp).toInt(), (12*dp).toInt(), (12*dp).toInt())
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = (2*dp).toInt(); it.bottomMargin = (4*dp).toInt() }
            setOnClickListener {
                pendingPickIdx = idx
                val intent = android.content.Intent(android.content.Intent.ACTION_GET_CONTENT).apply {
                    type = "*/*"; putExtra(android.content.Intent.EXTRA_MIME_TYPES, arrayOf("image/*", "application/pdf"))
                    addCategory(android.content.Intent.CATEGORY_OPENABLE)
                }
                fileLauncher.launch(android.content.Intent.createChooser(intent, "Select Receipt"))
            }
            setOnLongClickListener {
                entry.attachmentData = null; entry.attachmentName = null; entry.attachmentMime = null; entry.attachmentSize = null
                text = "📎  Tap to attach file"; setTextColor(android.graphics.Color.parseColor("#1565C0"))
                background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(android.graphics.Color.parseColor("#E3F2FD")); cornerRadius = 8 * dp
                    setStroke(1, android.graphics.Color.parseColor("#90CAF9"))
                }
                ctx.toast("Attachment removed"); true
            }
        }
        attachBtnMap[idx] = attachBtn; inner.addView(attachBtn)
        card.addView(inner); llItems.addView(card)

        btnRemove.setOnClickListener {
            if (expenseItems.size > 1) {
                expenseItems.removeAt(idx); attachBtnMap.remove(idx); llItems.removeView(card)
                for (i in 0 until llItems.childCount) {
                    val c = llItems.getChildAt(i) as? androidx.cardview.widget.CardView
                    val innerL = c?.getChildAt(0) as? LinearLayout
                    val headerL = innerL?.getChildAt(0) as? LinearLayout
                    (headerL?.getChildAt(0) as? TextView)?.text = "Expense #${i + 1}"
                }
            } else { ctx.toast("At least one expense item is required") }
        }
    }

    private fun submit() {
        val title = etTitle.text.toString().trim()
        if (title.isEmpty()) { requireContext().toast("Please enter a title"); return }
        val validItems = expenseItems.filter { it.amount.isNotEmpty() && it.date.isNotEmpty() }
        if (validItems.isEmpty()) { requireContext().toast("Add at least one expense with amount and date"); return }

        val itemsArray = org.json.JSONArray()
        for (e in validItems) {
            val obj = org.json.JSONObject()
            obj.put("category", e.category); obj.put("description", e.description)
            obj.put("amount", e.amount.toDoubleOrNull() ?: 0.0); obj.put("expense_date", e.date)
            obj.putOpt("attachment_data", e.attachmentData); obj.putOpt("attachment_name", e.attachmentName)
            obj.putOpt("attachment_mime", e.attachmentMime); obj.putOpt("attachment_size", e.attachmentSize)
            itemsArray.put(obj)
        }
        val jsonPayload = org.json.JSONObject().apply { put("title", title); put("items", itemsArray.toString()) }.toString()
        val requestBody = jsonPayload.toRequestBody("application/json; charset=utf-8".toMediaType())

        lifecycleScope.launch {
            btnSubmit.isEnabled = false; btnSubmit.text = "Updating…"
            try {
                val res = RetrofitClient.instance.editReimbursement(reimb.id, requestBody)
                if (res.isSuccessful && res.body()?.success == true) {
                    requireContext().toast("✅ Reimbursement updated!"); onDone(); dismiss()
                } else {
                    requireContext().toast(res.body()?.message ?: "Update failed (${res.code()})")
                }
            } catch (e: Exception) {
                android.util.Log.e("EditReimb", "Edit failed", e)
                requireContext().toast("Error: ${e.message}")
            } finally { btnSubmit.isEnabled = true; btnSubmit.text = "Update Request" }
        }
    }

    private fun fieldLabel(ctx: android.content.Context, dp: Float, text: String) = TextView(ctx).apply {
        this.text = text; textSize = 11f; setTextColor(android.graphics.Color.parseColor("#64748b"))
        setPadding(0, (8*dp).toInt(), 0, (2*dp).toInt())
    }
    private fun fieldBg(dp: Float) = android.graphics.drawable.GradientDrawable().apply {
        setColor(android.graphics.Color.parseColor("#F8F9FA")); cornerRadius = 8 * dp
        setStroke(1, android.graphics.Color.parseColor("#E2E8F0"))
    }
    private fun simpleWatcher(onChange: (String) -> Unit) = object : android.text.TextWatcher {
        override fun afterTextChanged(s: android.text.Editable?) { onChange(s.toString()) }
        override fun beforeTextChanged(s: CharSequence?, st: Int, c: Int, a: Int) {}
        override fun onTextChanged(s: CharSequence?, st: Int, b: Int, c: Int) {}
    }
}