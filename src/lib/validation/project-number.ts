/**
 * Project-number format validation (Section 6: "Validate project-number
 * format through a replaceable validator").
 *
 * The prototype assumes Alair-style project numbers such as "2026-0142" or
 * "PRJ-2026-0142". This is intentionally isolated behind a single function
 * so a real project-numbering scheme can be swapped in without touching
 * form or service code.
 */

const PROJECT_NUMBER_PATTERN = /^(?:PRJ-)?\d{4}-\d{3,6}$/i;

export interface ProjectNumberValidator {
  (value: string): { ok: boolean; reason?: string };
}

export const defaultProjectNumberValidator: ProjectNumberValidator = (value) => {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, reason: "Project number is required" };
  if (trimmed.length > 32) return { ok: false, reason: "Project number is too long" };
  if (!PROJECT_NUMBER_PATTERN.test(trimmed)) {
    return {
      ok: false,
      reason: 'Project number must look like "2026-0142" or "PRJ-2026-0142"',
    };
  }
  return { ok: true };
};

let activeValidator: ProjectNumberValidator = defaultProjectNumberValidator;

export function setProjectNumberValidator(validator: ProjectNumberValidator): void {
  activeValidator = validator;
}

export function validateProjectNumber(value: string): { ok: boolean; reason?: string } {
  return activeValidator(value);
}
