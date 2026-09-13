"use client";

import { useState } from "react";

import { personColorStyle } from "@/lib/colors";
import { avatarUrl } from "@/lib/storage";
import { cn, initialsOf, nameOf } from "@/lib/utils";
import type { Person } from "@/types/domain";

type AvatarPerson = Pick<Person, "displayName" | "fullName" | "email" | "avatarPath" | "color">;

const SIZES = {
  xs: { box: "size-5", text: "text-[9px]", dot: "size-1.5 ring-[1.5px]" },
  sm: { box: "size-7", text: "text-[11px]", dot: "size-2 ring-2" },
  md: { box: "size-9", text: "text-[13px]", dot: "size-2.5 ring-2" },
  lg: { box: "size-11", text: "text-[15px]", dot: "size-3 ring-2" },
  xl: { box: "size-16", text: "text-[22px]", dot: "size-3.5 ring-[3px]" },
  "2xl": { box: "size-24", text: "text-[32px]", dot: "size-4 ring-4" },
} as const;

export type AvatarSize = keyof typeof SIZES;

interface AvatarProps {
  person: AvatarPerson | null | undefined;
  size?: AvatarSize;
  online?: boolean;
  className?: string;
  /** Overrides the image, e.g. a local preview before upload. */
  src?: string | null;
}

export function Avatar({ person, size = "md", online, className, src }: AvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const styles = SIZES[size];
  const name = nameOf(person, "?");
  const imageSrc = src ?? (person?.avatarPath ? avatarUrl(person.avatarPath) : null);
  const showImage = imageSrc && failedSrc !== imageSrc;

  return (
    <span
      className={cn("relative inline-flex shrink-0", styles.box, className)}
      style={person ? personColorStyle(person.color) : undefined}
      role="img"
      aria-label={person ? name : "Former member"}
    >
      <span
        className={cn(
          "flex size-full select-none items-center justify-center overflow-hidden rounded-full font-display font-semibold leading-none tracking-tight",
          person ? "bg-person text-person-on" : "bg-paper-3 text-ink-3",
          styles.text,
        )}
      >
        {showImage ? (
          // Avatars come from Supabase Storage; next/image optimisation adds nothing at these sizes.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageSrc}
            alt=""
            className="size-full object-cover"
            loading="lazy"
            decoding="async"
            onError={() => setFailedSrc(imageSrc)}
          />
        ) : person ? (
          initialsOf(name)
        ) : (
          "?"
        )}
      </span>
      {online ? (
        <span
          className={cn(
            "absolute -bottom-px -right-px rounded-full bg-online ring-[var(--avatar-ring,var(--surface))]",
            styles.dot,
          )}
          aria-label="Online"
        />
      ) : null}
    </span>
  );
}

/** Two faces offset on a diagonal: reads as "a few people" at a glance. */
export function GroupAvatar({
  people,
  size = "md",
  className,
}: {
  people: Array<AvatarPerson | null | undefined>;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const [first, second] = people;
  const box = { sm: "size-7", md: "size-9", lg: "size-11", xl: "size-16" }[size];
  const inner = ({ sm: "xs", md: "sm", lg: "md", xl: "lg" } as const)[size];

  return (
    <span className={cn("relative inline-flex shrink-0", box, className)} aria-hidden="true">
      <Avatar person={first} size={inner} className="absolute left-0 top-0" />
      <Avatar
        person={second ?? first}
        size={inner}
        className="absolute bottom-0 right-0 rounded-full ring-2 ring-[var(--avatar-ring,var(--surface))]"
      />
    </span>
  );
}
