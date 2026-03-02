import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTheme } from "./useTheme";

describe("useTheme", () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    localStorage.clear();
    window.matchMedia = originalMatchMedia;
  });

  it("defaults to light when no preference and system is light", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");
  });

  it("uses stored theme from localStorage", () => {
    localStorage.setItem("theme", "light");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");
  });

  it("uses system dark preference when no stored value", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;

    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
  });

  it("toggles theme from dark to light", () => {
    localStorage.setItem("theme", "dark");
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.toggleTheme();
    });

    expect(result.current.theme).toBe("light");
  });

  it("toggles theme from light to dark", () => {
    localStorage.setItem("theme", "light");
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.toggleTheme();
    });

    expect(result.current.theme).toBe("dark");
  });

  it("persists theme to localStorage", () => {
    localStorage.setItem("theme", "dark");
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.toggleTheme();
    });

    expect(localStorage.getItem("theme")).toBe("light");
  });

  it("sets data-theme attribute on documentElement", () => {
    localStorage.setItem("theme", "dark");
    renderHook(() => useTheme());
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
