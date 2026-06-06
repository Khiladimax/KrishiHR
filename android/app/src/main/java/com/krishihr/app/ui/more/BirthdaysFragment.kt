package com.krishihr.app.ui.more

import android.os.Bundle
import android.view.*
import android.widget.*
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.button.MaterialButton
import com.krishihr.app.R
import com.krishihr.app.data.api.RetrofitClient
import com.krishihr.app.data.models.BirthdayRecord
import com.krishihr.app.data.models.BirthdayWish
import com.krishihr.app.utils.SessionManager
import com.krishihr.app.utils.toast
import kotlinx.coroutines.launch

class BirthdaysFragment : Fragment() {

    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View {
        val ctx = requireContext()
        val dp  = ctx.resources.displayMetrics.density

        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(ctx.getColor(R.color.background))
        }

        // Header
        root.addView(LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            setBackgroundColor(ctx.getColor(R.color.primary))
            setPadding((16*dp).toInt(), (16*dp).toInt(), (16*dp).toInt(), (16*dp).toInt())
            addView(TextView(ctx).apply {
                text = "🎂  Birthdays"; textSize = 20f
                setTypeface(null, android.graphics.Typeface.BOLD)
                setTextColor(ctx.getColor(R.color.white))
            })
        })

        val progress = ProgressBar(ctx).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).also {
                it.gravity = android.view.Gravity.CENTER_HORIZONTAL
                it.topMargin = (24*dp).toInt()
            }
        }
        root.addView(progress)

        val rv = RecyclerView(ctx).apply {
            layoutManager = LinearLayoutManager(ctx)
            setPadding((8*dp).toInt(), (8*dp).toInt(), (8*dp).toInt(), (80*dp).toInt())
            clipToPadding = false
            visibility = View.GONE
        }
        root.addView(rv)

        val tvEmpty = TextView(ctx).apply {
            text = "No birthdays in the next 7 days 🎈"
            textSize = 14f; gravity = android.view.Gravity.CENTER
            setTextColor(ctx.getColor(R.color.text_hint))
            setPadding((16*dp).toInt(), (48*dp).toInt(), (16*dp).toInt(), 0)
            visibility = View.GONE
        }
        root.addView(tvEmpty)

        fun load() {
            lifecycleScope.launch {
                try {
                    val res = RetrofitClient.instance.getUpcomingBirthdays()
                    progress.visibility = View.GONE
                    val list = res.body()?.data ?: emptyList()
                    if (list.isEmpty()) {
                        tvEmpty.visibility = View.VISIBLE
                    } else {
                        rv.visibility = View.VISIBLE
                        rv.adapter = BirthdayAdapter(list.toMutableList(), requireContext()) { load() }
                    }
                } catch (_: Exception) {
                    progress.visibility = View.GONE
                    tvEmpty.text = "Could not load birthdays"
                    tvEmpty.visibility = View.VISIBLE
                }
            }
        }

        load()
        return root
    }
}

class BirthdayAdapter(
    private val items: MutableList<BirthdayRecord>,
    private val ctx: android.content.Context,
    private val onRefresh: () -> Unit
) : RecyclerView.Adapter<BirthdayAdapter.VH>() {

    inner class VH(val card: androidx.cardview.widget.CardView) : RecyclerView.ViewHolder(card)
    override fun getItemCount() = items.size

    override fun onCreateViewHolder(p: ViewGroup, t: Int): VH {
        val dp = ctx.resources.displayMetrics.density
        val card = androidx.cardview.widget.CardView(ctx).apply {
            radius = 16 * dp; cardElevation = 3 * dp
            layoutParams = RecyclerView.LayoutParams(
                RecyclerView.LayoutParams.MATCH_PARENT, RecyclerView.LayoutParams.WRAP_CONTENT
            ).also { it.setMargins(0, 0, 0, (10*dp).toInt()) }
        }
        return VH(card)
    }

    override fun onBindViewHolder(h: VH, pos: Int) {
        val b  = items[pos]
        val dp = ctx.resources.displayMetrics.density
        h.card.removeAllViews()

        val isToday = b.isToday2
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
        val initials = b.displayName.split(" ").take(2).map { it.firstOrNull()?.uppercase() ?: "" }.joinToString("")
        val avatarCard = androidx.cardview.widget.CardView(ctx).apply {
            radius = 28 * dp; cardElevation = 0f
            setCardBackgroundColor(ctx.getColor(if (isToday) R.color.accent_amber else R.color.primary))
            layoutParams = LinearLayout.LayoutParams((56*dp).toInt(), (56*dp).toInt()).also { it.marginEnd = (12*dp).toInt() }
        }
        avatarCard.addView(TextView(ctx).apply {
            text = initials; textSize = 18f; gravity = android.view.Gravity.CENTER
            setTextColor(ctx.getColor(R.color.white))
            setTypeface(null, android.graphics.Typeface.BOLD)
            layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        })
        topRow.addView(avatarCard)

        val nameCol = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        if (isToday) nameCol.addView(TextView(ctx).apply {
            text = "🎉 TODAY'S BIRTHDAY!"; textSize = 10f; setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(ctx.getColor(R.color.accent_amber)); setPadding(0, 0, 0, (2*dp).toInt())
        })
        nameCol.addView(TextView(ctx).apply {
            text = b.displayName; textSize = 16f; setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(ctx.getColor(R.color.text_primary))
        })
        nameCol.addView(TextView(ctx).apply {
            text = listOfNotNull(b.designationTitle, b.departmentName).joinToString(" · ").ifBlank { "Employee" }
            textSize = 12f; setTextColor(ctx.getColor(R.color.text_secondary))
        })
        topRow.addView(nameCol)

        topRow.addView(TextView(ctx).apply {
            text = if (isToday) "🎂 Today!" else "in ${b.daysUntil} day${if ((b.daysUntil ?: 0) != 1) "s" else ""}"
            textSize = 11f; setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(ctx.getColor(R.color.white))
            setPadding((8*dp).toInt(), (4*dp).toInt(), (8*dp).toInt(), (4*dp).toInt())
            background = ctx.getDrawable(if (isToday) R.drawable.bg_status_pending else R.drawable.bg_status_approved)
        })
        ll.addView(topRow)

        ll.addView(TextView(ctx).apply {
            text = "🗓️  ${b.birthDisplay ?: b.birthDay ?: b.dateOfBirth?.take(10) ?: "—"}"
            textSize = 12f; setTextColor(ctx.getColor(R.color.text_hint))
            setPadding(0, (6*dp).toInt(), 0, (8*dp).toInt())
        })

        // ── Like + Wish buttons (today only) ──────────────────────────────────
        if (isToday) {
            val btnRow = LinearLayout(ctx).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            }

            val btnLike = MaterialButton(ctx, null, com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
                text = if (b.iLiked) "❤️  ${b.likeCount} Liked" else "🤍  ${b.likeCount} Like"
                textSize = 12f
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).also { it.marginEnd = (8*dp).toInt() }
                if (b.iLiked) setBackgroundColor(ctx.getColor(R.color.accent_pink_light))
                setOnClickListener {
                    val empId = b.id ?: b.employeeId ?: return@setOnClickListener
                    isEnabled = false
                    kotlinx.coroutines.MainScope().launch {
                        try {
                            val res = RetrofitClient.instance.toggleBirthdayLike(empId)
                            if (res.isSuccessful) {
                                // Backend returns flat: { success, liked, like_count }
                                // Re-fetch to get accurate count and liked state
                                val fresh = RetrofitClient.instance.getUpcomingBirthdays()
                                val updated = fresh.body()?.data?.firstOrNull {
                                    it.id == empId || it.employeeId == empId
                                }
                                val newLiked = updated?.iLiked ?: !b.iLiked
                                val newCount = updated?.likeCount ?: b.likeCount
                                items[pos] = b.copy(likeCount = newCount, iLiked = newLiked)
                                notifyItemChanged(pos)
                            } else {
                                ctx.toast("Could not like (${res.code()})")
                            }
                        } catch (e: Exception) {
                            ctx.toast("Could not like")
                        }
                        isEnabled = true
                    }
                }
            }

            val btnWish = MaterialButton(ctx, null, com.google.android.material.R.attr.materialButtonStyle).apply {
                text = if (b.iWished) "✅  Wished!" else "🎁  Send Wish"
                textSize = 12f
                setBackgroundColor(ctx.getColor(if (b.iWished) R.color.text_secondary else R.color.primary))
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                setOnClickListener {
                    val empId = b.id ?: b.employeeId ?: return@setOnClickListener
                    showWishDialog(empId, b.displayName) { success ->
                        if (success) {
                            items[pos] = b.copy(iWished = true, wishCount = b.wishCount + 1)
                            notifyItemChanged(pos)
                        }
                    }
                }
            }

            btnRow.addView(btnLike)
            btnRow.addView(btnWish)
            ll.addView(btnRow)

            // ── Divider ───────────────────────────────────────────────────────
            ll.addView(View(ctx).apply {
                setBackgroundColor(ctx.getColor(R.color.divider))
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, (1*dp).toInt()
                ).also { it.topMargin = (10*dp).toInt(); it.bottomMargin = (8*dp).toInt() }
            })

            // ── Wishes section ────────────────────────────────────────────────
            val wishesContainer = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
            ll.addView(wishesContainer)

            val tvWishHeader = TextView(ctx).apply {
                text = "💬 Wishes (${b.wishCount})"; textSize = 13f
                setTypeface(null, android.graphics.Typeface.BOLD)
                setTextColor(ctx.getColor(R.color.text_primary))
                setPadding(0, 0, 0, (6*dp).toInt())
            }
            wishesContainer.addView(tvWishHeader)

            val empId = b.id ?: b.employeeId
            if (empId != null) {
                fun loadWishes() {
                    kotlinx.coroutines.MainScope().launch {
                        try {
                            val wishRes = RetrofitClient.instance.getBirthdayWishes(empId)
                            val wishes = wishRes.body()?.data ?: emptyList()
                            tvWishHeader.text = "💬 Wishes (${wishes.size})"

                            // Clear old wish cards (keep header at index 0)
                            while (wishesContainer.childCount > 1) wishesContainer.removeViewAt(1)

                            if (wishes.isEmpty()) {
                                wishesContainer.addView(TextView(ctx).apply {
                                    text = "No wishes yet. Be the first! 🎉"
                                    textSize = 12f; setTextColor(ctx.getColor(R.color.text_hint))
                                    setPadding(0, 0, 0, (4*dp).toInt())
                                })
                            } else {
                                wishes.forEach { wish ->
                                    wishesContainer.addView(
                                        buildWishCard(dp, wish, myId, empId) { loadWishes() }
                                    )
                                }
                            }
                        } catch (_: Exception) {}
                    }
                }
                loadWishes()
            }
        }

        h.card.addView(ll)
    }

    private fun buildWishCard(
        dp: Float,
        wish: BirthdayWish,
        myId: Int?,
        birthdayEmpId: Int,
        onDeleted: () -> Unit
    ): LinearLayout {
        val row = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.TOP
            setPadding(0, (4*dp).toInt(), 0, (4*dp).toInt())
        }

        // Avatar
        val initials = wish.fromName?.split(" ")?.take(2)
            ?.map { it.firstOrNull()?.uppercase() ?: "" }?.joinToString("") ?: "?"
        val avCard = androidx.cardview.widget.CardView(ctx).apply {
            radius = 16*dp; cardElevation = 0f
            setCardBackgroundColor(ctx.getColor(R.color.primary))
            layoutParams = LinearLayout.LayoutParams((32*dp).toInt(), (32*dp).toInt())
                .also { it.marginEnd = (8*dp).toInt() }
        }
        avCard.addView(TextView(ctx).apply {
            text = initials; textSize = 11f; gravity = android.view.Gravity.CENTER
            setTextColor(android.graphics.Color.WHITE)
            setTypeface(null, android.graphics.Typeface.BOLD)
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        })
        row.addView(avCard)

        // Message column
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
        if (timeStr.isNotBlank()) {
            msgCol.addView(TextView(ctx).apply {
                text = timeStr; textSize = 10f
                setTextColor(ctx.getColor(R.color.text_hint))
            })
        }
        row.addView(msgCol)

        // Delete button — own wish or birthday person can delete
        val canDelete = wish.fromEmpId == myId || myId == birthdayEmpId
        if (canDelete) {
            row.addView(TextView(ctx).apply {
                text = "🗑"; textSize = 16f
                setPadding((8*dp).toInt(), 0, 0, 0)
                setOnClickListener {
                    android.app.AlertDialog.Builder(ctx)
                        .setTitle("Delete Wish")
                        .setMessage("Delete this birthday wish?")
                        .setPositiveButton("Delete") { _, _ ->
                            kotlinx.coroutines.MainScope().launch {
                                try {
                                    val res = RetrofitClient.instance.deleteBirthdayWish(wish.id)
                                    if (res.isSuccessful && res.body()?.success == true) {
                                        ctx.toast("Wish deleted ✅")
                                        onDeleted()
                                    } else {
                                        ctx.toast(res.body()?.message ?: "Could not delete")
                                    }
                                } catch (_: Exception) { ctx.toast("Network error") }
                            }
                        }
                        .setNegativeButton("Cancel", null).show()
                }
            })
        }

        return row
    }

    private fun showWishDialog(empId: Int, name: String, onResult: (Boolean) -> Unit) {
        val dp = ctx.resources.displayMetrics.density
        val et = EditText(ctx).apply {
            hint = "Write a wish for $name…"; minLines = 2
            setPadding((12*dp).toInt(), (10*dp).toInt(), (12*dp).toInt(), (10*dp).toInt())
        }
        android.app.AlertDialog.Builder(ctx)
            .setTitle("🎂 Send Birthday Wish")
            .setView(et)
            .setPositiveButton("Send 🎉") { _, _ ->
                val msg = et.text.toString().trim().ifEmpty { "Happy Birthday! 🎂🎉" }
                kotlinx.coroutines.MainScope().launch {
                    try {
                        val res = RetrofitClient.instance.sendBirthdayWish(empId, mapOf("message" to msg))
                        if (res.isSuccessful && res.body()?.success == true) {
                            ctx.toast("Wish sent! 🎉"); onResult(true)
                        } else {
                            ctx.toast(res.body()?.message ?: "Could not send wish"); onResult(false)
                        }
                    } catch (_: Exception) { ctx.toast("Network error"); onResult(false) }
                }
            }
            .setNegativeButton("Cancel", null).show()
    }
}

fun BirthdayRecord.copy(
    likeCount: Int = this.likeCount,
    iLiked: Boolean = this.iLiked,
    wishCount: Int = this.wishCount,
    iWished: Boolean = this.iWished
) = BirthdayRecord(
    id = this.id, fullName = this.fullName, employeeCode = this.employeeCode,
    departmentName = this.departmentName, designationTitle = this.designationTitle,
    birthMd = this.birthMd, birthDisplay = this.birthDisplay, daysUntil = this.daysUntil,
    likeCount = likeCount, wishCount = wishCount, iLiked = iLiked, iWished = iWished,
    firstName = this.firstName, lastName = this.lastName, dateOfBirth = this.dateOfBirth,
    birthDay = this.birthDay, employeeId = this.employeeId, employeeName = this.employeeName,
    isToday = this.isToday, likes = this.likes, userLiked = this.userLiked
)