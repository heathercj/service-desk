import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

/**
 * Requires a live Postgres connection -- persists subscription state to
 * the generic AppSetting table (see SUBSCRIPTION_SETTING_KEY). graphFetch
 * itself is stubbed; this is about the payload this module sends and what
 * it persists, not about Graph's own behavior.
 */
vi.mock("@/lib/graph/client", () => ({ graphFetch: vi.fn() }));
const { graphFetch } = await import("@/lib/graph/client");
const { createGraphSubscription, renewGraphSubscription, SUBSCRIPTION_SETTING_KEY } =
  await import("./mailbox-subscription");

describe("mailbox-subscription integration", () => {
  beforeAll(async () => {
    await db.$connect();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    vi.mocked(graphFetch).mockReset();
    await db.appSetting.deleteMany({ where: { key: SUBSCRIPTION_SETTING_KEY } });
  });

  it("creates a subscription on the support mailbox's Inbox and stores its id/expiry", async () => {
    vi.mocked(graphFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ id: "sub-abc123" }),
    } as Response);

    const result = await createGraphSubscription();

    expect(result.id).toBe("sub-abc123");
    const [, init] = vi.mocked(graphFetch).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.changeType).toBe("created");
    expect(body.resource).toMatch(/mailFolders\('Inbox'\)\/messages/);

    const stored = await db.appSetting.findUniqueOrThrow({
      where: { key: SUBSCRIPTION_SETTING_KEY },
    });
    expect(stored.value).toMatchObject({ id: "sub-abc123" });
  });

  it("throws rather than silently storing bad state when Graph refuses the subscription", async () => {
    vi.mocked(graphFetch).mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "Forbidden",
    } as Response);

    await expect(createGraphSubscription()).rejects.toThrow(/403/);

    const stored = await db.appSetting.findUnique({
      where: { key: SUBSCRIPTION_SETTING_KEY },
    });
    expect(stored).toBeNull();
  });

  it("renews an existing subscription and updates the stored expiry", async () => {
    await db.appSetting.create({
      data: {
        key: SUBSCRIPTION_SETTING_KEY,
        value: { id: "sub-existing", expirationDateTime: "2020-01-01T00:00:00.000Z" },
      },
    });
    vi.mocked(graphFetch).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    await renewGraphSubscription("sub-existing");

    const [path, init] = vi.mocked(graphFetch).mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/subscriptions/sub-existing");
    expect(init.method).toBe("PATCH");

    const stored = await db.appSetting.findUniqueOrThrow({
      where: { key: SUBSCRIPTION_SETTING_KEY },
    });
    const value = stored.value as { id: string; expirationDateTime: string };
    expect(value.id).toBe("sub-existing");
    expect(new Date(value.expirationDateTime).getTime()).toBeGreaterThan(Date.now());
  });
});
