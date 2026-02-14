import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { db } from "./firebase";
import { addAchievement } from "./achievementService";

const MEDAL_IDS = ["bb_gold", "bb_silver", "bb_bronze"] as const;
const WORD_GUESS_MEDAL_IDS = ["wg_gold", "wg_silver", "wg_bronze"] as const;
const WHICH_COUNTRY_MEDAL_IDS = ["wc_gold", "wc_silver", "wc_bronze"] as const;
const HALL_OF_FAME_MEDAL_IDS = ["hof_gold", "hof_silver", "hof_bronze"] as const;
const CLAIM_COOLDOWN_MS = 10_000;
const lastClaimAt = new Map<string, number>();

type GameId = "block-blast" | "word-guess" | "which-country";
type ScoreRow = {
  uid: string;
  score: number;
  seasonId: number;
};

type HallRow = {
  uid: string;
  bestScore: number;
};

async function getSeasonTopThree(gameId: GameId, seasonId: number): Promise<ScoreRow[]> {
  const snap = await getDocs(collection(db, "scores", gameId, "users"));
  return snap.docs
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
}

async function claimGameMedal(uid: string, seasonId: number, gameId: GameId, medalIds: readonly string[]) {
  const rows = await getSeasonTopThree(gameId, seasonId);
  const rank = rows.findIndex((row) => row.uid === uid);
  if (rank < 0) return;

  await addAchievement(uid, medalIds[rank]);
}

async function getHallOfFameTopThree(): Promise<HallRow[]> {
  const q = query(collection(db, "users"), orderBy("bestScore", "desc"), limit(3));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => {
      const data = d.data() as any;
      return {
        uid: d.id,
        bestScore: Number(data?.bestScore ?? 0) || 0,
      };
    })
    .filter((row) => row.bestScore > 0)
    .slice(0, 3);
}

/**
 * Self-claim flow: the logged-in user can claim last season's podium medals for themself.
 * This avoids cross-user writes, which are commonly blocked by Firestore rules.
 */
export async function claimSeasonMedalsForUser(uid: string, seasonId: number) {
  if (!uid || seasonId <= 0) return;

  const key = `${uid}:${seasonId}`;
  const now = Date.now();
  const last = lastClaimAt.get(key) ?? 0;
  if (now - last < CLAIM_COOLDOWN_MS) return;
  lastClaimAt.set(key, now);

  await claimGameMedal(uid, seasonId, "block-blast", MEDAL_IDS);
  await claimGameMedal(uid, seasonId, "word-guess", WORD_GUESS_MEDAL_IDS);
  await claimGameMedal(uid, seasonId, "which-country", WHICH_COUNTRY_MEDAL_IDS);
}

async function awardRows(rows: Array<{ uid: string }>, medalIds: readonly string[]) {
  for (let i = 0; i < rows.length && i < medalIds.length; i++) {
    const row = rows[i];
    const medalId = medalIds[i];
    await addAchievement(row.uid, medalId).catch((err) => {
      console.warn("admin medal grant failed:", { uid: row.uid, medalId, err });
    });
  }
}

export async function awardSeasonMedalsByAdmin(seasonId: number) {
  if (seasonId <= 0) return;
  const [bbRows, wgRows, wcRows] = await Promise.all([
    getSeasonTopThree("block-blast", seasonId),
    getSeasonTopThree("word-guess", seasonId),
    getSeasonTopThree("which-country", seasonId),
  ]);

  await awardRows(bbRows, MEDAL_IDS);
  await awardRows(wgRows, WORD_GUESS_MEDAL_IDS);
  await awardRows(wcRows, WHICH_COUNTRY_MEDAL_IDS);
}

/**
 * Awards the user their current Hall-of-Fame medal (Top 3 all-time by users.bestScore).
 * Medals are cumulative by history because addAchievement is idempotent per medal id.
 */
export async function claimHallOfFameMedalForUser(uid: string) {
  if (!uid) return;

  const rows = await getHallOfFameTopThree();
  const rank = rows.findIndex((row) => row.uid === uid);
  if (rank < 0) return;

  await addAchievement(uid, HALL_OF_FAME_MEDAL_IDS[rank]);
}

export async function awardHallOfFameMedalsByAdmin() {
  const rows = await getHallOfFameTopThree();
  await awardRows(rows, HALL_OF_FAME_MEDAL_IDS);
}
