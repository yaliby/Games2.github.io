import { doc, getDoc, runTransaction, Timestamp } from "firebase/firestore";
import { db } from "./firebase";

type WeeklyDoc = {
  seasonId: number;
  lastReset: Timestamp;
  nextReset: Timestamp;
};

const WEEKLY_DOC_PATH = ["system", "weekly"] as const;

function getNextFridayAtEightUTC(from: Date): Date {
  const utcNow = new Date(
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate(),
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds()
    )
  );

  const targetDow = 5; // Friday
  const dow = utcNow.getUTCDay();
  let daysUntil = (targetDow - dow + 7) % 7;

  const todayAtEight = Date.UTC(
    utcNow.getUTCFullYear(),
    utcNow.getUTCMonth(),
    utcNow.getUTCDate(),
    8,
    0,
    0,
    0
  );

  if (daysUntil === 0 && utcNow.getTime() >= todayAtEight) {
    daysUntil = 7;
  }

  return new Date(
    Date.UTC(
      utcNow.getUTCFullYear(),
      utcNow.getUTCMonth(),
      utcNow.getUTCDate() + daysUntil,
      8,
      0,
      0,
      0
    )
  );
}

function parseTimestamp(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof (value as any).toDate === "function") return (value as any).toDate();
  return null;
}

export async function checkWeeklyReset(): Promise<boolean> {
  const ref = doc(db, ...WEEKLY_DOC_PATH);
  let didReset = false;

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const now = new Date();

    if (!snap.exists()) {
      const nextReset = getNextFridayAtEightUTC(now);
      tx.set(ref, {
        seasonId: 1,
        lastReset: Timestamp.fromDate(now),
        nextReset: Timestamp.fromDate(nextReset),
      } satisfies WeeklyDoc);
      return;
    }

    const data = snap.data() as Partial<WeeklyDoc> | undefined;
    const nextReset = parseTimestamp(data?.nextReset);

    if (nextReset && now < nextReset) {
      return;
    }

    const seasonId = Number(data?.seasonId ?? 0) || 0;
    const next = getNextFridayAtEightUTC(now);

    tx.update(ref, {
      seasonId: seasonId + 1,
      lastReset: Timestamp.fromDate(now),
      nextReset: Timestamp.fromDate(next),
    });

    didReset = true;
  });

  return didReset;
}

export async function getCurrentSeasonId(): Promise<number> {
  const ref = doc(db, ...WEEKLY_DOC_PATH);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await checkWeeklyReset();
    const after = await getDoc(ref);
    if (!after.exists()) {
      return 1;
    }
    const seasonId = Number((after.data() as any)?.seasonId ?? 1) || 1;
    return seasonId;
  }

  const seasonId = Number((snap.data() as any)?.seasonId ?? 1) || 1;
  return seasonId;
}
