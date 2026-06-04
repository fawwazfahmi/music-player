// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ClickWheel } from "@/components/ipod/ClickWheel";

describe("ClickWheel", () => {
  it("emits scroll on ArrowDown / ArrowUp", () => {
    const onEvent = vi.fn();
    const { container } = render(<ClickWheel onEvent={onEvent} />);
    const wheel = container.querySelector('[data-testid="clickwheel"]')!;
    (wheel as HTMLElement).focus();
    fireEvent.keyDown(wheel, { key: "ArrowDown" });
    fireEvent.keyDown(wheel, { key: "ArrowUp" });
    expect(onEvent).toHaveBeenCalledWith({ type: "scroll", delta: 1 });
    expect(onEvent).toHaveBeenCalledWith({ type: "scroll", delta: -1 });
  });

  it("emits select on Enter, menu on Escape, playPause on Space", () => {
    const onEvent = vi.fn();
    const { container } = render(<ClickWheel onEvent={onEvent} />);
    const wheel = container.querySelector('[data-testid="clickwheel"]')!;
    (wheel as HTMLElement).focus();
    fireEvent.keyDown(wheel, { key: "Enter" });
    fireEvent.keyDown(wheel, { key: "Escape" });
    fireEvent.keyDown(wheel, { key: " " });
    expect(onEvent).toHaveBeenCalledWith({ type: "select" });
    expect(onEvent).toHaveBeenCalledWith({ type: "menu" });
    expect(onEvent).toHaveBeenCalledWith({ type: "playPause" });
  });

  it("emits scroll on mouse wheel", () => {
    const onEvent = vi.fn();
    const { container } = render(<ClickWheel onEvent={onEvent} />);
    const wheel = container.querySelector('[data-testid="clickwheel"]')!;
    fireEvent.wheel(wheel, { deltaY: 100 });
    fireEvent.wheel(wheel, { deltaY: -100 });
    expect(onEvent).toHaveBeenCalledWith({ type: "scroll", delta: 1 });
    expect(onEvent).toHaveBeenCalledWith({ type: "scroll", delta: -1 });
  });

  it("emits menu/next/playPause/prev on cardinal taps", () => {
    const onEvent = vi.fn();
    const { container } = render(<ClickWheel onEvent={onEvent} />);
    container.querySelector('[data-zone="menu"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    container.querySelector('[data-zone="next"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    container.querySelector('[data-zone="playPause"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    container.querySelector('[data-zone="prev"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    container.querySelector('[data-zone="select"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onEvent).toHaveBeenCalledWith({ type: "menu" });
    expect(onEvent).toHaveBeenCalledWith({ type: "next" });
    expect(onEvent).toHaveBeenCalledWith({ type: "playPause" });
    expect(onEvent).toHaveBeenCalledWith({ type: "prev" });
    expect(onEvent).toHaveBeenCalledWith({ type: "select" });
  });
});
