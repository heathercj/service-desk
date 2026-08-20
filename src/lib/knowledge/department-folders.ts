const KEY_TO_FOLDER: Record<string, string> = {
  TECHNOLOGY_SUPPORT: "technology-support",
  TRAINING: "training",
  ACCOUNTING_SERVICES: "accounting-services",
  MARKETING: "marketing",
  LEGAL: "legal",
};

const FOLDER_TO_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(KEY_TO_FOLDER).map(([key, folder]) => [folder, key]),
);

export function departmentKeyToFolder(key: string): string {
  const folder = KEY_TO_FOLDER[key];
  if (!folder) throw new Error(`Unknown department key: ${key}`);
  return folder;
}

export function folderToDepartmentKey(folder: string): string {
  const key = FOLDER_TO_KEY[folder];
  if (!key) throw new Error(`Unknown department folder: ${folder}`);
  return key;
}

export function isKnownDepartmentFolder(folder: string): boolean {
  return folder in FOLDER_TO_KEY;
}
