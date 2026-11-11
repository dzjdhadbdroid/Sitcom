// Assainissement du HTML exporté par Google Docs avant affichage. Liste blanche stricte : tout ce qui n'y figure pas
// est supprimé (scripts, styles, formulaires, iframes, gestionnaires d'événements, liens vers l'extérieur…).
const ALLOWED_TAGS = new Set([
  'P', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'SUB', 'SUP', 'SPAN', 'DIV',
  'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'BLOCKQUOTE', 'PRE', 'CODE', 'HR', 'IMG', 'A',
]);
const DROP_WITH_CONTENT = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'LINK', 'META', 'SVG', 'MATH', 'TEMPLATE', 'NOSCRIPT', 'HEAD', 'TITLE', 'BASE']);
const IMG_HOST = /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\//i;

export function sanitizeDocHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = document.implementation.createHTMLDocument('');
  const root = out.createElement('div');

  const copy = (node: Node, into: Node) => {
    if (node.nodeType === Node.TEXT_NODE) { into.appendChild(out.createTextNode(node.textContent ?? '')); return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (DROP_WITH_CONTENT.has(tag)) return;
    if (!ALLOWED_TAGS.has(tag)) { for (const c of Array.from(el.childNodes)) copy(c, into); return; } // on garde le texte, pas la balise
    if (tag === 'IMG') {
      const src = el.getAttribute('src') ?? '';
      if (!IMG_HOST.test(src)) return; // pas d'image externe arbitraire (suivi, fuite d'adresse IP)
      const img = out.createElement('img');
      img.setAttribute('src', src); img.setAttribute('alt', el.getAttribute('alt') ?? ''); img.setAttribute('loading', 'lazy');
      into.appendChild(img);
      return;
    }
    const clean = out.createElement(tag.toLowerCase());
    if (tag === 'A') {
      const href = el.getAttribute('href') ?? '';
      if (/^https:\/\//i.test(href)) { clean.setAttribute('href', href); clean.setAttribute('target', '_blank'); clean.setAttribute('rel', 'noopener noreferrer nofollow'); }
    }
    if (tag === 'TD' || tag === 'TH') {
      for (const a of ['colspan', 'rowspan']) { const v = el.getAttribute(a); if (v && /^\d{1,3}$/.test(v)) clean.setAttribute(a, v); }
    }
    for (const c of Array.from(el.childNodes)) copy(c, clean);
    into.appendChild(clean);
  };
  for (const c of Array.from(doc.body.childNodes)) copy(c, root);
  return root.innerHTML;
}
