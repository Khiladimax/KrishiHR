package com.krishihr.app.ui.chat

import android.app.AlertDialog
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.os.Bundle
import android.text.*
import android.view.*
import android.widget.*
import androidx.core.view.isVisible
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ItemTouchHelper
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.krishihr.app.data.api.RetrofitClient
import com.krishihr.app.data.models.*
import com.krishihr.app.ui.MainActivity
import com.krishihr.app.utils.SessionManager
import kotlinx.coroutines.*

class ChatFragment : Fragment() {

    private lateinit var sessionManager: SessionManager
    private lateinit var adapter: ChatGroupAdapter
    private var allGroups = listOf<ChatGroup>()
    private var presenceJob: Job? = null

    private lateinit var rvGroups: RecyclerView
    private lateinit var etSearch: EditText
    private lateinit var progressBar: ProgressBar
    private lateinit var tvEmpty: TextView

    companion object {
        val WA_GREEN       = 0xFF25D366.toInt()
        val WA_DARK_GREEN  = 0xFF075E54.toInt()
        val WA_TEAL        = 0xFF128C7E.toInt()
        val WA_BG          = 0xFFECE5DD.toInt()
        val WA_WHITE       = 0xFFFFFFFF.toInt()
        val WA_LIGHT_GRAY  = 0xFFF0F0F0.toInt()
        val WA_GRAY        = 0xFF667781.toInt()
        val WA_TEXT        = 0xFF111B21.toInt()
        val WA_DIVIDER     = 0xFFE9EDEF.toInt()
        val WA_UNREAD_BG   = 0xFF25D366.toInt()
        val WA_ICON_GRAY   = 0xFF54656F.toInt()
    }

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        sessionManager = SessionManager(requireContext())
        return buildUI()
    }

    private fun buildUI(): View {
        val ctx = requireContext()
        val dp = ctx.resources.displayMetrics.density
        fun Int.dp() = (this * dp).toInt()

        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(WA_WHITE)
            layoutParams = ViewGroup.LayoutParams(-1, -1)
        }

        val toolbar = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(WA_TEAL)
            setPadding(16.dp(), 12.dp(), 8.dp(), 12.dp())
            gravity = Gravity.CENTER_VERTICAL
        }
        val tvTitle = TextView(ctx).apply {
            text = "Chats"
            textSize = 20f
            setTextColor(WA_WHITE)
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
        }
        val btnSearch = ImageButton(ctx).apply {
            setImageResource(android.R.drawable.ic_menu_search)
            setBackgroundColor(0x00000000); setColorFilter(WA_WHITE)
            layoutParams = LinearLayout.LayoutParams(44.dp(), 44.dp())
        }
        val btnMore = ImageButton(ctx).apply {
            setImageResource(android.R.drawable.ic_menu_more)
            setBackgroundColor(0x00000000); setColorFilter(WA_WHITE)
            layoutParams = LinearLayout.LayoutParams(44.dp(), 44.dp())
            setOnClickListener { showOverflowMenu(it) }
        }
        toolbar.addView(tvTitle); toolbar.addView(btnSearch); toolbar.addView(btnMore)
        root.addView(toolbar, LinearLayout.LayoutParams(-1, -2))

        val searchBar = LinearLayout(ctx).apply {
            setBackgroundColor(WA_WHITE)
            setPadding(12.dp(), 8.dp(), 12.dp(), 8.dp())
            isVisible = false
        }
        etSearch = EditText(ctx).apply {
            hint = "Search…"; textSize = 15f
            setPadding(16.dp(), 10.dp(), 16.dp(), 10.dp())
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(WA_LIGHT_GRAY); cornerRadius = 24 * dp
            }
            layoutParams = LinearLayout.LayoutParams(-1, -2)
        }
        searchBar.addView(etSearch)
        root.addView(searchBar, LinearLayout.LayoutParams(-1, -2))

        btnSearch.setOnClickListener {
            searchBar.isVisible = !searchBar.isVisible
            if (searchBar.isVisible) etSearch.requestFocus()
        }

        val frame = FrameLayout(ctx).apply {
            layoutParams = LinearLayout.LayoutParams(-1, 0, 1f)
        }
        rvGroups = RecyclerView(ctx).apply {
            layoutManager = LinearLayoutManager(ctx)
            setBackgroundColor(WA_WHITE)
            setPadding(0, 0, 0, 8.dp())
            clipToPadding = false
        }
        progressBar = ProgressBar(ctx).apply {
            layoutParams = FrameLayout.LayoutParams(-2, -2, Gravity.CENTER)
        }
        tvEmpty = TextView(ctx).apply {
            text = "No chats yet.\nTap ✏️ to start a conversation."
            textSize = 14f; setTextColor(WA_GRAY); gravity = Gravity.CENTER
            layoutParams = FrameLayout.LayoutParams(-1, -1).apply { gravity = Gravity.CENTER }
            isVisible = false
        }
        val fab = FrameLayout(ctx).apply {
            background = android.graphics.drawable.GradientDrawable().apply {
                shape = android.graphics.drawable.GradientDrawable.OVAL; setColor(WA_GREEN)
            }
            elevation = 10f
            layoutParams = FrameLayout.LayoutParams(56.dp(), 56.dp(), Gravity.BOTTOM or Gravity.END).apply {
                marginEnd = 20.dp(); bottomMargin = 20.dp()
            }
        }
        val fabIcon = ImageView(ctx).apply {
            setImageResource(android.R.drawable.ic_input_add); setColorFilter(WA_WHITE)
            layoutParams = FrameLayout.LayoutParams(28.dp(), 28.dp(), Gravity.CENTER)
        }
        fab.addView(fabIcon)
        fab.setOnClickListener { showNewChatDialog() }

        frame.addView(rvGroups); frame.addView(progressBar); frame.addView(tvEmpty); frame.addView(fab)
        root.addView(frame)

        adapter = ChatGroupAdapter(
            myId = sessionManager.getEmployee()?.id ?: 0,
            onClick = { openChat(it) },
            onLongClick = { showGroupContextMenu(it) }
        )
        rvGroups.adapter = adapter

        val swipeCallback = object : ItemTouchHelper.SimpleCallback(0, ItemTouchHelper.LEFT or ItemTouchHelper.RIGHT) {
            override fun onMove(rv: RecyclerView, vh: RecyclerView.ViewHolder, t: RecyclerView.ViewHolder) = false
            override fun onSwiped(vh: RecyclerView.ViewHolder, direction: Int) {
                val group = adapter.currentList[vh.adapterPosition]
                showDeleteConfirm(group)
                adapter.notifyItemChanged(vh.adapterPosition)
            }
            override fun onChildDraw(c: Canvas, rv: RecyclerView, vh: RecyclerView.ViewHolder, dX: Float, dY: Float, actionState: Int, isActive: Boolean) {
                val itemView = vh.itemView
                val paint = Paint().apply { color = 0xFFFF4444.toInt() }
                val icon  = Paint().apply { color = WA_WHITE; textSize = 40f; isAntiAlias = true }
                if (dX < 0) {
                    c.drawRect(RectF(itemView.right + dX, itemView.top.toFloat(), itemView.right.toFloat(), itemView.bottom.toFloat()), paint)
                    c.drawText("🗑", itemView.right - 70f, itemView.top + (itemView.height / 2f) + 14f, icon)
                } else if (dX > 0) {
                    c.drawRect(RectF(itemView.left.toFloat(), itemView.top.toFloat(), itemView.left + dX, itemView.bottom.toFloat()), paint)
                    c.drawText("🗑", itemView.left + 20f, itemView.top + (itemView.height / 2f) + 14f, icon)
                }
                super.onChildDraw(c, rv, vh, dX, dY, actionState, isActive)
            }
        }
        ItemTouchHelper(swipeCallback).attachToRecyclerView(rvGroups)

        etSearch.addTextChangedListener(object : TextWatcher {
            override fun afterTextChanged(s: Editable?) { filterGroups(s?.toString() ?: "") }
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
        })

        return root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        loadGroups()
        startPresenceHeartbeat()
    }

    private fun loadGroups() {
        progressBar.isVisible = true; tvEmpty.isVisible = false
        lifecycleScope.launch {
            try {
                val res = withContext(Dispatchers.IO) { RetrofitClient.instance.getChatGroups() }
                allGroups = (res.body()?.data ?: emptyList()).sortedByDescending { it.lastMessageAt }
                adapter.submitList(allGroups)
                progressBar.isVisible = false
                tvEmpty.isVisible = allGroups.isEmpty()
                loadPresence(allGroups.filter { it.isDM }.mapNotNull { it.dmPeerId })
            } catch (_: Exception) {
                progressBar.isVisible = false
                Toast.makeText(context, "Failed to load chats", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun loadPresence(peerIds: List<Int>) {
        if (peerIds.isEmpty()) return
        lifecycleScope.launch {
            try {
                val res = withContext(Dispatchers.IO) { RetrofitClient.instance.getChatPresence(peerIds.joinToString(",")) }
                val pm = res.body()?.data?.associateBy { it.employeeId } ?: return@launch
                allGroups = allGroups.map { g ->
                    if (g.isDM && g.dmPeerId != null) {
                        val p = pm[g.dmPeerId]
                        g.copy(isOnline = p?.isOnline == true, lastSeen = p?.lastSeen)
                    } else g
                }
                adapter.submitList(allGroups)
            } catch (_: Exception) {}
        }
    }

    private fun startPresenceHeartbeat() {
        presenceJob?.cancel()
        presenceJob = lifecycleScope.launch {
            // BUG 3 FIX: mark online IMMEDIATELY at start, not after first 60s delay.
            // Without this, the user appears offline during the first minute after login,
            // causing incomingCall events to be silently dropped by the web caller.
            try {
                withContext(Dispatchers.IO) {
                    RetrofitClient.instance.updateChatPresence(UpdatePresenceRequest(true))
                }
            } catch (_: Exception) {}

            while (isActive) {
                delay(60_000)
                try {
                    withContext(Dispatchers.IO) {
                        RetrofitClient.instance.updateChatPresence(UpdatePresenceRequest(true))
                    }
                } catch (_: Exception) {}
                loadPresence(allGroups.filter { it.isDM }.mapNotNull { it.dmPeerId })
            }
        }
    }

    override fun onDestroyView() {
        presenceJob?.cancel()
        lifecycleScope.launch(Dispatchers.IO) { try { RetrofitClient.instance.markOffline() } catch (_: Exception) {} }
        super.onDestroyView()
    }

    private fun filterGroups(q: String) {
        val f = if (q.isBlank()) allGroups else allGroups.filter { it.displayName.contains(q, true) || it.lastMessage?.contains(q, true) == true }
        adapter.submitList(f); tvEmpty.isVisible = f.isEmpty()
    }

    private fun showGroupContextMenu(group: ChatGroup) {
        val opts = mutableListOf("🗑️ Delete Chat")
        if (!group.isDM) opts.add("🚪 Leave Group")
        AlertDialog.Builder(requireContext())
            .setTitle(group.displayName)
            .setItems(opts.toTypedArray()) { _, i ->
                when (opts[i]) {
                    "🗑️ Delete Chat" -> showDeleteConfirm(group)
                    "🚪 Leave Group" -> confirmLeaveGroup(group)
                }
            }.show()
    }

    private fun showDeleteConfirm(group: ChatGroup) {
        AlertDialog.Builder(requireContext())
            .setTitle("Delete Chat")
            .setMessage("Delete chat with \"${group.displayName}\"? This only removes it for you.")
            .setPositiveButton("Delete") { _, _ ->
                lifecycleScope.launch {
                    try {
                        withContext(Dispatchers.IO) { RetrofitClient.instance.deleteChatGroup(group.id) }
                        allGroups = allGroups.filter { it.id != group.id }
                        adapter.submitList(allGroups)
                        tvEmpty.isVisible = allGroups.isEmpty()
                    } catch (_: Exception) {
                        Toast.makeText(context, "Failed to delete", Toast.LENGTH_SHORT).show()
                    }
                }
            }
            .setNegativeButton("Cancel", null).show()
    }

    private fun confirmLeaveGroup(group: ChatGroup) {
        val myId = sessionManager.getEmployee()?.id ?: return
        AlertDialog.Builder(requireContext())
            .setTitle("Leave Group")
            .setMessage("Leave \"${group.displayName}\"?")
            .setPositiveButton("Leave") { _, _ ->
                lifecycleScope.launch {
                    try {
                        withContext(Dispatchers.IO) { RetrofitClient.instance.removeGroupMember(group.id, myId) }
                        allGroups = allGroups.filter { it.id != group.id }
                        adapter.submitList(allGroups)
                        tvEmpty.isVisible = allGroups.isEmpty()
                        Toast.makeText(context, "Left group", Toast.LENGTH_SHORT).show()
                    } catch (_: Exception) {
                        Toast.makeText(context, "Failed to leave", Toast.LENGTH_SHORT).show()
                    }
                }
            }
            .setNegativeButton("Cancel", null).show()
    }

    private fun showOverflowMenu(anchor: View) {
        val popup = PopupMenu(requireContext(), anchor)
        popup.menu.add(0, 0, 0, "New Group")
        popup.setOnMenuItemClickListener {
            when (it.itemId) {
                0 -> showCreateGroupDialog()
            }
            true
        }
        popup.show()
    }

    private fun openChat(group: ChatGroup) = (activity as? MainActivity)?.loadFragment(ChatRoomFragment.newInstance(group))

    private fun showNewChatDialog() {
        AlertDialog.Builder(requireContext())
            .setTitle("New Conversation")
            .setItems(arrayOf("💬 New Direct Message", "👥 New Group Chat")) { _, which ->
                if (which == 0) showEmployeePickerForDM() else showCreateGroupDialog()
            }.show()
    }

    private fun showEmployeePickerForDM() {
        lifecycleScope.launch {
            try {
                val myId = sessionManager.getEmployee()?.id
                val res = withContext(Dispatchers.IO) { RetrofitClient.instance.getEmployees() }
                val others = res.body()?.data?.filter { it.isActive && it.id != myId } ?: return@launch
                val names = others.map { it.fullName }.toTypedArray()
                AlertDialog.Builder(requireContext())
                    .setTitle("Start Chat With")
                    .setItems(names) { _, i ->
                        lifecycleScope.launch {
                            try {
                                val existing = allGroups.find { it.isDM && it.dmPeerId == others[i].id }
                                if (existing != null) { openChat(existing); return@launch }
                                val r = withContext(Dispatchers.IO) {
                                    RetrofitClient.instance.createChatGroup(CreateGroupRequest(type = "dm", memberIds = listOf(others[i].id)))
                                }
                                r.body()?.data?.let { loadGroups(); openChat(it) }
                            } catch (_: Exception) { Toast.makeText(context, "Failed to create chat", Toast.LENGTH_SHORT).show() }
                        }
                    }.show()
            } catch (_: Exception) { Toast.makeText(context, "Failed to load employees", Toast.LENGTH_SHORT).show() }
        }
    }

    private fun showCreateGroupDialog() {
        val ctx = requireContext()
        val dp = ctx.resources.displayMetrics.density
        val etName = EditText(ctx).apply { hint = "Group name"; setPadding((20 * dp).toInt(), (16 * dp).toInt(), (20 * dp).toInt(), (16 * dp).toInt()) }
        AlertDialog.Builder(ctx)
            .setTitle("New Group")
            .setView(etName)
            .setPositiveButton("Next") { _, _ ->
                val name = etName.text.toString().trim()
                if (name.isEmpty()) { Toast.makeText(ctx, "Enter a group name", Toast.LENGTH_SHORT).show(); return@setPositiveButton }
                showMemberPicker(name)
            }
            .setNegativeButton("Cancel", null).show()
    }

    private fun showMemberPicker(groupName: String) {
        lifecycleScope.launch {
            try {
                val myId = sessionManager.getEmployee()?.id
                val res = withContext(Dispatchers.IO) { RetrofitClient.instance.getEmployees() }
                val others = res.body()?.data?.filter { it.isActive && it.id != myId } ?: return@launch
                val names = others.map { it.fullName }.toTypedArray()
                val selected = BooleanArray(others.size)
                AlertDialog.Builder(requireContext())
                    .setTitle("Add to \"$groupName\"")
                    .setMultiChoiceItems(names, selected) { _, i, c -> selected[i] = c }
                    .setPositiveButton("Create") { _, _ ->
                        val ids = others.indices.filter { selected[it] }.map { others[it].id }
                        if (ids.isEmpty()) { Toast.makeText(context, "Select at least 1 member", Toast.LENGTH_SHORT).show(); return@setPositiveButton }
                        lifecycleScope.launch {
                            try {
                                val r = withContext(Dispatchers.IO) {
                                    RetrofitClient.instance.createChatGroup(CreateGroupRequest(name = groupName, type = "group", memberIds = ids))
                                }
                                r.body()?.data?.let { Toast.makeText(context, "✅ Group created!", Toast.LENGTH_SHORT).show(); loadGroups(); openChat(it) }
                            } catch (_: Exception) { Toast.makeText(context, "Failed to create group", Toast.LENGTH_SHORT).show() }
                        }
                    }
                    .setNegativeButton("Cancel", null).show()
            } catch (_: Exception) { Toast.makeText(context, "Failed to load employees", Toast.LENGTH_SHORT).show() }
        }
    }
}