import { Suspense, lazy, useEffect, useMemo } from "react";
import { Routes, Route, useNavigate, useLocation } from "react-router-dom";

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
import TicTacToeGame from "../components/tic-tac-toe/TicTacToeGame";
import WordGuessGame from "../components/word-guess/WordGuessGame";
import ExpoCrossyRoadEmbed from "../components/ExpoCrossyRoadEmbed";
import WhichCountryGame from "../components/Which contry/WhichCountryGame";
import HourlyMagicPrompt, { HOURLY_MAGIC_OPEN_EVENT } from "../components/HourlyMagicPrompt";

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
import { getAdminDebugInfo, isAdminUid } from "../services/admin";

const SoundShooterGame = lazy(() => import("../components/sound-shooter/SoundShooter"));

function isTypingTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName.toLowerCase();
  if (["input", "textarea", "select"].includes(tag)) return true;
  return el.isContentEditable;
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();

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
      "/game/tic-tac-toe",
      "/game/word-guess",
      "/game/expo-crossy-road",
      "/game/which-country",
      "/game/sound-shooter",
    ]),
    []
  );

  const isProfileRoute = location.pathname.startsWith("/profile/");
  const isNotFound = !knownRoutes.has(location.pathname) && !isProfileRoute;

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      void (async () => {
        try {
          console.info("[AdminDebug] Auth state changed:", getAdminDebugInfo(user?.uid));
          await checkWeeklyReset();
          if (!user) return;

          const seasonId = await getCurrentSeasonId();
          if (isAdminUid(user.uid)) {
            console.log("[Auth] Admin connected:", user.uid);
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
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      const isStarKey = e.key === "*" || e.code === "NumpadMultiply";

      if (isStarKey) {
        e.preventDefault();
        window.dispatchEvent(new Event(HOURLY_MAGIC_OPEN_EVENT));
        return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        // ✅ replace כדי שלא יהיה "עמוד קודם" לחזור אליו
        navigate("/secret", { replace: true });
      }
    };

    window.addEventListener("keydown", onKeyDown, { passive: false });
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

  return (
    <div className={`app-layout${isWhichCountryRoute ? " is-which-country-route" : ""}`}>
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
          <Route path="/game/tic-tac-toe" element={<TicTacToeGame />} />
          <Route path="/game/word-guess" element={<WordGuessGame />} />
          <Route path="/game/expo-crossy-road" element={<ExpoCrossyRoadEmbed />} />
          <Route path="/game/which-country" element={<WhichCountryGame />} />
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


