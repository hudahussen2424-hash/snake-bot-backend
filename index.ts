import "dotenv/config";
import express from "express";
import cors from "cors";
import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import TelegramBot from "node-telegram-bot-api";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const app = express();
const prisma = new PrismaClient({ adapter });

async function getLeaderboard() {
  const users = await prisma.user.findMany({
    where: { bestScore: { gt: 0 } },
    orderBy: { bestScore: "desc" },
    take: 10,
  });
  return users;
}

// ---- Telegram Bot ----
const GAME_URL = "https://snake-game-telegram-bot.vercel.app";
const bot = new TelegramBot(process.env.BOT_TOKEN as string, { polling: true });

const mainMenu = {
  reply_markup: {
    keyboard: [
      [{ text: "▶️ Play" }, { text: "🏆 Leaderboard" }],
      [{ text: "❓ Help" }, { text: "💬 Feedback" }],
    ],
    resize_keyboard: true,
  },
};

const awaitingNickname = new Set<string>();
const awaitingFeedback = new Set<string>();

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = String(msg.from?.id);

  let user = await prisma.user.findUnique({ where: { telegramId } });

  if (!user) {
    user = await prisma.user.create({ data: { telegramId } });
  }

  if (!user.nickname) {
    awaitingNickname.add(telegramId);
    bot.sendMessage(chatId, "👋 Welcome! What name should we show on the leaderboard?");
    return;
  }

  bot.sendMessage(chatId, `🐍 Welcome back, ${user.nickname}! Use the menu below anytime.`, mainMenu);
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = String(msg.from?.id);
  const text = msg.text;

  if (!text || text.startsWith("/")) return; // ignore commands here

  // Handle feedback first
  if (awaitingFeedback.has(telegramId)) {
    awaitingFeedback.delete(telegramId);

    const user = await prisma.user.findUnique({ where: { telegramId } });
    const senderName = user?.nickname || telegramId;

    const adminId = process.env.ADMIN_CHAT_ID;
    if (adminId) {
      bot.sendMessage(adminId, `📬 Feedback from ${senderName} (${telegramId}):\n\n${text}`);
    }

    bot.sendMessage(chatId, "Thanks! Your feedback was sent 🙏");
    return;
  }

  // Handle nickname setup
  if (!awaitingNickname.has(telegramId)) return; // not expecting anything right now

  const nickname = text.trim().slice(0, 20); // cap length, keep it simple

  await prisma.user.update({
    where: { telegramId },
    data: { nickname },
  });

  awaitingNickname.delete(telegramId);

  bot.sendMessage(chatId, `Got it, ${nickname}! 🐍 Use the menu below anytime.`, mainMenu);
});

bot.onText(/▶️ Play/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "Tap below to play!", {
    reply_markup: {
      inline_keyboard: [[{ text: "▶️ Play Snake", web_app: { url: GAME_URL } }]],
    },
  });
});

bot.onText(/🏆 Leaderboard/, async (msg) => {
  const chatId = msg.chat.id;
  const top10 = await getLeaderboard();

  if (top10.length === 0) {
    bot.sendMessage(chatId, "No scores yet — be the first to play!");
    return;
  }

  const medals = ["🥇", "🥈", "🥉"];
  const lines = top10.map((u, i) => {
    const rank = medals[i] || `${i + 1}.`;
    const name = u.nickname || `Player ${u.telegramId}`;
    return `${rank} ${name} — ${u.bestScore}`;
  });

  bot.sendMessage(chatId, `🏆 Leaderboard\n\n${lines.join("\n")}`);
});

bot.onText(/❓ Help/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    "🐍 How to play:\n\n• Tap Play to start\n• Swipe or use arrow keys to move\n• Eat the food to grow and score points\n• Avoid walls and your own tail!\n\nUse the menu below to check the leaderboard or send feedback anytime."
  );
});

bot.onText(/💬 Feedback/, (msg) => {
  const chatId = msg.chat.id;
  const telegramId = String(msg.from?.id);
  awaitingFeedback.add(telegramId);
  bot.sendMessage(chatId, "Got feedback or found a bug? Type it below and send — I'll read it!");
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

    // Update the user's stats if they exist (created via /start)
    const user = await prisma.user.findUnique({ where: { telegramId: String(telegramId) } });
    if (user) {
      await prisma.user.update({
        where: { telegramId: String(telegramId) },
        data: {
          gamesPlayed: { increment: 1 },
          bestScore: score > user.bestScore ? score : user.bestScore,
        },
      });
    }

    res.json(saved);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save score" });
  }
});

app.get("/leaderboard", async (req, res) => {
  try {
    const top10 = await getLeaderboard();
    res.json(top10);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch leaderboard" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});