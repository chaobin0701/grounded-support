export const MAX_COMPOSER_LINES = 10;

/** Measure rendered text, including soft wrapping; do not count newline characters. */
export function resizeComposer(
  textarea: HTMLElement,
  readStyle: (element: Element) => CSSStyleDeclaration = getComputedStyle,
): boolean {
  const style = readStyle(textarea);
  const lineHeight = Number.parseFloat(style.lineHeight) || 24;
  const padding = (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0);
  const minHeight = lineHeight + padding;
  const maxHeight = lineHeight * MAX_COMPOSER_LINES + padding;
  const scrollTop = textarea.scrollTop;
  // Reset first so deleting text, sending and changing conversations can shrink it.
  textarea.style.height = "0px";
  const height = Math.min(maxHeight, Math.max(minHeight, textarea.scrollHeight));
  textarea.style.height = `${height}px`;
  // The viewport cap may be smaller than ten lines, e.g. with a mobile keyboard.
  const overflowing = textarea.scrollHeight > textarea.clientHeight + 1;
  textarea.style.overflowY = overflowing ? "auto" : "hidden";
  textarea.scrollTop = overflowing ? scrollTop : 0;
  return height <= minHeight + 1;
}
