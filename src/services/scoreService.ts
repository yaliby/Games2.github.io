import {
  doc,
  getDoc,
  runTransaction,
  increment,
  serverTimestamp,
} from "firebase/firestore";
import { auth, db } from "./firebase";
import { checkWeeklyReset, getCurrentSeasonId } from "./resetService";
import {
  awardHallOfFameMedalsByAdmin,
  awardSeasonMedalsByAdmin,
  claimHallOfFameMedalForUser,
  claimSeasonMedalsForUser,
} from "./medalService";
import { isAdminUid } from "./admin";

const MAX_SAFE_SCORE = Number.MAX_SAFE_INTEGER;

function isValidUsername(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_]{2,17}$/.test(name);
}

function fallbackUsername(uid: string): string {
  const base = `user_${uid.replace(/[^a-zA-Z0-9_]/g, "")}`;
  return base.length >= 3 ? base.slice(0, 18) : "user_000";
}

function normalizeScore(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.min(MAX_SAFE_SCORE, Math.floor(numeric));
}

function updateAllTimeBestIfHigher(tx: any, userRef: any, userSnap: any, score: number) {
  if (!userSnap.exists()) return;

  const data = userSnap.data() as any;
  const best = normalizeScore(data?.bestScore);
  if (score <= best) return;

  tx.update(userRef, { bestScore: score });
}

async function syncHallOfFameMedals(triggerUid: string) {
  const actorUid = auth.currentUser?.uid;
  if (isAdminUid(actorUid)) {
    await awardHallOfFameMedalsByAdmin();
    return;
  }
  await claimHallOfFameMedalForUser(triggerUid);
}

async function syncPreviousSeasonMedals(triggerUid: string, seasonId: number) {
  if (seasonId <= 1) return;
  const prevSeasonId = seasonId - 1;

  const actorUid = auth.currentUser?.uid;
  if (isAdminUid(actorUid)) {
    await awardSeasonMedalsByAdmin(prevSeasonId);
    return;
  }

  await claimSeasonMedalsForUser(triggerUid, prevSeasonId);
}


/**
 * Block Blast best score is stored on the user document: users/{uid}.bestScore
 */
export async function getBlockBlastBestScore(uid: string): Promise<number> {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return 0;

  const best = (snap.data() as any).bestScore;
  return normalizeScore(best);
}

/**
 * Increments gamesPlayed and updates bestScore ONLY if the new score is higher.
 * Uses a transaction to avoid race conditions.
 */
export async function submitScore(uid: string, score: number) {
  const safeScore = normalizeScore(score);
  const ref = doc(db, "users", uid);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;

    const best = normalizeScore((snap.data() as any).bestScore);

    const update: Record<string, any> = {
      gamesPlayed: increment(1),
    };

    // ✅ bestScore מתעדכן רק אם עקפנו
    if (safeScore > best) {
      update.bestScore = safeScore;
    }

    tx.update(ref, update);
  });

  await syncHallOfFameMedals(uid).catch((err) => {
    console.warn("hall-of-fame medal self-claim failed:", err);
  });
}

export async function updateBlockBlastBestScoreIfHigher(uid: string, score: number) {
  const safeScore = normalizeScore(score);
  const ref = doc(db, "users", uid);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;

    const best = normalizeScore((snap.data() as any).bestScore);
    if (safeScore <= best) return;

    tx.update(ref, { bestScore: safeScore });
  });

  await syncHallOfFameMedals(uid).catch((err) => {
    console.warn("hall-of-fame medal self-claim failed:", err);
  });
}

export async function submitBlockBlastScore(uid: string, score: number) {
  const safeScore = normalizeScore(score);
  await checkWeeklyReset();
  const seasonId = await getCurrentSeasonId();
  await syncPreviousSeasonMedals(uid, seasonId).catch((err) => {
    console.warn("block-blast medal self-claim failed:", err);
  });

  const userRef = doc(db, "users", uid);
  const userSnap = await getDoc(userRef);
  const rawUsername = userSnap.exists()
    ? String((userSnap.data() as any)?.username ?? "")
    : "";
  const username = isValidUsername(rawUsername) ? rawUsername : fallbackUsername(uid);

  const scoreRef = doc(db, "scores", "block-blast", "users", uid);

  await runTransaction(db, async (tx) => {
    const [snap, userSnapTx] = await Promise.all([tx.get(scoreRef), tx.get(userRef)]);

    if (!snap.exists()) {
      tx.set(scoreRef, {
        username,
        score: safeScore,
        seasonId,
        updatedAt: serverTimestamp(),
      });
    } else {
      const data = snap.data() as any;
      const storedSeasonId = Number(data?.seasonId ?? 0) || 0;
      const storedScore = normalizeScore(data?.score);

      const effectiveScore = storedSeasonId === seasonId ? storedScore : 0;
      if (safeScore > effectiveScore) {
        tx.update(scoreRef, {
          username,
          score: safeScore,
          seasonId,
          updatedAt: serverTimestamp(),
        });
      }
    }

    updateAllTimeBestIfHigher(tx, userRef, userSnapTx, safeScore);
  });

  await syncHallOfFameMedals(uid).catch((err) => {
    console.warn("hall-of-fame medal self-claim failed:", err);
  });
}

export async function submitWordGuessScore(uid: string, score: number) {
  const safeScore = normalizeScore(score);
  await checkWeeklyReset();
  const seasonId = await getCurrentSeasonId();
  await syncPreviousSeasonMedals(uid, seasonId).catch((err) => {
    console.warn("word-guess medal self-claim failed:", err);
  });

  const userRef = doc(db, "users", uid);
  const userSnap = await getDoc(userRef);
  const rawUsername = userSnap.exists()
    ? String((userSnap.data() as any)?.username ?? "")
    : "";
  const username = isValidUsername(rawUsername) ? rawUsername : fallbackUsername(uid);

  const scoreRef = doc(db, "scores", "word-guess", "users", uid);

  await runTransaction(db, async (tx) => {
    const [snap, userSnapTx] = await Promise.all([tx.get(scoreRef), tx.get(userRef)]);

    if (!snap.exists()) {
      tx.set(scoreRef, {
        username,
        score: safeScore,
        seasonId,
        updatedAt: serverTimestamp(),
      });
    } else {
      const data = snap.data() as any;
      const storedSeasonId = Number(data?.seasonId ?? 0) || 0;
      const storedScore = normalizeScore(data?.score);

      const effectiveScore = storedSeasonId === seasonId ? storedScore : 0;
      if (safeScore > effectiveScore) {
        tx.update(scoreRef, {
          username,
          score: safeScore,
          seasonId,
          updatedAt: serverTimestamp(),
        });
      }
    }

    updateAllTimeBestIfHigher(tx, userRef, userSnapTx, safeScore);
  });

  await syncHallOfFameMedals(uid).catch((err) => {
    console.warn("hall-of-fame medal self-claim failed:", err);
  });
}

export async function submitWhichCountryScore(uid: string, score: number) {
  const safeScore = normalizeScore(score);
  await checkWeeklyReset();
  const seasonId = await getCurrentSeasonId();
  await syncPreviousSeasonMedals(uid, seasonId).catch((err) => {
    console.warn("which-country medal self-claim failed:", err);
  });

  const userRef = doc(db, "users", uid);
  const userSnap = await getDoc(userRef);
  const rawUsername = userSnap.exists()
    ? String((userSnap.data() as any)?.username ?? "")
    : "";
  const username = isValidUsername(rawUsername) ? rawUsername : fallbackUsername(uid);

  const scoreRef = doc(db, "scores", "which-country", "users", uid);

  await runTransaction(db, async (tx) => {
    const [snap, userSnapTx] = await Promise.all([tx.get(scoreRef), tx.get(userRef)]);

    if (!snap.exists()) {
      tx.set(scoreRef, {
        username,
        score: safeScore,
        seasonId,
        updatedAt: serverTimestamp(),
      });
    } else {
      const data = snap.data() as any;
      const storedSeasonId = Number(data?.seasonId ?? 0) || 0;
      const storedScore = normalizeScore(data?.score);

      const effectiveScore = storedSeasonId === seasonId ? storedScore : 0;
      if (safeScore > effectiveScore) {
        tx.update(scoreRef, {
          username,
          score: safeScore,
          seasonId,
          updatedAt: serverTimestamp(),
        });
      }
    }

    updateAllTimeBestIfHigher(tx, userRef, userSnapTx, safeScore);
  });

  await syncHallOfFameMedals(uid).catch((err) => {
    console.warn("hall-of-fame medal self-claim failed:", err);
  });
}

export async function submitCrossyRoadScore(uid: string, score: number) {
  const safeScore = normalizeScore(score);
  if (safeScore <= 0) return;

  const userRef = doc(db, "users", uid);
  const userSnap = await getDoc(userRef);
  const rawUsername = userSnap.exists()
    ? String((userSnap.data() as any)?.username ?? "")
    : "";
  const username = isValidUsername(rawUsername) ? rawUsername : fallbackUsername(uid);

  const scoreRef = doc(db, "scores", "crossy-road", "users", uid);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(scoreRef);
    if (!snap.exists()) {
      tx.set(scoreRef, {
        username,
        score: safeScore,
        updatedAt: serverTimestamp(),
      });
      return;
    }

    const data = snap.data() as any;
    const storedScore = normalizeScore(data?.score);
    if (safeScore <= storedScore) return;

    tx.update(scoreRef, {
      username,
      score: safeScore,
      updatedAt: serverTimestamp(),
    });
  });
}

export async function submitSoundShooterScore(uid: string, score: number) {
  const safeScore = normalizeScore(score);
  if (safeScore <= 0) return;

  const userRef = doc(db, "users", uid);
  const userSnap = await getDoc(userRef);
  const rawUsername = userSnap.exists()
    ? String((userSnap.data() as any)?.username ?? "")
    : "";
  const username = isValidUsername(rawUsername) ? rawUsername : fallbackUsername(uid);

  const scoreRef = doc(db, "scores", "sound-shooter", "users", uid);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(scoreRef);
    if (!snap.exists()) {
      tx.set(scoreRef, {
        username,
        score: safeScore,
        updatedAt: serverTimestamp(),
      });
      return;
    }

    const data = snap.data() as any;
    const storedScore = normalizeScore(data?.score);
    if (safeScore <= storedScore) return;

    tx.update(scoreRef, {
      username,
      score: safeScore,
      updatedAt: serverTimestamp(),
    });
  });
}
