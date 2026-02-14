import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "../services/firebase";
import { submitCrossyRoadScore } from "../services/scoreService";
import UserBox from "./UserBox/UserBox";

type CrossyLeaderboardEntry = {
  uid: string;
  score: number;
  updatedAt: number;
};

type FullscreenCapableElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenCapableDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
  msExitFullscreen?: () => Promise<void> | void;
  msFullscreenElement?: Element | null;
};

const CROSSY_GAME_STORAGE_KEY_OLD = "@BouncyBacon:Character";
const CROSSY_GAME_STORAGE_KEY = "@CrossyDash:v1";
const CROSSY_POLL_INTERVAL_MS = 1400;
const CROSSY_MAX_ROWS = 5;
const CROSSY_HIGHSCORE_MESSAGE_TYPE = "crossy-highscore";

function clearCrossyLegacyStorage() {
  try {
    window.localStorage.removeItem(CROSSY_GAME_STORAGE_KEY_OLD);
  } catch (err) {
    console.warn("failed to clear crossy legacy storage:", err);
  }
}

function normalizeScore(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.floor(numeric);
}

function parseCrossyStorageValue(raw: string | null): number {
  if (!raw) return 0;

  try {
    const parsed = JSON.parse(raw) as { highscore?: unknown } | number | null;
    if (parsed && typeof parsed === "object") {
      return normalizeScore(parsed.highscore);
    }

    return normalizeScore(parsed);
  } catch {
    return normalizeScore(raw);
  }
}

function readCrossyBestScoreFromStorage(storage: Storage | null | undefined): number {
  if (!storage) return 0;

  try {
    return parseCrossyStorageValue(storage.getItem(CROSSY_GAME_STORAGE_KEY));
  } catch {
    return 0;
  }
}

function getFullscreenElement(): Element | null {
  const doc = document as FullscreenCapableDocument;
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? doc.msFullscreenElement ?? null;
}

export default function ExpoCrossyRoadEmbed() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const activeUidRef = useRef<string | null>(auth.currentUser?.uid ?? null);
  const [activeUid, setActiveUid] = useState<string | null>(activeUidRef.current);

  const observedBestRef = useRef(0);
  const submittedBestScoreRef = useRef(0);
  const pendingBestScoreRef = useRef(0);
  const bestSubmitInFlightRef = useRef(false);

  const [bestScoreUI, setBestScoreUI] = useState(0);
  const [dbBestScore, setDbBestScore] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [leaderboardRows, setLeaderboardRows] = useState<CrossyLeaderboardEntry[]>([]);

  const buildToken = "embed-stability-2026-02-14c";
  const createFrameSrc = (retry = 0) =>
    `/expo-crossy-road/index.html?v=${buildToken}${
      retry > 0 ? `&retry=${retry}` : ""
    }`;
  const src = createFrameSrc();

  const refreshFullscreenState = useCallback(() => {
    const stage = stageRef.current;
    const fullscreenEl = getFullscreenElement();
    setIsFullscreen(Boolean(stage && fullscreenEl === stage));
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const stage = stageRef.current;
    if (!stage) return;

    const doc = document as FullscreenCapableDocument;
    const fullscreenEl = getFullscreenElement();

    try {
      if (fullscreenEl === stage) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (doc.webkitExitFullscreen) {
          await doc.webkitExitFullscreen();
        } else if (doc.msExitFullscreen) {
          await doc.msExitFullscreen();
        }
      } else {
        const target = stage as FullscreenCapableElement;
        if (target.requestFullscreen) {
          await target.requestFullscreen();
        } else if (target.webkitRequestFullscreen) {
          await target.webkitRequestFullscreen();
        } else if (target.msRequestFullscreen) {
          await target.msRequestFullscreen();
        }
      }
    } catch (err) {
      console.warn("crossy fullscreen toggle failed:", err);
    } finally {
      refreshFullscreenState();
    }
  }, [refreshFullscreenState]);

  const flushBestScoreUpdate = useCallback(() => {
    const uid = activeUidRef.current;
    if (!uid) return;

    if (bestSubmitInFlightRef.current) return;

    const targetScore = pendingBestScoreRef.current;
    if (targetScore <= submittedBestScoreRef.current) {
      pendingBestScoreRef.current = 0;
      return;
    }

    bestSubmitInFlightRef.current = true;

    submitCrossyRoadScore(uid, targetScore)
      .then(() => {
        submittedBestScoreRef.current = Math.max(submittedBestScoreRef.current, targetScore);
        if (pendingBestScoreRef.current <= targetScore) {
          pendingBestScoreRef.current = 0;
        }
      })
      .catch((err) => {
        console.warn("crossy score submit failed:", err);
      })
      .finally(() => {
        bestSubmitInFlightRef.current = false;
        if (pendingBestScoreRef.current > submittedBestScoreRef.current) {
          flushBestScoreUpdate();
        }
      });
  }, []);

  const applyObservedBest = useCallback(
    (nextObservedBest: number) => {
      const normalized = normalizeScore(nextObservedBest);
      if (normalized > observedBestRef.current) {
        observedBestRef.current = normalized;
      }

      const observedBest = observedBestRef.current;
      setBestScoreUI(observedBest);

      const uid = activeUidRef.current;
      if (!uid) return;

      if (
        observedBest <= submittedBestScoreRef.current &&
        observedBest <= pendingBestScoreRef.current
      ) {
        return;
      }

      pendingBestScoreRef.current = Math.max(pendingBestScoreRef.current, observedBest);
      flushBestScoreUpdate();
    },
    [flushBestScoreUpdate]
  );

  const syncObservedBestFromStorage = useCallback(() => {
    const frameStorage = iframeRef.current?.contentWindow?.localStorage ?? null;

    const observedBest = Math.max(
      readCrossyBestScoreFromStorage(window.localStorage),
      readCrossyBestScoreFromStorage(frameStorage)
    );
    applyObservedBest(observedBest);
  }, [applyObservedBest]);

  useEffect(() => {
    clearCrossyLegacyStorage();
    const unsub = onAuthStateChanged(auth, (user) => {
      const nextUid = user?.uid ?? null;
      activeUidRef.current = nextUid;
      setActiveUid(nextUid);

      pendingBestScoreRef.current = 0;
      submittedBestScoreRef.current = 0;
      bestSubmitInFlightRef.current = false;
      setDbBestScore(null);
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!activeUid) {
      setDbBestScore(null);
      return;
    }

    const bestScoreRef = doc(db, "scores", "crossy-road", "users", activeUid);
    const unsub = onSnapshot(
      bestScoreRef,
      (snap) => {
        const nextDbBest = snap.exists()
          ? normalizeScore((snap.data() as any)?.score)
          : 0;

        setDbBestScore(nextDbBest);
        submittedBestScoreRef.current = Math.max(submittedBestScoreRef.current, nextDbBest);
        if (pendingBestScoreRef.current <= nextDbBest) {
          pendingBestScoreRef.current = 0;
        }
      },
      (err) => console.warn("crossy best score listener failed:", err)
    );

    return () => unsub();
  }, [activeUid]);

  useEffect(() => {
    const q = collection(db, "scores", "crossy-road", "users");
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs
          .map((d) => {
            const data = d.data() as any;
            const updatedRaw = data?.updatedAt;
            const updatedAt =
              updatedRaw && typeof updatedRaw.toMillis === "function"
                ? updatedRaw.toMillis()
                : Number(updatedRaw ?? 0) || 0;

            return {
              uid: d.id,
              score: normalizeScore(data?.score),
              updatedAt,
            };
          })
          .filter((row) => row.score > 0)
          .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return b.updatedAt - a.updatedAt;
          })
          .slice(0, CROSSY_MAX_ROWS);

        setLeaderboardRows(rows);
      },
      (err) => console.warn("crossy leaderboard listener failed:", err)
    );

    return () => unsub();
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;

      const payload = event.data;
      if (!payload || typeof payload !== "object") return;

      const data = payload as Record<string, unknown>;
      if (data.type !== CROSSY_HIGHSCORE_MESSAGE_TYPE) return;

      const reportedBest = normalizeScore(data.highscore ?? data.score);
      if (reportedBest <= 0) return;

      applyObservedBest(reportedBest);
    };

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, [applyObservedBest]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === CROSSY_GAME_STORAGE_KEY) {
        syncObservedBestFromStorage();
      }
    };

    window.addEventListener("storage", onStorage);
    const intervalId = window.setInterval(() => {
      syncObservedBestFromStorage();
    }, CROSSY_POLL_INTERVAL_MS);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.clearInterval(intervalId);
    };
  }, [syncObservedBestFromStorage]);

  useEffect(() => {
    const onFullscreenChange = () => {
      refreshFullscreenState();
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange as EventListener);
    document.addEventListener("MSFullscreenChange", onFullscreenChange as EventListener);

    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange as EventListener);
      document.removeEventListener("MSFullscreenChange", onFullscreenChange as EventListener);
    };
  }, [refreshFullscreenState]);

  const displayedBestScore = activeUid ? (dbBestScore ?? bestScoreUI) : bestScoreUI;

  return (
    <main className="game-page crossy-page">
      <section className="home-hero crossy-hero">
        <div className="home-hero__content">
          <h2 className="home-hero__title">
            <span className="home-hero__title-gradient">Crossy Dash</span>
          </h2>
          <p className="home-hero__subtitle">
            Recomendet to use Fullscrean!
          </p>
        </div>
      </section>

      <section className="crossy-shell">
        <aside className="crossy-panel">
          <div className="crossy-panel__title">Your Best</div>
          <div className="crossy-stat">
            <span className="crossy-stat__label">Best Score</span>
            <strong className="crossy-stat__value">{displayedBestScore.toLocaleString()}</strong>
          </div>
          <div className="crossy-note">
            {/* Best score is loaded from database and synced from your game highscore. */}
          </div>
        </aside>

        <div
          ref={stageRef}
          className={`expo-crossy-stage ${isFullscreen ? "is-fullscreen" : ""}`}
        >
          <button
            type="button"
            className="expo-crossy-fullscreen-btn"
            onClick={toggleFullscreen}
            aria-pressed={isFullscreen}
          >
            {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          </button>

          <div className="expo-crossy-container">
            <iframe
              ref={iframeRef}
              key={src}
              className="expo-crossy-frame"
              src={src}
              title="Expo Crossy Road"
              allow="autoplay; fullscreen"
              
            />
          </div>
        </div>

        <aside className="crossy-panel crossy-panel--leaderboard">
          <div className="crossy-panel__header">
            <div className="crossy-panel__title">Leaderboard</div>
            <span className="crossy-panel__badge">ALL-TIME</span>
          </div>

          {leaderboardRows.length === 0 ? (
            <div className="crossy-empty">Play and set a score to appear here.</div>
          ) : (
            leaderboardRows.map((row, i) => (
              <div key={`${row.uid}-${i}`} className="crossy-row">
                <span className="crossy-rank">{i + 1}</span>
                <div className="crossy-user">
                  <UserBox userId={row.uid} />
                </div>
                <span className="crossy-score">{row.score.toLocaleString()}</span>
              </div>
            ))
          )}
        </aside>
      </section>
    </main>
  );
}
