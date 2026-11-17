import type { ValidationIssue } from "./types.js";

export class ModelValidationError extends TypeError {
  constructor(readonly issues: readonly ValidationIssue[]) {
    super("Model validation failed");
    this.name = "ModelValidationError";
  }
}
