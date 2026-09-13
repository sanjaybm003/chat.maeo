"use client";

import { useCallback, useState, useTransition } from "react";

import type { ActionResult, FieldErrors } from "@/lib/action-result";
import { getErrorMessage } from "@/lib/errors";

/**
 * Calls a server action with typed input and tracks pending, error and field
 * errors. Server actions still validate everything themselves.
 */
export function useServerAction<Input, Output>(action: (input: Input) => Promise<ActionResult<Output>>) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const run = useCallback(
    (input: Input) =>
      new Promise<ActionResult<Output>>((resolve) => {
        setError(null);
        setFieldErrors({});
        startTransition(async () => {
          try {
            const result = await action(input);
            if (!result.ok) {
              setError(result.error);
              setFieldErrors(result.fieldErrors ?? {});
            }
            resolve(result);
          } catch (caught) {
            const message = getErrorMessage(caught);
            setError(message);
            resolve({ ok: false, error: message });
          }
        });
      }),
    [action],
  );

  const reset = useCallback(() => {
    setError(null);
    setFieldErrors({});
  }, []);

  return { run, pending, error, fieldErrors, reset };
}
