import "dotenv/config";
import express from "express";
import cors from "cors";
import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import TelegramBot from "node-telegram-bot-api";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const app = express();
const prisma = new PrismaClient({ adapter });
// ---- Telegram Bot ----
const GAME_URL = "https://snake-game-telegram-bot.vercel.app";
const bot = new TelegramBot(process.env.BOT_TOKEN as string, { polling: true });

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "🐍 Welcome! Tap below to play Snake.", {
    reply_markup: {
      inline_keyboard: [[{ text: "▶️ Play Snake", web_app: { url: GAME_URL } }]],
    },
  });
});

bot.onText(/\/leaderboard/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const scores = await prisma.score.findMany({
      orderBy: { score: "desc" },
      take: 100,
    });

    const bestPerPlayer = new Map();
    for (const s of scores) {
      if (!bestPerPlayer.has(s.telegramId) || bestPerPlayer.get(s.telegramId).score < s.score) {
        bestPerPlayer.set(s.telegramId, s);
      }
    }

    const top10 = Array.from(bestPerPlayer.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    if (top10.length === 0) {
      bot.sendMessage(chatId, "No scores yet — be the first to play!");
      return;
    }

    const medals = ["🥇", "🥈", "🥉"];
    const lines = top10.map((s, i) => {
      const rank = medals[i] || `${i + 1}.`;
      const name = s.username ? `@${s.username}` : `Player ${s.telegramId}`;
      return `${rank} ${name} — ${s.score}`;
    });

    bot.sendMessage(chatId, `🏆 Leaderboard\n\n${lines.join("\n")}`);
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, "Couldn't load the leaderboard right now, try again in a bit.");
  }
});

app.use(cors());
app.use(express.json());

// Save a score
app.post("/score", async (req, res) => {
  try {
    const { telegramId, username, score } = req.body;

    if (!telegramId || typeof score !== "number") {
      return res.status(400).json({ error: "telegramId and numeric score are required" });
    }
if (score < 0 || score > 500) {
      return res.status(400).json({ error: "Score out of allowed range" });
    }
    const saved = await prisma.score.create({
      data: {
        telegramId: String(telegramId),
        username: username || null,
        score,
      },
    });

    res.json(saved);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save score" });
  }
});

// Get top 10 leaderboard (best score per player)
app.get("/leaderboard", async (req, res) => {
  try {
    const scores = await prisma.score.findMany({
      orderBy: { score: "desc" },
      take: 100, // pull more than needed, then dedupe by player below
    });

    const bestPerPlayer = new Map();
    for (const s of scores) {
      if (!bestPerPlayer.has(s.telegramId) || bestPerPlayer.get(s.telegramId).score < s.score) {
        bestPerPlayer.set(s.telegramId, s);
      }
    }

    const leaderboard = Array.from(bestPerPlayer.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    res.json(leaderboard);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch leaderboard" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});