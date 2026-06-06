package com.krishihr.app.data.api

import com.krishihr.app.data.models.*
import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.Response
import retrofit2.http.*

interface ApiService {

    // ── Auth ──────────────────────────────────────────────────────────────────
    @POST("auth/login")
    suspend fun login(@Body request: LoginRequest): Response<LoginResponse>

    @POST("auth/refresh")
    suspend fun refreshToken(@Body body: Map<String, String>): Response<ApiResponse<TokenData>>

    @GET("auth/me")
    suspend fun getMe(): Response<ApiResponse<Employee>>

    @POST("auth/change-password")
    suspend fun changePassword(@Body request: ChangePasswordRequest): Response<ApiResponse<Unit>>

    @POST("auth/update-photo")
    suspend fun updatePhoto(@Body body: Map<String, String>): Response<ApiResponse<Employee>>

    @Multipart
    @POST("auth/update-photo")
    suspend fun updatePhotoMultipart(@Part photo: MultipartBody.Part): Response<ApiResponse<Employee>>

    @POST("auth/forgot-password/verify")
    suspend fun forgotVerify(@Body request: ForgotVerifyRequest): Response<ApiResponse<ForgotVerifyData>>

    @POST("auth/forgot-password/verify-pan")
    suspend fun forgotVerifyPan(@Body request: ForgotVerifyPanRequest): Response<ApiResponse<ResetTokenData>>

    @POST("auth/forgot-password/reset")
    suspend fun forgotReset(@Body request: ForgotResetRequest): Response<ApiResponse<Unit>>

    // ── Dashboard ─────────────────────────────────────────────────────────────
    @GET("dashboard")
    suspend fun getDashboard(): Response<ApiResponse<DashboardData>>

    // ── Employees ─────────────────────────────────────────────────────────────
    @GET("employees")
    suspend fun getEmployees(@Query("search") search: String? = null): Response<ApiResponse<List<Employee>>>

    @GET("employees/{id}")
    suspend fun getEmployee(@Path("id") id: Int): Response<ApiResponse<Employee>>

    @POST("employees")
    suspend fun createEmployee(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<ApiResponse<Employee>>

    @PUT("employees/{id}")
    suspend fun updateEmployee(@Path("id") id: Int, @Body body: Map<String, @JvmSuppressWildcards Any?>): Response<ApiResponse<Employee>>

    @POST("employees/reset-password")
    suspend fun resetEmployeePassword(@Body body: Map<String, @JvmSuppressWildcards Any>): Response<ApiResponse<Unit>>

    @GET("departments")
    suspend fun getDepartments(): Response<ApiResponse<List<Department>>>

    @GET("designations")
    suspend fun getDesignations(): Response<ApiResponse<List<Designation>>>

    // ── Attendance ────────────────────────────────────────────────────────────
    @POST("attendance/punch-in")
    suspend fun punchIn(@Body request: PunchRequest): Response<ApiResponse<Unit>>

    @POST("attendance/punch-out")
    suspend fun punchOut(@Body request: PunchRequest): Response<ApiResponse<Unit>>

    @POST("geofence/validate")
    suspend fun validateGeofence(@Body request: GeofenceValidateRequest): Response<ApiResponse<GeofenceValidateResult>>

    @GET("geofence/my-locations")
    suspend fun getMyGeofenceLocations(): Response<ApiResponse<List<MyGeofenceLocation>>>

    // ── Buffer Rules ──────────────────────────────────────────────────────────
    @GET("geofence/buffer-rules/{employeeId}")
    suspend fun getBufferRule(@Path("employeeId") employeeId: Int): Response<ApiResponse<BufferRuleResponse>>

    @POST("geofence/validate-buffer")
    suspend fun validateBuffer(@Body request: ValidateBufferRequest): Response<ValidateBufferResult>

    @GET("geofence/boundary")
    suspend fun getBoundary(
        @Query("state") state: String,
        @Query("district") district: String? = null
    ): Response<ApiResponse<BoundaryCoords>>

    @GET("geofence/boundary")
    suspend fun getStateBoundary(
        @Query("state") state: String
    ): Response<ApiResponse<List<BoundaryCoords>>>

    // ── Geofence Admin ────────────────────────────────────────────────────────
    @GET("geofence/locations")
    suspend fun getGeofenceLocations(): Response<ApiResponse<List<GeofenceLocation>>>

    @GET("geofence/buffer-rules")
    suspend fun getAllBufferRules(): Response<ApiResponse<List<GeofenceEmployeeRow>>>

    @POST("geofence/buffer-rules")
    suspend fun saveGeofenceRule(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<ApiResponse<Unit>>

    @GET("attendance")
    suspend fun getAttendance(
        @Query("month") month: Int? = null,
        @Query("year") year: Int? = null,
        @Query("employee_id") employeeId: Int? = null
    ): Response<ApiResponse<List<AttendanceRecord>>>

    @GET("attendance/summary")
    suspend fun getAttendanceSummary(
        @Query("month") month: Int? = null,
        @Query("year") year: Int? = null
    ): Response<ApiResponse<AttendanceSummary>>

    @GET("attendance/team-today")
    suspend fun getTeamToday(): Response<ApiResponse<List<TeamTodayRecord>>>

    @GET("attendance/regularizations")
    suspend fun getRegularizations(@Query("status") status: String? = null): Response<ApiResponse<List<RegularizationItem>>>

    @POST("attendance/regularize")
    suspend fun requestRegularization(@Body request: RegularizationRequest): Response<ApiResponse<Unit>>

    @POST("attendance/regularize/action")
    suspend fun actionRegularization(@Body body: Map<String, @JvmSuppressWildcards Any>): Response<ApiResponse<Unit>>

    @POST("attendance/od")
    suspend fun applyOD(@Body request: ODRequest): Response<ApiResponse<Unit>>

    @GET("attendance/od")
    suspend fun getODRequests(@Query("status") status: String? = null): Response<ApiResponse<List<ODApprovalItem>>>

    @POST("attendance/od/{id}/action")
    suspend fun actionOD(@Path("id") id: Int, @Body request: ActionRequest): Response<ApiResponse<Unit>>

    @POST("attendance/wfh")
    suspend fun applyWFH(@Body request: WFHRequest): Response<ApiResponse<Unit>>

    @GET("attendance/wfh")
    suspend fun getWFHRequests(@Query("status") status: String? = null): Response<ApiResponse<List<WFHApprovalItem>>>

    @GET("attendance/od")
    suspend fun getMyODRequests(@Query("status") status: String? = null): Response<ApiResponse<List<LeaveApplication>>>

    @GET("attendance/wfh")
    suspend fun getMyWFHRequests(@Query("status") status: String? = null): Response<ApiResponse<List<LeaveApplication>>>

    @POST("attendance/wfh/{id}/action")
    suspend fun actionWFH(@Path("id") id: Int, @Body request: ActionRequest): Response<ApiResponse<Unit>>

    // ── Leave ─────────────────────────────────────────────────────────────────
    @GET("leave-types")
    suspend fun getLeaveTypes(): Response<ApiResponse<List<LeaveType>>>

    @POST("leave/apply")
    suspend fun applyLeave(@Body request: LeaveRequest): Response<ApiResponse<Unit>>

    @GET("leave/requests")
    suspend fun getLeaveRequests(
        @Query("status") status: String? = null,
        @Query("employee_id") employeeId: Int? = null
    ): Response<ApiResponse<List<LeaveApplication>>>

    @GET("leave/applications")
    suspend fun getLeaveApplications(
        @Query("status") status: String? = null,
        @Query("employee_id") employeeId: Int? = null
    ): Response<ApiResponse<List<LeaveApplication>>>

    @GET("leave/balance")
    suspend fun getLeaveBalance(): Response<LeaveBalanceResponse>

    @POST("leave/{id}/action")
    suspend fun leaveAction(@Path("id") id: Int, @Body request: ActionRequest): Response<ApiResponse<Unit>>

    @PUT("leave/{id}/action")
    suspend fun leaveActionPut(@Path("id") id: Int, @Body request: ActionRequest): Response<ApiResponse<Unit>>

    @POST("leave/{id}/cancel")
    suspend fun cancelLeave(@Path("id") id: Int): Response<ApiResponse<Unit>>

    @POST("leave/{id}/revoke")
    suspend fun revokeLeave(@Path("id") id: Int): Response<ApiResponse<Unit>>

    // ── Comp Off ──────────────────────────────────────────────────────────────
    @GET("compoff/balance")
    suspend fun getCompOffBalance(): Response<CompOffBalanceResponse>

    @GET("compoff/credits")
    suspend fun getCompOffCredits(): Response<CompOffCreditsResponse>

    // ── Advance ───────────────────────────────────────────────────────────────
    @POST("advance/apply")
    suspend fun applyAdvance(@Body request: AdvanceRequest): Response<ApiResponse<Unit>>

    @GET("advance")
    suspend fun getAdvances(): Response<ApiResponse<List<AdvanceApplication>>>

    @GET("advance")
    suspend fun getAdvancesForApproval(@Query("all") all: Boolean = true): Response<ApiResponse<List<AdvanceApplication>>>

    @POST("advance/{id}/action")
    suspend fun advanceAction(@Path("id") id: Int, @Body request: ActionRequest): Response<ApiResponse<Unit>>

    @POST("advance/{id}/revoke")
    suspend fun revokeAdvance(@Path("id") id: Int): Response<ApiResponse<Unit>>

    @POST("advance/{id}/edit")
    suspend fun editAdvance(@Path("id") id: Int, @Body request: AdvanceEditRequest): Response<ApiResponse<Unit>>

    @POST("advance/{id}/process-payment")
    suspend fun processAdvancePayment(@Path("id") id: Int): Response<ApiResponse<Unit>>

    // ── Payroll ───────────────────────────────────────────────────────────────
    @GET("payroll/payslip")
    suspend fun getPayslip(@Query("month") month: Int, @Query("year") year: Int): Response<ApiResponse<Payslip>>

    @GET("my/payslip")
    suspend fun getMyPayslip(@Query("month") month: Int? = null, @Query("year") year: Int? = null): Response<ApiResponse<Payslip>>

    @GET("my/payslip-months")
    suspend fun getPayslipMonths(): Response<ApiResponse<List<PayslipMonth>>>

    @GET("payroll")
    suspend fun getPayroll(@Query("month") month: Int? = null, @Query("year") year: Int? = null): Response<ApiResponse<List<Payslip>>>

    @GET("payroll/salary-structures")
    suspend fun getAllSalaryStructures(): Response<ApiResponse<List<Any>>>

    @GET("payroll/salary-structure/{employee_id}")
    suspend fun getSalaryStructure(@Path("employee_id") employeeId: Int): Response<ApiResponse<Any>>

    @POST("payroll/salary-structure")
    suspend fun upsertSalaryStructure(@Body body: Map<String, @JvmSuppressWildcards Any>): Response<ApiResponse<Unit>>

    // ── Announcements ─────────────────────────────────────────────────────────
    @GET("announcements/feed")
    suspend fun getAnnouncementFeed(): Response<ApiResponse<AnnouncementFeedData>>

    @GET("announcements")
    suspend fun getAnnouncements(): Response<ApiResponse<List<Announcement>>>

    @POST("announcements/{id}/like")
    suspend fun toggleAnnouncementLike(@Path("id") id: Int): Response<ApiResponse<AnnouncementLikeResult>>

    @GET("announcements/{id}/comments")
    suspend fun getAnnouncementComments(@Path("id") id: Int): Response<ApiResponse<List<AnnouncementComment>>>

    @POST("announcements/{id}/comments")
    suspend fun addAnnouncementComment(@Path("id") id: Int, @Body body: CommentRequest): Response<ApiResponse<AnnouncementComment>>

    @DELETE("announcements/{id}/comments/{commentId}")
    suspend fun deleteAnnouncementComment(@Path("id") id: Int, @Path("commentId") commentId: Int): Response<ApiResponse<Unit>>

    // ── Notifications ─────────────────────────────────────────────────────────
    @GET("notifications")
    suspend fun getNotifications(): Response<NotificationsResponse>

    @PATCH("notifications/read-all")
    suspend fun markAllRead(): Response<ApiResponse<Unit>>

    @PUT("notifications/read-all")
    suspend fun markAllReadPut(): Response<ApiResponse<Unit>>

    @PATCH("notifications/{id}/read")
    suspend fun markRead(@Path("id") id: Int): Response<ApiResponse<Unit>>

    // ── GK Quiz ───────────────────────────────────────────────────────────────
    @GET("gk/question")
    suspend fun getGkQuestion(): Response<ApiResponse<GkQuestion>>

    @POST("gk/answer")
    suspend fun submitAnswer(@Body request: GkAnswerRequest): Response<ApiResponse<GkAnswerResult>>

    @GET("gk/leaderboard")
    suspend fun getLeaderboard(@Query("period") period: String = "all"): Response<ApiResponse<List<LeaderboardEntry>>>

    @GET("gk/my-stats")
    suspend fun getMyGkStats(): Response<ApiResponse<GkStats>>

    @GET("gk/thought")
    suspend fun getThought(): Response<ApiResponse<Thought>>

    // ── Birthdays ─────────────────────────────────────────────────────────────
    @GET("birthdays/upcoming")
    suspend fun getUpcomingBirthdays(): Response<ApiResponse<List<BirthdayRecord>>>

    @GET("anniversaries/upcoming")
    suspend fun getUpcomingAnniversaries(): Response<ApiResponse<List<AnniversaryRecord>>>

    @POST("birthdays/{id}/like")
    suspend fun toggleBirthdayLike(@Path("id") id: Int): Response<ApiResponse<BirthdayLikeResult>>

    @POST("birthdays/{id}/wish")
    suspend fun sendBirthdayWish(@Path("id") id: Int, @Body body: Map<String, String>): Response<ApiResponse<Unit>>

    @GET("birthdays/{id}/wishes")
    suspend fun getBirthdayWishes(@Path("id") id: Int): Response<ApiResponse<List<BirthdayWish>>>

    @DELETE("birthdays/wishes/{id}")
    suspend fun deleteBirthdayWish(@Path("id") id: Int): Response<ApiResponse<Unit>>

    @GET("holidays")
    suspend fun getHolidays(@Query("year") year: Int? = null): Response<ApiResponse<List<Holiday>>>

    // ── Separation ────────────────────────────────────────────────────────────
    @GET("separations")
    suspend fun getSeparations(): Response<ApiResponse<List<SeparationRecord>>>

    @GET("separations/my")
    suspend fun getMySeparations(): Response<ApiResponse<List<SeparationRecord>>>

    @POST("separations/resign")
    suspend fun submitResignation(@Body request: SubmitResignationRequest): Response<ApiResponse<SeparationRecord>>

    @POST("separations/{id}/withdraw")
    suspend fun withdrawSeparation(@Path("id") id: Int): Response<ApiResponse<Unit>>

    @POST("separations/{id}/manager-action")
    suspend fun managerActionSeparation(@Path("id") id: Int, @Body request: ActionRequest): Response<ApiResponse<Unit>>

    @POST("separations/{id}/hr-action")
    suspend fun hrActionSeparation(@Path("id") id: Int, @Body request: ActionRequest): Response<ApiResponse<Unit>>

    @POST("separations/{id}/accounts-action")
    suspend fun accountsActionSeparation(@Path("id") id: Int, @Body request: ActionRequest): Response<ApiResponse<Unit>>

    @POST("separations/{id}/admin-action")
    suspend fun adminActionSeparation(@Path("id") id: Int, @Body request: ActionRequest): Response<ApiResponse<Unit>>

    // ── Provision ─────────────────────────────────────────────────────────────
    @GET("provision")
    suspend fun getProvisionEmployees(): Response<ApiResponse<List<ProvisionEmployee>>>

    @POST("provision/{id}/initiate")
    suspend fun initiateConfirmation(@Path("id") id: Int, @Body body: Map<String, @JvmSuppressWildcards Any?> = emptyMap()): Response<ApiResponse<Unit>>

    @POST("provision/{id}/approve")
    suspend fun approveConfirmation(@Path("id") id: Int, @Body request: ActionRequest): Response<ApiResponse<Unit>>

    // ── Movement Tracking ─────────────────────────────────────────────────────
    @POST("attendance/movement/log")
    suspend fun logMovement(@Body request: MovementLogRequest): Response<ApiResponse<Unit>>

    @GET("attendance/movement/summary")
    suspend fun getMovementSummary(
        @Query("from_date")   fromDate: String,
        @Query("to_date")     toDate: String,
        @Query("employee_id") employeeId: Int? = null
    ): Response<ApiResponse<List<MovementSummaryRow>>>

    @GET("attendance/movement/history")
    suspend fun getMovementHistory(
        @Query("employee_id") employeeId: Int,
        @Query("date")        date: String
    ): Response<ApiResponse<List<MovementPoint>>>

    // ── Movement Alerts (#10) ────────────────────────────────────────────────
    @GET("attendance/movement/alerts")
    suspend fun getMovementAlerts(
        @Query("date")        date: String? = null,
        @Query("employee_id") employeeId: Int? = null,
        @Query("type")        type: String? = null,
        @Query("status")      status: String? = null
    ): Response<ApiResponse<List<MovementAlert>>>

    @POST("attendance/movement/alerts/{id}/resolve")
    suspend fun resolveMovementAlert(
        @Path("id") id: Int,
        @Body body: Map<String, @JvmSuppressWildcards Any?>
    ): Response<ApiResponse<Unit>>

    // ── Beat Plan / PJP (#7) ──────────────────────────────────────────────────
    @GET("attendance/beat-plan")
    suspend fun getBeatPlans(
        @Query("employee_id") employeeId: Int? = null,
        @Query("date")        date: String? = null,
        @Query("from_date")   fromDate: String? = null,
        @Query("to_date")     toDate: String? = null
    ): Response<ApiResponse<List<BeatPlan>>>

    @GET("attendance/beat-plan/compare")
    suspend fun getBeatPlanCompare(
        @Query("employee_id") employeeId: Int,
        @Query("date")        date: String
    ): Response<ApiResponse<BeatPlanCompare>>

    @GET("attendance/beat-plan/{id}")
    suspend fun getBeatPlan(@Path("id") id: Int): Response<ApiResponse<BeatPlan>>

    @POST("attendance/beat-plan")
    suspend fun createBeatPlan(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<ApiResponse<Unit>>

    @DELETE("attendance/beat-plan/{id}")
    suspend fun deleteBeatPlan(@Path("id") id: Int): Response<ApiResponse<Unit>>

    // ── Form 16 ───────────────────────────────────────────────────────────────
    @GET("payroll/form16/years")
    suspend fun getForm16Years(
        @Query("employee_id") employeeId: Int? = null
    ): Response<Form16YearsResponse>

    @GET("payroll/form16")
    suspend fun getForm16(
        @Query("fy") fy: String,
        @Query("employee_id") employeeId: Int? = null
    ): Response<Form16Response>

    // ── IT Declaration ────────────────────────────────────────────────────────
    @GET("it-declaration")
    suspend fun getITDeclaration(
        @Query("fy") fy: String? = null
    ): Response<ITDeclarationResponse>

    @POST("it-declaration")
    suspend fun saveITDeclaration(
        @Body body: Map<String, @JvmSuppressWildcards Any?>
    ): Response<ITDeclarationResponse>

    @Multipart
    @POST("it-declaration/proof")
    suspend fun uploadITProof(
        @Part file: MultipartBody.Part,
        @Part("declaration_id") declarationId: RequestBody,
        @Part("section") section: RequestBody,
        @Part("section_label") sectionLabel: RequestBody
    ): Response<ApiResponse<Unit>>

    @GET("it-declaration/tax-preview")
    suspend fun getTaxPreview(
        @Query("fy") fy: String? = null
    ): Response<TaxPreviewResponse>

    @GET("it-declaration/all")
    suspend fun getAllITDeclarations(
        @Query("fy") fy: String? = null,
        @Query("status") status: String? = null
    ): Response<ApiResponse<List<ITDeclarationSummary>>>

    @GET("it-declaration/proofs")
    suspend fun getProofsByDeclaration(
        @Query("declaration_id") declarationId: Int
    ): Response<ApiResponse<List<ITProofDoc>>>

    @GET("it-declaration/{id}")
    suspend fun getITDeclarationById(
        @Path("id") id: Int
    ): Response<ITDeclarationResponse>

    @POST("it-declaration/{id}/review")
    suspend fun reviewITDeclaration(
        @Path("id") id: Int,
        @Body body: Map<String, @JvmSuppressWildcards Any?>
    ): Response<ApiResponse<Unit>>

    // ── Reimbursement ─────────────────────────────────────────────────────────
    @POST("reimbursement/apply")
    suspend fun applyReimbursement(
        @Body body: Map<String, @JvmSuppressWildcards Any?>
    ): Response<ApiResponse<Unit>>

    @GET("reimbursement")
    suspend fun getReimbursements(
        @Query("employee_id") employeeId: Int? = null,
        @Query("status") status: String? = null
    ): Response<ApiResponse<List<ReimbursementApplication>>>

    @POST("reimbursement/{id}/action")
    suspend fun reimbursementAction(
        @Path("id") id: Int,
        @Body body: Map<String, @JvmSuppressWildcards Any?>
    ): Response<ApiResponse<Unit>>

    @POST("reimbursement/{id}/revoke")
    suspend fun revokeReimbursement(
        @Path("id") id: Int
    ): Response<ApiResponse<Unit>>

    @PUT("reimbursement/{id}/edit")
    suspend fun editReimbursement(
        @Path("id") id: Int,
        @Body body: RequestBody
    ): Response<ApiResponse<Unit>>

    @POST("reimbursement/{id}/disburse")
    suspend fun disburseReimbursement(
        @Path("id") id: Int,
        @Body body: Map<String, @JvmSuppressWildcards Any?>
    ): Response<ApiResponse<Unit>>

    // ── Projects ──────────────────────────────────────────────────────────────
    @GET("projects")
    suspend fun getProjects(
        @Query("status") status: String? = null
    ): Response<ApiResponse<List<Project>>>

    @GET("projects/summary")
    suspend fun getProjectSummary(): Response<ApiResponse<ProjectSummary>>

    // ═════════════════════════════════════════════════════════════════════════
    // ── Chat & Messaging ──────────────────────────────────────────────────────
    // ═════════════════════════════════════════════════════════════════════════

    // Groups
    @GET("chat/groups")
    suspend fun getChatGroups(): Response<ApiResponse<List<ChatGroup>>>

    @POST("chat/groups")
    suspend fun createChatGroup(@Body request: CreateGroupRequest): Response<ApiResponse<ChatGroup>>

    // Delete chat for me only (WhatsApp-style)
    @DELETE("chat/groups/{id}")
    suspend fun deleteChatGroup(@Path("id") id: Int): Response<ApiResponse<Unit>>

    // Update group name / avatar
    @PATCH("chat/groups/{id}")
    suspend fun updateChatGroup(
        @Path("id") id: Int,
        @Body body: Map<String, String>
    ): Response<ApiResponse<ChatGroup>>

    // Messages
    @GET("chat/groups/{groupId}/messages")
    suspend fun getChatMessages(
        @Path("groupId") groupId: Int,
        @Query("before_id") beforeId: Int? = null,
        @Query("limit") limit: Int = 50
    ): Response<ApiResponse<List<ChatMessage>>>

    @POST("chat/groups/{groupId}/messages")
    suspend fun sendChatMessage(
        @Path("groupId") groupId: Int,
        @Body request: SendMessageRequest
    ): Response<ApiResponse<ChatMessage>>

    // Edit message
    @PATCH("chat/messages/{id}")
    suspend fun editChatMessage(
        @Path("id") id: Int,
        @Body request: SendMessageRequest
    ): Response<ApiResponse<ChatMessage>>

    // Delete for me
    @DELETE("chat/groups/{groupId}/messages/{messageId}")
    suspend fun deleteChatMessage(
        @Path("groupId") groupId: Int,
        @Path("messageId") messageId: Int
    ): Response<ApiResponse<Unit>>

    // Delete for everyone
    @DELETE("chat/messages/{id}/everyone")
    suspend fun deleteChatMessageEveryone(
        @Path("id") id: Int
    ): Response<ApiResponse<Unit>>

    // File upload (actual multipart — not just text)
    @Multipart
    @POST("chat/groups/{groupId}/files")
    suspend fun uploadChatFile(
        @Path("groupId") groupId: Int,
        @Part file: MultipartBody.Part
    ): Response<ApiResponse<ChatMessage>>

    // Members
    @GET("chat/groups/{groupId}/members")
    suspend fun getGroupMembers(@Path("groupId") groupId: Int): Response<ApiResponse<List<GroupMember>>>

    @POST("chat/groups/{groupId}/members")
    suspend fun addGroupMembers(
        @Path("groupId") groupId: Int,
        @Body body: Map<String, @JvmSuppressWildcards Any>
    ): Response<ApiResponse<Unit>>

    @DELETE("chat/groups/{groupId}/members/{memberId}")
    suspend fun removeGroupMember(
        @Path("groupId") groupId: Int,
        @Path("memberId") memberId: Int
    ): Response<ApiResponse<Unit>>

    // Scheduled meetings
    @GET("chat/scheduled-meetings")
    suspend fun getScheduledMeetings(): Response<ApiResponse<List<ScheduledMeeting>>>

    @POST("chat/scheduled-meetings")
    suspend fun createScheduledMeeting(@Body request: ScheduleMeetingRequest): Response<ApiResponse<ScheduledMeeting>>

    @DELETE("chat/scheduled-meetings/{id}")
    suspend fun deleteScheduledMeeting(@Path("id") id: Int): Response<ApiResponse<Unit>>

    // Start a scheduled meeting (marks it started on backend, returns room info)
    @POST("chat/scheduled-meetings/{id}/start")
    suspend fun startScheduledMeeting(@Path("id") id: Int): Response<ApiResponse<ScheduledMeeting>>

    // Live meeting records (join / leave tracking)
    @GET("chat/meetings/{roomId}")
    suspend fun getMeeting(@Path("roomId") roomId: String): Response<ApiResponse<ScheduledMeeting>>

    @POST("chat/meetings")
    suspend fun createMeeting(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<ApiResponse<ScheduledMeeting>>

    @PATCH("chat/meetings/{roomId}/end")
    suspend fun endMeeting(@Path("roomId") roomId: String): Response<ApiResponse<Unit>>

    @POST("chat/meetings/{roomId}/join")
    suspend fun joinMeetingRecord(@Path("roomId") roomId: String): Response<ApiResponse<Unit>>

    @POST("chat/meetings/{roomId}/leave")
    suspend fun leaveMeetingRecord(@Path("roomId") roomId: String): Response<ApiResponse<Unit>>

    // Call History
    @GET("chat/call-log")
    suspend fun getCallLog(): Response<ApiResponse<List<CallLogEntry>>>

    @POST("chat/call-log/event")
    suspend fun saveCallEvent(@Body request: CallLogEventRequest): Response<ApiResponse<Unit>>

    // Presence
    @GET("chat/presence")
    suspend fun getChatPresence(@Query("employee_ids") employeeIds: String): Response<ApiResponse<List<PresenceRecord>>>

    @POST("chat/presence")
    suspend fun updateChatPresence(@Body request: UpdatePresenceRequest): Response<ApiResponse<Unit>>

    // Mark offline instantly (called on app background/destroy via sendBeacon equivalent)
    @POST("chat/presence/offline")
    suspend fun markOffline(): Response<ApiResponse<Unit>>

}