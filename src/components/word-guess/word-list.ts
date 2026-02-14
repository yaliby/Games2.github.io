import answerWordsRaw from "./answer-words.txt?raw";
import guessOnlyWordsRaw from "./guess-only-words.txt?raw";

export const WORD_LENGTH = 5;

function parseWordLines(raw: string) {
  return raw
  .split(/\r?\n/)
  .map((word) => word.trim().toLowerCase())
  .filter((word) => /^[a-z]{5}$/.test(word));
}

export const ANSWER_WORDS = Array.from(new Set(parseWordLines(answerWordsRaw)));
const answerWordSet = new Set(ANSWER_WORDS);
export const GUESS_ONLY_WORDS = Array.from(
  new Set(parseWordLines(guessOnlyWordsRaw).filter((word) => !answerWordSet.has(word)))
);
export const VALID_GUESS_WORDS = Array.from(new Set([...ANSWER_WORDS, ...GUESS_ONLY_WORDS]));
export const VALID_GUESS_SET = new Set(VALID_GUESS_WORDS);

if (ANSWER_WORDS.length === 0) {
  throw new Error("answer-words.txt does not contain valid 5-letter words.");
}
