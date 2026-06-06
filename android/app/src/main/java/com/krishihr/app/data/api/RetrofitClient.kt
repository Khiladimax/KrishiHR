package com.krishihr.app.data.api
import com.krishihr.app.AndroidMain

import android.content.Context
import android.content.Intent
import com.google.gson.GsonBuilder
import com.krishihr.app.ui.login.LoginActivity
import com.krishihr.app.utils.SessionManager
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object RetrofitClient {

    val BASE_URL get() = AndroidMain.BASE_URL // ← edit in Android_main.kt

    private var sessionManager: SessionManager? = null
    private var appContext: Context? = null
    private var _instance: ApiService? = null

    fun init(sm: SessionManager, context: Context? = null) {
        sessionManager = sm
        appContext = context?.applicationContext
        _instance = null // reset so next call rebuilds
    }

    // ── 1. Attach Bearer token + Device-ID to every request ──────────────────
    private val authInterceptor = Interceptor { chain ->
        val token    = sessionManager?.getToken()
        val deviceId = sessionManager?.getDeviceId()
        val builder  = chain.request().newBuilder()
        if (!token.isNullOrEmpty())    builder.addHeader("Authorization", "Bearer $token")
        if (!deviceId.isNullOrEmpty()) builder.addHeader("X-Device-ID", deviceId)
        chain.proceed(builder.build())
    }

    // ── 2. On 401: try token refresh then retry; on failure clear session & redirect ─
    //
    // ✅ FIX 1: Use plain synchronous OkHttp execute() instead of runBlocking{}.
    //    OkHttp interceptors run on IO threads so synchronous calls are safe here.
    //    runBlocking risks deadlock when the coroutine thread pool is exhausted.
    //
    // ✅ FIX 2: Return chain.proceed(retryRequest) directly so the caller gets
    //    the new 200 response. The old code fell through to chain.proceed(original)
    //    which sent a second request and returned another 401 to the caller.
    //
    // ✅ FIX 3: Guard appContext null-check — context was never passed from
    //    SplashActivity so redirect to LoginActivity was silently swallowed.
    //    (SplashActivity.kt is also fixed to pass context.)
    private val unauthorizedInterceptor = Interceptor { chain ->
        val originalRequest = chain.request()
        val response = chain.proceed(originalRequest)

        if (response.code != 401) return@Interceptor response

        response.close()

        val expiredToken = sessionManager?.getToken()
        var newToken: String? = null

        if (!expiredToken.isNullOrEmpty()) {
            try {
                // Use a plain OkHttpClient with NO auth interceptors to avoid
                // infinite recursion if the refresh endpoint also returns 401
                val refreshClient = OkHttpClient.Builder()
                    .connectTimeout(AndroidMain.TIMEOUT_CONNECT_SEC, TimeUnit.SECONDS)
                    .readTimeout(AndroidMain.TIMEOUT_READ_SEC, TimeUnit.SECONDS)
                    .build()

                val jsonBody = """{"token":"$expiredToken"}"""
                val requestBody = jsonBody.toRequestBody("application/json; charset=utf-8".toMediaType())
                val refreshRequest = Request.Builder()
                    .url(BASE_URL + "auth/refresh")
                    .post(requestBody)
                    .build()

                val refreshResponse = refreshClient.newCall(refreshRequest).execute()
                val bodyStr = refreshResponse.body?.string()
                refreshResponse.close()

                if (refreshResponse.isSuccessful && !bodyStr.isNullOrEmpty()) {
                    // Parse: {"success":true,"data":{"token":"..."}}
                    val gson = com.google.gson.Gson()
                    @Suppress("UNCHECKED_CAST")
                    val map = gson.fromJson(bodyStr, Map::class.java) as? Map<String, Any>
                    val data = map?.get("data") as? Map<*, *>
                    newToken = data?.get("token") as? String
                }
            } catch (_: Exception) {
                // Network or parse error — fall through to logout
            }
        }

        if (!newToken.isNullOrEmpty()) {
            // ✅ Token refreshed — save it and retry the original request
            sessionManager?.updateToken(newToken!!)
            val retryRequest = originalRequest.newBuilder()
                .removeHeader("Authorization")
                .addHeader("Authorization", "Bearer $newToken")
                .build()
            return@Interceptor chain.proceed(retryRequest)
        }

        // Refresh failed — clear session and send user to login
        sessionManager?.clearSession()
        appContext?.let { ctx ->
            val intent = Intent(ctx, LoginActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra("session_expired", true)
            }
            ctx.startActivity(intent)
        }

        // Return a dummy response — UI will be replaced by LoginActivity
        chain.proceed(originalRequest)
    }

    private val loggingInterceptor = HttpLoggingInterceptor().apply {
        level = HttpLoggingInterceptor.Level.BASIC
    }

    // Lenient Gson — won't crash on unexpected types (e.g. array where string expected)
    private val gson = GsonBuilder()
        .setLenient()
        .serializeNulls()
        .create()

    private fun buildClient() = OkHttpClient.Builder()
        .addInterceptor(authInterceptor)           // attach token + device-id first
        .addInterceptor(unauthorizedInterceptor)   // then check 401 on response
        .addInterceptor(loggingInterceptor)
        .connectTimeout(AndroidMain.TIMEOUT_CONNECT_SEC, TimeUnit.SECONDS)
        .readTimeout(AndroidMain.TIMEOUT_READ_SEC, TimeUnit.SECONDS)
        .writeTimeout(AndroidMain.TIMEOUT_WRITE_SEC, TimeUnit.SECONDS)
        .build()

    val instance: ApiService
        get() {
            if (_instance == null) {
                _instance = Retrofit.Builder()
                    .baseUrl(BASE_URL)
                    .client(buildClient())
                    .addConverterFactory(GsonConverterFactory.create(gson))
                    .build()
                    .create(ApiService::class.java)
            }
            return _instance!!
        }
}