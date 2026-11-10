import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { CopyLinkButton } from "@/features/library/viewer/CopyLinkButton";

const URL_TEXT = "https://gjzkcal.github.io/field-medic-manual/doc/hemorrhage";

let writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;

beforeEach(() => {
  writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
  // jsdom には Clipboard API が無い
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  vi.stubGlobal("isSecureContext", true);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "clipboard");
});

function renderButton(): void {
  render(
    <TooltipProvider>
      <CopyLinkButton url={URL_TEXT} label="このマニュアル" />
    </TooltipProvider>,
  );
}

describe("CopyLinkButton", () => {
  it("押すと URL を写し、画面と読み上げにコピーしたことを出して、少し経つと消す", async () => {
    renderButton();
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "このマニュアルへのリンクをコピー" }));
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith(URL_TEXT);
    expect(screen.getByRole("status").textContent).toBe("リンクをコピーしました");
    expect(document.querySelector("[data-slot=tooltip-content]")?.textContent).toBe(
      "リンクをコピーしました",
    );

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("写せなかったときは、理由を画面と読み上げ（alert）で伝える", async () => {
    writeText.mockRejectedValue(new DOMException("Document is not focused.", "NotAllowedError"));
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "このマニュアルへのリンクをコピー" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(
        "リンクをコピーできませんでした: NotAllowedError: Document is not focused.",
      );
    });
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("secure context でない（http の LAN で開いた Web 版）ときは、https で開くよう伝える", async () => {
    vi.stubGlobal("isSecureContext", false);
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "このマニュアルへのリンクをコピー" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("https で開いてください");
    });
    expect(writeText).not.toHaveBeenCalled();
  });
});
