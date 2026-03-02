import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useService } from "./useService";

// Helper to create a mock ReadableStream from SSE chunks
function createSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

describe("useService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts with empty messages and not loading", () => {
    const { result } = renderHook(() => useService());
    expect(result.current.messages).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it("adds user and assistant messages on send", async () => {
    const stream = createSSEStream([
      'data: {"content":"Hello"}\n\n',
      "data: [DONE]\n\n",
    ]);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    const { result } = renderHook(() => useService());

    await act(async () => {
      await result.current.sendMessage("Hi");
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0].role).toBe("user");
    expect(result.current.messages[0].content).toBe("Hi");
    expect(result.current.messages[1].role).toBe("assistant");
    expect(result.current.messages[1].content).toBe("Hello");
  });

  it("handles cross-chunk SSE buffering", async () => {
    // Split a JSON payload across two chunks
    const stream = createSSEStream([
      'data: {"content":"He',
      'llo"}\n\ndata: [DONE]\n\n',
    ]);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    const { result } = renderHook(() => useService());

    await act(async () => {
      await result.current.sendMessage("test");
    });

    expect(result.current.messages[1].content).toBe("Hello");
  });

  it("handles server error response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Internal Server Error", { status: 500 }),
    );

    const { result } = renderHook(() => useService());

    await act(async () => {
      await result.current.sendMessage("test");
    });

    expect(result.current.messages[1].role).toBe("error");
    expect(result.current.messages[1].content).toContain("500");
  });

  it("handles network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network failure"));

    const { result } = renderHook(() => useService());

    await act(async () => {
      await result.current.sendMessage("test");
    });

    expect(result.current.messages[1].role).toBe("error");
    expect(result.current.messages[1].content).toContain("Network failure");
  });

  it("shows (empty response) when no content streamed", async () => {
    const stream = createSSEStream(["data: [DONE]\n\n"]);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    const { result } = renderHook(() => useService());

    await act(async () => {
      await result.current.sendMessage("test");
    });

    expect(result.current.messages[1].content).toBe("(empty response)");
  });

  it("sets isLoading during request", async () => {
    let resolveStream: () => void;
    const streamPromise = new Promise<void>((resolve) => {
      resolveStream = resolve;
    });

    const stream = new ReadableStream({
      async start(controller) {
        await streamPromise;
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    const { result } = renderHook(() => useService());

    let sendPromise: Promise<void>;
    act(() => {
      sendPromise = result.current.sendMessage("test");
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(true);
    });

    await act(async () => {
      resolveStream!();
      await sendPromise!;
    });

    expect(result.current.isLoading).toBe(false);
  });

  it("passes abort signal to fetch", async () => {
    const stream = createSSEStream(["data: [DONE]\n\n"]);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    const { result } = renderHook(() => useService());

    await act(async () => {
      await result.current.sendMessage("test");
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/chat",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("handles SSE error events from server", async () => {
    const stream = createSSEStream([
      'event: error\ndata: {"error":"model overloaded"}\n\n',
    ]);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    const { result } = renderHook(() => useService());

    await act(async () => {
      await result.current.sendMessage("test");
    });

    // The error event data is on a line starting with "data:" so it gets parsed
    // but the current implementation only checks lines starting with "data: " 
    // after "event: error" — since the parser checks data lines only,
    // the error JSON should be caught and thrown
    expect(result.current.messages[1].role).toBe("error");
    expect(result.current.messages[1].content).toContain("model overloaded");
  });

  it("aborts first request when sending a second message", async () => {
    let firstResolve: () => void;
    const firstStream = new ReadableStream<Uint8Array>({
      start(controller) {
        // This stream blocks until we resolve
        firstResolve = () => {
          controller.enqueue(new TextEncoder().encode('data: {"content":"first"}\n\ndata: [DONE]\n\n'));
          controller.close();
        };
      },
    });

    const secondStream = createSSEStream([
      'data: {"content":"second"}\n\n',
      "data: [DONE]\n\n",
    ]);

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    // First call returns the blocking stream
    fetchSpy.mockResolvedValueOnce(
      new Response(firstStream, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    );
    // Second call returns the fast stream
    fetchSpy.mockResolvedValueOnce(
      new Response(secondStream, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    );

    const { result } = renderHook(() => useService());

    // Start first request (don't await — it blocks)
    act(() => {
      result.current.sendMessage("first question");
    });

    // Send second message which should abort the first
    await act(async () => {
      await result.current.sendMessage("second question");
    });

    // Resolve the first stream to let cleanup happen
    firstResolve!();

    // Should have 4 messages: user1, assistant1, user2, assistant2
    // The second assistant message should have "second" content
    expect(result.current.isLoading).toBe(false);
    const lastAssistant = result.current.messages.filter(m => m.role === "assistant").pop();
    expect(lastAssistant?.content).toBe("second");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
