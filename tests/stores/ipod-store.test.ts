import { beforeEach, describe, expect, it } from "vitest";
import { useIpodStore } from "@/stores/ipod-store";

describe("ipod-store", () => {
  beforeEach(() => {
    useIpodStore.setState({ navStack: [{ name: "home" }], selectionByScreen: {} });
  });

  it("starts with home on the stack", () => {
    expect(useIpodStore.getState().navStack).toHaveLength(1);
    expect(useIpodStore.getState().navStack[0]).toEqual({ name: "home" });
  });

  it("push() adds a screen", () => {
    useIpodStore.getState().push({ name: "musicSub" });
    expect(useIpodStore.getState().navStack).toHaveLength(2);
    expect(useIpodStore.getState().current().name).toBe("musicSub");
  });

  it("pop() removes the top, but never empties below home", () => {
    useIpodStore.getState().push({ name: "musicSub" });
    useIpodStore.getState().pop();
    expect(useIpodStore.getState().current().name).toBe("home");
    useIpodStore.getState().pop();
    expect(useIpodStore.getState().current().name).toBe("home");
  });

  it("toRoot() resets to home", () => {
    useIpodStore.getState().push({ name: "musicSub" });
    useIpodStore.getState().push({ name: "artistList" });
    useIpodStore.getState().toRoot();
    expect(useIpodStore.getState().navStack).toEqual([{ name: "home" }]);
  });

  it("getSelectionFor returns 0 for unseen screens", () => {
    expect(useIpodStore.getState().getSelectionFor({ name: "musicSub" })).toBe(0);
  });

  it("setSelectionFor / getSelectionFor round-trip", () => {
    useIpodStore.getState().setSelectionFor({ name: "musicSub" }, 2);
    expect(useIpodStore.getState().getSelectionFor({ name: "musicSub" })).toBe(2);
  });

  it("different parametric screens have separate selections", () => {
    useIpodStore.getState().setSelectionFor({ name: "artistDetail", artistId: "a" }, 3);
    useIpodStore.getState().setSelectionFor({ name: "artistDetail", artistId: "b" }, 7);
    expect(useIpodStore.getState().getSelectionFor({ name: "artistDetail", artistId: "a" })).toBe(3);
    expect(useIpodStore.getState().getSelectionFor({ name: "artistDetail", artistId: "b" })).toBe(7);
  });
});
