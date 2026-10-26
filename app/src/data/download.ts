/**
 * A file handed to this device's own downloads, and nowhere else.
 *
 * One place for it: the Statements screen had its own, and the Activity
 * screen's PDF needs the same (26 October 2026).
 */
export function saveFile(name: string, data: BlobPart, type: string): void {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked a moment later: a phone can still be reading it when click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
