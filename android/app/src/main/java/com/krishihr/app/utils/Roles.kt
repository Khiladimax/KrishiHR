package com.krishihr.app.utils
import com.krishihr.app.AndroidMain

object Roles {
    const val SUPER_ADMIN = "super_admin"
    const val ADMIN       = "admin"
    const val HR          = "hr"
    const val ACCOUNTS    = "accounts"
    const val MANAGER     = "manager"
    const val TL          = "tl"
    const val EMPLOYEE    = "employee"

    val ALL              = setOf(SUPER_ADMIN, ADMIN, HR, ACCOUNTS, MANAGER, TL, EMPLOYEE)
    // IS_APPROVER: roles that can SEE approval menus (team today, regularizations etc)
    val IS_APPROVER      = setOf(MANAGER, TL)   // ONLY reporting manager/TL can approve
    val CAN_MANAGE_EMP   = setOf(HR, ACCOUNTS, ADMIN, SUPER_ADMIN)
    val CAN_RUN_PAYROLL  = setOf(ACCOUNTS, SUPER_ADMIN, ADMIN)
    val CAN_SEE_SEP      = setOf(HR, ACCOUNTS, ADMIN, SUPER_ADMIN, MANAGER, TL, EMPLOYEE)
    val CAN_SEE_PROVISION= setOf(HR, ADMIN, SUPER_ADMIN, MANAGER, TL)
    val ADMIN_ROLES      = setOf(ADMIN, SUPER_ADMIN, HR, ACCOUNTS)
    // Geofence: only admin and super_admin
    val CAN_SEE_GEOFENCE = setOf(ADMIN, SUPER_ADMIN)

    // Leave/Attendance/OD/WFH: ONLY reporting manager or TL can approve
    // HR can approve ONLY if HR is the reporting manager (backend enforces this)
    fun canApproveLeave(role: String)       = role in setOf(MANAGER, TL)
    fun canApproveAttendance(role: String)  = role in setOf(MANAGER, TL)
    fun canManageEmployees(role: String)    = role in CAN_MANAGE_EMP
    fun canRunPayroll(role: String)         = role in CAN_RUN_PAYROLL
    fun canSeeSeparation(role: String)      = role in CAN_SEE_SEP
    fun canSeeProvision(role: String)       = role in CAN_SEE_PROVISION
    fun isAdmin(role: String)               = role in ADMIN_ROLES
    fun canApproveAdvance(role: String)     = role in IS_APPROVER  // advance chain handled by backend
    fun canSeeGeofence(role: String)        = role in CAN_SEE_GEOFENCE

    // Notice periods (matches backend separationController.js)
    fun getNoticeDays(role: String): Int = when (role) {
        SUPER_ADMIN, ADMIN, HR, ACCOUNTS -> AndroidMain.NOTICE_DAYS_SENIOR
        MANAGER                          -> AndroidMain.NOTICE_DAYS_MANAGER
        TL, EMPLOYEE                     -> AndroidMain.NOTICE_DAYS_DEFAULT
        else                             -> AndroidMain.NOTICE_DAYS_DEFAULT
    }
}