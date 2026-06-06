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
import com.google.android.material.button.MaterialButton
import com.krishihr.app.AndroidMain
import com.krishihr.app.R
import com.krishihr.app.data.api.RetrofitClient
import com.krishihr.app.data.models.*
import com.krishihr.app.ui.MainActivity
import com.krishihr.app.ui.leave.LeaveListAdapter
import com.krishihr.app.ui.payroll.PayrollMgmtFragment
import com.krishihr.app.utils.*
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import java.util.*

// ═══════════════════════════════════════════════════════════════════════════════
// MORE FRAGMENT — role-based menu list
// ═══════════════════════════════════════════════════════════════════════════════
class MoreFragment : Fragment() {

    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View =
        i.inflate(R.layout.fragment_more, c, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        val session = SessionManager(requireContext())
        val emp     = session.getEmployee()
        val role    = emp?.role?.lowercase()?.trim() ?: Roles.EMPLOYEE

        view.findViewById<TextView>(R.id.tvMoreName)?.text  = emp?.fullName ?: "Employee"
        view.findViewById<TextView>(R.id.tvMoreDesig)?.text =
            "${emp?.designationTitle ?: emp?.displayRole}  ·  ${emp?.employeeCode ?: ""}"

        val nav = { frag: Fragment -> (activity as? MainActivity)?.loadFragment(frag) }
        // Set labels on each menu row
        val labels = mapOf(
            R.id.rowProfile to "👤  My Profile",
            R.id.rowNotifications to "🔔  Notifications",
            R.id.rowPayslip to "💰  My Payslip",
            R.id.rowForm16 to "📄  Form 16",
            R.id.rowITDeclaration to "🧾  IT Declaration",
            R.id.rowAdvance to "💵  Advance Salary",
            R.id.rowReimbursement to "🧾  Reimbursement",
            R.id.rowAnnouncements to "📢  Announcements",
            R.id.rowGkQuiz to "🌾  Daily GK Quiz",
            R.id.rowEmployees to "👥  Employees",
            R.id.rowTeamToday to "🗓️  Team Today",
            R.id.rowPendingLeaves to "✅  Pending Leaves",
            R.id.rowRegularizations to "📋  Regularizations",
            R.id.rowAdvanceApprovals to "💳  Advance Approvals",
            R.id.rowSeparation to "🚪  Separation",
            R.id.rowPayrollMgmt to "📊  Payroll Management",
            R.id.rowProvision to "📝  Probation & Confirmation",
            R.id.rowProjectMgmt to "🗂️  Project Management",
            R.id.rowBeatPlan to "📋  Beat Plan / PJP",
            R.id.rowBirthdays to "🎂  Birthdays",
            R.id.rowAnniversaries to "🎉  Work Anniversaries",
            R.id.rowHolidays to "🏖️  Holidays",
            R.id.rowChangePassword to "🔒  Change Password",
            R.id.rowLogout to "⎋  Sign Out"
        )
        labels.forEach { (rowId, label) ->
            view.findViewById<View>(rowId)
                ?.findViewById<android.widget.TextView>(R.id.tvRowLabel)
                ?.text = label
        }



        // Always visible
        view.findViewById<View>(R.id.rowProfile)?.setOnClickListener       { nav(ProfileFragment()) }
        view.findViewById<View>(R.id.rowNotifications)?.setOnClickListener { nav(NotificationsFragment()) }
        view.findViewById<View>(R.id.rowPayslip)?.setOnClickListener       { nav(com.krishihr.app.ui.payroll.PayrollFragment()) }
        view.findViewById<View>(R.id.rowForm16)?.setOnClickListener        { nav(com.krishihr.app.ui.payroll.Form16Fragment()) }
        view.findViewById<View>(R.id.rowITDeclaration)?.setOnClickListener { nav(com.krishihr.app.ui.payroll.ITDeclarationFragment()) }
        view.findViewById<View>(R.id.rowAdvance)?.setOnClickListener       { nav(AdvanceFragment()) }
        view.findViewById<View>(R.id.rowReimbursement)?.setOnClickListener   { nav(ReimbursementFragment()) }
        // Announcements shown fully on Dashboard — hide from More menu
        view.findViewById<View>(R.id.rowAnnouncements)?.visibility = android.view.View.GONE
        view.findViewById<View>(R.id.rowGkQuiz)?.setOnClickListener        { nav(GkQuizFragment()) }
        view.findViewById<View>(R.id.rowBirthdays)?.setOnClickListener       { nav(BirthdaysFragment()) }
        view.findViewById<View>(R.id.rowAnniversaries)?.setOnClickListener   { nav(AnniversariesFragment()) }
        view.findViewById<View>(R.id.rowHolidays)?.setOnClickListener        { nav(HolidaysFragment()) }
        view.findViewById<View>(R.id.rowChangePassword)?.setOnClickListener{ nav(ChangePasswordFragment()) }
        view.findViewById<View>(R.id.rowEmployees)?.setOnClickListener     { nav(EmployeesFragment()) }

        // Logout
        view.findViewById<View>(R.id.rowLogout)?.setOnClickListener {
            android.app.AlertDialog.Builder(requireContext())
                .setTitle("Sign Out")
                .setMessage("Are you sure you want to sign out?")
                .setPositiveButton("Sign Out") { _, _ ->
                    // ✅ FIX: Stop tracking before logout so service doesn't keep
                    // running with expired token causing 401 errors on next login
                    com.krishihr.app.service.LocationTrackingService.stop(
                        requireContext(),
                        com.krishihr.app.domain.model.StopReason.SESSION_EXPIRED
                    )
                    com.krishihr.app.domain.usecase.TrackingManager(requireContext()).clearPunchCache()
                    SessionManager(requireContext()).clearSession()
                    val intent = android.content.Intent(requireContext(), com.krishihr.app.ui.login.LoginActivity::class.java)
                    intent.flags = android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_ACTIVITY_CLEAR_TASK
                    startActivity(intent)
                    requireActivity().finish()
                }.setNegativeButton("Cancel", null).show()
        }

        // Role-gated
        view.findViewById<View>(R.id.rowTeamToday)?.let { row ->
            // Team Today: manager/TL see their team; HR/admin see all (read-only)
            row.visibility = if (role in Roles.IS_APPROVER || Roles.isAdmin(role)) View.VISIBLE else View.GONE
            row.setOnClickListener { nav(TeamTodayFragment()) }
        }
        view.findViewById<View>(R.id.rowPendingLeaves)?.let { row ->
            // Pending Leaves: ONLY reporting manager/TL can approve
            row.visibility = if (Roles.canApproveLeave(role)) View.VISIBLE else View.GONE
            row.setOnClickListener { nav(PendingLeavesFragment()) }
        }
        view.findViewById<View>(R.id.rowRegularizations)?.let { row ->
            // Regularizations: ONLY reporting manager/TL can approve
            row.visibility = if (Roles.canApproveAttendance(role)) View.VISIBLE else View.GONE
            row.setOnClickListener { nav(RegularizationsFragment()) }
        }
        view.findViewById<View>(R.id.rowSeparation)?.let { row ->
            row.visibility = if (Roles.canSeeSeparation(role)) View.VISIBLE else View.GONE
            row.setOnClickListener { nav(SeparationFragment()) }
        }
        view.findViewById<View>(R.id.rowPayrollMgmt)?.let { row ->
            row.visibility = if (Roles.canRunPayroll(role)) View.VISIBLE else View.GONE
            row.setOnClickListener { nav(PayrollMgmtFragment()) }
        }
        view.findViewById<View>(R.id.rowProvision)?.let { row ->
            row.visibility = if (Roles.canSeeProvision(role)) View.VISIBLE else View.GONE
            row.setOnClickListener { nav(ProvisionFragment()) }
        }
        view.findViewById<View>(R.id.rowProjectMgmt)?.let { row ->
            val adminRoles = listOf(Roles.ACCOUNTS, Roles.SUPER_ADMIN, Roles.ADMIN, Roles.MANAGER, Roles.HR, Roles.TL)
            row.visibility = if (role in adminRoles) View.VISIBLE else View.GONE
            row.setOnClickListener { nav(ProjectManagementFragment()) }
        }
        // Beat Plan — HR, Admin, Manager, TL only
        view.findViewById<View>(R.id.rowBeatPlan)?.let { row ->
            val managerRoles = listOf(Roles.HR, Roles.SUPER_ADMIN, Roles.ADMIN, Roles.MANAGER, Roles.TL)
            row.visibility = if (role in managerRoles) View.VISIBLE else View.GONE
            row.setOnClickListener { nav(com.krishihr.app.ui.attendance.BeatPlanFragment()) }
        }

        view.findViewById<View>(R.id.rowAdvanceApprovals)?.let { row ->
            row.visibility = if (Roles.canApproveAdvance(role)) View.VISIBLE else View.GONE
            row.setOnClickListener { nav(AdvanceApprovalsFragment()) }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROFILE FRAGMENT
// ═══════════════════════════════════════════════════════════════════════════════
class ProfileFragment : Fragment() {

    private var photoLauncher: androidx.activity.result.ActivityResultLauncher<android.content.Intent>? = null
    private var cropLauncher:  androidx.activity.result.ActivityResultLauncher<android.content.Intent>? = null
    private var imgViewRef: android.widget.ImageView? = null
    private var initialsViewRef: TextView? = null
    private var empId: Int = -1

    override fun onCreate(s: Bundle?) {
        super.onCreate(s)
        // Step 1: Pick image from gallery
        photoLauncher = registerForActivityResult(
            androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult()
        ) { result ->
            if (result.resultCode == android.app.Activity.RESULT_OK)
                result.data?.data?.let { uri -> launchCrop(uri) }
        }
        // Step 2: Receive cropped result from UCrop
        cropLauncher = registerForActivityResult(
            androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult()
        ) { result ->
            if (result.resultCode == android.app.Activity.RESULT_OK) {
                val uri = com.yalantis.ucrop.UCrop.getOutput(result.data!!)
                if (uri != null) uploadPhoto(uri)
            }
        }
    }

    private fun launchCrop(sourceUri: android.net.Uri) {
        val ctx = requireContext()
        val destUri = android.net.Uri.fromFile(
            java.io.File(ctx.cacheDir, "cropped_profile_${System.currentTimeMillis()}.jpg")
        )
        val uCrop = com.yalantis.ucrop.UCrop.of(sourceUri, destUri)
            .withAspectRatio(1f, 1f)           // square crop
            .withMaxResultSize(400, 400)
            .withOptions(com.yalantis.ucrop.UCrop.Options().apply {
                setCircleDimmedLayer(true)          // circular overlay
                setShowCropGrid(false)
                setShowCropFrame(true)
                setStatusBarColor(ctx.getColor(R.color.primary))
                setToolbarColor(ctx.getColor(R.color.primary))
                setToolbarWidgetColor(ctx.getColor(R.color.white))
                setToolbarTitle("Crop Photo")
                setCompressionQuality(85)
            })
        cropLauncher?.launch(uCrop.getIntent(ctx))
    }

    private fun openPhotoPicker() {
        // Try gallery first, fall back to file picker
        val galleryIntent = android.content.Intent(android.content.Intent.ACTION_PICK,
            android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI).apply {
            type = "image/*"
        }
        val fileIntent = android.content.Intent(android.content.Intent.ACTION_GET_CONTENT).apply {
            type = "image/*"
            addCategory(android.content.Intent.CATEGORY_OPENABLE)
        }
        // createChooser shows gallery + files options
        val chooser = android.content.Intent.createChooser(galleryIntent, "Select Photo").apply {
            putExtra(android.content.Intent.EXTRA_INITIAL_INTENTS, arrayOf(fileIntent))
        }
        photoLauncher?.launch(chooser)
    }

    override fun onRequestPermissionsResult(req: Int, perms: Array<String>, results: IntArray) {
        super.onRequestPermissionsResult(req, perms, results)
        if (req == 101 && results.isNotEmpty() && results[0] == android.content.pm.PackageManager.PERMISSION_GRANTED) {
            openPhotoPicker()
        } else if (req == 101) {
            toast("Permission needed to select photo")
        }
    }

    private fun uploadPhoto(uri: android.net.Uri) {
        val ctx = requireContext()
        try {
            val inputStream = ctx.contentResolver.openInputStream(uri) ?: return
            val bmp = android.graphics.BitmapFactory.decodeStream(inputStream)
            inputStream.close()
            if (bmp == null) { toast("Could not read image"); return }

            // ── Step 1: Scale down to max 300×300 so base64 stays under ~120KB ──
            val maxDim = 300
            val scale  = minOf(maxDim.toFloat() / bmp.width, maxDim.toFloat() / bmp.height, 1f)
            val scaled = if (scale < 1f)
                android.graphics.Bitmap.createScaledBitmap(
                    bmp, (bmp.width * scale).toInt(), (bmp.height * scale).toInt(), true)
            else bmp

            // ── Step 2: Compress with progressively lower quality until < 100KB ──
            val baos = java.io.ByteArrayOutputStream()
            var quality = 72
            do {
                baos.reset()
                scaled.compress(android.graphics.Bitmap.CompressFormat.JPEG, quality, baos)
                quality -= 10
            } while (baos.size() > 100_000 && quality > 20)

            val b64 = "data:image/jpeg;base64," +
                    android.util.Base64.encodeToString(baos.toByteArray(), android.util.Base64.NO_WRAP)

            // ── Step 3: Show in UI immediately ──────────────────────────────────
            imgViewRef?.let { com.bumptech.glide.Glide.with(ctx).load(scaled).circleCrop().into(it) }
            initialsViewRef?.visibility = android.view.View.GONE

            // ── Step 4: Save locally — profile file + employee photo cache by ID ─
            val session = SessionManager(ctx)
            session.savePhotoToFile(b64)
            if (empId > 0) session.saveEmployeePhoto(empId, b64)  // so it shows in employee list

            // ── Step 5: Send to server (uploads to Cloudinary via backend) ────────
            lifecycleScope.launch {
                try {
                    val res = RetrofitClient.instance.updatePhoto(mapOf("profile_photo" to b64))
                    if (res.isSuccessful && res.body()?.success == true) {
                        toast("✅ Photo updated!")
                        // Check if server returned a Cloudinary URL
                        val photoUrl = res.body()?.data?.profilePhoto
                        if (!photoUrl.isNullOrBlank() && photoUrl.startsWith("http")) {
                            // Server returned a permanent Cloudinary URL — save URL as cache
                            // so all devices load from Cloudinary instead of base64
                            session.savePhotoToFile(photoUrl)
                            if (empId > 0) session.saveEmployeePhoto(empId, photoUrl)
                            // Update avatar with URL directly
                            imgViewRef?.let {
                                com.bumptech.glide.Glide.with(ctx).load(photoUrl).circleCrop().into(it)
                            }
                        } else {
                            // No Cloudinary — keep base64 local cache
                            session.savePhotoToFile(b64)
                            if (empId > 0) session.saveEmployeePhoto(empId, b64)
                        }
                        RetrofitClient.instance.getMe().body()?.data?.let { serverEmp ->
                            session.updateEmployee(serverEmp)
                        }
                    } else {
                        toast("✅ Photo saved on device · Server: ${res.code()}")
                    }
                } catch (_: Exception) {
                    toast("✅ Photo saved on device")
                }
            }
        } catch (e: Exception) { toast("Could not process image: ${e.message}") }
    }

    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View {
        val ctx = requireContext(); val dp = ctx.resources.displayMetrics.density
        val sv = android.widget.ScrollView(ctx)
        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(ctx.getColor(R.color.background))
            setPadding((16*dp).toInt(),(16*dp).toInt(),(16*dp).toInt(),(80*dp).toInt())
        }
        sv.addView(root)

        fun row(label: String, value: String) {
            val card = androidx.cardview.widget.CardView(ctx).apply {
                radius = 12*dp; cardElevation = 1*dp
                setCardBackgroundColor(ctx.getColor(R.color.surface))
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.bottomMargin = (6*dp).toInt() }
            }
            val ll = LinearLayout(ctx).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = android.view.Gravity.CENTER_VERTICAL
                setPadding((14*dp).toInt(),(12*dp).toInt(),(14*dp).toInt(),(12*dp).toInt())
            }
            ll.addView(TextView(ctx).apply {
                text = label; textSize = 12f; setTextColor(ctx.getColor(R.color.text_secondary))
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            })
            ll.addView(TextView(ctx).apply {
                text = value; textSize = 13f; setTypeface(null, android.graphics.Typeface.BOLD)
                setTextColor(ctx.getColor(R.color.text_primary))
            })
            card.addView(ll); root.addView(card)
        }

        fun bind(emp: Employee) {
            root.removeAllViews()
            empId = emp.id

            // ── Avatar circle ─────────────────────────────────────────────
            val avSize = (96*dp).toInt()
            val avCard = androidx.cardview.widget.CardView(ctx).apply {
                radius = avSize / 2f; cardElevation = 4*dp
                setCardBackgroundColor(ctx.getColor(R.color.primary))
                layoutParams = LinearLayout.LayoutParams(avSize, avSize).also {
                    it.gravity = android.view.Gravity.CENTER_HORIZONTAL
                    it.bottomMargin = (4*dp).toInt()
                }
            }
            val imgV = android.widget.ImageView(ctx).apply {
                scaleType = android.widget.ImageView.ScaleType.CENTER_CROP
                layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
            }
            imgViewRef = imgV
            val initTv = TextView(ctx).apply {
                text = emp.initials; textSize = 32f
                setTypeface(null, android.graphics.Typeface.BOLD)
                setTextColor(ctx.getColor(R.color.white))
                gravity = android.view.Gravity.CENTER
                layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
            }
            initialsViewRef = initTv
            avCard.addView(imgV); avCard.addView(initTv)

            // Load photo - use employee's own photo only, never fall back to logged-in user's photo
            val photoData = emp.profilePhoto
            if (!photoData.isNullOrBlank()) {
                initTv.visibility = android.view.View.GONE  // hide initials completely
                try {
                    if (photoData.startsWith("data:image")) {
                        val base64 = photoData.substringAfter(",")
                        val bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT)
                        val bmp = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                        if (bmp != null) {
                            com.bumptech.glide.Glide.with(ctx).load(bmp).circleCrop().into(imgV)
                        } else {
                            initTv.visibility = android.view.View.VISIBLE
                            initTv.text = emp.initials
                        }
                    } else {
                        com.bumptech.glide.Glide.with(ctx).load(photoData).circleCrop().into(imgV)
                    }
                } catch (e: Exception) {
                    initTv.visibility = android.view.View.VISIBLE
                    initTv.text = emp.initials
                }
            } else {
                initTv.visibility = android.view.View.VISIBLE
            }
            root.addView(avCard)

            // ── Change Photo button ────────────────────────────────────────
            root.addView(MaterialButton(ctx, null, com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
                text = "📷  Change Photo"; textSize = 12f
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).also {
                    it.gravity = android.view.Gravity.CENTER_HORIZONTAL
                    it.topMargin = (4*dp).toInt(); it.bottomMargin = (12*dp).toInt()
                }
                setOnClickListener {
                    // Request permission on Android 13+, then open picker
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                        if (requireContext().checkSelfPermission(android.Manifest.permission.READ_MEDIA_IMAGES)
                            != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                            requestPermissions(arrayOf(android.Manifest.permission.READ_MEDIA_IMAGES), 101)
                            return@setOnClickListener
                        }
                    } else {
                        if (requireContext().checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE)
                            != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                            requestPermissions(arrayOf(android.Manifest.permission.READ_EXTERNAL_STORAGE), 101)
                            return@setOnClickListener
                        }
                    }
                    openPhotoPicker()
                }
            })

            // ── Name + role ────────────────────────────────────────────────
            root.addView(TextView(ctx).apply {
                text = emp.fullName; textSize = 20f; setTypeface(null, android.graphics.Typeface.BOLD)
                setTextColor(ctx.getColor(R.color.text_primary)); gravity = android.view.Gravity.CENTER
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.bottomMargin = (4*dp).toInt() }
            })
            root.addView(TextView(ctx).apply {
                text = emp.displayRole; textSize = 14f; setTextColor(ctx.getColor(R.color.primary))
                gravity = android.view.Gravity.CENTER
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.bottomMargin = (20*dp).toInt() }
            })

            // ── Info rows ──────────────────────────────────────────────────
            row("Employee ID",    emp.employeeCode ?: "—")
            row("Designation",    emp.designationTitle ?: "—")
            row("Department",     emp.departmentName ?: "—")
            row("Role",           emp.displayRole)
            row("Manager",        emp.managerName ?: "—")
            row("Date of Birth",  emp.dateOfBirth?.toDisplayDate() ?: "—")
            row("Date of Joining",emp.effectiveJoiningDate?.toDisplayDate() ?: "—")
            row("Gender",         emp.gender?.replaceFirstChar { it.uppercase() } ?: "—")
            row("Phone",          emp.phone ?: "—")
            row("Email",          emp.email)
        }

        val session = SessionManager(requireContext())
        // Load photo from file directly first (fastest path)
        val cachedPhoto = session.getPhotoFromFile()
        val cachedEmp   = session.getEmployee()

        // Show cached employee immediately
        cachedEmp?.let { emp ->
            // Inject photo from file if employee object doesn't have it
            val empWithPhoto = if (cachedPhoto != null && emp.profilePhoto.isNullOrBlank())
                emp.copy(profilePhoto = cachedPhoto) else emp
            bind(empWithPhoto)
        }

        // Refresh from server in background
        lifecycleScope.launch {
            try {
                val res = RetrofitClient.instance.getMe()
                if (res.isSuccessful && res.body()?.success == true) {
                    val serverEmp = res.body()!!.data ?: return@launch
                    // Merge with local photo if server doesn't have it yet
                    val photoToUse = serverEmp.profilePhoto?.ifBlank { null } ?: cachedPhoto
                    session.updateEmployee(serverEmp)
                    if (photoToUse != null) session.savePhotoToFile(photoToUse)
                    val empFinal = if (photoToUse != null && serverEmp.profilePhoto.isNullOrBlank())
                        serverEmp.copy(profilePhoto = photoToUse) else serverEmp
                    bind(empFinal)
                }
            } catch (_: Exception) {}
        }
        return sv
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANNOUNCEMENTS FRAGMENT
// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// WORK ANNIVERSARIES FRAGMENT — mirrors BirthdaysFragment pattern exactly
// ═══════════════════════════════════════════════════════════════════════════════
class AnniversariesFragment : Fragment() {
    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View {
        val ctx = requireContext()
        val dp  = ctx.resources.displayMetrics.density

        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(ctx.getColor(R.color.background))
        }

        root.addView(LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            setBackgroundColor(ctx.getColor(R.color.primary))
            setPadding((16*dp).toInt(), (16*dp).toInt(), (16*dp).toInt(), (16*dp).toInt())
            addView(TextView(ctx).apply {
                text = "🎉  Work Anniversaries"; textSize = 20f
                setTypeface(null, android.graphics.Typeface.BOLD)
                setTextColor(ctx.getColor(R.color.white))
            })
        })

        val progress = android.widget.ProgressBar(ctx).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).also { it.gravity = android.view.Gravity.CENTER_HORIZONTAL; it.topMargin = (24*dp).toInt() }
        }
        root.addView(progress)

        val rv = androidx.recyclerview.widget.RecyclerView(ctx).apply {
            layoutManager = androidx.recyclerview.widget.LinearLayoutManager(ctx)
            setPadding((8*dp).toInt(), (8*dp).toInt(), (8*dp).toInt(), (80*dp).toInt())
            clipToPadding = false; visibility = android.view.View.GONE
        }
        root.addView(rv)

        val tvEmpty = TextView(ctx).apply {
            text = "No work anniversaries in the next 7 days 🎉"
            textSize = 14f; gravity = android.view.Gravity.CENTER
            setTextColor(ctx.getColor(R.color.text_hint))
            setPadding((16*dp).toInt(), (48*dp).toInt(), (16*dp).toInt(), 0)
            visibility = android.view.View.GONE
        }
        root.addView(tvEmpty)

        fun load() {
            lifecycleScope.launch {
                try {
                    val res = RetrofitClient.instance.getUpcomingAnniversaries()
                    progress.visibility = android.view.View.GONE
                    val list = res.body()?.data ?: emptyList()
                    if (list.isEmpty()) {
                        tvEmpty.visibility = android.view.View.VISIBLE
                    } else {
                        rv.visibility = android.view.View.VISIBLE
                        rv.adapter = AnniversaryAdapter(list.toMutableList(), requireContext()) { load() }
                    }
                } catch (_: Exception) {
                    progress.visibility = android.view.View.GONE
                    tvEmpty.text = "Could not load anniversaries"
                    tvEmpty.visibility = android.view.View.VISIBLE
                }
            }
        }
        load()
        return root
    }
}

class AnniversaryAdapter(
    private val items: MutableList<AnniversaryRecord>,
    private val ctx: android.content.Context,
    private val onRefresh: () -> Unit
) : androidx.recyclerview.widget.RecyclerView.Adapter<AnniversaryAdapter.VH>() {

    inner class VH(val card: androidx.cardview.widget.CardView) : androidx.recyclerview.widget.RecyclerView.ViewHolder(card)
    override fun getItemCount() = items.size

    override fun onCreateViewHolder(p: android.view.ViewGroup, t: Int): VH {
        val dp = ctx.resources.displayMetrics.density
        val card = androidx.cardview.widget.CardView(ctx).apply {
            radius = 16*dp; cardElevation = 3*dp
            layoutParams = androidx.recyclerview.widget.RecyclerView.LayoutParams(
                androidx.recyclerview.widget.RecyclerView.LayoutParams.MATCH_PARENT,
                androidx.recyclerview.widget.RecyclerView.LayoutParams.WRAP_CONTENT
            ).also { it.setMargins(0, 0, 0, (10*dp).toInt()) }
        }
        return VH(card)
    }

    override fun onBindViewHolder(h: VH, pos: Int) {
        val ann = items[pos]; val dp = ctx.resources.displayMetrics.density
        h.card.removeAllViews()
        val isToday = ann.isToday
        val myId = SessionManager(ctx).getEmployee()?.id

        h.card.setCardBackgroundColor(
            ctx.getColor(if (isToday) R.color.accent_amber_light else R.color.surface)
        )

        val ll = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding((14*dp).toInt(), (14*dp).toInt(), (14*dp).toInt(), (14*dp).toInt())
        }

        // ── Avatar + name row ─────────────────────────────────────────────────
        val topRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
        }
        val initials = ann.displayName.split(" ").take(2).map { it.firstOrNull()?.uppercase() ?: "" }.joinToString("")
        val avatarCard = androidx.cardview.widget.CardView(ctx).apply {
            radius = 28*dp; cardElevation = 0f
            setCardBackgroundColor(ctx.getColor(if (isToday) R.color.accent_amber else R.color.primary))
            layoutParams = LinearLayout.LayoutParams((56*dp).toInt(), (56*dp).toInt()).also { it.marginEnd = (12*dp).toInt() }
        }
        avatarCard.addView(TextView(ctx).apply {
            text = initials; textSize = 18f; gravity = android.view.Gravity.CENTER
            setTextColor(ctx.getColor(R.color.white))
            setTypeface(null, android.graphics.Typeface.BOLD)
            layoutParams = android.widget.FrameLayout.LayoutParams(
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT
            )
        })
        topRow.addView(avatarCard)

        val nameCol = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val years = ann.yearsCompleted
        if (isToday) nameCol.addView(TextView(ctx).apply {
            text = "🎉 WORK ANNIVERSARY TODAY!"; textSize = 10f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(ctx.getColor(R.color.accent_amber))
            setPadding(0, 0, 0, (2*dp).toInt())
        })
        nameCol.addView(TextView(ctx).apply {
            text = ann.displayName; textSize = 16f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(ctx.getColor(R.color.text_primary))
        })
        nameCol.addView(TextView(ctx).apply {
            text = "${ann.departmentName ?: "Employee"} · $years year${if(years!=1)"s" else ""}"
            textSize = 12f; setTextColor(ctx.getColor(R.color.text_secondary))
        })
        topRow.addView(nameCol)

        topRow.addView(TextView(ctx).apply {
            text = if (isToday) "🎉 Today!" else "in ${ann.daysUntil ?: 0}d"
            textSize = 11f; setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(ctx.getColor(if (isToday) R.color.accent_amber else R.color.primary))
            setPadding((8*dp).toInt(), (4*dp).toInt(), (8*dp).toInt(), (4*dp).toInt())
            background = ctx.getDrawable(if (isToday) R.drawable.bg_status_pending else R.drawable.bg_status_approved)
        })
        ll.addView(topRow)

        ll.addView(TextView(ctx).apply {
            text = "🗓️  Joined ${ann.joinDisplay ?: ""} · ${ann.employeeCode ?: ""}"
            textSize = 12f; setTextColor(ctx.getColor(R.color.text_hint))
            setPadding(0, (6*dp).toInt(), 0, (8*dp).toInt())
        })

        // ── Like + Wish buttons (today only) ──────────────────────────────────
        if (isToday) {
            val btnRow = LinearLayout(ctx).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            }

            val btnLike = com.google.android.material.button.MaterialButton(
                ctx, null, com.google.android.material.R.attr.materialButtonOutlinedStyle
            ).apply {
                text = if (ann.iLiked) "❤️  ${ann.likeCount} Liked" else "🤍  ${ann.likeCount} Like"
                textSize = 12f
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).also { it.marginEnd = (8*dp).toInt() }
                if (ann.iLiked) setBackgroundColor(ctx.getColor(R.color.accent_pink_light))
                setOnClickListener {
                    isEnabled = false
                    kotlinx.coroutines.MainScope().launch {
                        try {
                            val res = RetrofitClient.instance.toggleBirthdayLike(ann.id)
                            if (res.isSuccessful) {
                                // Re-fetch to get accurate count
                                val fresh = RetrofitClient.instance.getUpcomingAnniversaries()
                                val updated = fresh.body()?.data?.firstOrNull { it.id == ann.id }
                                val newLiked = updated?.iLiked ?: !ann.iLiked
                                val newCount = updated?.likeCount ?: ann.likeCount
                                items[pos] = ann.copyAnniv(likeCount = newCount, iLiked = newLiked)
                                notifyItemChanged(pos)
                            } else { ctx.toast("Could not like (${res.code()})") }
                        } catch (_: Exception) { ctx.toast("Could not like") }
                        isEnabled = true
                    }
                }
            }

            val btnWish = com.google.android.material.button.MaterialButton(
                ctx, null, com.google.android.material.R.attr.materialButtonStyle
            ).apply {
                text = if (ann.iWished) "✅  Wished!" else "🎁  Send Wish"
                textSize = 12f
                setBackgroundColor(ctx.getColor(if (ann.iWished) R.color.text_secondary else R.color.primary))
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                setOnClickListener {
                    showAnnivWishDialog(ann.id, ann.displayName) { success ->
                        if (success) {
                            items[pos] = ann.copyAnniv(iWished = true, wishCount = ann.wishCount + 1)
                            notifyItemChanged(pos)
                        }
                    }
                }
            }
            btnRow.addView(btnLike)
            btnRow.addView(btnWish)
            ll.addView(btnRow)

            // ── Divider ───────────────────────────────────────────────────────
            ll.addView(android.view.View(ctx).apply {
                setBackgroundColor(ctx.getColor(R.color.divider))
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, (1*dp).toInt()
                ).also { it.topMargin = (10*dp).toInt(); it.bottomMargin = (8*dp).toInt() }
            })

            // ── Wishes section ────────────────────────────────────────────────
            val wishesContainer = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
            ll.addView(wishesContainer)

            val tvWishHeader = TextView(ctx).apply {
                text = "💬 Wishes (${ann.wishCount})"; textSize = 13f
                setTypeface(null, android.graphics.Typeface.BOLD)
                setTextColor(ctx.getColor(R.color.text_primary))
                setPadding(0, 0, 0, (6*dp).toInt())
            }
            wishesContainer.addView(tvWishHeader)

            fun loadWishes() {
                kotlinx.coroutines.MainScope().launch {
                    try {
                        val wishRes = RetrofitClient.instance.getBirthdayWishes(ann.id)
                        val wishes = wishRes.body()?.data ?: emptyList()
                        tvWishHeader.text = "💬 Wishes (${wishes.size})"
                        while (wishesContainer.childCount > 1) wishesContainer.removeViewAt(1)
                        if (wishes.isEmpty()) {
                            wishesContainer.addView(TextView(ctx).apply {
                                text = "No wishes yet. Be the first! 🎉"
                                textSize = 12f; setTextColor(ctx.getColor(R.color.text_hint))
                                setPadding(0, 0, 0, (4*dp).toInt())
                            })
                        } else {
                            wishes.forEach { wish ->
                                wishesContainer.addView(buildWishCard(dp, wish, myId, ann.id) { loadWishes() })
                            }
                        }
                    } catch (_: Exception) {}
                }
            }
            loadWishes()
        }

        h.card.addView(ll)
    }

    private fun buildWishCard(dp: Float, wish: BirthdayWish, myId: Int?, annivEmpId: Int, onDeleted: () -> Unit): LinearLayout {
        val row = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.TOP
            setPadding(0, (4*dp).toInt(), 0, (4*dp).toInt())
        }
        val initials = wish.fromName?.split(" ")?.take(2)?.map { it.firstOrNull()?.uppercase() ?: "" }?.joinToString("") ?: "?"
        val avCard = androidx.cardview.widget.CardView(ctx).apply {
            radius = 16*dp; cardElevation = 0f
            setCardBackgroundColor(ctx.getColor(R.color.primary))
            layoutParams = LinearLayout.LayoutParams((32*dp).toInt(), (32*dp).toInt()).also { it.marginEnd = (8*dp).toInt() }
        }
        avCard.addView(TextView(ctx).apply {
            text = initials; textSize = 11f; gravity = android.view.Gravity.CENTER
            setTextColor(android.graphics.Color.WHITE)
            setTypeface(null, android.graphics.Typeface.BOLD)
            layoutParams = android.widget.FrameLayout.LayoutParams(
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT
            )
        })
        row.addView(avCard)

        val msgCol = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        msgCol.addView(TextView(ctx).apply {
            text = wish.fromName ?: "—"; textSize = 12f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(ctx.getColor(R.color.text_primary))
        })
        msgCol.addView(TextView(ctx).apply {
            text = wish.message ?: ""; textSize = 12f
            setTextColor(ctx.getColor(R.color.text_secondary))
        })
        val timeStr = wish.createdAt?.take(16)?.replace("T", " ") ?: ""
        if (timeStr.isNotBlank()) msgCol.addView(TextView(ctx).apply {
            text = timeStr; textSize = 10f
            setTextColor(ctx.getColor(R.color.text_hint))
        })
        row.addView(msgCol)

        val canDelete = wish.fromEmpId == myId || myId == annivEmpId
        if (canDelete) {
            row.addView(TextView(ctx).apply {
                text = "🗑"; textSize = 16f
                setPadding((8*dp).toInt(), 0, 0, 0)
                setOnClickListener {
                    android.app.AlertDialog.Builder(ctx)
                        .setTitle("Delete Wish").setMessage("Delete this anniversary wish?")
                        .setPositiveButton("Delete") { _, _ ->
                            kotlinx.coroutines.MainScope().launch {
                                try {
                                    val res = RetrofitClient.instance.deleteBirthdayWish(wish.id)
                                    if (res.isSuccessful) { ctx.toast("Wish deleted ✅"); onDeleted() }
                                    else ctx.toast("Could not delete")
                                } catch (_: Exception) { ctx.toast("Network error") }
                            }
                        }.setNegativeButton("Cancel", null).show()
                }
            })
        }
        return row
    }

    private fun showAnnivWishDialog(empId: Int, name: String, onResult: (Boolean) -> Unit) {
        val dp = ctx.resources.displayMetrics.density
        val et = android.widget.EditText(ctx).apply {
            hint = "Write a wish for $name…"; minLines = 2
            setPadding((12*dp).toInt(), (10*dp).toInt(), (12*dp).toInt(), (10*dp).toInt())
        }
        android.app.AlertDialog.Builder(ctx)
            .setTitle("🎉 Send Anniversary Wish")
            .setView(et)
            .setPositiveButton("Send 🎉") { _, _ ->
                val msg = et.text.toString().trim().ifEmpty { "Happy Work Anniversary! 🎉" }
                kotlinx.coroutines.MainScope().launch {
                    try {
                        val res = RetrofitClient.instance.sendBirthdayWish(empId, mapOf("message" to msg))
                        if (res.isSuccessful && res.body()?.success == true) {
                            ctx.toast("Wish sent! 🎉"); onResult(true)
                        } else { ctx.toast(res.body()?.message ?: "Could not send"); onResult(false) }
                    } catch (_: Exception) { ctx.toast("Network error"); onResult(false) }
                }
            }
            .setNegativeButton("Cancel", null).show()
    }
}

fun AnniversaryRecord.copyAnniv(
    likeCount: Int = this.likeCount,
    iLiked: Boolean = this.iLiked,
    wishCount: Int = this.wishCount,
    iWished: Boolean = this.iWished
) = AnniversaryRecord(
    id = this.id, fullName = this.fullName, employeeCode = this.employeeCode,
    departmentName = this.departmentName, designationTitle = this.designationTitle,
    joiningDate = this.joiningDate, joinMd = this.joinMd, joinDisplay = this.joinDisplay,
    daysUntil = this.daysUntil, yearsCompleted = this.yearsCompleted,
    likeCount = likeCount, wishCount = wishCount, iLiked = iLiked, iWished = iWished
)


class AnnouncementsFragment : Fragment() {
    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View {
        val ctx = requireContext(); val dp = ctx.resources.displayMetrics.density
        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL; setBackgroundColor(ctx.getColor(R.color.background))
        }
        root.addView(TextView(ctx).apply {
            text = "Announcements"; textSize = 20f; setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(ctx.getColor(R.color.text_primary))
            setPadding((16*dp).toInt(),(16*dp).toInt(),(16*dp).toInt(),(12*dp).toInt())
        })
        val rv = RecyclerView(ctx).apply {
            layoutManager = LinearLayoutManager(ctx)
            setPadding((8*dp).toInt(),0,(8*dp).toInt(),(80*dp).toInt()); clipToPadding = false
        }
        root.addView(rv)
        lifecycleScope.launch {
            try {
                val res = RetrofitClient.instance.getAnnouncements()
                val items = res.body()?.data ?: emptyList()
                rv.adapter = AnnouncementAdapter(items, lifecycleScope)
            } catch (_: Exception) {}
        }
        return root
    }
}

class AnnouncementAdapter(
    private val items: List<Announcement>,
    private val scope: kotlinx.coroutines.CoroutineScope
) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {

    // Track like state per item so toggling survives scroll
    private val likeState    = items.associate { it.id to it.iLiked }.toMutableMap()
    private val likeCount    = items.associate { it.id to it.likeCount }.toMutableMap()
    private val commentCount = items.associate { it.id to it.commentCount }.toMutableMap()
    // Track which comment sections are expanded
    private val expanded     = mutableSetOf<Int>()

    override fun getItemCount() = items.size

    override fun onCreateViewHolder(p: ViewGroup, t: Int): RecyclerView.ViewHolder {
        val ctx = p.context; val dp = ctx.resources.displayMetrics.density
        val card = androidx.cardview.widget.CardView(ctx).apply {
            radius = 14*dp; cardElevation = 2*dp
            setCardBackgroundColor(ctx.getColor(R.color.surface))
            layoutParams = RecyclerView.LayoutParams(
                RecyclerView.LayoutParams.MATCH_PARENT,
                RecyclerView.LayoutParams.WRAP_CONTENT
            ).also { it.setMargins(0, 0, 0, (10*dp).toInt()) }
        }
        return object : RecyclerView.ViewHolder(card) {}
    }

    override fun onBindViewHolder(h: RecyclerView.ViewHolder, pos: Int) {
        val ann = items[pos]
        val ctx = h.itemView.context
        val dp  = ctx.resources.displayMetrics.density
        val card = h.itemView as androidx.cardview.widget.CardView
        card.removeAllViews()

        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
        }

        // ── Fix 2: Announcement image ─────────────────────────────────────────
        if (!ann.imageUrl.isNullOrBlank()) {
            val imgView = android.widget.ImageView(ctx).apply {
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, (200*dp).toInt()
                )
                scaleType = android.widget.ImageView.ScaleType.CENTER_CROP
            }
            // base64 data URI or remote URL — Glide handles both
            com.bumptech.glide.Glide.with(ctx)
                .load(ann.imageUrl)
                .into(imgView)
            root.addView(imgView)
        }

        // ── Text body ─────────────────────────────────────────────────────────
        val body = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding((16*dp).toInt(),(14*dp).toInt(),(16*dp).toInt(),(10*dp).toInt())
        }
        body.addView(TextView(ctx).apply {
            text = ann.title; textSize = 15f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(ctx.getColor(R.color.text_primary))
        })
        if (!ann.content.isNullOrBlank()) {
            body.addView(TextView(ctx).apply {
                text = ann.content; textSize = 13f
                setTextColor(ctx.getColor(R.color.text_secondary))
                setPadding(0,(4*dp).toInt(),0,0)
            })
        }
        body.addView(TextView(ctx).apply {
            text = "— ${ann.authorName}  ${ann.createdAt?.take(10)?.toDisplayDate() ?: ""}"
            textSize = 11f
            setTextColor(ctx.getColor(R.color.text_hint))
            setPadding(0,(6*dp).toInt(),0,0)
        })

        // ── Fix 1: Like & Comment action bar ──────────────────────────────────
        val actionBar = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0,(8*dp).toInt(),0,(4*dp).toInt())
        }

        val liked = likeState[ann.id] ?: false
        val lkCount = likeCount[ann.id] ?: 0
        val cmCount = commentCount[ann.id] ?: 0

        val likeBtn = android.widget.Button(ctx).apply {
            text = "❤️ $lkCount"
            textSize = 12f
            isAllCaps = false
            setPadding((12*dp).toInt(),(4*dp).toInt(),(12*dp).toInt(),(4*dp).toInt())
            setBackgroundResource(android.R.drawable.dialog_holo_light_frame)
            setTextColor(if (liked) android.graphics.Color.parseColor("#dc2626") else ctx.getColor(R.color.text_hint))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).also { it.marginEnd = (8*dp).toInt() }
        }

        val cmBtn = android.widget.Button(ctx).apply {
            text = "💬 $cmCount"
            textSize = 12f
            isAllCaps = false
            setPadding((12*dp).toInt(),(4*dp).toInt(),(12*dp).toInt(),(4*dp).toInt())
            setBackgroundResource(android.R.drawable.dialog_holo_light_frame)
            setTextColor(ctx.getColor(R.color.text_hint))
        }

        actionBar.addView(likeBtn)
        actionBar.addView(cmBtn)
        body.addView(actionBar)

        // ── Comments section (shown/hidden on toggle) ─────────────────────────
        val commentSection = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            visibility = if (expanded.contains(ann.id)) android.view.View.VISIBLE else android.view.View.GONE
            setPadding(0,(6*dp).toInt(),0,0)
        }
        val commentsList = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        val commentRow   = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0,(6*dp).toInt(),0,0)
        }
        val commentInput = android.widget.EditText(ctx).apply {
            hint = "Write a comment…"
            textSize = 13f
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            setBackgroundResource(android.R.drawable.edit_text)
            setPadding((8*dp).toInt(),(4*dp).toInt(),(8*dp).toInt(),(4*dp).toInt())
        }
        val postBtn = android.widget.Button(ctx).apply {
            text = "Post"
            textSize = 12f
            isAllCaps = false
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).also { it.marginStart = (6*dp).toInt() }
        }
        commentRow.addView(commentInput)
        commentRow.addView(postBtn)
        commentSection.addView(commentsList)
        commentSection.addView(commentRow)
        body.addView(commentSection)

        root.addView(body)
        card.addView(root)

        // ── Like button click ─────────────────────────────────────────────────
        likeBtn.setOnClickListener {
            scope.launch {
                try {
                    val res = RetrofitClient.instance.toggleAnnouncementLike(ann.id)
                    if (res.isSuccessful) {
                        val result  = res.body()?.data
                        val nowLiked = result?.liked ?: !(likeState[ann.id] ?: false)
                        likeState[ann.id] = nowLiked
                        // Use +1/-1 like dashboard — don't rely on API count (0 is falsy in ?:)
                        likeCount[ann.id] = if (nowLiked)
                            (likeCount[ann.id] ?: 0) + 1
                        else
                            maxOf(0, (likeCount[ann.id] ?: 0) - 1)
                        notifyItemChanged(pos)
                    }
                } catch (_: Exception) {}
            }
        }

        // ── Comment section toggle ────────────────────────────────────────────
        cmBtn.setOnClickListener {
            val isExpanded = expanded.contains(ann.id)
            if (isExpanded) {
                expanded.remove(ann.id)
                commentSection.visibility = android.view.View.GONE
            } else {
                expanded.add(ann.id)
                commentSection.visibility = android.view.View.VISIBLE
                loadCommentsInto(ann.id, commentsList, ctx, dp)
            }
        }

        // ── Post comment ──────────────────────────────────────────────────────
        postBtn.setOnClickListener {
            val text = commentInput.text.toString().trim()
            if (text.isEmpty()) return@setOnClickListener
            scope.launch {
                try {
                    val res = RetrofitClient.instance.addAnnouncementComment(
                        ann.id, com.krishihr.app.data.models.CommentRequest(text)
                    )
                    if (res.isSuccessful) {
                        commentInput.setText("")
                        commentCount[ann.id] = (commentCount[ann.id] ?: 0) + 1
                        loadCommentsInto(ann.id, commentsList, ctx, dp)
                        notifyItemChanged(pos)
                    }
                } catch (_: Exception) {}
            }
        }
    }

    private fun loadCommentsInto(
        annId: Int,
        container: LinearLayout,
        ctx: android.content.Context,
        dp: Float
    ) {
        scope.launch {
            try {
                val res = RetrofitClient.instance.getAnnouncementComments(annId)
                val comments = res.body()?.data ?: emptyList()
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                    container.removeAllViews()
                    if (comments.isEmpty()) {
                        container.addView(android.widget.TextView(ctx).apply {
                            text = "No comments yet. Be the first!"
                            textSize = 12f
                            setTextColor(ctx.getColor(R.color.text_hint))
                        })
                        return@withContext
                    }
                    comments.forEach { c ->
                        val row = LinearLayout(ctx).apply {
                            orientation = LinearLayout.VERTICAL
                            setPadding(0,(4*dp).toInt(),0,(4*dp).toInt())
                        }
                        row.addView(android.widget.TextView(ctx).apply {
                            text = "${c.employeeName ?: "Employee"}  ${c.createdAt?.take(10) ?: ""}"
                            textSize = 11f
                            setTypeface(null, android.graphics.Typeface.BOLD)
                            setTextColor(ctx.getColor(R.color.text_primary))
                        })
                        row.addView(android.widget.TextView(ctx).apply {
                            text = c.comment
                            textSize = 13f
                            setTextColor(ctx.getColor(R.color.text_secondary))
                        })
                        container.addView(row)
                        // divider
                        container.addView(android.view.View(ctx).apply {
                            layoutParams = LinearLayout.LayoutParams(
                                LinearLayout.LayoutParams.MATCH_PARENT, 1
                            ).also { it.setMargins(0,(2*dp).toInt(),0,(2*dp).toInt()) }
                            setBackgroundColor(ctx.getColor(R.color.text_hint).and(0x33FFFFFF.toInt()))
                        })
                    }
                }
            } catch (_: Exception) {}
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════

// ── Reusable approval action helper ──────────────────────────────────────────
fun approvalConfirm(
    ctx: android.content.Context,
    title: String,
    onConfirm: suspend () -> Pair<Boolean, String>
) {
    android.app.AlertDialog.Builder(ctx)
        .setTitle(title)
        .setMessage("Are you sure?")
        .setPositiveButton("Yes") { _, _ ->
            kotlinx.coroutines.MainScope().launch {
                try {
                    val (success, msg) = onConfirm()
                    ctx.toast(if (success) "✅ $msg" else "❌ $msg")
                } catch (e: Exception) {
                    ctx.toast("Network error: ${e.message}")
                }
            }
        }
        .setNegativeButton("Cancel", null).show()
}

// APPROVALS FRAGMENT - tabbed: Leave | OD/WFH | Regularize | Advance
// ═══════════════════════════════════════════════════════════════════════════════
class ApprovalsFragment : Fragment() {
    companion object {
        fun newInstance(initialTab: Int = 0): ApprovalsFragment {
            return ApprovalsFragment().apply {
                arguments = android.os.Bundle().also { it.putInt("initial_tab", initialTab) }
            }
        }
    }
    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View {
        val ctx = requireContext(); val dp = ctx.resources.displayMetrics.density
        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(ctx.getColor(R.color.background))
            layoutParams = android.view.ViewGroup.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT)
        }

        root.addView(TextView(ctx).apply {
            text = "Pending Approvals"; textSize = 20f; setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(ctx.getColor(R.color.text_primary))
            setPadding((16*dp).toInt(),(16*dp).toInt(),(16*dp).toInt(),(8*dp).toInt())
        })

        // Tab buttons — fixed to fit all 4 in one line
        val tabs = listOf("Leave", "OD/WFH", "Regularize", "Advance")
        val tabRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding((8*dp).toInt(), 0, (8*dp).toInt(), (8*dp).toInt())
        }
        val tabBtns = tabs.mapIndexed { idx, label ->
            com.google.android.material.button.MaterialButton(ctx,
                null, com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
                text = label
                textSize = 10f          // smaller text so all 4 fit
                minWidth = 0            // allow button to shrink below default minWidth
                minimumWidth = 0
                setPadding((4*dp).toInt(), (6*dp).toInt(), (4*dp).toInt(), (6*dp).toInt())
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                    .also { it.marginStart = if (idx > 0) (3*dp).toInt() else 0 }
            }
        }
        tabBtns.forEach { tabRow.addView(it) }
        root.addView(tabRow)

        val rv = RecyclerView(ctx).apply {
            layoutManager = LinearLayoutManager(ctx)
            setPadding((8*dp).toInt(), 0, (8*dp).toInt(), (80*dp).toInt())
            clipToPadding = false
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        root.addView(rv)

        val tvEmpty = TextView(ctx).apply {
            textSize = 14f; gravity = android.view.Gravity.CENTER
            setTextColor(ctx.getColor(R.color.text_hint))
            visibility = View.GONE
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        }
        root.addView(tvEmpty)

        val session = SessionManager(ctx)
        val myId = session.getEmployee()?.id
        val myEmployeeCode = session.getEmployee()?.employeeCode

        fun setActiveTab(idx: Int) {
            tabBtns.forEachIndexed { i, btn ->
                if (i == idx) {
                    btn.setBackgroundColor(ctx.getColor(R.color.primary))
                    btn.setTextColor(ctx.getColor(R.color.white))
                } else {
                    btn.setBackgroundColor(ctx.getColor(android.R.color.transparent))
                    btn.setTextColor(ctx.getColor(R.color.primary))
                }
            }
        }

        fun loadLeaves() {
            setActiveTab(0)
            lifecycleScope.launch {
                try {
                    val res = RetrofitClient.instance.getLeaveApplications("pending")
                    val items = (res.body()?.data ?: emptyList()).filter { it.employeeId != myId }
                    tvEmpty.visibility = if (items.isEmpty()) View.VISIBLE else View.GONE
                    tvEmpty.text = "No pending leave requests"
                    rv.adapter = LeaveListAdapter(items, showName = true, showAction = true) { loadLeaves() }
                } catch (e: Exception) { tvEmpty.text = "Error: ${e.message}"; tvEmpty.visibility = View.VISIBLE }
            }
        }

        fun loadODWFH() {
            setActiveTab(1)
            lifecycleScope.launch {
                try {
                    val od  = RetrofitClient.instance.getODRequests("pending")
                    val wfh = RetrofitClient.instance.getWFHRequests("pending")

                    // ✅ FIX: Group consecutive OD rows (same employee+reason) into one card
                    val odRaw = (od.body()?.data ?: emptyList())
                        .filter { it.employeeId != myId }
                        .sortedWith(compareBy({ it.employeeId }, { it.date }))

                    val odGrouped = odRaw.fold(mutableListOf<ODWFHItem>()) { groups, row ->
                        val last = groups.lastOrNull()
                        val sameEmp    = last?.employeeId == row.employeeId
                        val sameReason = last?.reason == row.reason
                        val dayAfter   = last?.toDate?.let { lastDate ->
                            val sdf = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.getDefault())
                            val cal = java.util.Calendar.getInstance()
                            cal.time = sdf.parse(lastDate) ?: return@let false
                            cal.add(java.util.Calendar.DAY_OF_MONTH, 1)
                            if (cal.get(java.util.Calendar.DAY_OF_WEEK) == java.util.Calendar.SUNDAY)
                                cal.add(java.util.Calendar.DAY_OF_MONTH, 1)
                            sdf.format(cal.time) == (row.date?.take(10) ?: "")
                        } ?: false

                        if (last != null && sameEmp && sameReason && dayAfter) {
                            groups[groups.size - 1] = last.copy(
                                toDate = row.date?.take(10),
                                days   = last.days + 1,
                                ids    = last.ids + row.id
                            )
                        } else {
                            groups.add(ODWFHItem(
                                id          = row.id,
                                employeeId  = row.employeeId,
                                name        = row.empName ?: row.employeeCode ?: "—",
                                date        = row.date,
                                reason      = row.reason,
                                status      = row.status,
                                requestType = "OD",
                                fromDate    = row.date?.take(10),
                                toDate      = row.date?.take(10),
                                days        = 1,
                                ids         = listOf(row.id)
                            ))
                        }
                        groups
                    }

                    val wfhItems = (wfh.body()?.data ?: emptyList())
                        .filter { it.employeeId != myId }
                        .map { ODWFHItem(it.id, it.employeeId, it.empName ?: it.employeeCode ?: "—", it.date, it.reason, it.status, "WFH") }

                    val allItems = (odGrouped + wfhItems).sortedByDescending { it.fromDate ?: it.date }
                    tvEmpty.visibility = if (allItems.isEmpty()) View.VISIBLE else View.GONE
                    tvEmpty.text = "No pending OD/WFH requests"
                    rv.adapter = ODWFHApprovalAdapter(allItems) { loadODWFH() }
                } catch (e: Exception) { tvEmpty.text = "Error: ${e.message}"; tvEmpty.visibility = View.VISIBLE }
            }
        }

        fun loadRegularizations() {
            setActiveTab(2)
            lifecycleScope.launch {
                try {
                    val res = RetrofitClient.instance.getRegularizations("pending")
                    val items = res.body()?.data ?: emptyList()
                    tvEmpty.visibility = if (items.isEmpty()) View.VISIBLE else View.GONE
                    tvEmpty.text = "No pending regularizations"
                    rv.adapter = RegularizationApprovalAdapter(items) { loadRegularizations() }
                } catch (e: Exception) { tvEmpty.text = "Error: ${e.message}"; tvEmpty.visibility = View.VISIBLE }
            }
        }

        fun loadAdvances() {
            setActiveTab(3)
            lifecycleScope.launch {
                try {
                    val res = RetrofitClient.instance.getAdvancesForApproval()
                    // Filter: only show OTHER people's pending advances for approval
                    val items = (res.body()?.data ?: emptyList())
                        .filter { it.status.lowercase() == "pending" && it.employeeId != myId && it.currentApproverCode == myEmployeeCode }
                    tvEmpty.visibility = if (items.isEmpty()) View.VISIBLE else View.GONE
                    tvEmpty.text = "No pending advance requests"
                    rv.adapter = AdvanceApprovalAdapter(items, myEmployeeCode) { loadAdvances() }
                } catch (e: Exception) { tvEmpty.text = "Error: ${e.message}"; tvEmpty.visibility = View.VISIBLE }
            }
        }

        tabBtns[0].setOnClickListener { loadLeaves() }
        tabBtns[1].setOnClickListener { loadODWFH() }
        tabBtns[2].setOnClickListener { loadRegularizations() }
        tabBtns[3].setOnClickListener { loadAdvances() }

        // Store loader functions for external navigation (notification taps)
        _tabLoaders = listOf(::loadLeaves, ::loadODWFH, ::loadRegularizations, ::loadAdvances)
        _tabBtns    = tabBtns

        // Load correct tab — from notification arg, or default to Leave (0)
        val initialTab = arguments?.getInt("initial_tab", 0) ?: 0
        _tabLoaders[initialTab].invoke()

        return root
    }

    private var _tabLoaders: List<() -> Unit> = emptyList()
    private var _tabBtns: List<com.google.android.material.button.MaterialButton> = emptyList()

    /** Called from NotificationAdapter to pre-select a tab */
    fun switchToTab(index: Int) {
        if (index in _tabLoaders.indices) _tabLoaders[index].invoke()
    }
}

class PendingLeavesFragment : Fragment() {
    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View {
        val ctx = requireContext(); val dp = ctx.resources.displayMetrics.density
        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(ctx.getColor(R.color.background))
            layoutParams = android.view.ViewGroup.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT)
        }
        root.addView(TextView(ctx).apply { text = "Pending Leaves"; textSize = 20f; setTypeface(null, android.graphics.Typeface.BOLD); setPadding((16*dp).toInt(),(16*dp).toInt(),(16*dp).toInt(),(12*dp).toInt()) })
        val rv = RecyclerView(ctx).apply { layoutManager = LinearLayoutManager(ctx); setPadding((8*dp).toInt(),0,(8*dp).toInt(),(80*dp).toInt()); clipToPadding = false }
        root.addView(rv)
        fun load() {
            lifecycleScope.launch {
                try {
                    val myId = SessionManager(requireContext()).getEmployee()?.id
                    val res = RetrofitClient.instance.getLeaveApplications("pending")
                    val items = (res.body()?.data ?: emptyList()).filter { it.employeeId != myId }
                    rv.adapter = LeaveListAdapter(items, showName = true, showAction = true) { load() }
                } catch (_: Exception) {}
            }
        }
        load()
        return root
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REGULARIZATIONS APPROVAL
// ═══════════════════════════════════════════════════════════════════════════════
class RegularizationsFragment : Fragment() {
    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View {
        val ctx = requireContext(); val dp = ctx.resources.displayMetrics.density
        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL; setBackgroundColor(ctx.getColor(R.color.background))
        }
        root.addView(TextView(ctx).apply {
            text = "Regularization Requests"; textSize = 20f; setTypeface(null, android.graphics.Typeface.BOLD)
            setPadding((16*dp).toInt(),(16*dp).toInt(),(16*dp).toInt(),(12*dp).toInt())
        })
        val rv = RecyclerView(ctx).apply { layoutManager = LinearLayoutManager(ctx); setPadding((8*dp).toInt(),0,(8*dp).toInt(),(80*dp).toInt()); clipToPadding = false }
        root.addView(rv)
        fun load() {
            lifecycleScope.launch {
                try {
                    val res = RetrofitClient.instance.getRegularizations("pending")
                    val items = res.body()?.data ?: emptyList()
                    rv.adapter = RegularizationApprovalAdapter(items) { load() }
                } catch (_: Exception) {}
            }
        }
        load()
        return root
    }
}

class RegularizationApprovalAdapter(
    private val items: List<RegularizationItem>,
    private val onRefresh: () -> Unit
) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
    override fun getItemCount() = items.size
    override fun onCreateViewHolder(p: ViewGroup, t: Int): RecyclerView.ViewHolder {
        val ctx = p.context; val dp = ctx.resources.displayMetrics.density
        val card = androidx.cardview.widget.CardView(ctx).apply {
            radius = 14*dp; cardElevation = 2*dp; setCardBackgroundColor(ctx.getColor(R.color.surface))
            layoutParams = RecyclerView.LayoutParams(RecyclerView.LayoutParams.MATCH_PARENT, RecyclerView.LayoutParams.WRAP_CONTENT).also { it.setMargins(0,0,0,(8*dp).toInt()) }
        }
        return object : RecyclerView.ViewHolder(card) {}
    }
    override fun onBindViewHolder(h: RecyclerView.ViewHolder, pos: Int) {
        val it = items[pos]; val ctx = h.itemView.context; val dp = ctx.resources.displayMetrics.density
        val card = h.itemView as androidx.cardview.widget.CardView; card.removeAllViews()
        val ll = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; setPadding((14*dp).toInt(),(12*dp).toInt(),(14*dp).toInt(),(12*dp).toInt()) }
        ll.addView(TextView(ctx).apply { text = it.employeeName ?: "—"; textSize = 14f; setTypeface(null, android.graphics.Typeface.BOLD) })
        ll.addView(TextView(ctx).apply { text = "Date: ${it.date?.toDisplayDate() ?: "—"}"; textSize = 12f; setTextColor(ctx.getColor(R.color.text_secondary)) })
        ll.addView(TextView(ctx).apply { text = "In: ${it.requestedPunchIn?.take(5) ?: "--"}  Out: ${it.requestedPunchOut?.take(5) ?: "--"}"; textSize = 12f; setTextColor(ctx.getColor(R.color.text_secondary)) })
        ll.addView(TextView(ctx).apply { text = it.reason ?: "—"; textSize = 11f; setTextColor(ctx.getColor(R.color.text_hint)) })
        if (it.status?.lowercase() == "pending") {
            val regId = it.id  // capture before click listeners (avoids `it` shadowing)
            val br = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { m -> m.topMargin = (8*dp).toInt() } }
            br.addView(MaterialButton(ctx, null, com.google.android.material.R.attr.materialButtonStyle).apply {
                text = "Approve"; setBackgroundColor(ctx.getColor(R.color.primary)); textSize = 12f
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).also { m -> m.marginEnd = (8*dp).toInt() }
                setOnClickListener {
                    approvalConfirm(ctx, "✅ Approve Regularization") {
                        val res = RetrofitClient.instance.actionRegularization(mapOf("attendance_id" to regId, "action" to "approve"))
                        val ok = res.isSuccessful && res.body()?.success == true
                        if (ok) onRefresh()
                        Pair(ok, if (ok) "Regularization approved" else res.body()?.message ?: "Error ${res.code()}")
                    }
                }
            })
            br.addView(MaterialButton(ctx, null, com.google.android.material.R.attr.materialButtonStyle).apply {
                text = "Reject"; setBackgroundColor(ctx.getColor(R.color.accent_red)); textSize = 12f
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                setOnClickListener {
                    approvalConfirm(ctx, "❌ Reject Regularization") {
                        val res = RetrofitClient.instance.actionRegularization(mapOf("attendance_id" to regId, "action" to "reject"))
                        val ok = res.isSuccessful && res.body()?.success == true
                        if (ok) onRefresh()
                        Pair(ok, if (ok) "Regularization rejected" else res.body()?.message ?: "Error ${res.code()}")
                    }
                }
            })
            ll.addView(br)
        }
        card.addView(ll)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADVANCE FRAGMENT
// ═══════════════════════════════════════════════════════════════════════════════
class AdvanceFragment : Fragment() {
    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View {
        val ctx = requireContext(); val dp = ctx.resources.displayMetrics.density
        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL; setBackgroundColor(ctx.getColor(R.color.background))
            setPadding((16*dp).toInt(),(16*dp).toInt(),(16*dp).toInt(),(16*dp).toInt())
        }
        root.addView(TextView(ctx).apply { text = "Advance Salary"; textSize = 20f; setTypeface(null, android.graphics.Typeface.BOLD); setPadding(0,0,0,(12*dp).toInt()) })
        root.addView(MaterialButton(ctx, null, com.google.android.material.R.attr.materialButtonStyle).apply {
            text = "+ Apply for Advance"; setBackgroundColor(ctx.getColor(R.color.primary))
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.bottomMargin = (16*dp).toInt() }
        }.also { btn ->
            btn.setOnClickListener { ApplyAdvanceBottomSheet { loadAdvances(root, dp) }.show(childFragmentManager, "adv") }
        })
        loadAdvances(root, dp)
        return root
    }

    private fun loadAdvances(root: LinearLayout, dp: Float) {
        val ctx = requireContext()
        // Get the logged-in employee's ID so we only show THEIR OWN requests
        val myId = SessionManager(ctx).getEmployee()?.id
        lifecycleScope.launch {
            try {
                val res = RetrofitClient.instance.getAdvances()
                // Filter strictly to only this employee's own requests
                // (server may return all visible advances for manager-role users)
                val items = (res.body()?.data ?: emptyList())
                    .filter { it.employeeId == myId }
                    .filter { it.status.lowercase() != "rejected" }
                    .sortedByDescending { it.appliedOn ?: it.appliedAt ?: "" }
                // Remove old rv if exists
                val existingRV = root.findViewWithTag<RecyclerView>("adv_rv")
                if (existingRV != null) root.removeView(existingRV)
                val rv = RecyclerView(ctx).apply {
                    tag = "adv_rv"; layoutManager = LinearLayoutManager(ctx)
                }
                root.addView(rv)
                // Pass myId so adapter only shows Edit/Revoke on own requests
                rv.adapter = AdvanceAdapter(items, myId) { loadAdvances(root, dp) }
            } catch (_: Exception) {}
        }
    }
}

class AdvanceAdapter(
    private val items: List<AdvanceApplication>,
    private val myId: Int?,                  // logged-in employee id — guards Edit/Revoke
    private val onRefresh: () -> Unit = {}
) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
    override fun getItemCount() = items.size
    override fun onCreateViewHolder(p: ViewGroup, t: Int): RecyclerView.ViewHolder {
        val ctx = p.context; val dp = ctx.resources.displayMetrics.density
        val card = androidx.cardview.widget.CardView(ctx).apply {
            radius = 14*dp; cardElevation = 2*dp; setCardBackgroundColor(ctx.getColor(R.color.surface))
            layoutParams = RecyclerView.LayoutParams(RecyclerView.LayoutParams.MATCH_PARENT, RecyclerView.LayoutParams.WRAP_CONTENT).also { it.setMargins(0,0,0,(8*dp).toInt()) }
        }
        return object : RecyclerView.ViewHolder(card) {}
    }
    override fun onBindViewHolder(h: RecyclerView.ViewHolder, pos: Int) {
        val it = items[pos]; val ctx = h.itemView.context; val dp = ctx.resources.displayMetrics.density
        val card = h.itemView as androidx.cardview.widget.CardView; card.removeAllViews()
        val ll = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; setPadding((14*dp).toInt(),(12*dp).toInt(),(14*dp).toInt(),(12*dp).toInt()) }

        // ── Top row: amount + status badge ──────────────────────────────────
        val topRow = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = android.view.Gravity.CENTER_VERTICAL }
        topRow.addView(TextView(ctx).apply {
            text = it.amount.toRupees(); textSize = 18f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(ctx.getColor(R.color.primary))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        })
        topRow.addView(TextView(ctx).apply {
            val isRevoked = it.status == "rejected" && (it.remarks ?: "").lowercase().contains("revoked by employee")
            text = if (isRevoked) "REVOKED" else it.status.replaceFirstChar { c -> c.uppercase() }
            textSize = 11f
            setPadding((8*dp).toInt(),(3*dp).toInt(),(8*dp).toInt(),(3*dp).toInt())
            setTextColor(getStatusColor(ctx, it.status))
        })
        ll.addView(topRow)

        // ── Requester name (shown when viewing someone else's request) ───────
        val empName = it.employeeName ?: it.employeeCode
        if (!empName.isNullOrBlank() && it.employeeId != myId) {
            ll.addView(TextView(ctx).apply {
                text = empName; textSize = 13f
                setTypeface(null, android.graphics.Typeface.BOLD)
                setTextColor(ctx.getColor(R.color.text_primary))
                setPadding(0,(4*dp).toInt(),0,0)
            })
        }

        // ── Reason ──────────────────────────────────────────────────────────
        if (!it.reason.isNullOrBlank()) ll.addView(TextView(ctx).apply {
            text = "Reason: ${it.reason}"; textSize = 12f
            setTextColor(ctx.getColor(R.color.text_secondary))
            setPadding(0,(4*dp).toInt(),0,0)
        })

        // ── Date ─────────────────────────────────────────────────────────────
        val dateStr = it.requestedAt?.take(10) ?: it.appliedOn?.take(10) ?: it.appliedAt?.take(10)
        ll.addView(TextView(ctx).apply {
            text = "Requested: ${dateStr?.toDisplayDate() ?: "—"}"
            textSize = 11f; setTextColor(ctx.getColor(R.color.text_hint))
            setPadding(0,(2*dp).toInt(),0,0)
        })

        // ── Edit & Revoke buttons — ONLY for THIS employee's OWN pending requests ──
        val isPending = it.status.lowercase() == "pending"
        val isOwn = it.employeeId == myId
        if (isPending && isOwn) {
            val btnRow = LinearLayout(ctx).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                    .also { m -> m.topMargin = (10*dp).toInt() }
            }

            // Edit button
            btnRow.addView(MaterialButton(ctx, null, com.google.android.material.R.attr.materialButtonStyle).apply {
                text = "✏️ Edit"; textSize = 12f
                setBackgroundColor(android.graphics.Color.parseColor("#F0F0F0"))
                setTextColor(ctx.getColor(R.color.text_primary))
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                    .also { m -> m.marginEnd = (8*dp).toInt() }
                setOnClickListener {
                    showEditDialog(ctx, items[pos].id, items[pos].amount, items[pos].reason ?: "", onRefresh)
                }
            })

            // Revoke button
            btnRow.addView(MaterialButton(ctx, null, com.google.android.material.R.attr.materialButtonStyle).apply {
                text = "🗑 Revoke"; textSize = 12f
                setBackgroundColor(ctx.getColor(R.color.accent_red))
                setTextColor(android.graphics.Color.WHITE)
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                setOnClickListener {
                    val advId = items[pos].id
                    androidx.appcompat.app.AlertDialog.Builder(ctx)
                        .setTitle("Revoke Advance")
                        .setMessage("Are you sure you want to revoke this advance request?")
                        .setPositiveButton("Yes") { _, _ ->
                            kotlinx.coroutines.GlobalScope.launch(kotlinx.coroutines.Dispatchers.Main) {
                                try {
                                    val res = RetrofitClient.instance.revokeAdvance(advId)
                                    val ok = res.isSuccessful && res.body()?.success == true
                                    android.widget.Toast.makeText(ctx, if (ok) "Advance revoked" else res.body()?.message ?: "Failed", android.widget.Toast.LENGTH_SHORT).show()
                                    if (ok) onRefresh()
                                } catch (e: Exception) {
                                    android.widget.Toast.makeText(ctx, "Error: ${e.message}", android.widget.Toast.LENGTH_SHORT).show()
                                }
                            }
                        }
                        .setNegativeButton("Cancel", null)
                        .show()
                }
            })
            ll.addView(btnRow)
        }

        card.addView(ll)
    }

    private fun showEditDialog(ctx: android.content.Context, advId: Int, currentAmount: Double, currentReason: String, onRefresh: () -> Unit) {
        val dp = ctx.resources.displayMetrics.density
        val layout = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding((20*dp).toInt(),(16*dp).toInt(),(20*dp).toInt(),(8*dp).toInt())
        }
        val etAmount = android.widget.EditText(ctx).apply {
            hint = "Amount (₹)"; inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL
            setText(currentAmount.toInt().toString())
            setBackgroundColor(android.graphics.Color.parseColor("#F5F5F5"))
            setPadding((12*dp).toInt(),(10*dp).toInt(),(12*dp).toInt(),(10*dp).toInt())
        }
        val etReason = android.widget.EditText(ctx).apply {
            hint = "Reason"; setText(currentReason)
            setBackgroundColor(android.graphics.Color.parseColor("#F5F5F5"))
            setPadding((12*dp).toInt(),(10*dp).toInt(),(12*dp).toInt(),(10*dp).toInt())
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                .also { it.topMargin = (10*dp).toInt() }
        }
        layout.addView(TextView(ctx).apply { text = "Amount (₹)"; textSize = 12f; setTextColor(android.graphics.Color.GRAY) })
        layout.addView(etAmount)
        layout.addView(TextView(ctx).apply { text = "Reason"; textSize = 12f; setTextColor(android.graphics.Color.GRAY); layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = (10*dp).toInt() } })
        layout.addView(etReason)

        androidx.appcompat.app.AlertDialog.Builder(ctx)
            .setTitle("Edit Advance Request")
            .setView(layout)
            .setPositiveButton("Save") { _, _ ->
                val newAmount = etAmount.text.toString().toDoubleOrNull()
                val newReason = etReason.text.toString().trim()
                if (newAmount == null || newAmount <= 0 || newReason.isBlank()) {
                    android.widget.Toast.makeText(ctx, "Amount and reason required", android.widget.Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                kotlinx.coroutines.GlobalScope.launch(kotlinx.coroutines.Dispatchers.Main) {
                    try {
                        val res = RetrofitClient.instance.editAdvance(advId, com.krishihr.app.data.models.AdvanceEditRequest(newAmount, newReason))
                        val ok = res.isSuccessful && res.body()?.success == true
                        android.widget.Toast.makeText(ctx, if (ok) "Advance updated" else res.body()?.message ?: "Failed", android.widget.Toast.LENGTH_SHORT).show()
                        if (ok) onRefresh()
                    } catch (e: Exception) {
                        android.widget.Toast.makeText(ctx, "Error: ${e.message}", android.widget.Toast.LENGTH_SHORT).show()
                    }
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }
}

class ApplyAdvanceBottomSheet(private val onSuccess: () -> Unit) : BottomSheetDialogFragment() {
    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View {
        val ctx = requireContext(); val dp = ctx.resources.displayMetrics.density
        val root = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; setPadding((20*dp).toInt(),(20*dp).toInt(),(20*dp).toInt(),(32*dp).toInt()) }
        root.addView(TextView(ctx).apply { text = "Apply for Advance Salary"; textSize = 18f; setTypeface(null, android.graphics.Typeface.BOLD); setPadding(0,0,0,(16*dp).toInt()) })
        val etAmount = EditText(ctx).apply { hint = "Amount (₹) *"; inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL; setBackgroundColor(ctx.getColor(R.color.background)); setPadding((8*dp).toInt(),(8*dp).toInt(),(8*dp).toInt(),(8*dp).toInt()) }
        root.addView(etAmount)
        val etReason = EditText(ctx).apply { hint = "Reason *"; minLines = 2; setBackgroundColor(ctx.getColor(R.color.background)); setPadding((8*dp).toInt(),(8*dp).toInt(),(8*dp).toInt(),(8*dp).toInt()); layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = (12*dp).toInt() } }
        root.addView(etReason)

        // ── Project dropdown ──────────────────────────────────────────────────
        root.addView(TextView(ctx).apply {
            text = "Link to Project (optional)"; textSize = 12f
            setTextColor(android.graphics.Color.parseColor("#666666"))
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = (14*dp).toInt(); it.bottomMargin = (4*dp).toInt() }
        })
        var projectList = listOf<Project>()
        var selectedProjectId: Int? = null
        val spinnerProject = Spinner(ctx).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        }
        root.addView(spinnerProject)

        val progress = ProgressBar(ctx).apply { visibility = View.GONE }
        root.addView(progress)
        root.addView(MaterialButton(ctx, null, com.google.android.material.R.attr.materialButtonStyle).apply {
            text = "Submit Application"; setBackgroundColor(ctx.getColor(R.color.primary))
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = (16*dp).toInt() }
            setOnClickListener {
                val amount = etAmount.text.toString().toDoubleOrNull() ?: run { toast("Enter valid amount"); return@setOnClickListener }
                val reason = etReason.text.toString().trim().ifEmpty { toast("Enter reason"); return@setOnClickListener }
                selectedProjectId = if (spinnerProject.selectedItemPosition > 0) projectList.getOrNull(spinnerProject.selectedItemPosition - 1)?.id else null
                progress.visibility = View.VISIBLE; isEnabled = false
                lifecycleScope.launch {
                    try {
                        val res = RetrofitClient.instance.applyAdvance(AdvanceRequest(amount, reason, selectedProjectId))
                        if (res.isSuccessful && res.body()?.success == true) { toast("Application submitted ✅"); onSuccess(); dismiss() }
                        else toast(res.body()?.message ?: "Failed")
                    } catch (_: Exception) { toast("Network error") }
                    finally { progress.visibility = View.GONE; isEnabled = true }
                }
            }
        })

        // Load projects
        lifecycleScope.launch {
            try {
                val res = RetrofitClient.instance.getProjects(status = "active")
                projectList = res.body()?.data ?: emptyList()
                val names = mutableListOf("-- No Project --")
                names.addAll(projectList.map { "${it.name}${if (it.code != null) " (${it.code})" else ""}" })
                spinnerProject.adapter = ArrayAdapter(ctx, android.R.layout.simple_spinner_item, names).also { it.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item) }
            } catch (_: Exception) {}
        }

        return root
    }
}


// ── OD/WFH data + adapter (uses attendance/od|wfh endpoints, NOT leave) ───────
data class ODWFHItem(
    val id: Int,
    val employeeId: Int?,
    val name: String,
    val date: String?,
    val reason: String?,
    val status: String,
    val requestType: String,
    // ✅ FIX: Support grouped multi-day OD as one card
    val fromDate: String? = date,
    val toDate: String? = date,
    val days: Int = 1,
    val ids: List<Int> = listOf(id)  // all row IDs for bulk approve/reject
)

class ODWFHApprovalAdapter(
    private val items: List<ODWFHItem>,
    private val onRefresh: () -> Unit
) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
    override fun getItemCount() = items.size
    override fun onCreateViewHolder(p: ViewGroup, t: Int): RecyclerView.ViewHolder {
        val ctx = p.context; val dp = ctx.resources.displayMetrics.density
        val card = androidx.cardview.widget.CardView(ctx).apply {
            radius = 14*dp; cardElevation = 2*dp
            setCardBackgroundColor(ctx.getColor(R.color.surface))
            layoutParams = RecyclerView.LayoutParams(
                RecyclerView.LayoutParams.MATCH_PARENT, RecyclerView.LayoutParams.WRAP_CONTENT)
                .also { it.setMargins(0, 0, 0, (8*dp).toInt()) }
        }
        return object : RecyclerView.ViewHolder(card) {}
    }
    override fun onBindViewHolder(h: RecyclerView.ViewHolder, pos: Int) {
        val item = items[pos]; val ctx = h.itemView.context; val dp = ctx.resources.displayMetrics.density
        val card = h.itemView as androidx.cardview.widget.CardView; card.removeAllViews()
        val ll = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; setPadding((14*dp).toInt(),(12*dp).toInt(),(14*dp).toInt(),(12*dp).toInt()) }
        // Header row: name + type badge
        val headerRow = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = android.view.Gravity.CENTER_VERTICAL }
        headerRow.addView(TextView(ctx).apply {
            text = item.name; textSize = 14f; setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(ctx.getColor(R.color.text_primary))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        })
        headerRow.addView(TextView(ctx).apply {
            text = item.requestType
            textSize = 11f; setPadding((8*dp).toInt(),(3*dp).toInt(),(8*dp).toInt(),(3*dp).toInt())
            setTextColor(ctx.getColor(R.color.white))
            setBackgroundColor(if (item.requestType == "OD") android.graphics.Color.parseColor("#1565C0") else android.graphics.Color.parseColor("#6A1B9A"))
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(if (item.requestType == "OD") android.graphics.Color.parseColor("#1565C0") else android.graphics.Color.parseColor("#6A1B9A"))
                cornerRadius = 12*dp
            }
        })
        ll.addView(headerRow)
        ll.addView(TextView(ctx).apply {
            // ✅ FIX: Show date range "16 Apr → 24 Apr (8 days)" instead of single date
            text = if (item.days > 1)
                "${item.fromDate?.toDisplayDate() ?: "—"} → ${item.toDate?.toDisplayDate() ?: "—"} (${item.days} days)"
            else
                item.date?.toDisplayDate() ?: "—"
            textSize = 12f; setTextColor(ctx.getColor(R.color.text_secondary)); setPadding(0,(2*dp).toInt(),0,0)
        })
        if (!item.reason.isNullOrBlank()) ll.addView(TextView(ctx).apply { text = item.reason; textSize = 11f; setTextColor(ctx.getColor(R.color.text_hint)); setPadding(0,(2*dp).toInt(),0,0) })

        val itemId = item.id  // capture before click listeners
        val br = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { m -> m.topMargin = (10*dp).toInt() } }
        br.addView(MaterialButton(ctx, null, com.google.android.material.R.attr.materialButtonStyle).apply {
            text = "Approve"; setBackgroundColor(ctx.getColor(R.color.primary)); textSize = 12f
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).also { m -> m.marginEnd = (8*dp).toInt() }
            setOnClickListener {
                approvalConfirm(ctx, "✅ Approve ${item.requestType}") {
                    // ✅ FIX: Approve all IDs in group (one per day)
                    var ok = true; var msg = "${item.requestType} approved"
                    for (id in item.ids) {
                        val res = if (item.requestType == "OD")
                            RetrofitClient.instance.actionOD(id, ActionRequest("approve"))
                        else
                            RetrofitClient.instance.actionWFH(id, ActionRequest("approve"))
                        if (!res.isSuccessful || res.body()?.success != true) {
                            ok = false; msg = res.body()?.message ?: "Error ${res.code()}"
                        }
                    }
                    if (ok) onRefresh()
                    Pair(ok, msg)
                }
            }
        })
        br.addView(MaterialButton(ctx, null, com.google.android.material.R.attr.materialButtonStyle).apply {
            text = "Reject"; setBackgroundColor(ctx.getColor(R.color.accent_red)); textSize = 12f
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            setOnClickListener {
                approvalConfirm(ctx, "❌ Reject ${item.requestType}") {
                    // ✅ FIX: Reject all IDs in group
                    var ok = true; var msg = "${item.requestType} rejected"
                    for (id in item.ids) {
                        val res = if (item.requestType == "OD")
                            RetrofitClient.instance.actionOD(id, ActionRequest("reject"))
                        else
                            RetrofitClient.instance.actionWFH(id, ActionRequest("reject"))
                        if (!res.isSuccessful || res.body()?.success != true) {
                            ok = false; msg = res.body()?.message ?: "Error ${res.code()}"
                        }
                    }
                    if (ok) onRefresh()
                    Pair(ok, msg)
                }
            }
        })
        ll.addView(br); card.addView(ll)
    }
}

// ── Advance Approval Adapter (used in ApprovalsFragment tabs) ─────────────────
class AdvanceApprovalAdapter(
    private val items: List<AdvanceApplication>,
    private val myEmployeeCode: String?,
    private val onRefresh: () -> Unit
) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
    override fun getItemCount() = items.size
    override fun onCreateViewHolder(p: ViewGroup, t: Int): RecyclerView.ViewHolder {
        val ctx = p.context; val dp = ctx.resources.displayMetrics.density
        val card = androidx.cardview.widget.CardView(ctx).apply {
            radius = 14*dp; cardElevation = 2*dp
            setCardBackgroundColor(ctx.getColor(R.color.surface))
            layoutParams = RecyclerView.LayoutParams(
                RecyclerView.LayoutParams.MATCH_PARENT, RecyclerView.LayoutParams.WRAP_CONTENT)
                .also { it.setMargins(0, 0, 0, (8*dp).toInt()) }
        }
        return object : RecyclerView.ViewHolder(card) {}
    }
    override fun onBindViewHolder(h: RecyclerView.ViewHolder, pos: Int) {
        val it = items[pos]; val ctx = h.itemView.context; val dp = ctx.resources.displayMetrics.density
        val card = h.itemView as androidx.cardview.widget.CardView; card.removeAllViews()
        val ll = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; setPadding((14*dp).toInt(),(12*dp).toInt(),(14*dp).toInt(),(12*dp).toInt()) }
        ll.addView(TextView(ctx).apply { text = it.employeeName ?: "Employee"; textSize = 14f; setTypeface(null, android.graphics.Typeface.BOLD); setTextColor(ctx.getColor(R.color.text_primary)) })
        ll.addView(TextView(ctx).apply { text = "Amount: ${it.amount.toRupees()}"; textSize = 14f; setTextColor(ctx.getColor(R.color.primary)) })
        ll.addView(TextView(ctx).apply { text = it.reason ?: "—"; textSize = 12f; setTextColor(ctx.getColor(R.color.text_secondary)) })
        ll.addView(TextView(ctx).apply { text = "Applied: ${it.appliedOn?.take(10)?.toDisplayDate() ?: it.requestedAt?.take(10) ?: "—"}"; textSize = 11f; setTextColor(ctx.getColor(R.color.text_hint)) })
        val advId = it.id  // capture before click listeners (avoids `it` shadowing)
        // Only show Approve/Reject if it is THIS user's turn in the chain
        val isMyTurn = !myEmployeeCode.isNullOrBlank() && it.currentApproverCode == myEmployeeCode
        if (isMyTurn) {
            val br = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { m -> m.topMargin = (10*dp).toInt() } }
            br.addView(MaterialButton(ctx, null, com.google.android.material.R.attr.materialButtonStyle).apply {
                text = "Approve"; setBackgroundColor(ctx.getColor(R.color.primary)); textSize = 12f
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).also { m -> m.marginEnd = (8*dp).toInt() }
                setOnClickListener {
                    approvalConfirm(ctx, "✅ Approve Advance") {
                        val res = RetrofitClient.instance.advanceAction(advId, ActionRequest("approve"))
                        val ok = res.isSuccessful && res.body()?.success == true
                        if (ok) onRefresh()
                        Pair(ok, if (ok) "Advance approved" else res.body()?.message ?: "Error ${res.code()}")
                    }
                }
            })
            br.addView(MaterialButton(ctx, null, com.google.android.material.R.attr.materialButtonStyle).apply {
                text = "Reject"; setBackgroundColor(ctx.getColor(R.color.accent_red)); textSize = 12f
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                setOnClickListener {
                    approvalConfirm(ctx, "❌ Reject Advance") {
                        val res = RetrofitClient.instance.advanceAction(advId, ActionRequest("reject"))
                        val ok = res.isSuccessful && res.body()?.success == true
                        if (ok) onRefresh()
                        Pair(ok, if (ok) "Advance rejected" else res.body()?.message ?: "Error ${res.code()}")
                    }
                }
            })
            ll.addView(br)
        } else {
            ll.addView(TextView(ctx).apply {
                text = "⏳ Awaiting: ${it.currentApproverCode ?: "next approver"}"
                textSize = 11f
                setTextColor(ctx.getColor(R.color.text_hint))
                setPadding(0, (8*dp).toInt(), 0, 0)
            })
        }
        card.addView(ll)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADVANCE APPROVALS (for approvers)
// ═══════════════════════════════════════════════════════════════════════════════
class AdvanceApprovalsFragment : Fragment() {
    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View {
        val ctx = requireContext(); val dp = ctx.resources.displayMetrics.density
        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(ctx.getColor(R.color.background))
            layoutParams = android.view.ViewGroup.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT)
        }
        root.addView(TextView(ctx).apply { text = "Advance Approvals"; textSize = 20f; setTypeface(null, android.graphics.Typeface.BOLD); setPadding((16*dp).toInt(),(16*dp).toInt(),(16*dp).toInt(),(12*dp).toInt()) })
        val rv = RecyclerView(ctx).apply { layoutManager = LinearLayoutManager(ctx); setPadding((8*dp).toInt(),0,(8*dp).toInt(),(80*dp).toInt()); clipToPadding = false }
        root.addView(rv)
        fun load() {
            lifecycleScope.launch {
                try {
                    val session = SessionManager(requireContext())
                    val myId = session.getEmployee()?.id
                    val myEmployeeCode = session.getEmployee()?.employeeCode
                    val res = RetrofitClient.instance.getAdvancesForApproval()
                    val pending = (res.body()?.data ?: emptyList())
                        .filter { it.status.lowercase() == "pending" && it.employeeId != myId && it.currentApproverCode == myEmployeeCode }
                    rv.adapter = AdvanceApprovalAdapter(pending, myEmployeeCode) { load() }
                } catch (_: Exception) {}
            }
        }
        load(); return root
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMPLOYEES FRAGMENT
// ═══════════════════════════════════════════════════════════════════════════════
class EmployeesFragment : Fragment() {
    private val allEmployees = mutableListOf<Employee>()
    private var adapter: EmployeeAdapter? = null

    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View {
        val ctx = requireContext(); val dp = ctx.resources.displayMetrics.density
        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(ctx.getColor(R.color.background))
            layoutParams = android.view.ViewGroup.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val searchBar = EditText(ctx).apply {
            hint = "🔍 Search employees…"; textSize = 14f
            setBackgroundColor(ctx.getColor(R.color.surface))
            setPadding((16*dp).toInt(),(14*dp).toInt(),(16*dp).toInt(),(14*dp).toInt())
        }
        root.addView(searchBar)

        val role = SessionManager(ctx).getRole()
        if (Roles.canManageEmployees(role)) {
            root.addView(MaterialButton(ctx, null, com.google.android.material.R.attr.materialButtonStyle).apply {
                text = "+ Add Employee"; setBackgroundColor(ctx.getColor(R.color.primary))
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.setMargins((8*dp).toInt(),(8*dp).toInt(),(8*dp).toInt(),0) }
                setOnClickListener { (activity as? MainActivity)?.loadFragment(AddEmployeeFragment()) }
            })
        }

        val tvEmpty = TextView(ctx).apply {
            text = "Loading employees..."; textSize = 14f; gravity = android.view.Gravity.CENTER
            setTextColor(ctx.getColor(R.color.text_hint))
            setPadding(0,(32*dp).toInt(),0,0)
        }
        root.addView(tvEmpty)

        val rv = RecyclerView(ctx).apply {
            layoutManager = LinearLayoutManager(ctx)
            setPadding((8*dp).toInt(),(8*dp).toInt(),(8*dp).toInt(),(80*dp).toInt())
            clipToPadding = false
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        root.addView(rv)

        adapter = EmployeeAdapter(allEmployees) { emp ->
            (activity as? MainActivity)?.loadFragment(EmployeeDetailFragment().also { f ->
                f.arguments = Bundle().also { b -> b.putParcelable("emp", emp) }
            })
        }
        rv.adapter = adapter

        searchBar.addTextChangedListener(object : android.text.TextWatcher {
            override fun afterTextChanged(s: android.text.Editable?) {
                val q = s.toString().lowercase()
                val filtered = allEmployees.filter { it.fullName.lowercase().contains(q) || (it.employeeCode?.lowercase()?.contains(q) == true) || (it.email.lowercase().contains(q)) }
                adapter?.updateList(filtered)
            }
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
        })

        lifecycleScope.launch {
            try {
                val res = RetrofitClient.instance.getEmployees()
                if (res.isSuccessful) {
                    val rawEmployees = res.body()?.data ?: emptyList()
                    // Step 1: Show immediately with whatever we have cached locally
                    val employees = SessionManager(ctx).mergeEmployeesWithCachedPhotos(rawEmployees)
                    allEmployees.clear()
                    allEmployees.addAll(employees)
                    adapter?.updateList(allEmployees)
                    tvEmpty.text = if (employees.isEmpty()) "No employees found" else ""
                    tvEmpty.visibility = if (employees.isEmpty()) android.view.View.VISIBLE else android.view.View.GONE

                    // Step 2: For employees still missing a photo, fetch their individual
                    // profile in the background — the /employees/{id} endpoint returns profile_photo
                    val session = SessionManager(ctx)
                    val missingPhoto = employees.filter { it.profilePhoto.isNullOrBlank() }
                    missingPhoto.forEach { emp ->
                        launch {
                            try {
                                val detail = RetrofitClient.instance.getEmployee(emp.id)
                                val photo = detail.body()?.data?.profilePhoto
                                if (!photo.isNullOrBlank()) {
                                    // Cache the photo so future loads don't need to fetch again
                                    session.saveEmployeePhoto(emp.id, photo)
                                    // Update the in-memory list item and notify adapter
                                    val idx = allEmployees.indexOfFirst { it.id == emp.id }
                                    if (idx >= 0) {
                                        allEmployees[idx] = allEmployees[idx].copy(profilePhoto = photo)
                                        // Re-pass updated list to adapter so it renders the photo
                                        adapter?.updateList(allEmployees.toList())
                                    }
                                }
                            } catch (_: Exception) {}
                        }
                    }
                } else {
                    tvEmpty.text = "Error loading employees (${res.code()})"
                }
            } catch (e: Exception) {
                tvEmpty.text = "Network error: ${e.message}"
            }
        }
        return root
    }
}

class EmployeeAdapter(
    private var items: List<Employee>,
    private val onClick: (Employee) -> Unit
) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
    fun updateList(newItems: List<Employee>) { items = newItems; notifyDataSetChanged() }
    override fun getItemCount() = items.size
    override fun onCreateViewHolder(p: ViewGroup, t: Int): RecyclerView.ViewHolder {
        val ctx = p.context; val dp = ctx.resources.displayMetrics.density
        val card = androidx.cardview.widget.CardView(ctx).apply {
            radius = 14*dp; cardElevation = 2*dp; setCardBackgroundColor(ctx.getColor(R.color.surface))
            layoutParams = RecyclerView.LayoutParams(RecyclerView.LayoutParams.MATCH_PARENT, RecyclerView.LayoutParams.WRAP_CONTENT).also { it.setMargins(0,0,0,(6*dp).toInt()) }
        }
        return object : RecyclerView.ViewHolder(card) {}
    }
    override fun onBindViewHolder(h: RecyclerView.ViewHolder, pos: Int) {
        val emp = items[pos]; val ctx = h.itemView.context; val dp = ctx.resources.displayMetrics.density
        val card = h.itemView as androidx.cardview.widget.CardView; card.removeAllViews()
        val row = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = android.view.Gravity.CENTER_VERTICAL; setPadding((12*dp).toInt(),(12*dp).toInt(),(12*dp).toInt(),(12*dp).toInt()) }

        // Avatar circle - photo if available, else colored initials
        val avSize = (44*dp).toInt()
        // Consistent color based on name (not random - same person always same color)
        val avatarColors = listOf(
            0xFF2E7D45.toInt(), 0xFF1565C0.toInt(), 0xFF6A1B9A.toInt(),
            0xFFE65100.toInt(), 0xFFAD1457.toInt(), 0xFF00695C.toInt(),
            0xFF283593.toInt(), 0xFFC62828.toInt()
        )
        val avatarBg = avatarColors[(emp.firstName.firstOrNull()?.code ?: 0) % avatarColors.size]

        val avCard = androidx.cardview.widget.CardView(ctx).apply {
            radius = avSize / 2f; cardElevation = 0f
            setCardBackgroundColor(avatarBg)
            layoutParams = LinearLayout.LayoutParams(avSize, avSize).also { it.marginEnd = (12*dp).toInt() }
        }
        val initialsView = TextView(ctx).apply {
            text = emp.initials; textSize = 14f; gravity = android.view.Gravity.CENTER
            setTextColor(android.graphics.Color.WHITE)
            setTypeface(null, android.graphics.Typeface.BOLD)
            layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        }
        val imgView = android.widget.ImageView(ctx).apply {
            scaleType = android.widget.ImageView.ScaleType.CENTER_CROP
            layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
            visibility = android.view.View.GONE
        }
        avCard.addView(imgView)
        avCard.addView(initialsView)

        if (!emp.profilePhoto.isNullOrBlank()) {
            try {
                // Cache this photo by employee ID so it survives future API refreshes
                SessionManager(ctx).saveEmployeePhoto(emp.id, emp.profilePhoto)
                initialsView.visibility = android.view.View.GONE
                imgView.visibility = android.view.View.VISIBLE
                if (emp.profilePhoto.startsWith("data:image")) {
                    val bytes = android.util.Base64.decode(emp.profilePhoto.substringAfter(","), android.util.Base64.DEFAULT)
                    val bmp = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                    com.bumptech.glide.Glide.with(ctx).load(bmp).circleCrop().into(imgView)
                } else {
                    com.bumptech.glide.Glide.with(ctx).load(emp.profilePhoto).circleCrop().into(imgView)
                }
            } catch (_: Exception) {
                imgView.visibility = android.view.View.GONE
                initialsView.visibility = android.view.View.VISIBLE
            }
        }
        row.addView(avCard)

        val info = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f) }
        info.addView(TextView(ctx).apply { text = emp.fullName; textSize = 14f; setTypeface(null, android.graphics.Typeface.BOLD); setTextColor(ctx.getColor(R.color.text_primary)) })
        info.addView(TextView(ctx).apply { text = "${emp.designationTitle ?: emp.displayRole}  ·  ${emp.employeeCode ?: ""}"; textSize = 11f; setTextColor(ctx.getColor(R.color.text_secondary)) })
        info.addView(TextView(ctx).apply { text = emp.departmentName ?: "—"; textSize = 11f; setTextColor(ctx.getColor(R.color.text_hint)) })
        row.addView(info)

        val activeColor = if (emp.isActive) ctx.getColor(R.color.primary) else ctx.getColor(R.color.accent_red)
        row.addView(TextView(ctx).apply {
            text = if (emp.isActive) "Active" else "Inactive"; textSize = 10f
            setTextColor(activeColor); setTypeface(null, android.graphics.Typeface.BOLD)
        })
        card.addView(row)
        card.setOnClickListener { onClick(emp) }
    }
}

class EmployeeDetailFragment : Fragment() {
    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View {
        val ctx = requireContext(); val dp = ctx.resources.displayMetrics.density
        val emp = arguments?.getParcelable<Employee>("emp") ?: return LinearLayout(ctx)
        val sv = android.widget.ScrollView(ctx)
        val root = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(ctx.getColor(R.color.background)); setPadding((16*dp).toInt(),(16*dp).toInt(),(16*dp).toInt(),(80*dp).toInt()) }
        sv.addView(root)

        // Header card
        val hCard = androidx.cardview.widget.CardView(ctx).apply { radius = 16*dp; cardElevation = 3*dp; setCardBackgroundColor(ctx.getColor(R.color.primary)); layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.bottomMargin = (16*dp).toInt() } }
        val hll = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; gravity = android.view.Gravity.CENTER; setPadding((16*dp).toInt(),(24*dp).toInt(),(16*dp).toInt(),(24*dp).toInt()) }
        hll.addView(TextView(ctx).apply { text = emp.initials; textSize = 36f; setTextColor(ctx.getColor(R.color.white)); setTypeface(null, android.graphics.Typeface.BOLD); gravity = android.view.Gravity.CENTER })
        hll.addView(TextView(ctx).apply { text = emp.fullName; textSize = 20f; setTextColor(ctx.getColor(R.color.white)); setTypeface(null, android.graphics.Typeface.BOLD); gravity = android.view.Gravity.CENTER })
        hll.addView(TextView(ctx).apply { text = emp.designationTitle ?: emp.displayRole; textSize = 13f; setTextColor(ctx.getColor(R.color.primary_ultra_light)); gravity = android.view.Gravity.CENTER })
        hCard.addView(hll); root.addView(hCard)

        fun row(label: String, value: String) {
            val ll = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = android.view.Gravity.CENTER_VERTICAL; setPadding(0,(10*dp).toInt(),0,(10*dp).toInt()) }
            val div = View(ctx).apply { layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (1*dp).toInt()); setBackgroundColor(ctx.getColor(R.color.divider)) }
            ll.addView(TextView(ctx).apply { text = label; textSize = 12f; setTextColor(ctx.getColor(R.color.text_secondary)); layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f) })
            ll.addView(TextView(ctx).apply { text = value; textSize = 13f; setTypeface(null, android.graphics.Typeface.BOLD); setTextColor(ctx.getColor(R.color.text_primary)) })
            root.addView(ll); root.addView(div)
        }
        row("Employee ID",    emp.employeeCode ?: "—")
        row("Designation",    emp.designationTitle ?: "—")
        row("Department",     emp.departmentName ?: "—")
        row("Role",           emp.displayRole)
        row("Manager",        emp.managerName ?: "—")
        row("Date of Birth",  emp.dateOfBirth?.toDisplayDate() ?: "—")
        row("Date of Joining",emp.effectiveJoiningDate?.toDisplayDate() ?: "—")
        row("Gender",         emp.gender?.replaceFirstChar { it.uppercase() } ?: "—")
        row("Phone",          emp.phone ?: "—")
        row("Email",          emp.email)
        row("Status",      if (emp.isActive) "Active" else "Inactive")

        val role = SessionManager(ctx).getRole()
        if (Roles.canManageEmployees(role)) {
            root.addView(MaterialButton(ctx, null, com.google.android.material.R.attr.materialButtonStyle).apply {
                text = "Edit Employee"; setBackgroundColor(ctx.getColor(R.color.primary))
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = (16*dp).toInt() }
                setOnClickListener { toast("Edit employee via web panel for full form") }
            })
        }
        return sv
    }
}

class AddEmployeeFragment : Fragment() {
    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View {
        val ctx = requireContext(); val dp = ctx.resources.displayMetrics.density
        val sv = android.widget.ScrollView(ctx)
        val root = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(ctx.getColor(R.color.background)); setPadding((16*dp).toInt(),(16*dp).toInt(),(16*dp).toInt(),(80*dp).toInt()) }
        sv.addView(root)
        root.addView(TextView(ctx).apply { text = "Add New Employee"; textSize = 20f; setTypeface(null, android.graphics.Typeface.BOLD); setPadding(0,0,0,(16*dp).toInt()) })

        fun et(hint: String, inputType: Int = android.text.InputType.TYPE_CLASS_TEXT): EditText =
            EditText(ctx).apply {
                this.hint = hint; this.inputType = inputType
                setBackgroundColor(ctx.getColor(R.color.background))
                setPadding((8*dp).toInt(),(12*dp).toInt(),(8*dp).toInt(),(12*dp).toInt())
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.bottomMargin = (10*dp).toInt() }
            }

        val etFirst  = et("First Name *").also { root.addView(it) }
        val etLast   = et("Last Name *").also { root.addView(it) }
        val etEmail  = et("Email *", android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS).also { root.addView(it) }
        val etPhone  = et("Phone", android.text.InputType.TYPE_CLASS_PHONE).also { root.addView(it) }

        val roles = arrayOf("employee","hr","accounts","manager","tl","admin")
        val spRole = Spinner(ctx).apply { adapter = ArrayAdapter(ctx, android.R.layout.simple_spinner_dropdown_item, roles); layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.bottomMargin = (10*dp).toInt() } }
        root.addView(spRole)

        val progress = ProgressBar(ctx).apply { visibility = View.GONE }
        root.addView(progress)

        root.addView(MaterialButton(ctx, null, com.google.android.material.R.attr.materialButtonStyle).apply {
            text = "Create Employee"; setBackgroundColor(ctx.getColor(R.color.primary))
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = (8*dp).toInt() }
            setOnClickListener {
                val fn = etFirst.text.toString().trim(); val ln = etLast.text.toString().trim()
                val em = etEmail.text.toString().trim()
                if (fn.isEmpty() || ln.isEmpty() || em.isEmpty()) { toast("Fill required fields"); return@setOnClickListener }
                progress.visibility = View.VISIBLE; isEnabled = false
                lifecycleScope.launch {
                    try {
                        val body = mapOf<String, Any?>("first_name" to fn, "last_name" to ln, "email" to em, "phone" to etPhone.text.toString().trim().ifEmpty { null }, "role" to roles[spRole.selectedItemPosition])
                        val res = RetrofitClient.instance.createEmployee(body)
                        if (res.isSuccessful && res.body()?.success == true) { toast("Employee created ✅"); requireActivity().onBackPressed() }
                        else toast(res.body()?.message ?: "Failed")
                    } catch (_: Exception) { toast("Network error") }
                    finally { progress.visibility = View.GONE; isEnabled = true }
                }
            }
        })
        return sv
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS FRAGMENT
// ═══════════════════════════════════════════════════════════════════════════════
class NotificationsFragment : Fragment() {
    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View {
        val ctx = requireContext(); val dp = ctx.resources.displayMetrics.density
        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(ctx.getColor(R.color.background))
            layoutParams = android.view.ViewGroup.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT)
        }
        root.addView(TextView(ctx).apply { text = "Notifications"; textSize = 20f; setTypeface(null, android.graphics.Typeface.BOLD); setPadding((16*dp).toInt(),(16*dp).toInt(),(16*dp).toInt(),(12*dp).toInt()) })
        val rv = RecyclerView(ctx).apply { layoutManager = LinearLayoutManager(ctx); setPadding((8*dp).toInt(),0,(8*dp).toInt(),(80*dp).toInt()); clipToPadding = false }
        root.addView(rv)
        lifecycleScope.launch {
            try {
                // Fetch both notifications and announcements in parallel
                val notifDeferred = async { try { RetrofitClient.instance.getNotifications().body()?.data ?: emptyList() } catch (_: Exception) { emptyList<Notification>() } }
                val announcementsDeferred = async { try { RetrofitClient.instance.getAnnouncements().body()?.data ?: emptyList() } catch (_: Exception) { emptyList() } }

                val notifItems = notifDeferred.await().toMutableList()
                val announcements = announcementsDeferred.await()

                // Convert announcements to Notification items so they appear in the list
                // Only show announcements from senior designations (MD, COO, AVP, HR Executive, Accountant, Manager etc.)
                val announcementNotifs = announcements
                    .filter { ann ->
                        // If we have designation info, filter to senior only; otherwise show all (can't tell)
                        val desigId = ann.postedByDesignationId ?: ann.createdByDesignationId
                        val desigTitle = ann.authorDesignation
                        if (desigId != null || desigTitle != null) {
                            Announcement.isSeniorDesignation(desigId, desigTitle)
                        } else {
                            true // no designation info from API → show all announcements
                        }
                    }
                    .map { ann ->
                        // Show designation title (e.g. "COO", "HR Executive") — fallback to role name
                        val designationLabel = ann.authorDesignation
                            ?: when (ann.authorRole?.lowercase()) {
                                "super_admin" -> "Super Admin"
                                "admin"       -> "Admin"
                                "hr"          -> "HR Executive"
                                "accounts"    -> "Accountant"
                                "manager"     -> "Manager"
                                "tl"          -> "Team Lead"
                                else          -> ann.authorRole?.replaceFirstChar { it.uppercase() }
                            }
                        val postedBy = if (designationLabel != null)
                            "${ann.authorName} · $designationLabel"
                        else
                            ann.authorName
                        Notification(
                            id = -(ann.id),
                            title = ann.title,
                            message = "Posted by $postedBy",
                            type = "announcement",
                            isRead = true,
                            createdAt = ann.createdAt,
                            referenceId = ann.id
                        )
                    }

                // Merge and sort by date newest-first
                val combined = (notifItems + announcementNotifs).sortedByDescending { it.createdAt ?: "" }

                // Mark all real notifications as read + clear the bell badge on dashboard
                try {
                    RetrofitClient.instance.markAllRead()
                    (activity as? MainActivity)?.refreshDashboardBadge()
                } catch (_: Exception) {}
                rv.adapter = NotificationAdapter(combined)
            } catch (_: Exception) {}
        }
        return root
    }
}

class NotificationAdapter(private val items: List<Notification>) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
    override fun getItemCount() = items.size
    override fun onCreateViewHolder(p: ViewGroup, t: Int): RecyclerView.ViewHolder {
        val ctx = p.context; val dp = ctx.resources.displayMetrics.density
        val ll = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding((16*dp).toInt(),(12*dp).toInt(),(16*dp).toInt(),(12*dp).toInt())
            layoutParams = RecyclerView.LayoutParams(RecyclerView.LayoutParams.MATCH_PARENT, RecyclerView.LayoutParams.WRAP_CONTENT)
        }
        return object : RecyclerView.ViewHolder(ll) {}
    }
    override fun onBindViewHolder(h: RecyclerView.ViewHolder, pos: Int) {
        val notif = items[pos]; val ctx = h.itemView.context; val dp = ctx.resources.displayMetrics.density
        val ll = h.itemView as LinearLayout; ll.removeAllViews()
        ll.setBackgroundColor(if (!notif.isRead) ctx.getColor(R.color.primary_ultra_light) else ctx.getColor(R.color.surface))
        if (!notif.title.isNullOrBlank()) ll.addView(TextView(ctx).apply { text = notif.title; textSize = 14f; setTypeface(null, android.graphics.Typeface.BOLD); setTextColor(ctx.getColor(R.color.text_primary)) })
        if (!notif.message.isNullOrBlank()) ll.addView(TextView(ctx).apply { text = notif.message; textSize = 12f; setTextColor(ctx.getColor(R.color.text_secondary)); setPadding(0,(2*dp).toInt(),0,0) })
        // Type badge
        val typeLabel = when (notif.type?.lowercase()) {
            "leave", "leave_approved", "leave_rejected" -> "📋 Leave"
            "od" -> "🚗 OD"
            "wfh" -> "🏠 WFH"
            "regularization" -> "🕐 Regularize"
            "advance" -> "💰 Advance"
            "separation" -> "🚪 Separation"
            "provision" -> "📄 Provision"
            "payroll" -> "💵 Payroll"
            "announcement" -> "📢 Announcement"
            else -> null
        }
        val row = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = android.view.Gravity.CENTER_VERTICAL; layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { m -> m.topMargin = (4*dp).toInt() } }
        row.addView(TextView(ctx).apply { text = notif.createdAt?.take(10)?.toDisplayDate() ?: ""; textSize = 10f; setTextColor(ctx.getColor(R.color.text_hint)); layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f) })
        if (typeLabel != null) row.addView(TextView(ctx).apply {
            text = typeLabel; textSize = 10f; setTextColor(ctx.getColor(R.color.text_hint))
        })
        ll.addView(row)
        ll.addView(View(ctx).apply { layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (1*dp).toInt()).also { m -> m.topMargin = (8*dp).toInt() }; setBackgroundColor(ctx.getColor(R.color.divider)) })

        // Tap → navigate to relevant approval/screen
        ll.setOnClickListener {
            val activity = ctx as? MainActivity ?: return@setOnClickListener
            when (notif.type?.lowercase()) {
                "leave", "leave_approved", "leave_rejected" -> {
                    activity.loadTab(ApprovalsFragment.newInstance(0))
                    activity.binding.bottomNavView.menu.findItem(R.id.nav_approvals)?.isChecked = true
                }
                "od", "wfh" -> {
                    activity.loadTab(ApprovalsFragment.newInstance(1))
                    activity.binding.bottomNavView.menu.findItem(R.id.nav_approvals)?.isChecked = true
                }
                "regularization" -> {
                    activity.loadTab(ApprovalsFragment.newInstance(2))
                    activity.binding.bottomNavView.menu.findItem(R.id.nav_approvals)?.isChecked = true
                }
                "advance" -> {
                    activity.loadTab(ApprovalsFragment.newInstance(3))
                    activity.binding.bottomNavView.menu.findItem(R.id.nav_approvals)?.isChecked = true
                }
                "separation" -> {
                    activity.loadFragment(SeparationFragment())
                }
                "announcement" -> {
                    activity.binding.bottomNavView.menu.findItem(R.id.nav_dashboard)?.isChecked = true
                }
                "birthday", "anniversary" -> {
                    activity.loadTab(com.krishihr.app.ui.dashboard.DashboardFragment())
                    activity.binding.bottomNavView.menu.findItem(R.id.nav_dashboard)?.isChecked = true
                }
                else -> {
                    activity.loadTab(ApprovalsFragment.newInstance(0))
                    activity.binding.bottomNavView.menu.findItem(R.id.nav_approvals)?.isChecked = true
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GK QUIZ FRAGMENT — 30-second timer, auto-skip on app background
// ═══════════════════════════════════════════════════════════════════════════════
class GkQuizFragment : Fragment() {

    private var currentQuestion: GkQuestion? = null
    private var timerActive    = false   // true only while question is live (not yet answered)
    private var submitting     = false
    private var countdownTimer: android.os.CountDownTimer? = null

    // UI refs kept as fields so onPause can trigger auto-skip
    private var optionsGroupRef: LinearLayout? = null
    private var tvTimerRef: TextView? = null
    private var tvResultRef: TextView? = null
    private var tvAboutRef: TextView? = null
    private var tvStatsRef: TextView? = null
    private var timerBarRef: android.widget.ProgressBar? = null

    override fun onPause() {
        super.onPause()
        // App went to background while timer was running → auto-skip
        if (timerActive && !submitting) {
            countdownTimer?.cancel()
            timerActive = false
            val q = currentQuestion ?: return
            submitAnswer(q, "skip", "background")
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        countdownTimer?.cancel()
        optionsGroupRef = null; tvTimerRef = null; tvResultRef = null
        tvAboutRef = null; tvStatsRef = null; timerBarRef = null
    }

    override fun onCreateView(inf: LayoutInflater, c: ViewGroup?, s: Bundle?): View {
        val ctx = requireContext()
        val dp  = ctx.resources.displayMetrics.density

        val sv = androidx.core.widget.NestedScrollView(ctx).apply {
            setBackgroundColor(ctx.getColor(R.color.background))
            layoutParams = android.view.ViewGroup.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT)
        }
        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = android.view.ViewGroup.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        sv.addView(root)

        // ── Tab bar ──────────────────────────────────────────────────────────
        val tabRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(ctx.getColor(R.color.surface))
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (48*dp).toInt())
        }
        fun makeTabBtn(label: String) = MaterialButton(ctx, null,
            com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
            text = label; textSize = 13f; gravity = android.view.Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f)
            setBackgroundColor(android.graphics.Color.TRANSPARENT); strokeWidth = 0
        }
        val btnTabQuiz  = makeTabBtn("🌾  QUIZ")
        val btnTabBoard = makeTabBtn("🏆  LEADERBOARD")
        tabRow.addView(btnTabQuiz); tabRow.addView(btnTabBoard)

        val indicator = View(ctx).apply {
            setBackgroundColor(ctx.getColor(R.color.primary))
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (3*dp).toInt())
        }
        root.addView(tabRow); root.addView(indicator)

        // ── Quiz panel ───────────────────────────────────────────────────────
        val quizPanel = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding((16*dp).toInt(), (16*dp).toInt(), (16*dp).toInt(), (80*dp).toInt())
        }

        // Stats bar
        val tvStats = TextView(ctx).apply {
            textSize = 12f; setTextColor(ctx.getColor(R.color.text_secondary))
            setPadding(0, 0, 0, (12*dp).toInt()); text = "Loading stats…"
        }
        tvStatsRef = tvStats
        quizPanel.addView(tvStats)

        // Question card (initially shows "Start" button)
        val questionCard = androidx.cardview.widget.CardView(ctx).apply {
            radius = 16*dp; cardElevation = 4*dp
            setCardBackgroundColor(ctx.getColor(R.color.surface))
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT).also { it.bottomMargin = (16*dp).toInt() }
        }
        val questionCardInner = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding((18*dp).toInt(), (18*dp).toInt(), (18*dp).toInt(), (18*dp).toInt())
        }
        questionCard.addView(questionCardInner)
        quizPanel.addView(questionCard)
        root.addView(quizPanel)

        // ── Leaderboard panel ────────────────────────────────────────────────
        val boardPanel = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL; visibility = View.GONE
        }

        // Period tab row (Monthly / Yearly / All Time)
        val periodTabRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding((12*dp).toInt(), (10*dp).toInt(), (12*dp).toInt(), (4*dp).toInt())
        }
        val primaryColor   = ctx.getColor(R.color.primary)
        val surfaceColor   = ctx.getColor(R.color.surface)
        val mutedColor     = ctx.getColor(R.color.text_secondary)
        val primaryUltra   = ctx.getColor(R.color.primary_ultra_light)

        fun makePeriodBtn(label: String) = MaterialButton(ctx, null,
            com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
            text = label; textSize = 11f; gravity = android.view.Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                .also { it.marginEnd = (6*dp).toInt() }
            strokeWidth = 1; setPadding((4*dp).toInt(), (4*dp).toInt(), (4*dp).toInt(), (4*dp).toInt())
        }

        val btnPeriodMonth = makePeriodBtn("📅 Monthly")
        val btnPeriodYear  = makePeriodBtn("📆 Yearly")
        val btnPeriodAll   = makePeriodBtn("🏅 All Time")
        periodTabRow.addView(btnPeriodMonth)
        periodTabRow.addView(btnPeriodYear)
        periodTabRow.addView(btnPeriodAll)
        boardPanel.addView(periodTabRow)

        val boardProgress = ProgressBar(ctx).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT).also {
                it.gravity = android.view.Gravity.CENTER_HORIZONTAL; it.topMargin = (16*dp).toInt()
            }; visibility = View.GONE
        }
        boardPanel.addView(boardProgress)
        val boardRv = RecyclerView(ctx).apply {
            layoutManager = LinearLayoutManager(ctx); isNestedScrollingEnabled = false
            setPadding((8*dp).toInt(), 0, (8*dp).toInt(), (80*dp).toInt()); clipToPadding = false
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT)
        }
        boardPanel.addView(boardRv)
        root.addView(boardPanel)

        // ── Tab switching ────────────────────────────────────────────────────
        fun selectTab(quiz: Boolean) {
            quizPanel.visibility  = if (quiz)  View.VISIBLE else View.GONE
            boardPanel.visibility = if (!quiz) View.VISIBLE else View.GONE
            btnTabQuiz.setTextColor(ctx.getColor(if (quiz)  R.color.primary else R.color.text_secondary))
            btnTabBoard.setTextColor(ctx.getColor(if (!quiz) R.color.primary else R.color.text_secondary))
        }
        selectTab(true)
        btnTabQuiz.setOnClickListener  { selectTab(true) }
        btnTabBoard.setOnClickListener { selectTab(false) }

        // ── Leaderboard loader with period support ───────────────────────────
        var currentPeriod = "month"

        fun updatePeriodBtns(period: String) {
            listOf(btnPeriodMonth to "month", btnPeriodYear to "year", btnPeriodAll to "all").forEach { (btn, p) ->
                if (p == period) {
                    btn.setBackgroundColor(primaryColor)
                    btn.setTextColor(android.graphics.Color.WHITE)
                    btn.strokeWidth = 0
                } else {
                    btn.setBackgroundColor(surfaceColor)
                    btn.setTextColor(mutedColor)
                    btn.strokeWidth = 1
                }
            }
        }

        fun loadLeaderboard(period: String = currentPeriod) {
            currentPeriod = period
            updatePeriodBtns(period)
            boardProgress.visibility = View.VISIBLE; boardRv.visibility = View.GONE
            lifecycleScope.launch {
                try {
                    val res = RetrofitClient.instance.getLeaderboard(period)
                    boardProgress.visibility = View.GONE; boardRv.visibility = View.VISIBLE
                    if (res.isSuccessful)
                        boardRv.adapter = LeaderboardAdapter(res.body()?.data ?: emptyList())
                    else toast("Leaderboard error ${res.code()}")
                } catch (e: Exception) {
                    boardProgress.visibility = View.GONE; boardRv.visibility = View.VISIBLE
                    toast("Leaderboard: ${e.message}")
                }
            }
        }

        btnPeriodMonth.setOnClickListener { loadLeaderboard("month") }
        btnPeriodYear.setOnClickListener  { loadLeaderboard("year") }
        btnPeriodAll.setOnClickListener   { loadLeaderboard("all") }

        loadLeaderboard("month")

        // ── Render quiz card ─────────────────────────────────────────────────
        fun renderQuestionCard(q: GkQuestion?) {
            questionCardInner.removeAllViews()
            optionsGroupRef = null; tvTimerRef = null; tvResultRef = null
            tvAboutRef = null; timerBarRef = null

            if (q == null) {
                questionCardInner.addView(TextView(ctx).apply {
                    text = "No question available today. Check back tomorrow! 🗓"
                    textSize = 14f; setTextColor(ctx.getColor(R.color.text_secondary))
                    gravity = android.view.Gravity.CENTER; setPadding(0, (16*dp).toInt(), 0, (16*dp).toInt())
                })
                return
            }

            if (q.alreadyAnswered) {
                // ── Already answered — show result ───────────────────────────
                val correct = q.myIsCorrect == true
                val isSkip  = q.myAnswer == "skip"

                questionCardInner.addView(TextView(ctx).apply {
                    text = "TODAY'S QUESTION"; textSize = 10f
                    setTextColor(ctx.getColor(R.color.primary))
                    setTypeface(null, android.graphics.Typeface.BOLD); letterSpacing = 0.1f
                    setPadding(0, 0, 0, (10*dp).toInt())
                })
                questionCardInner.addView(TextView(ctx).apply {
                    text = q.question; textSize = 15f; setTypeface(null, android.graphics.Typeface.BOLD)
                    setTextColor(ctx.getColor(R.color.text_primary))
                    setPadding(0, 0, 0, (14*dp).toInt())
                })

                // Option buttons (disabled, coloured)
                val opts = q.options
                opts.forEach { (letter, optText) ->
                    questionCardInner.addView(MaterialButton(ctx, null,
                        com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
                        text = "$letter.  $optText"; textSize = 13f; isEnabled = false
                        gravity = android.view.Gravity.START or android.view.Gravity.CENTER_VERTICAL
                        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,
                            LinearLayout.LayoutParams.WRAP_CONTENT).also { it.bottomMargin = (8*dp).toInt() }
                        when {
                            q.myAnswer == letter && correct  -> { setBackgroundColor(ctx.getColor(R.color.primary)); setTextColor(android.graphics.Color.WHITE) }
                            q.myAnswer == letter && !correct -> { setBackgroundColor(ctx.getColor(R.color.accent_red)); setTextColor(android.graphics.Color.WHITE) }
                            q.correctAnswer == letter        -> { setBackgroundColor(ctx.getColor(R.color.primary_ultra_light)) }
                        }
                    })
                }

                // Result banner
                val resultBg = when { correct -> 0xFFf0fdf4.toInt(); isSkip -> 0xFFfffbeb.toInt(); else -> 0xFFfef2f2.toInt() }
                val resultFg = when { correct -> 0xFF15803d.toInt(); isSkip -> 0xFF92400e.toInt(); else -> 0xFFdc2626.toInt() }
                val resultText = when { isSkip -> "⏭ Skipped — no score change."; correct -> "🎉 Correct! +1.00 point added."; else -> "❌ Wrong. Correct answer: ${q.correctAnswer}. −0.33 deducted." }
                questionCardInner.addView(TextView(ctx).apply {
                    text = resultText; textSize = 13f; setTypeface(null, android.graphics.Typeface.BOLD)
                    setTextColor(resultFg); setBackgroundColor(resultBg)
                    setPadding((12*dp).toInt(), (10*dp).toInt(), (12*dp).toInt(), (10*dp).toInt())
                    layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,
                        LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = (8*dp).toInt() }
                })
                questionCardInner.addView(TextView(ctx).apply {
                    text = "🗓 Come back tomorrow for the next question!"
                    textSize = 12f; setTextColor(ctx.getColor(R.color.text_secondary))
                    setPadding(0, (10*dp).toInt(), 0, 0)
                })
                return
            }

            // ── Not yet answered — show "Start" button ───────────────────────
            questionCardInner.addView(TextView(ctx).apply {
                text = "TODAY'S QUESTION"; textSize = 10f
                setTextColor(ctx.getColor(R.color.primary))
                setTypeface(null, android.graphics.Typeface.BOLD); letterSpacing = 0.1f
                setPadding(0, 0, 0, (8*dp).toInt())
            })
            questionCardInner.addView(TextView(ctx).apply {
                text = "⚡ You have 30 seconds to answer once you tap the button below.\nMinimising the app will auto-skip your answer."
                textSize = 12f; setTextColor(ctx.getColor(R.color.text_secondary))
                setPadding(0, 0, 0, (16*dp).toInt())
            })
            questionCardInner.addView(MaterialButton(ctx, null,
                com.google.android.material.R.attr.materialButtonStyle).apply {
                text = "🧠  Answer Today's Question"
                setBackgroundColor(ctx.getColor(R.color.primary))
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (52*dp).toInt())
                setOnClickListener {
                    // Expand card to show question + timer
                    questionCardInner.removeAllViews()

                    // Label
                    questionCardInner.addView(TextView(ctx).apply {
                        text = "TODAY'S QUESTION"; textSize = 10f
                        setTextColor(ctx.getColor(R.color.primary))
                        setTypeface(null, android.graphics.Typeface.BOLD); letterSpacing = 0.1f
                        setPadding(0, 0, 0, (8*dp).toInt())
                    })

                    // Timer row (number + progress bar)
                    val timerRow = LinearLayout(ctx).apply {
                        orientation = LinearLayout.HORIZONTAL
                        gravity = android.view.Gravity.CENTER_VERTICAL
                        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,
                            LinearLayout.LayoutParams.WRAP_CONTENT).also { it.bottomMargin = (12*dp).toInt() }
                    }
                    val tvTimer = TextView(ctx).apply {
                        text = "30"; textSize = 22f; setTypeface(null, android.graphics.Typeface.BOLD)
                        setTextColor(ctx.getColor(R.color.primary))
                        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT,
                            LinearLayout.LayoutParams.WRAP_CONTENT).also { it.marginEnd = (10*dp).toInt() }
                    }
                    tvTimerRef = tvTimer
                    val timerBar = android.widget.ProgressBar(ctx,
                        null, android.R.attr.progressBarStyleHorizontal).apply {
                        max = 30; progress = 30
                        layoutParams = LinearLayout.LayoutParams(0, (8*dp).toInt(), 1f)
                        progressDrawable?.setColorFilter(
                            ctx.getColor(R.color.primary), android.graphics.PorterDuff.Mode.SRC_IN)
                    }
                    timerBarRef = timerBar
                    timerRow.addView(tvTimer); timerRow.addView(timerBar)
                    questionCardInner.addView(timerRow)

                    // Question text
                    questionCardInner.addView(TextView(ctx).apply {
                        text = q.question; textSize = 15f
                        setTypeface(null, android.graphics.Typeface.BOLD)
                        setTextColor(ctx.getColor(R.color.text_primary))
                        setPadding(0, 0, 0, (14*dp).toInt())
                    })

                    // Options
                    val optionsGroup = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
                    optionsGroupRef = optionsGroup
                    q.options.forEach { (letter, optText) ->
                        optionsGroup.addView(MaterialButton(ctx, null,
                            com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
                            text = "$letter.  $optText"; textSize = 13f
                            gravity = android.view.Gravity.START or android.view.Gravity.CENTER_VERTICAL
                            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,
                                LinearLayout.LayoutParams.WRAP_CONTENT).also { it.bottomMargin = (8*dp).toInt() }
                            setOnClickListener btn@{
                                if (!timerActive || submitting) return@btn
                                countdownTimer?.cancel()
                                timerActive = false
                                submitAnswer(q, letter, null)
                            }
                        })
                    }
                    questionCardInner.addView(optionsGroup)

                    // Result + about (hidden initially)
                    val tvResult = TextView(ctx).apply {
                        textSize = 13f; setTypeface(null, android.graphics.Typeface.BOLD)
                        visibility = View.GONE
                        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,
                            LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = (10*dp).toInt() }
                    }
                    tvResultRef = tvResult
                    questionCardInner.addView(tvResult)

                    val tvAbout = TextView(ctx).apply {
                        textSize = 12f; setTextColor(ctx.getColor(R.color.text_secondary))
                        visibility = View.GONE
                        setPadding(0, (4*dp).toInt(), 0, 0)
                    }
                    tvAboutRef = tvAbout
                    questionCardInner.addView(tvAbout)

                    // Start countdown
                    startCountdown(q)
                }
            })
        }

        // ── Load question ────────────────────────────────────────────────────
        fun loadQuestion() {
            questionCardInner.removeAllViews()
            questionCardInner.addView(ProgressBar(ctx).apply {
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT).also { it.gravity = android.view.Gravity.CENTER_HORIZONTAL }
            })
            lifecycleScope.launch {
                try {
                    val q = RetrofitClient.instance.getGkQuestion().body()?.data
                    currentQuestion = q
                    renderQuestionCard(q)
                } catch (e: Exception) {
                    questionCardInner.removeAllViews()
                    questionCardInner.addView(TextView(ctx).apply {
                        text = "Could not load question: ${e.message}"
                        textSize = 13f; setTextColor(ctx.getColor(R.color.accent_red))
                    })
                }
            }
        }

        // Load stats
        lifecycleScope.launch {
            try {
                val stats = RetrofitClient.instance.getMyGkStats().body()?.data
                if (stats != null)
                    tvStats.text = "Total: ${stats.totalVal}  ·  Correct: ${stats.correctVal}  ·  Points: ${stats.pointsVal}  ·  Streak: 🔥${stats.streakVal}"
            } catch (_: Exception) {}
        }

        loadQuestion()
        return sv
    }

    // ── Start 30-second countdown ────────────────────────────────────────────
    private fun startCountdown(q: GkQuestion) {
        timerActive = true; submitting = false
        countdownTimer?.cancel()
        countdownTimer = object : android.os.CountDownTimer(AndroidMain.GK_QUESTION_TIMER_MS, 1_000L) {
            override fun onTick(msRemaining: Long) {
                val secs = ((msRemaining + 999) / 1000).toInt()
                tvTimerRef?.text = secs.toString()
                timerBarRef?.progress = secs
                // Colour urgency
                val color = when {
                    secs > 20 -> requireContext().getColor(R.color.primary)
                    secs > 10 -> android.graphics.Color.parseColor("#f59e0b")
                    else     -> requireContext().getColor(R.color.accent_red)
                }
                tvTimerRef?.setTextColor(color)
                timerBarRef?.progressDrawable?.setColorFilter(color, android.graphics.PorterDuff.Mode.SRC_IN)
            }
            override fun onFinish() {
                if (!timerActive || submitting) return
                timerActive = false
                tvTimerRef?.text = "0"
                timerBarRef?.progress = 0
                submitAnswer(q, "skip", "timeout")
            }
        }.start()
    }

    // ── Submit answer (also called from onPause for auto-skip) ───────────────
    private fun submitAnswer(q: GkQuestion, answer: String, reason: String?) {
        if (submitting) return
        submitting = true

        // Disable all option buttons
        val og = optionsGroupRef
        if (og != null) for (i in 0 until og.childCount)
            (og.getChildAt(i) as? MaterialButton)?.isEnabled = false

        lifecycleScope.launch {
            try {
                val resp = RetrofitClient.instance.submitAnswer(GkAnswerRequest(q.id, answer))
                val data = resp.body()?.data

                if (!resp.isSuccessful || data == null) {
                    tvResultRef?.apply {
                        text = "❌ ${resp.body()?.message ?: "Error (${resp.code()})"}"
                        setTextColor(requireContext().getColor(R.color.accent_red))
                        visibility = View.VISIBLE
                    }
                    submitting = false
                    return@launch
                }

                val ctx = requireContext()
                val correct = data.didCorrect
                val isSkip  = answer == "skip"

                // Colour the chosen option
                if (!isSkip && og != null) {
                    for (i in 0 until og.childCount) {
                        val btn = og.getChildAt(i) as? MaterialButton ?: continue
                        val letter = btn.text.toString().firstOrNull()?.toString() ?: ""
                        when {
                            letter == answer && correct  -> { btn.setBackgroundColor(ctx.getColor(R.color.primary)); btn.setTextColor(android.graphics.Color.WHITE) }
                            letter == answer && !correct -> { btn.setBackgroundColor(ctx.getColor(R.color.accent_red)); btn.setTextColor(android.graphics.Color.WHITE) }
                            letter == data.correctAnswer -> { btn.setBackgroundColor(ctx.getColor(R.color.primary_ultra_light)) }
                        }
                    }
                }

                val reasonLabel = when(reason) { "timeout" -> " (time ran out!)"; "background" -> " (app minimised)"; else -> "" }
                val resultBg = when { correct -> 0xFFf0fdf4.toInt(); isSkip -> 0xFFfffbeb.toInt(); else -> 0xFFfef2f2.toInt() }
                val resultFg = when { correct -> 0xFF15803d.toInt(); isSkip -> 0xFF92400e.toInt(); else -> 0xFFdc2626.toInt() }
                val resultText = when {
                    isSkip  -> "⏭ Skipped$reasonLabel — no points. Correct: ${data.correctAnswer}"
                    correct -> "🎉 Correct! +1.00 point added."
                    else    -> "❌ Wrong$reasonLabel. −0.33 deducted. Correct: ${data.correctAnswer}"
                }
                tvResultRef?.apply {
                    text = resultText; setTextColor(resultFg); setBackgroundColor(resultBg)
                    setPadding((12*dp()).toInt(), (10*dp()).toInt(), (12*dp()).toInt(), (10*dp()).toInt())
                    visibility = View.VISIBLE
                }
                tvAboutRef?.apply {
                    val aboutLine = if (!data.about.isNullOrBlank()) "💡 ${data.about}\n\n" else ""
                    text = "${aboutLine}🗓 Come back tomorrow for the next question!"
                    visibility = View.VISIBLE
                }

                // Refresh stats
                val stats = RetrofitClient.instance.getMyGkStats().body()?.data
                if (stats != null)
                    tvStatsRef?.text = "Total: ${stats.totalVal}  ·  Correct: ${stats.correctVal}  ·  Points: ${stats.pointsVal}  ·  Streak: 🔥${stats.streakVal}"

            } catch (e: Exception) {
                tvResultRef?.apply {
                    text = "❌ Submit error: ${e.message}"
                    setTextColor(requireContext().getColor(R.color.accent_red))
                    visibility = View.VISIBLE
                }
                submitting = false
            }
        }
    }

    private fun dp() = requireContext().resources.displayMetrics.density
}

// GkQuizPageFragment and GkLeaderboardFragment no longer needed — kept as empty stubs to avoid unused errors

class LeaderboardAdapter(private val items: List<LeaderboardEntry>) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
    override fun getItemCount() = items.size
    override fun onCreateViewHolder(p: ViewGroup, t: Int): RecyclerView.ViewHolder {
        val ctx = p.context; val dp = ctx.resources.displayMetrics.density
        val card = androidx.cardview.widget.CardView(ctx).apply {
            radius = 14*dp; cardElevation = 2*dp
            layoutParams = RecyclerView.LayoutParams(RecyclerView.LayoutParams.MATCH_PARENT, RecyclerView.LayoutParams.WRAP_CONTENT)
                .also { it.setMargins(0, 0, 0, (6*dp).toInt()) }
        }
        return object : RecyclerView.ViewHolder(card) {}
    }
    override fun onBindViewHolder(h: RecyclerView.ViewHolder, pos: Int) {
        val it = items[pos]; val ctx = h.itemView.context; val dp = ctx.resources.displayMetrics.density
        val card = h.itemView as androidx.cardview.widget.CardView; card.removeAllViews()
        card.setCardBackgroundColor(ctx.getColor(if (it.isMe) R.color.primary_ultra_light else R.color.surface))

        val row = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = android.view.Gravity.CENTER_VERTICAL
            setPadding((12*dp).toInt(), (12*dp).toInt(), (12*dp).toInt(), (12*dp).toInt())
        }
        // Rank
        val rankText = when (pos) { 0 -> "🥇"; 1 -> "🥈"; 2 -> "🥉"; else -> "#${pos + 1}" }
        row.addView(TextView(ctx).apply {
            text = rankText; textSize = if (pos < 3) 20f else 14f; gravity = android.view.Gravity.CENTER
            setTypeface(null, android.graphics.Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams((40*dp).toInt(), LinearLayout.LayoutParams.WRAP_CONTENT).also { it.marginEnd = (10*dp).toInt() }
        })
        // Name + dept
        val info = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f) }
        info.addView(TextView(ctx).apply {
            text = if (it.isMe) "${it.displayName} (You)" else it.displayName
            textSize = 14f; setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(ctx.getColor(if (it.isMe) R.color.primary else R.color.text_primary))
        })
        info.addView(TextView(ctx).apply {
            text = "${it.departmentName ?: "—"}  ·  ✅${it.correct} ❌${it.wrong}"
            textSize = 11f; setTextColor(ctx.getColor(R.color.text_secondary))
        })
        row.addView(info)
        // Score
        row.addView(TextView(ctx).apply {
            text = "${it.scoreDisplay} pts"; textSize = 14f; setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(ctx.getColor(if (it.score >= 0) R.color.primary else R.color.accent_red))
        })
        card.addView(row)
    }
}

class GkQuizPageFragment : Fragment() {
    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?) = LinearLayout(requireContext()) as View
}
class GkLeaderboardFragment : Fragment() {
    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?) = LinearLayout(requireContext()) as View
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHANGE PASSWORD FRAGMENT
// ═══════════════════════════════════════════════════════════════════════════════
class ChangePasswordFragment : Fragment() {

    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View =
        i.inflate(R.layout.fragment_change_password, c, false)

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        val etOld  = view.findViewById<com.google.android.material.textfield.TextInputEditText>(R.id.etOldPass)
        val etNew1 = view.findViewById<com.google.android.material.textfield.TextInputEditText>(R.id.etNewPass1)
        val etNew2 = view.findViewById<com.google.android.material.textfield.TextInputEditText>(R.id.etNewPass2)
        val btn    = view.findViewById<com.google.android.material.button.MaterialButton>(R.id.btnChangePass)

        btn.setOnClickListener {
            val old = etOld?.text.toString().trim()
            val nw  = etNew1?.text.toString().trim()
            val cf  = etNew2?.text.toString().trim()

            if (old.isEmpty() || nw.isEmpty() || cf.isEmpty()) { toast("Fill all fields"); return@setOnClickListener }
            if (nw.length < 6) { toast("Password must be at least 6 characters"); return@setOnClickListener }
            if (nw != cf) { toast("New passwords don't match"); return@setOnClickListener }

            btn.isEnabled = false
            btn.text = "Updating..."

            lifecycleScope.launch {
                try {
                    val res = RetrofitClient.instance.changePassword(ChangePasswordRequest(old, nw))
                    if (res.isSuccessful && res.body()?.success == true) {
                        toast("Password changed successfully!")
                        etOld?.text?.clear(); etNew1?.text?.clear(); etNew2?.text?.clear()
                        parentFragmentManager.popBackStack()
                    } else {
                        toast(res.body()?.message ?: "Failed — check your current password")
                    }
                } catch (_: Exception) {
                    toast("Network error — please try again")
                } finally {
                    btn.isEnabled = true
                    btn.text = "Update Password"
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEAM TODAY FRAGMENT
// ═══════════════════════════════════════════════════════════════════════════════
class TeamTodayFragment : Fragment() {
    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View {
        val ctx = requireContext(); val dp = ctx.resources.displayMetrics.density
        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(ctx.getColor(R.color.background))
            layoutParams = android.view.ViewGroup.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT)
        }
        root.addView(TextView(ctx).apply { text = "Team Attendance — Today"; textSize = 20f; setTypeface(null, android.graphics.Typeface.BOLD); setPadding((16*dp).toInt(),(16*dp).toInt(),(16*dp).toInt(),(12*dp).toInt()) })
        val rv = RecyclerView(ctx).apply { layoutManager = LinearLayoutManager(ctx); setPadding((8*dp).toInt(),0,(8*dp).toInt(),(80*dp).toInt()); clipToPadding = false }
        root.addView(rv)
        lifecycleScope.launch {
            try {
                val res = RetrofitClient.instance.getTeamToday()
                rv.adapter = TeamTodayAdapter(res.body()?.data ?: emptyList())
            } catch (_: Exception) {}
        }
        return root
    }
}

class TeamTodayAdapter(private val items: List<TeamTodayRecord>) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
    override fun getItemCount() = items.size
    override fun onCreateViewHolder(p: ViewGroup, t: Int): RecyclerView.ViewHolder {
        val ctx = p.context; val dp = ctx.resources.displayMetrics.density
        val card = androidx.cardview.widget.CardView(ctx).apply {
            radius = 14*dp; cardElevation = 2*dp; setCardBackgroundColor(ctx.getColor(R.color.surface))
            layoutParams = RecyclerView.LayoutParams(RecyclerView.LayoutParams.MATCH_PARENT, RecyclerView.LayoutParams.WRAP_CONTENT).also { it.setMargins(0,0,0,(6*dp).toInt()) }
        }
        return object : RecyclerView.ViewHolder(card) {}
    }
    override fun onBindViewHolder(h: RecyclerView.ViewHolder, pos: Int) {
        val it = items[pos]; val ctx = h.itemView.context; val dp = ctx.resources.displayMetrics.density
        val card = h.itemView as androidx.cardview.widget.CardView; card.removeAllViews()
        val row = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = android.view.Gravity.CENTER_VERTICAL; setPadding((12*dp).toInt(),(10*dp).toInt(),(12*dp).toInt(),(10*dp).toInt()) }
        val left = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f) }
        left.addView(TextView(ctx).apply { text = it.employeeName ?: "—"; textSize = 14f; setTypeface(null, android.graphics.Typeface.BOLD) })
        left.addView(TextView(ctx).apply { text = "In: ${it.punchIn?.toDisplayTime() ?: "--"}  Out: ${it.punchOut?.toDisplayTime() ?: "--"}"; textSize = 11f; setTextColor(ctx.getColor(R.color.text_secondary)) })
        row.addView(left)
        row.addView(TextView(ctx).apply {
            text = it.status?.replaceFirstChar { c -> c.uppercase() } ?: "—"; textSize = 11f
            setTextColor(getStatusColor(ctx, it.status))
            setPadding((8*dp).toInt(),(3*dp).toInt(),(8*dp).toInt(),(3*dp).toInt())
        })
        card.addView(row)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEPARATION FRAGMENT — full: employee submit + approver actions
// ═══════════════════════════════════════════════════════════════════════════════
class SeparationFragment : Fragment() {
    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View {
        val ctx = requireContext(); val dp = ctx.resources.displayMetrics.density
        val session = SessionManager(ctx)
        val role = session.getRole()
        val isHrAdmin = Roles.canSeeSeparation(role) && role != Roles.EMPLOYEE && role != Roles.MANAGER && role != Roles.TL

        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(ctx.getColor(R.color.background))
            layoutParams = android.view.ViewGroup.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT)
        }

        // Title row + submit button for employee
        val titleRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = android.view.Gravity.CENTER_VERTICAL
            setPadding((16*dp).toInt(),(16*dp).toInt(),(16*dp).toInt(),(8*dp).toInt())
        }
        titleRow.addView(TextView(ctx).apply {
            text = if (isHrAdmin) "All Separations" else "My Resignation"
            textSize = 20f; setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(ctx.getColor(R.color.text_primary))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        })
        root.addView(titleRow)

        val rv = RecyclerView(ctx).apply {
            layoutManager = LinearLayoutManager(ctx)
            setPadding((8*dp).toInt(), 0, (8*dp).toInt(), (80*dp).toInt()); clipToPadding = false
        }
        root.addView(rv)

        val tvEmpty = TextView(ctx).apply {
            textSize = 14f; gravity = android.view.Gravity.CENTER; text = "No separation records found"
            setTextColor(ctx.getColor(R.color.text_hint))
            setPadding((16*dp).toInt(), (40*dp).toInt(), (16*dp).toInt(), 0)
            visibility = View.GONE
        }
        root.addView(tvEmpty)

        fun load() {
            lifecycleScope.launch {
                try {
                    val res = if (isHrAdmin) RetrofitClient.instance.getSeparations()
                    else RetrofitClient.instance.getMySeparations()
                    val items = res.body()?.data ?: emptyList()
                    tvEmpty.visibility = if (items.isEmpty()) View.VISIBLE else View.GONE
                    rv.visibility = if (items.isEmpty()) View.GONE else View.VISIBLE
                    rv.adapter = SeparationAdapter(items, role, session) { load() }
                } catch (e: Exception) {
                    tvEmpty.text = "Error loading: ${e.message}"
                    tvEmpty.visibility = View.VISIBLE
                }
            }
        }

        // Employee/Manager/TL: show Submit Resignation button
        if (!isHrAdmin) {
            titleRow.addView(MaterialButton(ctx, null, com.google.android.material.R.attr.materialButtonStyle).apply {
                text = "Submit Resignation"; textSize = 12f
                setBackgroundColor(ctx.getColor(R.color.accent_red))
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                setOnClickListener { SubmitResignationSheet { load() }.show(childFragmentManager, "resign") }
            })
        }

        load()
        return root
    }
}

// ── Submit Resignation Bottom Sheet ──────────────────────────────────────────
class SubmitResignationSheet(private val onSuccess: () -> Unit) : com.google.android.material.bottomsheet.BottomSheetDialogFragment() {
    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View {
        val ctx = requireContext(); val dp = ctx.resources.displayMetrics.density
        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding((20*dp).toInt(), (20*dp).toInt(), (20*dp).toInt(), (40*dp).toInt())
        }

        root.addView(TextView(ctx).apply {
            text = "Submit Resignation"; textSize = 18f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setPadding(0, 0, 0, (4*dp).toInt())
        })
        val myRole = SessionManager(ctx).getRole()
        val noticeDays = Roles.getNoticeDays(myRole)
        root.addView(TextView(ctx).apply {
            text = "Notice period: $noticeDays days\nApproval chain: L1 Manager → L2 HR → L3 Accounts → L4 Admin"
            textSize = 12f; setTextColor(ctx.getColor(R.color.text_secondary))
            setPadding(0, 0, 0, (16*dp).toInt())
        })

        // Notice date picker
        var selectedNoticeDate = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.getDefault()).format(java.util.Date())
        val tvNoticeDate = TextView(ctx).apply {
            text = "Notice Date: $selectedNoticeDate"; textSize = 13f
            setTextColor(ctx.getColor(R.color.primary))
            setPadding(0, 0, 0, (8*dp).toInt())
        }
        root.addView(tvNoticeDate)
        tvNoticeDate.setOnClickListener {
            val cal = java.util.Calendar.getInstance()
            android.app.DatePickerDialog(ctx, { _, y, m, d ->
                selectedNoticeDate = "%04d-%02d-%02d".format(y, m+1, d)
                tvNoticeDate.text = "Notice Date: $selectedNoticeDate"
            }, cal.get(java.util.Calendar.YEAR), cal.get(java.util.Calendar.MONTH), cal.get(java.util.Calendar.DAY_OF_MONTH)).show()
        }

        val etReason = EditText(ctx).apply {
            hint = "Reason for resignation *"; minLines = 3
            setBackgroundColor(ctx.getColor(R.color.background))
            setPadding((8*dp).toInt(), (8*dp).toInt(), (8*dp).toInt(), (8*dp).toInt())
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                .also { it.bottomMargin = (16*dp).toInt() }
        }
        root.addView(etReason)

        val progress = android.widget.ProgressBar(ctx).apply { visibility = View.GONE }
        root.addView(progress)

        root.addView(MaterialButton(ctx, null, com.google.android.material.R.attr.materialButtonStyle).apply {
            text = "Submit Resignation"; setBackgroundColor(ctx.getColor(R.color.accent_red))
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            setOnClickListener {
                val reason = etReason.text.toString().trim()
                if (reason.isEmpty()) { toast("Please enter a reason"); return@setOnClickListener }
                progress.visibility = View.VISIBLE; isEnabled = false
                lifecycleScope.launch {
                    try {
                        val req = SubmitResignationRequest(reason = reason, noticeDate = selectedNoticeDate)
                        val res = RetrofitClient.instance.submitResignation(req)
                        if (res.isSuccessful && res.body()?.success == true) {
                            toast("✅ Resignation submitted successfully")
                            onSuccess(); dismiss()
                        } else {
                            toast(res.body()?.message ?: "Failed to submit resignation")
                        }
                    } catch (e: Exception) { toast("Network error: ${e.message}") }
                    finally { progress.visibility = View.GONE; isEnabled = true }
                }
            }
        })
        return root
    }
}

// ── Separation List Adapter — shows approval chain + action buttons ───────────
class SeparationAdapter(
    private val items: List<SeparationRecord>,
    private val role: String,
    private val session: SessionManager,
    private val onRefresh: () -> Unit
) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
    override fun getItemCount() = items.size
    override fun onCreateViewHolder(p: ViewGroup, t: Int): RecyclerView.ViewHolder {
        val ctx = p.context; val dp = ctx.resources.displayMetrics.density
        val card = androidx.cardview.widget.CardView(ctx).apply {
            radius = 14*dp; cardElevation = 2*dp
            setCardBackgroundColor(ctx.getColor(R.color.surface))
            layoutParams = RecyclerView.LayoutParams(RecyclerView.LayoutParams.MATCH_PARENT, RecyclerView.LayoutParams.WRAP_CONTENT)
                .also { it.setMargins(0, 0, 0, (10*dp).toInt()) }
        }
        return object : RecyclerView.ViewHolder(card) {}
    }
    override fun onBindViewHolder(h: RecyclerView.ViewHolder, pos: Int) {
        val sep = items[pos]; val ctx = h.itemView.context; val dp = ctx.resources.displayMetrics.density
        val card = h.itemView as androidx.cardview.widget.CardView; card.removeAllViews()
        val ll = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; setPadding((14*dp).toInt(), (14*dp).toInt(), (14*dp).toInt(), (14*dp).toInt()) }

        // Header: name + status badge
        val hRow = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = android.view.Gravity.CENTER_VERTICAL }
        hRow.addView(TextView(ctx).apply {
            text = sep.employeeName; textSize = 15f; setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(ctx.getColor(R.color.text_primary))
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        })
        hRow.addView(TextView(ctx).apply {
            text = sep.status?.replaceFirstChar { it.uppercase() } ?: "—"
            textSize = 11f; setPadding((8*dp).toInt(), (3*dp).toInt(), (8*dp).toInt(), (3*dp).toInt())
            setTextColor(getStatusColor(ctx, sep.status))
        })
        ll.addView(hRow)

        // Type + LWD
        ll.addView(TextView(ctx).apply {
            text = "${sep.type?.replaceFirstChar { it.uppercase() } ?: "Separation"}  ·  LWD: ${sep.lastWorkingDate?.toDisplayDate() ?: "—"}"
            textSize = 12f; setTextColor(ctx.getColor(R.color.text_secondary))
            setPadding(0, (4*dp).toInt(), 0, 0)
        })

        // Reason
        if (!sep.reason.isNullOrBlank()) ll.addView(TextView(ctx).apply {
            text = sep.reason; textSize = 11f; setTextColor(ctx.getColor(R.color.text_hint))
            setPadding(0, (2*dp).toInt(), 0, (8*dp).toInt())
        })

        // Approval chain pills
        val chainRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                .also { it.bottomMargin = (8*dp).toInt() }
        }
        fun pill(label: String, action: String?) {
            val color = when(action) {
                "approved" -> android.graphics.Color.parseColor("#22c55e")
                "rejected" -> android.graphics.Color.parseColor("#ef4444")
                else -> android.graphics.Color.parseColor("#f59e0b")
            }
            val symbol = when(action) { "approved" -> "✓"; "rejected" -> "✗"; else -> "⏳" }
            chainRow.addView(TextView(ctx).apply {
                text = "$symbol $label"; textSize = 9f; setTextColor(android.graphics.Color.WHITE)
                setBackgroundColor(color)
                background = android.graphics.drawable.GradientDrawable().apply { setColor(color); cornerRadius = 20*dp }
                setPadding((6*dp).toInt(), (2*dp).toInt(), (6*dp).toInt(), (2*dp).toInt())
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                    .also { it.marginEnd = (4*dp).toInt() }
            })
        }
        pill("L1 Mgr", sep.managerAction)
        pill("L2 HR", sep.hrAction)
        pill("L3 Acc", sep.accountsAction)
        pill("L4 Admin", sep.adminAction)
        ll.addView(chainRow)

        // Action buttons — show based on role and current status
        val sepId = sep.id
        val isPending = sep.status != "completed" && sep.status != "rejected" && sep.status != "withdrawn"

        // Employee: can withdraw if pending
        if ((role == Roles.EMPLOYEE || role == Roles.MANAGER || role == Roles.TL) && isPending) {
            ll.addView(MaterialButton(ctx, null, com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
                text = "Withdraw Resignation"; textSize = 12f
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                    .also { it.topMargin = (4*dp).toInt() }
                setOnClickListener {
                    android.app.AlertDialog.Builder(ctx)
                        .setTitle("Withdraw Resignation")
                        .setMessage("Are you sure you want to withdraw your resignation?")
                        .setPositiveButton("Yes") { _, _ ->
                            kotlinx.coroutines.MainScope().launch {
                                try {
                                    val res = RetrofitClient.instance.withdrawSeparation(sepId)
                                    ctx.toast(if (res.body()?.success == true) "✅ Resignation withdrawn" else res.body()?.message ?: "Failed")
                                    if (res.body()?.success == true) onRefresh()
                                } catch (e: Exception) { ctx.toast("Error: ${e.message}") }
                            }
                        }.setNegativeButton("Cancel", null).show()
                }
            })
        }

        // Manager: approve/reject if pending and manager_action is null
        if ((role == Roles.MANAGER || role == Roles.TL || role == Roles.ADMIN || role == Roles.SUPER_ADMIN)
            && sep.status == "pending" && sep.managerAction == null) {
            addApproveRejectButtons(ctx, dp, ll, sepId, "Manager") { action, remarks ->
                RetrofitClient.instance.managerActionSeparation(sepId, ActionRequest(action, remarks))
            }
        }

        // HR: approve/reject if manager approved
        if (role == Roles.HR && sep.status == "manager_approved" && sep.hrAction == null) {
            addApproveRejectButtons(ctx, dp, ll, sepId, "HR") { action, remarks ->
                RetrofitClient.instance.hrActionSeparation(sepId, ActionRequest(action, remarks))
            }
        }

        // Accounts: approve/reject if HR approved
        if (role == Roles.ACCOUNTS && sep.status == "hr_approved" && sep.accountsAction == null) {
            addApproveRejectButtons(ctx, dp, ll, sepId, "Accounts") { action, remarks ->
                RetrofitClient.instance.accountsActionSeparation(sepId, ActionRequest(action, remarks))
            }
        }

        // Admin/Super_admin: final approval if accounts approved
        if ((role == Roles.ADMIN || role == Roles.SUPER_ADMIN) && sep.status == "accounts_approved" && sep.adminAction == null) {
            addApproveRejectButtons(ctx, dp, ll, sepId, "Admin") { action, remarks ->
                RetrofitClient.instance.adminActionSeparation(sepId, ActionRequest(action, remarks))
            }
        }

        card.addView(ll)
    }

    private fun addApproveRejectButtons(
        ctx: android.content.Context, dp: Float, parent: LinearLayout, sepId: Int, level: String,
        apiCall: suspend (String, String?) -> retrofit2.Response<*>
    ) {
        val btnRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                .also { it.topMargin = (8*dp).toInt() }
        }
        btnRow.addView(MaterialButton(ctx, null, com.google.android.material.R.attr.materialButtonStyle).apply {
            text = "✓ Approve"; setBackgroundColor(ctx.getColor(R.color.primary)); textSize = 12f
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                .also { it.marginEnd = (8*dp).toInt() }
            setOnClickListener {
                approvalConfirm(ctx, "Approve Separation ($level)") {
                    val res = apiCall("approve", null)
                    val ok = res.isSuccessful
                    if (ok) onRefresh()
                    Pair(ok, if (ok) "Approved" else "Failed (${res.code()})")
                }
            }
        })
        btnRow.addView(MaterialButton(ctx, null, com.google.android.material.R.attr.materialButtonStyle).apply {
            text = "✗ Reject"; setBackgroundColor(ctx.getColor(R.color.accent_red)); textSize = 12f
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            setOnClickListener {
                // Ask for reject reason
                val et = EditText(ctx).apply { hint = "Reason for rejection *" }
                android.app.AlertDialog.Builder(ctx)
                    .setTitle("Reject Separation")
                    .setView(et)
                    .setPositiveButton("Reject") { _, _ ->
                        val remarks = et.text.toString().trim()
                        if (remarks.isEmpty()) { ctx.toast("Remarks required for rejection"); return@setPositiveButton }
                        kotlinx.coroutines.MainScope().launch {
                            try {
                                val res = apiCall("reject", remarks)
                                ctx.toast(if (res.isSuccessful) "✅ Rejected" else "Failed")
                                if (res.isSuccessful) onRefresh()
                            } catch (e: Exception) { ctx.toast("Error: ${e.message}") }
                        }
                    }.setNegativeButton("Cancel", null).show()
            }
        })
        parent.addView(btnRow)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROVISION FRAGMENT — full workflow: list, initiate, manager approve, HR approve
// ═══════════════════════════════════════════════════════════════════════════════
class ProvisionFragment : Fragment() {

    private var allItems = listOf<ProvisionEmployee>()

    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View {
        val ctx     = requireContext()
        val dp      = ctx.resources.displayMetrics.density
        val session = SessionManager(ctx)
        val role    = session.getRole()
        val isHR    = role in setOf(Roles.HR, Roles.ADMIN, Roles.SUPER_ADMIN)
        val isMgr   = role in setOf(Roles.MANAGER, Roles.TL)

        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(ctx.getColor(R.color.background))
            layoutParams = android.view.ViewGroup.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT)
        }

        // ── Title ─────────────────────────────────────────────────────────────
        root.addView(TextView(ctx).apply {
            text = "⏳ Provision Confirmations"; textSize = 20f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(ctx.getColor(R.color.text_primary))
            setPadding((16*dp).toInt(), (16*dp).toInt(), (16*dp).toInt(), (4*dp).toInt())
        })

        // ── Summary bar (HR/admin only) ───────────────────────────────────────
        val summaryRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding((8*dp).toInt(), 0, (8*dp).toInt(), (8*dp).toInt())
            visibility = if (isHR) View.VISIBLE else View.GONE
        }
        fun sumCard(label: String, colorRes: Int): TextView {
            val card = androidx.cardview.widget.CardView(ctx).apply {
                radius = 10*dp; cardElevation = 1*dp
                setCardBackgroundColor(ctx.getColor(R.color.surface))
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                    .also { it.setMargins((4*dp).toInt(), 0, (4*dp).toInt(), 0) }
            }
            val ll = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; gravity = android.view.Gravity.CENTER; setPadding((8*dp).toInt(),(10*dp).toInt(),(8*dp).toInt(),(10*dp).toInt()) }
            val tv = TextView(ctx).apply { text = "—"; textSize = 20f; setTypeface(null, android.graphics.Typeface.BOLD); setTextColor(ctx.getColor(colorRes)); gravity = android.view.Gravity.CENTER }
            ll.addView(tv)
            ll.addView(TextView(ctx).apply { text = label; textSize = 9f; setTextColor(ctx.getColor(R.color.text_hint)); gravity = android.view.Gravity.CENTER })
            card.addView(ll); summaryRow.addView(card)
            return tv
        }
        val tvTotal     = sumCard("Total",     R.color.primary)
        val tvOverdue   = sumCard("Overdue",   R.color.accent_red)
        val tvPending   = sumCard("Pending",   R.color.accent_yellow)
        val tvConfirmed = sumCard("Confirmed", R.color.primary)
        root.addView(summaryRow)

        // ── Tabs: All Provision | My Approvals ───────────────────────────────
        val tabRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding((8*dp).toInt(), 0, (8*dp).toInt(), (8*dp).toInt())
        }
        val btnTabAll = com.google.android.material.button.MaterialButton(ctx, null,
            com.google.android.material.R.attr.materialButtonStyle).apply {
            text = "Provision Employees"; textSize = 12f
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                .also { it.marginEnd = (6*dp).toInt() }
            setBackgroundColor(ctx.getColor(R.color.primary))
        }
        val btnTabApprovals = com.google.android.material.button.MaterialButton(ctx, null,
            com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
            text = "My Approvals"; textSize = 12f
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            visibility = if (isHR || isMgr) View.VISIBLE else View.GONE
        }
        tabRow.addView(btnTabAll); tabRow.addView(btnTabApprovals)
        root.addView(tabRow)

        // ── RecyclerView ──────────────────────────────────────────────────────
        val tvEmpty = TextView(ctx).apply {
            text = "Loading…"; textSize = 14f; gravity = android.view.Gravity.CENTER
            setTextColor(ctx.getColor(R.color.text_hint))
            setPadding(0, (32*dp).toInt(), 0, 0)
        }
        root.addView(tvEmpty)

        val rv = RecyclerView(ctx).apply {
            layoutManager = LinearLayoutManager(ctx)
            setPadding((8*dp).toInt(), 0, (8*dp).toInt(), (80*dp).toInt()); clipToPadding = false
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        root.addView(rv)

        // ── Load & render ────────────────────────────────────────────────────
        fun updateSummary(items: List<ProvisionEmployee>) {
            if (!isHR) return
            tvTotal.text     = items.size.toString()
            tvOverdue.text   = items.count { (it.daysRemaining ?: 1) <= 0 && it.workflowStatus != "confirmed" }.toString()
            tvPending.text   = items.count { it.workflowStatus in listOf("pending","manager_approved") }.toString()
            tvConfirmed.text = items.count { it.workflowStatus == "confirmed" }.toString()
        }

        fun showList(items: List<ProvisionEmployee>) {
            allItems = items
            updateSummary(items)
            tvEmpty.visibility = if (items.isEmpty()) View.VISIBLE else View.GONE
            rv.visibility      = if (items.isEmpty()) View.GONE    else View.VISIBLE
            tvEmpty.text = if (items.isEmpty()) "No provision employees found" else ""
            rv.adapter = ProvisionAdapter(items, role) { lifecycleScope.launch { loadProvision(rv, tvEmpty, ::showList, ::updateSummary) } }
        }

        fun showApprovals() {
            val mine = allItems.filter { emp ->
                when {
                    role == Roles.HR   -> emp.workflowStatus == "manager_approved"
                    isMgr              -> emp.workflowStatus == "pending"
                    // Admin can see pending where they ARE the reporting manager
                    role in setOf(Roles.ADMIN, Roles.SUPER_ADMIN) ->
                        emp.workflowStatus == "pending" // only as manager, not HR step
                    else -> false
                }
            }
            tvEmpty.visibility = if (mine.isEmpty()) View.VISIBLE else View.GONE
            rv.visibility      = if (mine.isEmpty()) View.GONE    else View.VISIBLE
            tvEmpty.text = if (mine.isEmpty()) "✅ No pending approvals" else ""
            rv.adapter = ProvisionAdapter(mine, role) { lifecycleScope.launch { loadProvision(rv, tvEmpty, ::showList, ::updateSummary) } }
        }

        var currentTab = "all"
        btnTabAll.setOnClickListener {
            currentTab = "all"
            btnTabAll.setBackgroundColor(ctx.getColor(R.color.primary))
            btnTabApprovals.setBackgroundColor(android.graphics.Color.TRANSPARENT)
            showList(allItems)
        }
        btnTabApprovals.setOnClickListener {
            currentTab = "approvals"
            btnTabApprovals.setBackgroundColor(ctx.getColor(R.color.primary))
            btnTabAll.setBackgroundColor(android.graphics.Color.TRANSPARENT)
            showApprovals()
        }

        // Initial load
        lifecycleScope.launch {
            loadProvision(rv, tvEmpty, ::showList, ::updateSummary)
        }

        return root
    }

    private suspend fun loadProvision(
        rv: RecyclerView, tvEmpty: TextView,
        onLoaded: (List<ProvisionEmployee>) -> Unit,
        onSummary: (List<ProvisionEmployee>) -> Unit
    ) {
        try {
            val res = RetrofitClient.instance.getProvisionEmployees()
            val items = res.body()?.data ?: emptyList()
            onLoaded(items)
        } catch (e: Exception) {
            tvEmpty.text = "Error: ${e.message}"
            tvEmpty.visibility = View.VISIBLE
            rv.visibility = View.GONE
        }
    }
}

// ── Provision list adapter — cards with Initiate / Approve / Reject buttons ──
class ProvisionAdapter(
    private val items: List<ProvisionEmployee>,
    private val role: String,
    private val onRefresh: () -> Unit
) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {

    private val isHR  = role == Roles.HR  // Only actual HR role can do HR approval step
    private val isAdmin = role in setOf(Roles.ADMIN, Roles.SUPER_ADMIN)
    private val isMgr = role in setOf(Roles.MANAGER, Roles.TL)

    override fun getItemCount() = items.size

    override fun onCreateViewHolder(p: ViewGroup, t: Int): RecyclerView.ViewHolder {
        val ctx = p.context; val dp = ctx.resources.displayMetrics.density
        val card = androidx.cardview.widget.CardView(ctx).apply {
            radius = 14*dp; cardElevation = 2*dp
            setCardBackgroundColor(ctx.getColor(R.color.surface))
            layoutParams = RecyclerView.LayoutParams(
                RecyclerView.LayoutParams.MATCH_PARENT, RecyclerView.LayoutParams.WRAP_CONTENT)
                .also { it.setMargins(0, 0, 0, (10*dp).toInt()) }
        }
        return object : RecyclerView.ViewHolder(card) {}
    }

    override fun onBindViewHolder(h: RecyclerView.ViewHolder, pos: Int) {
        val emp = items[pos]; val ctx = h.itemView.context; val dp = ctx.resources.displayMetrics.density
        val card = h.itemView as androidx.cardview.widget.CardView; card.removeAllViews()

        // Left color strip based on status/urgency
        val stripColor = when {
            emp.workflowStatus == "confirmed"                         -> android.graphics.Color.parseColor("#10b981")
            emp.workflowStatus == "rejected"                          -> android.graphics.Color.parseColor("#ef4444")
            emp.workflowStatus == "manager_approved"                  -> android.graphics.Color.parseColor("#4361ee")
            emp.workflowStatus == "pending"                           -> android.graphics.Color.parseColor("#f59e0b")
            (emp.daysRemaining ?: 999) <= 0                           -> android.graphics.Color.parseColor("#ef4444")
            (emp.daysRemaining ?: 999) <= 30                          -> android.graphics.Color.parseColor("#f59e0b")
            else                                                       -> android.graphics.Color.parseColor("#e2e8f0")
        }
        val outerRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        }
        outerRow.addView(View(ctx).apply {
            setBackgroundColor(stripColor)
            layoutParams = LinearLayout.LayoutParams((4*dp).toInt(), LinearLayout.LayoutParams.MATCH_PARENT)
        })

        val ll = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding((14*dp).toInt(), (12*dp).toInt(), (14*dp).toInt(), (12*dp).toInt())
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }

        // ── Header row: avatar + name + code ──────────────────────────────
        val headerRow = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = android.view.Gravity.CENTER_VERTICAL }
        val avSize = (40*dp).toInt()
        val avCard = androidx.cardview.widget.CardView(ctx).apply {
            radius = avSize / 2f; cardElevation = 0f
            setCardBackgroundColor(android.graphics.Color.parseColor("#4361ee"))
            layoutParams = LinearLayout.LayoutParams(avSize, avSize).also { it.marginEnd = (10*dp).toInt() }
        }
        avCard.addView(TextView(ctx).apply {
            text = emp.initials; textSize = 13f; gravity = android.view.Gravity.CENTER
            setTextColor(android.graphics.Color.WHITE); setTypeface(null, android.graphics.Typeface.BOLD)
            layoutParams = android.widget.FrameLayout.LayoutParams(android.widget.FrameLayout.LayoutParams.MATCH_PARENT, android.widget.FrameLayout.LayoutParams.MATCH_PARENT)
        })
        headerRow.addView(avCard)
        val nameCol = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f) }
        nameCol.addView(TextView(ctx).apply { text = emp.fullName; textSize = 15f; setTypeface(null, android.graphics.Typeface.BOLD); setTextColor(ctx.getColor(R.color.text_primary)) })
        nameCol.addView(TextView(ctx).apply { text = "${emp.employeeCode ?: "—"}  ·  ${emp.designationTitle ?: emp.departmentName ?: ""}"; textSize = 11f; setTextColor(ctx.getColor(R.color.text_secondary)) })
        headerRow.addView(nameCol)
        // Status badge
        headerRow.addView(statusChip(ctx, dp, emp.workflowStatus))
        ll.addView(headerRow)

        // ── Info grid ──────────────────────────────────────────────────────
        val infoRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                .also { it.topMargin = (10*dp).toInt() }
        }
        fun infoCol(label: String, value: String) {
            val col = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f) }
            col.addView(TextView(ctx).apply { text = label; textSize = 9f; setTextColor(ctx.getColor(R.color.text_hint)); setAllCaps(true); letterSpacing = 0.05f })
            col.addView(TextView(ctx).apply { text = value; textSize = 12f; setTypeface(null, android.graphics.Typeface.BOLD); setTextColor(ctx.getColor(R.color.text_primary)) })
            infoRow.addView(col)
        }
        infoCol("Joined",        emp.joiningDate?.toDisplayDate() ?: "—")
        infoCol("Provision Ends", emp.provisionEndDate?.toDisplayDate() ?: "—")
        infoCol("Reporting To",  emp.managerName ?: "—")
        ll.addView(infoRow)

        // Days remaining chip
        val dr = emp.daysRemaining
        if (dr != null && emp.workflowStatus != "confirmed") {
            ll.addView(TextView(ctx).apply {
                text = when {
                    dr > 0  -> "⚠ ${dr}d remaining"
                    dr == 0 -> "🔴 Ends today"
                    else    -> "🔴 ${Math.abs(dr)}d overdue"
                }
                textSize = 11f
                setTextColor(if (dr > 30) ctx.getColor(R.color.primary) else android.graphics.Color.parseColor(if (dr > 0) "#f59e0b" else "#ef4444"))
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                    .also { it.topMargin = (6*dp).toInt() }
            })
        }

        // ── Action buttons ─────────────────────────────────────────────────
        val btnRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                .also { it.topMargin = (12*dp).toInt() }
        }

        // HR/Admin: Initiate button when not started
        if ((isHR || isAdmin) && emp.workflowStatus == "not_initiated") {
            btnRow.addView(makeBtn(ctx, dp, "🚀 Initiate", ctx.getColor(R.color.primary)) {
                showInitiateDialog(ctx, emp.id, emp.fullName)
            })
        }

        // Manager/TL/Admin-as-manager: Approve/Reject when pending
        if ((isMgr || isAdmin) && emp.workflowStatus == "pending") {
            btnRow.addView(makeBtn(ctx, dp, "✓ Approve", ctx.getColor(R.color.primary), flex = 1f) {
                showApproveDialog(ctx, emp.id, emp.fullName, "approve")
            })
            btnRow.addView(View(ctx).apply { layoutParams = LinearLayout.LayoutParams((8*dp).toInt(), 1) })
            btnRow.addView(makeBtn(ctx, dp, "✗ Reject", android.graphics.Color.parseColor("#ef4444"), flex = 1f) {
                showApproveDialog(ctx, emp.id, emp.fullName, "reject")
            })
        }

        // HR: Final approve/reject after manager approved
        if (isHR && emp.workflowStatus == "manager_approved") {
            btnRow.addView(makeBtn(ctx, dp, "✅ HR Approve", android.graphics.Color.parseColor("#10b981"), flex = 1f) {
                showApproveDialog(ctx, emp.id, emp.fullName, "approve")
            })
            btnRow.addView(View(ctx).apply { layoutParams = LinearLayout.LayoutParams((8*dp).toInt(), 1) })
            btnRow.addView(makeBtn(ctx, dp, "✗ Reject", android.graphics.Color.parseColor("#ef4444"), flex = 1f) {
                showApproveDialog(ctx, emp.id, emp.fullName, "reject")
            })
        }

        // View status button when workflow exists
        if (emp.workflowStatus != "not_initiated") {
            if (btnRow.childCount > 0) btnRow.addView(View(ctx).apply { layoutParams = LinearLayout.LayoutParams((8*dp).toInt(), 1) })
            btnRow.addView(makeBtn(ctx, dp, "📋 Status", android.graphics.Color.parseColor("#64748b")) {
                showStatusDialog(ctx, dp, emp)
            })
        }

        if (btnRow.childCount > 0) ll.addView(btnRow)
        outerRow.addView(ll)
        card.addView(outerRow)
    }

    private fun makeBtn(ctx: android.content.Context, dp: Float, label: String, color: Int, flex: Float = 0f, onClick: () -> Unit) =
        com.google.android.material.button.MaterialButton(ctx, null, com.google.android.material.R.attr.materialButtonStyle).apply {
            text = label; textSize = 11f; setBackgroundColor(color)
            layoutParams = if (flex > 0f)
                LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, flex)
            else
                LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            setPadding((8*dp).toInt(), 0, (8*dp).toInt(), 0)
            setOnClickListener { onClick() }
        }

    private fun statusChip(ctx: android.content.Context, dp: Float, status: String) = TextView(ctx).apply {
        val (label, color) = when (status) {
            "confirmed"        -> "✅ Confirmed"    to "#10b981"
            "rejected"         -> "✗ Rejected"     to "#ef4444"
            "manager_approved" -> "👍 Mgr Approved" to "#4361ee"
            "pending"          -> "⏳ Pending"      to "#f59e0b"
            else               -> "○ Not Started"   to "#94a3b8"
        }
        text = label; textSize = 9f
        setTextColor(android.graphics.Color.parseColor(color))
        background = android.graphics.drawable.GradientDrawable().apply {
            setColor(android.graphics.Color.parseColor(color + "20"))
            cornerRadius = 20*dp
        }
        setPadding((6*dp).toInt(), (3*dp).toInt(), (6*dp).toInt(), (3*dp).toInt())
    }

    private fun showInitiateDialog(ctx: android.content.Context, empId: Int, empName: String) {
        val dp = ctx.resources.displayMetrics.density
        val layout = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; setPadding((20*dp).toInt(),(12*dp).toInt(),(20*dp).toInt(),(8*dp).toInt()) }
        layout.addView(TextView(ctx).apply { text = "Start confirmation workflow for $empName"; textSize = 13f; setTextColor(android.graphics.Color.parseColor("#64748b")); setPadding(0,0,0,(12*dp).toInt()) })
        val etNotes = android.widget.EditText(ctx).apply { hint = "Notes (optional)"; minLines = 2; setBackgroundColor(android.graphics.Color.parseColor("#F5F5F5")); setPadding((12*dp).toInt(),(10*dp).toInt(),(12*dp).toInt(),(10*dp).toInt()) }
        layout.addView(etNotes)
        androidx.appcompat.app.AlertDialog.Builder(ctx)
            .setTitle("🚀 Initiate Confirmation")
            .setView(layout)
            .setPositiveButton("Initiate") { _, _ ->
                val notes = etNotes.text.toString().trim()
                kotlinx.coroutines.MainScope().launch {
                    try {
                        val body = if (notes.isNotBlank()) mapOf("notes" to notes) else emptyMap<String, String>()
                        val res = RetrofitClient.instance.initiateConfirmation(empId, body)
                        val ok = res.isSuccessful && res.body()?.success == true
                        ctx.toast(if (ok) "✅ Confirmation initiated! Manager notified." else res.body()?.message ?: "Failed")
                        if (ok) onRefresh()
                    } catch (e: Exception) { ctx.toast("Error: ${e.message}") }
                }
            }
            .setNegativeButton("Cancel", null).show()
    }

    private fun showApproveDialog(ctx: android.content.Context, empId: Int, empName: String, defaultAction: String) {
        val dp = ctx.resources.displayMetrics.density
        val layout = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; setPadding((20*dp).toInt(),(12*dp).toInt(),(20*dp).toInt(),(8*dp).toInt()) }
        layout.addView(TextView(ctx).apply { text = empName; textSize = 14f; setTypeface(null, android.graphics.Typeface.BOLD); setPadding(0,0,0,(4*dp).toInt()) })
        val etRemarks = android.widget.EditText(ctx).apply { hint = "Remarks (optional)"; minLines = 2; setBackgroundColor(android.graphics.Color.parseColor("#F5F5F5")); setPadding((12*dp).toInt(),(10*dp).toInt(),(12*dp).toInt(),(10*dp).toInt()) }
        layout.addView(etRemarks)

        val isApprove = defaultAction == "approve"
        val title = if (isApprove) "✅ Approve Confirmation" else "✗ Reject Confirmation"
        val posBtn = if (isApprove) "Approve" else "Reject"

        androidx.appcompat.app.AlertDialog.Builder(ctx)
            .setTitle(title)
            .setView(layout)
            .setPositiveButton(posBtn) { _, _ ->
                val remarks = etRemarks.text.toString().trim()
                kotlinx.coroutines.MainScope().launch {
                    try {
                        val res = RetrofitClient.instance.approveConfirmation(empId, ActionRequest(defaultAction, remarks.ifBlank { null }))
                        val ok = res.isSuccessful && res.body()?.success == true
                        val msg = res.body()?.message ?: if (ok) "Done" else "Failed"
                        ctx.toast(if (ok) "✅ $msg" else "❌ $msg")
                        if (ok) onRefresh()
                    } catch (e: Exception) { ctx.toast("Error: ${e.message}") }
                }
            }
            .setNegativeButton("Cancel", null).show()
    }

    private fun showStatusDialog(ctx: android.content.Context, dp: Float, emp: ProvisionEmployee) {
        val layout = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; setPadding((20*dp).toInt(),(12*dp).toInt(),(20*dp).toInt(),(8*dp).toInt()) }

        fun stepRow(level: String, name: String, status: String?, date: String?) {
            val color = when(status) {
                "approved" -> android.graphics.Color.parseColor("#10b981")
                "rejected" -> android.graphics.Color.parseColor("#ef4444")
                else       -> android.graphics.Color.parseColor("#f59e0b")
            }
            val row = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = android.view.Gravity.CENTER_VERTICAL; layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.bottomMargin = (8*dp).toInt() } }
            row.addView(TextView(ctx).apply {
                text = level; textSize = 10f; setTextColor(android.graphics.Color.WHITE); setTypeface(null, android.graphics.Typeface.BOLD); gravity = android.view.Gravity.CENTER
                background = android.graphics.drawable.GradientDrawable().apply { setColor(color); cornerRadius = 8*dp }
                setPadding((8*dp).toInt(),(4*dp).toInt(),(8*dp).toInt(),(4*dp).toInt())
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.marginEnd = (10*dp).toInt() }
            })
            val info = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f) }
            info.addView(TextView(ctx).apply { text = name; textSize = 12f; setTypeface(null, android.graphics.Typeface.BOLD) })
            if (date != null) info.addView(TextView(ctx).apply { text = date.take(10).toDisplayDate(); textSize = 10f; setTextColor(android.graphics.Color.parseColor("#94a3b8")) })
            row.addView(info)
            row.addView(TextView(ctx).apply {
                text = when(status) { "approved" -> "✓"; "rejected" -> "✗"; else -> "⏳" }
                textSize = 16f; setTextColor(color)
            })
            layout.addView(row)
        }

        layout.addView(TextView(ctx).apply { text = emp.fullName; textSize = 15f; setTypeface(null, android.graphics.Typeface.BOLD); setPadding(0,0,0,(4*dp).toInt()) })
        layout.addView(statusChip(ctx, dp, emp.workflowStatus).also { it.layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { m -> m.bottomMargin = (12*dp).toInt() } })

        stepRow("HR", "Initiated",   if (emp.initiatedAt != null) "approved" else "pending", emp.initiatedAt)
        stepRow("MGR", "Manager",    emp.managerStatus ?: "pending", emp.managerApprovedAt)
        stepRow("HR", "HR Final",    emp.hrStatus ?: "pending", emp.hrApprovedAt)

        if (emp.workflowStatus == "confirmed" && emp.confirmedDate != null) {
            // Show prorated leaves
            val cd = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.getDefault()).parse(emp.confirmedDate)
            if (cd != null) {
                val cal = java.util.Calendar.getInstance().also { it.time = cd }
                val day = cal.get(java.util.Calendar.DAY_OF_MONTH)
                val totalDays = cal.getActualMaximum(java.util.Calendar.DAY_OF_MONTH)
                val rem = totalDays - day + 1
                val frac = rem.toDouble() / totalDays
                val el = String.format("%.2f", 1.5 * frac)
                val sl = String.format("%.2f", 0.5 * frac)
                val cl = String.format("%.2f", 0.5 * frac)
                layout.addView(TextView(ctx).apply {
                    text = "Permanent from ${emp.confirmedDate?.toDisplayDate() ?: ""} - Leaves credited: EL: $el  SL: $sl  CL: $cl"
                    textSize = 12f; setTextColor(android.graphics.Color.parseColor("#10b981"))
                    background = android.graphics.drawable.GradientDrawable().apply { setColor(android.graphics.Color.parseColor("#10b98120")); cornerRadius = 10*dp }
                    setPadding((12*dp).toInt(),(10*dp).toInt(),(12*dp).toInt(),(10*dp).toInt())
                    layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = (8*dp).toInt() }
                })
            }
        }

        androidx.appcompat.app.AlertDialog.Builder(ctx)
            .setTitle("📋 Confirmation Status")
            .setView(layout)
            .setPositiveButton("Close", null)
            .show()
    }
}
// ═══════════════════════════════════════════════════════════════════════════════
// PROJECT MANAGEMENT FRAGMENT
// ═══════════════════════════════════════════════════════════════════════════════
class ProjectManagementFragment : Fragment() {

    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View {
        val ctx = requireContext(); val dp = ctx.resources.displayMetrics.density
        val scroll = android.widget.ScrollView(ctx).apply {
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding((16*dp).toInt(), (16*dp).toInt(), (16*dp).toInt(), (80*dp).toInt())
        }
        scroll.addView(root)

        fun fmt(v: Double) = "\u20B9${String.format("%,.2f", v)}"
        fun fmtShort(v: Double) = "\u20B9${String.format("%,.0f", v)}"

        // Header
        root.addView(TextView(ctx).apply {
            text = "\uD83D\uDDC2\uFE0F Project Management"; textSize = 20f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(ctx.getColor(R.color.text_primary))
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.bottomMargin = (14*dp).toInt() }
        })

        // Summary grid — 3 columns x 3 rows like Quick Access
        val tvTotalProjects = TextView(ctx); val tvClientBudget = TextView(ctx)
        val tvPlannedCost   = TextView(ctx); val tvActualSpent  = TextView(ctx)
        val tvSalaryCost    = TextView(ctx); val tvAdvanceCost  = TextView(ctx)
        val tvReimbCost     = TextView(ctx)

        data class SC(val icon: String, val tv: TextView, val label: String, val bg: String, val iconColor: String)
        val statCards = listOf(
            SC("\uD83D\uDCC1", tvTotalProjects, "Projects",     "#E8F5E9", "#22c55e"),
            SC("\uD83D\uDCB0", tvClientBudget,  "Client Budget","#dcfce7", "#16a34a"),
            SC("\uD83D\uDCCB", tvPlannedCost,   "Planned Cost", "#fef9c3", "#ca8a04"),
            SC("\uD83D\uDCB3", tvActualSpent,   "Actual Spent", "#ede9fe", "#7c3aed"),
            SC("\uD83D\uDCBC", tvSalaryCost,    "Salary",       "#dbeafe", "#2563eb"),
            SC("\uD83D\uDCB5", tvAdvanceCost,   "Advance",      "#fef3c7", "#d97706"),
            SC("\uD83E\uDDFE", tvReimbCost,     "Reimb.",       "#fce7f3", "#db2777")
        )

        // Build grid rows of 3
        var rowLL: LinearLayout? = null
        statCards.forEachIndexed { idx, (icon, tv, label, bg, iconColor) ->
            if (idx % 3 == 0) {
                rowLL = LinearLayout(ctx).apply {
                    orientation = LinearLayout.HORIZONTAL
                    layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.bottomMargin = (10*dp).toInt() }
                }
                root.addView(rowLL)
            }
            tv.text = "\u2014"; tv.textSize = 13f; tv.setTypeface(null, android.graphics.Typeface.BOLD)
            tv.setTextColor(ctx.getColor(R.color.text_primary)); tv.gravity = android.view.Gravity.CENTER

            val iconTv = TextView(ctx).apply {
                text = icon; textSize = 22f; gravity = android.view.Gravity.CENTER
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            }
            val labelTv = TextView(ctx).apply {
                text = label; textSize = 10f; gravity = android.view.Gravity.CENTER
                setTextColor(android.graphics.Color.parseColor("#555555"))
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = (2*dp).toInt() }
            }
            val cell = androidx.cardview.widget.CardView(ctx).apply {
                radius = 14*dp; cardElevation = 2*dp
                setCardBackgroundColor(android.graphics.Color.parseColor(bg))
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).also {
                    it.marginEnd = if (idx % 3 < 2) (8*dp).toInt() else 0
                }
                addView(LinearLayout(ctx).apply {
                    orientation = LinearLayout.VERTICAL
                    gravity = android.view.Gravity.CENTER
                    setPadding((8*dp).toInt(),(14*dp).toInt(),(8*dp).toInt(),(14*dp).toInt())
                    addView(iconTv); addView(tv); addView(labelTv)
                })
            }
            rowLL!!.addView(cell)
        }
        // Fill last row if needed (7 items = 2 full rows + 1 item, add 2 empty spacers)
        if (statCards.size % 3 != 0) {
            val remaining = 3 - (statCards.size % 3)
            repeat(remaining) {
                rowLL!!.addView(android.view.View(ctx).apply {
                    layoutParams = LinearLayout.LayoutParams(0, 1, 1f).also { it.marginEnd = (8*dp).toInt() }
                })
            }
        }

        // Divider
        root.addView(android.view.View(ctx).apply {
            setBackgroundColor(android.graphics.Color.parseColor("#E5E7EB"))
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (1*dp).toInt()).also { it.topMargin = (6*dp).toInt(); it.bottomMargin = (14*dp).toInt() }
        })

        // Projects list
        val llProjects = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        }
        root.addView(llProjects)

        lifecycleScope.launch {
            try {
                val sum = RetrofitClient.instance.getProjectSummary().body()?.data
                if (sum != null) {
                    tvTotalProjects.text = "${sum.activeProjects}/${sum.totalProjects}"
                    tvClientBudget.text  = fmtShort(sum.totalBudget)
                    tvPlannedCost.text   = fmtShort(sum.totalPlanned)
                    tvActualSpent.text   = fmtShort(sum.totalActual)
                    tvSalaryCost.text    = fmtShort(sum.totalSalary)
                    tvAdvanceCost.text   = fmtShort(sum.totalAdvance)
                    tvReimbCost.text     = fmtShort(sum.totalReimbursement)
                }

                val projects = RetrofitClient.instance.getProjects(status = "active").body()?.data ?: emptyList()
                llProjects.removeAllViews()
                llProjects.addView(TextView(ctx).apply {
                    text = "Active Projects (${projects.size})"; textSize = 14f
                    setTypeface(null, android.graphics.Typeface.BOLD); setTextColor(ctx.getColor(R.color.text_primary))
                    layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.bottomMargin = (10*dp).toInt() }
                })

                if (projects.isEmpty()) {
                    llProjects.addView(TextView(ctx).apply { text = "No active projects found."; textSize = 13f; setTextColor(android.graphics.Color.parseColor("#888888")) })
                    return@launch
                }

                projects.forEach { proj ->
                    val utilPct = if (proj.totalBudget > 0) (proj.actualCost / proj.totalBudget * 100).toFloat().coerceIn(0f,100f) else 0f
                    val variance = proj.totalBudget - proj.actualCost
                    val isOver = variance < 0

                    val inner = LinearLayout(ctx).apply {
                        orientation = LinearLayout.VERTICAL
                        setPadding((16*dp).toInt(),(14*dp).toInt(),(16*dp).toInt(),(14*dp).toInt())
                    }

                    // Name + status badge
                    val nameRow = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = android.view.Gravity.CENTER_VERTICAL }
                    nameRow.addView(TextView(ctx).apply {
                        text = proj.name; textSize = 15f; setTypeface(null, android.graphics.Typeface.BOLD)
                        setTextColor(ctx.getColor(R.color.text_primary))
                        layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                    })
                    nameRow.addView(TextView(ctx).apply {
                        text = "ACTIVE"; textSize = 9f; setTextColor(android.graphics.Color.parseColor("#166534"))
                        background = android.graphics.drawable.GradientDrawable().apply { setColor(android.graphics.Color.parseColor("#dcfce7")); cornerRadius = 20*dp }
                        setPadding((6*dp).toInt(),(2*dp).toInt(),(6*dp).toInt(),(2*dp).toInt())
                    })
                    inner.addView(nameRow)

                    // Code + client
                    val meta = listOfNotNull(proj.code, proj.clientName?.let { "Client: $it" }).joinToString("  \u00B7  ")
                    if (meta.isNotEmpty()) inner.addView(TextView(ctx).apply {
                        text = meta; textSize = 11f; setTextColor(android.graphics.Color.parseColor("#888888"))
                        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = (2*dp).toInt() }
                    })

                    // PM + members + end date
                    val pmLine = listOfNotNull(proj.projectManagerName?.let { "PM: $it" }, "${proj.employeeCount} member(s)", proj.endDate?.take(10)?.let { "Ends: $it" }).joinToString("  \u00B7  ")
                    inner.addView(TextView(ctx).apply {
                        text = pmLine; textSize = 12f; setTextColor(android.graphics.Color.parseColor("#555555"))
                        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = (6*dp).toInt() }
                    })

                    // Budget utilisation
                    val budgetRow = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = android.view.Gravity.CENTER_VERTICAL; layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = (8*dp).toInt() } }
                    budgetRow.addView(TextView(ctx).apply { text = "Budget Utilisation"; textSize = 11f; setTextColor(android.graphics.Color.parseColor("#555555")); layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f) })
                    budgetRow.addView(TextView(ctx).apply { text = "${String.format("%.1f", utilPct)}%"; textSize = 11f; setTypeface(null, android.graphics.Typeface.BOLD); setTextColor(if (isOver) android.graphics.Color.parseColor("#ef4444") else android.graphics.Color.parseColor("#16a34a")) })
                    inner.addView(budgetRow)
                    inner.addView(android.widget.ProgressBar(ctx, null, android.R.attr.progressBarStyleHorizontal).apply {
                        max = 100; progress = utilPct.toInt()
                        progressDrawable.setColorFilter(if (utilPct > 90) android.graphics.Color.parseColor("#ef4444") else android.graphics.Color.parseColor("#22c55e"), android.graphics.PorterDuff.Mode.SRC_IN)
                        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (7*dp).toInt()).also { it.topMargin = (4*dp).toInt() }
                    })

                    // Spent / Budget / Variance
                    inner.addView(TextView(ctx).apply { text = "Spent: ${fmt(proj.actualCost)}  /  Budget: ${fmt(proj.totalBudget)}"; textSize = 12f; setTextColor(android.graphics.Color.parseColor("#444444")); layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = (4*dp).toInt() } })
                    inner.addView(TextView(ctx).apply {
                        text = if (isOver) "\u26A0\uFE0F Over budget by ${fmt(-variance)}" else "Under budget by ${fmt(variance)}"
                        textSize = 11f; setTextColor(if (isOver) android.graphics.Color.parseColor("#ef4444") else android.graphics.Color.parseColor("#16a34a"))
                        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = (2*dp).toInt() }
                    })
                    if (proj.plannedCost > 0) inner.addView(TextView(ctx).apply { text = "Planned Cost (Org): ${fmt(proj.plannedCost)}"; textSize = 11f; setTextColor(android.graphics.Color.parseColor("#888888")); layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = (2*dp).toInt() } })

                    // Cost chips
                    val chipScroll = android.widget.HorizontalScrollView(ctx).apply { isHorizontalScrollBarEnabled = false; layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.topMargin = (8*dp).toInt() } }
                    val chips = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL }
                    fun chip(label: String, bg: String) = TextView(ctx).apply {
                        text = label; textSize = 11f; setTextColor(android.graphics.Color.parseColor("#333333"))
                        background = android.graphics.drawable.GradientDrawable().apply { setColor(android.graphics.Color.parseColor(bg)); cornerRadius = 20*dp }
                        setPadding((10*dp).toInt(),(4*dp).toInt(),(10*dp).toInt(),(4*dp).toInt())
                        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.marginEnd = (6*dp).toInt() }
                    }
                    if (proj.salaryCost > 0)        chips.addView(chip("Salary ${fmt(proj.salaryCost)}", "#dbeafe"))
                    if (proj.advanceCost > 0)       chips.addView(chip("Advance ${fmt(proj.advanceCost)}", "#fef3c7"))
                    if (proj.reimbursementCost > 0) chips.addView(chip("Reimb ${fmt(proj.reimbursementCost)}", "#ede9fe"))
                    chipScroll.addView(chips); inner.addView(chipScroll)

                    llProjects.addView(androidx.cardview.widget.CardView(ctx).apply {
                        radius = 12*dp; cardElevation = 3*dp
                        setCardBackgroundColor(android.graphics.Color.WHITE)
                        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).also { it.bottomMargin = (14*dp).toInt() }
                        addView(inner)
                    })
                }
            } catch (e: Exception) {
                llProjects.addView(TextView(ctx).apply { text = "Failed to load: ${e.message}"; textSize = 13f; setTextColor(android.graphics.Color.parseColor("#ef4444")) })
            }
        }
        return scroll
    }
}