package com.krishihr.app.ui.chat

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Typeface
import android.net.Uri
import android.os.Environment
import android.view.*
import android.widget.*
import androidx.core.content.FileProvider
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.krishihr.app.data.api.RetrofitClient
import com.krishihr.app.data.models.ChatMessage
import com.krishihr.app.utils.SessionManager
import kotlinx.coroutines.*
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.*

class ChatMessageAdapter(
    private val myId: Int,
    private val onLongClick: (ChatMessage) -> Unit,
    private val onJoinCall: ((roomId: String, callType: String) -> Unit)? = null
) : ListAdapter<ChatMessage, ChatMessageAdapter.VH>(DIFF) {

    companion object {
        val DIFF = object : DiffUtil.ItemCallback<ChatMessage>() {
            override fun areItemsTheSame(a: ChatMessage, b: ChatMessage) = a.id == b.id
            override fun areContentsTheSame(a: ChatMessage, b: ChatMessage) = a == b
        }
        const val MINE_BG    = 0xFFD9FDD3.toInt()
        const val THEIR_BG   = 0xFFF0F0F0.toInt()
        const val WA_TEAL    = 0xFF128C7E.toInt()
        const val WA_TEXT    = 0xFF111B21.toInt()
        const val WA_GRAY    = 0xFF667781.toInt()
        const val WA_DELETED = 0xFF8696A0.toInt()
    }

    inner class VH(
        val root:        FrameLayout,
        val bubble:      LinearLayout,
        val tvSender:    TextView,
        val tvText:      TextView,
        // call card
        val callCard:    LinearLayout,
        val tvCallIcon:  TextView,
        val tvCallTitle: TextView,
        val tvCallSub:   TextView,
        val btnJoin:     TextView,
        // image card
        val imgCard:     FrameLayout,
        val ivImage:     ImageView,
        val btnDlImg:    TextView,
        // file card
        val fileCard:    LinearLayout,
        val tvFileIcon:  TextView,
        val tvFileName:  TextView,
        val tvFileSize:  TextView,
        val btnDlFile:   TextView,
        // meta: tvMeta = inline with text, tvMetaFile = below file/call cards
        val tvMeta:      TextView,
        val tvMetaFile:  TextView,
        // sender avatar (only shown for others' messages)
        val ivAvatar:    ImageView
    ) : RecyclerView.ViewHolder(root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val ctx = parent.context
        val dp  = ctx.resources.displayMetrics.density
        fun Int.dp() = (this * dp).toInt()
        val screenW = ctx.resources.displayMetrics.widthPixels

        val root = FrameLayout(ctx).apply {
            layoutParams = RecyclerView.LayoutParams(-1, -2).apply {
                topMargin = 2.dp(); bottomMargin = 2.dp()
            }
        }

        val bubble = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(10.dp(), 7.dp(), 10.dp(), 4.dp())
        }

        val tvSender = TextView(ctx).apply {
            textSize = 12f; setTextColor(WA_TEAL); typeface = Typeface.DEFAULT_BOLD
            visibility = View.GONE
            layoutParams = LinearLayout.LayoutParams(-2, -2).apply { bottomMargin = 2.dp() }
        }

        val tvText = TextView(ctx).apply {
            textSize = 15f; setTextColor(WA_TEXT); setLineSpacing(2f, 1f)
            visibility = View.GONE
        }

        // ── Call card ─────────────────────────────────────────────────────
        val callCard = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, 4.dp(), 0, 0); visibility = View.GONE
            layoutParams = LinearLayout.LayoutParams(-1, -2)
        }
        val callTop = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        }
        val tvCallIcon = TextView(ctx).apply {
            textSize = 32f; gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(46.dp(), 46.dp()).apply {
                background = android.graphics.drawable.GradientDrawable().apply {
                    shape = android.graphics.drawable.GradientDrawable.OVAL; setColor(0x22000000)
                }; marginEnd = 10.dp()
            }
        }
        val callTxtCol = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
        }
        val tvCallTitle = TextView(ctx).apply { textSize = 15f; setTextColor(WA_TEXT); typeface = Typeface.DEFAULT_BOLD }
        val tvCallSub   = TextView(ctx).apply { textSize = 13f; setTextColor(WA_GRAY) }
        callTxtCol.addView(tvCallTitle); callTxtCol.addView(tvCallSub)
        callTop.addView(tvCallIcon); callTop.addView(callTxtCol)
        val divLine = View(ctx).apply {
            setBackgroundColor(0x22000000)
            layoutParams = LinearLayout.LayoutParams(-1, 1.dp()).apply { topMargin = 8.dp() }
        }
        val btnJoin = TextView(ctx).apply {
            text = "JOIN CALL"; textSize = 14f; setTextColor(WA_TEAL); typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER; setPadding(0, 8.dp(), 0, 2.dp())
            layoutParams = LinearLayout.LayoutParams(-1, -2)
        }
        callCard.addView(callTop); callCard.addView(divLine); callCard.addView(btnJoin)

        // ── Image card (WhatsApp style) ───────────────────────────────────
        val imgCard = FrameLayout(ctx).apply {
            visibility = View.GONE
            outlineProvider = android.view.ViewOutlineProvider.BACKGROUND
            clipToOutline = true
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(0xFFE8E8E8.toInt()); cornerRadius = 12f * dp
            }
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply {
                topMargin = 0; bottomMargin = 0
            }
        }
        val ivImage = ImageView(ctx).apply {
            scaleType = ImageView.ScaleType.FIT_CENTER
            adjustViewBounds = true
            layoutParams = FrameLayout.LayoutParams(-1, -2)
        }
        // Time overlay on image (WhatsApp style)
        val imgTimeOverlay = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(0x55000000.toInt()); cornerRadius = 10f * dp
            }
            setPadding(6.dp(), 2.dp(), 6.dp(), 2.dp())
            layoutParams = FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM or Gravity.END).apply {
                marginEnd = 6.dp(); bottomMargin = 6.dp()
            }
        }
        val btnDlImg = TextView(ctx).apply {
            text = "⬇"; textSize = 14f; setTextColor(0xFFFFFFFF.toInt()); gravity = Gravity.CENTER
            background = android.graphics.drawable.GradientDrawable().apply {
                shape = android.graphics.drawable.GradientDrawable.OVAL
                setColor(0x88000000.toInt()); setSize(34.dp(), 34.dp())
            }
            layoutParams = FrameLayout.LayoutParams(34.dp(), 34.dp(), Gravity.BOTTOM or Gravity.END).apply {
                marginEnd = 6.dp(); bottomMargin = 28.dp()  // above the time overlay
            }
        }
        imgCard.addView(ivImage); imgCard.addView(imgTimeOverlay); imgCard.addView(btnDlImg)

        // ── File card (WhatsApp style) ────────────────────────────────────
        val fileCard = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, 0, 0, 0); visibility = View.GONE
            background = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = 10f * dp
            }
            layoutParams = LinearLayout.LayoutParams(-1, -2)
        }
        // Top row: icon + name/size
        val fileTopRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(10.dp(), 10.dp(), 10.dp(), 8.dp())
        }
        val tvFileIcon = TextView(ctx).apply {
            textSize = 30f; gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(46.dp(), 46.dp()).apply { marginEnd = 10.dp() }
        }
        val fileInfo = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
        }
        val tvFileName = TextView(ctx).apply {
            textSize = 14f; setTextColor(WA_TEXT); typeface = Typeface.DEFAULT_BOLD
            maxLines = 2; ellipsize = android.text.TextUtils.TruncateAt.MIDDLE
            layoutParams = LinearLayout.LayoutParams(-1, -2)
        }
        val tvFileSize = TextView(ctx).apply {
            textSize = 12f; setTextColor(WA_GRAY)
            layoutParams = LinearLayout.LayoutParams(-2, -2)
        }
        fileInfo.addView(tvFileName); fileInfo.addView(tvFileSize)
        fileTopRow.addView(tvFileIcon); fileTopRow.addView(fileInfo)
        // Divider
        val fileDivider = View(ctx).apply {
            setBackgroundColor(0x22000000)
            layoutParams = LinearLayout.LayoutParams(-1, 1.dp())
        }
        // Download button row
        val btnDlFile = TextView(ctx).apply {
            text = "Download"; textSize = 14f; setTextColor(WA_TEAL)
            typeface = Typeface.DEFAULT_BOLD; gravity = Gravity.CENTER
            setPadding(0, 10.dp(), 0, 10.dp())
            layoutParams = LinearLayout.LayoutParams(-1, -2)
        }
        fileCard.addView(fileTopRow); fileCard.addView(fileDivider); fileCard.addView(btnDlFile)

        // ── Meta row ──────────────────────────────────────────────────────
        val metaRow = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.END
            layoutParams = LinearLayout.LayoutParams(-2, -2).apply { topMargin = 2.dp() }
        }
        val tvMeta = TextView(ctx).apply { textSize = 11f; setTextColor(WA_GRAY) }
        val tvMetaFile = TextView(ctx).apply { textSize = 11f; setTextColor(WA_GRAY) }
        metaRow.addView(tvMetaFile)

        bubble.addView(tvSender); bubble.addView(tvText); bubble.addView(callCard)
        bubble.addView(imgCard); bubble.addView(fileCard); bubble.addView(metaRow)

        // ── Sender avatar circle (shown left of others' messages) ─────────
        val ivAvatar = ImageView(ctx).apply {
            val size = 32.dp()
            layoutParams = FrameLayout.LayoutParams(size, size, Gravity.START or Gravity.BOTTOM).apply {
                marginStart = 4.dp()
                bottomMargin = 2.dp()
            }
            scaleType = ImageView.ScaleType.CENTER_CROP
            background = android.graphics.drawable.GradientDrawable().apply {
                shape = android.graphics.drawable.GradientDrawable.OVAL
                setColor(0xFF2E7D32.toInt())
            }
            outlineProvider = android.view.ViewOutlineProvider.BACKGROUND
            clipToOutline = true
            visibility = View.GONE
        }

        (bubble.layoutParams as? FrameLayout.LayoutParams)?.marginStart = 44.dp()

        root.addView(ivAvatar)
        root.addView(bubble)

        return VH(root, bubble, tvSender, tvText, callCard, tvCallIcon, tvCallTitle, tvCallSub, btnJoin,
            imgCard, ivImage, btnDlImg, fileCard, tvFileIcon, tvFileName, tvFileSize, btnDlFile, tvMeta, tvMetaFile, ivAvatar)
    }

    override fun onBindViewHolder(holder: VH, position: Int) {
        val msg = getItem(position)
        val ctx = holder.root.context
        val dp  = ctx.resources.displayMetrics.density
        fun Int.dp() = (this * dp).toInt()
        val isMine  = msg.senderId == myId
        val screenW = ctx.resources.displayMetrics.widthPixels

        val isImg  = msg.messageType == "image"
        val isFile = msg.messageType == "file" || msg.messageType == "audio" || msg.messageType == "video"
        val maxW   = (screenW * 0.75f).toInt()

        val lp = FrameLayout.LayoutParams(if (isFile || isImg) maxW else -2, -2)
        lp.topMargin = 2.dp(); lp.bottomMargin = 2.dp()

        if (isMine) {
            lp.gravity    = Gravity.END
            lp.marginEnd  = 8.dp()
            lp.marginStart = 8.dp()
            if (isImg) {
                holder.bubble.background = null
                holder.bubble.setBackgroundColor(0x00000000)
            } else {
                holder.bubble.background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(MINE_BG)
                    cornerRadii = floatArrayOf(12f,12f,2f,12f,12f,12f,12f,12f).map{it*dp}.toFloatArray()
                }
            }
            holder.tvSender.visibility = View.GONE
            holder.ivAvatar.visibility = View.GONE
        } else {
            lp.gravity     = Gravity.START
            lp.marginStart = 8.dp()
            lp.marginEnd   = 8.dp()
            if (isImg) {
                holder.bubble.background = null
                holder.bubble.setBackgroundColor(0x00000000)
            } else {
                holder.bubble.background = android.graphics.drawable.GradientDrawable().apply {
                    setColor(THEIR_BG)
                    cornerRadii = floatArrayOf(2f,12f,12f,12f,12f,12f,12f,12f).map{it*dp}.toFloatArray()
                }
            }
            if (!msg.senderName.isNullOrBlank() && !isImg) {
                holder.tvSender.text = msg.senderName; holder.tvSender.visibility = View.VISIBLE
            } else holder.tvSender.visibility = View.GONE

            holder.ivAvatar.visibility = View.VISIBLE
            val photoUrl = msg.senderPhoto
            if (!photoUrl.isNullOrBlank()) {
                com.bumptech.glide.Glide.with(ctx)
                    .load(photoUrl)
                    .circleCrop()
                    .placeholder(android.R.color.transparent)
                    .into(holder.ivAvatar)
            } else {
                val initials = msg.senderName
                    ?.split(" ")?.take(2)?.mapNotNull { it.firstOrNull()?.uppercaseChar() }
                    ?.joinToString("") ?: "?"
                holder.ivAvatar.setImageBitmap(
                    android.graphics.Bitmap.createBitmap(32.dp(), 32.dp(), android.graphics.Bitmap.Config.ARGB_8888).also { bmp ->
                        val canvas = android.graphics.Canvas(bmp)
                        val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
                            color = 0xFF2E7D32.toInt(); style = android.graphics.Paint.Style.FILL
                        }
                        canvas.drawCircle(bmp.width/2f, bmp.height/2f, bmp.width/2f, paint)
                        paint.color = 0xFFFFFFFF.toInt()
                        paint.textSize = bmp.width * 0.38f
                        paint.textAlign = android.graphics.Paint.Align.CENTER
                        val textY = bmp.height/2f - (paint.descent() + paint.ascent()) / 2
                        canvas.drawText(initials, bmp.width/2f, textY, paint)
                    }
                )
            }
        }
        holder.bubble.layoutParams = lp

        holder.tvText.visibility   = View.GONE
        holder.callCard.visibility = View.GONE
        holder.imgCard.visibility  = View.GONE
        holder.fileCard.visibility = View.GONE
        holder.ivImage.setImageBitmap(null)
        holder.bubble.setPadding(10.dp(), 7.dp(), 10.dp(), 5.dp())

        val content  = msg.content ?: ""
        val fileUrl  = buildFullUrl(msg.fileUrl, ctx)
        val fileName = msg.fileName ?: msg.fileUrl?.substringAfterLast("/") ?: "file"
        val fileSize = msg.fileSize?.let { fmtBytes(it) } ?: ""

        val token = try { SessionManager(ctx).getToken() } catch (_: Exception) { null }

        when {
            msg.isDeleted -> {
                holder.tvText.visibility = View.VISIBLE
                holder.tvText.text = "🚫 This message was deleted"
                holder.tvText.setTextColor(WA_DELETED)
                holder.tvText.setTypeface(null, Typeface.ITALIC)
            }

            isCallMsg(content) -> {
                holder.callCard.visibility = View.VISIBLE
                val isVideo = content.contains("video", ignoreCase = true) || content.contains("📹")
                holder.tvCallIcon.text  = if (isVideo) "📹" else "📞"
                holder.tvCallTitle.text = if (isVideo) "Video call" else "Voice call"
                holder.tvCallSub.text   = "Tap to join"
                holder.btnJoin.setOnClickListener {
                    android.widget.Toast.makeText(ctx, "Meetings removed", android.widget.Toast.LENGTH_SHORT).show()
                }
            }

            msg.messageType == "image" -> {
                holder.imgCard.visibility = View.VISIBLE
                holder.bubble.setPadding(0, 0, 0, 0)
                holder.bubble.setBackgroundColor(0x00000000)
                if (!fileUrl.isNullOrBlank()) {
                    // Load image thumbnail with auth token
                    CoroutineScope(Dispatchers.IO).launch {
                        try {
                            val conn = (URL(fileUrl).openConnection() as HttpURLConnection).also {
                                it.connectTimeout = 15_000
                                it.readTimeout    = 30_000
                                if (token != null) it.setRequestProperty("Authorization", "Bearer $token")
                                it.connect()
                            }
                            val bmp = BitmapFactory.decodeStream(conn.inputStream)
                            withContext(Dispatchers.Main) {
                                if (holder.adapterPosition == position) holder.ivImage.setImageBitmap(bmp)
                            }
                        } catch (_: Exception) {}
                    }
                    // FIX: tap image → download to cache → open via FileProvider (no browser tab)
                    holder.ivImage.setOnClickListener {
                        openFileInApp(ctx, fileUrl, fileName, token)
                    }
                    // FIX: download button → use DownloadManager (works on all Android versions)
                    holder.btnDlImg.setOnClickListener {
                        downloadWithManager(ctx, fileUrl, fileName, token)
                    }
                }
            }

            msg.messageType == "file" || msg.messageType == "audio" || msg.messageType == "video" -> {
                holder.fileCard.visibility = View.VISIBLE
                holder.tvFileIcon.text  = fileTypeIcon(msg.fileMime ?: "")
                holder.tvFileName.text  = fileName
                holder.tvFileSize.text  = (msg.fileMime?.uppercase()?.substringBefore("/") ?: "FILE") +
                        (if (fileSize.isNotBlank()) " · $fileSize" else "")
                if (!fileUrl.isNullOrBlank()) {
                    val mime = msg.fileMime ?: "application/octet-stream"
                    // FIX: tap card or Download button → DownloadManager
                    holder.fileCard.setOnClickListener {
                        downloadWithManager(ctx, fileUrl, fileName, token)
                    }
                    holder.btnDlFile.text = "Download"
                    holder.btnDlFile.visibility = View.VISIBLE
                    holder.btnDlFile.setOnClickListener {
                        downloadWithManager(ctx, fileUrl, fileName, token)
                    }
                }
            }

            else -> {
                holder.tvText.visibility = View.VISIBLE
                holder.tvText.text = content
                holder.tvText.setTextColor(WA_TEXT)
                holder.tvText.setTypeface(null, Typeface.NORMAL)
            }
        }

        val tick = if (isMine) when (msg.status) {
            "seen"      -> " ✓✓"
            "delivered" -> " ✓✓"
            else        -> " ✓"
        } else ""
        val timeStr = "${fmtTime(msg.createdAt)}$tick"
        if (msg.messageType == "image") {
            holder.tvMeta.text = ""
            val overlay = (holder.imgCard as? FrameLayout)?.getChildAt(1) as? LinearLayout
            overlay?.removeAllViews()
            overlay?.addView(TextView(ctx).apply {
                text = timeStr; textSize = 11f; setTextColor(0xFFFFFFFF.toInt())
            })
        } else {
            holder.tvMeta.text = timeStr
            holder.tvMetaFile.text = timeStr
            holder.tvMeta.setTextColor(if (isMine && msg.status == "seen") WA_TEAL else WA_GRAY)
            holder.tvMetaFile.setTextColor(if (isMine && msg.status == "seen") WA_TEAL else WA_GRAY)
        }
        holder.root.setOnLongClickListener { onLongClick(msg); true }
    }

    private fun buildFullUrl(fileUrl: String?, ctx: Context): String? {
        if (fileUrl.isNullOrBlank()) return null
        if (fileUrl.startsWith("http")) return fileUrl
        val base = RetrofitClient.BASE_URL.removeSuffix("/api/").removeSuffix("/api")
        return "$base$fileUrl"
    }

    /**
     * Downloads file to Downloads/KrishiHR/Attachments/.
     * Uses MediaStore on Android 10+ (API 29+), File API on older devices.
     * No BroadcastReceiver — pure coroutine, no crash.
     */
    private fun downloadWithManager(ctx: Context, url: String, fileName: String, token: String?) {
        val safeFileName = fileName.replace("[^a-zA-Z0-9._\\-() ]".toRegex(), "_")
        Toast.makeText(ctx, "⬇ Downloading $safeFileName…", Toast.LENGTH_SHORT).show()

        CoroutineScope(Dispatchers.IO).launch {
            try {
                // Step 1: fetch bytes with auth header
                val conn = (URL(url).openConnection() as HttpURLConnection).also {
                    it.connectTimeout = 15_000
                    it.readTimeout    = 120_000
                    if (token != null) it.setRequestProperty("Authorization", "Bearer $token")
                    it.connect()
                }
                if (conn.responseCode !in 200..299) {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(ctx, "❌ Server error ${conn.responseCode}", Toast.LENGTH_LONG).show()
                    }
                    return@launch
                }
                val bytes = conn.inputStream.readBytes()
                val mimeFromServer = conn.contentType?.substringBefore(";")?.trim()

                // Step 2: save via MediaStore (Android 10+) or File API (Android 9-)
                val savedUri: android.net.Uri? = if (android.os.Build.VERSION.SDK_INT >= 29) {
                    saveViaMediaStore(ctx, safeFileName, bytes, mimeFromServer)
                } else {
                    saveViaFileApi(ctx, safeFileName, bytes)
                }

                withContext(Dispatchers.Main) {
                    if (savedUri != null) {
                        Toast.makeText(ctx,
                            "✅ Saved: Downloads/KrishiHR/Attachments/$safeFileName",
                            Toast.LENGTH_LONG).show()
                        // Try to open — silently ignore if no app handles it
                        try {
                            val mime = mimeFromServer ?: ctx.contentResolver.getType(savedUri) ?: "application/octet-stream"
                            ctx.startActivity(Intent(Intent.ACTION_VIEW).apply {
                                setDataAndType(savedUri, mime)
                                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                            })
                        } catch (_: Exception) {}
                    } else {
                        Toast.makeText(ctx, "❌ Save failed — check storage permission", Toast.LENGTH_LONG).show()
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(ctx, "❌ Download failed: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    /** Android 10+ (API 29+): save to Downloads/KrishiHR/Attachments via MediaStore */
    private fun saveViaMediaStore(ctx: Context, fileName: String, bytes: ByteArray, mime: String?): android.net.Uri? {
        val resolver = ctx.contentResolver
        val effectiveMime = mime ?: "application/octet-stream"
        // Try paths in order; some OEMs (MIUI, ColorOS) reject nested subfolders
        val paths = listOf("Download/KrishiHR/Attachments", "Download/KrishiHR", "Download")
        for (subPath in paths) {
            val uri = tryInsertMediaStore(resolver, fileName, effectiveMime, subPath, bytes)
            if (uri != null) return uri
        }
        return null
    }

    private fun tryInsertMediaStore(
        resolver: android.content.ContentResolver,
        fileName: String,
        mime: String,
        relativePath: String,
        bytes: ByteArray
    ): android.net.Uri? {
        return try {
            val values = android.content.ContentValues().apply {
                put(android.provider.MediaStore.Downloads.DISPLAY_NAME, fileName)
                put(android.provider.MediaStore.Downloads.MIME_TYPE, mime)
                put(android.provider.MediaStore.Downloads.RELATIVE_PATH, relativePath)
                put(android.provider.MediaStore.Downloads.IS_PENDING, 1)
            }
            val col = android.provider.MediaStore.Downloads
                .getContentUri(android.provider.MediaStore.VOLUME_EXTERNAL_PRIMARY)
            val uri = resolver.insert(col, values) ?: return null
            val written = resolver.openOutputStream(uri)?.use { it.write(bytes); true } ?: false
            if (!written) {
                resolver.delete(uri, null, null)
                return null
            }
            val upd = android.content.ContentValues().apply {
                put(android.provider.MediaStore.Downloads.IS_PENDING, 0)
            }
            resolver.update(uri, upd, null, null)
            uri
        } catch (_: Exception) { null }
    }

    /** Android 9 and below: save to Downloads/KrishiHR/Attachments via File API */
    private fun saveViaFileApi(ctx: Context, fileName: String, bytes: ByteArray): android.net.Uri? {
        return try {
            val saveDir = File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                "KrishiHR/Attachments"
            )
            saveDir.mkdirs()
            var dest = File(saveDir, fileName)
            var n = 1
            while (dest.exists()) {
                val dot = fileName.lastIndexOf('.')
                dest = if (dot >= 0)
                    File(saveDir, fileName.substring(0, dot) + "($n)" + fileName.substring(dot))
                else File(saveDir, "$fileName($n)")
                n++
            }
            FileOutputStream(dest).use { it.write(bytes) }
            ctx.sendBroadcast(Intent(Intent.ACTION_MEDIA_SCANNER_SCAN_FILE, Uri.fromFile(dest)))
            FileProvider.getUriForFile(ctx, "${ctx.packageName}.provider", dest)
        } catch (e: Exception) { null }
    }

    /**
     * FIX: Open image/file in-app (no browser).
     * Downloads to app cache, then opens via FileProvider so the viewer stays inside
     * the device's gallery/PDF app — not Chrome.
     */
    private fun openFileInApp(ctx: Context, url: String, fileName: String, token: String?) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val conn = (URL(url).openConnection() as HttpURLConnection).also {
                    it.connectTimeout = 15_000
                    it.readTimeout    = 60_000
                    if (token != null) it.setRequestProperty("Authorization", "Bearer $token")
                    it.connect()
                }
                if (conn.responseCode !in 200..299) {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(ctx, "❌ Could not open file (${conn.responseCode})", Toast.LENGTH_LONG).show()
                    }
                    return@launch
                }
                val bytes = conn.inputStream.readBytes()
                val mime  = conn.contentType?.substringBefore(";")?.trim() ?: "application/octet-stream"

                // Write to cache dir — FileProvider can expose it without WRITE_EXTERNAL_STORAGE
                val cacheDir = File(ctx.cacheDir, "chat_files").also { it.mkdirs() }
                val safeFile = File(cacheDir, fileName.replace("[^a-zA-Z0-9._\\-() ]".toRegex(), "_"))
                FileOutputStream(safeFile).use { it.write(bytes) }

                val fileUri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.provider", safeFile)

                withContext(Dispatchers.Main) {
                    try {
                        ctx.startActivity(Intent(Intent.ACTION_VIEW).apply {
                            setDataAndType(fileUri, mime)
                            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                        })
                    } catch (_: Exception) {
                        // Fallback: no app can handle this mime — offer download
                        Toast.makeText(ctx, "No app to open this file. Downloading instead…", Toast.LENGTH_SHORT).show()
                        downloadWithManager(ctx, url, fileName, token)
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(ctx, "❌ Open failed: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun fileTypeIcon(mime: String) = when {
        mime.contains("pdf")        -> "📄"
        mime.contains("word")       -> "📝"
        mime.contains("excel") || mime.contains("spreadsheet") -> "📊"
        mime.contains("powerpoint") || mime.contains("presentation") -> "📑"
        mime.contains("zip") || mime.contains("rar") -> "🗜️"
        mime.contains("audio")      -> "🎵"
        mime.contains("video")      -> "🎬"
        mime.contains("image")      -> "🖼️"
        mime.contains("text")       -> "📃"
        else                        -> "📎"
    }

    private fun fmtBytes(b: Long) = when {
        b >= 1_073_741_824L -> "%.1f GB".format(b / 1_073_741_824f)
        b >= 1_048_576L     -> "%.1f MB".format(b / 1_048_576f)
        b >= 1_024L         -> "%.1f KB".format(b / 1_024f)
        else                -> "$b B"
    }

    private fun isCallMsg(c: String) =
        c.contains("Video Call", ignoreCase = true) ||
                c.contains("Voice Call", ignoreCase = true) ||
                c.contains("Audio Call", ignoreCase = true) ||
                c.contains("Tap to join", ignoreCase = true) ||
                c.contains("meet.jit.si", ignoreCase = true) ||
                (c.contains("📹") && c.contains("started", ignoreCase = true)) ||
                (c.contains("📞") && c.contains("started", ignoreCase = true))

    private fun extractRoom(c: String, msg: ChatMessage): String {
        Regex("""meet\.jit\.si/([\w-]+)""").find(c)?.groupValues?.get(1)?.let { return it }
        Regex("""call_[\d]+_[\w]+""").find(c)?.value?.let { return it }
        Regex("""call-\d+-\d+""").find(c)?.value?.let { return it }
        return "call_${msg.groupId}_${msg.senderId}"
    }

    private fun fmtTime(iso: String?): String {
        if (iso.isNullOrBlank()) return ""
        return try {
            val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault()).apply { timeZone = TimeZone.getTimeZone("UTC") }
            val d = sdf.parse(iso.substringBefore(".").replace(" ","T")) ?: return ""
            SimpleDateFormat("h:mm a", Locale.getDefault()).apply { timeZone = TimeZone.getDefault() }.format(d)
        } catch (_: Exception) { "" }
    }
}