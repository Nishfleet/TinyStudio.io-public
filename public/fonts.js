// TinyStudio — non-blocking Google Fonts promotion.
// The site's Content-Security-Policy (script-src 'self', no 'unsafe-inline')
// blocks inline onload handlers, so the preload-as-style link cannot swap
// itself to a stylesheet. This same-origin script (allowed by script-src
// 'self') promotes the preloaded font stylesheet by re-inserting the same URL
// as a real stylesheet link, which the browser resolves from the preload
// cache. Each page keeps a <noscript> fallback so fonts also work without
// JavaScript.
(function () {
  "use strict";
  var preload = document.querySelector('link[rel="preload"][as="style"][data-fonts-css]');
  if (!preload) return;
  var link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = preload.href;
  document.head.appendChild(link);
})();
