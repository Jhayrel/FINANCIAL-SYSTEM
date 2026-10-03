/**
 * Whether the owner is moving through the app with the keyboard, so the
 * focus ring shows for that and not for a press.
 *
 * 3 October 2026: long-pressing Dashboard in the menu left a green ring
 * round it. The browser shows `:focus-visible` on the next thing pressed
 * after any key, and a long press's menu closed with Esc, or a message
 * typed in the chat, was enough. Tab, Shift+Tab and the arrow keys outside
 * a text field mean the keyboard is moving focus; a press of the mouse, a
 * finger or a pen means it is not. `base.css` reads the mark.
 */
const TYPING = 'input, textarea, select, [contenteditable="true"]';

export function initInputModality(): void {
  const root = document.documentElement;
  const set = (how: "keyboard" | "pointer"): void => {
    if (root.dataset["input"] !== how) root.dataset["input"] = how;
  };
  window.addEventListener("pointerdown", () => set("pointer"), true);
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Tab") return set("keyboard");
      const target = e.target as Element | null;
      if (/^Arrow|^Home$|^End$/.test(e.key) && !target?.closest(TYPING)) set("keyboard");
    },
    true,
  );
}
