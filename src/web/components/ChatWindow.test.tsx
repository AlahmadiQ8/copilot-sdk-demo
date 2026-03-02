import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatWindow } from "./ChatWindow";
import type { Message } from "../types";

describe("ChatWindow", () => {
  it("shows empty state when no messages", () => {
    render(<ChatWindow messages={[]} isStreaming={false} />);
    expect(screen.getByText("Send a message to get started")).toBeInTheDocument();
  });

  it("renders user message", () => {
    const messages: Message[] = [
      { id: "1", role: "user", content: "Hello" },
    ];
    render(<ChatWindow messages={messages} isStreaming={false} />);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("renders assistant message", () => {
    const messages: Message[] = [
      { id: "1", role: "assistant", content: "Hi there!" },
    ];
    render(<ChatWindow messages={messages} isStreaming={false} />);
    expect(screen.getByText("Hi there!")).toBeInTheDocument();
  });

  it("renders error message", () => {
    const messages: Message[] = [
      { id: "1", role: "error", content: "Something went wrong" },
    ];
    render(<ChatWindow messages={messages} isStreaming={false} />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("applies correct CSS classes for message roles", () => {
    const messages: Message[] = [
      { id: "1", role: "user", content: "user msg" },
      { id: "2", role: "assistant", content: "assistant msg" },
      { id: "3", role: "error", content: "error msg" },
    ];
    const { container } = render(<ChatWindow messages={messages} isStreaming={false} />);
    expect(container.querySelector(".message.user")).toBeInTheDocument();
    expect(container.querySelector(".message.assistant")).toBeInTheDocument();
    expect(container.querySelector(".message.error")).toBeInTheDocument();
  });

  it("shows streaming class on last assistant message when streaming", () => {
    const messages: Message[] = [
      { id: "1", role: "user", content: "Hi" },
      { id: "2", role: "assistant", content: "Hel" },
    ];
    const { container } = render(<ChatWindow messages={messages} isStreaming={true} />);
    expect(container.querySelector(".message.assistant.streaming")).toBeInTheDocument();
  });

  it("does not show streaming class when not streaming", () => {
    const messages: Message[] = [
      { id: "1", role: "assistant", content: "Done" },
    ];
    const { container } = render(<ChatWindow messages={messages} isStreaming={false} />);
    expect(container.querySelector(".message.assistant.streaming")).not.toBeInTheDocument();
  });

  it("renders multiple messages in order", () => {
    const messages: Message[] = [
      { id: "1", role: "user", content: "First" },
      { id: "2", role: "assistant", content: "Second" },
      { id: "3", role: "user", content: "Third" },
    ];
    render(<ChatWindow messages={messages} isStreaming={false} />);
    const messageElements = screen.getAllByText(/First|Second|Third/);
    expect(messageElements).toHaveLength(3);
    expect(messageElements[0]).toHaveTextContent("First");
    expect(messageElements[1]).toHaveTextContent("Second");
    expect(messageElements[2]).toHaveTextContent("Third");
  });
});
