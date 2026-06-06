package com.krishihr.app.ui.chat

import android.content.Context
import android.view.*
import android.widget.*
import androidx.core.view.isVisible
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.krishihr.app.data.models.ChatGroup
import java.text.SimpleDateFormat
import java.util.*

class ChatGroupAdapter(
    private val myId: Int,
    private val onClick: (ChatGroup) -> Unit,
    private val onLongClick: (ChatGroup) -> Unit
) : ListAdapter<ChatGroup, ChatGroupAdapter.VH>(DIFF) {

    companion object {
        val DIFF = object : DiffUtil.ItemCallback<ChatGroup>() {
            override fun areItemsTheSame(a: ChatGroup, b: ChatGroup) = a.id == b.id
            override fun areContentsTheSame(a: ChatGroup, b: ChatGroup) = a == b
        }
        // WhatsApp exact palette
        val WA_TEAL         = 0xFF128C7E.toInt()
        val WA_GREEN        = 0xFF25D366.toInt()
        val WA_WHITE        = 0xFFFFFFFF.toInt()
        val WA_LIGHT_GRAY   = 0xFFF0F2F5.toInt()
        val WA_GRAY         = 0xFF667781.toInt()
        val WA_TEXT         = 0xFF111B21.toInt()
        val WA_DIVIDER      = 0xFFE9EDEF.toInt()
        val WA_ONLINE_GREEN = 0xFF25D366.toInt()
        val WA_GROUP_PURPLE = 0xFF7C4DFF.toInt()
    }

    inner class VH(val root: LinearLayout) : RecyclerView.ViewHolder(root) {
        val avatarFrame: FrameLayout = root.findViewWithTag("avatarFrame")
        val tvAvatar: TextView       = root.findViewWithTag("avatar")
        val ivPhoto: ImageView       = root.findViewWithTag("ivPhoto")
        val onlineDot: View          = root.findViewWithTag("online")
        val tvName: TextView         = root.findViewWithTag("name")
        val tvTime: TextView         = root.findViewWithTag("time")
        val tvSub: TextView          = root.findViewWithTag("sub")
        val tvBadge: TextView        = root.findViewWithTag("badge")
        val tvMuted: TextView        = root.findViewWithTag("muted")
        val divider: View            = root.findViewWithTag("divider")
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH = VH(buildRow(parent.context))

    override fun onBindViewHolder(holder: VH, position: Int) {
        val g = getItem(position)
        val initials = g.displayName.split(" ").take(2).mapNotNull { it.firstOrNull()?.uppercaseChar() }.joinToString("").ifEmpty { "?" }

        holder.tvAvatar.text = initials
        (holder.tvAvatar.background as? android.graphics.drawable.GradientDrawable)
            ?.setColor(if (g.isDM) WA_TEAL else WA_GROUP_PURPLE)

        // Load profile photo — DM: use peer's photo, Group: use avatarUrl
        val photoUrl = if (g.isDM) g.dmPeerPhoto else g.avatarUrl
        if (!photoUrl.isNullOrBlank()) {
            holder.ivPhoto.visibility = android.view.View.VISIBLE
            com.bumptech.glide.Glide.with(holder.root.context)
                .load(photoUrl)
                .circleCrop()
                .placeholder(android.R.color.transparent)
                .into(holder.ivPhoto)
        } else {
            holder.ivPhoto.visibility = android.view.View.GONE
            com.bumptech.glide.Glide.with(holder.root.context).clear(holder.ivPhoto)
        }

        holder.onlineDot.isVisible = g.isDM && g.isOnline

        holder.tvName.text = g.displayName
        holder.tvName.setTextColor(WA_TEXT)

        // Last message preview
        val preview = g.lastMessage
        holder.tvSub.text = when {
            !preview.isNullOrBlank() -> preview
            g.isDM && g.isOnline     -> "● Online"
            g.isDM                   -> formatLastSeen(g.lastSeen)
            else                     -> "${g.memberCount} members"
        }
        holder.tvSub.setTextColor(
            if (preview == null && g.isDM && g.isOnline) WA_ONLINE_GREEN else WA_GRAY
        )

        holder.tvTime.text = formatTime(g.lastMessageAt)
        holder.tvTime.setTextColor(if (g.unreadCount > 0) WA_GREEN else WA_GRAY)

        if (g.unreadCount > 0) {
            holder.tvBadge.text = if (g.unreadCount > 99) "99+" else g.unreadCount.toString()
            holder.tvBadge.isVisible = true
        } else {
            holder.tvBadge.isVisible = false
        }

        holder.tvMuted.isVisible = false // can be toggled for muted groups

        holder.root.setOnClickListener { onClick(g) }
        holder.root.setOnLongClickListener { onLongClick(g); true }
    }

    private fun buildRow(ctx: Context): LinearLayout {
        val dp = ctx.resources.displayMetrics.density
        fun Int.dp() = (this * dp).toInt()

        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(WA_WHITE)
            layoutParams = RecyclerView.LayoutParams(-1, -2)
        }

        val inner = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(14.dp(), 10.dp(), 14.dp(), 10.dp())
            gravity = Gravity.CENTER_VERTICAL
        }

        // ── Avatar ────────────────────────────────────────────────────────────
        val avatarFrame = FrameLayout(ctx).apply {
            tag = "avatarFrame"
            layoutParams = LinearLayout.LayoutParams(52.dp(), 52.dp())
        }
        val tvAvatar = TextView(ctx).apply {
            tag = "avatar"; textSize = 18f; setTextColor(WA_WHITE); gravity = Gravity.CENTER
            background = android.graphics.drawable.GradientDrawable().apply {
                shape = android.graphics.drawable.GradientDrawable.OVAL; setColor(WA_TEAL)
            }
            layoutParams = FrameLayout.LayoutParams(52.dp(), 52.dp())
        }
        val onlineDot = View(ctx).apply {
            tag = "online"
            layoutParams = FrameLayout.LayoutParams(14.dp(), 14.dp(), Gravity.BOTTOM or Gravity.END)
            background = android.graphics.drawable.GradientDrawable().apply {
                shape = android.graphics.drawable.GradientDrawable.OVAL
                setColor(WA_ONLINE_GREEN)
                setStroke(2.dp(), WA_WHITE)
            }
        }
        // Photo overlay — loaded on top of initials when profile pic exists
        val ivPhoto = ImageView(ctx).apply {
            tag = "ivPhoto"
            layoutParams = FrameLayout.LayoutParams(52.dp(), 52.dp())
            scaleType = ImageView.ScaleType.CENTER_CROP
            outlineProvider = android.view.ViewOutlineProvider.BACKGROUND
            clipToOutline = true
            background = android.graphics.drawable.GradientDrawable().apply {
                shape = android.graphics.drawable.GradientDrawable.OVAL
                setColor(android.graphics.Color.TRANSPARENT)
            }
            visibility = android.view.View.GONE
        }
        avatarFrame.addView(tvAvatar); avatarFrame.addView(ivPhoto); avatarFrame.addView(onlineDot)

        // ── Content ───────────────────────────────────────────────────────────
        val col = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = 14.dp() }
        }

        // Row 1: name + time
        val nameRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        }
        val tvName = TextView(ctx).apply {
            tag = "name"; textSize = 16f; setTextColor(WA_TEXT)
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END
            layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
        }
        val tvMuted = TextView(ctx).apply {
            tag = "muted"; text = "🔇"; textSize = 12f
            layoutParams = LinearLayout.LayoutParams(-2, -2).apply { marginEnd = 4.dp() }
        }
        val tvTime = TextView(ctx).apply {
            tag = "time"; textSize = 12f; setTextColor(WA_GRAY)
        }
        nameRow.addView(tvName); nameRow.addView(tvMuted); nameRow.addView(tvTime)

        // Row 2: preview + badge
        val subRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = 2.dp() }
        }
        val tvSub = TextView(ctx).apply {
            tag = "sub"; textSize = 14f; setTextColor(WA_GRAY)
            maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END
            layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
        }
        val tvBadge = TextView(ctx).apply {
            tag = "badge"; textSize = 11f; setTextColor(WA_WHITE)
            setPadding(6.dp(), 2.dp(), 6.dp(), 2.dp()); gravity = Gravity.CENTER
            background = android.graphics.drawable.GradientDrawable().apply {
                shape = android.graphics.drawable.GradientDrawable.OVAL; setColor(WA_GREEN)
            }
            layoutParams = LinearLayout.LayoutParams(-2, -2).apply { marginStart = 6.dp() }
        }
        subRow.addView(tvSub); subRow.addView(tvBadge)

        col.addView(nameRow); col.addView(subRow)
        inner.addView(avatarFrame); inner.addView(col)

        // Divider
        val divider = View(ctx).apply {
            tag = "divider"
            setBackgroundColor(WA_DIVIDER)
            layoutParams = LinearLayout.LayoutParams(-1, 1.dp()).apply { marginStart = 80.dp() }
        }

        root.addView(inner); root.addView(divider)
        return root
    }

    private fun formatTime(iso: String?): String {
        if (iso.isNullOrBlank()) return ""
        return try {
            val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault()).apply { timeZone = TimeZone.getTimeZone("UTC") }
            val date = sdf.parse(iso.substringBefore(".").replace(" ", "T")) ?: return ""
            val diff = Date().time - date.time
            when {
                diff < 60_000          -> "now"
                diff < 3_600_000       -> "${diff / 60_000}m"
                diff < 86_400_000      -> SimpleDateFormat("h:mm a", Locale.getDefault()).apply { timeZone = TimeZone.getDefault() }.format(date)
                diff < 7 * 86_400_000  -> SimpleDateFormat("EEE", Locale.getDefault()).format(date)
                else                   -> SimpleDateFormat("d/M/yy", Locale.getDefault()).format(date)
            }
        } catch (_: Exception) { "" }
    }

    private fun formatLastSeen(iso: String?): String {
        if (iso.isNullOrBlank()) return "Offline"
        return try {
            val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault()).apply { timeZone = TimeZone.getTimeZone("UTC") }
            val date = sdf.parse(iso.substringBefore(".").replace(" ", "T")) ?: return "Offline"
            val diff = Date().time - date.time
            when {
                diff < 60_000     -> "Last seen just now"
                diff < 3_600_000  -> "Last seen ${diff / 60_000}m ago"
                diff < 86_400_000 -> "Last seen ${SimpleDateFormat("h:mm a", Locale.getDefault()).apply { timeZone = TimeZone.getDefault() }.format(date)}"
                else              -> "Last seen ${SimpleDateFormat("d MMM", Locale.getDefault()).format(date)}"
            }
        } catch (_: Exception) { "Offline" }
    }
}