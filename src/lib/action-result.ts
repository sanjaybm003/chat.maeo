export type FieldErrors = Partial<Record<string, string>>;

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: FieldErrors };

export function ok(): ActionResult<undefined>;
export function ok<T>(data: T): ActionResult<T>;
export function ok<T>(data?: T): ActionResult<T | undefined> {
  return { ok: true, data };
}

export function fail(error: string, fieldErrors?: FieldErrors): { ok: false; error: string; fieldErrors?: FieldErrors } {
  return { ok: false, error, fieldErrors };
}

/** Turns zod issues into { field: firstMessage }. */
export function toFieldErrors(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join(".") || "form";
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}
