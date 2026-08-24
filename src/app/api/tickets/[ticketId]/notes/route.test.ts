/**
 * Behaviour of the internal-note endpoint -- the desk-only side of a ticket's
 * conversation, which customers must never see.
 *
 * Who may read or write a note is enforced in the ticket service; the route
 * owns the note's shape (non-empty, normalised, bounded), the ticket id
 * coming from the path, and the error -> status mapping.
 */
import { beforeEach, expect, vi } from "vitest";
import { feature, scenario } from "@/test/bdd";
import { actors } from "@/test/actors";
import { setCurrentActor, signOut } from "@/test/session-mock";
import { jsonRequest, readResponse, routeContext } from "@/test/route-harness";
import { ForbiddenError, NotFoundError } from "@/lib/rbac/errors";

vi.mock("@/lib/auth/session", () => import("@/test/session-mock"));
vi.mock("@/lib/tickets/ticket-service", () => ({ addInternalNote: vi.fn() }));

const { addInternalNote } = await import("@/lib/tickets/ticket-service");
const { POST } = await import("./route");

const TICKET_ID = "33333333-0000-4000-8000-000000000001";

function addNote(body: Record<string, unknown>) {
  return readResponse(
    POST(
      jsonRequest(`/api/tickets/${TICKET_ID}/notes`, body),
      routeContext({ ticketId: TICKET_ID }),
    ),
  );
}

function savedNote() {
  return { id: "note-1", ticketId: TICKET_ID } as unknown as Awaited<
    ReturnType<typeof addInternalNote>
  >;
}

beforeEach(() => {
  vi.mocked(addInternalNote).mockReset();
  signOut();
});

feature("Adding an internal note to a ticket", () => {
  scenario("An agent leaves a note for the rest of the desk", async (s) => {
    const agent = await s.given("a signed-in department agent", () => {
      const actor = actors.departmentAgent();
      setCurrentActor(actor);
      return actor;
    });

    await s.and("the service accepts the note", () => {
      vi.mocked(addInternalNote).mockResolvedValue(savedNote());
    });

    const res = await s.when("they add a note", () =>
      addNote({ body: "Vendor ticket VN-4412 raised; they answer within a day." }),
    );

    await s.then("the request succeeds", () => expect(res.status).toBe(200));

    await s.and("the note is recorded on that ticket as that agent", () => {
      expect(addInternalNote).toHaveBeenCalledWith(
        expect.objectContaining({ userId: agent.userId }),
        {
          ticketId: TICKET_ID,
          body: "Vendor ticket VN-4412 raised; they answer within a day.",
        },
      );
    });
  });

  scenario("Windows line endings are normalised before storage", async (s) => {
    await s.given("a signed-in department agent", () =>
      setCurrentActor(actors.departmentAgent()),
    );

    await s.and("the service accepts the note", () => {
      vi.mocked(addInternalNote).mockResolvedValue(savedNote());
    });

    await s.when("a note is pasted in with CRLF line breaks", () =>
      addNote({ body: "  Called the vendor.\r\nAwaiting a callback.  " }),
    );

    await s.then("the stored note is trimmed with plain newlines", () => {
      expect(addInternalNote).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ body: "Called the vendor.\nAwaiting a callback." }),
      );
    });
  });

  scenario("The path decides which ticket is annotated, not the body", async (s) => {
    await s.given("a signed-in department agent", () =>
      setCurrentActor(actors.departmentAgent()),
    );

    await s.and("the service accepts the note", () => {
      vi.mocked(addInternalNote).mockResolvedValue(savedNote());
    });

    await s.when("the body names a different ticket than the URL", () =>
      addNote({
        ticketId: "33333333-0000-4000-8000-000000000999",
        body: "Note meant for this ticket.",
      }),
    );

    await s.then("the ticket from the URL is the one annotated", () => {
      expect(addInternalNote).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ ticketId: TICKET_ID }),
      );
    });
  });

  scenario.each([
    { payload: "no body at all", body: {} },
    { payload: "an empty note", body: { body: "" } },
    { payload: "a note of only whitespace", body: { body: "   \n  " } },
    { payload: "a note past the length limit", body: { body: "x".repeat(5001) } },
  ])("A note with $payload is rejected", async (example, s) => {
    await s.given("a signed-in department agent", () =>
      setCurrentActor(actors.departmentAgent()),
    );

    const res = await s.when("the request arrives", () => addNote(example.body));

    await s.then("the request is a bad request", () => expect(res.status).toBe(400));

    await s.and("nothing is recorded", () =>
      expect(addInternalNote).not.toHaveBeenCalled(),
    );
  });

  scenario("A customer cannot leave an internal note", async (s) => {
    await s.given("a signed-in customer", () => setCurrentActor(actors.customer()));

    await s.and("the service refuses them", () => {
      vi.mocked(addInternalNote).mockRejectedValue(
        new ForbiddenError("You cannot add internal notes"),
      );
    });

    const res = await s.when("they attempt to add a note", () =>
      addNote({ body: "Can I see the internal thread?" }),
    );

    await s.then("the attempt is forbidden", () => expect(res.status).toBe(403));
  });

  scenario("Annotating an unknown ticket reports not found", async (s) => {
    await s.given("a signed-in department agent", () =>
      setCurrentActor(actors.departmentAgent()),
    );

    await s.and("no such ticket exists", () => {
      vi.mocked(addInternalNote).mockRejectedValue(new NotFoundError("Ticket not found"));
    });

    const res = await s.when("they attempt to add a note", () =>
      addNote({ body: "A note on a ticket that is gone." }),
    );

    await s.then("the response is not found", () => expect(res.status).toBe(404));
  });

  scenario("An anonymous request is rejected", async (s) => {
    await s.given("nobody is signed in", () => signOut());

    const res = await s.when("a note request arrives", () =>
      addNote({ body: "An unauthenticated note." }),
    );

    await s.then("the request is unauthenticated", () => expect(res.status).toBe(401));

    await s.and("nothing is recorded", () =>
      expect(addInternalNote).not.toHaveBeenCalled(),
    );
  });
});
