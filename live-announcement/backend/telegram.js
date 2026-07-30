const axios = require("axios");
const path = require("path");
const dotenv = require("dotenv");

// Force load .env from backend folder
const result = dotenv.config({
    path: path.join(__dirname, ".env")
});

// Check if .env loaded successfully
if (result.error) {
    console.log("❌ Error loading .env");
    console.log(result.error);
} else {
    console.log("✅ .env loaded successfully");
}

// Telegram Configuration
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Debug Check
console.log(
    "Telegram Bot Token:",
    BOT_TOKEN ? "Loaded ✅" : "Missing ❌"
);

console.log(
    "Telegram Chat ID:",
    CHAT_ID ? "Loaded ✅" : "Missing ❌"
);