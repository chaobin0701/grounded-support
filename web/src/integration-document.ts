import MarkdownIt from 'markdown-it';

const markdown = new MarkdownIt({ html: false, linkify: false, breaks: false });
markdown.renderer.rules.image = (tokens, index) => markdown.utils.escapeHtml(tokens[index].content);
markdown.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
  if (!String(tokens[index].attrGet('href') ?? '').startsWith('#')) {
    tokens[index].attrSet('target', '_blank');
    tokens[index].attrSet('rel', 'noopener noreferrer');
  }
  return renderer.renderToken(tokens, index, options);
};
// Tables, like code, scroll within the reader instead of widening the mobile page.
markdown.renderer.rules.table_open = () => '<div class="doc-table-scroll" tabindex="0" role="region" aria-label="接口说明表格"><table>\n';
markdown.renderer.rules.table_close = () => '</table></div>\n';

export function renderIntegrationDocument(source: string) {
  const tokens = markdown.parse(source, {});
  const sections: { id: string; title: string }[] = [];
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index].type === 'heading_open' && tokens[index].tag === 'h2') {
      const section = { id: `section-${sections.length + 1}`, title: tokens[index + 1]?.content ?? '' };
      tokens[index].attrSet('id', section.id);
      sections.push(section);
    }
  }
  return { html: markdown.renderer.render(tokens, markdown.options, {}), sections };
}
