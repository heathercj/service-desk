/**
 * Behaviour of the confirmation dialog used for disruptive actions
 * (Section 18: transfer, cancel, close, archive) and for the resolution
 * article approval beat.
 *
 * jsdom 25 does not implement <dialog>'s modal methods, so showModal/close
 * are stubbed to toggle the `open` attribute -- the same state the real
 * element exposes. Focus trapping and Escape are the browser's job and are
 * covered by the e2e suite, not here.
 */
import { beforeAll, expect, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { feature, scenario } from "@/test/bdd";
import { ConfirmDialog, type ConfirmDialogHandle } from "./confirm-dialog";

beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.open = false;
    };
  }
});

/** Renders the dialog and hands back its imperative handle. */
function renderDialog(props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  const ref = React.createRef<ConfirmDialogHandle>();
  const onConfirm = props.onConfirm ?? vi.fn();
  render(
    <ConfirmDialog
      ref={ref}
      title={props.title ?? "Publish this article?"}
      description={props.description ?? "It becomes visible to every customer."}
      confirmLabel={props.confirmLabel}
      destructive={props.destructive}
      onConfirm={onConfirm}
    />,
  );
  const dialog = screen.getByRole("dialog", { hidden: true }) as HTMLDialogElement;
  return { ref, dialog, onConfirm };
}

feature("Confirming a disruptive action", () => {
  scenario("The dialog stays out of the way until it is opened", async (s) => {
    const { dialog } = await s.given("a page holding a confirmation dialog", () =>
      renderDialog(),
    );

    await s.then("it is closed", () => {
      expect(dialog.open).toBe(false);
    });
  });

  scenario("Opening it states what is about to happen", async (s) => {
    const { ref, dialog } = await s.given("a dialog for publishing an article", () =>
      renderDialog({
        title: "Publish this article?",
        description: "It becomes visible to every customer.",
      }),
    );

    await s.when("the action is triggered", () => {
      ref.current?.open();
    });

    await s.then("the dialog is open", () => {
      expect(dialog.open).toBe(true);
    });

    await s.and("it names the action and its consequence", () => {
      expect(
        screen.getByRole("heading", { name: "Publish this article?" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText("It becomes visible to every customer."),
      ).toBeInTheDocument();
    });

    await s.and("it is labelled by its own title for a screen reader", () => {
      expect(dialog).toHaveAttribute("aria-labelledby", "confirm-dialog-title");
    });
  });

  scenario("Confirming performs the action and closes the dialog", async (s) => {
    const { dialog, onConfirm } = await s.given("an open confirmation dialog", () => {
      const rendered = renderDialog({ confirmLabel: "Publish" });
      rendered.ref.current?.open();
      return rendered;
    });

    await s.when("the user confirms", () =>
      userEvent.click(screen.getByRole("button", { name: "Publish" })),
    );

    await s.then("the action runs exactly once", () => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    await s.and("the dialog closes itself", () => {
      expect(dialog.open).toBe(false);
    });
  });

  scenario("Cancelling closes the dialog and does nothing else", async (s) => {
    const { dialog, onConfirm } = await s.given("an open confirmation dialog", () => {
      const rendered = renderDialog();
      rendered.ref.current?.open();
      return rendered;
    });

    await s.when("the user cancels", () =>
      userEvent.click(screen.getByRole("button", { name: "Cancel" })),
    );

    await s.then("the action never runs", () => {
      expect(onConfirm).not.toHaveBeenCalled();
    });

    await s.and("the dialog closes", () => {
      expect(dialog.open).toBe(false);
    });
  });

  scenario("A slow action cannot be double-submitted", async (s) => {
    let release: () => void = () => {};
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    const { dialog } = await s.given(
      "an open dialog over an action that takes a while",
      () => {
        const rendered = renderDialog({ onConfirm, confirmLabel: "Publish" });
        rendered.ref.current?.open();
        return rendered;
      },
    );

    await s.when(
      "the user confirms and then clicks again while it is in flight",
      async () => {
        await userEvent.click(screen.getByRole("button", { name: "Publish" }));
        await userEvent.click(screen.getByRole("button", { name: "Working..." }));
      },
    );

    await s.then("the action was only started once", () => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    await s.and("the button reports that work is under way", () => {
      expect(screen.getByRole("button", { name: "Working..." })).toBeDisabled();
    });

    await s.when("the action finishes", async () => {
      await act(async () => {
        release();
      });
    });

    await s.then("the dialog closes", async () => {
      await waitFor(() => expect(dialog.open).toBe(false));
    });
  });

  scenario("A destructive action is styled as one", async (s) => {
    await s.given("a dialog for cancelling a ticket", () => {
      const rendered = renderDialog({
        title: "Cancel this ticket?",
        confirmLabel: "Cancel ticket",
        destructive: true,
      });
      rendered.ref.current?.open();
    });

    await s.then("its confirm button carries the destructive tint", () => {
      expect(screen.getByRole("button", { name: "Cancel ticket" })).toHaveClass(
        "bg-destructive",
      );
    });
  });

  scenario("A caller can close the dialog programmatically", async (s) => {
    const { ref, dialog } = await s.given("an open confirmation dialog", () => {
      const rendered = renderDialog();
      rendered.ref.current?.open();
      return rendered;
    });

    await s.when("the page closes it itself", () => {
      ref.current?.close();
    });

    await s.then("the dialog is closed", () => {
      expect(dialog.open).toBe(false);
    });
  });
});
