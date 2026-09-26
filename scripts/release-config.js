/* Public release switch. Payments remain implemented but are inactive in free releases. */
(function (root) {
  "use strict";
  const FREE_PRO_ENABLED = true;
  const config = Object.freeze({ FREE_PRO_ENABLED });
  root.SCReleaseConfig = config;
  if (FREE_PRO_ENABLED && root.document) root.document.documentElement.classList.add("free-pro");
  if (typeof module !== "undefined") module.exports = config;
})(globalThis);
