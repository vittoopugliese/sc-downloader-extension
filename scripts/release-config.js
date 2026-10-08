/* Public release switches. Payments remain implemented but are inactive in free releases.
   DOWNLOADER_ENABLED stays true in the repository; the Player Tools store build
   (package-extension.ps1 -Edition tools) rewrites it to false. */
(function (root) {
  "use strict";
  const FREE_PRO_ENABLED = true;
  const DOWNLOADER_ENABLED = true;
  const config = Object.freeze({ FREE_PRO_ENABLED, DOWNLOADER_ENABLED });
  root.SCReleaseConfig = config;
  if (FREE_PRO_ENABLED && root.document) root.document.documentElement.classList.add("free-pro");
  if (!DOWNLOADER_ENABLED && root.document) root.document.documentElement.classList.add("tools-edition");
  if (typeof module !== "undefined") module.exports = config;
})(globalThis);
