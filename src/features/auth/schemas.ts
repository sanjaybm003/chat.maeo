import { z } from "zod";

export const emailSchema = z
  .string({ error: "Enter your email address." })
  .trim()
  .toLowerCase()
  .min(1, "Enter your email address.")
  .pipe(z.email("That doesn't look like an email address."));

export const newPasswordSchema = z
  .string({ error: "Choose a password." })
  .min(8, "Use at least 8 characters.")
  .max(72, "Keep it under 72 characters.")
  .refine((value) => /[a-zA-Z]/.test(value) && /[^a-zA-Z]/.test(value), {
    message: "Mix in a number or a symbol.",
  });

const nextSchema = z.string().max(500).optional();

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password.").max(200),
  next: nextSchema,
});

export const signUpSchema = z.object({
  email: emailSchema,
  password: newPasswordSchema,
  next: nextSchema,
});

export const emailLinkSchema = z.object({
  email: emailSchema,
  next: nextSchema,
});

export const updatePasswordSchema = z
  .object({
    password: newPasswordSchema,
    confirm: z.string(),
  })
  .refine((value) => value.password === value.confirm, {
    message: "The passwords don't match.",
    path: ["confirm"],
  });

export type SignInInput = z.input<typeof signInSchema>;
export type SignUpInput = z.input<typeof signUpSchema>;
export type EmailLinkInput = z.input<typeof emailLinkSchema>;
export type UpdatePasswordInput = z.input<typeof updatePasswordSchema>;

/** 0–4, used only for the meter. The rules above are what's enforced. */
export function passwordScore(password: string) {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^a-zA-Z0-9]/.test(password)) score += 1;
  else if (/[^a-zA-Z]/.test(password)) score += 0.5;
  return Math.min(4, Math.floor(score));
}
