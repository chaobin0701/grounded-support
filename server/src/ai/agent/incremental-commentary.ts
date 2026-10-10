import { publicCommentary } from './model-response';

/** A bounded JSON-string decoder. Only the sole top-level commentary field is public. */
export class IncrementalCommentary {
  private raw = '';
  private emitted = '';
  private blocked = false;

  constructor(private readonly privateNames: readonly string[] = []) {}

  push(delta: string): string {
    if (this.blocked) return '';
    this.raw += delta;
    if (this.raw.length > 4096) { this.blocked = true; return ''; }
    let index = 0;
    const whitespace = () => { while (/\s/u.test(this.raw[index] ?? '') && index < this.raw.length) index++; };
    whitespace();
    if (this.raw[index++] !== '{') return '';
    whitespace();
    const key = readString(this.raw, index);
    if (!key.closed || key.text !== 'commentary') return '';
    index = key.end;
    whitespace();
    if (this.raw[index++] !== ':') return '';
    whitespace();
    const value = readString(this.raw, index);
    if (value.invalid) { this.blocked = true; return ''; }
    if (value.closed) {
      index = value.end;
      whitespace();
      // Additional protocol or reasoning fields are never part of public copy.
      if (this.raw[index] && this.raw[index] !== '}') { this.blocked = true; return ''; }
    }
    let text = value.text;
    // Hold unfinished ASCII identifiers so split secret/protocol names are not leaked.
    if (!value.closed) text = text.replace(/[\x21-\x7e]+$/u, '');
    if (!text) return '';
    if (!publicCommentary(text) || this.privateNames.some(name => text.includes(name))) { this.blocked = true; return ''; }
    if (text.length > 160) { this.blocked = true; return ''; }
    const next = text.slice(this.emitted.length);
    this.emitted = text;
    return next;
  }
}

function readString(raw: string, start: number): { text: string; end: number; closed: boolean; invalid: boolean } {
  let text = '', index = start;
  if (raw[index++] !== '"') return { text, end: index, closed: false, invalid: false };
  for (; index < raw.length; index++) {
    let char = raw[index];
    if (char === '"') return { text, end: index + 1, closed: true, invalid: false };
    if (char < ' ') return { text, end: index, closed: false, invalid: true };
    if (char === '\\') {
      const escape = raw[++index];
      if (!escape) break;
      const simple: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
      if (escape === 'u') {
        const digits = raw.slice(index + 1, index + 5);
        if (digits.length < 4) break;
        if (!/^[a-f0-9]{4}$/iu.test(digits)) return { text, end: index, closed: false, invalid: true };
        char = String.fromCharCode(parseInt(digits, 16));
        index += 4;
      } else if (simple[escape] !== undefined) char = simple[escape];
      else return { text, end: index, closed: false, invalid: true };
    }
    text += char;
  }
  // Never publish half of a surrogate pair across a network fragment.
  text = text.replace(/[\ud800-\udbff]$/u, '');
  return { text, end: index, closed: false, invalid: false };
}
