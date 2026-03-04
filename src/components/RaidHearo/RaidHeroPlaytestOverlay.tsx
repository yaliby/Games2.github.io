import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
  } from "react";
  import {
    createEngineState,
    createViewState,
    stepEngineToTime,
    stepSustainToTime,
    registerLaneHitInEngine,
    type EngineState,
    type ViewState,
    type Note,
    type PlayerStats,
    type StageConfig,
    type TimingWindows,
    type Judgment,
    LANE_COUNT,
    TRACK_HEIGHT,
    HIT_LINE_Y,
    getAccuracy,
    getGrade,
    formatClock,
  } from "./BuilderEngine";
  
  type EditorNote = { id: string; lane: number; time: number; duration: number };
  type EditorStage = {
    title: string;
    artist: string;
    bpm: number;
    beatOffset: number;
    laneCount: number;
    notes: EditorNote[];
  };
  
  type PlaytestProps = {
    stage: EditorStage;
    audioUrl: string;
    videoUrl?: string;
    startTimeSec: number;
    onClose: () => void;
  };
  
  const DUMMY_STAGE: StageConfig = {
    id: "preview",
    label: "Preview",
    startRatio: 0,
    endRatio: 1,
    bpm: 120,
    beatStep: 1,
    density: 0,
    chordChance: 0,
    sustainChance: 0,
    sustainBeats: 1,
  };
  
  /** Normal difficulty timing for playtest (same as main game Normal). */
  const PLAYTEST_TIMING: TimingWindows = {
    perfectWindow: 0.082,
    greatWindow: 0.138,
    goodWindow: 0.2,
  };
  
  const DEFAULT_BINDINGS = ["KeyD", "KeyF", "KeyJ", "KeyK"];
  
  export function RaidHeroPlaytestOverlay({
    stage,
    audioUrl,
    videoUrl,
    startTimeSec,
    onClose,
  }: PlaytestProps) {
    const engineRef = useRef<EngineState>(createEngineState());
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const pressedLanesRef = useRef<boolean[]>(Array(LANE_COUNT).fill(false));
    const goodWindow = PLAYTEST_TIMING.goodWindow;
  
    const [view, setView] = useState<ViewState>(() =>
      createViewState(engineRef.current, goodWindow, TRACK_HEIGHT, HIT_LINE_Y),
    );
    const [lastJudgment, setLastJudgment] = useState<Judgment | null>(null);
    const [lanePressed, setLanePressed] = useState<boolean[]>(() =>
      Array(LANE_COUNT).fill(false),
    );
    const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null);
    const dragPositionRef = useRef<{ x: number; y: number } | null>(null);
    useEffect(() => {
      dragPositionRef.current = dragPosition;
    }, [dragPosition]);
  
    const activeLaneCount = stage.laneCount;
    const laneIndices = useMemo(
      () => Array.from({ length: activeLaneCount }, (_, i) => i),
      [activeLaneCount],
    );
    const activeBindings = useMemo(
      () => DEFAULT_BINDINGS.slice(0, activeLaneCount),
      [activeLaneCount],
    );
  
    const syncView = useCallback(() => {
      setView(
        createViewState(engineRef.current, goodWindow, TRACK_HEIGHT, HIT_LINE_Y),
      );
    }, [goodWindow]);
  
    const registerLaneHit = useCallback((lane: number) => {
      const judgment = registerLaneHitInEngine(
        engineRef.current,
        lane,
        PLAYTEST_TIMING,
      );
      setLastJudgment(judgment);
      window.setTimeout(
        () => setLastJudgment((cur) => (cur === judgment ? null : cur)),
        judgment === "miss" ? 140 : 180,
      );
      syncView();
    }, [syncView]);
  
    const setLanePressedAt = useCallback((lane: number, pressed: boolean) => {
      pressedLanesRef.current[lane] = pressed;
      setLanePressed((prev) => {
        const next = [...prev];
        next[lane] = pressed;
        return next;
      });
    }, []);
  
    const clearPressedLanes = useCallback(() => {
      pressedLanesRef.current.fill(false);
      setLanePressed(() => Array(LANE_COUNT).fill(false));
    }, []);
  
    // למפות EditorNote → Note של המנוע (רק בהתחלה — לא לאפס כשהסימולציה כבר רצה)
    const stageSerialRef = useRef<string>("");
    useEffect(() => {
      const engine = engineRef.current;
      const serial = JSON.stringify({ n: stage.notes.length, first: stage.notes[0]?.time });
      if (engine.running && serial === stageSerialRef.current) return;
      stageSerialRef.current = serial;
      const notes: Note[] = stage.notes.map((n, idx) => ({
        id: idx + 1,
        lane: n.lane,
        hitTime: n.time,
        duration: n.duration ?? 0,
        holdTicksScored: 0,
        holdBroken: false,
        holdComplete: n.duration <= 0,
        judged: false,
        judgment: undefined,
      }));
      engine.notes = notes;
      engine.totalNotes = notes.length;
      engine.duration =
        (notes[notes.length - 1]?.hitTime ?? 0) +
        Math.max(5, stage.beatOffset + 5);
      engine.elapsed = 0;
      engine.finished = false;
      engine.running = false;
      engine.player = resetStats(engine.player);
      setView(createViewState(engine, goodWindow, TRACK_HEIGHT, HIT_LINE_Y));
    }, [stage, goodWindow]);
  
    // להתחיל סימולציה אחרי שהאודיו מוכן
    useEffect(() => {
      const audio = audioRef.current;
      if (!audio) return;
  
      const onLoaded = () => {
        const engine = engineRef.current;
        const dur = Number.isFinite(audio.duration) ? audio.duration : engine.duration;
        engine.duration = dur;
        const start = Math.max(0, Math.min(dur, startTimeSec));
        engine.elapsed = start;
        engine.running = true;
        engine.finished = false;
        try {
          audio.currentTime = start;
        } catch {
          /* ignore */
        }
        void audio.play().catch(() => {});
        setView(createViewState(engine, goodWindow, TRACK_HEIGHT, HIT_LINE_Y));
      };
  
      audio.addEventListener("loadedmetadata", onLoaded);
      if (audio.readyState >= 1) onLoaded();
      return () => audio.removeEventListener("loadedmetadata", onLoaded);
    }, [startTimeSec, audioUrl, goodWindow]);
  
    // לולאת משחק (RAF)
    useEffect(() => {
      let rafId = 0;
      let prevTime = performance.now();
  
      const frame = (t: number) => {
        const dt = Math.min((t - prevTime) / 1000, 0.05);
        prevTime = t;
        const engine = engineRef.current;
        const audio = audioRef.current;
        if (engine.running) {
          const prevElapsed = engine.elapsed;
          let songTime = engine.elapsed + dt;
          if (audio && audio.readyState >= 2 && Number.isFinite(audio.currentTime)) {
            songTime = audio.currentTime;
          }
          stepEngineToTime(engine, songTime, [DUMMY_STAGE], goodWindow);
          stepSustainToTime(
            engine,
            prevElapsed,
            pressedLanesRef.current,
          );
          if (engine.duration > 0 && engine.elapsed >= engine.duration) {
            engine.running = false;
            engine.finished = true;
          }
          setView(
            createViewState(engine, goodWindow, TRACK_HEIGHT, HIT_LINE_Y),
          );
        }
        rafId = requestAnimationFrame(frame);
      };
  
      rafId = requestAnimationFrame(frame);
      return () => cancelAnimationFrame(rafId);
    }, [goodWindow]);
  
    // מקלדת — capture phase + stopPropagation כדי שהמשחק הראשי לא יקבל את האירוע
    // (אחרת הוא מעדכן state, StageEditor נרנדר מחדש עם stage חדש, וה-effect מאפס engine.running)
    useEffect(() => {
      const onDown = (e: KeyboardEvent) => {
        if (e.repeat) return;
        const lane = activeBindings.findIndex((v) => v === e.code);
        if (lane < 0) return;
        e.preventDefault();
        e.stopPropagation();
        setLanePressedAt(lane, true);
        registerLaneHit(lane);
      };
      const onUp = (e: KeyboardEvent) => {
        const lane = activeBindings.findIndex((v) => v === e.code);
        if (lane < 0) return;
        e.preventDefault();
        e.stopPropagation();
        setLanePressedAt(lane, false);
      };
      const opts = { capture: true };
      document.addEventListener("keydown", onDown, opts);
      document.addEventListener("keyup", onUp, opts);
      window.addEventListener("blur", clearPressedLanes);
      return () => {
        document.removeEventListener("keydown", onDown, opts);
        document.removeEventListener("keyup", onUp, opts);
        window.removeEventListener("blur", clearPressedLanes);
      };
    }, [activeBindings, registerLaneHit, setLanePressedAt, clearPressedLanes]);
  
    const handleHeaderMouseDown = useCallback((e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      const pos = dragPositionRef.current ?? {
        x: window.innerWidth / 2 - 450,
        y: Math.max(78, window.innerHeight / 2 - 320),
      };
      const startX = pos.x;
      const startY = pos.y;
      const clientX0 = e.clientX;
      const clientY0 = e.clientY;
      const onMove = (ev: MouseEvent) => {
        setDragPosition({
          x: startX + ev.clientX - clientX0,
          y: startY + ev.clientY - clientY0,
        });
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    }, []);
  
    // וידאו – לסנכרן להתחלה
    useEffect(() => {
      const audio = audioRef.current;
      const video = videoRef.current;
      if (!audio || !video) return;
      const sync = () => {
        try {
          video.currentTime = audio.currentTime;
        } catch {
          /* ignore */
        }
        if (audio.paused) video.pause();
        else void video.play().catch(() => {});
      };
      const id = setInterval(sync, 200);
      return () => clearInterval(id);
    }, [audioUrl, videoUrl]);
  
    // סטטוס / HUD
    const stats: PlayerStats = view.player;
    const accuracy = getAccuracy(stats);
    const grade = getGrade(accuracy);
    const progress =
      view.duration > 0
        ? Math.max(0, Math.min(100, (view.elapsed / view.duration) * 100))
        : 0;
  
    const shellStyle: CSSProperties = dragPosition
      ? { left: dragPosition.x, top: dragPosition.y, transform: "none" }
      : {};

    return (
      <div
        className="raid-playtest-backdrop"
        onClick={onClose}
        role="presentation"
      >
        <div
          className="raid-playtest-shell"
          style={shellStyle}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Raid Hero stage playtest"
        >
          {/* HEADER — גרירה */}
          <header
            className="raid-playtest-header raid-hero-header"
            onMouseDown={handleHeaderMouseDown}
          >
            <div className="raid-header-left">
              <span className="raid-hero-logo">🎸</span>
              <div>
                <h1>RAID HERO – Preview</h1>
                <p>
                  {stage.title}{" "}
                  <span className="raid-artist">— {stage.artist}</span>
                </p>
              </div>
            </div>
            <div className="raid-hero-controls">
              <div className="raid-hero-clock">
                {formatClock(view.elapsed)} /{" "}
                {view.duration > 0 ? formatClock(view.duration) : "--:--"}
              </div>
              <button
                type="button"
                className="raid-hero-btn raid-hero-btn--menu"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </header>
  
          {/* PROGRESS */}
          <div
            className="raid-song-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
          >
            <div
              className="raid-song-progress__bar"
              style={{ width: `${progress}%` }}
            />
          </div>
  
          {/* GAME LAYOUT – שמאל / מרכז / ימין */}
          <div className="raid-game-layout">
            {/* LEFT – HUD בסיסי */}
            <aside className="raid-left-panel">
              <div className="raid-score-block">
                <div className="raid-score-label">SCORE</div>
                <div className="raid-score-value">
                  {stats.score.toLocaleString()}
                </div>
              </div>
              <div className="raid-combo-block">
                <div className="raid-combo-num">{stats.combo}</div>
                <div className="raid-combo-label">COMBO</div>
              </div>
              <div className="raid-grade-block">
                <div className="raid-grade-letter" data-grade={grade}>
                  {grade}
                </div>
                <div className="raid-accuracy">{accuracy}%</div>
              </div>
            </aside>
  
            {/* CENTER – ה-highway */}
            <div className="raid-highway-wrap">
              <div className="raid-track-lanes">
                {videoUrl && (
                  <video
                    ref={videoRef}
                    className="raid-bg-video"
                    src={videoUrl}
                    muted
                    playsInline
                    preload="metadata"
                  />
                )}
  
                {/* Lane backgrounds */}
                {laneIndices.map((lane) => (
                  <div
                    key={`lane-${lane}`}
                    className="raid-lane"
                    style={
                      {
                        width: `calc(100% / ${activeLaneCount})`,
                        left: `${(lane / activeLaneCount) * 100}%`,
                      } as CSSProperties
                    }
                  />
                ))}
  
                {/* Judgment popup */}
                {lastJudgment && (
                  <div
                    className={`raid-judgment-popup raid-judgment-popup--${lastJudgment}`}
                    key={`${lastJudgment}-${view.player.totalJudged}`}
                  >
                    {lastJudgment === "perfect"
                      ? "✦ PERFECT ✦"
                      : lastJudgment === "great"
                        ? "GREAT!"
                        : lastJudgment === "good"
                          ? "GOOD"
                          : "MISS"}
                  </div>
                )}

                {/* Notes */}
                {view.visibleNotes.map((note) => (
                  <div
                    key={note.id}
                    className={`raid-note raid-note--p1${
                      note.isSustain ? " is-sustain" : ""
                    }`}
                    style={
                      {
                        left: `calc(${
                          ((note.lane + 0.5) / activeLaneCount) * 100
                        }% - 26px)`,
                        transform: `translateY(${note.y}px)`,
                        height: `${note.height}px`,
                      } as CSSProperties
                    }
                  />
                ))}

                {/* Hit line */}
                <div
                  className={`raid-hit-line${lastJudgment ? ` raid-hit-line--${lastJudgment}` : ""}`}
                  style={{ top: `${HIT_LINE_Y}px` }}
                />

                {/* Hit buttons — D F J K */}
                <div
                  className="raid-hit-buttons"
                  style={{ top: `${HIT_LINE_Y - 20}px` }}
                >
                  {laneIndices.map((lane) => (
                    <div
                      key={lane}
                      className={`raid-hit-btn${lanePressed[lane] ? " is-pressed" : ""}`}
                      style={{
                        width: `calc(100% / ${activeLaneCount})`,
                        ["--lane-color" as string]: ["#22c55e", "#ef4444", "#eab308", "#3b82f6"][lane % 4],
                        ["--lane-glow" as string]: ["rgba(34,197,94,0.8)", "rgba(239,68,68,0.8)", "rgba(234,179,8,0.8)", "rgba(59,130,246,0.8)"][lane % 4],
                      } as CSSProperties}
                    >
                      <div className="raid-hit-btn-inner">
                        <span className="raid-hit-btn-key">
                          {activeBindings[lane]?.replace("Key", "") ?? ""}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
  
            {/* RIGHT – HUD קצר */}
            <aside className="raid-right-panel">
              <div className="raid-hud-card">
                <span className="raid-hud-title">Notes</span>
                <strong className="raid-hud-value">
                  {view.totalNotes - stats.totalJudged}
                </strong>
                <small className="raid-hud-sub">
                  {stats.totalJudged}/{view.totalNotes} judged
                </small>
              </div>
            </aside>
          </div>
  
          {/* AUDIO ELEMENT */}
          <audio ref={audioRef} src={audioUrl} preload="auto" />
        </div>
      </div>
    );
  }
  
  function resetStats(_: PlayerStats | undefined): PlayerStats {
    return {
      score: 0,
      combo: 0,
      bestCombo: 0,
      hits: 0,
      misses: 0,
      perfect: 0,
      great: 0,
      good: 0,
      totalJudged: 0,
      accuracyPoints: 0,
    };
  }