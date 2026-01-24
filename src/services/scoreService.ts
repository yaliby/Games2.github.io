import { doc, getDoc, runTransaction, increment } from "firebase/firestore";
import { db } from "./firebase";

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
