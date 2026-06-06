package com.krishihr.app.ui.login

import android.content.Intent
import android.os.Bundle
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.krishihr.app.BuildConfig
import com.krishihr.app.data.api.RetrofitClient
import com.krishihr.app.data.models.*
import com.krishihr.app.databinding.ActivityLoginBinding
import com.krishihr.app.ui.MainActivity
import com.krishihr.app.utils.SessionManager
import com.krishihr.app.utils.hideKeyboard
import com.krishihr.app.utils.toast
import kotlinx.coroutines.launch

class LoginActivity : AppCompatActivity() {

    private lateinit var binding: ActivityLoginBinding
    private lateinit var sessionManager: SessionManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityLoginBinding.inflate(layoutInflater)
        setContentView(binding.root)

        sessionManager = SessionManager(this)
        RetrofitClient.init(sessionManager, this)

        // Show "Session expired" message if redirected from token expiry or device mismatch
        if (intent.getBooleanExtra("session_expired", false)) {
            showError("Session expired. Please sign in again.")
        }

        binding.btnLogin.setOnClickListener { attemptLogin() }
        binding.tvForgotPassword.setOnClickListener {
            ForgotPasswordBottomSheet().show(supportFragmentManager, "ForgotPassword")
        }
    }

    private fun attemptLogin() {
        val email    = binding.etEmail.text.toString().trim()
        val password = binding.etPassword.text.toString()

        if (email.isEmpty())    { binding.tilEmail.error    = "Email required"; return }
        if (password.isEmpty()) { binding.tilPassword.error = "Password required"; return }
        binding.tilEmail.error    = null
        binding.tilPassword.error = null

        setLoading(true)
        hideKeyboard()

        lifecycleScope.launch {
            try {
                // Fix 3 & 4: Send device_id, app_version, device_name with every login
                val deviceId   = sessionManager.getDeviceId()
                val appVersion = BuildConfig.VERSION_NAME
                val deviceName = android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL

                val response = RetrofitClient.instance.login(
                    LoginRequest(
                        email      = email,
                        password   = password,
                        deviceId   = deviceId,
                        appVersion = appVersion,
                        deviceName = deviceName
                    )
                )
                if (response.isSuccessful && response.body()?.success == true) {
                    val data = response.body()!!.data!!
                    sessionManager.saveSession(data.token, data.employee)
                    startActivity(Intent(this@LoginActivity, MainActivity::class.java))
                    finish()
                    overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
                } else {
                    showError(response.body()?.message ?: "Invalid credentials")
                }
            } catch (e: Exception) {
                showError("Network error. Please check your connection.")
            } finally {
                setLoading(false)
            }
        }
    }

    private fun setLoading(loading: Boolean) {
        binding.btnLogin.isEnabled = !loading
        binding.btnLogin.text      = if (loading) "Signing in…" else "Login"
        binding.progressBar.visibility = if (loading) View.VISIBLE else View.GONE
        binding.tvError.visibility = View.GONE
    }

    private fun showError(msg: String) {
        binding.tvError.text = msg
        binding.tvError.visibility = View.VISIBLE
    }
}