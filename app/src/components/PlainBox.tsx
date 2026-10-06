/**
 * A text box that takes plain text, and pictures from the keyboard.
 *
 * ── Why not a textarea ────────────────────────────────────────────────────
 *
 * The owner, 4 October 2026, with a screenshot of the Claude app beside one
 * of this one: the keyboard offered "Paste" with the copied screenshot over
 * the Claude box, and nothing over ours. Chrome on Android tells the
 * keyboard a box takes pictures only when the box is rich text
 * (`contenteditable`): a textarea is declared text only, so the keyboard
 * never offers a picture and long-press Paste only ever pastes words. On a
 * rich box the keyboard's picture arrives as an ordinary paste event with
 * the image as a file, which the panel already turns into an attachment.
 *
 * So this is a rich box that behaves as a plain one: what is typed or
 * pasted stays plain text, formatting never gets in, a pasted picture is
 * handed up as a file and never drawn inside the box, Enter sends and
 * Shift+Enter starts a new line, as in the textarea it replaces.
 *
 * ── On a phone, Enter is a new line ───────────────────────────────────────
 *
 * The owner, 6 October 2026: "the chat box is hard to use like it just
 * randomly send". A phone keyboard's Enter key sits beside the full stop
 * and the delete key, under the thumb, and it was a Send key: a half typed
 * message went the moment a thumb brushed it. With `enterSends` off the key
 * starts a new line, says so ("enter", not "send"), and only the Send button
 * sends, as in a phone's own messaging apps.
 */

import { useEffect, useLayoutEffect, useRef } from "react";

/** The text of the box, as typed: line breaks kept, the browser's own non-breaking spaces made plain. */
function textOf(el: HTMLElement): string {
  // `innerText` keeps the line breaks; a page without layout (a test) has only `textContent`.
  const text = (el.innerText ?? el.textContent ?? "").replace(/\u00a0/g, " ");
  // A box ends in one line break of its own, which is not a line the owner typed.
  return text.replace(/\n$/, "");
}

/** The caret after the last letter, where a box set from outside should leave it. */
function caretToEnd(el: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Words typed in, the way a keyboard types them, so undo still works. */
function insertPlain(text: string): void {
  if (!text) return;
  // Deprecated, and still the one way to insert text that the browser's own undo knows about.
  if (!document.execCommand("insertText", false, text)) {
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!range) return;
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    range.collapse(false);
  }
}

const hasFiles = (data: DataTransfer | null): boolean =>
  data !== null && (data.files.length > 0 || [...data.items].some((i) => i.kind === "file"));

export function PlainBox({
  value,
  onChange,
  onEnter,
  placeholder,
  label,
  disabled = false,
  enterSends = true,
  onFocus,
  className,
}: {
  readonly value: string;
  readonly onChange: (text: string) => void;
  /** Enter without Shift: send, when `enterSends`. */
  readonly onEnter: () => void;
  readonly placeholder: string;
  readonly label: string;
  readonly disabled?: boolean;
  /** False on a phone: Enter is a new line and only the Send button sends. */
  readonly enterSends?: boolean;
  readonly onFocus?: () => void;
  readonly className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const enter = useRef(onEnter);
  enter.current = onEnter;
  const sends = useRef(enterSends);
  sends.current = enterSends;

  /*
   * The box follows the value when it changes from outside: cleared after
   * sending, or filled by a starter. Typing changes the value from inside,
   * and then the box already says it, so nothing is touched and the caret
   * stays where the thumb put it.
   */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || textOf(el) === value) return;
    el.textContent = value;
    if (document.activeElement === el) caretToEnd(el);
  }, [value]);

  /*
   * Enter from a phone's keyboard comes as a request to start a paragraph,
   * often with no key event a page can read. It sends, as Enter does from
   * a computer's keyboard; a line break (Shift+Enter) is left to happen.
   */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const before = (e: InputEvent): void => {
      if (e.inputType !== "insertParagraph") return;
      e.preventDefault();
      if (sends.current) enter.current();
      // A line break, not a paragraph: the box holds one run of words.
      else if (!document.execCommand("insertLineBreak")) insertPlain("\n");
    };
    el.addEventListener("beforeinput", before);
    return () => el.removeEventListener("beforeinput", before);
  }, []);

  return (
    <div
      ref={ref}
      role="textbox"
      aria-multiline="true"
      aria-label={label}
      aria-placeholder={placeholder}
      aria-disabled={disabled || undefined}
      data-placeholder={placeholder}
      contentEditable={!disabled}
      suppressContentEditableWarning
      tabIndex={0}
      inputMode="text"
      enterKeyHint={enterSends ? "send" : "enter"}
      autoCapitalize="sentences"
      spellCheck
      className={className}
      onFocus={onFocus}
      onKeyDown={(e) => {
        if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
        e.preventDefault();
        if (!e.shiftKey && enterSends) onEnter();
        else if (!document.execCommand("insertLineBreak")) insertPlain("\n");
      }}
      onInput={(e) => {
        const el = e.currentTarget;
        // Anything that is not text or a line, a picture or a styled run, goes back to its words.
        if (/<(?!\/?(?:br|div)\b)/i.test(el.innerHTML)) {
          el.textContent = textOf(el);
          caretToEnd(el);
        }
        const text = textOf(el);
        // Emptied, it is truly empty, so the placeholder comes back.
        if (text === "" && el.innerHTML !== "") el.innerHTML = "";
        onChange(text);
      }}
      onPaste={(e) => {
        e.preventDefault();
        // A picture is the panel's to attach (it hears this paste next); never drawn in the box.
        if (hasFiles(e.clipboardData)) return;
        insertPlain(e.clipboardData.getData("text/plain"));
      }}
      onDrop={(e) => {
        if (hasFiles(e.dataTransfer)) return;
        e.preventDefault();
        insertPlain(e.dataTransfer.getData("text/plain"));
      }}
    />
  );
}
