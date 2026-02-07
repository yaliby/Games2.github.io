import { collection, getDocs } from "firebase/firestore";
import { db } from "./firebase";
import { addAchievement } from "./achievementService";

const MEDAL_IDS = ["bb_gold", "bb_silver", "bb_bronze"] as const;
const WORD_GUESS_MEDAL_IDS = ["wg_gold", "wg_silver", "wg_bronze"] as const;
let lastMedalSeason: number | null = null;
let lastMedalAt = 0;
let lastWordGuessSeason: number | null = null;
let lastWordGuessAt = 0;
const MEDAL_COOLDOWN_MS = 10_000;

export async function awardBlockBlastSeasonMedals(seasonId: number) {
  const now = Date.now();
  if (lastMedalSeason === seasonId && now - lastMedalAt < MEDAL_COOLDOWN_MS) return;
  lastMedalSeason = seasonId;
  lastMedalAt = now;

  const snap = await getDocs(collection(db, "scores", "block-blast", "users"));
  const rows = snap.docs
    .map((d) => {
      const data = d.data() as any;
      return {
        uid: d.id,
        score: Number(data?.score ?? 0) || 0,
        seasonId: Number(data?.seasonId ?? 0) || 0,
      };
    })
    .filter((row) => row.seasonId === seasonId)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  for (let i = 0; i < rows.length; i++) {
    const medalId = MEDAL_IDS[i];
    const uid = rows[i].uid;
    await addAchievement(uid, medalId);
  }
}

export async function awardWordGuessSeasonMedals(seasonId: number) {
  const now = Date.now();
  if (lastWordGuessSeason === seasonId && now - lastWordGuessAt < MEDAL_COOLDOWN_MS) return;
  lastWordGuessSeason = seasonId;
  lastWordGuessAt = now;

  const snap = await getDocs(collection(db, "scores", "word-guess", "users"));
  const rows = snap.docs
    .map((d) => {
      const data = d.data() as any;
      return {
        uid: d.id,
        score: Number(data?.score ?? 0) || 0,
        seasonId: Number(data?.seasonId ?? 0) || 0,
      };
    })
    .filter((row) => row.seasonId === seasonId)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  for (let i = 0; i < rows.length; i++) {
    const medalId = WORD_GUESS_MEDAL_IDS[i];
    const uid = rows[i].uid;
    await addAchievement(uid, medalId);
  }
}
