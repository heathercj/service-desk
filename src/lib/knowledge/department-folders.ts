// Computed rather than a hand-maintained map: departments are created at
// runtime by administrators (Section: self-service departments), so a
// fixed lookup table can't know about one that didn't exist at deploy
// time. The transform is deterministic and reversible for any key shaped
// by `departmentKeySchema` (uppercase, digits, underscores only).
//
// Whether a given key/folder actually corresponds to a *real* department
// is a question for the database, not this module -- callers that need
// that guarantee (creating a KB article, validating the knowledge-base/
// folder layout in CI) resolve it themselves via `requireActiveDepartment`
// or a direct query, the same "shape here, reality at the service layer"
// split used throughout department handling.

export function departmentKeyToFolder(key: string): string {
  return key.toLowerCase().replace(/_/g, "-");
}

export function folderToDepartmentKey(folder: string): string {
  return folder.toUpperCase().replace(/-/g, "_");
}

export function isKnownDepartmentFolder(folder: string): boolean {
  return /^[a-z0-9-]+$/.test(folder);
}
