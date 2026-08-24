/**
 * Behaviour of the retrieval-only knowledge assistant (Section 6) -- the
 * front door of the deflection path: a customer with a familiar problem gets
 * the published article instead of opening a ticket.
 *
 * `fetch` is stubbed so these scenarios describe the widget's own behaviour:
 * what it asks /api/chat, what it renders back, and that it always leaves an
 * escape hatch to raise a ticket. What the endpoint answers is covered by
 * the route and provider specs.
 */
import { afterEach, beforeEach, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { feature, scenario } from "@/test/bdd";
import { ChatWidget } from "./chat-widget";

interface ChatReply {
  answerText: string;
  citations?: Array<{ articleId: string; title: string; internalUrl: string }>;
}

const fetchMock = vi.fn();

/** Queues one reply for the next /api/chat call. */
function replyWith(reply: ChatReply) {
  fetchMock.mockResolvedValueOnce({ json: async () => reply });
}

/** Opens the widget and returns its question box. */
async function openWidget() {
  render(<ChatWidget />);
  await userEvent.click(
    screen.getByRole("button", { name: "Ask the knowledge assistant" }),
  );
  return screen.getByPlaceholderText("e.g. How do I reset my VPN?");
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

feature("Knowledge assistant", () => {
  scenario("It stays collapsed until a customer asks for it", async (s) => {
    await s.given("a customer on a page offering the assistant", () => {
      render(<ChatWidget />);
    });

    await s.then("only an invitation to open it is shown", () => {
      expect(
        screen.getByRole("button", { name: "Ask the knowledge assistant" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByPlaceholderText("e.g. How do I reset my VPN?"),
      ).not.toBeInTheDocument();
    });
  });

  scenario("Opening it says up front where answers come from", async (s) => {
    await s.given("a collapsed assistant");

    await s.when("the customer opens it", () => openWidget());

    await s.then("it is titled as the knowledge assistant", () => {
      expect(screen.getByText("Knowledge assistant")).toBeInTheDocument();
    });

    await s.and("it discloses that answers come only from published articles", () => {
      expect(screen.getByText(/only from published articles/i)).toBeInTheDocument();
    });

    await s.and("raising a ticket instead is offered from the start", () => {
      expect(
        screen.getByRole("link", { name: /create a ticket instead/i }),
      ).toHaveAttribute("href", "/tickets/new");
    });
  });

  scenario("A customer's question is answered with its sources", async (s) => {
    const box = await s.given("an open assistant", () => openWidget());

    await s.and("a published article covers the question", () =>
      replyWith({
        answerText: "Reset your VPN profile from the self-service portal.",
        citations: [
          {
            articleId: "kb-1",
            title: "Resetting your VPN profile",
            internalUrl: "/knowledge/kb-1",
          },
        ],
      }),
    );

    await s.when("they ask how to reset their VPN", async () => {
      await userEvent.type(box, "How do I reset my VPN?");
      await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    });

    await s.then("the question is sent to the chat endpoint as JSON", () => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/chat");
      expect(init.method).toBe("POST");
      expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
      expect(JSON.parse(String(init.body))).toEqual({
        question: "How do I reset my VPN?",
      });
    });

    await s.and("their own question is echoed back in the transcript", async () => {
      expect(await screen.findByText("You: How do I reset my VPN?")).toBeInTheDocument();
    });

    await s.and("the answer is shown", () => {
      expect(
        screen.getByText("Reset your VPN profile from the self-service portal."),
      ).toBeInTheDocument();
    });

    await s.and("the article it came from is linked, so the claim is checkable", () => {
      expect(
        screen.getByRole("link", { name: "Resetting your VPN profile" }),
      ).toHaveAttribute("href", "/knowledge/kb-1");
    });

    await s.and("the box is cleared, ready for a follow-up", () => {
      expect(box).toHaveValue("");
    });
  });

  scenario("Pressing Enter asks the question", async (s) => {
    const box = await s.given("an open assistant", () => openWidget());

    await s.and("an answer is waiting", () => replyWith({ answerText: "Try this." }));

    await s.when("the customer types and presses Enter", async () => {
      await userEvent.type(box, "Printer offline{Enter}");
    });

    await s.then("the question was asked", () => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(String(init.body))).toEqual({ question: "Printer offline" });
    });
  });

  scenario(
    "An answer with no sources is shown without an empty source line",
    async (s) => {
      const box = await s.given("an open assistant", () => openWidget());

      await s.and("no article matches the question", () =>
        replyWith({
          answerText: "I don't have an article covering that.",
          citations: [],
        }),
      );

      await s.when("the customer asks it anyway", async () => {
        await userEvent.type(box, "What is my ticket status?{Enter}");
      });

      await s.then("the assistant says it does not know", async () => {
        expect(
          await screen.findByText("I don't have an article covering that."),
        ).toBeInTheDocument();
      });

      await s.and("no sources are claimed", () => {
        expect(screen.queryByText(/^Sources:/)).not.toBeInTheDocument();
      });
    },
  );

  scenario.each([
    { label: "an empty box", typed: "" },
    { label: "only whitespace", typed: "   " },
  ])("Asking with $label does not call the endpoint", async ({ typed }, s) => {
    const box = await s.given("an open assistant", () => openWidget());

    await s.when(
      `the customer submits ${typed === "" ? "nothing" : "whitespace"}`,
      async () => {
        if (typed) await userEvent.type(box, typed);
        await userEvent.click(screen.getByRole("button", { name: "Ask" }));
      },
    );

    await s.then("no request is made", () => {
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  scenario("A question in flight cannot be asked twice", async (s) => {
    const box = await s.given("an open assistant", () => openWidget());

    let release: (value: { json: () => Promise<ChatReply> }) => void = () => {};
    await s.and("an endpoint that has not answered yet", () => {
      fetchMock.mockImplementationOnce(
        () => new Promise((resolve) => (release = resolve)),
      );
    });

    await s.when(
      "the customer asks, then clicks again while it is in flight",
      async () => {
        await userEvent.type(box, "VPN down");
        await userEvent.click(screen.getByRole("button", { name: "Ask" }));
        await userEvent.click(screen.getByRole("button", { name: "Asking..." }));
      },
    );

    await s.then("only one request was made", () => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    await s.and("the button reports that it is asking", () => {
      expect(screen.getByRole("button", { name: "Asking..." })).toBeDisabled();
    });

    await s.when("the answer arrives", async () => {
      await act(async () => {
        release({ json: async () => ({ answerText: "Restart the client." }) });
      });
    });

    await s.then("it is shown and the widget is ready again", async () => {
      expect(await screen.findByText("Restart the client.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Ask" })).toBeEnabled();
    });
  });

  scenario("Closing it returns to the collapsed invitation", async (s) => {
    await s.given("an open assistant", () => openWidget());

    await s.when("the customer closes it", () =>
      userEvent.click(screen.getByRole("button", { name: "Close" })),
    );

    await s.then("only the invitation remains", () => {
      expect(
        screen.getByRole("button", { name: "Ask the knowledge assistant" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByPlaceholderText("e.g. How do I reset my VPN?"),
      ).not.toBeInTheDocument();
    });
  });
});
