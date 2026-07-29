# HostelFix - Static Website

## Telegram emergency alerts

1. Start the server with `npm start` and open `http://localhost:5000`.
2. Copy `.env.example` to `.env`, then set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`. Do not put these values in frontend code.
3. Add the bot to the target Telegram group (or start a chat with it) and use that chat's ID in `.env`.
4. Sign in as an admin, open **Settings**, and set the CCTV camera name and location.

When CCTV detects Fire or Smoke at 80% confidence or higher for five continuous seconds, the system saves the current frame in `data/alert-images`, sends the image and alert message to Telegram, and shows an admin dashboard popup with an alarm sound. The backend enforces a 60-second cooldown for each camera. Alert history is saved in `data/db.json` and shown in Admin Settings.

This project is a static website for the HostelFix maintenance management UI.

## Files

- `index.html` — homepage and application UI
- `styles.css` — shared styling and visual utilities
- `script.js` — interactive navigation and UI logic

## Run locally

If Python is installed, run:

```powershell
python -m http.server 8000
```

Then open:

```text
http://localhost:8000/index.html
```

## Notes

- The site uses Tailwind Browser, Font Awesome, and Google Fonts via CDN.
- No build step is required for this static website.
