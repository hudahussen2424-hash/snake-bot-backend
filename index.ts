import "dotenv/config";
import express from "express";
import cors from "cors";
import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const app = express();
const prisma = new PrismaClient({ adapter });

app.use(cors());
app.use(express.json());

// Save a score
app.post("/score", async (req, res) => {
  try {
    const { telegramId, username, score } = req.body;

    if (!telegramId || typeof score !== "number") {
      return res.status(400).json({ error: "telegramId and numeric score are required" });
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