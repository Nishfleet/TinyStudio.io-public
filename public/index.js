(function(){
  var SEL='h1,.orn,.sub,form,.micro,.meta,.finding,.browser,.specbody,.lead,.check,.method h2,.stop,.who,.offer h2,.offer p,.price,.faq h2,.q';
  function run(){
    var els=[].slice.call(document.querySelectorAll(SEL));
    els.forEach(function(el){el.setAttribute('data-r','')});
    var io=new IntersectionObserver(function(en){
      en.forEach(function(e){
        if(!e.isIntersecting)return;
        var sibs=[].slice.call(e.target.parentNode.children)
          .filter(function(n){return n.hasAttribute&&n.hasAttribute('data-r')});
        e.target.style.transitionDelay=Math.min(Math.max(0,sibs.indexOf(e.target)),6)*100+'ms';
        e.target.classList.add('in'); io.unobserve(e.target);
      });
    },{threshold:.08,rootMargin:'0px 0px -5% 0px'});
    els.forEach(function(el){io.observe(el)});
    setTimeout(function(){document.querySelectorAll('[data-r]').forEach(function(el){el.classList.add('in')})},1600);
  }
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',run):run();
})();

// Signup rejection signal: the worker 303-redirects failed signups back to
// /?signal=invalid (the homepage form and the /audit form both post to
// /api/signups). No page code used to read that signal, so a visitor whose
// email the server rejected (the server regex is stricter than the browser's
// type=email check — e.g. "a@b" passes client-side but not server-side) was
// silently bounced to the homepage with no explanation. Reveal the banner,
// move focus to it for assistive tech, then strip the query so a refresh
// (or a copied link) does not re-show the error.
(function(){
  var match=(location.search||'').match(/[?&]signal=([^&]+)/);
  if(!match)return;
  var banner=document.getElementById('signal-invalid');
  if(!banner)return;
  banner.hidden=false;
  banner.focus();
  if(history.replaceState)history.replaceState(null,'',location.pathname+location.hash);
})();
