import "server-only";

/**
 * A problem the model can fix by calling a tool differently, or should tell
 * the person about. Its message goes back to the model as the tool result.
 */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}
