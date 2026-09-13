"use client";

import { useId, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";

import { IconClose } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SEPARATORS = /[\s,;]+/;

export const isValidEmail = (value: string) => EMAIL_PATTERN.test(value);

interface EmailChipsInputProps {
  value: string[];
  onChange: (emails: string[]) => void;
  max?: number;
  autoFocus?: boolean;
  id?: string;
  placeholder?: string;
}

/** Type, paste a list, or hit comma/enter: every address becomes a chip. */
export function EmailChipsInput({ value, onChange, max = 25, autoFocus, id, placeholder = "name@company.com" }: EmailChipsInputProps) {
  const fallbackId = useId();
  const inputId = id ?? fallbackId;
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");

  function commit(raw: string) {
    const incoming = raw
      .split(SEPARATORS)
      .map((part) => part.trim().replace(/^<|>$/g, "").toLowerCase())
      .filter(Boolean);
    if (incoming.length === 0) return;
    const merged = [...value];
    for (const email of incoming) {
      if (!merged.includes(email) && merged.length < max) merged.push(email);
    }
    onChange(merged);
    setDraft("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (["Enter", ",", ";", " ", "Tab"].includes(event.key) && draft.trim()) {
      event.preventDefault();
      commit(draft);
    } else if (event.key === "Backspace" && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text");
    if (SEPARATORS.test(text.trim())) {
      event.preventDefault();
      commit(`${draft} ${text}`);
    }
  }

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      className={cn(
        "flex min-h-[112px] cursor-text flex-wrap content-start gap-1.5 rounded-2xl border border-line-2 bg-surface p-2.5",
        "transition-[border-color,box-shadow] focus-within:border-ink focus-within:shadow-[0_0_0_4px_color-mix(in_srgb,var(--ink)_8%,transparent)]",
      )}
    >
      {value.map((email) => {
        const valid = isValidEmail(email);
        return (
          <span
            key={email}
            className={cn(
              "inline-flex h-8 max-w-full items-center gap-1 rounded-full pl-3 pr-1 text-[13.5px]",
              valid ? "bg-paper-2 text-ink" : "bg-danger-tint text-danger",
            )}
            title={valid ? email : "This doesn't look like an email address"}
          >
            <span className="truncate">{email}</span>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onChange(value.filter((item) => item !== email));
              }}
              className="flex size-6 items-center justify-center rounded-full opacity-60 transition hover:bg-[color-mix(in_srgb,currentColor_12%,transparent)] hover:opacity-100"
              aria-label={`Remove ${email}`}
            >
              <IconClose size={13} />
            </button>
          </span>
        );
      })}
      <input
        ref={inputRef}
        id={inputId}
        type="email"
        inputMode="email"
        autoComplete="off"
        autoFocus={autoFocus}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onBlur={() => commit(draft)}
        disabled={value.length >= max}
        placeholder={value.length === 0 ? placeholder : value.length >= max ? `That's ${max}, the most per invite` : "Add another"}
        className="h-8 min-w-[180px] flex-1 bg-transparent px-1.5 text-[15px] text-ink outline-none placeholder:text-ink-4"
      />
    </div>
  );
}
