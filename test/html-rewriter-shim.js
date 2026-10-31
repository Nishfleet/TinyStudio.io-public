// HTMLRewriter is a Workers runtime global and the node --test harness has no
// workerd, so tests install this stand-in for the one selector shape the
// specimen wall uses. https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/
export function installHtmlRewriterShim() {
  if (globalThis.HTMLRewriter) return globalThis.HTMLRewriter;
  class HTMLRewriter {
    constructor() {
      this.steps = [];
    }
    on(selector, handlers) {
      this.steps.push([selector, handlers]);
      return this;
    }
    async transform(response) {
      const type = (response.headers.get("content-type") ?? "").toLowerCase();
      if (!type.includes("text/html")) return response;
      let html = await response.text();
      for (const [selector, handlers] of this.steps) {
        const match = selector === "div.band" ? html.match(/<div\b[^>]*\bclass="band"[^>]*>/) : null;
        if (!match) continue;
        handlers.element({
          before(content, options) {
            if (options && options.html) html = html.replace(match[0], `${content}${match[0]}`);
          }
        });
      }
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      return new Response(html, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }
  }
  globalThis.HTMLRewriter = HTMLRewriter;
  return HTMLRewriter;
}
