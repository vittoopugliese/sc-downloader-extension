(() => {
  "use strict";

  function normalizeSubstitutions(substitutions) {
    if (substitutions == null) return undefined;
    return Array.isArray(substitutions) ? substitutions.map(String) : [String(substitutions)];
  }

  function t(key, substitutions) {
    const message = globalThis.chrome?.i18n?.getMessage?.(
      key,
      normalizeSubstitutions(substitutions)
    );
    return message || `[${key}]`;
  }

  function localizeDocument(root = document) {
    root.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = t(element.dataset.i18n);
    });
    root.querySelectorAll("[data-i18n-title]").forEach((element) => {
      element.title = t(element.dataset.i18nTitle);
    });
    root.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
      element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
    });
    root.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
      element.placeholder = t(element.dataset.i18nPlaceholder);
    });
  }

  globalThis.SCDLI18n = { t, localizeDocument };
})();
