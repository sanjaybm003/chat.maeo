import { z } from "zod";

import { newPasswordSchema } from "@/features/auth/schemas";
import { PERSON_COLORS } from "@/types/domain";

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .transform((value) => (value ? value : null));

export const profileStepSchema = z.object({
  fullName: z.string().trim().min(1, "Tell your team your name.").max(80, "Keep it under 80 characters."),
  displayName: optionalText(40, "Keep it under 40 characters."),
  title: optionalText(80, "Keep it under 80 characters."),
  color: z.enum(PERSON_COLORS),
  password: newPasswordSchema.optional(),
  next: z.string().max(500).optional(),
});

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2, "Use at least 2 characters.").max(60, "Keep it under 60 characters."),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(SLUG_PATTERN, "Use 3–40 lowercase letters, numbers or dashes."),
  teamSize: z.enum(["solo", "2-10", "11-50", "51-200", "200+"]).nullable(),
  useCase: z.string().max(40).nullable(),
});

export type ProfileStepInput = z.input<typeof profileStepSchema>;
export type CreateWorkspaceInput = z.input<typeof createWorkspaceSchema>;
