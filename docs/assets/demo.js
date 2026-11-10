// Replays a real question and answer: the question types out, then the tool
// call shows, then the answer appears line by line. All the text is already in
// the page; this only reveals it. With reduced motion, everything shows at once.
(function () {
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function play(demo) {
    if (demo._timers) demo._timers.forEach(clearTimeout);
    demo._timers = [];
    demo.classList.remove("done");
    var typed = demo.querySelector(".typed");
    var full = typed.getAttribute("data-text");
    var steps = demo.querySelectorAll(".step");
    steps.forEach(function (s) { s.classList.remove("shown"); });
    if (reduce) {
      typed.textContent = full;
      steps.forEach(function (s) { s.classList.add("shown"); });
      demo.classList.add("done");
      return;
    }
    typed.textContent = "";
    var t = 0;
    var perChar = Math.max(12, Math.min(35, 1600 / full.length));
    for (var i = 1; i <= full.length; i++) {
      (function (n) {
        demo._timers.push(setTimeout(function () { typed.textContent = full.slice(0, n); }, t));
      })(i);
      t += perChar;
    }
    t += 350;
    steps.forEach(function (s, idx) {
      demo._timers.push(setTimeout(function () { s.classList.add("shown"); }, t));
      t += idx === 0 ? 600 : 140;
    });
    demo._timers.push(setTimeout(function () { demo.classList.add("done"); }, t));
  }

  function init() {
    var demos = document.querySelectorAll(".demo");
    demos.forEach(function (demo) {
      var btn = demo.querySelector(".replay");
      if (btn) btn.addEventListener("click", function () { play(demo); });
      // Hidden until played, so a visitor never sees half a demo.
      demo.classList.remove("static");
    });
    if (!("IntersectionObserver" in window)) {
      demos.forEach(play);
      return;
    }
    var seen = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { seen.unobserve(e.target); play(e.target); }
      });
    }, { threshold: 0.35 });
    demos.forEach(function (d) { seen.observe(d); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
