import { beforeEach, describe, expect, it } from "vitest";
import { useIpodStore } from "@/stores/ipod-store";

describe("ipod-store", () => {
  beforeEach(() => {
    useIpodStore.setState({ navStack: [{ name: "home" }] });
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
});
