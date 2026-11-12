import { describe, expect, it } from "vitest";

import {
  DEFAULT_OVERLAY_SETTINGS,
  OPACITY_MAX,
  OPACITY_MIN,
  parseOverlaySettings,
  parseWindowSettings,
} from "@/features/settings/overlay-settings";

describe("parseOverlaySettings", () => {
  it("範囲の外は端に寄せ、数でなければ既定値にする", () => {
    expect(parseOverlaySettings({ opacity: 75 })).toStrictEqual({ opacity: 75 });
    expect(parseOverlaySettings({ opacity: 5 })).toStrictEqual({ opacity: OPACITY_MIN });
    expect(parseOverlaySettings({ opacity: 500 })).toStrictEqual({ opacity: OPACITY_MAX });
    expect(parseOverlaySettings({ opacity: "80" })).toStrictEqual(DEFAULT_OVERLAY_SETTINGS);
    expect(parseOverlaySettings(null)).toStrictEqual(DEFAULT_OVERLAY_SETTINGS);
  });
});

describe("parseWindowSettings", () => {
  it("既定ではトレイに格納する（Rust の close_to_tray と同じ）", () => {
    expect(parseWindowSettings(null)).toStrictEqual({ closeToTray: true });
    expect(parseWindowSettings({ closeToTray: "no" })).toStrictEqual({ closeToTray: true });
    expect(parseWindowSettings({ closeToTray: false })).toStrictEqual({ closeToTray: false });
  });
});
