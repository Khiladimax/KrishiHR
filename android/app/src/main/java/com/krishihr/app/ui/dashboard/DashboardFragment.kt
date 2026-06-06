package com.krishihr.app.ui.dashboard
import com.krishihr.app.AndroidMain

import android.location.Location
import android.os.Bundle
import android.util.Log
import android.view.*
import android.widget.*
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.google.android.gms.common.api.ResolvableApiException
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.LocationSettingsRequest
import com.google.android.gms.location.Priority
import com.google.android.gms.location.SettingsClient
import com.google.android.gms.tasks.CancellationTokenSource
import com.krishihr.app.R
import com.krishihr.app.data.api.RetrofitClient
import com.krishihr.app.data.models.*
import com.krishihr.app.databinding.FragmentDashboardBinding
import com.krishihr.app.domain.model.StopReason
import com.krishihr.app.domain.model.TrackingPrefs
import com.krishihr.app.permission.PermissionManager
import com.krishihr.app.service.LocationTrackingService
import com.krishihr.app.ui.MainActivity
import com.krishihr.app.ui.attendance.AttendanceFragment
import com.krishihr.app.ui.attendance.MovementFragment
import com.krishihr.app.ui.more.GeofenceAdminFragment
import com.krishihr.app.ui.leave.LeaveFragment
import com.krishihr.app.ui.more.*
import com.krishihr.app.ui.chat.ChatFragment
import com.krishihr.app.ui.payroll.PayrollFragment
import com.krishihr.app.utils.*
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import java.text.SimpleDateFormat
import java.util.*
import kotlin.coroutines.resume

class DashboardFragment : Fragment() {

    private var _b: FragmentDashboardBinding? = null
    private val binding get() = _b!!
    private var timerJob: Job? = null
    private var clockJob: Job? = null

    // ── Quick-punch from dashboard ───────────────────────────────────────────
    private var hasPunchedIn  = false
    private var hasPunchedOut = false
    private var isPunching    = false
    private lateinit var permissionManager: PermissionManager

    private val gpsSettingsLauncher = registerForActivityResult(
        ActivityResultContracts.StartIntentSenderForResult()
    ) { lifecycleScope.launch { executeDashboardPunch() } }

    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View {
        _b = FragmentDashboardBinding.inflate(i, c, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        permissionManager = PermissionManager(this)
        startLiveClock() // Start system clock immediately
        setupProfile()
        setupRoleBasedUI()
        loadDashboard()
        loadAnnouncements()
        loadBirthdays()

        // Project section moved to More > Project Management
    }

    private fun setupProfile() {
        val session = SessionManager(requireContext())
        session.getEmployee()?.let { emp ->
            binding.tvName.text        = emp.fullName
            binding.tvGreeting.text    = getGreeting()
            binding.tvDesignation.text = "${emp.designationTitle ?: emp.displayRole} · ${emp.employeeCode ?: ""}"
            val empWithPhoto = if (emp.profilePhoto.isNullOrBlank()) {
                val cached = session.getEmployeePhoto(emp.id)
                if (cached != null) {
                    session.savePhotoToFile(cached)
                    emp.copy(profilePhoto = cached)
                } else emp
            } else emp
            loadHeaderAvatar(empWithPhoto)
        }
        val sdf = SimpleDateFormat("EEEE, dd MMM yyyy", Locale.getDefault()).also {
            it.timeZone = TimeZone.getTimeZone("Asia/Kolkata")
        }
        binding.tvTodayDate.text = sdf.format(Date())

        lifecycleScope.launch {
            try {
                val res = RetrofitClient.instance.getMe()
                if (res.isSuccessful && res.body()?.success == true) {
                    val serverEmp = res.body()!!.data ?: return@launch
                    session.updateEmployee(serverEmp)
                    val cachedPhoto = session.getPhotoFromFile() ?: session.getEmployeePhoto(serverEmp.id)
                    val emp = if (serverEmp.profilePhoto.isNullOrBlank() && cachedPhoto != null)
                        serverEmp.copy(profilePhoto = cachedPhoto) else serverEmp
                    if (serverEmp.profilePhoto.isNullOrBlank() && cachedPhoto != null) {
                        session.savePhotoToFile(cachedPhoto)
                    }
                    if (_b == null) return@launch
                    binding.tvName.text        = emp.fullName
                    binding.tvGreeting.text    = getGreeting()
                    binding.tvDesignation.text = "${emp.designationTitle ?: emp.displayRole} · ${emp.employeeCode ?: ""}"
                    loadHeaderAvatar(emp)
                }
            } catch (_: Exception) {}
        }
    }

    private fun setupRoleBasedUI() {
        val role = SessionManager(requireContext()).getRole()

        binding.menuAttendance.setOnClickListener    { nav(AttendanceFragment()) }
        binding.menuLeave.setOnClickListener         { nav(LeaveFragment()) }
        binding.menuPayslip.setOnClickListener       { nav(PayrollFragment()) }
        binding.menuAdvance.setOnClickListener       { nav(AdvanceFragment()) }
        binding.menuProfile.setOnClickListener       { nav(ProfileFragment()) }
        binding.menuQuiz.setOnClickListener          { nav(GkQuizFragment()) }

        binding.cardPunch.setOnClickListener { startDashboardPunch() }
        binding.cardPunch.setOnLongClickListener {
            it.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
            startDashboardPunch()
            true
        }
        binding.btnMarkAttendance.setOnClickListener {
            it.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
            startDashboardPunch()
        }

        binding.headerAvatar.setOnClickListener      { nav(ProfileFragment()) }
        binding.notifBtn.setOnClickListener          { nav(NotificationsFragment()) }
        binding.cardBirthday.setOnClickListener      { nav(BirthdaysFragment()) }
        binding.tvViewAllAnnouncements.setOnClickListener { nav(AnnouncementsFragment()) }
        binding.menuBirthdays.setOnClickListener     { nav(BirthdaysFragment()) }
        try { binding.menuChat.setOnClickListener     { nav(ChatFragment()) } } catch (_: Exception) {}

        val hasTeam = role == Roles.MANAGER || role == Roles.TL || role == Roles.ADMIN || role == Roles.HR || role == Roles.SUPER_ADMIN
        if (hasTeam) {
            binding.tvMenuAnnouncementsLabel.text = "Team Today"
            binding.menuAnnouncements.setOnClickListener { nav(TeamTodayFragment()) }
        } else {
            binding.tvMenuAnnouncementsLabel.text = "News"
            binding.menuAnnouncements.setOnClickListener { nav(AnnouncementsFragment()) }
        }

        val isAccounts = role == Roles.ACCOUNTS
        if (!isAccounts && (Roles.canApproveLeave(role) || Roles.canManageEmployees(role))) {
            binding.menuEmployees.visibility = View.VISIBLE
            binding.menuEmployees.setOnClickListener { nav(EmployeesFragment()) }
            binding.menuApprovals.setOnClickListener { nav(ApprovalsFragment()) }
            // Show Approvals icon for ALL non-employee, non-accounts roles
            // Manager/TL can approve; HR/Admin can view
            binding.menuApprovals.visibility = if (role != Roles.EMPLOYEE) View.VISIBLE else View.GONE
        }

        val emp = SessionManager(requireContext()).getEmployee()
        val isKC718 = emp?.employeeCode == AndroidMain.SEE_ALL_MOVEMENT_CODE
        val canSeeMovement = !isAccounts && (isKC718 || role == Roles.SUPER_ADMIN || role == Roles.HR || role == Roles.ADMIN || role == Roles.MANAGER || role == Roles.TL)
        if (canSeeMovement) {
            binding.menuMovement.visibility = View.VISIBLE
            binding.menuMovement.setOnClickListener { nav(MovementFragment()) }
        }

        val canSeeGeofence = Roles.canSeeGeofence(role)
        if (canSeeGeofence) {
            binding.menuGeofence.visibility = View.VISIBLE
            binding.menuGeofence.setOnClickListener { nav(GeofenceAdminFragment()) }
        }
    }

    private fun loadDashboard() {
        lifecycleScope.launch {
            try {
                val res = RetrofitClient.instance.getDashboard()
                if (res.isSuccessful && res.body()?.success == true) {
                    val d = res.body()!!.data ?: return@launch
                    if (_b == null) return@launch

                    val att = d.todayAttendance
                    val hasPunchIn  = att?.punchIn  != null
                    val hasPunchOut = att?.punchOut != null
                    hasPunchedIn  = hasPunchIn
                    hasPunchedOut = hasPunchOut

                    binding.tvPunchInTime.text = att?.displayPunchIn ?: att?.punchIn?.let { AttendanceRecord.parseTime(it) } ?: "--:--"
                    binding.tvPunchOutTime.text = att?.displayPunchOut ?: att?.punchOut?.let { AttendanceRecord.parseTime(it) } ?: "--:--"

                    // Update Mark Attendance status lines
                    when {
                        hasPunchIn && hasPunchOut -> {
                            binding.tvAttendanceStatusLine2.text = "Marked out · punch received"
                            binding.llActivePill.visibility = View.GONE
                        }
                        hasPunchIn && !hasPunchOut -> {
                            binding.tvAttendanceStatusLine2.text = "Marked in · punch not received"
                            binding.llActivePill.visibility = View.VISIBLE
                        }
                        else -> {
                            binding.tvAttendanceStatusLine2.text = "Not marked · punch not received"
                            binding.llActivePill.visibility = View.GONE
                        }
                    }

                    val todayHrs = att?.workingHours ?: 0.0
                    if (hasPunchIn && hasPunchOut && todayHrs > 0) {
                        val todayMins = (todayHrs * 60).toInt()
                        binding.tvTotalHours.text = "${todayMins / 60}h ${todayMins % 60}m"
                        binding.tvTimer.text = String.format("%02d:%02d:00", todayMins / 60, todayMins % 60)
                        timerJob?.cancel()
                    } else if (hasPunchIn && !hasPunchOut) {
                        binding.tvTotalHours.text = "--"
                        startLiveTimer(att?.punchIn)
                    } else {
                        binding.tvTotalHours.text = "--"
                        binding.tvTimer.text = "00:00:00"
                        timerJob?.cancel()
                    }



                    val ms = d.monthlySummary
                    binding.tvPresent.text = ms?.present?.toString() ?: "0"
                    val serverAbsent = ms?.absent ?: 0
                    val correctedAbsent = if (hasPunchIn && !hasPunchOut && serverAbsent > 0) serverAbsent - 1 else serverAbsent
                    binding.tvAbsent.text = correctedAbsent.toString()

                    val present = ms?.present ?: 0
                    val totalHrs2 = ms?.totalHours ?: 0.0
                    val avgHrs = if (ms?.avgHours != null && ms.avgHours > 0.0) ms.avgHours else if (present > 0) totalHrs2 / present else 0.0
                    val avgTotalMinutes = (avgHrs * 60).toInt()
                    binding.tvMonthHours.text = "${avgTotalMinutes / 60}h ${avgTotalMinutes % 60}m"

                    val unread  = d.unreadNotifications
                    val pending = d.pendingLeaveApprovals + d.pendingRegularizations
                    val badgeCount = if (unread > 0) unread else if (pending > 0) pending else 0
                    if (badgeCount > 0) {
                        binding.tvPendingBadge.text = if (badgeCount > 99) "99+" else badgeCount.toString()
                        binding.tvPendingBadge.visibility = View.VISIBLE
                    } else {
                        binding.tvPendingBadge.visibility = View.GONE
                    }
                }
            } catch (_: Exception) {}
        }
    }

    private fun startLiveClock() {
        clockJob?.cancel()
        clockJob = lifecycleScope.launch {
            val sdf = SimpleDateFormat("hh:mm:ss a", Locale.getDefault()).also {
                it.timeZone = TimeZone.getTimeZone("Asia/Kolkata")
            }
            while (isActive) {
                binding.tvTimer.text = sdf.format(Date())
                delay(1000)
            }
        }
    }

    private fun startLiveTimer(punchInStr: String?) {
        if (punchInStr.isNullOrBlank()) return
        timerJob?.cancel()
        timerJob = lifecycleScope.launch {
            val cleanStr = punchInStr.replace(" ", "T").substringBefore(".")
            val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault()).apply {
                timeZone = TimeZone.getTimeZone("Asia/Kolkata")
            }
            val punchTime = try { sdf.parse(cleanStr)?.time ?: 0L } catch (e: Exception) { 0L }
            if (punchTime == 0L) return@launch

            while (isActive) {
                val now = System.currentTimeMillis()
                val diffMs = now - punchTime
                val seconds = (diffMs / 1000).coerceAtLeast(0)
                val h = seconds / 3600
                val m = (seconds % 3600) / 60
                val s = seconds % 60

                binding.tvTimer.text = String.format("%02d:%02d:%02d", h, m, s)
                delay(1000)
            }
        }
    }

    private fun loadAnnouncements() {
        // Load holidays separately from feed
        lifecycleScope.launch {
            try {
                val res = RetrofitClient.instance.getAnnouncementFeed()
                if (res.isSuccessful && res.body()?.success == true) {
                    val feed = res.body()!!.data ?: return@launch
                    if (_b == null) return@launch
                    val holiday = feed.upcomingHolidays?.firstOrNull()
                    if (holiday != null) {
                        binding.tvNextHoliday.text = "${holiday.name} · ${holiday.date.toDisplayDate()}"
                        binding.cardHoliday.visibility = View.VISIBLE
                    }
                }
            } catch (_: Exception) {}
        }

        // Load announcements from dedicated endpoint (feed endpoint returns null for announcements)
        lifecycleScope.launch {
            try {
                val res = RetrofitClient.instance.getAnnouncements()
                if (res.isSuccessful && res.body()?.success == true) {
                    val items = res.body()!!.data
                    if (_b == null) return@launch
                    binding.tvViewAllAnnouncements.visibility = View.VISIBLE
                    if (!items.isNullOrEmpty()) {
                        binding.llAnnouncementsContainer.removeAllViews()
                        val likeStates    = items.associate { it.id to it.iLiked }.toMutableMap()
                        val likeCounts    = items.associate { it.id to it.likeCount }.toMutableMap()
                        val commentCounts = items.associate { it.id to it.commentCount }.toMutableMap()

                        items.take(2).forEach { ann ->
                            val ctx2 = requireContext()
                            val dp2  = ctx2.resources.displayMetrics.density
                            val card = androidx.cardview.widget.CardView(ctx2).apply {
                                radius = 14*dp2; cardElevation = 2*dp2
                                setCardBackgroundColor(ctx2.getColor(R.color.surface))
                                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.bottomMargin = (10*dp2).toInt() }
                            }
                            val ll = LinearLayout(ctx2).apply { orientation = LinearLayout.VERTICAL }
                            if (!ann.imageUrl.isNullOrBlank()) {
                                val img = ImageView(ctx2).apply {
                                    layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (200*dp2).toInt())
                                    scaleType = ImageView.ScaleType.CENTER_CROP
                                }
                                com.bumptech.glide.Glide.with(ctx2).load(ann.imageUrl).into(img)
                                ll.addView(img)
                            }
                            val body = LinearLayout(ctx2).apply {
                                orientation = LinearLayout.VERTICAL
                                setPadding((14*dp2).toInt(),(12*dp2).toInt(),(14*dp2).toInt(),(4*dp2).toInt())
                            }
                            body.addView(TextView(ctx2).apply {
                                text = (ann.type ?: "general").uppercase()
                                textSize = 9f
                                setTypeface(null, android.graphics.Typeface.BOLD)
                                setTextColor(android.graphics.Color.parseColor("#1565C0"))
                                setPadding((8*dp2).toInt(),(2*dp2).toInt(),(8*dp2).toInt(),(2*dp2).toInt())
                                background = android.graphics.drawable.GradientDrawable().apply {
                                    setColor(android.graphics.Color.parseColor("#E3F2FD"))
                                    cornerRadius = 99*dp2
                                }
                                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.bottomMargin = (6*dp2).toInt() }
                            })
                            body.addView(TextView(ctx2).apply {
                                text = ann.title; textSize = 14f
                                setTypeface(null, android.graphics.Typeface.BOLD)
                                setTextColor(ctx2.getColor(R.color.text_primary))
                                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.bottomMargin = (4*dp2).toInt() }
                            })
                            if (!ann.content.isNullOrBlank()) {
                                body.addView(TextView(ctx2).apply {
                                    text = ann.content; textSize = 12f
                                    setTextColor(ctx2.getColor(R.color.text_secondary))
                                    setLineSpacing(0f, 1.4f)
                                    layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.bottomMargin = (8*dp2).toInt() }
                                })
                            }
                            body.addView(TextView(ctx2).apply {
                                text = "By ${ann.authorName ?: "Admin"} · ${ann.createdAt?.take(10) ?: ""}"
                                textSize = 10f; setTextColor(ctx2.getColor(R.color.text_hint))
                                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.bottomMargin = (10*dp2).toInt() }
                            })
                            val actionBar = LinearLayout(ctx2).apply {
                                orientation = LinearLayout.HORIZONTAL
                                setPadding(0, 0, 0, (4*dp2).toInt())
                            }
                            val liked = likeStates[ann.id] ?: false
                            val lkCount = likeCounts[ann.id] ?: 0
                            val cmCount = commentCounts[ann.id] ?: 0
                            val likeBtn = Button(ctx2).apply {
                                text = "❤️ $lkCount"; textSize = 12f; isAllCaps = false
                                setPadding((14*dp2).toInt(),(6*dp2).toInt(),(14*dp2).toInt(),(6*dp2).toInt())
                                setTextColor(if (liked) android.graphics.Color.parseColor("#dc2626") else ctx2.getColor(R.color.text_hint))
                                background = android.graphics.drawable.GradientDrawable().apply {
                                    setColor(if (liked) android.graphics.Color.parseColor("#fee2e2") else android.graphics.Color.parseColor("#F8FAFC"))
                                    cornerRadius = 99*dp2
                                    setStroke((1*dp2).toInt(), if (liked) android.graphics.Color.parseColor("#fca5a5") else android.graphics.Color.parseColor("#E2E8F0"))
                                }
                                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.marginEnd = (8*dp2).toInt() }
                            }
                            val cmBtn = Button(ctx2).apply {
                                text = "💬 $cmCount"; textSize = 12f; isAllCaps = false
                                setPadding((14*dp2).toInt(),(6*dp2).toInt(),(14*dp2).toInt(),(6*dp2).toInt())
                                setTextColor(ctx2.getColor(R.color.text_hint))
                                background = android.graphics.drawable.GradientDrawable().apply {
                                    setColor(android.graphics.Color.parseColor("#F8FAFC"))
                                    cornerRadius = 99*dp2
                                    setStroke((1*dp2).toInt(), android.graphics.Color.parseColor("#E2E8F0"))
                                }
                            }
                            val cmSection = LinearLayout(ctx2).apply {
                                orientation = LinearLayout.VERTICAL; visibility = View.GONE
                                setPadding(0,(8*dp2).toInt(),0,0)
                            }
                            val cmList = LinearLayout(ctx2).apply { orientation = LinearLayout.VERTICAL }
                            val cmInput = EditText(ctx2).apply {
                                hint = "Write a comment…"; textSize = 12f
                                setPadding((10*dp2).toInt(),(8*dp2).toInt(),(10*dp2).toInt(),(8*dp2).toInt())
                                background = android.graphics.drawable.GradientDrawable().apply {
                                    setColor(android.graphics.Color.WHITE); cornerRadius = 8*dp2
                                    setStroke((1*dp2).toInt(), android.graphics.Color.parseColor("#E2E8F0"))
                                }
                                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = (8*dp2).toInt() }
                            }
                            val postBtn = Button(ctx2).apply {
                                text = "Post"; textSize = 12f; isAllCaps = false
                                setTextColor(android.graphics.Color.WHITE)
                                background = android.graphics.drawable.GradientDrawable().apply {
                                    setColor(android.graphics.Color.parseColor("#2e7d32")); cornerRadius = 8*dp2
                                }
                                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = (6*dp2).toInt() }
                            }
                            cmSection.addView(cmList); cmSection.addView(cmInput); cmSection.addView(postBtn)
                            likeBtn.setOnClickListener {
                                lifecycleScope.launch {
                                    try {
                                        val resp = RetrofitClient.instance.toggleAnnouncementLike(ann.id)
                                        if (resp.isSuccessful) {
                                            val result = resp.body()?.data
                                            val nowLiked = result?.liked ?: !(likeStates[ann.id] ?: false)
                                            val nowCount = result?.likeCount ?: if (nowLiked) (likeCounts[ann.id] ?: 0) + 1 else maxOf(0, (likeCounts[ann.id] ?: 0) - 1)
                                            likeStates[ann.id] = nowLiked
                                            likeCounts[ann.id] = nowCount
                                            likeBtn.text = "❤️ $nowCount"
                                            likeBtn.setTextColor(if (nowLiked) android.graphics.Color.parseColor("#dc2626") else ctx2.getColor(R.color.text_hint))
                                            (likeBtn.background as? android.graphics.drawable.GradientDrawable)?.setColor(if (nowLiked) android.graphics.Color.parseColor("#fee2e2") else android.graphics.Color.parseColor("#F8FAFC"))
                                        }
                                    } catch (_: Exception) {}
                                }
                            }
                            cmBtn.setOnClickListener {
                                if (cmSection.visibility == View.VISIBLE) {
                                    cmSection.visibility = View.GONE
                                } else {
                                    cmSection.visibility = View.VISIBLE
                                    lifecycleScope.launch {
                                        try {
                                            val resp = RetrofitClient.instance.getAnnouncementComments(ann.id)
                                            val comments = resp.body()?.data ?: emptyList()
                                            cmList.removeAllViews()
                                            if (comments.isEmpty()) {
                                                cmList.addView(TextView(ctx2).apply { text = "No comments yet."; textSize = 12f; setTextColor(ctx2.getColor(R.color.text_hint)) })
                                            } else {
                                                comments.forEach { c -> cmList.addView(TextView(ctx2).apply { text = "${c.employeeName ?: "User"}: ${c.comment}"; textSize = 12f; setTextColor(ctx2.getColor(R.color.text_secondary)); setPadding(0,(4*dp2).toInt(),0,(4*dp2).toInt()) }) }
                                            }
                                        } catch (_: Exception) {}
                                    }
                                }
                            }
                            postBtn.setOnClickListener {
                                val textValue = cmInput.text.toString().trim()
                                if (textValue.isBlank()) return@setOnClickListener
                                lifecycleScope.launch {
                                    try {
                                        postBtn.isEnabled = false; postBtn.setText("Posting…")
                                        val resp = RetrofitClient.instance.addAnnouncementComment(ann.id, com.krishihr.app.data.models.CommentRequest(textValue))
                                        if (resp.isSuccessful || resp.code() == 201) {
                                            cmInput.text.clear()
                                            val nowCount = (commentCounts[ann.id] ?: 0) + 1
                                            commentCounts[ann.id] = nowCount
                                            cmBtn.setText("💬 $nowCount")
                                            cmList.addView(TextView(ctx2).apply { this.text = "You: $textValue"; textSize = 12f; setTextColor(ctx2.getColor(R.color.text_secondary)); setPadding(0,(4*dp2).toInt(),0,(4*dp2).toInt()) })
                                            Toast.makeText(ctx2, "Comment posted ✅", Toast.LENGTH_SHORT).show()
                                        }
                                    } catch (_: Exception) {} finally { postBtn.isEnabled = true; postBtn.setText("Post") }
                                }
                            }
                            actionBar.addView(likeBtn); actionBar.addView(cmBtn)
                            body.addView(actionBar); body.addView(cmSection); ll.addView(body); card.addView(ll)
                            binding.llAnnouncementsContainer.addView(card)
                        }
                    }
                }
            } catch (_: Exception) {}
        }
    }

    private fun loadBirthdays() {
        lifecycleScope.launch {
            try {
                val res = RetrofitClient.instance.getUpcomingBirthdays()
                if (_b == null) return@launch
                val birthdays = res.body()?.data ?: return@launch
                val todayBds  = birthdays.filter { it.isToday2 }
                val upcoming  = birthdays.filter { !it.isToday2 }
                if (todayBds.isNotEmpty()) {
                    binding.tvBirthdayToday.text = "🎂  Happy Birthday, ${todayBds.joinToString(", ") { it.displayName }}!"
                    binding.cardBirthday.visibility = View.VISIBLE
                } else if (upcoming.isNotEmpty()) {
                    val next = upcoming.first()
                    binding.tvBirthdayToday.text = "🎂 ${next.displayName}'s birthday in ${next.daysUntil} day(s) · ${next.birthDisplay ?: ""}"
                    binding.cardBirthday.visibility = View.VISIBLE
                }
            } catch (_: Exception) {}
        }
    }

    private fun nav(f: Fragment) = (activity as? MainActivity)?.loadFragment(f)

    private fun loadHeaderAvatar(emp: com.krishihr.app.data.models.Employee) {
        if (_b == null) return
        val initials = emp.initials
        val session = SessionManager(requireContext())
        val photo = emp.profilePhoto?.ifBlank { null } ?: session.getPhotoFromFile() ?: session.getEmployeePhoto(emp.id)

        if (!photo.isNullOrBlank()) {
            binding.headerAvatarInitials.visibility = View.GONE
            try {
                if (photo.startsWith("data:image")) {
                    val bytes = android.util.Base64.decode(photo.substringAfter(","), android.util.Base64.DEFAULT)
                    val bmp = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                    if (bmp != null) com.bumptech.glide.Glide.with(requireContext()).load(bmp).circleCrop().into(binding.headerAvatarImg)
                    else { binding.headerAvatarInitials.visibility = View.VISIBLE; binding.headerAvatarInitials.text = initials }
                } else { com.bumptech.glide.Glide.with(requireContext()).load(photo).circleCrop().into(binding.headerAvatarImg) }
            } catch (_: Exception) { binding.headerAvatarInitials.visibility = View.VISIBLE; binding.headerAvatarInitials.text = initials }
        } else { binding.headerAvatarInitials.visibility = View.VISIBLE; binding.headerAvatarInitials.text = initials }
    }

    fun clearNotifBadge() { if (_b != null) binding.tvPendingBadge.visibility = View.GONE }

    fun loadProjectQuickAccess(container: android.widget.LinearLayout) {
        val role = SessionManager(requireContext()).getRole()
        val adminRoles = listOf("accounts", "super_admin", "admin", "manager", "hr", "tl")
        if (role !in adminRoles) return

        lifecycleScope.launch {
            try {
                val ctx = requireContext(); val dp = ctx.resources.displayMetrics.density

                // Summary
                val sumRes = RetrofitClient.instance.getProjectSummary()
                val sum = sumRes.body()?.data

                // Projects list
                val projRes = RetrofitClient.instance.getProjects(status = "active")
                val projects = projRes.body()?.data ?: emptyList()
                if (projects.isEmpty() && sum == null) return@launch
                if (_b == null) return@launch

                container.removeAllViews()

                // Section title
                container.addView(TextView(ctx).apply {
                    text = "📊 Project Budget"; textSize = 16f
                    setTypeface(null, android.graphics.Typeface.BOLD)
                    setTextColor(ctx.getColor(R.color.text_primary))
                    layoutParams = android.widget.LinearLayout.LayoutParams(android.widget.LinearLayout.LayoutParams.MATCH_PARENT, android.widget.LinearLayout.LayoutParams.WRAP_CONTENT).also { it.bottomMargin = (10*dp).toInt() }
                })

                // Summary row
                if (sum != null) {
                    val summaryRow = android.widget.LinearLayout(ctx).apply {
                        orientation = android.widget.LinearLayout.HORIZONTAL
                        layoutParams = android.widget.LinearLayout.LayoutParams(android.widget.LinearLayout.LayoutParams.MATCH_PARENT, android.widget.LinearLayout.LayoutParams.WRAP_CONTENT).also { it.bottomMargin = (12*dp).toInt() }
                    }
                    fun summaryChip(label: String, value: String, color: String): androidx.cardview.widget.CardView {
                        return androidx.cardview.widget.CardView(ctx).apply {
                            radius = 10*dp; cardElevation = 2*dp
                            setCardBackgroundColor(android.graphics.Color.parseColor(color))
                            layoutParams = android.widget.LinearLayout.LayoutParams(0, android.widget.LinearLayout.LayoutParams.WRAP_CONTENT, 1f).also { it.marginEnd = (6*dp).toInt() }
                            addView(android.widget.LinearLayout(ctx).apply {
                                orientation = android.widget.LinearLayout.VERTICAL
                                setPadding((10*dp).toInt(),(8*dp).toInt(),(10*dp).toInt(),(8*dp).toInt())
                                addView(TextView(ctx).apply { text = value; textSize = 13f; setTypeface(null, android.graphics.Typeface.BOLD); setTextColor(android.graphics.Color.parseColor("#1a1a1a")) })
                                addView(TextView(ctx).apply { text = label; textSize = 10f; setTextColor(android.graphics.Color.parseColor("#555555")) })
                            })
                        }
                    }
                    fun fmt(v: Double) = "₹${String.format("%,.0f", v)}"
                    summaryRow.addView(summaryChip("Active Projects", "${sum.activeProjects}", "#E8F5E9"))
                    summaryRow.addView(summaryChip("Total Spent", fmt(sum.totalActual), "#FFF3E0"))
                    summaryRow.addView(summaryChip("Salary Cost", fmt(sum.totalSalary), "#E3F2FD"))
                    container.addView(summaryRow)
                }

                // Project cards
                projects.take(5).forEach { proj ->
                    val utilPct = if (proj.totalBudget > 0) (proj.actualCost / proj.totalBudget * 100).toFloat().coerceIn(0f, 100f) else 0f
                    val card = androidx.cardview.widget.CardView(ctx).apply {
                        radius = 12*dp; cardElevation = 3*dp
                        setCardBackgroundColor(android.graphics.Color.WHITE)
                        layoutParams = android.widget.LinearLayout.LayoutParams(android.widget.LinearLayout.LayoutParams.MATCH_PARENT, android.widget.LinearLayout.LayoutParams.WRAP_CONTENT).also { it.bottomMargin = (10*dp).toInt() }
                    }
                    val inner = android.widget.LinearLayout(ctx).apply {
                        orientation = android.widget.LinearLayout.VERTICAL
                        setPadding((14*dp).toInt(),(12*dp).toInt(),(14*dp).toInt(),(12*dp).toInt())
                    }
                    // Header row
                    val headerRow = android.widget.LinearLayout(ctx).apply { orientation = android.widget.LinearLayout.HORIZONTAL }
                    headerRow.addView(TextView(ctx).apply {
                        text = proj.name; textSize = 14f; setTypeface(null, android.graphics.Typeface.BOLD)
                        setTextColor(ctx.getColor(R.color.text_primary))
                        layoutParams = android.widget.LinearLayout.LayoutParams(0, android.widget.LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                    })
                    headerRow.addView(TextView(ctx).apply {
                        text = proj.code ?: ""; textSize = 11f
                        setTextColor(android.graphics.Color.parseColor("#888888"))
                        layoutParams = android.widget.LinearLayout.LayoutParams(android.widget.LinearLayout.LayoutParams.WRAP_CONTENT, android.widget.LinearLayout.LayoutParams.WRAP_CONTENT)
                    })
                    inner.addView(headerRow)
                    // Spend row
                    inner.addView(TextView(ctx).apply {
                        text = "Spent: ₹${String.format("%,.0f", proj.actualCost)}  /  Budget: ₹${String.format("%,.0f", proj.totalBudget)}"
                        textSize = 12f; setTextColor(android.graphics.Color.parseColor("#555555"))
                        layoutParams = android.widget.LinearLayout.LayoutParams(android.widget.LinearLayout.LayoutParams.MATCH_PARENT, android.widget.LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = (4*dp).toInt() }
                    })
                    // Progress bar
                    inner.addView(android.widget.ProgressBar(ctx, null, android.R.attr.progressBarStyleHorizontal).apply {
                        max = 100; progress = utilPct.toInt()
                        progressDrawable.setColorFilter(
                            if (utilPct > 90) android.graphics.Color.parseColor("#ef4444") else android.graphics.Color.parseColor("#22c55e"),
                            android.graphics.PorterDuff.Mode.SRC_IN
                        )
                        layoutParams = android.widget.LinearLayout.LayoutParams(android.widget.LinearLayout.LayoutParams.MATCH_PARENT, (6*dp).toInt()).also { it.topMargin = (6*dp).toInt() }
                    })
                    // Cost breakdown chips
                    val chipRow = android.widget.LinearLayout(ctx).apply {
                        orientation = android.widget.LinearLayout.HORIZONTAL
                        layoutParams = android.widget.LinearLayout.LayoutParams(android.widget.LinearLayout.LayoutParams.MATCH_PARENT, android.widget.LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = (6*dp).toInt() }
                    }
                    fun chip(text: String, bg: String): TextView = TextView(ctx).apply {
                        this.text = text; textSize = 10f; setTextColor(android.graphics.Color.parseColor("#333333"))
                        background = android.graphics.drawable.GradientDrawable().apply { setColor(android.graphics.Color.parseColor(bg)); cornerRadius = 20*dp }
                        setPadding((6*dp).toInt(),(2*dp).toInt(),(6*dp).toInt(),(2*dp).toInt())
                        layoutParams = android.widget.LinearLayout.LayoutParams(android.widget.LinearLayout.LayoutParams.WRAP_CONTENT, android.widget.LinearLayout.LayoutParams.WRAP_CONTENT).also { it.marginEnd = (4*dp).toInt() }
                    }
                    if (proj.salaryCost > 0) chipRow.addView(chip("Sal ₹${String.format("%,.0f", proj.salaryCost)}", "#dbeafe"))
                    if (proj.advanceCost > 0) chipRow.addView(chip("Adv ₹${String.format("%,.0f", proj.advanceCost)}", "#fef3c7"))
                    if (proj.reimbursementCost > 0) chipRow.addView(chip("Reimb ₹${String.format("%,.0f", proj.reimbursementCost)}", "#ede9fe"))
                    inner.addView(chipRow)
                    card.addView(inner); container.addView(card)
                }
                container.visibility = View.VISIBLE
                container.post { container.requestLayout() }
            } catch (_: Exception) {}
        }
    }

    // ── Dashboard quick-punch ──────────────────────────────────────────────────

    private fun startDashboardPunch() {
        if (isPunching) { Toast.makeText(requireContext(), "⏳ Already processing, please wait...", Toast.LENGTH_SHORT).show(); return }
        permissionManager.checkAndRequestAll { granted ->
            if (granted) checkGpsAndDashboardPunch()
        }
    }

    private fun checkGpsAndDashboardPunch() {
        val locationRequest = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, AndroidMain.GEOFENCE_LOCATION_REQUEST_MS).build()
        val settingsRequest = LocationSettingsRequest.Builder().addLocationRequest(locationRequest).setAlwaysShow(true).build()
        val settingsClient: SettingsClient = LocationServices.getSettingsClient(requireActivity())
        settingsClient.checkLocationSettings(settingsRequest)
            .addOnSuccessListener { lifecycleScope.launch { executeDashboardPunch() } }
            .addOnFailureListener { exception ->
                if (exception is ResolvableApiException) {
                    try { gpsSettingsLauncher.launch(IntentSenderRequest.Builder(exception.resolution).build()) }
                    catch (_: Exception) { lifecycleScope.launch { executeDashboardPunch() } }
                } else lifecycleScope.launch { executeDashboardPunch() }
            }
    }

    private suspend fun executeDashboardPunch() {
        if (isPunching) return
        isPunching = true
        val ctx = requireContext()
        try {
            // Dim the button to show loading
            if (_b != null) {
                binding.btnMarkAttendance.isEnabled = false
                binding.btnMarkAttendance.alpha = 0.5f
            }

            // 1. Get current GPS location
            var lat: Double? = null; var lng: Double? = null; var locLabel = "Manual"
            try {
                val loc = getDashboardLocation()
                lat = loc?.latitude; lng = loc?.longitude
                if (lat != null) locLabel = "GPS: ${String.format("%.4f", lat)},${String.format("%.4f", lng)}"
            } catch (_: Exception) {}

            // 2. Validate geofence buffer (only if we got a location)
            var geofenceValid: Boolean? = null
            if (lat != null && lng != null) {
                try {
                    val bufRes  = RetrofitClient.instance.validateBuffer(ValidateBufferRequest(latitude = lat, longitude = lng))
                    val bufData = bufRes.body(); geofenceValid = bufData?.valid
                    if (geofenceValid == false) {
                        val msg = bufData?.message ?: "You are outside your assigned boundary"
                        // Show outside-geofence popup
                        if (_b != null) {
                            androidx.appcompat.app.AlertDialog.Builder(ctx)
                                .setTitle("📍 Outside Boundary")
                                .setMessage("$msg\n\nPlease move inside the designated area to mark attendance.")
                                .setPositiveButton("OK", null)
                                .show()
                        }
                        return
                    }
                } catch (_: Exception) { geofenceValid = null }
            }

            // 3. Execute punch-in or punch-out
            val istTimeSdf = SimpleDateFormat("HH:mm:ss", Locale.getDefault()).also { it.timeZone = TimeZone.getTimeZone("Asia/Kolkata") }
            val istDateSdf = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).also { it.timeZone = TimeZone.getTimeZone("Asia/Kolkata") }
            val now = Date(); val punchTime = istTimeSdf.format(now); val punchDate = istDateSdf.format(now)
            var lastError = "Failed"

            repeat(3) { attempt ->
                try {
                    val req = if (!hasPunchedIn)
                        PunchRequest(lat = lat, lng = lng, punchInLocation = locLabel, punchOutLocation = null, punchTime = punchTime, punchDate = punchDate, source = "mobile", geofenceValid = geofenceValid)
                    else
                        PunchRequest(lat = lat, lng = lng, punchInLocation = null, punchOutLocation = locLabel, punchTime = punchTime, punchDate = punchDate, source = "mobile", geofenceValid = geofenceValid)
                    val res = if (!hasPunchedIn) RetrofitClient.instance.punchIn(req) else RetrofitClient.instance.punchOut(req)

                    if (res.isSuccessful && res.body()?.success == true) {
                        val msg = res.body()?.message ?: if (!hasPunchedIn) "Punched In ✅" else "Punched Out ✅"
                        Toast.makeText(ctx, msg, Toast.LENGTH_SHORT).show()

                        if (!hasPunchedIn) {
                            // Post-punch-in: log movement + start tracking
                            val todayStr = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())
                            val isOnOD = try {
                                val odRes = RetrofitClient.instance.getMyODRequests(status = "approved")
                                (odRes.body()?.data ?: emptyList()).any { od -> (od.fromDate?.take(10) ?: "") <= todayStr && (od.toDate?.take(10) ?: "") >= todayStr }
                            } catch (_: Exception) { false }
                            ctx.getSharedPreferences(TrackingPrefs.PREFS_NAME, android.content.Context.MODE_PRIVATE)
                                .edit().putBoolean(TrackingPrefs.KEY_IS_OD, isOnOD).apply()
                            if (lat != null && lng != null) {
                                try {
                                    RetrofitClient.instance.logMovement(
                                        MovementLogRequest(lat = lat, lng = lng, accuracy = 0f, isOd = isOnOD)
                                    )
                                } catch (e: Exception) {
                                    Log.w("DashboardFragment", "First movement log failed: ${e.message}")
                                }
                            }
                            val session = SessionManager(ctx)
                            val satPolicy = session.getEmployee()?.saturdayPolicy ?: ""
                            val isOffsiteEmp = satPolicy == "all_working"
                            if (isOffsiteEmp || isOnOD) {
                                LocationTrackingService.start(ctx, isOd = isOnOD)
                                LocationTrackingService.requestBatteryExemption(ctx)
                            }
                            hasPunchedIn = true
                        } else {
                            // Post-punch-out: stop tracking
                            LocationTrackingService.stop(ctx, StopReason.PUNCH_OUT)
                            ctx.getSharedPreferences(AndroidMain.PREFS_LEAVE_CACHE, android.content.Context.MODE_PRIVATE)
                                .edit().putBoolean("balance_stale", true).apply()
                            hasPunchedOut = true
                        }
                        // Refresh dashboard data
                        loadDashboard()
                        return
                    } else {
                        lastError = res.body()?.message ?: res.errorBody()?.string()?.take(120) ?: "Server error ${res.code()}"
                        if (attempt < 2) delay(AndroidMain.PUNCH_RETRY_DELAY_MS)
                    }
                } catch (e: Exception) {
                    lastError = "Network error: ${e.message}"
                    if (attempt < 2) delay(AndroidMain.PUNCH_RETRY_DELAY_MS)
                }
            }
            Toast.makeText(ctx, "❌ $lastError", Toast.LENGTH_LONG).show()
        } finally {
            isPunching = false
            if (_b != null) {
                binding.btnMarkAttendance.isEnabled = true
                binding.btnMarkAttendance.alpha = 1.0f
            }
        }
    }

    private suspend fun getDashboardLocation(): Location? {
        val client = LocationServices.getFusedLocationProviderClient(requireActivity())
        return try {
            val last = suspendCancellableCoroutine<Location?> { cont ->
                try { client.lastLocation.addOnSuccessListener { cont.resume(it, null) }.addOnFailureListener { cont.resume(null, null) } }
                catch (_: SecurityException) { cont.resume(null, null) }
            }
            if (last != null) return last
            val balanced = withTimeoutOrNull(8_000L) {
                suspendCancellableCoroutine<Location?> { cont ->
                    val cts = CancellationTokenSource(); cont.invokeOnCancellation { cts.cancel() }
                    try { client.getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, cts.token).addOnSuccessListener { cont.resume(it, null) }.addOnFailureListener { cont.resume(null, null) } }
                    catch (_: SecurityException) { cont.resume(null, null) }
                }
            }
            if (balanced != null) return balanced
            withTimeoutOrNull(12_000L) {
                suspendCancellableCoroutine { cont ->
                    val cts = CancellationTokenSource(); cont.invokeOnCancellation { cts.cancel() }
                    try { client.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cts.token).addOnSuccessListener { cont.resume(it, null) }.addOnFailureListener { cont.resume(null, null) } }
                    catch (_: SecurityException) { cont.resume(null, null) }
                }
            }
        } catch (_: Exception) { null }
    }

    override fun onDestroyView() {
        timerJob?.cancel()
        clockJob?.cancel()
        super.onDestroyView()
        _b = null
    }
}