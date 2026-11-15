(function () {
  "use strict";

  var DURATION = 450;
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  document.addEventListener("DOMContentLoaded", function () {
    var root = document.scrollingElement || document.documentElement;
    var sections = Array.from(document.querySelectorAll("section.slide"));
    var navLinks = Array.from(document.querySelectorAll('.topnav a[href^="#"]'));
    var current = sections[0] || null;
    var pending = null;
    var frame = null;

    function markNav(section) {
      var hash = section ? "#" + section.id : "";
      navLinks.forEach(function (link) {
        if (link.getAttribute("href") === hash) link.setAttribute("aria-current", "true");
        else link.removeAttribute("aria-current");
      });
    }

    function ease(progress) {
      return progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
    }

    function go(section) {
      if (!section) return;
      var from = window.scrollY;
      var to = Math.max(0, Math.min(section.offsetTop, root.scrollHeight - window.innerHeight));
      pending = section;
      current = section;
      markNav(section);
      history.replaceState(null, "", "#" + section.id);
      if (frame) cancelAnimationFrame(frame);
      document.documentElement.classList.remove("is-scrolling");
      if (reducedMotion.matches || Math.abs(to - from) < 2) {
        window.scrollTo({ top: to, behavior: "instant" });
        pending = null;
        frame = null;
        return;
      }
      document.documentElement.classList.add("is-scrolling");
      var started = performance.now();
      function step(now) {
        var progress = Math.min(1, (now - started) / DURATION);
        window.scrollTo({ top: from + (to - from) * ease(progress), behavior: "instant" });
        if (progress < 1) {
          frame = requestAnimationFrame(step);
        } else {
          frame = null;
          pending = null;
          document.documentElement.classList.remove("is-scrolling");
        }
      }
      frame = requestAnimationFrame(step);
    }

    var observer = new IntersectionObserver(function (entries) {
      if (pending) return;
      entries.forEach(function (entry) {
        if (entry.isIntersecting) current = entry.target;
      });
      markNav(current);
    }, { rootMargin: "-45% 0px -45% 0px" });
    sections.forEach(function (section) { observer.observe(section); });
    markNav(current);

    document.addEventListener("click", function (event) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      var link = event.target.closest('a[href^="#"]');
      if (!link) return;
      var section = document.getElementById(link.getAttribute("href").slice(1));
      if (!section || !section.classList.contains("slide")) return;
      event.preventDefault();
      go(section);
    });

    document.addEventListener("keydown", function (event) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      var target = event.target;
      if (target && (target.matches("input, textarea, select, button") || target.isContentEditable)) return;
      var index = sections.indexOf(pending || current);
      if (index < 0) return;
      var nextKeys = ["ArrowRight", "ArrowDown", "PageDown", " ", "Spacebar"];
      var previousKeys = ["ArrowLeft", "ArrowUp", "PageUp"];
      var destination = null;
      if (nextKeys.includes(event.key)) destination = sections[Math.min(sections.length - 1, index + 1)];
      else if (previousKeys.includes(event.key)) destination = sections[Math.max(0, index - 1)];
      else if (event.key === "Home") destination = sections[0];
      else if (event.key === "End") destination = sections[sections.length - 1];
      if (!destination || destination === sections[index]) return;
      event.preventDefault();
      go(destination);
    });

    var imagesReady = Array.from(document.images, function (image) {
      return image.decode().catch(function () {});
    });
    Promise.all([document.fonts.ready, Promise.all(imagesReady)]).then(function () {
      window.__slidesReady = true;
    });
  });
}());
