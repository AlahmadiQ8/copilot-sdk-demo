import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageInput } from "./MessageInput";

describe("MessageInput", () => {
  let onSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onSend = vi.fn();
  });

  it("renders input and button", () => {
    render(<MessageInput onSend={onSend} disabled={false} />);
    expect(screen.getByPlaceholderText("Type a message...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
  });

  it("sends trimmed message on submit", async () => {
    const user = userEvent.setup();
    render(<MessageInput onSend={onSend} disabled={false} />);

    const input = screen.getByPlaceholderText("Type a message...");
    await user.type(input, "  Hello world  ");
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(onSend).toHaveBeenCalledWith("Hello world");
  });

  it("clears input after send", async () => {
    const user = userEvent.setup();
    render(<MessageInput onSend={onSend} disabled={false} />);

    const input = screen.getByPlaceholderText("Type a message...");
    await user.type(input, "Hello");
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(input).toHaveValue("");
  });

  it("does not send empty/whitespace message", async () => {
    const user = userEvent.setup();
    render(<MessageInput onSend={onSend} disabled={false} />);

    const input = screen.getByPlaceholderText("Type a message...");
    await user.type(input, "   ");
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(onSend).not.toHaveBeenCalled();
  });

  it("disables input and button when disabled prop is true", () => {
    render(<MessageInput onSend={onSend} disabled={true} />);

    expect(screen.getByPlaceholderText("Type a message...")).toBeDisabled();
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });

  it("sends on Enter key", async () => {
    const user = userEvent.setup();
    render(<MessageInput onSend={onSend} disabled={false} />);

    const input = screen.getByPlaceholderText("Type a message...");
    await user.type(input, "Hello{enter}");

    expect(onSend).toHaveBeenCalledWith("Hello");
  });
});
