import MarkdownIt from 'markdown-it';

const markdown = new MarkdownIt({ html: false, linkify: false, breaks: true });
// Do not let untrusted model or user text trigger remote image requests in the admin browser.
markdown.renderer.rules.image = (tokens, index) =>
  markdown.utils.escapeHtml(tokens[index].content);
const renderLink = markdown.renderer.rules.link_open;
markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  tokens[index].attrSet('target', '_blank');
  tokens[index].attrSet('rel', 'noopener noreferrer');
  return renderLink
    ? renderLink(tokens, index, options, env, renderer)
    : renderer.renderToken(tokens, index, options);
};
export function renderSafeMarkdown(text: string) {
  return markdown.render(text);
}
