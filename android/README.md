# 🌾 KrishiHR Android App

A professional, colorful, Material Design 3 Android app for the KrishiHR HR Management System.

---

## 📱 Screens Included

| Screen | Description |
|---|---|
| 🌿 Splash Screen | Animated green gradient with logo |
| 🔐 Login | Colorful quad-grid top + login form |
| 🏠 Dashboard | Profile header + punch card + colorful icon grid + announcements |
| 📅 Attendance | Purple toolbar + tabs (Today / History / Regularize) + live clock + punch in/out |
| 🌴 Leave | Illustrations + balance cards + apply leave bottom sheet |
| 💰 Payroll | Salary summary cards (Gross/Deductions/Net) + earnings/deductions lists |
| 👤 More | Profile, Notifications, Advance, Announcements, GK Quiz, Employees, Change Password, Logout |
| 🧠 GK Quiz | Daily question with 4 colorful option buttons + leaderboard |
| 📢 Announcements | Full announcements feed |
| 💳 Advance | Apply advance + history list |
| 👥 Employees | Full employee directory |
| 🔑 Change Password | Secure password update |
| 🔐 Forgot Password | 3-step: Emp Code+Email → PAN → New Password |

---

## ⚡ Quick Setup in Android Studio

### Step 1 — Open Project
1. Unzip `KrishiHR_Android_App.zip`
2. Open **Android Studio**
3. Click **File → Open** → select the `KrishiHR_Android` folder
4. Wait for Gradle sync to complete

### Step 2 — Set Your Backend URL
Open this file:
```
app/src/main/java/com/krishihr/app/data/api/RetrofitClient.kt
```
Change line 13:
```kotlin
// For local emulator testing:
const val BASE_URL = "http://10.0.2.2:3000/api/"

// For deployed backend (Railway/Render):
const val BASE_URL = "https://your-backend.railway.app/api/"
```

### Step 3 — Run the App
- Connect an Android device (API 24+) OR start an emulator
- Click **▶ Run** in Android Studio

---

## 🎨 Color Theme
The app uses a vibrant **multicolor** theme:

| Color | Usage |
|---|---|
| 🟢 Green `#2E7D32` | Primary brand, header, punch-in |
| 🟣 Purple `#4A148C` | Toolbar gradient |
| 🔵 Blue `#0277BD` | Attendance, info cards |
| 🟠 Orange `#FF6F00` | Announcements, accent |
| 🩷 Pink `#AD1457` | Absent, separation |
| 🩵 Teal `#00695C` | WFH, leave actions |
| 🟡 Amber `#F57F17` | Pending status, quiz |

---

## 🏗️ Architecture

```
com.krishihr.app/
├── data/
│   ├── api/         → ApiService (Retrofit), RetrofitClient
│   └── models/      → All data classes (Employee, Leave, Payslip, etc.)
├── ui/
│   ├── login/       → LoginActivity, ForgotPasswordBottomSheet
│   ├── dashboard/   → DashboardFragment
│   ├── attendance/  → AttendanceFragment, AttendanceHistoryFragment
│   ├── leave/       → LeaveFragment, LeaveApplicationAdapter, ApplyLeaveBottomSheet
│   ├── payroll/     → PayrollFragment, PayComponentAdapter
│   └── more/        → MoreFragment (Profile, GKQuiz, Advance, Employees, etc.)
└── utils/
    ├── SessionManager.kt  → JWT token + employee storage
    └── Extensions.kt      → Helpers (date, currency, toast, visibility)
```

---

## 📦 Key Dependencies

```gradle
// Networking
retrofit2:retrofit:2.9.0
retrofit2:converter-gson:2.9.0
okhttp3:logging-interceptor:4.12.0

// UI
material:1.11.0         // Material Design 3
constraintlayout:2.1.4
circleimageview:3.1.0

// Architecture
lifecycle-viewmodel-ktx:2.7.0
lifecycle-livedata-ktx:2.7.0
kotlinx-coroutines-android:1.7.3

// Image loading
glide:4.16.0

// Location (Geofence)
play-services-location:21.1.0
```

---

## 🔧 Troubleshooting

| Issue | Fix |
|---|---|
| Gradle sync fails | File → Invalidate Caches → Restart |
| Network error on emulator | Use `http://10.0.2.2:3000/api/` as base URL |
| Font not loading | Internet permission is in AndroidManifest |
| `cleartext not permitted` | Already set `usesCleartextTraffic=true` in manifest |
| Build error `R not found` | Clean Project → Rebuild |

---

## 🚀 Next Steps to Enhance

1. **Add Google Maps** for geofence punch-in visualization
2. **Push Notifications** via FCM for leave approvals
3. **Dark Mode** — all colors use `@color` references, easy to add night variants
4. **Biometric Auth** — fingerprint login
5. **Export Payslip to PDF** using Android Print API
6. **Calendar view** for attendance history

---

Made with ❤️ for KrishiHR
