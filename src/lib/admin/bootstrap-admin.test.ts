import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError, NotFoundError } from "@/lib/rbac/errors";

/**
 * Unit-tested (mocked db) rather than against the integration suite's
 * shared Postgres: that database always has leftover Administrator
 * UserRole rows from every other integration test's history, so "zero
 * Administrators exist yet" -- the one precondition this function's whole
 * safety property hinges on -- is a state that database can never be in.
 */
vi.mock("@/lib/db", () => ({
  db: {
    userRole: { count: vi.fn(), create: vi.fn() },
    user: { findFirst: vi.fn() },
    role: { findUnique: vi.fn() },
  },
}));

const { db } = await import("@/lib/db");
const { bootstrapFirstAdministrator } = await import("./bootstrap-admin");

const ADMIN_EMAIL = "admin@alairhomes.com";

beforeEach(() => {
  vi.mocked(db.userRole.count).mockReset();
  vi.mocked(db.userRole.create).mockReset();
  vi.mocked(db.user.findFirst).mockReset();
  vi.mocked(db.role.findUnique).mockReset();
});

describe("bootstrapFirstAdministrator", () => {
  it("grants ADMINISTRATOR when no Administrator exists yet and the user has signed in", async () => {
    vi.mocked(db.userRole.count).mockResolvedValue(0);
    vi.mocked(db.user.findFirst).mockResolvedValue({
      id: "user-1",
      email: ADMIN_EMAIL,
      displayName: "Real Person",
    } as never);
    vi.mocked(db.role.findUnique).mockResolvedValue({ id: "role-1" } as never);

    const result = await bootstrapFirstAdministrator(ADMIN_EMAIL);

    expect(result).toMatchObject({ userId: "user-1", email: ADMIN_EMAIL });
    expect(db.userRole.create).toHaveBeenCalledWith({
      data: { userId: "user-1", roleId: "role-1" },
    });
  });

  it("refuses once an Administrator already exists, without granting", async () => {
    vi.mocked(db.userRole.count).mockResolvedValue(1);

    await expect(bootstrapFirstAdministrator(ADMIN_EMAIL)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(db.userRole.create).not.toHaveBeenCalled();
  });

  it("refuses a user who has never signed in, without granting", async () => {
    vi.mocked(db.userRole.count).mockResolvedValue(0);
    vi.mocked(db.user.findFirst).mockResolvedValue(null);

    await expect(bootstrapFirstAdministrator(ADMIN_EMAIL)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(db.userRole.create).not.toHaveBeenCalled();
  });

  it("refuses when the ADMINISTRATOR role row itself isn't seeded yet", async () => {
    vi.mocked(db.userRole.count).mockResolvedValue(0);
    vi.mocked(db.user.findFirst).mockResolvedValue({
      id: "user-1",
      email: ADMIN_EMAIL,
      displayName: "Real Person",
    } as never);
    vi.mocked(db.role.findUnique).mockResolvedValue(null);

    await expect(bootstrapFirstAdministrator(ADMIN_EMAIL)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(db.userRole.create).not.toHaveBeenCalled();
  });
});
