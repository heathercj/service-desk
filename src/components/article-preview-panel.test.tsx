/**
 * Behaviour of the ticket-form knowledge preview panel (Section 6): reading
 * a suggested article's full content inline, without leaving the ticket
 * being filled out. `fetch` is stubbed so this describes the panel's own
 * behaviour -- what it asks for and renders -- not the route underneath.
 */
import { afterEach, beforeEach, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { feature, scenario } from "@/test/bdd";
import { ArticlePreviewPanel } from "./article-preview-panel";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

function replyWith(article: {
  title: string;
  summary: string;
  departmentName: string;
  body: string;
}) {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => article });
}

feature("Ticket-form knowledge article preview", () => {
  scenario("Nothing renders while no article is selected", async (s) => {
    await s.given("the panel with no articleId", () => {
      render(<ArticlePreviewPanel articleId={null} onClose={vi.fn()} />);
    });

    await s.then("no dialog is shown", () => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    await s.and("no request is made", () => {
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  scenario("Selecting an article fetches and displays it inline", async (s) => {
    await s.given("the article will be returned", () =>
      replyWith({
        title: "Resetting your VPN client",
        summary: "Steps to reset a stuck VPN profile.",
        departmentName: "Technology Support",
        body: "## Steps\n\n1. Sign out. 2. Sign back in.",
      }),
    );

    await s.when("the panel opens for that article", () => {
      render(<ArticlePreviewPanel articleId="article-1" onClose={vi.fn()} />);
    });

    await s.then("the title, department, summary, and body render", async () => {
      await waitFor(() =>
        expect(screen.getByText("Resetting your VPN client")).toBeInTheDocument(),
      );
      expect(screen.getByText("Technology Support")).toBeInTheDocument();
      expect(screen.getByText("Steps to reset a stuck VPN profile.")).toBeInTheDocument();
      expect(screen.getByText(/Sign out/)).toBeInTheDocument();
    });

    await s.and("it requested that article", () => {
      expect(fetchMock).toHaveBeenCalledWith("/api/knowledge/articles/article-1");
    });
  });

  scenario("Closing the panel calls onClose", async (s) => {
    const onClose = vi.fn();
    await s.given("an open panel", () => {
      replyWith({
        title: "Resetting your VPN client",
        summary: "Steps to reset a stuck VPN profile.",
        departmentName: "Technology Support",
        body: "Body text",
      });
      render(<ArticlePreviewPanel articleId="article-1" onClose={onClose} />);
    });

    await s.when("the customer closes it", async () => {
      await waitFor(() => screen.getByRole("button", { name: "Close" }));
      await userEvent.click(screen.getByRole("button", { name: "Close" }));
    });

    await s.then("onClose fires", () => expect(onClose).toHaveBeenCalled());
  });

  scenario("A failed fetch shows an error instead of stale content", async (s) => {
    await s.given("the request will fail", () => {
      fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    });

    await s.when("the panel opens for that article", () => {
      render(<ArticlePreviewPanel articleId="article-1" onClose={vi.fn()} />);
    });

    await s.then("an error is shown", async () => {
      await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    });
  });

  scenario("A deflect action is offered and calls onDeflect when clicked", async (s) => {
    const onDeflect = vi.fn();
    await s.given("an open panel with a deflect handler", () => {
      replyWith({
        title: "Resetting your VPN client",
        summary: "Steps to reset a stuck VPN profile.",
        departmentName: "Technology Support",
        body: "Body text",
      });
      render(
        <ArticlePreviewPanel
          articleId="article-1"
          onClose={vi.fn()}
          onDeflect={onDeflect}
        />,
      );
    });

    await s.when("the customer says it solved their issue", async () => {
      await waitFor(() => screen.getByRole("button", { name: "This solved it" }));
      await userEvent.click(screen.getByRole("button", { name: "This solved it" }));
    });

    await s.then("onDeflect fires", () => expect(onDeflect).toHaveBeenCalled());
  });
});
