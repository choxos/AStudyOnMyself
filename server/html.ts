// HTML built with template literals. Every interpolated value is escaped unless
// it is itself an Html fragment, so user text (notes, tags) can never inject markup.

export class Html {
  value: string;
  constructor(value: string) {
    this.value = value;
  }
  toString(): string {
    return this.value;
  }
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export const escapeHtml = (value: unknown): string => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);

function render(value: unknown): string {
  if (value instanceof Html) return value.value;
  if (Array.isArray(value)) return value.map(render).join("");
  if (value === null || value === undefined || value === false) return "";
  return escapeHtml(value);
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let out = strings[0];
  values.forEach((value, i) => {
    out += render(value) + strings[i + 1];
  });
  return new Html(out);
}

/** Trusted markup only: never pass user input here. */
export const raw = (markup: string): Html => new Html(markup);

/** Data for page scripts, safe inside <script> (like Django's json_script). */
export function jsonScript(id: string, data: unknown): Html {
  const json = JSON.stringify(data ?? null)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
  return raw(`<script type="application/json" id="${escapeHtml(id)}">${json}</script>`);
}
