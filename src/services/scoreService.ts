import {
  doc,
  getDoc,
  runTransaction,
  increment,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import { checkWeeklyReset, getCurrentSeasonId } from "./resetService";
import { awardBlockBlastSeasonMedals, awardWordGuessSeasonMedals } from "./medalService";

function isValidUsername(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_]{2,17}$/.test(name);
}

function fallbackUsername(uid: string): string {
  const base = `user_${uid.replace(/[^a-zA-Z0-9_]/g, "")}`;
  return base.length >= 3 ? base.slice(0, 18) : "user_000";
}


/**
 * Block Blast best score is stored on the user document: users/{uid}.bestScore
 */
export async function getBlockBlastBestScore(uid: string): Promise<number> {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return 0;

  const best = (snap.data() as any).bestScore;
  return typeof best === "number" ? best : 0;
}

/**
 * Increments gamesPlayed and updates bestScore ONLY if the new score is higher.
 * Uses a transaction to avoid race conditions.
 */
export async function submitScore(uid: string, score: number) {
  const ref = doc(db, "users", uid);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;

    const best = Number((snap.data() as any).bestScore ?? 0) || 0;

    const update: Record<string, any> = {
      gamesPlayed: increment(1),
    };

    // ✅ bestScore מתעדכן רק אם עקפנו
    if (score > best) {
      update.bestScore = score;
    }

    tx.update(ref, update);
  });
}

export async function updateBlockBlastBestScoreIfHigher(uid: string, score: number) {
  const ref = doc(db, "users", uid);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;

    const best = Number((snap.data() as any).bestScore ?? 0) || 0;
    if (score <= best) return;

    tx.update(ref, { bestScore: score });
  });
}

export async function submitBlockBlastScore(uid: string, score: number) {
  await checkWeeklyReset();
  const seasonId = await getCurrentSeasonId();

  const userRef = doc(db, "users", uid);
  const userSnap = await getDoc(userRef);
  const rawUsername = userSnap.exists()
    ? String((userSnap.data() as any)?.username ?? "")
    : "";
  const username = isValidUsername(rawUsername) ? rawUsername : fallbackUsername(uid);

  const scoreRef = doc(db, "scores", "block-blast", "users", uid);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(scoreRef);

    if (!snap.exists()) {
      tx.set(scoreRef, {
        username,
        score,
        seasonId,
        updatedAt: serverTimestamp(),
      });
      return;
    }

    const data = snap.data() as any;
    const storedSeasonId = Number(data?.seasonId ?? 0) || 0;
    const storedScore = Number(data?.score ?? 0) || 0;

    const effectiveScore = storedSeasonId === seasonId ? storedScore : 0;
    if (score <= effectiveScore) return;

    tx.update(scoreRef, {
      username,
      score,
      seasonId,
      updatedAt: serverTimestamp(),
    });
  });

  // Best-effort medal assignment for the current season
  awardBlockBlastSeasonMedals(seasonId).catch(() => {});
}

export async function submitWordGuessScore(uid: string, score: number) {
  await checkWeeklyReset();
  const seasonId = await getCurrentSeasonId();

  const userRef = doc(db, "users", uid);
  const userSnap = await getDoc(userRef);
  const rawUsername = userSnap.exists()
    ? String((userSnap.data() as any)?.username ?? "")
    : "";
  const username = isValidUsername(rawUsername) ? rawUsername : fallbackUsername(uid);

  const scoreRef = doc(db, "scores", "word-guess", "users", uid);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(scoreRef);

    if (!snap.exists()) {
      tx.set(scoreRef, {
        username,
        score,
        seasonId,
        updatedAt: serverTimestamp(),
      });
      return;
    }

    const data = snap.data() as any;
    const storedSeasonId = Number(data?.seasonId ?? 0) || 0;
    const storedScore = Number(data?.score ?? 0) || 0;

    const effectiveScore = storedSeasonId === seasonId ? storedScore : 0;
    if (score <= effectiveScore) return;

    tx.update(scoreRef, {
      username,
      score,
      seasonId,
      updatedAt: serverTimestamp(),
    });
  });

  // Best-effort medal assignment for the current season
  awardWordGuessSeasonMedals(seasonId).catch(() => {});
}
