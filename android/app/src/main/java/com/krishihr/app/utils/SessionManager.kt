package com.krishihr.app.utils
import com.krishihr.app.AndroidMain

import android.content.Context
import android.content.SharedPreferences
import com.google.gson.Gson
import com.krishihr.app.data.models.Employee
import java.io.File

class SessionManager(private val context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences(AndroidMain.PREFS_MAIN, Context.MODE_PRIVATE)
    private val gson = Gson()

    companion object {
        private val KEY_TOKEN        get() = AndroidMain.KEY_TOKEN
        private val KEY_EMPLOYEE     get() = AndroidMain.KEY_EMPLOYEE
        private val KEY_IS_LOGGED_IN get() = AndroidMain.KEY_IS_LOGGED_IN
        private val PHOTO_FILE       get() = AndroidMain.FILE_PROFILE_PHOTO
        private val KEY_DEVICE_ID    get() = AndroidMain.KEY_DEVICE_ID
    }

    /**
     * Returns a stable unique ID for this device installation.
     * Generated once using UUID and stored permanently in SharedPrefs.
     */
    fun getDeviceId(): String {
        var id = prefs.getString(KEY_DEVICE_ID, null)
        if (id.isNullOrBlank()) {
            id = java.util.UUID.randomUUID().toString()
            prefs.edit().putString(KEY_DEVICE_ID, id).apply()
        }
        return id
    }

    fun saveSession(token: String, employee: Employee) {
        // Save photo separately to file (base64 can be 30-50KB, too big for SharedPrefs)
        employee.profilePhoto?.let { savePhotoToFile(it) }
        val empWithoutPhoto = employee.copy(profilePhoto = null)
        prefs.edit().apply {
            putString(KEY_TOKEN, token)
            putString(KEY_EMPLOYEE, gson.toJson(empWithoutPhoto))
            putBoolean(KEY_IS_LOGGED_IN, true)
            apply()
        }
    }

    fun getToken(): String? = prefs.getString(KEY_TOKEN, null)

    fun getEmployee(): Employee? {
        val json = prefs.getString(KEY_EMPLOYEE, null) ?: return null
        return try {
            val emp = gson.fromJson(json, Employee::class.java)
            val photo = loadPhotoFromFile()
            if (photo != null) emp.copy(profilePhoto = photo) else emp
        } catch (e: Exception) { null }
    }

    fun getRole(): String = getEmployee()?.role?.lowercase()?.trim() ?: "employee"

    fun isLoggedIn(): Boolean = prefs.getBoolean(KEY_IS_LOGGED_IN, false) && !getToken().isNullOrEmpty()

    fun updateEmployee(employee: Employee) {
        if (!employee.profilePhoto.isNullOrBlank()) {
            savePhotoToFile(employee.profilePhoto)
        }
        val empWithoutPhoto = employee.copy(profilePhoto = null)
        prefs.edit().putString(KEY_EMPLOYEE, gson.toJson(empWithoutPhoto)).apply()
    }

    fun updateToken(token: String) {
        prefs.edit().putString(KEY_TOKEN, token).apply()
    }

    /**
     * BUG FIX: Use commit() instead of apply() here.
     *
     * apply() is asynchronous — it queues the write and returns immediately.
     * If the user logs out and the OS kills the process before the write finishes
     * (e.g. they reopen the app very quickly), SplashActivity reads stale prefs
     * and sees is_logged_in=true + a valid token → routes to MainActivity instead
     * of LoginActivity, showing the previous user's data.
     *
     * commit() blocks until the write is complete, so by the time clearSession()
     * returns the prefs are guaranteed clean. Logout is a rare, user-triggered
     * action so the tiny sync overhead on the main thread is completely acceptable.
     */
    fun clearSession() {
        try { File(context.filesDir, PHOTO_FILE).delete() } catch (_: Exception) {}
        prefs.edit().clear().commit()   // ✅ commit() — synchronous, guaranteed clean
    }

    // ── Employee photo cache (for employee list) ──────────────────────────────

    fun saveEmployeePhoto(employeeId: Int, base64: String) {
        try {
            val f = java.io.File(context.filesDir, "emp_photo_$employeeId.b64")
            f.writeText(base64)
        } catch (_: Exception) {}
    }

    fun getEmployeePhoto(employeeId: Int): String? {
        return try {
            val f = java.io.File(context.filesDir, "emp_photo_$employeeId.b64")
            if (f.exists()) f.readText().ifBlank { null } else null
        } catch (_: Exception) { null }
    }

    fun deleteEmployeePhoto(employeeId: Int) {
        try { java.io.File(context.filesDir, "emp_photo_$employeeId.b64").delete() } catch (_: Exception) {}
    }

    fun mergeEmployeesWithCachedPhotos(employees: List<Employee>): List<Employee> {
        return employees.map { emp ->
            if (!emp.profilePhoto.isNullOrBlank()) {
                saveEmployeePhoto(emp.id, emp.profilePhoto)
                emp
            } else {
                val cached = getEmployeePhoto(emp.id)
                if (cached != null) emp.copy(profilePhoto = cached) else emp
            }
        }
    }

    fun savePhotoToFile(base64: String) {
        try {
            File(context.filesDir, PHOTO_FILE).writeText(base64)
        } catch (_: Exception) {}
    }

    fun getPhotoFromFile(): String? = loadPhotoFromFile()

    private fun loadPhotoFromFile(): String? {
        return try {
            val f = File(context.filesDir, PHOTO_FILE)
            if (f.exists()) f.readText().ifBlank { null } else null
        } catch (_: Exception) { null }
    }
}