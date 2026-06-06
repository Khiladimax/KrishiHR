package com.krishihr.app.ui.chat

import android.app.AlertDialog
import android.content.*
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.view.*
import android.widget.*
import androidx.core.view.isVisible
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.krishihr.app.data.api.RetrofitClient
import com.krishihr.app.data.models.*
import com.krishihr.app.utils.SessionManager
import kotlinx.coroutines.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody

class ChatRoomFragment : Fragment() {

    companion object {
        fun newInstance(group: ChatGroup) = ChatRoomFragment().apply {
            arguments = Bundle().apply { putParcelable("group", group) }
        }
        private const val REQ_PICK_IMAGE  = 1001
        private const val REQ_PICK_DOC    = 1002
        private const val REQ_CAMERA      = 1003
        private const val REQ_PICK_AVATAR = 1004
    }

    private lateinit var group: ChatGroup
    private lateinit var sessionManager: SessionManager
    private lateinit var msgAdapter: ChatMessageAdapter
    private val messages = mutableListOf<ChatMessage>()
    private var myId = 0
    private var pollJob: Job? = null
    private lateinit var tvStatus: TextView
    private lateinit var rvMessages: RecyclerView
    private lateinit var etMessage: EditText
    private lateinit var progressBar: ProgressBar

    // BUG 6 FIX: track whether we are currently loading older messages (infinite scroll)
    private var isLoadingOlder = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        group = arguments?.getParcelable("group") ?: return
        sessionManager = SessionManager(requireContext())
        myId = sessionManager.getEmployee()?.id ?: 0
    }

    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View = buildUI()

    private fun buildUI(): View {
        val ctx = requireContext()
        val dp  = ctx.resources.displayMetrics.density
        fun Int.dp() = (this * dp).toInt()

        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xFFECE5DD.toInt())
            layoutParams = ViewGroup.LayoutParams(-1, -1)
        }

        val header = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(0xFF075E54.toInt())
            setPadding(4.dp(), 12.dp(), 4.dp(), 8.dp())
            gravity = Gravity.CENTER_VERTICAL
            elevation = 4f
        }

        val btnBack = TextView(ctx).apply {
            text = "←"; textSize = 22f; setTextColor(0xFFFFFFFF.toInt())
            gravity = Gravity.CENTER; typeface = android.graphics.Typeface.DEFAULT_BOLD
            layoutParams = LinearLayout.LayoutParams(40.dp(), 48.dp())
            setOnClickListener { activity?.onBackPressed() }
        }

        val ini = group.displayName.split(" ").take(2)
            .mapNotNull { it.firstOrNull()?.uppercaseChar() }.joinToString("").ifEmpty { "?" }
        val tvAv = TextView(ctx).apply {
            text = ini; textSize = 16f; setTextColor(0xFFFFFFFF.toInt()); gravity = Gravity.CENTER
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            background = android.graphics.drawable.GradientDrawable().apply {
                shape = android.graphics.drawable.GradientDrawable.OVAL
                setColor(if (group.isDM) 0xFF1A7A6D.toInt() else 0xFF7C4DFF.toInt())
            }
            layoutParams = LinearLayout.LayoutParams(40.dp(), 40.dp()).apply { marginStart = 2.dp() }
        }

        // Make avatar tappable for group photo change
        if (!group.isDM) {
            tvAv.setOnClickListener {
                startActivityForResult(
                    android.content.Intent(android.content.Intent.ACTION_PICK).apply { type = "image/*" },
                    REQ_PICK_AVATAR
                )
            }
        }
        // Load existing group avatar
        if (!group.isDM && !group.avatarUrl.isNullOrBlank()) {
            loadAvatarInto(tvAv, group.avatarUrl!!)
        }

        val nameCol = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = 10.dp() }
        }
        val tvName = TextView(ctx).apply {
            text = group.displayName; textSize = 17f; setTextColor(0xFFFFFFFF.toInt())
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END
        }
        tvStatus = TextView(ctx).apply {
            text = if (group.isDM) "tap here for contact info" else "${group.memberCount} participants"
            textSize = 13f; setTextColor(0xCCFFFFFF.toInt())
        }
        nameCol.addView(tvName); nameCol.addView(tvStatus)
        header.addView(btnBack); header.addView(tvAv); header.addView(nameCol)

        if (group.isDM) {
        }

        val btnMenu = TextView(ctx).apply {
            text = "⋮"; textSize = 22f; setTextColor(0xFFFFFFFF.toInt()); gravity = Gravity.CENTER
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            layoutParams = LinearLayout.LayoutParams(40.dp(), 44.dp())
            setOnClickListener { showGroupMenu() }
        }
        header.addView(btnMenu)
        root.addView(header, LinearLayout.LayoutParams(-1, -2))

        val frame = FrameLayout(ctx).apply { layoutParams = LinearLayout.LayoutParams(-1, 0, 1f) }
        rvMessages = RecyclerView(ctx).apply {
            layoutManager = LinearLayoutManager(ctx).apply { stackFromEnd = true }
            setPadding(0, 6.dp(), 0, 6.dp()); clipToPadding = false
            setBackgroundColor(0x00000000)
            overScrollMode = View.OVER_SCROLL_NEVER
        }
        progressBar = ProgressBar(ctx).apply {
            layoutParams = FrameLayout.LayoutParams(-2, -2, Gravity.CENTER)
        }
        frame.addView(rvMessages); frame.addView(progressBar)
        root.addView(frame)

        val inputBar = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(0xFFF0F2F5.toInt())
            setPadding(8.dp(), 6.dp(), 8.dp(), 6.dp())
            gravity = Gravity.BOTTOM
        }

        val btnEmoji = TextView(ctx).apply {
            text = "☺"; textSize = 24f; gravity = Gravity.CENTER
            setTextColor(0xFF54656F.toInt())
            layoutParams = LinearLayout.LayoutParams(36.dp(), 46.dp())
            setOnClickListener { showAttachOptions() }
        }

        etMessage = EditText(ctx).apply {
            hint = "Message"; textSize = 15f; maxLines = 6
            setHintTextColor(0xFF8696A0.toInt()); setTextColor(0xFF111B21.toInt())
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(0xFFFFFFFF.toInt()); cornerRadius = 22 * dp
            }
            setPadding(16.dp(), 10.dp(), 16.dp(), 10.dp())
            layoutParams = LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = 6.dp(); marginEnd = 6.dp() }
        }

        val btnAttach = TextView(ctx).apply {
            text = "📎"; textSize = 20f; gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(36.dp(), 46.dp())
            setOnClickListener { showAttachOptions() }
        }

        val btnSend = FrameLayout(ctx).apply {
            background = android.graphics.drawable.GradientDrawable().apply {
                shape = android.graphics.drawable.GradientDrawable.OVAL
                setColor(0xFF128C7E.toInt())
            }
            layoutParams = LinearLayout.LayoutParams(46.dp(), 46.dp())
        }
        val ivSend = TextView(ctx).apply {
            text = "➤"; textSize = 18f; setTextColor(0xFFFFFFFF.toInt()); gravity = Gravity.CENTER
            layoutParams = FrameLayout.LayoutParams(-1, -1)
        }
        btnSend.addView(ivSend)
        btnSend.setOnClickListener { sendMessage() }

        inputBar.addView(btnEmoji); inputBar.addView(etMessage); inputBar.addView(btnAttach); inputBar.addView(btnSend)
        root.addView(inputBar, LinearLayout.LayoutParams(-1, -2))

        msgAdapter = ChatMessageAdapter(
            myId       = myId,
            onLongClick = { showMessageOptions(it) },

            )
        rvMessages.adapter = msgAdapter
        return root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        loadMessages()
        startPolling()
        if (group.isDM && group.dmPeerId != null) refreshPresence()

        // BUG 6 FIX: infinite scroll — load older messages when user scrolls to top
        rvMessages.addOnScrollListener(object : RecyclerView.OnScrollListener() {
            override fun onScrolled(rv: RecyclerView, dx: Int, dy: Int) {
                val lm = rv.layoutManager as LinearLayoutManager
                if (lm.findFirstVisibleItemPosition() == 0 && messages.isNotEmpty() && !isLoadingOlder) {
                    loadOlderMessages()
                }
            }
        })
    }

    // BUG 6 FIX: fetch messages older than the oldest currently shown
    private fun loadOlderMessages() {
        if (isLoadingOlder) return
        isLoadingOlder = true
        lifecycleScope.launch {
            try {
                val oldestId = messages.firstOrNull()?.id ?: return@launch
                val res = withContext(Dispatchers.IO) {
                    RetrofitClient.instance.getChatMessages(group.id, beforeId = oldestId, limit = 50)
                }
                val older = (res.body()?.data ?: emptyList()).sortedBy { it.createdAt }
                if (older.isNotEmpty()) {
                    val lm = rvMessages.layoutManager as LinearLayoutManager
                    val firstVisible = lm.findFirstVisibleItemPosition()
                    val combined = (older + messages).distinctBy { it.id }
                    messages.clear(); messages.addAll(combined)
                    msgAdapter.submitList(messages.toList()) {
                        // Restore scroll position so prepended messages don't jump the view
                        rvMessages.scrollToPosition(older.size + firstVisible)
                    }
                }
            } catch (_: Exception) {}
            isLoadingOlder = false
        }
    }

    private fun refreshPresence() {
        lifecycleScope.launch {
            try {
                val p = withContext(Dispatchers.IO) { RetrofitClient.instance.getChatPresence(group.dmPeerId.toString()) }
                    .body()?.data?.firstOrNull() ?: return@launch
                tvStatus.text = if (p.isOnline) "online" else fmtLastSeen(p.lastSeen)
            } catch (_: Exception) {}
        }
    }

    private fun fmtLastSeen(iso: String?): String {
        if (iso.isNullOrBlank()) return "last seen recently"
        return try {
            val sdf = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.getDefault()).apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
            val date = sdf.parse(iso.substringBefore(".").replace(" ","T")) ?: return "last seen recently"
            val diff = java.util.Date().time - date.time
            when {
                diff < 60_000     -> "last seen just now"
                diff < 3_600_000  -> "last seen ${diff/60_000}m ago"
                diff < 86_400_000 -> "last seen today at ${java.text.SimpleDateFormat("h:mm a",java.util.Locale.getDefault()).apply{timeZone=java.util.TimeZone.getDefault()}.format(date)}"
                else              -> "last seen ${java.text.SimpleDateFormat("d MMM",java.util.Locale.getDefault()).format(date)}"
            }
        } catch (_: Exception) { "last seen recently" }
    }

    private fun loadMessages() {
        progressBar.isVisible = true
        lifecycleScope.launch {
            try {
                // BUG 6 FIX: use limit=50 (was missing explicit limit, defaulted to server-side 50)
                val res = withContext(Dispatchers.IO) { RetrofitClient.instance.getChatMessages(group.id, limit = 50) }
                messages.clear(); messages.addAll((res.body()?.data ?: emptyList()).sortedBy { it.createdAt })
                msgAdapter.submitList(messages.toList())
                if (messages.isNotEmpty()) rvMessages.scrollToPosition(messages.size - 1)
            } catch (_: Exception) {}
            progressBar.isVisible = false
        }
    }

    private fun startPolling() {
        pollJob?.cancel()
        pollJob = lifecycleScope.launch {
            while (isActive) {
                delay(3000)
                try {
                    // BUG 6 FIX: poll with limit=50 (was 30) to avoid missing messages
                    val fetched = withContext(Dispatchers.IO) {
                        RetrofitClient.instance.getChatMessages(group.id, limit = 50)
                    }.body()?.data ?: continue
                    val newMsgs = fetched.filter { n -> messages.none { it.id == n.id } }.sortedBy { it.createdAt }
                    if (newMsgs.isNotEmpty()) {
                        messages.addAll(newMsgs); msgAdapter.submitList(messages.toList())
                        rvMessages.scrollToPosition(messages.size - 1)
                    }
                } catch (_: Exception) {}
            }
        }
    }

    private fun sendMessage() {
        val text = etMessage.text.toString().trim(); if (text.isEmpty()) return
        etMessage.text.clear()
        lifecycleScope.launch {
            try {
                val res = withContext(Dispatchers.IO) { RetrofitClient.instance.sendChatMessage(group.id, SendMessageRequest(text)) }
                res.body()?.data?.let { messages.add(it); msgAdapter.submitList(messages.toList()); rvMessages.scrollToPosition(messages.size - 1) }
            } catch (_: Exception) { Toast.makeText(context, "Failed to send", Toast.LENGTH_SHORT).show(); etMessage.setText(text) }
        }
    }


    private fun showMessageOptions(msg: ChatMessage) {
        val isMine = msg.senderId == myId
        val opts = mutableListOf("Copy")
        if (!msg.isDeleted) {
            if (isMine) { opts.add("Edit"); opts.add("Delete for Everyone") }
            opts.add("Delete for Me")
        }
        AlertDialog.Builder(requireContext()).setItems(opts.toTypedArray()) { _, i ->
            when (opts[i]) {
                "Copy" -> {
                    (requireContext().getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
                        .setPrimaryClip(ClipData.newPlainText("", msg.content))
                    Toast.makeText(context, "Copied", Toast.LENGTH_SHORT).show()
                }
                "Edit" -> showEditDialog(msg)
                "Delete for Everyone" -> deleteMsg(msg, true)
                "Delete for Me"       -> deleteMsg(msg, false)
            }
        }.show()
    }

    private fun showEditDialog(msg: ChatMessage) {
        val ctx = requireContext(); val dp = ctx.resources.displayMetrics.density
        val et = EditText(ctx).apply { setText(msg.content); setPadding((20*dp).toInt(),(12*dp).toInt(),(20*dp).toInt(),(12*dp).toInt()) }
        AlertDialog.Builder(ctx).setTitle("Edit message").setView(et)
            .setPositiveButton("Save") { _, _ ->
                val t = et.text.toString().trim(); if (t.isBlank()) return@setPositiveButton
                lifecycleScope.launch {
                    try {
                        withContext(Dispatchers.IO) { RetrofitClient.instance.editChatMessage(msg.id, SendMessageRequest(t)) }
                        val idx = messages.indexOfFirst { it.id == msg.id }
                        if (idx >= 0) { messages[idx] = msg.copy(content = t); msgAdapter.submitList(messages.toList()) }
                    } catch (_: Exception) {}
                }
            }.setNegativeButton("Cancel", null).show()
    }

    private fun deleteMsg(msg: ChatMessage, everyone: Boolean) {
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    if (everyone) RetrofitClient.instance.deleteChatMessageEveryone(msg.id)
                    else          RetrofitClient.instance.deleteChatMessage(group.id, msg.id)
                }
                val idx = messages.indexOfFirst { it.id == msg.id }
                if (idx >= 0) { messages[idx] = msg.copy(isDeleted = true); msgAdapter.submitList(messages.toList()) }
            } catch (_: Exception) { Toast.makeText(context, "Failed", Toast.LENGTH_SHORT).show() }
        }
    }

    private fun showGroupMenu() {
        val opts = if (group.isDM) arrayOf("Delete Chat")
        else arrayOf("View Members", "Add Members", "Delete Chat", "Leave Group")
        AlertDialog.Builder(requireContext()).setTitle(group.displayName).setItems(opts) { _, i ->
            when (opts[i]) {
                "View Members" -> showGroupMembers()
                "Add Members"  -> showAddMembers()
                "Delete Chat"  -> confirmDelete()
                "Leave Group"  -> confirmLeave()
            }
        }.show()
    }

    private fun confirmDelete() {
        AlertDialog.Builder(requireContext()).setTitle("Delete chat?").setMessage("This will delete this chat for you.")
            .setPositiveButton("Delete") { _, _ ->
                lifecycleScope.launch {
                    try { withContext(Dispatchers.IO) { RetrofitClient.instance.deleteChatGroup(group.id) }; activity?.onBackPressed() }
                    catch (_: Exception) { Toast.makeText(context, "Failed", Toast.LENGTH_SHORT).show() }
                }
            }.setNegativeButton("Cancel", null).show()
    }

    private fun confirmLeave() {
        AlertDialog.Builder(requireContext()).setTitle("Leave group?")
            .setPositiveButton("Leave") { _, _ ->
                lifecycleScope.launch {
                    try { withContext(Dispatchers.IO) { RetrofitClient.instance.removeGroupMember(group.id, myId) }; activity?.onBackPressed() }
                    catch (_: Exception) { Toast.makeText(context, "Failed", Toast.LENGTH_SHORT).show() }
                }
            }.setNegativeButton("Cancel", null).show()
    }


    private fun showGroupMembers() {
        lifecycleScope.launch {
            try {
                val names = withContext(Dispatchers.IO) { RetrofitClient.instance.getGroupMembers(group.id) }.body()?.data?.map { "• ${it.employeeName}" }?.toTypedArray() ?: return@launch
                AlertDialog.Builder(requireContext()).setTitle("${group.displayName}").setItems(names, null).setPositiveButton("Close", null).show()
            } catch (_: Exception) {}
        }
    }

    private fun showAddMembers() {
        lifecycleScope.launch {
            try {
                val memberIds = withContext(Dispatchers.IO) { RetrofitClient.instance.getGroupMembers(group.id) }.body()?.data?.map { it.employeeId }?.toSet() ?: emptySet()
                val addable = withContext(Dispatchers.IO) { RetrofitClient.instance.getEmployees() }.body()?.data?.filter { it.isActive && it.id !in memberIds && it.id != myId } ?: return@launch
                val sel = BooleanArray(addable.size)
                AlertDialog.Builder(requireContext()).setTitle("Add members").setMultiChoiceItems(addable.map { it.fullName }.toTypedArray(), sel) { _, i, c -> sel[i] = c }
                    .setPositiveButton("Add") { _, _ ->
                        val ids = addable.indices.filter { sel[it] }.map { addable[it].id }; if (ids.isEmpty()) return@setPositiveButton
                        lifecycleScope.launch { try { withContext(Dispatchers.IO) { RetrofitClient.instance.addGroupMembers(group.id, mapOf("member_ids" to ids)) }; Toast.makeText(context, "Added!", Toast.LENGTH_SHORT).show() } catch (_: Exception) {} }
                    }.setNegativeButton("Cancel", null).show()
            } catch (_: Exception) {}
        }
    }

    private fun showAttachOptions() {
        AlertDialog.Builder(requireContext()).setItems(arrayOf("🖼  Gallery","📄  Document","📷  Camera")) { _, w ->
            when (w) {
                0 -> startActivityForResult(Intent(Intent.ACTION_PICK).apply { type = "image/*" }, REQ_PICK_IMAGE)
                1 -> startActivityForResult(Intent.createChooser(Intent(Intent.ACTION_GET_CONTENT).apply { type = "*/*" }, "Select"), REQ_PICK_DOC)
                2 -> startActivityForResult(Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE), REQ_CAMERA)
            }
        }.show()
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (resultCode != android.app.Activity.RESULT_OK) return
        val uri = data?.data ?: return
        when (requestCode) {
            REQ_PICK_AVATAR -> uploadGroupAvatar(uri)
            else            -> uploadFile(uri)
        }
    }

    private fun uploadFile(uri: Uri) {
        lifecycleScope.launch {
            try {
                val cr = requireContext().contentResolver
                val name = run {
                    var n = "file"
                    cr.query(uri, null, null, null, null)?.use { if (it.moveToFirst()) n = it.getString(it.getColumnIndexOrThrow(android.provider.OpenableColumns.DISPLAY_NAME)) }
                    n
                }
                val mime  = cr.getType(uri) ?: "application/octet-stream"
                val bytes = withContext(Dispatchers.IO) { cr.openInputStream(uri)?.readBytes() } ?: return@launch
                val part  = MultipartBody.Part.createFormData("file", name, bytes.toRequestBody(mime.toMediaType()))
                Toast.makeText(context, "Uploading…", Toast.LENGTH_SHORT).show()
                val res = withContext(Dispatchers.IO) { RetrofitClient.instance.uploadChatFile(group.id, part) }
                res.body()?.data?.let { messages.add(it); msgAdapter.submitList(messages.toList()); rvMessages.scrollToPosition(messages.size-1) }
            } catch (_: Exception) { Toast.makeText(context, "Upload failed", Toast.LENGTH_SHORT).show() }
        }
    }

    override fun onDestroyView() { pollJob?.cancel(); super.onDestroyView() }

    private fun loadAvatarInto(tv: android.widget.TextView, url: String) {
        val fullUrl = if (url.startsWith("http")) url
        else RetrofitClient.BASE_URL.removeSuffix("/api/").removeSuffix("/api") + url
        kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.IO).launch {
            try {
                val conn = (java.net.URL(fullUrl).openConnection() as java.net.HttpURLConnection).also {
                    it.connectTimeout = 8_000; it.readTimeout = 8_000; it.connect()
                }
                val bmp = android.graphics.BitmapFactory.decodeStream(conn.inputStream) ?: return@launch
                val round = android.graphics.Bitmap.createBitmap(bmp.width, bmp.height, android.graphics.Bitmap.Config.ARGB_8888)
                val canvas = android.graphics.Canvas(round)
                val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
                canvas.drawCircle(bmp.width / 2f, bmp.height / 2f, minOf(bmp.width, bmp.height) / 2f, paint)
                paint.xfermode = android.graphics.PorterDuffXfermode(android.graphics.PorterDuff.Mode.SRC_IN)
                canvas.drawBitmap(bmp, 0f, 0f, paint)
                withContext(kotlinx.coroutines.Dispatchers.Main) {
                    tv.text = ""
                    tv.background = android.graphics.drawable.BitmapDrawable(tv.resources, round)
                }
            } catch (_: Exception) {}
        }
    }

    private fun uploadGroupAvatar(uri: android.net.Uri) {
        lifecycleScope.launch {
            try {
                val cr = requireContext().contentResolver
                val bytes = withContext(kotlinx.coroutines.Dispatchers.IO) { cr.openInputStream(uri)?.readBytes() } ?: return@launch
                val b64 = "data:image/jpeg;base64," + android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
                val res = withContext(kotlinx.coroutines.Dispatchers.IO) {
                    RetrofitClient.instance.updateChatGroup(group.id, mapOf("avatar_url" to b64))
                }
                if (res.isSuccessful) {
                    Toast.makeText(context, "✅ Group photo updated!", Toast.LENGTH_SHORT).show()
                    // Reload avatar in header
                    res.body()?.data?.avatarUrl?.let { url ->
                        val dp = requireContext().resources.displayMetrics.density
                        val tvAv = (view as? android.view.ViewGroup)
                            ?.getChildAt(0) // header LinearLayout
                            ?.let { (it as? android.view.ViewGroup)?.getChildAt(2) } // tvAv
                        (tvAv as? android.widget.TextView)?.let { loadAvatarInto(it, url) }
                    }
                } else Toast.makeText(context, "Failed to update photo", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Toast.makeText(context, "Error: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }
}