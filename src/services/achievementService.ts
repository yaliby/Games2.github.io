import { Timestamp, arrayUnion, doc, runTransaction } from "firebase/firestore";
import { db } from "./firebase";

export async function addAchievement(uid: string, achievementId: string) {
  const ref = doc(db, "users", uid);

  await runTransaction(db, async (tx) => {
    const earnedAt = Timestamp.now();
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      tx.set(
        ref,
        {
          achievements: [{ id: achievementId, earnedAt }],
        },
        { merge: true }
      );
      return;
    }

    const data = snap.data() as any;
    const current: Array<{ id: string }> = Array.isArray(data?.achievements)
      ? data.achievements
      : [];

    if (current.some((a) => a?.id === achievementId)) {
      return;
    }

    tx.update(ref, {
      achievements: arrayUnion({
        id: achievementId,
        earnedAt,
      }),
    });
  });
}
