# HostelFix Mobile App Guide

This guide explains how to run your **HostelFix** app on your Android mobile phone and connect it to your server.

---

## 🚀 Step 1: Start Your Server on your PC

1. Open a terminal in your project directory (`e:\hostel01`).
2. Run the server:
   ```bash
   npm start
   ```
3. You will see output like this in your terminal:
   ```text
   ==================================================
   HostelFix Server is RUNNING!
   Local Access: http://localhost:5000
   Mobile / Wi-Fi Access URLs:
     -> http://10.20.27.31:5000
   ==================================================
   ```
4. **Important**: Connect your mobile phone to the **same Wi-Fi network** as your PC!

---

## 📱 Step 2: Open and Build the App in Android Studio

1. Open **Android Studio**.
2. Click **Open Project** and select the folder:
   `e:\hostel01\android-app`
3. Wait for Android Studio to index and sync Gradle.
4. To test on your mobile phone:
   - **Option A (USB Debugging)**: Connect your phone to your PC via USB cable (with USB Debugging enabled in phone Settings -> Developer Options). Select your phone in Android Studio and press **Run** (green triangle button ▶).
   - **Option B (Build APK)**: In Android Studio top menu, click **Build > Build Bundle(s) / APK(s) > Build APK(s)**. Once complete, transfer the generated `app-debug.apk` file to your mobile phone and install it!

---

## ⚙️ Step 3: Server IP Setup & Troubleshooting

- When the app opens, it connects automatically to your local server IP (e.g., `http://10.20.27.31:5000`).
- If your phone IP or Wi-Fi network changes, click **"Change Server IP"** inside the app screen and enter your new server URL displayed in the server terminal log!

---

## 🌐 Quick Mobile Web Access (Without Installing APK)

If you just want to quickly test the website in your mobile browser (Chrome/Safari):
1. Connect your phone to the same Wi-Fi as your PC.
2. Open Chrome on your mobile phone.
3. Type: `http://10.20.27.31:5000` (or whatever IP is printed in your terminal when you run `npm start`).
