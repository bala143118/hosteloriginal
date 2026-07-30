<<<<<<< HEAD
# HostelFix

HostelFix is a Node.js + browser-based hostel management app with CCTV fire/smoke detection, Telegram emergency alerts, complaint handling, gate passes, laundry requests, and announcements.

## Run the project

1. Install Node.js dependencies:

```powershell
npm install
```

2. Create `.env` from `.env.example` and set:

```text
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_CHAT_ID=your-telegram-chat-id
```

3. Install Python dependencies for model inference:

```powershell
pip install -r requirements.txt
```

4. Start the backend:

```powershell
npm start
```

5. Open the app:

```text
http://localhost:5000
```

## Telegram emergency alerts

- Configure the bot token and chat ID in `.env`.
- Start a direct chat with the bot or add it to a Telegram group before testing.
- Sign in as admin and set the CCTV camera name and location in Settings.
- When Fire or Smoke stays at 80% confidence or higher for 5 continuous seconds, the app sends a Telegram emergency alert.
- If Telegram rejects the uploaded screenshot, the backend now falls back to a text alert so the notification is still delivered.

## Important files

- `server.js`: Express backend and API routes
- `script.js`: Frontend logic, CCTV monitoring, alert trigger flow
- `telegram_service.js`: Telegram delivery logic
- `models/inference_server.py`: Persistent Python inference worker
- `data/db.json`: Local app data and alert history
=======
# smart-hostel-monitoring-system
>>>>>>> ed131f8f8631779e1387a6adb93155e75baf578b
