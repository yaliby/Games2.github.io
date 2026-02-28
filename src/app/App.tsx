import { Suspense, lazy, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Routes, Route, useLocation } from "react-router-dom";

import Header from "../components/Header";
import Footer from "../components/Footer";

import Home from "../pages/Home";
import Game from "../pages/Game";
import NotFound from "../pages/NotFound";
import Secret from "../pages/Secret";
import Profile from "../pages/Profile";

import CheckersGame from "../components/checkers/CheckersGame";
import SlitherGame from "../components/slither/SlitherGame";
import BlockBlastGame from "../components/BlockBlast/BlockBlastGame";
import BlobBlastGame from "../components/BlobBlast/BlobBlastGame";
import TicTacToeGame from "../components/tic-tac-toe/TicTacToeGame";
import WordGuessGame from "../components/word-guess/WordGuessGame";
import ExpoCrossyRoadEmbed from "../components/ExpoCrossyRoadEmbed";
import WhichCountryGame from "../components/Which contry/WhichCountryGame";
import BackgammonGame from "../components/Backgammon";
import HourlyMagicPrompt from "../components/HourlyMagicPrompt";
import CoyoteFlapyGame from "../components/CoyoteFlapy/CoyoteFlapyGame";
import SysTrisGame from "../components/SysTris/SysTrisGame";
import Game6767 from "../components/6767/Game6767";
import DontTouchTheSpikesGame from "../components/DontTouchTheSpikes/DontTouchTheSpikesGame";
import BitsSniperGame from "../components/bitsSniper/BitsSniperGame";
import RaidHeroGame from "../components/RaidHearo/RaidHeroGame";

import Login from "../loginRegistry/Login";
import Register from "../loginRegistry/Register";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../services/firebase";
import { checkWeeklyReset, getCurrentSeasonId } from "../services/resetService";
import {
  awardHallOfFameMedalsByAdmin,
  awardSeasonMedalsByAdmin,
  claimSeasonMedalsForUser,
} from "../services/medalService";
import { isAdminUid } from "../services/admin";

const SoundShooterGame = lazy(() => import("../components/sound-shooter/SoundShooter"));

const SINGLE_TAB_LOCK_KEY = "gameshub:single-tab-lock:v1";
const SINGLE_TAB_HEARTBEAT_MS = 1800;
const SINGLE_TAB_STALE_MS = 6500;
const SITE_ENTRY_INTRO_CENTER_HOLD_MS = 2200;
const SITE_ENTRY_INTRO_MOVE_DURATION_MS = 980;
const SITE_LOGO_SRC = `${import.meta.env.BASE_URL}img/logo.png`;
const SITE_ENTRY_GLYPH_RECTS = {
  A: { x: 53, y: 24, w: 155, h: 120 },
  B: { x: 262, y: 24, w: 130, h: 120 },
  E: { x: 833, y: 29, w: 130, h: 113 },
  I: { x: 600, y: 214, w: 49, h: 110 },
  K: { x: 839, y: 214, w: 130, h: 110 },
  L: { x: 72, y: 390, w: 109, h: 110 },
  N: { x: 445, y: 390, w: 135, h: 111 },
  R: { x: 250, y: 559, w: 158, h: 120 },
  Y: { x: 647, y: 747, w: 149, h: 113 },
} as const;
const SITE_ENTRY_WORDMARK_TOKENS = ["Y", "A", "L", "I", " ", "B", "E", "N", " ", "Y", "A", "K", "A", "R"] as const;

type IntroGlyphChar = keyof typeof SITE_ENTRY_GLYPH_RECTS;

type IntroWordmarkGlyph = {
  char: IntroGlyphChar;
  offsetUnits: number;
  delayMs: number;
};

const SITE_ENTRY_WORDMARK_GLYPHS: IntroWordmarkGlyph[] = (() => {
  const placed: Array<{ char: IntroGlyphChar; position: number }> = [];
  let cursor = 0;

  for (const token of SITE_ENTRY_WORDMARK_TOKENS) {
    if (token === " ") {
      cursor += 1.95;
      continue;
    }
    placed.push({ char: token as IntroGlyphChar, position: cursor });
    cursor += 1.18;
  }

  if (placed.length === 0) return [];

  const center = (placed[0].position + placed[placed.length - 1].position) * 0.5;
  return placed.map((item, index) => ({
    char: item.char,
    offsetUnits: item.position - center,
    delayMs: 90 + index * 95,
  }));
})();

type SingleTabLockPayload = {
  tabId: string;
  updatedAt: number;
};

function createTabId() {
  return `tab_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function readSingleTabLock(): SingleTabLockPayload | null {
  try {
    const raw = window.localStorage.getItem(SINGLE_TAB_LOCK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SingleTabLockPayload>;
    if (typeof parsed.tabId !== "string" || typeof parsed.updatedAt !== "number") return null;
    if (!Number.isFinite(parsed.updatedAt)) return null;
    return { tabId: parsed.tabId, updatedAt: parsed.updatedAt };
  } catch {
    return null;
  }
}

function writeSingleTabLock(payload: SingleTabLockPayload): void {
  try {
    window.localStorage.setItem(SINGLE_TAB_LOCK_KEY, JSON.stringify(payload));
  } catch {
    // Ignore localStorage write failures (private mode/quotas).
  }
}

function clearSingleTabLockIfOwned(tabId: string): void {
  try {
    const lock = readSingleTabLock();
    if (lock?.tabId === tabId) {
      window.localStorage.removeItem(SINGLE_TAB_LOCK_KEY);
    }
  } catch {
    // Ignore localStorage cleanup failures.
  }
}

function isLockFresh(lock: SingleTabLockPayload, nowMs: number): boolean {
  return nowMs - lock.updatedAt <= SINGLE_TAB_STALE_MS;
}

export default function App() {
  const location = useLocation();
  const tabIdRef = useRef(createTabId());
  const ownsLockRef = useRef(false);
  const allowHomeIntroOnInitialLoadRef = useRef(location.pathname === "/");
  const introPlayedRef = useRef(false);
  const [isSecondaryTab, setIsSecondaryTab] = useState(false);
  const [showEntryIntro, setShowEntryIntro] = useState(false);
  const [entryIntroLift, setEntryIntroLift] = useState(false);

  const isHomeRoute = location.pathname === "/";
  const isSecret = location.pathname === "/secret";
  const isWhichCountryRoute = location.pathname === "/game/which-country";

  // ✅ רשימת כל הנתיבים החוקיים אצלך (כמו ברואטר)
  const knownRoutes = useMemo(
    () => new Set([
      "/",
      "/login",
      "/register",
      "/secret",
      "/game/connect-four",
      "/game/checkers",
      "/game/slither",
      "/game/block-blast",
      "/game/blob-blast",
      "/game/tic-tac-toe",
      "/game/word-guess",
      "/game/expo-crossy-road",
      "/game/which-country",
      "/game/backgammon",
      "/game/sound-shooter",
      "/game/coyote-flapy",
      "/game/systris",
      "/game/6767",
      "/game/dont-touch-the-spikes",
      "/game/bits-sniper",
      "/game/raid-hero",
    ]),
    []
  );

  const isProfileRoute = location.pathname.startsWith("/profile/");
  const isNotFound = !knownRoutes.has(location.pathname) && !isProfileRoute;

  useEffect(() => {
    if (!allowHomeIntroOnInitialLoadRef.current || !isHomeRoute || isSecret || isNotFound) {
      setShowEntryIntro(false);
      setEntryIntroLift(false);
      return;
    }
    if (introPlayedRef.current) return;

    setEntryIntroLift(false);
    setShowEntryIntro(true);

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const centerHold = prefersReducedMotion ? 80 : SITE_ENTRY_INTRO_CENTER_HOLD_MS;
    const moveDuration = prefersReducedMotion ? 240 : SITE_ENTRY_INTRO_MOVE_DURATION_MS;

    const liftTimer = window.setTimeout(() => {
      setEntryIntroLift(true);
    }, centerHold);

    const hideTimer = window.setTimeout(() => {
      setShowEntryIntro(false);
      setEntryIntroLift(false);
      introPlayedRef.current = true;
    }, centerHold + moveDuration);

    return () => {
      window.clearTimeout(liftTimer);
      window.clearTimeout(hideTimer);
    };
  }, [isHomeRoute, isNotFound, isSecret]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      void (async () => {
        try {
          await checkWeeklyReset();
          if (!user) return;

          const seasonId = await getCurrentSeasonId();
          if (isAdminUid(user.uid)) {
            await awardHallOfFameMedalsByAdmin();
            if (seasonId > 1) {
              await awardSeasonMedalsByAdmin(seasonId - 1);
            }
            return;
          }

          if (seasonId <= 1) return;

          await claimSeasonMedalsForUser(user.uid, seasonId - 1);
        } catch (err) {
          console.warn("weekly reset/medal claim failed:", err);
        }
      })();
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    const tabId = tabIdRef.current;

    const setBlocked = (blocked: boolean) => {
      setIsSecondaryTab((prev) => (prev === blocked ? prev : blocked));
    };

    const tryAcquire = (): boolean => {
      const now = Date.now();
      const existing = readSingleTabLock();
      const activeOtherTab = existing && existing.tabId !== tabId && isLockFresh(existing, now);
      if (activeOtherTab) {
        ownsLockRef.current = false;
        setBlocked(true);
        return false;
      }

      writeSingleTabLock({ tabId, updatedAt: now });
      const verify = readSingleTabLock();
      const didAcquire = verify?.tabId === tabId;
      ownsLockRef.current = didAcquire;
      setBlocked(!didAcquire);
      return didAcquire;
    };

    const maintainLock = () => {
      const now = Date.now();
      const lock = readSingleTabLock();

      if (ownsLockRef.current) {
        if (!lock || lock.tabId === tabId || !isLockFresh(lock, now)) {
          writeSingleTabLock({ tabId, updatedAt: now });
          setBlocked(false);
          return;
        }
        ownsLockRef.current = false;
        setBlocked(true);
        return;
      }

      tryAcquire();
    };

    tryAcquire();
    const heartbeatId = window.setInterval(maintainLock, SINGLE_TAB_HEARTBEAT_MS);

    const onStorage = (event: StorageEvent) => {
      if (event.key === SINGLE_TAB_LOCK_KEY) {
        maintainLock();
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        maintainLock();
      }
    };
    const release = () => {
      if (ownsLockRef.current) {
        clearSingleTabLockIfOwned(tabId);
      }
    };

    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("beforeunload", release);
    window.addEventListener("pagehide", release);

    return () => {
      window.clearInterval(heartbeatId);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("beforeunload", release);
      window.removeEventListener("pagehide", release);
      release();
    };
  }, []);

  if (isSecondaryTab) {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          background:
            "radial-gradient(120% 120% at 20% 0%, rgba(80,120,255,0.18) 0%, rgba(7,10,18,0.98) 52%)",
          color: "rgba(236,244,255,0.95)",
          fontFamily: "'Exo 2', system-ui, sans-serif",
        }}
      >
        <section
          style={{
            width: "min(560px, 96vw)",
            borderRadius: 18,
            border: "1px solid rgba(130,180,255,0.22)",
            background: "linear-gradient(180deg, rgba(14,20,36,0.96), rgba(10,16,28,0.92))",
            boxShadow: "0 26px 70px rgba(0,0,0,0.55)",
            padding: "24px 22px",
            textAlign: "center",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1.35rem", fontWeight: 900 }}>Detected Another Open Tab</h2>
          <p style={{ margin: "12px 0 0", opacity: 0.84, lineHeight: 1.5 }}>
            This app allows only one active tab. Keep the original tab open and close this one.
          </p>
          <p style={{ margin: "14px 0 0", opacity: 0.62, fontSize: "0.88rem" }}>
            Temporary block screen. You can redesign it later.
          </p>
        </section>
      </main>
    );
  }

  return (
    <div className={`app-layout${isWhichCountryRoute ? " is-which-country-route" : ""}`}>
      {showEntryIntro && (
        <div className={`site-entry-intro${entryIntroLift ? " is-lift" : ""}`} aria-hidden="true">
          <div className="site-entry-intro__veil" />
          <img src={SITE_LOGO_SRC} alt="" className="site-entry-intro__logo" />
          <div className="site-entry-intro__wordmark">
            {SITE_ENTRY_WORDMARK_GLYPHS.map((item, index) => {
              const glyph = SITE_ENTRY_GLYPH_RECTS[item.char];
              const style = {
                "--char-delay": `${item.delayMs}ms`,
                "--char-offset": `${item.offsetUnits}`,
                "--glyph-w": `${glyph.w}px`,
                "--glyph-h": `${glyph.h}px`,
                "--glyph-x": `${-glyph.x}px`,
                "--glyph-y": `${-glyph.y}px`,
              } as CSSProperties & Record<string, string>;

              return (
                <span
                  key={`${item.char}-${index}`}
                  className="site-entry-intro__char"
                  style={style}
                  aria-label={item.char}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* ✅ אין Header בעמוד הסודי וגם ב-NotFound */}
      {!isSecret && !isNotFound && <Header />}
      <div className="app-body">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          <Route path="/game/connect-four" element={<Game />} />
          <Route path="/game/checkers" element={<CheckersGame />} />
          <Route path="/game/slither" element={<SlitherGame />} />
          <Route path="/game/block-blast" element={<BlockBlastGame />} />
          <Route path="/game/blob-blast" element={<BlobBlastGame />} />
          <Route path="/game/tic-tac-toe" element={<TicTacToeGame />} />
          <Route path="/game/word-guess" element={<WordGuessGame />} />
          <Route path="/game/expo-crossy-road" element={<ExpoCrossyRoadEmbed />} />
          <Route path="/game/which-country" element={<WhichCountryGame />} />
          <Route path="/game/backgammon" element={<BackgammonGame />} />
          <Route path="/game/coyote-flapy" element={<CoyoteFlapyGame />} />
          <Route path="/game/systris" element={<SysTrisGame />} />
          <Route path="/game/6767" element={<Game6767 />} />
          <Route path="/game/dont-touch-the-spikes" element={<DontTouchTheSpikesGame />} />
          <Route path="/game/bits-sniper" element={<BitsSniperGame />} />
          <Route path="/game/raid-hero" element={<RaidHeroGame />} />
          <Route
            path="/game/sound-shooter"
            element={(
              <Suspense
                fallback={(
                  <main className="game-page">
                    <p>Loading Sound Shooter...</p>
                  </main>
                )}
              >
                <SoundShooterGame />
              </Suspense>
            )}
          />

          <Route path="/profile/:uid" element={<Profile />} />

          <Route path="/secret" element={<Secret />} />

          {/* ✅ תמיד בסוף */}
          <Route path="*" element={<NotFound />} />
        </Routes>

        {/* ✅ Footer יופיע בכל מקום חוץ מעמוד סודי וגם ב-NotFound (אם בא לך גם להסתיר שם) */}
        {!isSecret && !isNotFound && !isWhichCountryRoute && <Footer />}
      </div>

      <HourlyMagicPrompt />
    </div>
  );
}


