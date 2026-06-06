package com.krishihr.app.ui.more

import android.os.Bundle
import android.view.*
import android.widget.*
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.krishihr.app.R
import com.krishihr.app.data.api.RetrofitClient
import com.krishihr.app.data.models.Holiday
import com.krishihr.app.utils.toDisplayDate
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*

class HolidaysFragment : Fragment() {

    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View {
        val ctx = requireContext(); val dp = ctx.resources.displayMetrics.density
        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(ctx.getColor(R.color.background))
        }

        // Header
        root.addView(LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            setBackgroundColor(ctx.getColor(R.color.primary))
            setPadding((16*dp).toInt(),(16*dp).toInt(),(16*dp).toInt(),(16*dp).toInt())
            addView(TextView(ctx).apply {
                val year = Calendar.getInstance().get(Calendar.YEAR)
                text = "🏖️  Holidays $year"; textSize = 20f
                setTypeface(null, android.graphics.Typeface.BOLD)
                setTextColor(ctx.getColor(R.color.white))
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            })
            // Remaining count badge
            addView(TextView(ctx).apply {
                id = android.R.id.text1
                textSize = 12f; setTextColor(ctx.getColor(R.color.primary_ultra_light))
            })
        })

        val progress = ProgressBar(ctx).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).also {
                it.gravity = android.view.Gravity.CENTER_HORIZONTAL; it.topMargin = (24*dp).toInt()
            }
        }
        root.addView(progress)

        val rv = RecyclerView(ctx).apply {
            layoutManager = LinearLayoutManager(ctx)
            setPadding((8*dp).toInt(), (4*dp).toInt(), (8*dp).toInt(), (80*dp).toInt())
            clipToPadding = false; visibility = View.GONE
        }
        root.addView(rv)

        lifecycleScope.launch {
            try {
                val year = Calendar.getInstance().get(Calendar.YEAR)
                val res = RetrofitClient.instance.getHolidays(year)
                progress.visibility = View.GONE
                val holidays = res.body()?.data ?: emptyList()

                // Count remaining
                val remaining = holidays.count { !it.isPast }
                root.findViewById<TextView>(android.R.id.text1)?.text =
                    "$remaining remaining"

                rv.adapter = HolidayAdapter(holidays)
                rv.visibility = View.VISIBLE
            } catch (_: Exception) {
                progress.visibility = View.GONE
            }
        }
        return root
    }
}

class HolidayAdapter(private val items: List<Holiday>) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {

    // Build list with month headers
    private val rows: List<Any> = buildList {
        var lastMonth = ""
        items.forEach { h ->
            val month = try {
                val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
                val d = sdf.parse(h.date)
                SimpleDateFormat("MMM", Locale.getDefault()).format(d!!)
            } catch (_: Exception) { "" }
            if (month != lastMonth) { add(month); lastMonth = month }
            add(h)
        }
    }

    companion object { const val TYPE_HEADER = 0; const val TYPE_ITEM = 1 }
    override fun getItemViewType(pos: Int) = if (rows[pos] is String) TYPE_HEADER else TYPE_ITEM
    override fun getItemCount() = rows.size

    override fun onCreateViewHolder(p: ViewGroup, t: Int): RecyclerView.ViewHolder {
        val ctx = p.context; val dp = ctx.resources.displayMetrics.density
        return if (t == TYPE_HEADER) {
            val tv = TextView(ctx).apply {
                textSize = 12f; setTypeface(null, android.graphics.Typeface.BOLD)
                setTextColor(ctx.getColor(R.color.text_hint))
                setPadding((16*dp).toInt(), (14*dp).toInt(), (16*dp).toInt(), (4*dp).toInt())
                layoutParams = RecyclerView.LayoutParams(RecyclerView.LayoutParams.MATCH_PARENT, RecyclerView.LayoutParams.WRAP_CONTENT)
            }
            object : RecyclerView.ViewHolder(tv) {}
        } else {
            val card = androidx.cardview.widget.CardView(ctx).apply {
                radius = 14*dp; cardElevation = 2*dp
                layoutParams = RecyclerView.LayoutParams(RecyclerView.LayoutParams.MATCH_PARENT, RecyclerView.LayoutParams.WRAP_CONTENT)
                    .also { it.setMargins(0, 0, 0, (6*dp).toInt()) }
            }
            object : RecyclerView.ViewHolder(card) {}
        }
    }

    override fun onBindViewHolder(h: RecyclerView.ViewHolder, pos: Int) {
        val ctx = h.itemView.context; val dp = ctx.resources.displayMetrics.density
        if (rows[pos] is String) {
            (h.itemView as TextView).text = (rows[pos] as String).uppercase()
            return
        }
        val holiday = rows[pos] as Holiday
        val card = h.itemView as androidx.cardview.widget.CardView
        card.removeAllViews()

        // Dim past holidays
        card.alpha = if (holiday.isPast) 0.5f else 1.0f
        card.setCardBackgroundColor(ctx.getColor(if (!holiday.isPast) R.color.surface else R.color.background))

        val row = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            setPadding((14*dp).toInt(), (14*dp).toInt(), (14*dp).toInt(), (14*dp).toInt())
        }

        // Date badge
        val dateBadge = androidx.cardview.widget.CardView(ctx).apply {
            radius = 10*dp; cardElevation = 0f
            setCardBackgroundColor(ctx.getColor(if (!holiday.isPast) R.color.primary_ultra_light else R.color.divider))
            layoutParams = LinearLayout.LayoutParams((52*dp).toInt(), (52*dp).toInt()).also { it.marginEnd = (14*dp).toInt() }
        }
        val dateLL = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL; gravity = android.view.Gravity.CENTER
            layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        }
        try {
            val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
            val d = sdf.parse(holiday.date)!!
            val dayNum  = SimpleDateFormat("d",   Locale.getDefault()).format(d)
            val dayName = SimpleDateFormat("EEE", Locale.getDefault()).format(d)
            dateLL.addView(TextView(ctx).apply {
                text = dayNum; textSize = 18f; setTypeface(null, android.graphics.Typeface.BOLD)
                setTextColor(ctx.getColor(if (!holiday.isPast) R.color.primary else R.color.text_hint))
                gravity = android.view.Gravity.CENTER
            })
            dateLL.addView(TextView(ctx).apply {
                text = dayName.uppercase(); textSize = 9f
                setTextColor(ctx.getColor(R.color.text_hint))
                gravity = android.view.Gravity.CENTER
            })
        } catch (_: Exception) {
            dateLL.addView(TextView(ctx).apply { text = holiday.date.take(5); textSize = 12f; gravity = android.view.Gravity.CENTER })
        }
        dateBadge.addView(dateLL); row.addView(dateBadge)

        // Name + type
        val info = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        info.addView(TextView(ctx).apply {
            text = holiday.name; textSize = 15f
            setTypeface(null, if (!holiday.isPast) android.graphics.Typeface.BOLD else android.graphics.Typeface.NORMAL)
            setTextColor(ctx.getColor(if (!holiday.isPast) R.color.text_primary else R.color.text_hint))
        })
        if (!holiday.description.isNullOrBlank()) {
            info.addView(TextView(ctx).apply {
                text = holiday.description; textSize = 12f
                setTextColor(ctx.getColor(R.color.text_secondary))
                setPadding(0, (2*dp).toInt(), 0, 0)
            })
        }
        row.addView(info)

        // Type pill
        val typeColor = when(holiday.type?.lowercase()) {
            "national" -> android.graphics.Color.parseColor("#2E7D45")
            "regional" -> android.graphics.Color.parseColor("#E65100")
            else       -> android.graphics.Color.parseColor("#1565C0")
        }
        row.addView(TextView(ctx).apply {
            text = holiday.type?.replaceFirstChar { it.uppercase() } ?: "Holiday"
            textSize = 10f; setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(android.graphics.Color.WHITE)
            setPadding((8*dp).toInt(), (3*dp).toInt(), (8*dp).toInt(), (3*dp).toInt())
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(typeColor); cornerRadius = 20*dp
                if (holiday.isPast) alpha = 128
            }
        })

        card.addView(row)
    }
}
