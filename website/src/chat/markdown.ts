import { Marked, Renderer, type Tokens } from "marked";
import { safeUrl } from "../catalog.ts";
function escape(value: string) {
  return value.replace(
    /[&<>"']/gu,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}
const renderer = new Renderer();
renderer.html = () => "";
renderer.image = ({ text }: Tokens.Image) => escape(text);
renderer.link = function ({ href, tokens }: Tokens.Link) {
  const text = this.parser.parseInline(tokens),
    url = safeUrl(href);
  return url
    ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${text}</a>`
    : text;
};
const defaultTable = renderer.table;
renderer.table = function (token: Tokens.Table) {
  return `<div class="chat-markdown-table">${defaultTable.call(this, token)}</div>`;
};
const markdown = new Marked({
  renderer,
  gfm: true,
  breaks: true,
  async: false,
});
// A pure Markdown parser; the Vue renderer always sanitizes this HTML before displaying it.
export function parseMarkdown(text: string): string {
  return markdown.parse(text, { async: false });
}
