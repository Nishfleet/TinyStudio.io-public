(function () {
  var S = '.phead h1,.phead .sub,form.lead,.micro,.urg,.band,section h2,section .lede,.check,.row';
  function r() {
    var e = [].slice.call(document.querySelectorAll(S));
    e.forEach(function (x) { x.setAttribute('data-r', ''); });
    if (typeof IntersectionObserver !== 'undefined') {
      var io = new IntersectionObserver(function (en) {
        en.forEach(function (v) {
          if (!v.isIntersecting) return;
          var s = [].slice.call(v.target.parentNode.children).filter(function (n) { return n.hasAttribute && n.hasAttribute('data-r'); });
          v.target.style.transitionDelay = Math.min(Math.max(0, s.indexOf(v.target)), 6) * 90 + 'ms';
          v.target.classList.add('in'); io.unobserve(v.target);
        });
      }, { threshold: .08, rootMargin: '0px 0px -5% 0px' });
      e.forEach(function (x) { io.observe(x); });
    }
    setTimeout(function () { document.querySelectorAll('[data-r]').forEach(function (x) { x.classList.add('in'); }); }, 1600);
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', r) : r();

  // ---- AI-search evidence artifact ------------------------------------
  // Controlled questions and captured runs live in evidence-fixtures/ai-search/
  // and are embedded on the audit page as JSON. This renderer turns them into
  // the evidence table. Every text node is escaped; links are rendered only for
  // http(s) URLs; the four states are strict and stay visually distinct.
  var AI_STATES = ['found', 'wrong', 'absent', 'not-tested'];
  var AI_LABELS = { found: 'Found', wrong: 'Wrong', absent: 'Absent', 'not-tested': 'Not tested' };

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeUrl(value) {
    var s = String(value || '').trim();
    if (!/^https?:\/\//i.test(s)) return '';
    if (/\s/.test(s)) return '';
    try {
      var parsed = new URL(s);
      return parsed.hostname.indexOf('.') !== -1 ? parsed.href : '';
    } catch (e) {
      return '';
    }
  }

  function findById(list, id) {
    var found = null;
    (list || []).forEach(function (item) {
      if (!found && item && item.id === id) found = item;
    });
    return found;
  }

  function sameSiteSource(run, siteHost) {
    return (run.sources || []).some(function (source) {
      var url = safeUrl(source.url);
      if (!url) return false;
      try {
        return new URL(url).hostname === siteHost;
      } catch (e) {
        return false;
      }
    });
  }

  function sitePageHref(data, run, page) {
    var business = data.evidence.business || {};
    var site = safeUrl(business.site);
    if (!site || typeof page !== 'string' || !page) return '';
    var siteHost = new URL(site).hostname;
    if (!sameSiteSource(run, siteHost)) return '';
    try {
      var resolved = new URL(page, site);
      if (resolved.hostname !== siteHost) return '';
      return safeUrl(resolved.href) || '';
    } catch (e) {
      return '';
    }
  }

  function linkList(sources) {
    var links = [];
    (sources || []).forEach(function (source) {
      var title = escapeHtml(String(source.title || 'source'));
      var href = safeUrl(source.url);
      links.push(href
        ? '<a class="xa1" href="' + href + '" target="_blank" rel="noopener">' + title + '</a>'
        : title);
    });
    return links.join(' &middot; ');
  }

  function renderRun(data, run) {
    var question = findById(data.questions.questions, run.questionId);
    var engine = findById(data.evidence.engines, run.engine);
    var name = escapeHtml(question ? question.name : run.questionId) + ' &mdash; ' + escapeHtml(engine ? engine.name : run.engine);
    if (engine && engine.surface) name += ' &middot; ' + escapeHtml(engine.surface);
    var prompt = escapeHtml(question ? question.prompt : '');
    var out = [
      '<div class="row" data-state="' + escapeHtml(run.state) + '">',
      '<span class="t" title="Prompt: ' + prompt + '">' + name + '</span>',
      '<span class="v">' + escapeHtml(AI_LABELS[run.state] || run.state) + '</span></div>'
    ];

    if (run.state === 'not-tested') {
      out.push('<p class="micro">Not run &mdash; ' + escapeHtml(run.reason || 'no reason recorded') + '.</p>');
      return out.join('');
    }

    out.push('<p class="micro">' + (run.state === 'absent' ? 'Observed: ' : 'Answer (verbatim): ') + '&ldquo;' + escapeHtml(run.captured || '') + '&rdquo;</p>');
    if (run.sources && run.sources.length) {
      out.push('<p class="micro">Sources: ' + linkList(run.sources) + '</p>');
    }
    if (run.remediation) {
      var remediation = '<p class="micro">Remediation: ' + escapeHtml(run.remediation.text || '');
      var pageHref = sitePageHref(data, run, run.remediation.page);
      if (pageHref) {
        remediation += ' &mdash; <a class="xa1" href="' + pageHref + '">' + escapeHtml(run.remediation.page) + '</a>';
      }
      out.push(remediation + '</p>');
    }
    return out.join('');
  }

  function renderArtifact(data) {
    if (!data || !data.questions || !data.evidence) return '';
    var business = data.evidence.business || {};
    var questions = data.questions.questions || [];
    var engines = data.evidence.engines || [];
    var runs = data.evidence.runs || [];
    var out = [];
    out.push('<p class="micro"><b>Controlled test, ' + escapeHtml(data.evidence.testedOn || '') + '.</b> ' + escapeHtml(business.name || '') + ' (' + escapeHtml(business.site || '') + '), ' + engines.length + ' engines, ' + runs.length + ' runs. Every answer below is quoted verbatim; the sources are the pages the engine cited.</p>');
    out.push('<p class="micro"><b>The questions, exactly as asked:</b></p>');
    questions.forEach(function (question, index) {
      out.push('<p class="micro">Q' + (index + 1) + ' &mdash; ' + escapeHtml(question.name) + '. Prompt: &ldquo;' + escapeHtml(question.prompt) + '&rdquo;.</p>');
    });
    out.push('<div class="rows">');
    runs.forEach(function (run) {
      out.push(renderRun(data, run));
    });
    out.push('</div>');
    return out.join('');
  }

  function bootAiSearch() {
    var mount = document.querySelector('[data-ai-search-evidence]');
    var source = document.getElementById('ai-search-evidence');
    if (!mount || !source) return;
    var data;
    try {
      data = JSON.parse(source.textContent);
    } catch (e) {
      return;
    }
    var html = renderArtifact(data);
    if (html) mount.innerHTML = html;
  }

  if (typeof globalThis !== 'undefined') {
    globalThis.TinyStudioAudit = {
      AI_STATES: AI_STATES,
      AI_LABELS: AI_LABELS,
      escapeHtml: escapeHtml,
      safeUrl: safeUrl,
      renderArtifact: renderArtifact,
      bootAiSearch: bootAiSearch
    };
  }

  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', bootAiSearch) : bootAiSearch();
})();
