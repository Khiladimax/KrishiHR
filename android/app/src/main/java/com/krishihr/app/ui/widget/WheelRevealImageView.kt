package com.krishihr.app.ui.widget

import android.content.Context
import android.graphics.*
import android.util.AttributeSet
import androidx.appcompat.widget.AppCompatImageView

/**
 * Reveals its image using a PowerPoint-style "Wheel" effect.
 * Spokes sweep in one by one (4 spokes = 4 segments of 90°) until fully revealed.
 *
 * Usage in code:
 *   wheelView.startWheelReveal(durationMs = 900L) {
 *       // optional: called when reveal is complete
 *   }
 */
class WheelRevealImageView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : AppCompatImageView(context, attrs, defStyleAttr) {

    private val maskPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_IN)
    }

    private val maskBitmap: Bitmap by lazy {
        Bitmap.createBitmap(width.coerceAtLeast(1), height.coerceAtLeast(1), Bitmap.Config.ARGB_8888)
    }
    private val maskCanvas: Canvas by lazy { Canvas(maskBitmap) }

    private val sweepPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.BLACK
        style = Paint.Style.FILL
    }

    // 0f = nothing shown, 360f = fully shown
    private var sweepAngle: Float = 0f

    // Number of spokes (PowerPoint default = 4)
    private val spokeCount = 4
    private val segmentAngle = 360f / spokeCount  // 90° per spoke

    private var animatorJob: android.animation.ValueAnimator? = null

    override fun onDraw(canvas: Canvas) {
        if (sweepAngle >= 360f) {
            // Fully revealed — draw normally, no masking overhead
            super.onDraw(canvas)
            return
        }

        // Draw into an offscreen layer so we can apply DST_IN mask
        val sc = canvas.saveLayer(0f, 0f, width.toFloat(), height.toFloat(), null)

        // Draw the actual image
        super.onDraw(canvas)

        // Build the mask: draw N spoke-sweep segments rotated evenly
        maskBitmap.eraseColor(Color.TRANSPARENT)
        val cx = width / 2f
        val cy = height / 2f
        val radius = maxOf(width, height).toFloat()  // large enough to cover corners
        val rectF = RectF(cx - radius, cy - radius, cx + radius, cy + radius)

        for (i in 0 until spokeCount) {
            val startAngle = -90f + i * segmentAngle   // start each spoke from top
            maskCanvas.drawArc(rectF, startAngle, sweepAngle.coerceAtMost(segmentAngle), true, sweepPaint)
        }

        canvas.drawBitmap(maskBitmap, 0f, 0f, maskPaint)
        canvas.restoreToCount(sc)
    }

    /**
     * Kick off the wheel reveal animation.
     * @param durationMs  total duration of the reveal (default 800ms)
     * @param onDone      optional callback when fully revealed
     */
    fun startWheelReveal(durationMs: Long = 800L, onDone: (() -> Unit)? = null) {
        sweepAngle = 0f
        animatorJob?.cancel()
        animatorJob = android.animation.ValueAnimator.ofFloat(0f, segmentAngle).apply {
            duration = durationMs
            interpolator = android.view.animation.DecelerateInterpolator(1.2f)
            addUpdateListener { anim ->
                sweepAngle = anim.animatedValue as Float
                invalidate()
            }
            addListener(object : android.animation.AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: android.animation.Animator) {
                    sweepAngle = 360f
                    invalidate()
                    onDone?.invoke()
                }
            })
            start()
        }
    }

    override fun onDetachedFromWindow() {
        animatorJob?.cancel()
        super.onDetachedFromWindow()
    }
}
