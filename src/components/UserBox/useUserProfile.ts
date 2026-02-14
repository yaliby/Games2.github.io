import { useEffect, useState } from "react";
import {
  Timestamp,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc,
} from "firebase/firestore";
import { db } from "../../services/firebase";

export type Medal = {
  id: string;
  title: string;
  description: string;
  icon?: string;
  game?: string;
  priority: number;
  earnedAt?: Date;
};

type UserProfile = {
  username: string;
  photoURL?: string;
  medals: Medal[];
  allMedals: Medal[];
};

type UserAchievement = {
  id: string;
  earnedAt?: any;
};

type AchievementMeta = {
  id: string;
  title: string;
  description: string;
  icon?: string;
  game?: string;
  priority?: number;
};

const BASE_ICON_PATH = import.meta.env.BASE_URL ?? "/";

const FALLBACK_ACHIEVEMENTS: AchievementMeta[] = [
  {
    id: "bb_gold",
    title: "Block Blast #1",
    description: "Finished season in 1st place.",
    icon: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Twemoji12_1f947.svg/500px-Twemoji12_1f947.svg.png",
    game: "block-blast",
    priority: 100,
  },
  {
    id: "bb_silver",
    title: "Block Blast #2",
    description: "Finished season in 2nd place.",
    icon: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Twemoji12_1f948.svg/960px-Twemoji12_1f948.svg.png",
    game: "block-blast",
    priority: 90,
  },
  {
    id: "bb_bronze",
    title: "Block Blast #3",
    description: "Finished season in 3rd place.",
    icon: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b8/Twemoji2_1f949.svg/500px-Twemoji2_1f949.svg.png",
    game: "block-blast",
    priority: 80,
  },
  {
    id: "wg_gold",
    title: "Word Guess #1",
    description: "Finished season in 1st place.",
    icon: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Twemoji12_1f947.svg/500px-Twemoji12_1f947.svg.png",
    game: "word-guess",
    priority: 95,
  },
  {
    id: "wg_silver",
    title: "Word Guess #2",
    description: "Finished season in 2nd place.",
    icon: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Twemoji12_1f948.svg/960px-Twemoji12_1f948.svg.png",
    game: "word-guess",
    priority: 85,
  },
  {
    id: "wg_bronze",
    title: "Word Guess #3",
    description: "Finished season in 3rd place.",
    icon: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b8/Twemoji2_1f949.svg/500px-Twemoji2_1f949.svg.png",
    game: "word-guess",
    priority: 75,
  },
  {
    id: "wc_gold",
    title: "Which Country #1",
    description: "Finished season in 1st place.",
    icon: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Twemoji12_1f947.svg/500px-Twemoji12_1f947.svg.png",
    game: "which-country",
    priority: 94,
  },
  {
    id: "wc_silver",
    title: "Which Country #2",
    description: "Finished season in 2nd place.",
    icon: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Twemoji12_1f948.svg/960px-Twemoji12_1f948.svg.png",
    game: "which-country",
    priority: 84,
  },
  {
    id: "wc_bronze",
    title: "Which Country #3",
    description: "Finished season in 3rd place.",
    icon: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b8/Twemoji2_1f949.svg/500px-Twemoji2_1f949.svg.png",
    game: "which-country",
    priority: 74,
  },
  {
    id: "hof_gold",
    title: "Hall of Fame #1",
    description: "Reached 1st place on the all-time leaderboard.",
    icon: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Twemoji12_1f947.svg/500px-Twemoji12_1f947.svg.png",
    game: "hall-of-fame",
    priority: 130,
  },
  {
    id: "hof_silver",
    title: "Hall of Fame #2",
    description: "Reached 2nd place on the all-time leaderboard.",
    icon: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Twemoji12_1f948.svg/960px-Twemoji12_1f948.svg.png",
    game: "hall-of-fame",
    priority: 120,
  },
  {
    id: "hof_bronze",
    title: "Hall of Fame #3",
    description: "Reached 3rd place on the all-time leaderboard.",
    icon: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b8/Twemoji2_1f949.svg/500px-Twemoji2_1f949.svg.png",
    game: "hall-of-fame",
    priority: 110,
  },
  {
    id: "cf_bot_master",
    title: "Connect Four Bot Master",
    description: "Beat the bot on the highest difficulty.",
    icon: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/90/Twemoji_1f3c6.svg/960px-Twemoji_1f3c6.svg.png",
    game: "connect-four",
    priority: 70,
  },
  {
    id: "checkers_bot_master",
    title: "Checkers Bot Master",
    description: "Beat the bot on the highest difficulty.",
    icon: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/90/Twemoji_1f3c6.svg/960px-Twemoji_1f3c6.svg.png",
    game: "checkers",
    priority: 70,
  },
  {
    id: "ttt_bot_master_3",
    title: "Tic Tac Toe 3×3 Master",
    description: "Beat the bot on HARD (3×3).",
    icon: `${BASE_ICON_PATH}img/ttt-medal-3.svg`,
    game: "tic-tac-toe",
    priority: 60,
  },
  {
    id: "ttt_bot_master_5",
    title: "Tic Tac Toe 5×5 Master",
    description: "Beat the bot on HARD (5×5, 4 in a row).",
    icon: `${BASE_ICON_PATH}img/ttt-medal-5.svg`,
    game: "tic-tac-toe",
    priority: 65,
  },
  {
    id: "ttt_bot_master_7",
    title: "Tic Tac Toe 7×7 Master",
    description: "Beat the bot on HARD (7×7, 5 in a row).",
    icon: `${BASE_ICON_PATH}img/ttt-medal-7.svg`,
    game: "tic-tac-toe",
    priority: 70,
  },
];

let achievementsCache: AchievementMeta[] | null = null;
let achievementsPromise: Promise<AchievementMeta[]> | null = null;

async function loadAchievementsCatalog(): Promise<AchievementMeta[]> {
  if (achievementsCache) return achievementsCache;
  if (achievementsPromise) return achievementsPromise;

  achievementsPromise = (async () => {
    const snap = await getDocs(collection(db, "achievements"));
    const items = snap.docs.map((d) => {
      const data = d.data() as any;
      return {
        id: d.id,
        title: String(data?.title ?? "Achievement"),
        description: String(data?.description ?? ""),
        icon: data?.icon ? String(data.icon) : undefined,
        game: data?.game ? String(data.game) : undefined,
        priority: typeof data?.priority === "number" ? data.priority : 0,
      } as AchievementMeta;
    });
    if (items.length === 0) {
      achievementsCache = FALLBACK_ACHIEVEMENTS;
      return FALLBACK_ACHIEVEMENTS;
    }

    const byId = new Map(items.map((a) => [a.id, a]));
    for (const fallback of FALLBACK_ACHIEVEMENTS) {
      if (!byId.has(fallback.id)) {
        byId.set(fallback.id, fallback);
      }
    }
    achievementsCache = Array.from(byId.values());
    return achievementsCache;
  })();

  return achievementsPromise;
}

function parseEarnedAt(value: any): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();
  return undefined;
}

export function useUserProfile(userId: string | null) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!userId) {
        setProfile(null);
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const userRef = doc(db, "users", userId);
        const userSnap = await getDoc(userRef);
        const userData = userSnap.exists() ? (userSnap.data() as any) : {};

        const username = String(userData?.username ?? "Player");
        const photoURL = userData?.photoURL ? String(userData.photoURL) : undefined;
        const userAchievements: UserAchievement[] = Array.isArray(userData?.achievements)
          ? userData.achievements
          : [];

        // Temporary: auto-grant a demo medal to testLoging
        if (
          username.toLowerCase() === "testloging" &&
          !userAchievements.some((a) => a?.id === "bb_gold")
        ) {
          try {
            await updateDoc(userRef, {
              achievements: arrayUnion({ id: "bb_gold", earnedAt: Timestamp.now() }),
            });
            userAchievements.push({ id: "bb_gold", earnedAt: new Date() });
          } catch {
            // ignore demo failures
          }
        }

        const catalog = await loadAchievementsCatalog();
        const catalogMap = new Map(catalog.map((a) => [a.id, a]));

        const medals: Medal[] = userAchievements
          .map((entry) => {
            const meta = catalogMap.get(entry.id);
            if (!meta) return null;
            return {
              id: meta.id,
              title: meta.title,
              description: meta.description,
              icon: meta.icon,
              game: meta.game,
              priority: meta.priority ?? 0,
              earnedAt: parseEarnedAt(entry.earnedAt),
            } as Medal;
          })
          .filter(Boolean) as Medal[];

        medals.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
        const top = medals.slice(0, 3);

        if (!cancelled) {
          setProfile({ username, photoURL, medals: top, allMedals: medals });
        }
      } catch {
        if (!cancelled) {
          setProfile(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return { profile, loading };
}
