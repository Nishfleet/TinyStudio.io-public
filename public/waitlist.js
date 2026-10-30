(function () {
  var S = 'form.lead,.micro,.urg,.band,section h2,section .lede,.row';
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

  var form = document.getElementById('start');
  var counter = document.querySelector('[data-slots-counter]');
  var status = document.querySelector('[data-slots-status]');
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function say(text) { if (status) status.textContent = text; }

  function counterUnavailable() {
    say('The slot counter did not load. Send the form anyway: a request made this month books a slot if one is left, and joins the waitlist if none is.');
  }

  function monthName(month) { return MONTHS[Number(String(month).slice(5, 7)) - 1] || ''; }

  function showSlots(slots) {
    if (!counter) return;
    if (!slots || !slots.ok) { counterUnavailable(); return; }
    counter.textContent = slots.full
      ? 'All six for ' + monthName(slots.month) + ' are taken. Requests join the waitlist; the next open slot is ' + slots.nextSlotDate + '.'
      : slots.taken + ' of ' + slots.limit + ' taken for ' + monthName(slots.month) + '.';
    var button = form && form.querySelector('button');
    if (button) button.textContent = slots.full ? 'Join the waitlist' : 'Request the appraisal';
  }

  function loadSlots() {
    return fetch('/api/appraisal-slots', { headers: { Accept: 'application/json' } })
      .then(function (res) { return res.json(); })
      .then(showSlots)
      .catch(function (err) { console.error(err); counterUnavailable(); });
  }

  if (form && window.fetch) {
    loadSlots();
    if (/[?&]signal=invalid/.test(location.search)) say('Check the highlighted fields and send again.');
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var data = {};
      new FormData(form).forEach(function (value, key) { data[key] = value; });
      say('Sending…');
      fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(data)
      })
        .then(function (res) { return res.json(); })
        .then(function (result) {
          if (!result.ok) {
            say(result.error === 'invalid_request'
              ? 'Check these fields and send again: ' + (result.fields || []).join(', ') + '.'
              : 'We could not save the request. Try again in a minute; sending the same details again is safe.');
            return;
          }
          var sent = result.confirmation === 'failed'
            ? ' The confirmation email did not go out; send the form again and we will retry it.'
            : ' We emailed you once to confirm.';
          say((result.status === 'accepted'
            ? 'Request received.'
            : 'You are on the waitlist. The next open slot is ' + result.nextSlotDate + '.') + sent);
          form.reset();
          loadSlots();
        })
        .catch(function () { say('We could not confirm the request arrived. Sending the same details again is safe.'); });
    });
  }
})();
