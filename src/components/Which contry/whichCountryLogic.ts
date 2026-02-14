import type { PlayableCountry } from "./whichCountryData";

export const CORRECT_DELAY_MS = 700;
export const WRONG_DELAY_MS = 1000;
export const MAX_STRIKES = 3;
export const ROUND_TIME_SECONDS = 10;
export const BASE_CORRECT_POINTS = 100;
export const TIME_BONUS_POINTS = 10;
export const STREAK_BONUS_POINTS = 50;
export const HINT_PENALTY_POINTS = 50;
export const BEST_SCORE_STORAGE_KEY = "gameshub:which-country:best-score";

export type Difficulty = "easy" | "medium" | "hard";

const DIFFICULTY_LIMITS: Record<Difficulty, number> = {
  easy: 60,
  medium: 120,
  hard: Number.POSITIVE_INFINITY,
};

export function getDifficultyCountries(
  countries: PlayableCountry[],
  difficulty: Difficulty,
): PlayableCountry[] {
  const sorted = [...countries].sort((a, b) => b.area - a.area);
  const limit = DIFFICULTY_LIMITS[difficulty];
  if (!Number.isFinite(limit)) {
    return sorted;
  }
  return sorted.slice(0, limit);
}

export function pickRandomCountry(
  countries: PlayableCountry[],
  excludeIso3?: string,
): PlayableCountry | null {
  if (!countries.length) {
    return null;
  }

  if (countries.length === 1) {
    return countries[0];
  }

  let selected = countries[Math.floor(Math.random() * countries.length)];
  if (!excludeIso3 || selected.iso3 !== excludeIso3) {
    return selected;
  }

  let attempts = 0;
  while (selected.iso3 === excludeIso3 && attempts < 20) {
    selected = countries[Math.floor(Math.random() * countries.length)];
    attempts += 1;
  }

  if (selected.iso3 === excludeIso3) {
    return countries.find((country) => country.iso3 !== excludeIso3) ?? selected;
  }

  return selected;
}

export function isCorrectGuess(clickedIso3: string, targetIso3: string): boolean {
  return clickedIso3 === targetIso3;
}

export function loadBestScore(): number {
  try {
    const raw = window.localStorage.getItem(BEST_SCORE_STORAGE_KEY);
    const parsed = Number.parseInt(raw ?? "0", 10);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

export function saveBestScore(nextBest: number): void {
  try {
    window.localStorage.setItem(BEST_SCORE_STORAGE_KEY, String(nextBest));
  } catch {
    // Ignore localStorage write failures.
  }
}

export function getFlagFallbackText(iso2: string | undefined): string {
  return iso2?.toUpperCase() ?? "FLAG";
}
