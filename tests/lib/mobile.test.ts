import { describe, expect, it } from "vitest";
import {
  LEARNED_AFTER,
  isIOSDevice,
  isMenuButtonPref,
  isStandaloneDisplay,
  safariMajorVersion,
  shareMenuLocation,
  shouldShowInstallHint,
  shouldShowLongPressTip,
  shouldShowMenuButton,
  type NavigatorLike,
} from "@/lib/mobile";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
// iPadOS 13+ deliberately reports itself as a Mac. This exact string is why
// the maxTouchPoints check exists.
const IPAD_AS_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const MAC_DESKTOP = IPAD_AS_MAC;
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36";

function nav(userAgent: string, maxTouchPoints = 0, standalone?: boolean): NavigatorLike {
  return { userAgent, maxTouchPoints, standalone };
}

const noMatch = () => ({ matches: false });
const match = () => ({ matches: true });

describe("isIOSDevice", () => {
  it("detects iPhone", () => {
    expect(isIOSDevice(nav(IPHONE, 5))).toBe(true);
  });

  it("detects an iPad that claims to be a Mac", () => {
    expect(isIOSDevice(nav(IPAD_AS_MAC, 5))).toBe(true);
  });

  it("does NOT match a real Mac", () => {
    // Same UA as the iPad above — only the touch-point count separates them.
    // Getting this wrong shows an iOS install hint on every desktop.
    expect(isIOSDevice(nav(MAC_DESKTOP, 0))).toBe(false);
  });

  it("does not match Android", () => {
    expect(isIOSDevice(nav(ANDROID, 5))).toBe(false);
  });
});

describe("isStandaloneDisplay", () => {
  it("trusts the legacy iOS navigator.standalone flag", () => {
    expect(isStandaloneDisplay(nav(IPHONE, 5, true), noMatch)).toBe(true);
  });

  it("trusts the display-mode media query", () => {
    expect(isStandaloneDisplay(nav(IPHONE, 5), match)).toBe(true);
  });

  it("is false in a plain browser tab", () => {
    expect(isStandaloneDisplay(nav(IPHONE, 5), noMatch)).toBe(false);
  });

  it("survives a missing or throwing matchMedia", () => {
    expect(isStandaloneDisplay(nav(IPHONE, 5), undefined)).toBe(false);
    expect(
      isStandaloneDisplay(nav(IPHONE, 5), () => {
        throw new Error("no matchMedia");
      }),
    ).toBe(false);
  });
});

describe("shouldShowInstallHint", () => {
  it("shows on an iPhone in Safari that hasn't dismissed it", () => {
    expect(
      shouldShowInstallHint({ nav: nav(IPHONE, 5), matchMedia: noMatch, dismissed: false }),
    ).toBe(true);
  });

  it("hides once installed", () => {
    expect(
      shouldShowInstallHint({ nav: nav(IPHONE, 5), matchMedia: match, dismissed: false }),
    ).toBe(false);
  });

  it("hides once dismissed", () => {
    expect(
      shouldShowInstallHint({ nav: nav(IPHONE, 5), matchMedia: noMatch, dismissed: true }),
    ).toBe(false);
  });

  it("never shows on desktop or Android", () => {
    expect(
      shouldShowInstallHint({ nav: nav(MAC_DESKTOP, 0), matchMedia: noMatch, dismissed: false }),
    ).toBe(false);
    expect(
      shouldShowInstallHint({ nav: nav(ANDROID, 5), matchMedia: noMatch, dismissed: false }),
    ).toBe(false);
  });
});

describe("shareMenuLocation", () => {
  // Verified on an iPhone 13 running iOS 26.5: the Safari toolbar is
  // back / URL / reload / ···, with no share glyph. Share is inside the ···
  // menu. Telling her to "tap Share" points at a button that isn't there.
  it("sends iOS 26 through the overflow menu", () => {
    expect(shareMenuLocation(nav(IPHONE.replace("Version/17.5", "Version/26.0"), 5))).toBe(
      "overflow",
    );
  });

  it("keeps the toolbar path for iOS 17 and 18", () => {
    expect(shareMenuLocation(nav(IPHONE, 5))).toBe("toolbar");
    expect(shareMenuLocation(nav(IPHONE.replace("Version/17.5", "Version/18.2"), 5))).toBe(
      "toolbar",
    );
  });

  it("assumes the newer path when the version is unreadable", () => {
    expect(shareMenuLocation(nav("Mozilla/5.0 (iPhone)", 5))).toBe("overflow");
  });
});

describe("safariMajorVersion", () => {
  it("reads the Version token, which an iPad-as-Mac still carries", () => {
    expect(safariMajorVersion(nav(IPAD_AS_MAC, 5))).toBe(17);
    expect(safariMajorVersion(nav(IPHONE, 5))).toBe(17);
  });

  it("returns null when there is no version to read", () => {
    expect(safariMajorVersion(nav("Mozilla/5.0 (iPhone)", 5))).toBeNull();
  });
});

describe("shouldShowMenuButton", () => {
  it("retires the button only after LEARNED_AFTER long-presses", () => {
    for (let i = 0; i < LEARNED_AFTER; i++) {
      expect(shouldShowMenuButton("until-learned", i)).toBe(true);
    }
    expect(shouldShowMenuButton("until-learned", LEARNED_AFTER)).toBe(false);
    expect(shouldShowMenuButton("until-learned", LEARNED_AFTER + 10)).toBe(false);
  });

  it("honours the explicit preferences regardless of count", () => {
    expect(shouldShowMenuButton("always", 0)).toBe(true);
    expect(shouldShowMenuButton("always", 99)).toBe(true);
    expect(shouldShowMenuButton("never", 0)).toBe(false);
    expect(shouldShowMenuButton("never", 99)).toBe(false);
  });
});

describe("shouldShowLongPressTip", () => {
  it("never teaches a gesture that doesn't apply", () => {
    expect(shouldShowLongPressTip("until-learned", 0, false)).toBe(false);
  });

  it("teaches until learned, then stops", () => {
    expect(shouldShowLongPressTip("until-learned", 0, true)).toBe(true);
    expect(shouldShowLongPressTip("until-learned", LEARNED_AFTER, true)).toBe(false);
  });

  it("keeps teaching while the button is pinned on, since she may not know why it's there", () => {
    expect(shouldShowLongPressTip("always", 0, true)).toBe(true);
  });

  it("stays quiet when she has opted out of the button entirely", () => {
    expect(shouldShowLongPressTip("never", 0, true)).toBe(false);
  });
});

describe("isMenuButtonPref", () => {
  it("accepts the three known values and rejects junk from storage", () => {
    expect(isMenuButtonPref("always")).toBe(true);
    expect(isMenuButtonPref("until-learned")).toBe(true);
    expect(isMenuButtonPref("never")).toBe(true);
    expect(isMenuButtonPref("sometimes")).toBe(false);
    expect(isMenuButtonPref(null)).toBe(false);
    expect(isMenuButtonPref(3)).toBe(false);
  });
});
