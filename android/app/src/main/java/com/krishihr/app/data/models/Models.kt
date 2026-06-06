package com.krishihr.app.data.models

import android.os.Parcelable
import com.google.gson.annotations.SerializedName
import kotlinx.parcelize.Parcelize

// ── Generic wrapper ───────────────────────────────────────────────────────────
data class ApiResponse<T>(
    val success: Boolean,
    val message: String? = null,
    val data: T? = null,
    val total: Int? = null
)

data class NotificationsResponse(
    val success: Boolean,
    val data: List<Notification> = emptyList(),
    val unread: Int = 0
)

// ── Auth ──────────────────────────────────────────────────────────────────────
data class LoginRequest(
    val email: String,
    val password: String,
    @SerializedName("device_id")   val deviceId: String? = null,
    @SerializedName("app_version") val appVersion: String? = null,
    @SerializedName("device_name") val deviceName: String? = null
)
data class LoginResponse(val success: Boolean, val message: String? = null, val data: LoginData? = null)
data class LoginData(val token: String, val employee: Employee)
data class TokenData(val token: String)
data class ChangePasswordRequest(
    @SerializedName("old_password") val oldPassword: String,
    @SerializedName("new_password") val newPassword: String
)
data class ForgotVerifyRequest(@SerializedName("employee_code") val employeeCode: String, val email: String)
data class ForgotVerifyData(@SerializedName("employee_id") val employeeId: Int, val name: String)
data class ForgotVerifyPanRequest(@SerializedName("employee_id") val employeeId: Int, @SerializedName("pan_number") val panNumber: String)
data class ResetTokenData(@SerializedName("reset_token") val resetToken: String)
data class ForgotResetRequest(@SerializedName("reset_token") val resetToken: String, @SerializedName("new_password") val newPassword: String)

// ── Employee ──────────────────────────────────────────────────────────────────
@Parcelize
data class Employee(
    val id: Int,
    @SerializedName("employee_code") val employeeCode: String? = null,
    @SerializedName("first_name") val firstName: String,
    @SerializedName("last_name") val lastName: String,
    val email: String,
    val role: String? = null,
    val department: String? = null,
    @SerializedName("department_id") val departmentId: Int? = null,
    @SerializedName("department_name") val departmentName: String? = null,
    val designation: String? = null,
    @SerializedName("designation_id") val designationId: Int? = null,
    @SerializedName("designation_title") val designationTitle: String? = null,
    val phone: String? = null,
    @SerializedName("profile_photo") val profilePhoto: String? = null,
    @SerializedName("joining_date") val joiningDate: String? = null,
    @SerializedName("date_of_joining") val dateOfJoining: String? = null,
    @SerializedName("date_of_birth") val dateOfBirth: String? = null,
    val gender: String? = null,
    val address: String? = null,
    @SerializedName("reporting_manager_id") val reportingManagerId: Int? = null,
    @SerializedName("manager_name") val managerName: String? = null,
    @SerializedName("team_leader_id") val teamLeaderId: Int? = null,
    @SerializedName("team_leader_name") val teamLeaderName: String? = null,
    @SerializedName("is_active") val isActive: Boolean = true,
    @SerializedName("employment_type") val employmentType: String? = null,
    @SerializedName("saturday_policy") val saturdayPolicy: String? = null
) : Parcelable {
    val fullName get() = "$firstName $lastName".trim()
    val displayRole get() = role?.replaceFirstChar { it.uppercase() }?.replace("_", " ") ?: "Employee"
    val initials get() = "${firstName.firstOrNull() ?: ""}${lastName.firstOrNull() ?: ""}".uppercase()
    val effectiveJoiningDate get() = joiningDate ?: dateOfJoining
}

data class Department(val id: Int, val name: String, val code: String? = null)
data class Designation(val id: Int, val title: String, val code: String? = null)

// ── Dashboard ─────────────────────────────────────────────────────────────────
data class DashboardData(
    @SerializedName("today_attendance") val todayAttendance: AttendanceRecord? = null,
    @SerializedName("monthly_summary") val monthlySummary: MonthlySummary? = null,
    @SerializedName("pending_leave_approvals") val pendingLeaveApprovals: Int = 0,
    @SerializedName("pending_regularizations") val pendingRegularizations: Int = 0,
    @SerializedName("leave_balance") val leaveBalance: List<LeaveBalance>? = null,
    @SerializedName("unread_notifications") val unreadNotifications: Int = 0
)

data class MonthlySummary(
    val present: Int = 0, val absent: Int = 0, val late: Int = 0,
    @SerializedName("half_day") val halfDay: Int = 0,
    @SerializedName("total_hours") val totalHours: Double = 0.0,
    @SerializedName("avg_hours") val avgHours: Double = 0.0
)

// ── Attendance ────────────────────────────────────────────────────────────────
data class AttendanceRecord(
    val id: Int? = null,
    @SerializedName("employee_id") val employeeId: Int? = null,
    @SerializedName("employee_name") val employeeName: String? = null,
    // date_str is pre-formatted YYYY-MM-DD from backend
    @SerializedName("date_str") val dateStr: String? = null,
    val date: String? = null,
    // Raw timestamp columns
    @SerializedName("punch_in") val punchIn: String? = null,
    @SerializedName("punch_out") val punchOut: String? = null,
    // Pre-formatted time strings from backend TO_CHAR (e.g. "09:30 AM")
    @SerializedName("punch_in_time") val punchInTime: String? = null,
    @SerializedName("punch_out_time") val punchOutTime: String? = null,
    @SerializedName("punch_in_location") val punchInLocation: String? = null,
    @SerializedName("punch_out_location") val punchOutLocation: String? = null,
    val status: String? = null,
    @SerializedName("working_hours") val workingHours: Double? = null,
    @SerializedName("regularization_status") val regularizationStatus: String? = null
) {
    // Use pre-formatted time if available, fall back to parsing raw timestamp
    val displayDate get() = dateStr ?: date?.take(10)
    val displayPunchIn  get() = punchInTime?.ifBlank { null } ?: parseTime(punchIn)
    val displayPunchOut get() = punchOutTime?.ifBlank { null } ?: parseTime(punchOut)

    companion object {
        fun parseTime(raw: String?): String? {
            if (raw.isNullOrBlank()) return null
            return try {
                // Handle full ISO "2026-03-24T14:30:00", plain "14:30:00", or "14:30"
                val t = if (raw.contains("T")) raw.substringAfterLast("T").substringBefore(".")
                else raw.trim().substringBefore(".")
                val src = if (t.length >= 8) "HH:mm:ss" else "HH:mm"
                val sdf = java.text.SimpleDateFormat(src, java.util.Locale.getDefault())
                val out = java.text.SimpleDateFormat("h:mm a", java.util.Locale.getDefault())
                val d = sdf.parse(t)
                if (d != null) out.format(d) else raw.take(5)
            } catch (_: Exception) { raw.take(5) }
        }
    }
}

data class AttendanceSummary(
    val present: Int = 0, val absent: Int = 0, val late: Int = 0,
    @SerializedName("half_day") val halfDay: Int = 0,
    val wfh: Int = 0, val od: Int = 0,
    @SerializedName("total_hours") val totalHours: Double = 0.0
)

data class PunchRequest(
    @SerializedName("location_lat") val lat: Double? = null,
    @SerializedName("location_lng") val lng: Double? = null,
    @SerializedName("punch_in_location") val punchInLocation: String? = null,
    @SerializedName("punch_out_location") val punchOutLocation: String? = null,
    @SerializedName("punch_time") val punchTime: String? = null,
    @SerializedName("punch_date") val punchDate: String? = null,
    @SerializedName("source") val source: String? = "mobile",
    @SerializedName("geofence_valid") val geofenceValid: Boolean? = null
)

data class RegularizationRequest(
    val date: String,
    @SerializedName("punch_in") val punchIn: String? = null,
    @SerializedName("punch_out") val punchOut: String? = null,
    val reason: String
)

@Parcelize
data class RegularizationItem(
    val id: Int,
    @SerializedName("employee_id") val employeeId: Int? = null,
    @SerializedName("employee_name") val employeeName: String? = null,
    @SerializedName("employee_code") val employeeCode: String? = null,
    val date: String? = null,
    @SerializedName("requested_punch_in") val requestedPunchIn: String? = null,
    @SerializedName("requested_punch_out") val requestedPunchOut: String? = null,
    val reason: String? = null,
    val status: String? = null,
    @SerializedName("created_at") val createdAt: String? = null
) : Parcelable

data class TeamTodayRecord(
    @SerializedName("employee_id") val employeeId: Int? = null,
    @SerializedName("employee_name") val employeeName: String? = null,
    @SerializedName("employee_code") val employeeCode: String? = null,
    val designation: String? = null,
    @SerializedName("punch_in") val punchIn: String? = null,
    @SerializedName("punch_out") val punchOut: String? = null,
    val status: String? = null,
    @SerializedName("working_hours") val workingHours: Double? = null
)


// OD/WFH approval response models (backend returns emp_name, not employee_name)
data class ODApprovalItem(
    val id: Int,
    @SerializedName("employee_id") val employeeId: Int? = null,
    @SerializedName("emp_name") val empName: String? = null,
    @SerializedName("employee_code") val employeeCode: String? = null,
    val date: String? = null,
    val reason: String? = null,
    val location: String? = null,
    val status: String = "pending",
    @SerializedName("applied_at") val appliedAt: String? = null
)

data class WFHApprovalItem(
    val id: Int,
    @SerializedName("employee_id") val employeeId: Int? = null,
    @SerializedName("emp_name") val empName: String? = null,
    @SerializedName("employee_code") val employeeCode: String? = null,
    val date: String? = null,
    val reason: String? = null,
    val status: String = "pending",
    @SerializedName("applied_at") val appliedAt: String? = null
)

data class ODRequest(val date: String? = null, val from_date: String? = null, val to_date: String? = null, val reason: String, val location: String = "Outdoor Duty")
data class WFHRequest(val date: String? = null, val from_date: String? = null, val to_date: String? = null, val reason: String)
data class ActionRequest(val action: String, val remarks: String? = null)

// ── Leave ─────────────────────────────────────────────────────────────────────
data class LeaveType(
    val id: Int, val name: String, val code: String? = null,
    @SerializedName("days_allowed") val daysAllowed: Int = 0,
    @SerializedName("is_paid") val isPaid: Boolean = true
)

data class LeaveRequest(
    @SerializedName("leave_type_id") val leaveTypeId: Int,
    @SerializedName("from_date") val fromDate: String? = null,
    @SerializedName("to_date") val toDate: String? = null,
    val reason: String,
    @SerializedName("leave_type") val leaveType: String? = null,
    @SerializedName("is_half_day") val isHalfDay: Boolean = false
)

@Parcelize
data class LeaveApplication(
    val id: Int,
    @SerializedName("employee_id") val employeeId: Int? = null,
    @SerializedName("employee_name") val employeeName: String? = null,
    @SerializedName("employee_code") val employeeCode: String? = null,
    @SerializedName("leave_type") val leaveType: String? = null,
    @SerializedName("leave_type_id") val leaveTypeId: Int? = null,
    @SerializedName("leave_type_name") val leaveTypeName: String? = null,
    // ✅ FIX: od_requests stores one row per day with single "date" column.
    // getMyODRequests returns "date", NOT "from_date"/"to_date".
    // This field is needed so the OD today-check in AttendanceFragment works.
    @SerializedName("date") val date: String? = null,
    @SerializedName("from_date") val fromDate: String? = null,
    @SerializedName("to_date") val toDate: String? = null,
    val status: String,
    val reason: String? = null,
    @SerializedName("applied_on") val appliedOn: String? = null,
    @SerializedName("applied_at") val appliedAt: String? = null,
    @SerializedName("total_days") val totalDays: Double? = null,
    val remarks: String? = null,
    val type: String? = null,
    @SerializedName("current_approver_code") val currentApproverCode: String? = null,
    @SerializedName("is_half_day") val isHalfDay: Boolean? = null
) : Parcelable {
    val displayType get() = leaveTypeName ?: leaveType ?: type ?: "Leave"
    val appliedDate get() = appliedOn ?: appliedAt
}

// Custom response wrapper for leave balance — captures is_provisional at top level
data class LeaveBalanceResponse(
    val success: Boolean,
    val message: String? = null,
    val data: List<LeaveBalance>? = null,
    @SerializedName("is_provisional") val isProvisional: Boolean = false,
    @SerializedName("provision_ends") val provisionEnds: String? = null
)

data class LeaveBalance(
    @SerializedName("leave_type_id") val leaveTypeId: Int? = null,
    @SerializedName("leave_type_name") val leaveTypeName: String? = null,
    // backend returns `name` and `code` from leave_types join
    val name: String? = null,
    val code: String? = null,
    @SerializedName("leave_type_code") val leaveTypeCode: String? = null,
    // backend computed field: allocated + carry_forward - used - pending
    val available: Double = 0.0,
    val allocated: Double = 0.0,
    val used: Double = 0.0,
    val pending: Double = 0.0,
    @SerializedName("carry_forward") val carryForward: Double = 0.0,
    // legacy fallbacks
    val balance: Double = 0.0,
    val total: Double = 0.0,
    val entitled: Double? = null,
    @SerializedName("days_allowed") val daysAllowed: Int? = null
) {
    val effectiveCode get() = (code ?: leaveTypeCode)?.uppercase()?.trim()
    val effectiveName get() = name ?: leaveTypeName ?: leaveTypeCode ?: ""
    // Use available (backend computed) first, then fallbacks
    // Trust backend  (= allocated+carry_forward-used-pending); only fall back for legacy records
    val effectiveBalance get() = when {
        allocated > 0 || used > 0 || carryForward > 0 -> available
        balance > 0 -> balance
        else -> 0.0
    }
}

// ── Advance ───────────────────────────────────────────────────────────────────
data class AdvanceRequest(val amount: Double, val reason: String, @SerializedName("project_id") val projectId: Int? = null)
data class AdvanceEditRequest(val amount: Double, val reason: String, @SerializedName("repayment_months") val repaymentMonths: Int = 1)

@Parcelize
data class AdvanceApplication(
    val id: Int, val amount: Double, val reason: String? = null, val status: String,
    @SerializedName("employee_id") val employeeId: Int? = null,
    @SerializedName("applied_on") val appliedOn: String? = null,
    @SerializedName("applied_at") val appliedAt: String? = null,
    @SerializedName("requested_at") val requestedAt: String? = null,
    @SerializedName("employee_name") val employeeName: String? = null,
    @SerializedName("employee_code") val employeeCode: String? = null,
    @SerializedName("current_approver_code") val currentApproverCode: String? = null,
    @SerializedName("current_level") val currentLevel: Int? = null,
    val remarks: String? = null
) : Parcelable

// ── Payroll ───────────────────────────────────────────────────────────────────
data class Payslip(
    val id: Int? = null, val month: Int? = null, val year: Int? = null, val status: String? = null,
    @SerializedName("employee_name") val employeeName: String? = null,
    @SerializedName("employee_code") val employeeCode: String? = null,
    @SerializedName("department_name") val departmentName: String? = null,
    @SerializedName("designation_title") val designationTitle: String? = null,
    // actual DB column names
    val basic: Double? = null,
    val hra: Double? = null,
    val conveyance: Double? = null,
    @SerializedName("special_allowance") val specialAllowance: Double? = null,
    val gratuity: Double? = null,
    @SerializedName("gross_salary") val grossSalary: Double = 0.0,
    @SerializedName("net_salary") val netSalary: Double = 0.0,
    @SerializedName("total_deductions") val totalDeductions: Double = 0.0,
    @SerializedName("total_deductions_display") val totalDeductionsDisplay: Double? = null,
    @SerializedName("net_salary_display") val netSalaryDisplay: Double? = null,
    @SerializedName("pf_employee") val pfEmployee: Double? = null,
    @SerializedName("pf_employer") val pfEmployer: Double? = null,
    @SerializedName("esi_employee") val esiEmployee: Double? = null,
    @SerializedName("professional_tax") val professionalTax: Double? = null,
    val tds: Double? = null,
    val lwf: Double? = null,
    // extra deduction fields matching web payslip
    @SerializedName("loan_emi_recovery") val emiRecovery: Double? = null,
    @SerializedName("admin_charges") val adminCharges: Double? = null,
    @SerializedName("pf_admin")          val pfAdmin: Double? = null,
    // days info
    @SerializedName("present_days")      val presentDays: Double? = null,
    @SerializedName("paid_days")         val paidDays: Double? = null,
    @SerializedName("working_days")      val workingDays: Double? = null,
    @SerializedName("lop_days")          val lopDays: Double? = null,
    @SerializedName("absent_days")       val absentDays: Double? = null,
    // legacy
    @SerializedName("basic_salary") val basicSalary: Double? = null,
    @SerializedName("days_present") val daysPresent: Int? = null,
    @SerializedName("days_absent") val daysAbsent: Int? = null,
    val components: List<PayComponent>? = null,
    // employee financial/identity fields returned from payslip JOIN
    @SerializedName("uan_number")    val uanNumber: String? = null,
    @SerializedName("pf_number")     val pfNumber: String? = null,
    @SerializedName("pan_number")    val panNumber: String? = null,
    @SerializedName("bank_name")     val bankName: String? = null,
    @SerializedName("bank_account")  val bankAccount: String? = null,
    @SerializedName("bank_ifsc")     val bankIfsc: String? = null,
    @SerializedName("date_of_birth") val slipDob: String? = null,
    @SerializedName("joining_date")  val slipDoj: String? = null
) {
    val effectiveNet   get() = netSalaryDisplay ?: netSalary
    val effectiveGross get() = grossSalary
    val effectiveDed   get() = totalDeductionsDisplay ?: totalDeductions
    // Total earning = Gross + PF Employer (matches web payslip)
    val totalEarning   get() = effectiveGross + (pfEmployer ?: 0.0)

    fun buildComponents(): List<PayComponent> {
        val list = mutableListOf<PayComponent>()

        // ── If API sends a components array, use it to get dynamic items
        //    but we still need to normalise type strings from the backend
        if (!components.isNullOrEmpty()) {
            // Map backend type strings → our internal type strings
            val mapped = components.map { c ->
                val type = when (c.type.lowercase().trim()) {
                    "earning", "earnings", "allowance"    -> "earning"
                    "deduction", "deductions"             -> "deduction"
                    "gross", "gross_total", "total"       -> "total"
                    "deduction_total", "total_deductions" -> "deduction_total"
                    "net", "net_pay"                      -> "net"
                    else                                  -> c.type
                }
                PayComponent(c.name, c.amount, type)
            }
            // Check if the components already contain a net row
            val hasNet = mapped.any { it.type == "net" }
            list.addAll(mapped)
            if (!hasNet) list.add(PayComponent("Net Pay", effectiveNet, "net"))
            return list
        }

        // ── Fallback: build from flat fields ─────────────────────────────────
        // Earnings
        (basic ?: basicSalary)?.let { if (it > 0) list.add(PayComponent("Basic Salary",       it, "earning")) }
        hra?.let                     { if (it > 0) list.add(PayComponent("HRA",                it, "earning")) }
        conveyance?.let              { if (it > 0) list.add(PayComponent("Conveyance",         it, "earning")) }
        specialAllowance?.let        { if (it > 0) list.add(PayComponent("Other Allowance",    it, "earning")) }
        gratuity?.let                { if (it > 0) list.add(PayComponent("Gratuity",           it, "earning")) }
        if (list.isNotEmpty()) list.add(PayComponent("Gross Pay", effectiveGross, "total"))

        // PF Employer is an earning for Total Earning calculation (matches web)
        pfEmployer?.let              { if (it > 0) list.add(PayComponent("PF (Employer)",     it, "earning")) }
        if (list.isNotEmpty()) list.add(PayComponent("Total Earning", totalEarning, "total"))

        // Deductions
        pfEmployee?.let              { if (it > 0) list.add(PayComponent("PF (Employee)",     it, "deduction")) }
        esiEmployee?.let             { if (it > 0) list.add(PayComponent("ESI (Employee)",    it, "deduction")) }
        professionalTax?.let         { if (it > 0) list.add(PayComponent("Professional Tax",  it, "deduction")) }
        emiRecovery?.let             { if (it > 0) list.add(PayComponent("EMI Recovery",      it, "deduction")) }
        pfEmployer?.let              { if (it > 0) list.add(PayComponent("PF (Employer)",     it, "deduction")) }
        adminCharges?.let            { if (it > 0) list.add(PayComponent("Admin Charges",     it, "deduction")) }
        tds?.let                     { if (it > 0) list.add(PayComponent("TDS",               it, "deduction")) }
        lwf?.let                     { if (it > 0) list.add(PayComponent("LWF",               it, "deduction")) }
        if (effectiveDed > 0) list.add(PayComponent("Total Deductions", effectiveDed, "deduction_total"))

        list.add(PayComponent("Net Pay", effectiveNet, "net"))
        return list
    }
}

data class PayComponent(val name: String, val amount: Double, val type: String)
data class PayslipMonth(val month: Int, val year: Int, val status: String? = null)

// ── Announcements ─────────────────────────────────────────────────────────────
data class Announcement(
    val id: Int, val title: String, val content: String? = null, val type: String? = null,
    @SerializedName("created_at") val createdAt: String? = null,
    @SerializedName("image_url") val imageUrl: String? = null,
    @SerializedName("posted_by_name") val postedByName: String? = null,
    @SerializedName("created_by_name") val createdByName: String? = null,
    @SerializedName("posted_by_role") val postedByRole: String? = null,
    @SerializedName("created_by_role") val createdByRole: String? = null,
    @SerializedName("posted_by_designation") val postedByDesignation: String? = null,
    @SerializedName("created_by_designation") val createdByDesignation: String? = null,
    @SerializedName("posted_by_designation_id") val postedByDesignationId: Int? = null,
    @SerializedName("created_by_designation_id") val createdByDesignationId: Int? = null,
    @SerializedName("designation_title") val designationTitle: String? = null,
    @SerializedName("like_count") val likeCount: Int = 0,
    @SerializedName("i_liked") val iLiked: Boolean = false,
    @SerializedName("comment_count") val commentCount: Int = 0
) {
    val authorName get() = postedByName ?: createdByName ?: "HR"
    val authorRole get() = postedByRole ?: createdByRole

    // Designation title from any available field
    val authorDesignation: String? get() = designationTitle
        ?: postedByDesignation
        ?: createdByDesignation
        ?: designationFromId(postedByDesignationId ?: createdByDesignationId)

    // Map designation ID → title (matches your designation table)
    private fun designationFromId(id: Int?): String? = when (id) {
        1  -> "MD"
        2  -> "COO"
        3  -> "Assistant Manager"
        4  -> "MIS Executive"
        5  -> "Manager-Remote Sensing and GIS"
        6  -> "RS & Agriculture Analyst"
        7  -> "Content Writer"
        8  -> "Assistant Vice President (MIS)"
        9  -> "Assistant Vice President (Agri-Business)"
        10 -> "Manager- MIS"
        11 -> "Backend Operations Executive"
        12 -> "Assistant Manager Operations"
        13 -> "HR Executive"
        14 -> "Office Boy"
        15 -> "District Coordinator"
        16 -> "Cluster Head"
        17 -> "Manager"
        18 -> "State Head"
        19 -> "Cluster Coordinator"
        20 -> "Accountant Executive"
        else -> null
    }

    // Senior designation IDs that trigger notifications (MD, COO, AVP x2, HR Executive, Accountant Executive)
    companion object {
        val SENIOR_DESIGNATION_IDS = setOf(1, 2, 8, 9, 13, 20)
        val SENIOR_DESIGNATION_KEYWORDS = listOf("md", "coo", "avp", "vice president", "hr executive",
            "accountant", "manager", "state head", "tech manager")

        fun isSeniorDesignation(designationId: Int?, designationTitle: String?): Boolean {
            if (designationId != null && designationId in SENIOR_DESIGNATION_IDS) return true
            val title = designationTitle?.lowercase() ?: return false
            return SENIOR_DESIGNATION_KEYWORDS.any { title.contains(it) }
        }
    }
}

// ── Announcement Like & Comment models (Fix 1) ────────────────────────────────
data class AnnouncementLikeResult(
    val liked: Boolean,
    @SerializedName("like_count") val likeCount: Int = 0
)

data class AnnouncementComment(
    val id: Int,
    @SerializedName("announcement_id") val announcementId: Int,
    @SerializedName("employee_id") val employeeId: Int,
    val comment: String,
    @SerializedName("employee_name") val employeeName: String? = null,
    @SerializedName("employee_code") val employeeCode: String? = null,
    @SerializedName("created_at") val createdAt: String? = null
)

data class CommentRequest(val comment: String)

data class AnnouncementFeedData(
    val announcements: List<Announcement>? = null,
    val birthdays: List<BirthdayRecord>? = null,
    @SerializedName("upcoming_holidays") val upcomingHolidays: List<Holiday>? = null,
    @SerializedName("thought_of_day") val thoughtOfDay: ThoughtData? = null
)

data class ThoughtData(val text: String? = null, val author: String? = null)

// ── Notifications ─────────────────────────────────────────────────────────────
data class Notification(
    val id: Int, val title: String? = null, val message: String? = null, val type: String? = null,
    @SerializedName("is_read") val isRead: Boolean = false,
    @SerializedName("created_at") val createdAt: String? = null,
    @SerializedName("reference_id") val referenceId: Int? = null
)

// ── GK Quiz ───────────────────────────────────────────────────────────────────
data class GkQuestion(
    val id: Int,
    val question: String,
    @SerializedName("option_a") val optionA: String? = null,
    @SerializedName("option_b") val optionB: String? = null,
    @SerializedName("option_c") val optionC: String? = null,
    @SerializedName("option_d") val optionD: String? = null,
    @SerializedName("correct_answer") val correctAnswer: String? = null,
    @SerializedName("my_answer") val myAnswer: String? = null,
    @SerializedName("my_is_correct") val myIsCorrect: Boolean? = null,
    val category: String? = null,
    val about: String? = null
) {
    // Map option letter to text
    val options: List<Pair<String,String>> get() = listOfNotNull(
        optionA?.let { "A" to it },
        optionB?.let { "B" to it },
        optionC?.let { "C" to it },
        optionD?.let { "D" to it }
    )
    val alreadyAnswered get() = myAnswer != null
}
data class GkAnswerRequest(@SerializedName("question_id") val questionId: Int, val answer: String)  // answer = "A","B","C","D"
data class GkAnswerResult(
    @SerializedName("is_correct") val isCorrect: Boolean = false,
    @SerializedName("correct_answer") val correctAnswer: String? = null,
    @SerializedName("score_change") val scoreChange: Double = 0.0,
    val about: String? = null,
    // legacy
    val correct: Boolean = false,
    val points: Int = 0
) {
    val didCorrect get() = isCorrect || correct
    val pointsEarned get() = if (scoreChange != 0.0) scoreChange.toInt() else points
}
data class GkStats(
    // actual backend field names from getMyStats controller
    @SerializedName("total_score") val totalScore: Double? = null,
    val correct: Int? = null,
    val wrong: Int? = null,
    val skipped: Int? = null,
    val attempted: Int? = null,
    val streak: Int? = null,
    // legacy fallbacks
    val total: Int? = null,
    val points: Int? = null
) {
    val totalVal   get() = attempted ?: total ?: 0
    val correctVal get() = correct ?: 0
    val streakVal  get() = streak ?: 0
    val pointsVal  get() = totalScore?.let { if (it == it.toLong().toDouble()) it.toLong().toString() else String.format("%.2f", it) }
        ?: points?.toString() ?: "0"
}
data class LeaderboardEntry(
    val id: Int? = null,
    @SerializedName("first_name") val firstName: String? = null,
    @SerializedName("last_name")  val lastName: String? = null,
    @SerializedName("employee_code") val employeeCode: String? = null,
    @SerializedName("department_name") val departmentName: String? = null,
    // Use Any? + safe conversion because pg returns NUMERIC as String, COUNT as Long
    @SerializedName("total_score") val totalScoreRaw: Any? = null,
    @SerializedName("correct")     val correctRaw: Any? = null,
    @SerializedName("wrong")       val wrongRaw: Any? = null,
    @SerializedName("skipped")     val skippedRaw: Any? = null,
    @SerializedName("attempted")   val attemptedRaw: Any? = null,
    @SerializedName("is_me") val isMe: Boolean = false,
    val name: String? = null,
    val points: Int = 0,
    val rank: Int = 0
) {
    private fun Any?.toSafeDouble(): Double = when (this) {
        is Number -> this.toDouble()
        is String -> this.toDoubleOrNull() ?: 0.0
        else      -> 0.0
    }
    val totalScore get() = totalScoreRaw.toSafeDouble()
    val correct    get() = correctRaw.toSafeDouble().toInt()
    val wrong      get() = wrongRaw.toSafeDouble().toInt()
    val attempted  get() = attemptedRaw.toSafeDouble().toInt()
    val displayName get() = name ?: listOfNotNull(firstName, lastName).joinToString(" ").ifBlank { "Unknown" }
    val score get() = if (totalScore != 0.0) totalScore else points.toDouble()
    val scoreDisplay get() = if (score == score.toLong().toDouble()) "${score.toLong()}" else String.format("%.2f", score)
}
data class Thought(val text: String? = null, val author: String? = null, val category: String? = null)

// ── Birthdays ─────────────────────────────────────────────────────────────────
data class BirthdayRecord(
    // /birthdays/upcoming fields
    val id: Int? = null,
    @SerializedName("full_name") val fullName: String? = null,
    @SerializedName("employee_code") val employeeCode: String? = null,
    @SerializedName("department_name") val departmentName: String? = null,
    @SerializedName("designation_title") val designationTitle: String? = null,
    @SerializedName("birth_md") val birthMd: String? = null,           // "MM-DD"
    @SerializedName("birth_display") val birthDisplay: String? = null,  // "20 Mar"
    @SerializedName("days_until") val daysUntil: Int? = null,
    @SerializedName("like_count") val likeCount: Int = 0,
    @SerializedName("wish_count") val wishCount: Int = 0,
    @SerializedName("i_liked") val iLiked: Boolean = false,
    @SerializedName("i_wished") val iWished: Boolean = false,
    // feed /announcements/feed fields
    @SerializedName("first_name") val firstName: String? = null,
    @SerializedName("last_name") val lastName: String? = null,
    @SerializedName("date_of_birth") val dateOfBirth: String? = null,
    @SerializedName("birth_day") val birthDay: String? = null,          // "20-Mar"
    // legacy
    @SerializedName("employee_id") val employeeId: Int? = null,
    @SerializedName("employee_name") val employeeName: String? = null,
    @SerializedName("is_today") val isToday: Boolean = false,
    val likes: Int = 0,
    @SerializedName("user_liked") val userLiked: Boolean = false
) {
    val displayName get() = fullName
        ?: employeeName
        ?: listOfNotNull(firstName, lastName).joinToString(" ").ifBlank { null }
        ?: "Unknown"
    val isToday2 get() = isToday || daysUntil == 0
}

data class BirthdayLikeResult(val likes: Int, @SerializedName("user_liked") val userLiked: Boolean)
data class BirthdayWish(val id: Int, val message: String? = null, @SerializedName("from_name") val fromName: String? = null, @SerializedName("from_emp_id") val fromEmpId: Int? = null, @SerializedName("created_at") val createdAt: String? = null)

// ── Work Anniversaries ────────────────────────────────────────────────────────
data class AnniversaryRecord(
    val id: Int,
    @SerializedName("full_name")        val fullName: String? = null,
    @SerializedName("employee_code")    val employeeCode: String? = null,
    @SerializedName("department_name")  val departmentName: String? = null,
    @SerializedName("designation_title")val designationTitle: String? = null,
    @SerializedName("joining_date")     val joiningDate: String? = null,
    @SerializedName("join_md")          val joinMd: String? = null,
    @SerializedName("join_display")     val joinDisplay: String? = null,
    @SerializedName("days_until")       val daysUntil: Int? = null,
    @SerializedName("years_completed")  val yearsCompleted: Int = 0,
    @SerializedName("like_count")       val likeCount: Int = 0,
    @SerializedName("wish_count")       val wishCount: Int = 0,
    @SerializedName("i_liked")          val iLiked: Boolean = false,
    @SerializedName("i_wished")         val iWished: Boolean = false
) {
    val isToday get() = daysUntil == 0
    val displayName get() = fullName ?: "Employee"
}

// ── Holiday ───────────────────────────────────────────────────────────────────
data class Holiday(
    val id: Int? = null,
    val name: String,
    val date: String,
    val type: String? = null,
    val region: String? = null,
    val description: String? = null,
    val year: Int? = null
) {
    val isNational get() = region == "all" || type?.lowercase() == "national"
    val isPast get() = date < java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.getDefault()).format(java.util.Date())
}

// ── Separation ────────────────────────────────────────────────────────────────
@Parcelize
data class SeparationRecord(
    val id: Int,
    @SerializedName("employee_id")          val employeeId: Int? = null,
    @SerializedName("first_name")           val firstName: String? = null,
    @SerializedName("last_name")            val lastName: String? = null,
    @SerializedName("employee_code")        val employeeCode: String? = null,
    val type: String? = null,
    val reason: String? = null,
    val status: String? = null,
    @SerializedName("notice_date")          val noticeDate: String? = null,
    @SerializedName("last_working_date")    val lastWorkingDate: String? = null,
    @SerializedName("notice_period_days")   val noticePeriodDays: Int? = null,
    @SerializedName("manager_action")       val managerAction: String? = null,
    @SerializedName("manager_actioned_by")  val managerActionedBy: Int? = null,
    @SerializedName("manager_remarks")      val managerRemarks: String? = null,
    @SerializedName("hr_action")            val hrAction: String? = null,
    @SerializedName("hr_remarks")           val hrRemarks: String? = null,
    @SerializedName("accounts_action")      val accountsAction: String? = null,
    @SerializedName("accounts_remarks")     val accountsRemarks: String? = null,
    @SerializedName("admin_action")         val adminAction: String? = null,
    @SerializedName("admin_remarks")        val adminRemarks: String? = null,
    @SerializedName("created_at")           val createdAt: String? = null,
    @SerializedName("updated_at")           val updatedAt: String? = null
) : Parcelable {
    val employeeName get() = listOfNotNull(firstName, lastName).joinToString(" ").ifBlank { employeeCode ?: "—" }
    val effectiveDate get() = lastWorkingDate
}

data class SubmitResignationRequest(
    @SerializedName("reason")        val reason: String,
    @SerializedName("notice_date")   val noticeDate: String,
    @SerializedName("suggested_lwd") val suggestedLwd: String? = null
)

// ── Provision ─────────────────────────────────────────────────────────────────
@Parcelize
data class ProvisionEmployee(
    val id: Int,
    @SerializedName("first_name")          val firstName: String? = null,
    @SerializedName("last_name")           val lastName: String? = null,
    @SerializedName("employee_code")       val employeeCode: String? = null,
    @SerializedName("joining_date")        val joiningDate: String? = null,
    @SerializedName("provision_end_date")  val provisionEndDate: String? = null,
    @SerializedName("department_name")     val departmentName: String? = null,
    @SerializedName("designation_title")   val designationTitle: String? = null,
    @SerializedName("manager_name")        val managerName: String? = null,
    @SerializedName("days_remaining")      val daysRemaining: Int? = null,
    @SerializedName("confirmation_id")     val confirmationId: Int? = null,
    @SerializedName("overall_status")      val overallStatus: String? = null,
    @SerializedName("manager_status")      val managerStatus: String? = null,
    @SerializedName("hr_status")           val hrStatus: String? = null,
    @SerializedName("manager_approved_at") val managerApprovedAt: String? = null,
    @SerializedName("hr_approved_at")      val hrApprovedAt: String? = null,
    @SerializedName("initiated_at")        val initiatedAt: String? = null,
    @SerializedName("confirmed_date")      val confirmedDate: String? = null
) : Parcelable {
    val fullName get() = "${firstName.orEmpty()} ${lastName.orEmpty()}".trim().ifEmpty { "—" }
    val initials get() = "${firstName?.firstOrNull() ?: ""}${lastName?.firstOrNull() ?: ""}".uppercase().ifEmpty { "?" }
    val workflowStatus get() = overallStatus ?: "not_initiated"
}
// ── Geofence ──────────────────────────────────────────────────────────────────
data class GeofenceValidateRequest(
    val latitude: Double,
    val longitude: Double
)

data class GeofenceValidateResult(
    val valid: Boolean = false,
    val message: String? = null,
    @SerializedName("distance_meters") val distanceMeters: Int? = null,
    @SerializedName("location_name") val locationName: String? = null
)

data class MyGeofenceLocation(
    val id: Int,
    val name: String,
    val address: String? = null,
    val latitude: Double,
    val longitude: Double,
    @SerializedName("radius_meters") val radiusMeters: Int = 100,
    @SerializedName("is_universal") val isUniversal: Boolean = false
)

// ── Buffer Rules ──────────────────────────────────────────────────────────────
data class BufferRuleResponse(
    @SerializedName("employee_id") val employeeId: Int,
    @SerializedName("rule_type")   val ruleType: String,   // "office","state","district","universal"
    val state: String? = null,
    val district: String? = null,
    @SerializedName("employee_type") val employeeType: String? = null
)

data class ValidateBufferRequest(
    val latitude: Double,
    val longitude: Double
)

data class ValidateBufferResult(
    val valid: Boolean = false,
    val message: String? = null,
    @SerializedName("outside_boundary") val outsideBoundary: Boolean = false
)

data class BoundaryCoords(
    val district: String? = null,
    val coordinates: List<List<List<Double>>>  // [ring][point][lng,lat]
)

// ── Movement Tracking ─────────────────────────────────────────────────────────
data class MovementLogRequest(
    @SerializedName("lat")      val lat: Double,
    @SerializedName("lng")      val lng: Double,
    @SerializedName("accuracy") val accuracy: Float? = null,
    @SerializedName("is_od")    val isOd: Boolean = false   // true when employee is on OD
)

// ── Movement Tracking ─────────────────────────────────────────────────────────
data class MovementSummaryRow(
    @SerializedName("employee_id")   val employeeId: Int,
    @SerializedName("employee_code") val employeeCode: String,
    @SerializedName("emp_name")      val empName: String,
    @SerializedName("date")          val date: String,
    @SerializedName("point_count")   val pointCount: Int,
    @SerializedName("total_km")      val totalKm: Double
)

data class MovementPoint(
    val id: Int,
    val lat: Double,
    val lng: Double,
    val accuracy: Float?,
    @SerializedName("time_label") val timeLabel: String,
    @SerializedName("logged_at")  val loggedAt: String
)
// ── Form 16 ───────────────────────────────────────────────────────────────────
data class Form16Response(
    val success: Boolean,
    val data: Form16Data? = null,
    val message: String? = null
)
data class Form16Data(
    val employee: Form16Employee,
    @SerializedName("financial_year")  val financialYear: String,
    @SerializedName("assessment_year") val assessmentYear: String,
    @SerializedName("part_a")          val partA: Form16PartA,
    @SerializedName("part_b")          val partB: Form16PartB,
    @SerializedName("monthly_breakdown") val monthlyBreakdown: List<Form16Month>
)
data class Form16Employee(
    val name: String, val code: String, val pan: String? = null,
    val uan: String? = null, @SerializedName("pf_number") val pfNumber: String? = null,
    val department: String? = null, val designation: String? = null
)
data class Form16PartA(
    @SerializedName("employer_name") val employerName: String,
    @SerializedName("employer_tan")  val employerTan: String,
    @SerializedName("financial_year") val financialYear: String,
    @SerializedName("assessment_year") val assessmentYear: String,
    @SerializedName("total_tds_deducted")  val totalTdsDeducted: Double,
    @SerializedName("total_tds_deposited") val totalTdsDeposited: Double,
    @SerializedName("quarter_summary") val quarterSummary: List<QuarterSummary>
)
data class QuarterSummary(
    val quarter: String,
    @SerializedName("tds_deducted")  val tdsDeducted: Double,
    @SerializedName("tds_deposited") val tdsDeposited: Double
)
data class Form16PartB(
    val basic: Double = 0.0, val hra: Double = 0.0, val conveyance: Double = 0.0,
    @SerializedName("special_allowance")     val specialAllowance: Double = 0.0,
    @SerializedName("gross_salary")          val grossSalary: Double = 0.0,
    @SerializedName("standard_deduction")    val standardDeduction: Double = 0.0,
    @SerializedName("income_chargeable")     val incomeChargeable: Double = 0.0,
    @SerializedName("sec_80c_pf")            val sec80cPf: Double = 0.0,
    @SerializedName("total_deductions_vi_a") val totalDeductionsViA: Double = 0.0,
    @SerializedName("net_taxable_income")    val netTaxableIncome: Double = 0.0,
    @SerializedName("total_tds")             val totalTds: Double = 0.0,
    @SerializedName("pf_employee_total")     val pfEmployeeTotal: Double = 0.0,
    @SerializedName("pf_employer_total")     val pfEmployerTotal: Double = 0.0,
    @SerializedName("esi_employee_total")    val esiEmployeeTotal: Double = 0.0,
    @SerializedName("professional_tax_total") val professionalTaxTotal: Double = 0.0,
    @SerializedName("lwf_total")             val lwfTotal: Double = 0.0,         // FIX: added — web shows LWF row
    @SerializedName("net_salary_total")      val netSalaryTotal: Double = 0.0
)
data class Form16Month(
    val month: String, val year: Int, val gross: Double = 0.0,
    val basic: Double = 0.0, val hra: Double = 0.0,
    @SerializedName("pf_employee") val pfEmployee: Double = 0.0,
    @SerializedName("esi_employee") val esiEmployee: Double = 0.0,
    @SerializedName("professional_tax") val professionalTax: Double = 0.0,
    val lwf: Double = 0.0,                                                       // FIX: added — web shows LWF column
    val tds: Double = 0.0, @SerializedName("net_salary") val netSalary: Double = 0.0
)
data class Form16YearsResponse(val success: Boolean, val data: List<String> = emptyList())

// ── IT Declaration ────────────────────────────────────────────────────────────
data class ITDeclaration(
    val id: Int? = null,
    @SerializedName("employee_id")       val employeeId: Int? = null,
    @SerializedName("financial_year")    val financialYear: String = "",
    val regime: String = "old",
    @SerializedName("rent_paid_monthly") val rentPaidMonthly: Double = 0.0,
    @SerializedName("landlord_name")     val landlordName: String? = null,
    @SerializedName("landlord_pan")      val landlordPan: String? = null,
    @SerializedName("sec80c_pf")         val sec80cPf: Double = 0.0,
    @SerializedName("sec80c_ppf")        val sec80cPpf: Double = 0.0,
    @SerializedName("sec80c_lic")        val sec80cLic: Double = 0.0,
    @SerializedName("sec80c_elss")       val sec80cElss: Double = 0.0,
    @SerializedName("sec80c_nsc")        val sec80cNsc: Double = 0.0,
    @SerializedName("sec80c_home_loan")  val sec80cHomeLoan: Double = 0.0,
    @SerializedName("sec80c_tuition")    val sec80cTuition: Double = 0.0,
    @SerializedName("sec80c_other")      val sec80cOther: Double = 0.0,
    @SerializedName("sec80d_self")       val sec80dSelf: Double = 0.0,
    @SerializedName("sec80d_parents")    val sec80dParents: Double = 0.0,
    @SerializedName("sec80e_edu_loan")   val sec80eEduLoan: Double = 0.0,
    @SerializedName("sec24b_home_loan")  val sec24bHomeLoan: Double = 0.0,
    @SerializedName("sec80g_donation")   val sec80gDonation: Double = 0.0,
    @SerializedName("sec80ccd_nps")      val sec80ccdNps: Double = 0.0,
    @SerializedName("total_80c")         val total80c: Double = 0.0,
    @SerializedName("total_deductions")  val totalDeductions: Double = 0.0,
    val status: String = "draft",
    @SerializedName("hr_comment")        val hrComment: String? = null,
    @SerializedName("submitted_at")      val submittedAt: String? = null,
    @SerializedName("proof_documents")   val proofDocuments: List<ITProofDoc>? = null
)
data class ITProofDoc(
    val id: Int, val section: String,
    @SerializedName("section_label") val sectionLabel: String? = null,
    @SerializedName("original_name") val originalName: String? = null,
    @SerializedName("mime_type")     val mimeType: String? = null,
    @SerializedName("file_size")     val fileSize: Int? = null,
    val status: String = "pending",
    @SerializedName("hr_comment")    val hrComment: String? = null,
    @SerializedName("uploaded_at")   val uploadedAt: String? = null
)
data class ITDeclarationResponse(
    val success: Boolean, val data: ITDeclaration? = null, val message: String? = null
)

// Summary model used in HR Review list (getAllITDeclarations)
data class ITDeclarationSummary(
    val id: Int,
    @SerializedName("employee_id")     val employeeId: Int,
    @SerializedName("employee_name")   val employeeName: String? = null,
    @SerializedName("financial_year")  val financialYear: String = "",
    val regime: String? = null,
    val status: String = "draft",
    @SerializedName("total_deductions") val totalDeductions: Double? = null,
    @SerializedName("proof_count")     val proofCount: Int? = null,
    @SerializedName("hr_comment")      val hrComment: String? = null,
    @SerializedName("submitted_at")    val submittedAt: String? = null
)
data class TaxPreviewResponse(
    val success: Boolean, val data: TaxPreviewData? = null, val message: String? = null
)
data class TaxPreviewData(
    @SerializedName("annual_gross")  val annualGross: Double = 0.0,
    @SerializedName("std_deduction") val stdDeduction: Double = 0.0,
    @SerializedName("hra_exemption") val hraExemption: Double = 0.0,
    @SerializedName("total_vi_a")    val totalViA: Double = 0.0,
    @SerializedName("old_regime")    val oldRegime: TaxRegimeData,
    @SerializedName("new_regime")    val newRegime: TaxRegimeData,
    val recommended: String = "old"
)
data class TaxRegimeData(
    @SerializedName("taxable_income") val taxableIncome: Double = 0.0,
    val tax: Double = 0.0,
    @SerializedName("monthly_tds")    val monthlyTds: Double = 0.0
)
// ── Geofence Admin ────────────────────────────────────────────────────────────
data class GeofenceLocation(
    val id: Int,
    val name: String,
    val address: String? = null,
    val latitude: Double,
    val longitude: Double,
    @SerializedName("radius_meters") val radiusMeters: Int = 100,
    val city: String? = null,
    val state: String? = null
)

data class GeofenceEmployeeRow(
    val id: Int,
    @SerializedName("first_name")            val firstName: String? = null,
    @SerializedName("last_name")             val lastName: String? = null,
    @SerializedName("employee_code")         val employeeCode: String? = null,
    @SerializedName("employee_type")         val employeeType: String? = null,
    @SerializedName("rule_type")             val ruleType: String? = null,      // "office","universal","state","district"
    val state: String? = null,
    val district: String? = null,
    @SerializedName("office_location_id")    val officeLocationId: Int? = null,
    @SerializedName("office_location_name")  val officeLocationName: String? = null
) {
    val fullName: String get() = listOfNotNull(firstName, lastName).joinToString(" ").ifBlank { "Unknown" }
    val currentRule: String get() = ruleType ?: "universal"
    val assignment: String get() = when {
        ruleType == "office" && officeLocationName != null -> officeLocationName
        ruleType == "state"  && state != null              -> "State – $state"
        ruleType == "district" && district != null         -> "$district, $state"
        else                                               -> "Anywhere"
    }
}
// ── Comp Off ──────────────────────────────────────────────────────────────────
data class CompOffBalanceResponse(
    val success: Boolean,
    val data: CompOffBalanceData? = null
)

data class CompOffBalanceData(
    val available: Double = 0.0,
    @SerializedName("total_credited") val totalCredited: Double = 0.0,
    val used: Double = 0.0,
    val credits: List<CompOffCredit> = emptyList()
)

data class CompOffCredit(
    val id: Int,
    @SerializedName("employee_id") val employeeId: Int,
    @SerializedName("worked_date") val workedDate: String? = null,
    @SerializedName("worked_type") val workedType: String? = null,   // "holiday" | "weekend"
    @SerializedName("holiday_name") val holidayName: String? = null,
    @SerializedName("days_credited") val daysCredited: Double = 1.0,
    val status: String = "available",                                  // "available" | "used" | "expired"
    @SerializedName("expiry_date") val expiryDate: String? = null,
    val remarks: String? = null,
    @SerializedName("granted_by_name") val grantedByName: String? = null,
    @SerializedName("created_at") val createdAt: String? = null
)

data class CompOffCreditsResponse(
    val success: Boolean,
    val data: List<CompOffCredit> = emptyList()
)
// ── Reimbursement ─────────────────────────────────────────────────────────────
@Parcelize
data class ReimbursementItem(
    val id: Int = 0,
    @SerializedName("reimbursement_id") val reimbursementId: Int = 0,
    val category: String = "",
    val description: String? = null,
    val amount: Double = 0.0,
    @SerializedName("approved_amount") val approvedAmount: Double? = null,
    @SerializedName("expense_date") val expenseDate: String = "",
    @SerializedName("attachment_name") val attachmentName: String? = null,
    @SerializedName("attachment_mime") val attachmentMime: String? = null,
    @SerializedName("attachment_size") val attachmentSize: Long? = null,
    @SerializedName("has_attachment") val hasAttachment: Boolean = false
) : Parcelable

@Parcelize
data class ReimbursementApplication(
    val id: Int,
    val title: String,
    val status: String,
    @SerializedName("total_amount") val totalAmount: Double,
    @SerializedName("approved_amount") val approvedAmount: Double? = null,
    @SerializedName("employee_id") val employeeId: Int? = null,
    @SerializedName("employee_name") val employeeName: String? = null,
    @SerializedName("employee_code") val employeeCode: String? = null,
    @SerializedName("department_name") val departmentName: String? = null,
    @SerializedName("current_approver_code") val currentApproverCode: String? = null,
    @SerializedName("current_level") val currentLevel: Int? = null,
    @SerializedName("approval_chain") val approvalChain: List<String>? = null,
    @SerializedName("requested_at") val requestedAt: String? = null,
    @SerializedName("approved_at") val approvedAt: String? = null,
    @SerializedName("disbursed_at") val disbursedAt: String? = null,
    val remarks: String? = null,
    val items: List<ReimbursementItem> = emptyList()
) : Parcelable
// ── Project Models ─────────────────────────────────────────────────────────────
data class Project(
    val id: Int,
    val name: String,
    val code: String? = null,
    @SerializedName("client_name") val clientName: String? = null,
    val status: String = "active",
    @SerializedName("total_budget") val totalBudget: Double = 0.0,
    @SerializedName("planned_cost") val plannedCost: Double = 0.0,
    @SerializedName("actual_cost") val actualCost: Double = 0.0,
    @SerializedName("salary_cost") val salaryCost: Double = 0.0,
    @SerializedName("advance_cost") val advanceCost: Double = 0.0,
    @SerializedName("reimbursement_cost") val reimbursementCost: Double = 0.0,
    @SerializedName("employee_count") val employeeCount: Int = 0,
    @SerializedName("project_manager_name") val projectManagerName: String? = null,
    @SerializedName("start_date") val startDate: String? = null,
    @SerializedName("end_date") val endDate: String? = null
)

data class ProjectSummary(
    @SerializedName("total_projects") val totalProjects: Int = 0,
    @SerializedName("active_projects") val activeProjects: Int = 0,
    @SerializedName("total_budget") val totalBudget: Double = 0.0,
    @SerializedName("total_planned") val totalPlanned: Double = 0.0,
    @SerializedName("total_actual") val totalActual: Double = 0.0,
    @SerializedName("total_salary") val totalSalary: Double = 0.0,
    @SerializedName("total_advance") val totalAdvance: Double = 0.0,
    @SerializedName("total_reimbursement") val totalReimbursement: Double = 0.0
)

// ── Chat ──────────────────────────────────────────────────────────────────────
@Parcelize
data class ChatGroup(
    val id: Int,
    val name: String? = null,
    val type: String = "group",
    @SerializedName("avatar_url")    val avatarUrl: String? = null,
    @SerializedName("dm_peer_id")    val dmPeerId: Int? = null,
    @SerializedName("dm_peer_name")  val dmPeerName: String? = null,
    @SerializedName("dm_peer_photo") val dmPeerPhoto: String? = null,
    @SerializedName("last_message_type") val lastMessageType: String? = null,
    @SerializedName("unread_count")  val unreadCount: Int = 0,
    @SerializedName("last_message")  val lastMessage: String? = null,
    @SerializedName("last_message_at") val lastMessageAt: String? = null,
    @SerializedName("member_count")  val memberCount: Int = 0,
    @SerializedName("created_by")    val createdBy: Int? = null,
    @SerializedName("is_online")     val isOnline: Boolean = false,
    @SerializedName("last_seen")     val lastSeen: String? = null
) : Parcelable {
    val displayName get() = if (type == "dm") (dmPeerName ?: "DM") else (name ?: "Group")
    val isDM get() = type == "dm"
}

@Parcelize
data class ChatMessage(
    val id: Int,
    @SerializedName("group_id")      val groupId: Int,
    @SerializedName("sender_id")     val senderId: Int,
    @SerializedName("sender_name")   val senderName: String? = null,
    @SerializedName("sender_photo")  val senderPhoto: String? = null,
    val content: String? = null,
    @SerializedName("message_type")  val messageType: String = "text",
    @SerializedName("file_url")      val fileUrl: String? = null,
    @SerializedName("file_name")     val fileName: String? = null,
    @SerializedName("file_mime")     val fileMime: String? = null,
    @SerializedName("file_size")     val fileSize: Long? = null,
    @SerializedName("created_at")    val createdAt: String? = null,
    @SerializedName("updated_at")    val updatedAt: String? = null,
    val status: String? = null,
    @SerializedName("is_deleted")    val isDeleted: Boolean = false,
    @SerializedName("reply_to_id")   val replyToId: Int? = null,
    @SerializedName("reply_preview") val replyPreview: String? = null
) : Parcelable

@Parcelize
data class ScheduledMeeting(
    val id: Int,
    val title: String,
    val agenda: String? = null,
    @SerializedName("scheduled_at") val scheduledAt: String? = null,
    @SerializedName("group_id")     val groupId: Int? = null,
    @SerializedName("group_name")   val groupName: String? = null,
    @SerializedName("created_by")   val createdBy: Int? = null,
    @SerializedName("creator_name") val creatorName: String? = null,
    @SerializedName("created_at")   val createdAt: String? = null
) : Parcelable

@Parcelize
data class GroupMember(
    val id: Int,
    @SerializedName("employee_id")   val employeeId: Int,
    @SerializedName("employee_name") val employeeName: String? = null,
    @SerializedName("employee_code") val employeeCode: String? = null,
    val role: String? = null,
    @SerializedName("is_online")     val isOnline: Boolean = false
) : Parcelable

data class PresenceRecord(
    @SerializedName("employee_id") val employeeId: Int,
    @SerializedName("is_online")   val isOnline: Boolean = false,
    @SerializedName("last_seen")   val lastSeen: String? = null
)

data class SendMessageRequest(
    val content: String,
    @SerializedName("message_type") val messageType: String = "text",
    @SerializedName("reply_to_id")  val replyToId: Int? = null
)

data class CreateGroupRequest(
    val name: String? = null,
    val type: String = "group",
    @SerializedName("member_ids") val memberIds: List<Int>
)

data class ScheduleMeetingRequest(
    val title: String,
    val agenda: String? = null,
    @SerializedName("scheduled_at") val scheduledAt: String,
    @SerializedName("group_id")     val groupId: Int? = null
)

data class UpdatePresenceRequest(
    @SerializedName("is_online") val isOnline: Boolean
)
data class CallLogEntry(
    val id: Int,
    @SerializedName("room_id")          val roomId: String,
    @SerializedName("call_type")        val callType: String,
    @SerializedName("caller_id")        val callerId: Int?,
    @SerializedName("callee_id")        val calleeId: Int?,
    @SerializedName("caller_name")      val callerName: String?,
    @SerializedName("callee_name")      val calleeName: String?,
    @SerializedName("caller_avatar")    val callerAvatar: String?,
    @SerializedName("callee_avatar")    val calleeAvatar: String?,
    @SerializedName("started_at")       val startedAt: String?,
    @SerializedName("ended_at")         val endedAt: String?,
    @SerializedName("duration_seconds") val durationSeconds: Int?,
    val status: String?
)

data class CallLogEventRequest(
    @SerializedName("room_id")   val roomId: String,
    @SerializedName("call_type") val callType: String = "audio",
    @SerializedName("caller_id") val callerId: Int?,
    @SerializedName("callee_id") val calleeId: Int?,
    @SerializedName("group_id")  val groupId: Int? = null,
    val status: String = "missed"
)

// ── Movement Alerts (#10) ─────────────────────────────────────────────────────
data class MovementAlert(
    val id: Int,
    @SerializedName("employee_id")   val employeeId: Int,
    @SerializedName("emp_name")      val empName: String? = null,
    @SerializedName("employee_code") val employeeCode: String? = null,
    @SerializedName("alert_date")    val alertDate: String,
    @SerializedName("alert_type")    val alertType: String,  // silence|low_battery|gps_off|net_off
    val message: String,
    val status: String,  // open|resolved|auto_resolved
    @SerializedName("mins_since_last_ping") val minsSinceLastPing: Int? = null,
    @SerializedName("last_ping_time")       val lastPingTime: String? = null,
    @SerializedName("notified_at")          val notifiedAt: String? = null
) {
    val alertEmoji get() = when(alertType) {
        "silence"     -> "📵"
        "low_battery" -> "🔋"
        "gps_off"     -> "📍"
        "net_off"     -> "📶"
        else          -> "⚠️"
    }
    val alertLabel get() = when(alertType) {
        "silence"     -> "Tracking Silent"
        "low_battery" -> "Low Battery"
        "gps_off"     -> "GPS Off"
        "net_off"     -> "No Internet"
        else          -> "Alert"
    }
}

// ── Beat Plan / PJP (#7) ──────────────────────────────────────────────────────
data class BeatPlanStop(
    val id: Int = 0,
    val sequence: Int,
    @SerializedName("location_name")    val locationName: String,
    val address: String? = null,
    val lat: Double? = null,
    val lng: Double? = null,
    val notes: String? = null,
    @SerializedName("expected_arrival") val expectedArrival: String? = null,
    @SerializedName("visit_status")     val visitStatus: String? = null,  // pending|visited|missed
    val visited: Boolean? = null,
    @SerializedName("nearest_dist_m")   val nearestDistM: Int? = null,
    @SerializedName("nearest_time")     val nearestTime: String? = null
)

data class BeatPlan(
    val id: Int,
    @SerializedName("employee_id")   val employeeId: Int,
    @SerializedName("emp_name")      val empName: String? = null,
    @SerializedName("employee_code") val employeeCode: String? = null,
    @SerializedName("plan_date")     val planDate: String,
    val title: String? = null,
    val notes: String? = null,
    @SerializedName("stop_count")    val stopCount: Int? = null,
    @SerializedName("has_actual_data") val hasActualData: Boolean? = null,
    val stops: List<BeatPlanStop>? = null
)

data class BeatPlanCompare(
    val plan: BeatPlan?,
    val stops: List<BeatPlanStop>,
    @SerializedName("actual_points") val actualPoints: List<MovementPoint>,
    val summary: BeatPlanSummary?
)

data class BeatPlanSummary(
    @SerializedName("planned_stops")  val plannedStops: Int,
    @SerializedName("visited_stops")  val visitedStops: Int,
    @SerializedName("missed_stops")   val missedStops: Int,
    @SerializedName("coverage_pct")   val coveragePct: Int?,
    @SerializedName("actual_points")  val actualPoints: Int
)
