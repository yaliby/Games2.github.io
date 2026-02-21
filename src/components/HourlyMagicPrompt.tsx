import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

const MAGIC_WORD = "פליזוש";
export const HOURLY_MAGIC_OPEN_EVENT = "open-hourly-magic-prompt";

export default function HourlyMagicPrompt() {
  const [isOpen, setIsOpen] = useState(false);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");

  const inputRef = useRef<HTMLInputElement | null>(null);

  const openPrompt = useCallback(() => {
    setAnswer("");
    setError("");
    setIsOpen(true);
  }, []);

  useEffect(() => {
    const onOpenEvent = () => {
      openPrompt();
    };

    window.addEventListener(HOURLY_MAGIC_OPEN_EVENT, onOpenEvent);
    return () => {
      window.removeEventListener(HOURLY_MAGIC_OPEN_EVENT, onOpenEvent);
    };
  }, [openPrompt]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    inputRef.current?.focus();
  }, [isOpen]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedAnswer = answer.trim().replace(/\s+/g, "");

    if (normalizedAnswer !== MAGIC_WORD) {
      setError("זו לא מילת הקסם. נסו שוב.");
      return;
    }

    setIsOpen(false);
    setAnswer("");
    setError("");
  };

  if (!isOpen) return null;

  return (
    <div className="hourly-magic-overlay" role="dialog" aria-modal="true" dir="rtl">
      <div className="hourly-magic-card">
        <img
          src="/img/Man.png"
          alt="דמות של אדם"
          className="hourly-magic-photo"
        />

        <p className="hourly-magic-title">רוצה להמשיך לשחק???</p>
        <p className="hourly-magic-subtitle">מה מילת הקסם?</p>

        <form className="hourly-magic-form" onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            className="hourly-magic-input"
            value={answer}
            onChange={(event) => {
              setAnswer(event.target.value);
              if (error) setError("");
            }}
            placeholder="הקלידו כאן..."
            aria-label="מילת הקסם"
            autoComplete="off"
          />
          <button className="hourly-magic-button" type="submit">
            להמשיך
          </button>
        </form>

        {error && <p className="hourly-magic-error">{error}</p>}
        <p className="hourly-magic-credit"> קרדיט לאגם-לי</p>
      </div>
    </div>
  );
}
