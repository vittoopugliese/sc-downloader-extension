// Included inside icons.js by build-icons.cjs; the catalog is private to this module.
if (!globalThis.SCIcons) {
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const resolve = name => Object.hasOwn(names, name) ? names[name] : names.help;
  const templates = new Map();
  // YouTube enforces Trusted Types; the vectors are the extension's own static data.
  let htmlPolicy = null;
  try { htmlPolicy = globalThis.trustedTypes?.createPolicy?.('seib-icons', { createHTML: value => value }); } catch {}
  // One scale for every control, including explicit CSS sizes and nested shadow roots.
  // Scale the drawing so button hit areas, alignment and host animations stay intact.
  const ICON_SCALE = 0.8;
  const style = `:host{display:inline-flex;width:var(--icon-size,1em);height:var(--icon-size,1em);vertical-align:middle;flex-shrink:0;pointer-events:none;line-height:1;filter:none!important}:host([hidden]){display:none!important}svg{display:block;width:100%;height:100%;fill:currentColor;stroke:none;transform:scale(${ICON_SCALE});transform-origin:center}`;
  const sheet = globalThis.customElements ? new CSSStyleSheet() : null;
  sheet?.replaceSync(style);
  class Icon extends HTMLElement {
    static get observedAttributes() { return ['name']; }
    constructor() {
      super(); this.attachShadow({ mode: 'open' });
      this.shadowRoot.adoptedStyleSheets = [sheet];
    }
    connectedCallback() {
      this.setAttribute('aria-hidden', 'true');
      this.render();
    }
    attributeChangedCallback() { if (this.isConnected) this.render(); }
    render() {
      const key = resolve(this.getAttribute('name'));
      if (this.renderedKey === key) return;
      let template = templates.get(key);
      if (!template) {
        template = document.createElement('template');
        template.innerHTML = htmlPolicy ? htmlPolicy.createHTML(vectors[key]) : vectors[key];
        const svg = template.content.querySelector('svg');
        svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
        templates.set(key, template);
      }
      this.shadowRoot.replaceChildren(template.content.cloneNode(true));
      this.renderedKey = key;
    }
  }
  // Chrome exposes the shared registry only in MAIN. Isolated scripts create
  // the same DOM tags; the MAIN definition upgrades them, including shadow roots.
  if (globalThis.customElements && !customElements.get('sc-icon')) customElements.define('sc-icon', Icon);
  globalThis.SCIcons = Object.freeze({
    html(name, className = '') { return `<sc-icon name="${escape(name)}"${className ? ` class="${escape(className)}"` : ''} aria-hidden="true"></sc-icon>`; },
    create(name, className = '') {
      const node = document.createElement('sc-icon'); node.setAttribute('name', name);
      node.setAttribute('aria-hidden', 'true'); if (className) node.className = className;
      return node;
    },
    has(name) { return Object.hasOwn(names, name); },
    names: Object.freeze(Object.keys(names)),
  });
}
