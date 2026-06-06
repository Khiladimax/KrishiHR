package com.krishihr.app.ui.login

import android.os.Bundle
import android.view.*
import android.widget.ProgressBar
import androidx.lifecycle.lifecycleScope
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import com.krishihr.app.R
import com.krishihr.app.data.api.RetrofitClient
import com.krishihr.app.data.models.*
import com.krishihr.app.utils.toast
import kotlinx.coroutines.launch

class ForgotPasswordBottomSheet : BottomSheetDialogFragment() {

    private var employeeId: Int = -1
    private var resetToken: String = ""

    override fun onCreateView(i: LayoutInflater, c: ViewGroup?, s: Bundle?): View =
        i.inflate(R.layout.bottom_sheet_forgot_password, c, false)

    override fun onViewCreated(view: View, s: Bundle?) {
        // Hide step 2 & 3 initially
        view.findViewById<View>(R.id.stepTwo)?.visibility = View.GONE
        view.findViewById<View>(R.id.stepThree)?.visibility = View.GONE

        // Step 1 — verify identity
        view.findViewById<android.widget.Button>(R.id.btnStep1)?.setOnClickListener {
            val code  = view.findViewById<android.widget.EditText>(R.id.etEmpCode)?.text.toString().trim()
            val email = view.findViewById<android.widget.EditText>(R.id.etForgotEmail)?.text.toString().trim()
            if (code.isEmpty() || email.isEmpty()) { toast("Fill all fields"); return@setOnClickListener }
            lifecycleScope.launch {
                try {
                    val res = RetrofitClient.instance.forgotVerify(ForgotVerifyRequest(code, email))
                    if (res.isSuccessful && res.body()?.success == true) {
                        employeeId = res.body()!!.data!!.employeeId
                        toast("Identity verified ✅")
                        view.findViewById<View>(R.id.stepOne)?.visibility = View.GONE
                        view.findViewById<View>(R.id.stepTwo)?.visibility = View.VISIBLE
                    } else toast(res.body()?.message ?: "Verification failed")
                } catch (_: Exception) { toast("Network error") }
            }
        }

        // Step 2 — verify PAN
        view.findViewById<android.widget.Button>(R.id.btnStep2)?.setOnClickListener {
            val pan = view.findViewById<android.widget.EditText>(R.id.etPan)?.text.toString().trim()
            if (pan.isEmpty()) { toast("Enter PAN number"); return@setOnClickListener }
            lifecycleScope.launch {
                try {
                    val res = RetrofitClient.instance.forgotVerifyPan(ForgotVerifyPanRequest(employeeId, pan))
                    if (res.isSuccessful && res.body()?.success == true) {
                        resetToken = res.body()!!.data!!.resetToken
                        view.findViewById<View>(R.id.stepTwo)?.visibility = View.GONE
                        view.findViewById<View>(R.id.stepThree)?.visibility = View.VISIBLE
                    } else toast(res.body()?.message ?: "PAN verification failed")
                } catch (_: Exception) { toast("Network error") }
            }
        }

        // Step 3 — reset password
        view.findViewById<android.widget.Button>(R.id.btnStep3)?.setOnClickListener {
            val newPass = view.findViewById<android.widget.EditText>(R.id.etNewPass)?.text.toString()
            val confirm = view.findViewById<android.widget.EditText>(R.id.etConfirmPass)?.text.toString()
            if (newPass.length < 8) { toast("Password must be at least 8 characters"); return@setOnClickListener }
            if (newPass != confirm) { toast("Passwords do not match"); return@setOnClickListener }
            lifecycleScope.launch {
                try {
                    val res = RetrofitClient.instance.forgotReset(ForgotResetRequest(resetToken, newPass))
                    if (res.isSuccessful && res.body()?.success == true) {
                        toast("Password reset successfully! Please login.")
                        dismiss()
                    } else toast(res.body()?.message ?: "Reset failed")
                } catch (_: Exception) { toast("Network error") }
            }
        }
    }
}
