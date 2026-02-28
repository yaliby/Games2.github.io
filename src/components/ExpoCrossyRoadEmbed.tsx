import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "../services/firebase";
import { submitCrossyRoadScore } from "../services/scoreService";
import UserBox from "./UserBox/UserBox";
import { CROSSY_EMBED_ENTRY_BUNDLE } from "./crossyEmbedManifest";

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
const CROSSY_HIGHSCORE_MESSAGE_TYPE = "crossy-highscore";
const CROSSY_EMBED_MARKER = "data-embed-path-fix";
const CROSSY_ENTRY_MARKER = "/expo-crossy-road/_expo/static/js/web/entry-";

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

function normalizeFramePathCandidate(path: string): string {
  const candidate = path.trim();
  if (!candidate) return "";
  if (candidate.startsWith("./") || candidate.startsWith("../")) return candidate;
  return candidate.replace(/\/{2,}/g, "/");
}

function looksLikeCrossyExportHtml(html: string): boolean {
  return html.includes(CROSSY_EMBED_MARKER) && html.includes(CROSSY_ENTRY_MARKER);
}

function createCrossySrcDoc(entryBundlePath: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body, #root { height: 100%; margin: 0; }
      body { overflow: hidden; }
      #root { display: flex; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">globalThis.__EXPO_ROUTER_HYDRATE__ = true;</script>
    <script src="${entryBundlePath}" defer></script>
  </body>
</html>`;
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
  const [frameCandidateIndex, setFrameCandidateIndex] = useState(0);
  const [frameLoadError, setFrameLoadError] = useState<string | null>(null);
  const [useSrcDocFallback, setUseSrcDocFallback] = useState(false);
  const [srcDocEntryBundleUrl, setSrcDocEntryBundleUrl] = useState(CROSSY_EMBED_ENTRY_BUNDLE);

  const buildToken = "embed-stability-2026-02-27d";
  const basePath = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");
  const framePathCandidates = useMemo(() => {
    const pathname = typeof window !== "undefined" ? window.location.pathname : "";
    const routeBase = pathname.replace(/\/game\/expo-crossy-road\/?$/, "");
    const candidates = [
      `${basePath}/expo-crossy-road/index.html`,
      `${basePath}/expo-crossy-road/`,
      "/expo-crossy-road/index.html",
      "/expo-crossy-road/",
      `${routeBase}/expo-crossy-road/index.html`,
      `${routeBase}/expo-crossy-road/`,
      "./expo-crossy-road/index.html",
      "../expo-crossy-road/index.html",
    ]
      .map(normalizeFramePathCandidate)
      .filter(Boolean);

    return Array.from(new Set(candidates));
  }, [basePath]);

  const createFrameSrc = useCallback(
    (candidateIndex: number, retry = 0) => {
      const safeIndex = Math.max(0, Math.min(candidateIndex, framePathCandidates.length - 1));
      const baseCandidate = framePathCandidates[safeIndex] ?? "/expo-crossy-road/index.html";
      const separator = baseCandidate.includes("?") ? "&" : "?";
      return `${baseCandidate}${separator}v=${buildToken}${retry > 0 ? `&retry=${retry}` : ""}`;
    },
    [buildToken, framePathCandidates]
  );

  const src = createFrameSrc(frameCandidateIndex);
  const srcDoc = useMemo(() => createCrossySrcDoc(srcDocEntryBundleUrl), [srcDocEntryBundleUrl]);

  const tryActivateSrcDocFallback = useCallback(async (reason: string) => {
    const candidates = [
      CROSSY_EMBED_ENTRY_BUNDLE,
      CROSSY_EMBED_ENTRY_BUNDLE.replace("/expo-crossy-road/", `${basePath}/expo-crossy-road/`),
    ].filter(Boolean);

    for (const bundleUrl of Array.from(new Set(candidates))) {
      try {
        const headResponse = await fetch(bundleUrl, {
          method: "HEAD",
          cache: "no-store",
          credentials: "same-origin",
        });
        if (headResponse.ok) {
          console.warn("crossy iframe fallback to srcDoc entry bundle:", { reason, bundleUrl });
          setSrcDocEntryBundleUrl(bundleUrl);
          setUseSrcDocFallback(true);
          setFrameLoadError(null);
          return true;
        }
      } catch {
        // Some hosts block HEAD; fallback to a regular GET check below.
      }

      try {
        const getResponse = await fetch(bundleUrl, {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (getResponse.ok) {
          console.warn("crossy iframe fallback to srcDoc entry bundle:", { reason, bundleUrl });
          setSrcDocEntryBundleUrl(bundleUrl);
          setUseSrcDocFallback(true);
          setFrameLoadError(null);
          return true;
        }
      } catch {
        // Try next candidate.
      }
    }

    return false;
  }, [basePath]);

  const moveToNextFrameCandidate = useCallback(
    (reason: string) => {
      if (frameCandidateIndex + 1 < framePathCandidates.length) {
        const from = framePathCandidates[frameCandidateIndex];
        const to = framePathCandidates[frameCandidateIndex + 1];
        console.warn("crossy iframe fallback to next path:", { reason, from, to });
        setFrameCandidateIndex(frameCandidateIndex + 1);
        setFrameLoadError(null);
        return;
      }

      void tryActivateSrcDocFallback(reason).then((activated) => {
        if (activated) return;
        setFrameLoadError(
          "Crossy files were not served by this host path. Configure the server to serve /expo-crossy-road/* as static files."
        );
      });
    },
    [frameCandidateIndex, framePathCandidates, tryActivateSrcDocFallback]
  );

  const validateLoadedFrame = useCallback(() => {
    if (useSrcDocFallback) return;

    const frameDoc = iframeRef.current?.contentDocument;
    if (!frameDoc) return;

    const hasEmbedMarkerScript = Boolean(frameDoc.querySelector("script[data-embed-path-fix]"));
    const hasCrossyEntryScript = Boolean(
      frameDoc.querySelector(`script[src*="${CROSSY_ENTRY_MARKER}"]`)
    );

    if (hasEmbedMarkerScript || hasCrossyEntryScript) {
      setFrameLoadError(null);
      return;
    }

    moveToNextFrameCandidate("loaded non-crossy document");
  }, [moveToNextFrameCandidate, useSrcDocFallback]);

  useEffect(() => {
    let cancelled = false;

    async function probeFrameCandidates() {
      for (let i = 0; i < framePathCandidates.length; i += 1) {
        const probeUrl = createFrameSrc(i);
        try {
          const response = await fetch(probeUrl, {
            cache: "no-store",
            credentials: "same-origin",
          });
          if (!response.ok) continue;

          const html = await response.text();
          if (looksLikeCrossyExportHtml(html)) {
            if (!cancelled) {
              setFrameCandidateIndex(i);
              setFrameLoadError(null);
            }
            return;
          }
        } catch {
          // Try the next candidate.
        }
      }

      if (!cancelled) {
        const activated = await tryActivateSrcDocFallback("all frame path probes failed");
        if (!activated) {
          setFrameLoadError(
            "Crossy embed probe failed for all known paths. The server is likely returning the SPA shell instead of static game files."
          );
        }
      }
    }

    probeFrameCandidates();
    return () => {
      cancelled = true;
    };
  }, [createFrameSrc, framePathCandidates, tryActivateSrcDocFallback]);

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
          });

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
            {frameLoadError ?? ""}
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
              key={useSrcDocFallback ? `crossy-srcdoc-${buildToken}` : src}
              className="expo-crossy-frame"
              src={useSrcDocFallback ? undefined : src}
              srcDoc={useSrcDocFallback ? srcDoc : undefined}
              title="Expo Crossy Road"
              allow="autoplay; fullscreen"
              onLoad={useSrcDocFallback ? undefined : validateLoadedFrame}
              onError={() => {
                if (useSrcDocFallback) {
                  setFrameLoadError("Crossy fallback bundle failed to load.");
                  return;
                }
                moveToNextFrameCandidate("iframe load error");
              }}
            />
          </div>
        </div>

        <aside className="crossy-panel crossy-panel--leaderboard">
          <div className="crossy-panel__header">
            <div className="crossy-panel__title">Leaderboard</div>
            <span className="crossy-panel__badge">ALL-TIME</span>
          </div>
          <div className="crossy-leaderboard-list">
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
          </div>
        </aside>
      </section>
    </main>
  );
}
