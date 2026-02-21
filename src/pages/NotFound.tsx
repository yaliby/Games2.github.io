import { useEffect, useMemo, useState } from "react";

export default function NotFound404() {
  const [impact, setImpact] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 80);
    const fx = setInterval(() => {
      setImpact(true);
      setTimeout(() => setImpact(false), 160);
    }, 1650);
    return () => {
      clearInterval(t);
      clearInterval(fx);
    };
  }, []);

  const phrases = useMemo(
    () => ["PING!", "SUDO!", "BSOD!", "KERNEL!", "PATCH!", "REBOOT!", "FIREWALL!", "NICE!"],
    []
  );

  const phrase = phrases[Math.floor((tick / 8) % phrases.length)];
  const caretOn = tick % 10 < 6;

  const goHome = () => (window.location.href = "/");
  const reload = () => window.location.reload();

  return (
    <div className={`arena404 ${impact ? "impact" : ""}`}>
      <style>{`
        :root{
          --bg0:#05070e;
          --bg1:#070b16;
          --ink:#eaf2ff;
          --muted:rgba(234,242,255,.72);

          --glass:rgba(255,255,255,.06);
          --stroke:rgba(255,255,255,.10);

          --tux:#59F8D0;     /* tux neon */
          --win:#7C5CFF;     /* windows neon */
          --hot:#FF4FD8;     /* pink */
          --warn:#FFB547;    /* amber */
          --bad:#ff4f6d;
          --ok:#38f28a;

          --r:22px;
          --shadow: 0 26px 100px rgba(0,0,0,.68);
          --shadow2: 0 18px 70px rgba(0,0,0,.58);
        }

        *{ box-sizing:border-box; }
        .arena404{
          min-height:100vh;
          position:relative;
          overflow:hidden;
          display:grid;
          place-items:center;
          padding: 18px;
          color: var(--ink);
          background:
            radial-gradient(1200px 700px at 18% 18%, rgba(124,92,255,.25), transparent 62%),
            radial-gradient(900px 700px at 80% 22%, rgba(89,248,208,.18), transparent 62%),
            radial-gradient(900px 700px at 50% 92%, rgba(255,79,216,.14), transparent 62%),
            linear-gradient(180deg, var(--bg0), var(--bg1));
        }

        /* subtle grid */
        .grid{
          position:absolute;
          inset:-35%;
          pointer-events:none;
          opacity:.22;
          transform: rotate(12deg);
          background-image:
            linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px);
          background-size: 64px 64px;
          animation: gridMove 18s ease-in-out infinite alternate;
        }
        @keyframes gridMove{
          from{ transform: rotate(12deg) translate3d(-1.2%,-1.0%,0) scale(1.06); opacity:.18; }
          to  { transform: rotate(12deg) translate3d( 1.2%, 1.0%,0) scale(1.08); opacity:.26; }
        }

        /* scanline */
        .scanline{
          position:absolute;
          inset:-25% 0 auto 0;
          height: 240px;
          pointer-events:none;
          opacity:.50;
          background: linear-gradient(180deg,
            rgba(89,248,208,.0),
            rgba(89,248,208,.07),
            rgba(124,92,255,.06),
            rgba(255,79,216,.05),
            rgba(89,248,208,.0)
          );
          animation: scan 4.6s linear infinite;
        }
        @keyframes scan{
          from{ transform: translate3d(0,-140px,0); }
          to  { transform: translate3d(0,120vh,0); }
        }

        /* main fight platform */
        .fightCard{
          width:min(1200px, 100%);
          border-radius: var(--r);
          border: 1px solid var(--stroke);
          background: linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.05));
          box-shadow: var(--shadow);
          position:relative;
          overflow:hidden;
          padding: 16px;
        }

        .fightCard::before{
          content:"";
          position:absolute;
          inset:-2px;
          background:
            radial-gradient(1200px 420px at 16% 0%, rgba(89,248,208,.28), transparent 60%),
            radial-gradient(950px 420px at 82% 0%, rgba(124,92,255,.26), transparent 60%),
            radial-gradient(950px 420px at 55% 115%, rgba(255,79,216,.18), transparent 60%);
          filter: blur(14px);
          opacity:.9;
          pointer-events:none;
        }

        .content{
          position:relative;
          z-index:2;
          display:grid;
          gap: 12px;
        }

        /* top tiny meta (404 info) */
        .metaBar{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:12px;
          padding: 12px 14px;
          border-radius: 18px;
          background: rgba(0,0,0,.28);
          border: 1px solid rgba(255,255,255,.08);
          box-shadow: var(--shadow2);
        }

        .metaLeft{
          display:flex; align-items:center; gap:10px;
        }

        .mini404{
          display:flex;
          flex-direction:column;
          line-height:1.05;
        }
        .mini404 b{
          letter-spacing:.16em;
          text-transform:uppercase;
          font-size: 12px;
          opacity:.96;
        }
        .mini404 span{
          color: var(--muted);
          font-size: 12px;
        }

        .chips{
          display:flex; gap:8px; flex-wrap:wrap;
          justify-content:flex-end;
        }
        .chip{
          display:flex; align-items:center; gap:8px;
          padding: 7px 10px;
          border-radius:999px;
          background: rgba(255,255,255,.06);
          border: 1px solid rgba(255,255,255,.10);
          color: rgba(234,242,255,.78);
          font-size: 12px;
          white-space:nowrap;
        }
        .dot{
          width:8px;height:8px;border-radius:99px;
          background: var(--bad);
          box-shadow: 0 0 14px rgba(255,79,109,.36);
        }

        /* BIG CENTER ARENA */
        .stage{
          position:relative;
          border-radius: 22px;
          background: rgba(0,0,0,.30);
          border: 1px solid rgba(255,255,255,.10);
          box-shadow: var(--shadow2);
          overflow:hidden;
          height: min(62vh, 560px);
          display:grid;
          place-items:center;
        }

        /* Server racks vibe */
        .racks{
          position:absolute;
          inset:0;
          opacity:.75;
          background:
            linear-gradient(90deg, rgba(255,255,255,.06) 1px, transparent 1px),
            radial-gradient(circle at 20% 40%, rgba(89,248,208,.10), transparent 55%),
            radial-gradient(circle at 75% 42%, rgba(124,92,255,.10), transparent 55%),
            radial-gradient(circle at 55% 86%, rgba(255,79,216,.08), transparent 55%);
          background-size: 26px 100%;
          filter: blur(.1px);
        }

        .floor{
          position:absolute;
          left:-20%;
          right:-20%;
          bottom:-38%;
          height: 76%;
          background:
            radial-gradient(55% 120% at 50% 0%, rgba(89,248,208,.10), transparent 58%),
            linear-gradient(180deg, rgba(0,0,0,.0), rgba(0,0,0,.52));
          transform: perspective(700px) rotateX(52deg);
          transform-origin: center top;
          opacity:.92;
        }

        /* VS banner */
        .vs{
          position:absolute;
          left:50%;
          top: 18%;
          transform: translateX(-50%);
          font-weight: 1000;
          letter-spacing: .18em;
          text-transform: uppercase;
          font-size: clamp(18px, 2vw, 26px);
          padding: 10px 14px;
          border-radius: 999px;
          background: rgba(255,255,255,.06);
          border: 1px solid rgba(255,255,255,.12);
          box-shadow: 0 0 0 1px rgba(89,248,208,.06), 0 20px 60px rgba(0,0,0,.45);
          backdrop-filter: blur(10px);
        }
        .vs b{
          background: linear-gradient(90deg, rgba(89,248,208,.95), rgba(124,92,255,.95), rgba(255,79,216,.85));
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }

        /* Characters */
        .fighters{
          position:relative;
          width: min(1050px, 100%);
          height: 100%;
          display:flex;
          align-items:flex-end;
          justify-content:space-between;
          padding: 0 22px 34px 22px;
          z-index:2;
        }

        .fighter{
          width: min(360px, 42vw);
          aspect-ratio: 1 / 1;
          filter: drop-shadow(0 22px 40px rgba(0,0,0,.55));
          position:relative;
          transform: translate3d(0,0,0);
        }

        .tux{
          animation: tuxMove 1.9s ease-in-out infinite;
        }
        .win{
          animation: winMove 1.9s ease-in-out infinite;
          animation-delay: .06s;
        }

        @keyframes tuxMove{
          0%{ transform: translate3d(0,0,0) rotate(-1deg); }
          40%{ transform: translate3d(14px,-6px,0) rotate(1deg); }
          70%{ transform: translate3d(-8px,2px,0) rotate(-.6deg); }
          100%{ transform: translate3d(0,0,0) rotate(-1deg); }
        }
        @keyframes winMove{
          0%{ transform: translate3d(0,0,0) rotate(1deg); }
          40%{ transform: translate3d(-14px,-6px,0) rotate(-1deg); }
          70%{ transform: translate3d(8px,2px,0) rotate(.6deg); }
          100%{ transform: translate3d(0,0,0) rotate(1deg); }
        }

        /* Attack beams */
        .beam{
          position:absolute;
          top: 52%;
          height: 10px;
          width: 42%;
          border-radius: 999px;
          opacity:.0;
          filter: blur(.2px);
          pointer-events:none;
        }

        .impact .beam{
          opacity:1;
          animation: beamPop .16s ease-out 1;
        }

        .beamTux{
          left: 20%;
          background: linear-gradient(90deg, rgba(89,248,208,0), rgba(89,248,208,.92), rgba(255,181,71,.65), rgba(255,79,216,0));
          box-shadow: 0 0 30px rgba(89,248,208,.26);
        }

        .beamWin{
          right: 20%;
          background: linear-gradient(90deg, rgba(124,92,255,0), rgba(124,92,255,.92), rgba(255,79,216,.65), rgba(89,248,208,0));
          box-shadow: 0 0 30px rgba(124,92,255,.26);
        }

        @keyframes beamPop{
          0%{ transform: translate3d(0,0,0) scaleX(.6); opacity:0; }
          50%{ transform: translate3d(0,0,0) scaleX(1.08); opacity:1; }
          100%{ transform: translate3d(0,0,0) scaleX(1.18); opacity:0; }
        }

        /* Impact FX in center */
        .impactFX{
          position:absolute;
          left:50%;
          top: 58%;
          transform: translate(-50%,-50%);
          width: 280px;
          height: 280px;
          opacity:0;
          pointer-events:none;
          z-index:3;
        }

        .impact .impactFX{
          opacity:1;
          animation: pop 0.16s ease-out 1;
        }

        @keyframes pop{
          0%{ transform: translate(-50%,-50%) scale(.86); opacity:0; }
          55%{ transform: translate(-50%,-50%) scale(1.06); opacity:1; }
          100%{ transform: translate(-50%,-50%) scale(1.14); opacity:0; }
        }

        .ring{
          position:absolute;
          left:50%; top:50%;
          width: 210px; height: 210px;
          transform: translate(-50%,-50%);
          border-radius:999px;
          border: 2px solid rgba(255,255,255,.10);
          box-shadow:
            0 0 18px rgba(255,181,71,.18),
            0 0 28px rgba(255,79,216,.18),
            0 0 34px rgba(89,248,208,.18);
        }

        .sparks{
          position:absolute;
          left:50%; top:50%;
          width: 18px; height: 18px;
          transform: translate(-50%,-50%);
          border-radius:999px;
          background: rgba(255,181,71,.95);
          box-shadow: 0 0 18px rgba(255,181,71,.45), 0 0 40px rgba(255,79,216,.25);
        }

        .sparks:nth-child(2){
          transform: translate(-50%,-50%) translate(36px,-12px);
          background: rgba(89,248,208,.95);
          box-shadow: 0 0 18px rgba(89,248,208,.45), 0 0 40px rgba(124,92,255,.22);
        }
        .sparks:nth-child(3){
          transform: translate(-50%,-50%) translate(-34px,-18px);
          background: rgba(124,92,255,.95);
          box-shadow: 0 0 18px rgba(124,92,255,.45), 0 0 40px rgba(255,79,216,.22);
        }
        .sparks:nth-child(4){
          transform: translate(-50%,-50%) translate(10px,34px);
          background: rgba(255,79,216,.92);
          box-shadow: 0 0 18px rgba(255,79,216,.45), 0 0 40px rgba(89,248,208,.18);
        }

        /* Comic text */
        .comic{
          position:absolute;
          left:50%;
          top: 28%;
          transform: translateX(-50%);
          font-size: clamp(28px, 4.4vw, 74px);
          font-weight: 1000;
          letter-spacing: .06em;
          text-transform: uppercase;
          opacity:.88;
          text-shadow:
            0 0 18px rgba(255,79,216,.20),
            0 0 24px rgba(89,248,208,.16);
          background: linear-gradient(90deg, rgba(255,181,71,.96), rgba(255,79,216,.92), rgba(89,248,208,.92));
          -webkit-background-clip:text;
          background-clip:text;
          color: transparent;
          pointer-events:none;
          filter: drop-shadow(0 18px 40px rgba(0,0,0,.45));
        }

        .comicSmall{
          position:absolute;
          left:50%;
          top: 9%;
          transform: translateX(-50%);
          font-size: 12px;
          letter-spacing: .22em;
          text-transform: uppercase;
          color: rgba(234,242,255,.62);
          pointer-events:none;
        }

        /* bottom console + actions */
        .bottomBar{
          display:flex;
          align-items:flex-start;
          justify-content:space-between;
          gap:12px;
          padding: 14px;
          border-radius: 18px;
          background: rgba(0,0,0,.28);
          border: 1px solid rgba(255,255,255,.08);
          box-shadow: var(--shadow2);
          flex-wrap:wrap;
        }

        .term{
          flex: 1;
          min-width: 260px;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
          font-size: 12.5px;
          color: rgba(234,242,255,.84);
          line-height: 1.45;
        }

        .term b{
          color: rgba(89,248,208,.92);
        }

        .caret{
          display:inline-block;
          width: 9px;
          height: 14px;
          background: rgba(89,248,208,.85);
          border-radius: 2px;
          margin-left: 6px;
          transform: translateY(2px);
          box-shadow: 0 0 18px rgba(89,248,208,.30);
        }

        .buttons{
          display:flex;
          gap:10px;
          flex-wrap:wrap;
          justify-content:flex-end;
        }

        .btn{
          border:none;
          cursor:pointer;
          user-select:none;
          display:inline-flex;
          align-items:center;
          gap:10px;
          padding: 11px 14px;
          border-radius: 14px;
          color: var(--ink);
          font-weight: 900;
          background: rgba(255,255,255,.07);
          border: 1px solid rgba(255,255,255,.12);
          box-shadow: 0 14px 30px rgba(0,0,0,.35);
          transition: transform .12s ease, background .12s ease, border-color .12s ease;
        }
        .btn:hover{
          transform: translate3d(0,-1px,0);
          background: rgba(255,255,255,.10);
          border-color: rgba(255,255,255,.16);
        }
        .btn:active{ transform: translate3d(0,0,0) scale(.99); }

        .primary{
          background: linear-gradient(90deg, rgba(89,248,208,.16), rgba(124,92,255,.14));
          border-color: rgba(89,248,208,.18);
        }
        .warn{
          background: linear-gradient(90deg, rgba(255,181,71,.18), rgba(255,79,216,.10));
          border-color: rgba(255,181,71,.18);
        }

        /* micro shake on impact */
        .impact .fightCard{
          animation: shake .16s linear 1;
        }
        @keyframes shake{
          0%{ transform: translate3d(0,0,0); }
          25%{ transform: translate3d(1px,-1px,0); }
          50%{ transform: translate3d(-1px,1px,0); }
          75%{ transform: translate3d(1px,0,0); }
          100%{ transform: translate3d(0,0,0); }
        }
      `}</style>

      <div className="grid" />
      <div className="scanline" />

      <div className="fightCard" role="main" aria-label="Windows vs TUX 404">
        <div className="content">
          {/* small meta header */}
          <div className="metaBar">
            <div className="metaLeft">
              <div className="mini404">
                <b style={{ fontSize: "120%" }}>404 • route missing</b>
                <span style={{ fontSize: "120%", direction: "rtl" }}>הנתיב נשבר מול הטאקס</span>
              </div>
            </div>

            <div className="chips">
              <div className="chip">
                <span className="dot" />
                <span>Incident</span>
              </div>
              <div className="chip">
                <span style={{ opacity: 0.9 }}>🛡️</span>
                <span>DevOps IT</span>
              </div>
              <div className="chip">
                <span style={{ opacity: 0.9 }}>🖧</span>
                <span>Network Ops</span>
              </div>
            </div>
          </div>

          {/* BIG center arena */}
          <div className="stage">
            <div className="racks" />
            <div className="floor" />

            <div className="comicSmall">SERVER ROOM BATTLE MODE</div>
            <div className="comic">{phrase}</div>

            <div className="vs">
              <b>WINDOWS</b> &nbsp; VS &nbsp; <b>TUX</b>
            </div>

            {/* beams */}
            <div className="beam beamTux" />
            <div className="beam beamWin" />

            {/* impact fx */}
            <div className="impactFX" aria-hidden="true">
              <div className="ring" />
              <div className="sparks" />
              <div className="sparks" />
              <div className="sparks" />
              <div className="sparks" />
            </div>

            <div className="fighters">
              <div className="fighter tux" aria-label="TUX fighter">
                <TuxBig />
              </div>
              <div className="fighter win" aria-label="Windows fighter">
                <WindowsBig />
              </div>
            </div>
          </div>

          {/* bottom bar */}
          <div className="bottomBar">
            <div className="term">
              root@server-room:~$ <b>cd /</b>
              {caretOn ? <span className="caret" /> : null}
              <div style={{ marginTop: 6, color: "rgba(234,242,255,.64)" }}>
                טיפ: ב־GitHub Pages תוודא base path נכון + יש fallback ל־Route "*" 👍
              </div>
            </div>

            <div className="buttons">
              <button className="btn primary" onClick={goHome}>
                <IconHome />
                חזור לבית
              </button>
              <button className="btn warn" onClick={reload}>
                <IconRefresh />
                נסה שוב
              </button>
              <button
                className="btn"
                onClick={() => {
                  navigator.clipboard?.writeText(window.location.href).catch(() => {});
                }}
                title="העתק קישור"
              >
                <IconCopy />
                העתק קישור
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------- ICONS ----------------- */

function IconHome() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" width="18" height="18">
      <path
        d="M4 10.5 12 4l8 6.5v8.3a1.7 1.7 0 0 1-1.7 1.7h-3.6v-6.2a1.2 1.2 0 0 0-1.2-1.2h-3a1.2 1.2 0 0 0-1.2 1.2v6.2H5.7A1.7 1.7 0 0 1 4 18.8v-8.3Z"
        stroke="rgba(234,242,255,.92)"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconRefresh() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" width="18" height="18">
      <path
        d="M20 12a8 8 0 1 1-2.3-5.6"
        stroke="rgba(234,242,255,.92)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M20 4v6h-6"
        stroke="rgba(89,248,208,.92)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconCopy() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" width="18" height="18">
      <path
        d="M9 9h9a2 2 0 0 1 2 2v9H11a2 2 0 0 1-2-2V9Z"
        stroke="rgba(234,242,255,.92)"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"
        stroke="rgba(255,79,216,.85)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ----------------- BIG CHARACTERS ----------------- */

function TuxBig() {
  return (
    <svg viewBox="0 0 220 220" fill="none">
      {/* neon aura */}
      <ellipse cx="110" cy="196" rx="86" ry="18" fill="rgba(89,248,208,.18)" />
      <ellipse cx="110" cy="196" rx="60" ry="12" fill="rgba(255,79,216,.10)" />

      {/* body */}
      <path
        d="M70 176c0-70 14-114 40-114s40 44 40 114c0 22-17 34-40 34s-40-12-40-34Z"
        fill="rgba(10,12,18,.92)"
        stroke="rgba(255,255,255,.10)"
      />

      {/* belly */}
      <path
        d="M88 176c0-50 10-82 22-82s22 32 22 82c0 14-10 22-22 22s-22-8-22-22Z"
        fill="rgba(234,242,255,.90)"
      />

      {/* head */}
      <path
        d="M76 90c0-28 16-50 34-50s34 22 34 50c0 22-16 36-34 36s-34-14-34-36Z"
        fill="rgba(10,12,18,.94)"
        stroke="rgba(255,255,255,.10)"
      />

      {/* face */}
      <path
        d="M90 108c0-10 10-18 20-18s20 8 20 18-10 18-20 18-20-8-20-18Z"
        fill="rgba(234,242,255,.90)"
      />

      {/* eyes */}
      <circle cx="104" cy="92" r="7" fill="rgba(234,242,255,.95)" />
      <circle cx="126" cy="92" r="7" fill="rgba(234,242,255,.95)" />
      <circle cx="104" cy="92" r="3" fill="rgba(89,248,208,.95)" />
      <circle cx="126" cy="92" r="3" fill="rgba(124,92,255,.95)" />

      {/* beak */}
      <path
        d="M115 112c12 0 20 5 20 11s-8 11-20 11-20-5-20-11 8-11 20-11Z"
        fill="rgba(255,181,71,.96)"
        stroke="rgba(0,0,0,.18)"
      />

      {/* "sudo hammer" */}
      <path d="M150 146l46-28" stroke="rgba(89,248,208,.85)" strokeWidth="8" strokeLinecap="round" />
      <path d="M190 118l14-8" stroke="rgba(255,79,216,.85)" strokeWidth="8" strokeLinecap="round" />
      <path d="M142 152l10-10" stroke="rgba(234,242,255,.55)" strokeWidth="8" strokeLinecap="round" />
    </svg>
  );
}

function WindowsBig() {
  return (
    <svg viewBox="0 0 220 220" fill="none">
      {/* neon aura */}
      <ellipse cx="110" cy="196" rx="86" ry="18" fill="rgba(124,92,255,.18)" />
      <ellipse cx="110" cy="196" rx="60" ry="12" fill="rgba(255,79,216,.10)" />

      {/* Windows "character body" */}
      <path
        d="M58 172c0-60 20-96 52-96s52 36 52 96c0 22-22 36-52 36s-52-14-52-36Z"
        fill="rgba(16,10,18,.92)"
        stroke="rgba(255,255,255,.10)"
      />

      {/* Windows logo shield */}
      <g transform="translate(62,58)">
        <rect x="0" y="0" width="44" height="44" rx="10" fill="rgba(124,92,255,.22)" stroke="rgba(255,255,255,.10)"/>
        <rect x="50" y="0" width="44" height="44" rx="10" fill="rgba(255,79,216,.18)" stroke="rgba(255,255,255,.10)"/>
        <rect x="0" y="50" width="44" height="44" rx="10" fill="rgba(89,248,208,.16)" stroke="rgba(255,255,255,.10)"/>
        <rect x="50" y="50" width="44" height="44" rx="10" fill="rgba(255,181,71,.16)" stroke="rgba(255,255,255,.10)"/>
      </g>

      {/* eyes */}
      <circle cx="96" cy="106" r="8" fill="rgba(234,242,255,.92)" />
      <circle cx="136" cy="106" r="8" fill="rgba(234,242,255,.92)" />
      <circle cx="96" cy="106" r="3" fill="rgba(255,79,216,.92)" />
      <circle cx="136" cy="106" r="3" fill="rgba(124,92,255,.92)" />

      {/* smile */}
      <path d="M96 130c10 9 18 9 28 0" stroke="rgba(234,242,255,.70)" strokeWidth="5" strokeLinecap="round" />

      {/* "update cannon" */}
      <path d="M70 150l-46-18" stroke="rgba(124,92,255,.85)" strokeWidth="8" strokeLinecap="round" />
      <path d="M28 132l-14-6" stroke="rgba(255,79,216,.85)" strokeWidth="8" strokeLinecap="round" />
      <path d="M78 156l-10-10" stroke="rgba(234,242,255,.55)" strokeWidth="8" strokeLinecap="round" />
    </svg>
  );
}
