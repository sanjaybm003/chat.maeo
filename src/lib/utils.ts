import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import type { Person } from "@/types/domain";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type NamedPerson = Pick<Person, "displayName" | "fullName" | "email">;

export function nameOf(person: NamedPerson | null | undefined, fallback = "Former member") {
  if (!person) return fallback;
  return person.displayName || person.fullName || person.email.split("@")[0] || fallback;
}

export function firstNameOf(person: NamedPerson | null | undefined, fallback = "Someone") {
  if (!person) return fallback;
  if (person.displayName) return person.displayName;
  if (person.fullName) return person.fullName.split(/\s+/)[0];
  return person.email.split("@")[0] || fallback;
}

export function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return Array.from(parts[0]).slice(0, 2).join("").toUpperCase();
  return (Array.from(parts[0])[0] + Array.from(parts[parts.length - 1])[0]).toUpperCase();
}

export function slugify(input: string) {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function joinNames(names: string[], max = 3) {
  if (names.length <= max) {
    if (names.length <= 1) return names.join("");
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export const isMac = () =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
