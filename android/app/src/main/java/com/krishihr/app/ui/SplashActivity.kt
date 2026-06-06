package com.krishihr.app.ui

import com.krishihr.app.AndroidMain
import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import android.view.animation.AnimationUtils
import android.widget.ImageView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.lifecycleScope
import com.krishihr.app.R
import com.krishihr.app.data.api.RetrofitClient
import com.krishihr.app.ui.login.LoginActivity
import com.krishihr.app.ui.widget.WheelRevealImageView
import com.krishihr.app.utils.SessionManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

class SplashActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        val splashScreen = installSplashScreen()
        splashScreen.setKeepOnScreenCondition { false }

        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(R.layout.activity_splash)

        val session = SessionManager(this)
        RetrofitClient.init(session, this)

        val ivLogo      = findViewById<WheelRevealImageView>(R.id.ivLogo)
        val tvTagline   = findViewById<TextView>(R.id.tvTagline)
        val tvStatus    = findViewById<TextView>(R.id.tvStatus)
        val ivWheel     = findViewById<ImageView>(R.id.ivWheel)
        val tvVersion   = findViewById<TextView>(R.id.tvVersion)

        try {
            val versionName = packageManager.getPackageInfo(packageName, 0).versionName
            tvVersion.text = "v$versionName"
        } catch (_: Exception) { tvVersion.text = "v1.0.0" }

        // ── Logo: PowerPoint Wheel reveal ─────────────────────────────────────
        ivLogo.post {
            ivLogo.startWheelReveal(durationMs = 900L) {
                runOnUiThread {
                    tvTagline.alpha = 0f
                    tvTagline.translationY = 16f
                    tvTagline.animate().alpha(1f).translationY(0f)
                        .setDuration(350).start()
                }
            }
        }

        // ── Wheel + status fade in together, status text already set to "Connecting…" in XML ──
        // We just fade them in — NO text change, so no blink at all on first appear
        ivWheel.animate().alpha(1f).setDuration(300).setStartDelay(800)
            .withEndAction {
                val spinAnim = AnimationUtils.loadAnimation(this, R.anim.rotate_wheel)
                ivWheel.startAnimation(spinAnim)
            }.start()

        tvStatus.animate().alpha(1f).setDuration(300).setStartDelay(800).start()

        // ── Connection flow ───────────────────────────────────────────────────
        lifecycleScope.launch {
            val minShowJob = launch { delay(1800) } // minimum splash show time

            delay(800) // let logo animation play first
            val connected = wakeUpServer(tvStatus)

            minShowJob.join() // ensure minimum display time

            setStatus(tvStatus, if (connected) "Loading your workspace..." else "Starting up…")
            ivWheel.animate().alpha(0f).setDuration(200).start()
            delay(300L)

            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

            val intent = if (session.isLoggedIn()) {
                Intent(this@SplashActivity, MainActivity::class.java).apply {
                    this@SplashActivity.intent?.data?.let { dl ->
                        data = dl; action = Intent.ACTION_VIEW
                    }
                }
            } else {
                Intent(this@SplashActivity, LoginActivity::class.java)
            }
            startActivity(intent)
            finish()
            overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
        }
    }

    /**
     * Changes status text with a smooth upward slide — new text slides in from below.
     * Old text slides out upward. No full disappear = no blink.
     */
    private suspend fun setStatus(tv: TextView, msg: String) {
        withContext(Dispatchers.Main) {
            tv.animate().cancel()
            // Slide old text out upward while fading
            tv.animate()
                .alpha(0f)
                .translationY(-10f)
                .setDuration(200)
                .withEndAction {
                    tv.text = msg
                    tv.translationY = 10f      // new text starts just below
                    tv.animate()
                        .alpha(1f)
                        .translationY(0f)
                        .setDuration(200)
                        .start()
                }
                .start()
        }
    }

    private suspend fun wakeUpServer(tvStatus: TextView): Boolean {
        return withContext(Dispatchers.IO) {
            val client = OkHttpClient.Builder()
                .connectTimeout(6, TimeUnit.SECONDS)
                .readTimeout(6, TimeUnit.SECONDS)
                .build()
            val healthUrl = RetrofitClient.BASE_URL.replace("/api/", "") + "/health"

            delay(600L)

            var attempts      = 0
            var shownWaking   = false
            var shownStarting = false

            // Max 4 attempts × 4s interval = ~16s max wait, then proceed anyway
            // Render cold start is slow but the app should not be blocked
            val maxAttempts = 4

            while (attempts < maxAttempts) {
                attempts++
                try {
                    val resp = client.newCall(Request.Builder().url(healthUrl).build()).execute()
                    if (resp.isSuccessful) {
                        setStatus(tvStatus, "✓ Connected")
                        delay(AndroidMain.SPLASH_CONNECTED_DELAY_MS)
                        return@withContext true
                    }
                } catch (_: Exception) { }

                when {
                    !shownWaking && attempts >= 1 -> {
                        shownWaking = true
                        setStatus(tvStatus, "Waking up server…")
                    }
                    !shownStarting && attempts >= 3 -> {
                        shownStarting = true
                        setStatus(tvStatus, "Almost ready…")
                    }
                }

                if (attempts < maxAttempts) delay(4000L)
            }

            // Proceed regardless — app will load, API calls will retry normally
            setStatus(tvStatus, "✓ Connecting…")
            delay(300L)
            false
        }
    }

    override fun onDestroy() {
        super.onDestroy()
    }
}