/**
 * Behaviour of the customer-facing conversation endpoint -- the public reply
 * thread on a ticket, as opposed to the internal notes beside it.
 *
 * This is one of the endpoints Section 15 requires to be rate limited, so
 * alongside the usual validation and error mapping there is a scenario that
 * actually exhausts the window and checks the 429 the UI has to survive.
 */
import { beforeEach, expect, vi } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { actors } from "@/test/actors";
import { setCurrentActor, signOut } from "@/test/session-mock";
import { jsonRequest, readResponse, routeContext } from "@/test/route-harness";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/rbac/errors";

vi.mock("@/lib/auth/session", () => import("@/test/session-mock"));
vi.mock("@/lib/tickets/ticket-service", () => ({ addConversationMessage: vi.fn() }));

const { addConversationMessage } = await import("@/lib/tickets/ticket-service");
const { POST } = await import("./route");

const TICKET_ID = "33333333-0000-4000-8000-000000000001";

/** The route's own limit: 20 messages per user per minute. */
const MESSAGES_PER_MINUTE = 20;

function sendMessage(body: Record<string, unknown>) {
  return readResponse(
    POST(
      jsonRequest(`/api/tickets/${TICKET_ID}/messages`, body),
      routeContext({ ticketId: TICKET_ID }),
    ),
  );
}

function savedMessage() {
  return { id: "message-1", ticketId: TICKET_ID } as unknown as Awaited<
    ReturnType<typeof addConversationMessage>
  >;
}

beforeEach(() => {
  vi.mocked(addConversationMessage).mockReset();
  signOut();
});

feature("Replying on a ticket's conversation", () => {
  scenario("An agent replies to the customer", async (s) => {
    const agent = await s.given("a signed-in department agent", () => {
      const actor = actors.departmentAgent();
      setCurrentActor(actor);
      return actor;
    });

    await s.and("the service accepts the message", () => {
      vi.mocked(addConversationMessage).mockResolvedValue(savedMessage());
    });

    const res = await s.when("they post a reply", () =>
      sendMessage({ version: 2, body: "We have ordered the replacement adapter." }),
    );

    await s.then("the request succeeds", () => expect(res.status).toBe(200));

    await s.and("the message is posted on that ticket as that agent", () => {
      expect(addConversationMessage).toHaveBeenCalledWith(
        expect.objectContaining({ userId: agent.userId }),
        {
          ticketId: TICKET_ID,
          version: 2,
          body: "We have ordered the replacement adapter.",
        },
      );
    });
  });

  scenario("Windows line endings are normalised before storage", async (s) => {
    await s.given("a signed-in customer", () => setCurrentActor(actors.customer()));

    await s.and("the service accepts the message", () => {
      vi.mocked(addConversationMessage).mockResolvedValue(savedMessage());
    });

    await s.when("a reply is pasted in with CRLF line breaks", () =>
      sendMessage({ version: 1, body: "  Still broken.\r\nSame error code.  " }),
    );

    await s.then("the stored message is trimmed with plain newlines", () => {
      expect(addConversationMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ body: "Still broken.\nSame error code." }),
      );
    });
  });

  scenario("The path decides which ticket is replied to, not the body", async (s) => {
    await s.given("a signed-in department agent", () =>
      setCurrentActor(actors.departmentAgent()),
    );

    await s.and("the service accepts the message", () => {
      vi.mocked(addConversationMessage).mockResolvedValue(savedMessage());
    });

    await s.when("the body names a different ticket than the URL", () =>
      sendMessage({
        ticketId: "33333333-0000-4000-8000-000000000999",
        version: 1,
        body: "Reply meant for this ticket.",
      }),
    );

    await s.then("the ticket from the URL is the one replied to", () => {
      expect(addConversationMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ ticketId: TICKET_ID }),
      );
    });
  });

  scenario.each([
    { payload: "an empty message", body: { version: 1, body: "" } },
    { payload: "a message of only whitespace", body: { version: 1, body: "  \n " } },
    {
      payload: "a message past the length limit",
      body: { version: 1, body: "x".repeat(5001) },
    },
    { payload: "no version", body: { body: "No version supplied." } },
  ])("A reply with $payload is rejected", async (example, s) => {
    await s.given("a signed-in department agent", () =>
      setCurrentActor(actors.departmentAgent()),
    );

    const res = await s.when("the request arrives", () => sendMessage(example.body));

    await s.then("the request is a bad request", () => expect(res.status).toBe(400));

    await s.and("nothing is posted", () =>
      expect(addConversationMessage).not.toHaveBeenCalled(),
    );
  });

  scenario("A flood of replies from one person is throttled", async (s) => {
    // A fresh actor means a fresh rate-limit bucket, so this scenario cannot
    // be tripped by -- or trip -- the others.
    await s.given("a signed-in agent who has sent nothing yet", () =>
      setCurrentActor(actors.departmentAgent()),
    );

    await s.and("the service accepts every message", () => {
      vi.mocked(addConversationMessage).mockResolvedValue(savedMessage());
    });

    await s.and("they have used the whole minute's allowance", async () => {
      for (let i = 0; i < MESSAGES_PER_MINUTE; i += 1) {
        const res = await sendMessage({ version: 1, body: `Reply ${i}` });
        expect(res.status).toBe(200);
      }
    });

    const res = await s.when("they send one more", () =>
      sendMessage({ version: 1, body: "One too many." }),
    );

    await s.then("the request is throttled", () => expect(res.status).toBe(429));

    await s.and("the response says when to try again", () => {
      expect(res.headers.get("Retry-After")).toBeTruthy();
    });

    await s.and("the extra message never reaches the service", () => {
      expect(addConversationMessage).toHaveBeenCalledTimes(MESSAGES_PER_MINUTE);
    });
  });

  scenario("Someone with no access to the ticket cannot reply", async (s) => {
    await s.given("a signed-in customer", () => setCurrentActor(actors.customer()));

    await s.and("the service refuses them", () => {
      vi.mocked(addConversationMessage).mockRejectedValue(
        new ForbiddenError("You cannot post on this ticket"),
      );
    });

    const res = await s.when("they attempt to reply", () =>
      sendMessage({ version: 1, body: "Let me in." }),
    );

    await s.then("the attempt is forbidden", () => expect(res.status).toBe(403));
  });

  scenario("A stale version loses to whoever posted first", async (s) => {
    await s.given("a signed-in department agent", () =>
      setCurrentActor(actors.departmentAgent()),
    );

    await s.and("the ticket has changed since it was loaded", () => {
      vi.mocked(addConversationMessage).mockRejectedValue(
        new ConflictError("Ticket was modified by someone else"),
      );
    });

    const res = await s.when("they submit against the version they had", () =>
      sendMessage({ version: 1, body: "Posting against a stale view." }),
    );

    await s.then("the attempt is refused as a conflict", () =>
      expect(res.status).toBe(409),
    );
  });

  scenario("Replying on an unknown ticket reports not found", async (s) => {
    await s.given("a signed-in department agent", () =>
      setCurrentActor(actors.departmentAgent()),
    );

    await s.and("no such ticket exists", () => {
      vi.mocked(addConversationMessage).mockRejectedValue(
        new NotFoundError("Ticket not found"),
      );
    });

    const res = await s.when("they attempt to reply", () =>
      sendMessage({ version: 1, body: "A reply on a ticket that is gone." }),
    );

    await s.then("the response is not found", () => expect(res.status).toBe(404));
  });

  scenario("An anonymous request is rejected", async (s) => {
    await s.given("nobody is signed in", () => signOut());

    const res = await s.when("a reply request arrives", () =>
      sendMessage({ version: 1, body: "An unauthenticated reply." }),
    );

    await s.then("the request is unauthenticated", () => expect(res.status).toBe(401));

    await s.and("nothing is posted", () =>
      expect(addConversationMessage).not.toHaveBeenCalled(),
    );
  });
});
