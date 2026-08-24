/**
 * The shared contract of the form and surface primitives.
 *
 * These are thin wrappers around native elements, so testing every variant
 * class would just restate the source. What is worth pinning is the contract
 * the rest of the app relies on and that a refactor could quietly break:
 * they render the right native element, they forward refs, a caller's
 * className is merged rather than dropped, disabled and aria-invalid states
 * reach the DOM, and a Label associates with its control.
 */
import { expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import Link from "next/link";
import { feature, scenario } from "@/test/bdd";
import { Badge } from "./badge";
import { Button } from "./button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "./card";
import { Input } from "./input";
import { Label } from "./label";
import { Select } from "./select";
import { Textarea } from "./textarea";

feature("Form primitives", () => {
  scenario(
    "A label is wired to its control, so clicking it focuses the field",
    async (s) => {
      await s.given("a labelled text field", () => {
        render(
          <>
            <Label htmlFor="subject">Subject</Label>
            <Input id="subject" />
          </>,
        );
      });

      await s.when("the user clicks the label", () =>
        userEvent.click(screen.getByText("Subject")),
      );

      await s.then("the field is focused and findable by its label", () => {
        expect(screen.getByLabelText("Subject")).toHaveFocus();
      });
    },
  );

  scenario.each([
    { name: "Input", role: "textbox" },
    { name: "Textarea", role: "textbox" },
    { name: "Select", role: "combobox" },
  ])("$name renders a real form control a user can drive", async ({ name, role }, s) => {
    await s.given(`a ${name}`, () => {
      if (name === "Input") render(<Input aria-label="field" />);
      if (name === "Textarea") render(<Textarea aria-label="field" />);
      if (name === "Select")
        render(
          <Select aria-label="field">
            <option value="a">A</option>
          </Select>,
        );
    });

    await s.then(`it exposes the ${role} role`, () => {
      expect(screen.getByRole(role, { name: "field" })).toBeInTheDocument();
    });
  });

  scenario.each([
    { name: "Input", tag: "INPUT" },
    { name: "Textarea", tag: "TEXTAREA" },
    { name: "Select", tag: "SELECT" },
    { name: "Button", tag: "BUTTON" },
  ])("$name forwards its ref to the underlying <$tag>", async ({ name, tag }, s) => {
    const ref = React.createRef<HTMLElement>();

    await s.given(`a ${name} with a ref`, () => {
      const r = ref as React.Ref<never>;
      if (name === "Input") render(<Input ref={r} />);
      if (name === "Textarea") render(<Textarea ref={r} />);
      if (name === "Select") render(<Select ref={r} />);
      if (name === "Button") render(<Button ref={r}>Go</Button>);
    });

    await s.then("the ref points at the DOM node", () => {
      expect(ref.current?.tagName).toBe(tag);
    });
  });

  scenario(
    "An invalid field is marked for assistive technology, not just tinted",
    async (s) => {
      const field = await s.given("a field the form marked invalid", () => {
        render(<Input aria-label="Email" aria-invalid />);
        return screen.getByRole("textbox", { name: "Email" });
      });

      await s.then("the invalid state is on the element itself", () => {
        expect(field).toHaveAttribute("aria-invalid", "true");
      });

      await s.and("the destructive border rule is present to render it", () => {
        expect(field).toHaveClass("aria-invalid:border-destructive");
      });
    },
  );

  scenario.each([{ name: "Input" }, { name: "Textarea" }, { name: "Select" }])(
    "A disabled $name refuses input",
    async ({ name }, s) => {
      await s.given(`a disabled ${name}`, () => {
        if (name === "Input") render(<Input aria-label="field" disabled />);
        if (name === "Textarea") render(<Textarea aria-label="field" disabled />);
        if (name === "Select") render(<Select aria-label="field" disabled />);
      });

      const field = await s.and("it is found by its label", () =>
        screen.getByRole(name === "Select" ? "combobox" : "textbox", { name: "field" }),
      );

      await s.when("the user tries to focus it", () => userEvent.click(field));

      await s.then("it is disabled and never takes focus", () => {
        expect(field).toBeDisabled();
        expect(field).not.toHaveFocus();
      });
    },
  );
});

feature("Button", () => {
  scenario("A disabled button swallows clicks", async (s) => {
    const onClick = vi.fn();

    const button = await s.given("a disabled button", () => {
      render(
        <Button disabled onClick={onClick}>
          Resolve
        </Button>,
      );
      return screen.getByRole("button", { name: "Resolve" });
    });

    await s.when("the user clicks it", () => userEvent.click(button));

    await s.then("nothing happens", () => {
      expect(onClick).not.toHaveBeenCalled();
    });
  });

  scenario("asChild renders the child element, styled as a button", async (s) => {
    const link = await s.given("a button wrapping a link", () => {
      render(
        <Button asChild variant="link">
          <Link href="/tickets/new">Create a ticket</Link>
        </Button>,
      );
      return screen.getByRole("link", { name: "Create a ticket" });
    });

    await s.then("no nested button element is produced", () => {
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    await s.and("the anchor carries the button's styling", () => {
      expect(link).toHaveClass("text-primary");
      expect(link).toHaveAttribute("href", "/tickets/new");
    });
  });

  scenario("A caller's className is merged, not dropped", async (s) => {
    const button = await s.given("a button given an extra class", () => {
      render(<Button className="w-full">Submit</Button>);
      return screen.getByRole("button", { name: "Submit" });
    });

    await s.then("both the variant styling and the caller's class survive", () => {
      expect(button).toHaveClass("w-full");
      expect(button).toHaveClass("bg-primary");
    });
  });
});

feature("Surfaces", () => {
  scenario("A card composes into a titled, described panel", async (s) => {
    await s.given("a card with every slot filled", () => {
      render(
        <Card>
          <CardHeader>
            <CardTitle>Ticket SD-1042</CardTitle>
            <CardDescription>Opened two days ago</CardDescription>
          </CardHeader>
          <CardContent>VPN will not connect.</CardContent>
          <CardFooter>Resolve</CardFooter>
        </Card>,
      );
    });

    await s.then("the title is a heading, so the page outline is usable", () => {
      expect(screen.getByRole("heading", { name: "Ticket SD-1042" })).toBeInTheDocument();
    });

    await s.and("the description and body read as written", () => {
      expect(screen.getByText("Opened two days ago")).toBeInTheDocument();
      expect(screen.getByText("VPN will not connect.")).toBeInTheDocument();
      expect(screen.getByText("Resolve")).toBeInTheDocument();
    });
  });

  scenario(
    "A badge defaults to the primary tint when no variant is asked for",
    async (s) => {
      const badge = await s.given("a badge with no variant", () => {
        render(<Badge>New</Badge>);
        return screen.getByText("New");
      });

      await s.then("it renders in the default tint", () => {
        expect(badge).toHaveClass("bg-primary");
      });
    },
  );
});
