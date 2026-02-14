export type SoundQuestion = Readonly<{
  sound: string;
  correct: string;
  options: readonly string[];
}>;

export type SoundFamily = "sibilant" | "hard" | "vowel" | "marker";

export type SoundLesson = Readonly<{
  sound: string;
  letter: string;
  russianName: string;
  ipa: string;
  englishAnchor: string;
  mnemonic: string;
  examples: readonly string[];
  family: SoundFamily;
}>;

export type StreakMilestone = Readonly<{
  streak: number;
  title: string;
  message: string;
}>;

type AlphabetEntry = SoundLesson;

const alphabetEntries: readonly AlphabetEntry[] = [
  {
    sound: "A",
    letter: "\u0410",
    russianName: "a",
    ipa: "/a/",
    englishAnchor: "Like a in 'father'.",
    mnemonic: "\u0410 looks like A and sounds broad and open.",
    examples: ["father", "palm", "spa"],
    family: "vowel",
  },
  {
    sound: "B",
    letter: "\u0411",
    russianName: "be",
    ipa: "/b/",
    englishAnchor: "Like b in 'bat'.",
    mnemonic: "\u0411 is a strong block with a clear B start.",
    examples: ["bat", "book", "cabin"],
    family: "hard",
  },
  {
    sound: "V",
    letter: "\u0412",
    russianName: "ve",
    ipa: "/v/",
    englishAnchor: "Like v in 'voice'.",
    mnemonic: "\u0412 has two bowls, like vibration in V.",
    examples: ["voice", "very", "move"],
    family: "hard",
  },
  {
    sound: "G",
    letter: "\u0413",
    russianName: "ge",
    ipa: "/g/",
    englishAnchor: "Like g in 'go'.",
    mnemonic: "\u0413 is a corner shape: hard G edge.",
    examples: ["go", "game", "bigger"],
    family: "hard",
  },
  {
    sound: "D",
    letter: "\u0414",
    russianName: "de",
    ipa: "/d/",
    englishAnchor: "Like d in 'door'.",
    mnemonic: "\u0414 stands like a doorway and hits a D.",
    examples: ["door", "day", "ladder"],
    family: "hard",
  },
  {
    sound: "YE",
    letter: "\u0415",
    russianName: "ye",
    ipa: "/je/",
    englishAnchor: "Like ye in 'yes' at word start.",
    mnemonic: "\u0415 is E with a Y glide at the front.",
    examples: ["yes", "yellow", "yesterday"],
    family: "vowel",
  },
  {
    sound: "YO",
    letter: "\u0401",
    russianName: "yo",
    ipa: "/jo/",
    englishAnchor: "Like yo in 'yoga'.",
    mnemonic: "Two dots on \u0401 always force YO.",
    examples: ["yoga", "yolk", "yodel"],
    family: "vowel",
  },
  {
    sound: "ZH",
    letter: "\u0416",
    russianName: "zhe",
    ipa: "/\u0292/",
    englishAnchor: "Like s in 'measure'.",
    mnemonic: "\u0416 has spikes, matching buzzing ZH.",
    examples: ["measure", "vision", "beige"],
    family: "sibilant",
  },
  {
    sound: "Z",
    letter: "\u0417",
    russianName: "ze",
    ipa: "/z/",
    englishAnchor: "Like z in 'zebra'.",
    mnemonic: "\u0417 curves like a quick zig-zag Z.",
    examples: ["zebra", "zone", "buzz"],
    family: "hard",
  },
  {
    sound: "I",
    letter: "\u0418",
    russianName: "i",
    ipa: "/i/",
    englishAnchor: "Like ee in 'see'.",
    mnemonic: "\u0418 has two pillars bridged by an ee sound.",
    examples: ["see", "machine", "green"],
    family: "vowel",
  },
  {
    sound: "J",
    letter: "\u0419",
    russianName: "i kratkoye",
    ipa: "/j/",
    englishAnchor: "Like y in 'toy'.",
    mnemonic: "The breve on \u0419 marks a short Y glide.",
    examples: ["toy", "boy", "yoga"],
    family: "vowel",
  },
  {
    sound: "K",
    letter: "\u041a",
    russianName: "ka",
    ipa: "/k/",
    englishAnchor: "Like k in 'kite'.",
    mnemonic: "\u041a is angular and clicks with K energy.",
    examples: ["kite", "skill", "back"],
    family: "hard",
  },
  {
    sound: "L",
    letter: "\u041b",
    russianName: "el",
    ipa: "/l/",
    englishAnchor: "Like l in 'lamp'.",
    mnemonic: "\u041b stands on two legs, landing softly on L.",
    examples: ["lamp", "light", "full"],
    family: "hard",
  },
  {
    sound: "M",
    letter: "\u041c",
    russianName: "em",
    ipa: "/m/",
    englishAnchor: "Like m in 'map'.",
    mnemonic: "\u041c mirrors M and hums exactly like M.",
    examples: ["map", "mood", "team"],
    family: "hard",
  },
  {
    sound: "N",
    letter: "\u041d",
    russianName: "en",
    ipa: "/n/",
    englishAnchor: "Like n in 'note'.",
    mnemonic: "\u041d is an H-shape carrying a clear N sound.",
    examples: ["note", "near", "sun"],
    family: "hard",
  },
  {
    sound: "O",
    letter: "\u041e",
    russianName: "o",
    ipa: "/o/",
    englishAnchor: "Like o in 'more' (rounded).",
    mnemonic: "\u041e is a full circle, matching rounded O.",
    examples: ["more", "over", "port"],
    family: "vowel",
  },
  {
    sound: "P",
    letter: "\u041f",
    russianName: "pe",
    ipa: "/p/",
    englishAnchor: "Like p in 'pen'.",
    mnemonic: "\u041f is a gate shape that pops with P.",
    examples: ["pen", "spin", "stop"],
    family: "hard",
  },
  {
    sound: "R",
    letter: "\u0420",
    russianName: "er",
    ipa: "/r/",
    englishAnchor: "Rolled/trilled r.",
    mnemonic: "\u0420 looks like P but rolls as R.",
    examples: ["rolled r", "river", "carry"],
    family: "hard",
  },
  {
    sound: "S",
    letter: "\u0421",
    russianName: "es",
    ipa: "/s/",
    englishAnchor: "Like s in 'sun'.",
    mnemonic: "\u0421 is an open curve with clean S airflow.",
    examples: ["sun", "city", "glass"],
    family: "sibilant",
  },
  {
    sound: "T",
    letter: "\u0422",
    russianName: "te",
    ipa: "/t/",
    englishAnchor: "Like t in 'top'.",
    mnemonic: "\u0422 is a heavy T bar over two legs.",
    examples: ["top", "tight", "cat"],
    family: "hard",
  },
  {
    sound: "U",
    letter: "\u0423",
    russianName: "u",
    ipa: "/u/",
    englishAnchor: "Like oo in 'boot'.",
    mnemonic: "\u0423 drops down like a hooked OO sound.",
    examples: ["boot", "food", "group"],
    family: "vowel",
  },
  {
    sound: "F",
    letter: "\u0424",
    russianName: "ef",
    ipa: "/f/",
    englishAnchor: "Like f in 'fish'.",
    mnemonic: "\u0424 is a circle with a staff, focused F.",
    examples: ["fish", "coffee", "leaf"],
    family: "hard",
  },
  {
    sound: "KH",
    letter: "\u0425",
    russianName: "kha",
    ipa: "/x/",
    englishAnchor: "A throaty h like in 'Bach'.",
    mnemonic: "\u0425 crosses airflow and adds rough KH friction.",
    examples: ["Bach", "loch", "khan"],
    family: "hard",
  },
  {
    sound: "TS",
    letter: "\u0426",
    russianName: "tse",
    ipa: "/ts/",
    englishAnchor: "Like ending of 'cats'.",
    mnemonic: "\u0426 has a tail, snapping with TS.",
    examples: ["cats", "pizza", "nuts"],
    family: "sibilant",
  },
  {
    sound: "CH",
    letter: "\u0427",
    russianName: "che",
    ipa: "/t\u0283/",
    englishAnchor: "Like ch in 'chess'.",
    mnemonic: "\u0427 is a hook catching CH quickly.",
    examples: ["chess", "chip", "lunch"],
    family: "sibilant",
  },
  {
    sound: "SH",
    letter: "\u0428",
    russianName: "sha",
    ipa: "/\u0282/",
    englishAnchor: "Like sh in 'ship'.",
    mnemonic: "\u0428 has three prongs whispering SH.",
    examples: ["ship", "shadow", "brush"],
    family: "sibilant",
  },
  {
    sound: "SCH",
    letter: "\u0429",
    russianName: "shcha",
    ipa: "/\u0255\u02d0/",
    englishAnchor: "Longer softer SH blend.",
    mnemonic: "\u0429 extends \u0428 with a tail, stretch the SH.",
    examples: ["long sh", "fresh-sh", "sh+ch"],
    family: "sibilant",
  },
  {
    sound: "HARD_SIGN",
    letter: "\u042a",
    russianName: "tvyordyy znak",
    ipa: "--",
    englishAnchor: "No own sound: hard separation marker.",
    mnemonic: "\u042a is a separator that blocks softening.",
    examples: ["marker only", "separates syllables", "hard boundary"],
    family: "marker",
  },
  {
    sound: "Y",
    letter: "\u042b",
    russianName: "yery",
    ipa: "/\u0268/",
    englishAnchor: "Deep i, between i and u.",
    mnemonic: "\u042b is split shape for split mouth vowel.",
    examples: ["inner i", "myth-like", "deep i"],
    family: "vowel",
  },
  {
    sound: "SOFT_SIGN",
    letter: "\u042c",
    russianName: "myagkiy znak",
    ipa: "--",
    englishAnchor: "No own sound: softens previous consonant.",
    mnemonic: "\u042c softens the consonant before it.",
    examples: ["marker only", "softness marker", "palatal cue"],
    family: "marker",
  },
  {
    sound: "E",
    letter: "\u042d",
    russianName: "e",
    ipa: "/e/",
    englishAnchor: "Like e in 'met' but clearer.",
    mnemonic: "\u042d opens forward to a clean E sound.",
    examples: ["met", "echo", "bed"],
    family: "vowel",
  },
  {
    sound: "YU",
    letter: "\u042e",
    russianName: "yu",
    ipa: "/ju/",
    englishAnchor: "Like 'you' at word start.",
    mnemonic: "\u042e starts with Y glide then OO.",
    examples: ["you", "yule", "unison"],
    family: "vowel",
  },
  {
    sound: "YA",
    letter: "\u042f",
    russianName: "ya",
    ipa: "/ja/",
    englishAnchor: "Like ya in 'yacht'.",
    mnemonic: "\u042f mirrors R and launches YA.",
    examples: ["yacht", "yard", "yak"],
    family: "vowel",
  },
] as const;

const allAlphabetLetters = alphabetEntries.map((entry) => entry.letter);
const letterSet = new Set(allAlphabetLetters);

function rotatePick(pool: readonly string[], count: number, seed: number): string[] {
  const unique = [...new Set(pool)].filter((item) => item.length > 0);
  if (unique.length === 0) return [];

  const picks: string[] = [];
  let cursor = Math.abs(seed) % unique.length;

  while (picks.length < count && picks.length < unique.length) {
    const candidate = unique[cursor % unique.length];
    if (!picks.includes(candidate)) {
      picks.push(candidate);
    }
    cursor += 1;
  }

  return picks;
}

const letterHintMap: Readonly<Record<string, readonly string[]>> = {
  A: ["\u041e", "\u042f", "\u042d"],
  B: ["\u041f", "\u0412", "\u0414"],
  V: ["\u0424", "\u0411", "\u0417"],
  G: ["\u041a", "\u0425", "\u0414"],
  D: ["\u0422", "\u0411", "\u0413"],
  YE: ["\u0401", "\u042d", "\u0418"],
  YO: ["\u0415", "\u042e", "\u041e"],
  ZH: ["\u0428", "\u0429", "\u0417"],
  Z: ["\u0421", "\u0416", "\u0426"],
  I: ["\u042b", "\u0419", "\u0415"],
  J: ["\u0418", "\u042b", "\u042c"],
  K: ["\u0413", "\u0425", "\u0422"],
  L: ["\u0420", "\u041d", "\u0419"],
  M: ["\u041d", "\u0411", "\u041f"],
  N: ["\u041c", "\u041b", "\u0420"],
  O: ["\u0410", "\u0423", "\u0401"],
  P: ["\u0411", "\u0424", "\u0422"],
  R: ["\u041b", "\u041d", "\u0414"],
  S: ["\u0417", "\u0428", "\u0426"],
  T: ["\u0414", "\u0426", "\u0427"],
  U: ["\u042e", "\u042b", "\u041e"],
  F: ["\u0412", "\u041f", "\u0425"],
  KH: ["\u041a", "\u0413", "\u0427"],
  TS: ["\u0421", "\u0427", "\u0422"],
  CH: ["\u0429", "\u0428", "\u0426"],
  SH: ["\u0429", "\u0416", "\u0421"],
  SCH: ["\u0428", "\u0427", "\u0416"],
  HARD_SIGN: ["\u042c", "\u042b", "\u0419"],
  Y: ["\u0418", "\u0419", "\u0423"],
  SOFT_SIGN: ["\u042a", "\u0419", "\u0418"],
  E: ["\u0415", "\u0418", "\u042b"],
  YU: ["\u042f", "\u0401", "\u0423"],
  YA: ["\u042e", "\u0415", "\u0410"],
};

const soundHintMap: Readonly<Record<string, readonly string[]>> = {
  A: ["O", "YA", "E"],
  B: ["P", "V", "D"],
  V: ["F", "B", "Z"],
  G: ["K", "KH", "D"],
  D: ["T", "B", "G"],
  YE: ["YO", "E", "I"],
  YO: ["YE", "YU", "O"],
  ZH: ["SH", "SCH", "Z"],
  Z: ["S", "ZH", "TS"],
  I: ["Y", "J", "YE"],
  J: ["I", "Y", "SOFT_SIGN"],
  K: ["G", "KH", "T"],
  L: ["R", "N", "J"],
  M: ["N", "B", "P"],
  N: ["M", "L", "R"],
  O: ["A", "U", "YO"],
  P: ["B", "F", "T"],
  R: ["L", "N", "D"],
  S: ["Z", "SH", "TS"],
  T: ["D", "TS", "CH"],
  U: ["YU", "Y", "O"],
  F: ["V", "P", "KH"],
  KH: ["K", "G", "HARD_SIGN"],
  TS: ["S", "CH", "T"],
  CH: ["SH", "SCH", "TS"],
  SH: ["SCH", "ZH", "CH"],
  SCH: ["SH", "CH", "ZH"],
  HARD_SIGN: ["SOFT_SIGN", "Y", "J"],
  Y: ["I", "J", "U"],
  SOFT_SIGN: ["HARD_SIGN", "J", "I"],
  E: ["YE", "I", "Y"],
  YU: ["YA", "YO", "U"],
  YA: ["YU", "YE", "A"],
};

function buildQuestionOptions(entry: AlphabetEntry, index: number): string[] {
  const hinted = (letterHintMap[entry.sound] ?? []).filter((letter) => letterSet.has(letter));

  const sameFamilyLetters = alphabetEntries
    .filter((item) => item.family === entry.family && item.letter !== entry.letter)
    .map((item) => item.letter);

  const globalLetters = allAlphabetLetters.filter((letter) => letter !== entry.letter);
  const fallback = rotatePick([...sameFamilyLetters, ...globalLetters], 5, index * 3 + 1);

  const distractors = [...new Set([...hinted, ...fallback])]
    .filter((letter) => letter !== entry.letter)
    .slice(0, 3);

  return [entry.letter, ...distractors];
}

function buildLetterDistractors(entry: AlphabetEntry, index: number): string[] {
  const options = buildQuestionOptions(entry, index).filter((letter) => letter !== entry.letter);
  return options.slice(0, 3);
}

function buildSoundDistractors(entry: AlphabetEntry, index: number): string[] {
  const hinted = (soundHintMap[entry.sound] ?? []).filter((sound) => sound !== entry.sound);

  const sameFamilySounds = alphabetEntries
    .filter((item) => item.family === entry.family && item.sound !== entry.sound)
    .map((item) => item.sound);

  const globalSounds = alphabetEntries
    .map((item) => item.sound)
    .filter((sound) => sound !== entry.sound);

  const fallback = rotatePick([...sameFamilySounds, ...globalSounds], 5, index * 2 + 2);

  return [...new Set([...hinted, ...fallback])]
    .filter((sound) => sound !== entry.sound)
    .slice(0, 3);
}

export const soundQuestions: readonly SoundQuestion[] = alphabetEntries.map((entry, index) => ({
  sound: entry.sound,
  correct: entry.letter,
  options: buildQuestionOptions(entry, index),
}));

export const soundLessons: readonly SoundLesson[] = alphabetEntries;

export const successMessages = [
  "\u05d9\u05e6\u05d0\u05ea \u05d7\u05de\u05e9\u05d5\u05e7 \ud83d\udd25",
  "Impressive.",
  "Linguistic sniper.",
  "Pew pew.",
] as const;

export const failMessages = [
  "That was embarrassing.",
  "DevOps would cry.",
  "Discipline violation.",
  "Return to kindergarten.",
] as const;

export const learningTips = [
  "Tip: Say the sound out loud before shooting.",
  "Tip: Compare look-alike letters before tapping.",
  "Tip: Signs (\u042a, \u042c) are markers, not vowels.",
  "Tip: Two dots on \u0401 always force YO.",
  "Tip: Boss rounds give more points but harder options.",
  "Tip: Build streak first, then speed.",
] as const;

export const streakMilestones: readonly StreakMilestone[] = [
  {
    streak: 3,
    title: "Warmup Locked",
    message: "Three accurate shots. Tempo is building.",
  },
  {
    streak: 5,
    title: "Hunter Mode",
    message: "Five in a row. Similar distractors incoming.",
  },
  {
    streak: 8,
    title: "Precision Engine",
    message: "Eight streak. You are reading patterns, not guessing.",
  },
  {
    streak: 12,
    title: "Boss Hunter",
    message: "Twelve streak. Boss rounds are high-value targets.",
  },
  {
    streak: 16,
    title: "Phonetic Legend",
    message: "Sixteen streak. Your recall speed is elite.",
  },
] as const;

export const similarLetterDistractors: Readonly<Record<string, readonly string[]>> =
  Object.fromEntries(
    alphabetEntries.map((entry, index) => [entry.letter, buildLetterDistractors(entry, index)]),
  );

export const similarSoundDistractors: Readonly<Record<string, readonly string[]>> =
  Object.fromEntries(
    alphabetEntries.map((entry, index) => [entry.sound, buildSoundDistractors(entry, index)]),
  );

export const allRussianLetters = Array.from(
  new Set(soundQuestions.map((question) => question.correct)),
);

export const allEnglishSounds = Array.from(
  new Set(soundQuestions.map((question) => question.sound)),
);

const lessonMap = Object.fromEntries(
  soundLessons.map((lesson) => [lesson.sound, lesson]),
) as Readonly<Record<string, SoundLesson>>;

const CYRILLIC_LETTER_REGEX = /^[\u0400-\u04FF]$/;

export function getSoundLesson(sound: string): SoundLesson {
  return lessonMap[sound] ?? {
    sound,
    letter: "?",
    russianName: "unknown",
    ipa: "",
    englishAnchor: "",
    mnemonic: "",
    examples: [],
    family: "hard",
  };
}

export function isRussianLetter(value: string): boolean {
  return CYRILLIC_LETTER_REGEX.test(value);
}

export function formatRussianLetterPair(value: string): string {
  if (!isRussianLetter(value)) return value;
  const upper = value.toLocaleUpperCase("ru-RU");
  const lower = value.toLocaleLowerCase("ru-RU");
  if (upper === lower) return value;
  return `${upper} ${lower}`;
}

function sanitizeAssetName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function getPromptAudioSrc(sound: string): string {
  return `${import.meta.env.BASE_URL}audio/sound-shooter/prompts/${sanitizeAssetName(sound)}.mp3`;
}

export function getUiAudioSrc(name: "shot" | "success" | "fail" | "boss"): string {
  return `${import.meta.env.BASE_URL}audio/sound-shooter/ui/${name}.mp3`;
}

export function getRandomItem<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function shuffle<T>(items: readonly T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = next[i];
    next[i] = next[j];
    next[j] = temp;
  }
  return next;
}
