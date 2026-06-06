package com.krishihr.app.ui.leave

import android.app.DatePickerDialog
import android.os.Bundle
import android.view.*
import android.widget.*
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import com.google.android.material.button.MaterialButton
import com.krishihr.app.AndroidMain
import com.krishihr.app.R
import com.krishihr.app.data.api.RetrofitClient
import com.krishihr.app.data.models.*
import com.krishihr.app.databinding.FragmentLeaveBinding
import com.krishihr.app.utils.*
import kotlinx.coroutines.launch
import java.util.*

class LeaveFragment : Fragment() {
    private var _b: FragmentLeaveBinding? = null
    private val binding get() = _b!!

    // Track active tab: "leave" or "compoff"
    private var activeTab = "leave"

    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View {
        _b = FragmentLeaveBinding.inflate(i, c, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        binding.rvLeaveApplications.layoutManager = LinearLayoutManager(requireContext())
        binding.rvCompOffCredits.layoutManager = LinearLayoutManager(requireContext())

        loadBalance()
        loadApplications()
        loadCompOffBalance()

        // Header menu clicks
        binding.fabApplyLeave.setOnClickListener {
            ApplyLeaveBottomSheet { loadApplications() }.show(childFragmentManager, "apply")
        }
        binding.menuApplyLeave.setOnClickListener {
            ApplyLeaveBottomSheet { loadApplications() }.show(childFragmentManager, "apply2")
        }
        binding.menuLeaveBalance.setOnClickListener  { loadBalance() }
        binding.menuLeaveHistory.setOnClickListener  { loadApplications() }
        binding.swipeRefresh.setOnRefreshListener {
            loadBalance()
            loadApplications()
            loadCompOffBalance()
        }

        // Tab clicks
        binding.tabApplications.setOnClickListener { switchTab("leave") }
        binding.tabCompOff.setOnClickListener      { switchTab("compoff") }

        switchTab("leave") // default
    }

    // ── Tab switching ─────────────────────────────────────────────────────────
    private fun switchTab(tab: String) {
        activeTab = tab
        if (tab == "leave") {
            binding.rvLeaveApplications.visibility = View.VISIBLE
            binding.tvNoLeaves.visibility = if (
                (binding.rvLeaveApplications.adapter?.itemCount ?: 0) == 0
            ) View.VISIBLE else View.GONE
            binding.layoutCompOff.visibility = View.GONE
            // Active tab styling
            binding.tabApplications.setTextColor(requireContext().getColor(R.color.primary))
            binding.tabApplications.setBackgroundColor(
                android.graphics.Color.parseColor("#E8F5E9"))
            binding.tabCompOff.setTextColor(requireContext().getColor(R.color.text_secondary))
            binding.tabCompOff.setBackgroundColor(requireContext().getColor(R.color.surface))
        } else {
            binding.rvLeaveApplications.visibility = View.GONE
            binding.tvNoLeaves.visibility = View.GONE
            binding.layoutCompOff.visibility = View.VISIBLE
            // Active tab styling
            binding.tabCompOff.setTextColor(android.graphics.Color.parseColor("#E65100"))
            binding.tabCompOff.setBackgroundColor(android.graphics.Color.parseColor("#FFF3E0"))
            binding.tabApplications.setTextColor(requireContext().getColor(R.color.text_secondary))
            binding.tabApplications.setBackgroundColor(requireContext().getColor(R.color.surface))
            loadCompOffCredits()
        }
    }

    // ── Leave Balance ─────────────────────────────────────────────────────────
    private fun loadBalance() {
        lifecycleScope.launch {
            try {
                val res = RetrofitClient.instance.getLeaveBalance()
                val body = res.body() ?: return@launch
                val bals = body.data ?: return@launch
                if (_b == null) return@launch

                if (body.isProvisional) {
                    val pl = bals.firstOrNull {
                        (it.code ?: it.leaveTypeCode ?: "").uppercase().trim() == "PL"
                    }
                    val plBalance = pl?.effectiveBalance ?: 0.0
                    binding.tvCLBalance.text = "—"
                    binding.tvSLBalance.text = "—"
                    binding.tvELBalance.text = String.format("%.1f", maxOf(0.0, plBalance))
                    binding.tvCLLabel.text = ""
                    binding.tvSLLabel.text = ""
                    binding.tvELLabel.text = "Provision Leave"
                } else {
                    var cl = 0.0; var sl = 0.0; var el = 0.0
                    bals.forEach { b ->
                        val code = (b.code ?: b.leaveTypeCode ?: "").uppercase().trim()
                        val name = (b.name ?: b.leaveTypeName ?: "").uppercase().trim()
                        val bal  = b.effectiveBalance
                        when {
                            code == "CL" || name.contains("CASUAL")                            -> cl = bal
                            code == "SL" || name.contains("SICK")                              -> sl = bal
                            code == "EL" || name.contains("EARNED") || name.contains("ANNUAL") -> el = bal
                        }
                    }
                    binding.tvCLBalance.text = String.format("%.1f", maxOf(0.0, cl))
                    binding.tvSLBalance.text = String.format("%.1f", maxOf(0.0, sl))
                    binding.tvELBalance.text = String.format("%.1f", maxOf(0.0, el))
                    binding.tvCLLabel.text = "Casual"
                    binding.tvSLLabel.text = "Sick"
                    binding.tvELLabel.text = "Earned"
                }
            } catch (_: Exception) {}
            finally { binding.swipeRefresh.isRefreshing = false }
        }
    }

    // ── Leave Applications ────────────────────────────────────────────────────
    private fun loadApplications() {
        lifecycleScope.launch {
            try {
                val myId = SessionManager(requireContext()).getEmployee()?.id
                val res = RetrofitClient.instance.getLeaveApplications(employeeId = myId)
                val allApps = res.body()?.data ?: emptyList()
                if (_b == null) return@launch

                val currentYear = Calendar.getInstance().get(Calendar.YEAR).toString()
                val apps = allApps
                    .filter { app ->
                        val year = app.fromDate?.take(4) ?: ""
                        year == currentYear &&
                                app.status.lowercase() !in listOf("cancelled", "rejected")
                    }
                    .sortedByDescending { it.fromDate ?: "" }

                binding.rvLeaveApplications.adapter =
                    LeaveListAdapter(apps, showName = false, showAction = false) {}
                if (activeTab == "leave") {
                    binding.tvNoLeaves.visibility =
                        if (apps.isEmpty()) View.VISIBLE else View.GONE
                }
            } catch (_: Exception) {}
        }
    }

    // ── Comp Off Balance (top card) ───────────────────────────────────────────
    private fun loadCompOffBalance() {
        lifecycleScope.launch {
            try {
                val res = RetrofitClient.instance.getCompOffBalance()
                val data = res.body()?.data ?: return@launch
                if (_b == null) return@launch
                // Update top balance card
                binding.tvCOBalance.text = String.format("%.1f", data.available)
                // Update comp off tab summary cards
                binding.tvCoAvail.text  = String.format("%.1f", data.available)
                binding.tvCoEarned.text = String.format("%.1f", data.totalCredited)
                binding.tvCoUsed.text   = String.format("%.1f", data.used)
            } catch (_: Exception) {
                // Fallback: try /compoff/credits summary
                try {
                    val res2 = RetrofitClient.instance.getCompOffCredits()
                    val credits = res2.body()?.data ?: return@launch
                    if (_b == null) return@launch
                    val avail   = credits.filter { it.status == "available" }.sumOf { it.daysCredited }
                    val earned  = credits.sumOf { it.daysCredited }
                    val used    = credits.filter { it.status == "used" }.sumOf { it.daysCredited }
                    binding.tvCOBalance.text = String.format("%.1f", avail)
                    binding.tvCoAvail.text   = String.format("%.1f", avail)
                    binding.tvCoEarned.text  = String.format("%.1f", earned)
                    binding.tvCoUsed.text    = String.format("%.1f", used)
                } catch (_: Exception) {}
            }
        }
    }

    // ── Comp Off Credit History ───────────────────────────────────────────────
    private fun loadCompOffCredits() {
        lifecycleScope.launch {
            try {
                val res = RetrofitClient.instance.getCompOffCredits()
                val credits = res.body()?.data ?: emptyList()
                if (_b == null) return@launch

                binding.rvCompOffCredits.adapter = CompOffCreditsAdapter(credits)
                binding.tvNoCompOff.visibility =
                    if (credits.isEmpty()) View.VISIBLE else View.GONE

                // Refresh summary cards too
                val avail  = credits.filter { it.status == "available" }.sumOf { it.daysCredited }
                val earned = credits.sumOf { it.daysCredited }
                val used   = credits.filter { it.status == "used" }.sumOf { it.daysCredited }
                binding.tvCoAvail.text  = String.format("%.1f", avail)
                binding.tvCoEarned.text = String.format("%.1f", earned)
                binding.tvCoUsed.text   = String.format("%.1f", used)
                binding.tvCOBalance.text = String.format("%.1f", avail)
            } catch (_: Exception) {
                if (_b != null) {
                    binding.tvNoCompOff.text = "Failed to load comp off data."
                    binding.tvNoCompOff.visibility = View.VISIBLE
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        val prefs = requireContext().getSharedPreferences(
            AndroidMain.PREFS_LEAVE_CACHE, android.content.Context.MODE_PRIVATE)
        if (prefs.getBoolean("balance_stale", false)) {
            prefs.edit().putBoolean("balance_stale", false).apply()
            loadBalance()
            loadCompOffBalance()
        }
    }

    override fun onDestroyView() { super.onDestroyView(); _b = null }
}

// ── Comp Off Credits Adapter ──────────────────────────────────────────────────
class CompOffCreditsAdapter(
    private val items: List<CompOffCredit>
) : RecyclerView.Adapter<CompOffCreditsAdapter.VH>() {

    inner class VH(val card: androidx.cardview.widget.CardView) : RecyclerView.ViewHolder(card)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val ctx = parent.context
        val dp  = ctx.resources.displayMetrics.density
        val card = androidx.cardview.widget.CardView(ctx).apply {
            radius = 12 * dp
            cardElevation = 2 * dp
            setCardBackgroundColor(ctx.getColor(R.color.surface))
            layoutParams = RecyclerView.LayoutParams(
                RecyclerView.LayoutParams.MATCH_PARENT,
                RecyclerView.LayoutParams.WRAP_CONTENT
            ).also { it.setMargins(0, 0, 0, (8 * dp).toInt()) }
        }
        return VH(card)
    }

    override fun getItemCount() = items.size

    override fun onBindViewHolder(h: VH, pos: Int) {
        val item = items[pos]
        val ctx  = h.card.context
        val dp   = ctx.resources.displayMetrics.density
        h.card.removeAllViews()

        val ll = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding((14 * dp).toInt(), (12 * dp).toInt(), (14 * dp).toInt(), (12 * dp).toInt())
        }

        // Row 1: occasion/type + status pill
        val row1 = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT)
        }
        val occasion = when {
            !item.holidayName.isNullOrBlank() -> item.holidayName
            item.workedType == "weekend"      -> "Weekend Work"
            item.workedType == "holiday"      -> "Holiday Work"
            else                              -> "Comp Off"
        }
        val tvOccasion = TextView(ctx).apply {
            text = occasion
            textSize = 14f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(ctx.getColor(R.color.text_primary))
            layoutParams = LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val statusColor = when (item.status.lowercase()) {
            "available" -> android.graphics.Color.parseColor("#2E7D32")
            "used"      -> android.graphics.Color.parseColor("#E65100")
            "expired"   -> android.graphics.Color.parseColor("#90A4AE")
            else        -> android.graphics.Color.parseColor("#1565C0")
        }
        val tvStatus = TextView(ctx).apply {
            text = item.status.replaceFirstChar { it.uppercase() }
            textSize = 11f
            setPadding((10 * dp).toInt(), (3 * dp).toInt(), (10 * dp).toInt(), (3 * dp).toInt())
            setTextColor(android.graphics.Color.WHITE)
            setTypeface(null, android.graphics.Typeface.BOLD)
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(statusColor); cornerRadius = 20 * dp
            }
        }
        row1.addView(tvOccasion); row1.addView(tvStatus)
        ll.addView(row1)

        // Row 2: worked date + days credited
        val workedDateFmt = item.workedDate?.toDisplayDate() ?: "—"
        ll.addView(TextView(ctx).apply {
            text = "📅 Worked: $workedDateFmt  •  ${item.daysCredited.toInt()} day(s) credited"
            textSize = 12f
            setTextColor(ctx.getColor(R.color.text_secondary))
            setPadding(0, (4 * dp).toInt(), 0, 0)
        })

        // Expiry
        if (!item.expiryDate.isNullOrBlank()) {
            ll.addView(TextView(ctx).apply {
                text = "⏳ Expires: ${item.expiryDate.toDisplayDate()}"
                textSize = 11f
                setTextColor(
                    if (item.status == "expired")
                        android.graphics.Color.parseColor("#C62828")
                    else ctx.getColor(R.color.text_hint)
                )
                setPadding(0, (2 * dp).toInt(), 0, 0)
            })
        }

        // Remarks / granted by
        val note = listOfNotNull(
            item.remarks?.takeIf { it.isNotBlank() },
            item.grantedByName?.takeIf { it.isNotBlank() }?.let { "Granted by $it" }
        ).joinToString(" • ")
        if (note.isNotBlank()) {
            ll.addView(TextView(ctx).apply {
                text = note
                textSize = 11f
                setTextColor(ctx.getColor(R.color.text_hint))
                setPadding(0, (2 * dp).toInt(), 0, 0)
            })
        }

        h.card.addView(ll)
    }
}

// ── Shared Leave List Adapter ─────────────────────────────────────────────────
class LeaveListAdapter(
    private val items: List<LeaveApplication>,
    private val showName: Boolean = true,
    private val showAction: Boolean = true,
    private val onAction: () -> Unit
) : RecyclerView.Adapter<LeaveListAdapter.VH>() {

    inner class VH(val root: FrameLayout) : RecyclerView.ViewHolder(root)

    override fun onCreateViewHolder(p: ViewGroup, t: Int): VH {
        val ctx = p.context; val dp = ctx.resources.displayMetrics.density
        val card = androidx.cardview.widget.CardView(ctx).apply {
            radius = 14 * dp; cardElevation = 2 * dp
            setCardBackgroundColor(ctx.getColor(R.color.surface))
            layoutParams = RecyclerView.LayoutParams(
                RecyclerView.LayoutParams.MATCH_PARENT,
                RecyclerView.LayoutParams.WRAP_CONTENT
            ).also { it.setMargins(0, 0, 0, (8 * dp).toInt()) }
        }
        return VH(card)
    }

    override fun getItemCount() = items.size

    override fun onBindViewHolder(h: VH, pos: Int) {
        val it = items[pos]; val ctx = h.root.context; val dp = ctx.resources.displayMetrics.density
        val card = h.root as androidx.cardview.widget.CardView
        card.removeAllViews()

        val ll = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding((14 * dp).toInt(), (12 * dp).toInt(), (14 * dp).toInt(), (12 * dp).toInt())
        }

        val headerRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT)
        }
        val tvType = TextView(ctx).apply {
            text = it.displayType; textSize = 14f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(ctx.getColor(R.color.text_primary))
            layoutParams = LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val tvStatus = TextView(ctx).apply {
            text = it.status.replaceFirstChar { c -> c.uppercase() }; textSize = 11f
            setPadding((10 * dp).toInt(), (3 * dp).toInt(), (10 * dp).toInt(), (3 * dp).toInt())
            setTextColor(android.graphics.Color.WHITE)
            setTypeface(null, android.graphics.Typeface.BOLD)
            val bgCol = when (it.status.lowercase()) {
                "approved" -> android.graphics.Color.parseColor("#2E7D45")
                "rejected" -> android.graphics.Color.parseColor("#C62828")
                "pending"  -> android.graphics.Color.parseColor("#E65100")
                else       -> android.graphics.Color.parseColor("#90A4AE")
            }
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(bgCol); cornerRadius = 20 * dp
            }
        }
        headerRow.addView(tvType); headerRow.addView(tvStatus)
        ll.addView(headerRow)

        if (showName && !it.employeeName.isNullOrEmpty()) {
            ll.addView(TextView(ctx).apply {
                text = it.employeeName; textSize = 12f
                setTextColor(ctx.getColor(R.color.text_secondary))
                setPadding(0, (2 * dp).toInt(), 0, 0)
            })
        }

        ll.addView(TextView(ctx).apply {
            text = "${it.fromDate?.toDisplayDate() ?: "-"} → ${it.toDate?.toDisplayDate() ?: "-"}  (${it.totalDays?.let { d -> "${d.toInt()} day(s)" } ?: ""})"
            textSize = 12f
            setTextColor(ctx.getColor(R.color.text_secondary))
            setPadding(0, (4 * dp).toInt(), 0, 0)
        })

        if (!it.reason.isNullOrBlank()) {
            ll.addView(TextView(ctx).apply {
                text = it.reason; textSize = 11f
                setTextColor(ctx.getColor(R.color.text_hint))
                setPadding(0, (2 * dp).toInt(), 0, 0)
            })
        }

        val session = com.krishihr.app.utils.SessionManager(ctx)
        val myId    = session.getEmployee()?.id
        val myCode  = session.getEmployee()?.employeeCode
        val isMyTurn    = it.currentApproverCode != null && it.currentApproverCode == myCode
        val isOwnLeave  = it.employeeId == myId

        if (showAction && it.status.lowercase() == "pending" && isMyTurn && !isOwnLeave) {
            val leaveId = it.id
            val btnRow = LinearLayout(ctx).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).also { m -> m.topMargin = (8 * dp).toInt() }
            }
            val btnApprove = MaterialButton(ctx, null,
                com.google.android.material.R.attr.materialButtonStyle).apply {
                text = "Approve"
                setBackgroundColor(ctx.getColor(R.color.primary)); textSize = 12f
                layoutParams = LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f
                ).also { m -> m.marginEnd = (8 * dp).toInt() }
                setOnClickListener { doAction(ctx, leaveId, "approve") }
            }
            val btnReject = MaterialButton(ctx, null,
                com.google.android.material.R.attr.materialButtonStyle).apply {
                text = "Reject"
                setBackgroundColor(ctx.getColor(R.color.accent_red)); textSize = 12f
                layoutParams = LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                setOnClickListener { doAction(ctx, leaveId, "reject") }
            }
            btnRow.addView(btnApprove); btnRow.addView(btnReject)
            ll.addView(btnRow)
        }

        // ── Cancel own pending leave ──────────────────────────────────────────
        if (it.status.lowercase() == "pending" && isOwnLeave) {
            val leaveId = it.id
            val btnCancel = MaterialButton(ctx, null,
                com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
                text = "✕ Cancel Leave"
                textSize = 12f
                setTextColor(android.graphics.Color.parseColor("#C62828"))
                strokeColor = android.content.res.ColorStateList.valueOf(
                    android.graphics.Color.parseColor("#EF9A9A"))
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).also { m -> m.topMargin = (8 * dp).toInt() }
                setOnClickListener { cancelLeave(ctx, leaveId) }
            }
            ll.addView(btnCancel)
        }

        card.addView(ll)
    }

    private fun doAction(ctx: android.content.Context, id: Int, action: String) {
        android.app.AlertDialog.Builder(ctx)
            .setTitle(if (action == "approve") "✅ Approve" else "❌ Reject")
            .setMessage("Are you sure you want to ${action} this leave request?")
            .setPositiveButton("Yes") { _, _ ->
                kotlinx.coroutines.MainScope().launch {
                    try {
                        var res = RetrofitClient.instance.leaveAction(id, ActionRequest(action))
                        if (!res.isSuccessful) {
                            res = RetrofitClient.instance.leaveActionPut(id, ActionRequest(action))
                        }
                        if (res.isSuccessful && res.body()?.success == true) {
                            ctx.toast("${action.replaceFirstChar { it.uppercase() }}d successfully ✅")
                            onAction()
                        } else {
                            ctx.toast("Failed: ${res.body()?.message ?: "Error ${res.code()}"}")
                        }
                    } catch (e: Exception) {
                        ctx.toast("Network error: ${e.message}")
                    }
                }
            }
            .setNegativeButton("Cancel", null).show()
    }

    private fun cancelLeave(ctx: android.content.Context, id: Int) {
        android.app.AlertDialog.Builder(ctx)
            .setTitle("Cancel Leave")
            .setMessage("Are you sure you want to cancel this leave request? This action cannot be undone.")
            .setPositiveButton("Yes, Cancel Leave") { _, _ ->
                kotlinx.coroutines.MainScope().launch {
                    try {
                        // Try POST /leave/{id}/cancel first, fall back to /revoke
                        var res = RetrofitClient.instance.cancelLeave(id)
                        if (!res.isSuccessful) {
                            res = RetrofitClient.instance.revokeLeave(id)
                        }
                        if (res.isSuccessful && res.body()?.success == true) {
                            ctx.toast("✅ Leave cancelled successfully")
                            onAction()
                        } else {
                            ctx.toast("Failed: ${res.body()?.message ?: "Error ${res.code()}"}")
                        }
                    } catch (e: Exception) {
                        ctx.toast("Network error: ${e.message}")
                    }
                }
            }
            .setNegativeButton("Keep Leave", null).show()
    }
}

// ── Apply Leave Bottom Sheet ───────────────────────────────────────────────────
class ApplyLeaveBottomSheet(private val onSuccess: () -> Unit) : BottomSheetDialogFragment() {
    private val leaveTypes = mutableListOf<LeaveType>()

    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View {
        val ctx = requireContext(); val dp = ctx.resources.displayMetrics.density
        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding((20 * dp).toInt(), (20 * dp).toInt(), (20 * dp).toInt(), (32 * dp).toInt())
        }

        root.addView(TextView(ctx).apply {
            text = "Apply Leave"; textSize = 18f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setPadding(0, 0, 0, (16 * dp).toInt())
        })

        val spLeaveType = Spinner(ctx).apply {
            setBackgroundColor(ctx.getColor(R.color.background))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).also { it.bottomMargin = (12 * dp).toInt() }
        }
        root.addView(spLeaveType)

        val cal = Calendar.getInstance()
        var fromDate = ""; var toDate = ""

        val switchHalfDay = com.google.android.material.switchmaterial.SwitchMaterial(ctx).apply {
            text = "½ Half Day Leave"; textSize = 13f; isChecked = false
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }

        val tvFrom = TextView(ctx).apply { text = "From: Not selected"; textSize = 13f; setPadding(0, 0, 0, (4 * dp).toInt()) }
        val tvTo   = TextView(ctx).apply { text = "To: Not selected";   textSize = 13f; setPadding(0, 0, 0, (4 * dp).toInt()) }

        val btnToDate = MaterialButton(ctx, null,
            com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
            text = "To Date"
            setOnClickListener {
                if (switchHalfDay.isChecked) return@setOnClickListener
                DatePickerDialog(ctx, { _, y, m, d ->
                    toDate = String.format("%04d-%02d-%02d", y, m + 1, d)
                    tvTo.text = "To: $toDate"
                }, cal.get(Calendar.YEAR), cal.get(Calendar.MONTH),
                    cal.get(Calendar.DAY_OF_MONTH)).show()
            }
        }

        root.addView(MaterialButton(ctx, null,
            com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
            text = "From Date"
            setOnClickListener {
                DatePickerDialog(ctx, { _, y, m, d ->
                    fromDate = String.format("%04d-%02d-%02d", y, m + 1, d)
                    tvFrom.text = "From: $fromDate"
                    if (switchHalfDay.isChecked) {
                        toDate = fromDate
                        tvTo.text = "To: $toDate (same as From — Half Day)"
                    }
                }, cal.get(Calendar.YEAR), cal.get(Calendar.MONTH),
                    cal.get(Calendar.DAY_OF_MONTH)).show()
            }
        })
        root.addView(tvFrom)
        root.addView(btnToDate)
        root.addView(tvTo)

        val halfDayRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).also { it.topMargin = (12 * dp).toInt(); it.bottomMargin = (4 * dp).toInt() }
        }
        val tvHalfDayNote = TextView(ctx).apply {
            text = "counts as 0.5 day — From & To must be same date"; textSize = 11f
            setTextColor(ctx.getColor(R.color.text_secondary))
        }
        halfDayRow.addView(switchHalfDay); halfDayRow.addView(tvHalfDayNote)
        root.addView(halfDayRow)

        switchHalfDay.setOnCheckedChangeListener { _, isChecked ->
            if (isChecked) {
                btnToDate.isEnabled = false; btnToDate.alpha = 0.4f
                if (fromDate.isNotEmpty()) {
                    toDate = fromDate; tvTo.text = "To: $toDate (same as From — Half Day)"
                } else { tvTo.text = "To: same as From (select From Date first)" }
            } else {
                btnToDate.isEnabled = true; btnToDate.alpha = 1.0f
                tvTo.text = if (toDate.isNotEmpty()) "To: $toDate" else "To: Not selected"
            }
        }

        val etReason = EditText(ctx).apply {
            hint = "Reason *"; minLines = 2
            setBackgroundColor(ctx.getColor(R.color.background))
            setPadding((8 * dp).toInt(), (8 * dp).toInt(), (8 * dp).toInt(), (8 * dp).toInt())
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).also { it.topMargin = (12 * dp).toInt() }
        }
        root.addView(etReason)

        val progress = ProgressBar(ctx).apply { visibility = View.GONE }
        root.addView(progress)

        root.addView(MaterialButton(ctx, null,
            com.google.android.material.R.attr.materialButtonStyle).apply {
            text = "Submit Leave"
            setBackgroundColor(ctx.getColor(R.color.primary))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).also { it.topMargin = (16 * dp).toInt() }
            setOnClickListener {
                if (fromDate.isEmpty() || toDate.isEmpty()) { toast("Select dates"); return@setOnClickListener }
                val reason = etReason.text.toString().trim()
                if (reason.isEmpty()) { toast("Enter reason"); return@setOnClickListener }
                val lt = leaveTypes.getOrNull(spLeaveType.selectedItemPosition)
                if (lt == null) { toast("Select leave type"); return@setOnClickListener }

                progress.visibility = View.VISIBLE; isEnabled = false
                lifecycleScope.launch {
                    try {
                        val isHalf = switchHalfDay.isChecked
                        val finalToDate = if (isHalf) fromDate else toDate
                        val res = RetrofitClient.instance.applyLeave(
                            LeaveRequest(lt.id, fromDate, finalToDate, reason, lt.code, isHalf))
                        if (res.isSuccessful && res.body()?.success == true) {
                            toast("Leave applied ✅"); onSuccess(); dismiss()
                        } else toast(res.body()?.message ?: "Failed")
                    } catch (_: Exception) { toast("Network error") }
                    finally { progress.visibility = View.GONE; isEnabled = true }
                }
            }
        })

        lifecycleScope.launch {
            try {
                val res = RetrofitClient.instance.getLeaveTypes()
                val types = res.body()?.data ?: emptyList()
                leaveTypes.clear(); leaveTypes.addAll(types)
                spLeaveType.adapter = ArrayAdapter(ctx,
                    android.R.layout.simple_spinner_dropdown_item,
                    types.map { "${it.name} (${it.daysAllowed} days)" })
            } catch (_: Exception) {}
        }

        return root
    }
}