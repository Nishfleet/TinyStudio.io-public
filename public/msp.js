(function () {
  var S = '.phead h1,.phead .sub,form.lead,.micro,.urg,.band,section h2,section .lede,.check,.row,.q';
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
})();
