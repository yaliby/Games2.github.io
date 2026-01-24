import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

type Phase = "boot" | "riddle" | "success" | "locked";

const DURATION_SECONDS = 10;
const BLACKOUT_ID = "__FORCE_BLACKOUT__";

function norm(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, "");
}

/** 💀 FORCE: inject a true fullscreen blackout into <body> (not inside React tree) */
function forceBlackoutNow() {
  try {
    let el = document.getElementById(BLACKOUT_ID) as HTMLDivElement | null;

    if (!el) {
      el = document.createElement("div");
      el.id = BLACKOUT_ID;
      el.setAttribute("aria-hidden", "true");

      // absolute force styles
      el.style.position = "fixed";
      el.style.top = "0";
      el.style.left = "0";
      el.style.right = "0";
      el.style.bottom = "0";
      el.style.width = "100vw";
      el.style.height = "100vh";
      el.style.background = "#000";
      el.style.opacity = "1";
      el.style.zIndex = "2147483647";
      el.style.pointerEvents = "all";
      el.style.display = "block";
      el.style.visibility = "visible";
      el.style.transform = "none";
      el.style.filter = "none";
      el.style.mixBlendMode = "normal";

      document.body.appendChild(el);
    } else {
      // re-force if something messed with it
      el.style.opacity = "1";
      el.style.display = "block";
      el.style.visibility = "visible";
      el.style.background = "#000";
      el.style.zIndex = "2147483647";
      el.style.pointerEvents = "all";
    }

    document.documentElement.style.background = "#000";
    document.body.style.background = "#000";
    document.body.style.overflow = "hidden";

    // push it to the end again, just to be evil-proof
    document.body.appendChild(el);
  } catch {
    // no-op
  }
}

export default function Secret() {
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>("boot");
  const [secondsLeft, setSecondsLeft] = useState(DURATION_SECONDS);

  const [answer, setAnswer] = useState("");
  const [wrong, setWrong] = useState(false);

  const tickRef = useRef<number | null>(null);

  // cinematic
  const [flicker, setFlicker] = useState(false);
  const [shakeLevel, setShakeLevel] = useState(0); // 0..1
  // 0 none, 1 glitch burst, 2 sustained decay, 3 full black
  const [doomStage, setDoomStage] = useState<0 | 1 | 2 | 3>(0);

  const bootTimeoutRef = useRef<number | null>(null);
  const doomT1Ref = useRef<number | null>(null);
  const doomT2Ref = useRef<number | null>(null);
  const doomTriggeredRef = useRef(false);

  // ✅ HARD LOCK: no scroll, no refresh keys, no back/forward
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    const prevOverscroll = (document.body.style as any).overscrollBehavior;
    const prevTouchAction = (document.body.style as any).touchAction;

    document.body.style.overflow = "hidden";
    (document.body.style as any).overscrollBehavior = "none";
    (document.body.style as any).touchAction = "manipulation";

    window.history.pushState(null, "", window.location.href);
    const onPopState = () => window.history.pushState(null, "", window.location.href);

    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();

      if (e.altKey && (key === "arrowleft" || key === "arrowright")) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (key === "f5" || ((e.ctrlKey || e.metaKey) && key === "r")) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === "r") {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (key === "backspace") {
        const el = e.target as HTMLElement | null;
        const tag = el?.tagName?.toLowerCase();
        const isTyping =
          tag === "input" || tag === "textarea" || (el as any)?.isContentEditable;

        if (!isTyping) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };

    const onWheel = (e: WheelEvent) => e.preventDefault();
    const onTouchMove = (e: TouchEvent) => e.preventDefault();

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
      return "";
    };

    window.addEventListener("popstate", onPopState);
    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      document.body.style.overflow = prevOverflow;
      (document.body.style as any).overscrollBehavior = prevOverscroll;
      (document.body.style as any).touchAction = prevTouchAction;

      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("keydown", onKeyDown, { capture: true } as any);
      window.removeEventListener("wheel", onWheel as any);
      window.removeEventListener("touchmove", onTouchMove as any);
      window.removeEventListener("beforeunload", onBeforeUnload);

      if (bootTimeoutRef.current) window.clearTimeout(bootTimeoutRef.current);
      if (tickRef.current) window.clearInterval(tickRef.current);
      if (doomT1Ref.current) window.clearTimeout(doomT1Ref.current);
      if (doomT2Ref.current) window.clearTimeout(doomT2Ref.current);

      bootTimeoutRef.current = null;
      tickRef.current = null;
      doomT1Ref.current = null;
      doomT2Ref.current = null;
    };
  }, []);

  // 🎬 Boot קצר ואז חידה
  useEffect(() => {
    if (phase !== "boot") return;

    setSecondsLeft(DURATION_SECONDS);
    setWrong(false);
    setAnswer("");
    setDoomStage(0);
    doomTriggeredRef.current = false;

    bootTimeoutRef.current = window.setTimeout(() => setPhase("riddle"), 650);
    return () => {
      if (bootTimeoutRef.current) window.clearTimeout(bootTimeoutRef.current);
      bootTimeoutRef.current = null;
    };
  }, [phase]);

  // ⏱️ Timer
  useEffect(() => {
    if (phase !== "riddle") return;

    tickRef.current = window.setInterval(() => {
      setSecondsLeft((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);

    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [phase]);

  // 🎞️ Flicker
  useEffect(() => {
    if (phase !== "riddle") return;

    let alive = true;
    const loop = () => {
      if (!alive) return;
      const r = Math.random();
      if (r > 0.972) setFlicker(true);
      if (r < 0.11) setFlicker(false);
      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
    return () => {
      alive = false;
    };
  }, [phase]);

  // 🔥 Shake ramps up in the last ~6 seconds
  useEffect(() => {
    if (phase !== "riddle") {
      setShakeLevel(0);
      return;
    }
    if (secondsLeft > 6) {
      setShakeLevel(0);
      return;
    }
    const t = Math.max(0, Math.min(1, (6 - secondsLeft) / 6));
    setShakeLevel(t);
  }, [secondsLeft, phase]);

  // ⛔ TIMEOUT trigger (once)
  useEffect(() => {
    if (phase !== "riddle") return;
    if (secondsLeft > 0) return;
    if (doomTriggeredRef.current) return;

    doomTriggeredRef.current = true;

    if (tickRef.current) window.clearInterval(tickRef.current);
    tickRef.current = null;

    setPhase("locked");
    setDoomStage(1);

    // 💀 GUARANTEED CHAIN (no React-cleanup trap)
    // glitch burst -> decay -> blackout
    doomT1Ref.current = window.setTimeout(() => {
      setDoomStage(2);

      doomT2Ref.current = window.setTimeout(() => {
        setDoomStage(3);
        forceBlackoutNow();
      }, 950);
    }, 520);
  }, [secondsLeft, phase]);

  // Extra: if doomStage is set to 3 by any path, enforce blackout immediately
  useEffect(() => {
    if (doomStage === 3) {
      forceBlackoutNow();
    }
  }, [doomStage]);

  const danger = useMemo(() => {
    if (phase !== "riddle") return 0;
    const p = 1 - secondsLeft / DURATION_SECONDS;
    return Math.min(1, Math.max(0, p));
  }, [phase, secondsLeft]);

  const timerText = useMemo(() => {
    const ss = String(secondsLeft).padStart(2, "0");
    return `00:${ss}`;
  }, [secondsLeft]);

  function submit() {
    if (phase !== "riddle") return;

    const ok = norm(answer) === "sysops";
    if (ok) {
      if (tickRef.current) window.clearInterval(tickRef.current);
      tickRef.current = null;
      setWrong(false);
      setPhase("success");
      return;
    }

    // ❌ Wrong: mark red but DO NOT lock attempts
    setWrong(true);
  }

  const rootClasses = [
    "root",
    flicker ? "flicker" : "",
    phase === "riddle" && shakeLevel > 0 ? "shakeActive" : "",
    doomStage >= 2 ? "filterDecay" : "",
    doomStage >= 1 ? "signalDistort" : "",
  ].join(" ");

  return (
    <div
      className={rootClasses}
      style={
        {
          ["--shake" as any]: shakeLevel.toFixed(3),
          ["--danger" as any]: danger.toFixed(3),
        } as any
      }
    >
      <style>{`
        .root, body, html { scrollbar-width: none; }
        .root::-webkit-scrollbar { width: 0; height: 0; }

        .root{
          min-height:100vh;
          position:relative;
          overflow:hidden;
          color:#eef3ff;
          display:grid;
          place-items:center;
          padding:22px;
          transform: translateZ(0);

          background:
            radial-gradient(1700px 1100px at 50% 16%, rgba(120,150,255,0.18), transparent 62%),
            radial-gradient(1200px 760px at 8% 92%, rgba(255, 60, 120, 0.15), transparent 64%),
            radial-gradient(980px 700px at 92% 88%, rgba(70, 255, 210, 0.085), transparent 62%),
            linear-gradient(180deg, #040510 0%, #070812 35%, #03030a 100%);

          animation: cinemaPush 10.5s ease-in-out infinite alternate;
        }
        @keyframes cinemaPush{
          from{ transform: translateZ(0) scale(1); }
          to{ transform: translateZ(0) scale(1.015); }
        }

        .barTop,.barBottom{
          position:absolute; left:0; right:0;
          height: 9vh;
          background: rgba(0,0,0,0.86);
          z-index: 90;
          pointer-events:none;
          box-shadow: 0 0 90px rgba(0,0,0,0.7);
        }
        .barTop{ top:0; }
        .barBottom{ bottom:0; }

        .drift{
          position:absolute; inset:-45%;
          background:
            radial-gradient(circle at 30% 30%, rgba(120,150,255,0.16), transparent 55%),
            radial-gradient(circle at 60% 40%, rgba(255,60,120,0.10), transparent 58%),
            radial-gradient(circle at 62% 72%, rgba(70,255,210,0.08), transparent 58%);
          filter: blur(28px);
          opacity: 0.95;
          animation: drift 7.5s ease-in-out infinite alternate;
          z-index: 1;
          pointer-events:none;
        }
        @keyframes drift{
          from{ transform: translate3d(-2.4%, -1.6%, 0) scale(1); }
          to{ transform: translate3d(2.3%, 1.6%, 0) scale(1.06); }
        }

        .grain{
          position:absolute; inset:-60px;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='260' height='260'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='260' height='260' filter='url(%23n)' opacity='.18'/%3E%3C/svg%3E");
          opacity:.32;
          mix-blend-mode: overlay;
          animation: grainMove 1.5s steps(2) infinite;
          z-index: 2;
          pointer-events:none;
        }
        @keyframes grainMove{
          0%{ transform: translate3d(0,0,0); }
          50%{ transform: translate3d(-18px, 12px, 0); }
          100%{ transform: translate3d(0,0,0); }
        }

        .scanlines{
          position:absolute; inset:0;
          background: repeating-linear-gradient(
            to bottom,
            rgba(255,255,255,.042),
            rgba(255,255,255,.042) 1px,
            transparent 1px,
            transparent 6px
          );
          opacity:.18;
          pointer-events:none;
          mix-blend-mode: overlay;
          z-index: 3;
        }
        .vignette{
          position:absolute; inset:0;
          background: radial-gradient(circle at 50% 45%, transparent 48%, rgba(0,0,0,.88) 100%);
          z-index: 4;
          pointer-events:none;
        }
        .cameraFx{
          position:absolute; inset:0;
          z-index: 6;
          pointer-events:none;
          background:
            radial-gradient(980px 440px at 70% 20%, rgba(255,255,255,0.085), transparent 60%),
            radial-gradient(1200px 800px at 20% 70%, rgba(120,150,255,0.05), transparent 65%);
          mix-blend-mode: screen;
          opacity: .9;
        }

        .flicker{ animation: flicker .10s linear both; }
        @keyframes flicker{
          0%{ filter: brightness(1) contrast(1); }
          50%{ filter: brightness(0.90) contrast(1.10) saturate(1.08); }
          100%{ filter: brightness(1) contrast(1); }
        }

        .shakeActive{ animation: rampShake 0.09s linear infinite; }
        @keyframes rampShake{
          0%{ transform: translate(calc(var(--shake) * -10px), calc(var(--shake) * 8px)) rotate(calc(var(--shake) * -0.22deg)); }
          25%{ transform: translate(calc(var(--shake) * 9px), calc(var(--shake) * -9px)) rotate(calc(var(--shake) * 0.18deg)); }
          50%{ transform: translate(calc(var(--shake) * -9px), calc(var(--shake) * 7px)) rotate(calc(var(--shake) * -0.16deg)); }
          75%{ transform: translate(calc(var(--shake) * 11px), calc(var(--shake) * 3px)) rotate(calc(var(--shake) * 0.22deg)); }
          100%{ transform: translate(calc(var(--shake) * -6px), calc(var(--shake) * -4px)) rotate(calc(var(--shake) * -0.10deg)); }
        }

        .filterDecay{
          filter: grayscale(1) contrast(1.18) blur(2.35px) brightness(0.92) saturate(0.9);
          transition: filter .18s ease;
        }

        .signalDistort{ animation: signalDistort 0.22s steps(2) infinite; }
        @keyframes signalDistort{
          0%{ filter: none; }
          50%{ filter: hue-rotate(6deg) contrast(1.05); }
          100%{ filter: none; }
        }

        .stage{ width:min(1120px, 96vw); z-index: 10; padding-top: 9vh; padding-bottom: 9vh; }

        .panel{
          border-radius: 34px;
          padding: 26px;
          background: rgba(10, 12, 24, 0.76);
          border: 1px solid rgba(255,255,255,0.09);
          box-shadow: 0 36px 96px rgba(0,0,0,.65), 0 1px 0 rgba(255,255,255,.06) inset;
          backdrop-filter: blur(14px);
          position: relative;
          animation: panelIn .72s cubic-bezier(.18,.78,.14,1) both;
        }
        @keyframes panelIn{
          from{ opacity: 0; transform: translate3d(0,14px,0) scale(.985); }
          to{ opacity: 1; transform: translate3d(0,0,0) scale(1); }
        }

        .title{ margin:0 0 12px 0; font-size: clamp(22px, 3.6vw, 44px); letter-spacing: -0.9px; line-height: 1.05; }

        .glitch{
          text-shadow: 1px 0 rgba(255,0,80,.82), -1px 0 rgba(80,200,255,.58);
          animation: titleGlitch 1.15s infinite;
        }
        @keyframes titleGlitch{
          0%{ transform: translate(0,0); opacity:1; }
          14%{ transform: translate(0.7px,-0.4px); opacity:.98; }
          28%{ transform: translate(-0.8px,0.8px); opacity:1; }
          42%{ transform: translate(0.4px,1px); opacity:.97; }
          56%{ transform: translate(-0.6px,-0.2px); opacity:1; }
          70%{ transform: translate(1px,0.1px); opacity:.96; }
          84%{ transform: translate(-0.7px,1px); opacity:1; }
          100%{ transform: translate(0,0); opacity:1; }
        }

        .story{
          margin: 0 0 14px 0;
          font-size: clamp(14px, 1.65vw, 16px);
          line-height: 1.75;
          opacity: .93;
          animation: breathe 3.8s ease-in-out infinite;
        }
        @keyframes breathe{
          0%,100%{ opacity: .90; }
          50%{ opacity: .98; }
        }

        .warning{
          margin: 12px 0 18px 0;
          padding: 12px 14px;
          border-radius: 18px;
          background: rgba(255, 210, 60, 0.10);
          border: 1px solid rgba(255,210,60,0.22);
          color: rgba(255, 235, 170, 0.95);
          font-weight: 1100;
          letter-spacing: .2px;
        }

        .questionBox{
          padding: 18px;
          border-radius: 22px;
          background: rgba(18, 22, 45, 0.62);
          border: 1px solid rgba(255,255,255,0.09);
          box-shadow: 0 12px 54px rgba(0,0,0,.32);
        }

        .question{ margin: 0 0 12px 0; font-weight: 1100; font-size: clamp(16px, 2.2vw, 18px); }

        .inputRow{ display:flex; gap: 10px; flex-wrap:wrap; align-items:stretch; }

        .input{
          flex:1;
          min-width: 240px;
          padding: 12px 14px;
          border-radius: 16px;
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(5, 7, 16, 0.68);
          color:#eef3ff;
          outline:none;
          font-size: 15px;
          transition: border-color .14s ease, box-shadow .14s ease;
        }

        .btn{
          padding: 12px 16px;
          border-radius: 16px;
          border: 1px solid rgba(255,255,255,0.14);
          background: linear-gradient(180deg, rgba(120,150,255,0.26), rgba(120,150,255,0.10));
          color:#eef3ff;
          font-weight: 1100;
          cursor:pointer;
          transition: transform .12s ease, filter .12s ease, border-color .14s ease, box-shadow .14s ease;
        }
        .btn:hover{ transform: translateY(-1px); filter: brightness(1.05); }
        .btn:active{ transform: translateY(0px) scale(.995); }
        .btn:disabled{ opacity:.55; cursor:not-allowed; transform:none; }

        /* Wrong styling */
        .wrong .input{
          border-color: rgba(255, 64, 64, 0.95);
          box-shadow: 0 0 0 2px rgba(255, 64, 64, 0.18), 0 0 28px rgba(255, 64, 64, 0.14);
        }
        .wrong .btn{
          border-color: rgba(255, 64, 64, 0.65);
          box-shadow: 0 0 0 2px rgba(255, 64, 64, 0.12);
        }
        .wrongText{
          margin-top: 10px;
          color: rgba(255, 120, 120, 0.95);
          font-weight: 1000;
          letter-spacing: .2px;
        }

        .progressWrap{
          margin-top: 14px;
          height: 12px;
          border-radius: 999px;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.08);
          overflow:hidden;
        }
        .progress{
          height: 100%;
          width: ${Math.max(0, (secondsLeft / DURATION_SECONDS) * 100)}%;
          background: linear-gradient(90deg, rgba(80,200,255,0.80), rgba(255, 60, 120, 0.92));
          transition: width .35s ease;
          box-shadow: 0 0 calc(12px + var(--danger) * 26px) rgba(255,60,120, calc(.22 + var(--danger) * .35));
        }

        .sideTimer{
          position: fixed;
          right: 22px;
          top: 50%;
          transform: translateY(-50%);
          z-index: 70;
          padding: 18px 18px 16px 18px;
          border-radius: 28px;
          background: rgba(6, 7, 14, 0.64);
          border: 1px solid rgba(255,255,255,0.10);
          backdrop-filter: blur(14px);
          box-shadow:
            0 26px 90px rgba(0,0,0,.62),
            0 0 calc(18px + var(--danger) * 70px) rgba(255, 60, 120, calc(0.10 + var(--danger) * 0.36));
          animation: timerPulse .9s ease-in-out infinite;
        }
        @keyframes timerPulse{
          0%,100%{ transform: translateY(-50%) scale(1); }
          50%{ transform: translateY(-50%) scale(calc(1 + var(--danger) * 0.035)); }
        }

        .sideTimerDigits{
          font-variant-numeric: tabular-nums;
          font-weight: 1200;
          letter-spacing: 2px;
          font-size: clamp(52px, 6.4vw, 102px);
          line-height: 1;
          text-shadow:
            0 0 28px rgba(120,150,255,0.18),
            0 0 calc(12px + var(--danger) * 44px) rgba(255, 60, 120, calc(0.22 + var(--danger) * 0.46));
        }

        .overlay{ position: fixed; inset: 0; pointer-events:none; }

        .glitchBurst{
          z-index: 200;
          opacity: 0;
          background:
            linear-gradient(90deg, rgba(255,60,120,0.32), transparent 30%, rgba(80,200,255,0.22)),
            repeating-linear-gradient(
              to bottom,
              rgba(255,255,255,0.12),
              rgba(255,255,255,0.12) 2px,
              transparent 2px,
              transparent 10px
            );
          mix-blend-mode: screen;
          filter: contrast(1.55) saturate(1.35);
          animation: burstIn .48s ease both;
        }
        @keyframes burstIn{
          0%   { opacity: 0; transform: translate3d(0,0,0) skewX(0deg); }
          25%  { opacity: 1; transform: translate3d(-14px, 5px, 0) skewX(10deg); }
          60%  { opacity: .95; transform: translate3d(16px, -7px, 0) skewX(-12deg); }
          100% { opacity: 0; transform: translate3d(0,0,0) skewX(0deg); }
        }

        .glitchRGB{
          z-index: 199;
          opacity: 0;
          background:
            radial-gradient(900px 520px at 50% 50%, rgba(255,255,255,0.10), transparent 60%),
            linear-gradient(180deg, rgba(0,0,0,0.0), rgba(0,0,0,0.42));
          animation: rgbFlash .48s ease both;
        }
        @keyframes rgbFlash{
          0% { opacity: 0; }
          35%{ opacity: .9; }
          100%{ opacity: 0; }
        }

        .decayOverlay{
          z-index: 210;
          opacity: .88;
          background:
            radial-gradient(circle at 50% 50%, rgba(255,255,255,0.055), rgba(0,0,0,0.36)),
            repeating-linear-gradient(
              to bottom,
              rgba(255,255,255,0.038),
              rgba(255,255,255,0.038) 1px,
              transparent 1px,
              transparent 8px
            );
          mix-blend-mode: overlay;
          animation: decayWobble .18s steps(2) infinite;
        }
        @keyframes decayWobble{
          0%{ transform: translate3d(0,0,0); opacity:.85; }
          50%{ transform: translate3d(-2px,1px,0); opacity:.92; }
          100%{ transform: translate3d(1px,-2px,0); opacity:.86; }
        }
      `}</style>

      <div className="drift" />
      <div className="grain" />
      <div className="scanlines" />
      <div className="vignette" />
      <div className="cameraFx" />

      <div className="barTop" />
      <div className="barBottom" />

      {phase === "riddle" && (
        <div className="sideTimer">
          <div className="sideTimerDigits">{timerText}</div>
        </div>
      )}

      <div className="stage">
        <div className="panel">
          <h1 className="title glitch" style={{ direction: "rtl", textAlign: "right" }}>
            אוי ואבוי נראה שגל שפירו התקין נוזקה קטלנית על האתר! יש לך {DURATION_SECONDS} שניות לענות על החידה שלו אחרת הוא יקבל שליטה מלאה על האתר
          </h1>

          <p className="story" style={{ direction: "rtl", textAlign: "right" }}>
            המערכת מזהה תהליך עוין שמשכתב הרשאות בזמן אמת.
            <br />
            אם תיכשל — השליטה תילקח ממך, והאתר “יכבה” מול העיניים שלך.
          </p>

          <div className="warning" style={{ direction: "rtl", textAlign: "right" }}>
            ⚠️ תענה מהר… כל ניסיון אפשרי עד שנגמר הזמן.
          </div>

          <div className={`questionBox ${wrong ? "wrong" : ""}`}>
            <p className="question" style={{ direction: "rtl", textAlign: "right" }}>
              🧩 החידה: מה זה דבאופס IT?
            </p>

            <div className="inputRow" style={{ direction: "rtl" }}>
              <input
                className="input"
                value={answer}
                onChange={(e) => {
                  setAnswer(e.target.value);
                  if (wrong) setWrong(false); // ✅ remove red as soon as user tries again
                }}
                placeholder="כתוב כאן תשובה…"
                disabled={phase !== "riddle"}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                autoFocus
              />

              <button className="btn" onClick={submit} disabled={phase !== "riddle"}>
                ענה
              </button>
            </div>

            {wrong && (
              <div className="wrongText" style={{ direction: "rtl", textAlign: "right" }}>
                ❌ תשובה שגויה. נסה שוב מהר.
              </div>
            )}

            <div className="progressWrap">
              <div className="progress" />
            </div>

            {phase === "success" && (
              <div style={{ marginTop: 16 }}>
                <h2 className="title" style={{ fontSize: "clamp(18px,2.3vw,26px)", margin: 0 }}>
                  ✅ ניצלת.
                </h2>
                <p className="story" style={{ opacity: 0.86, marginTop: 8 }}>
                  אימות הצליח. השליטה נשמרה.
                </p>
                <button className="btn" onClick={() => navigate("/", { replace: true })}>
                  חזרה
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ✅ סוף זמן: גליטץ' ואז דעיכה; השחור מוזרק בכוח ל-body */}
      {doomStage === 1 && (
        <>
          <div className="overlay glitchRGB" />
          <div className="overlay glitchBurst" />
        </>
      )}

      {doomStage === 2 && <div className="overlay decayOverlay" />}
    </div>
  );
}
