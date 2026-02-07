import { arrayUnion, doc, getDoc, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";

export async function addAchievement(uid: string, achievementId: string) {
  const ref = doc(db, "users", uid);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;

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
        earnedAt: serverTimestamp(),
      }),
    });
  });
}
