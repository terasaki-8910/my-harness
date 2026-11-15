(() => {
  if (window.__demoVideo) return;
  let overlay;
  let cursor;
  let cursorVisible = true;
  let cursorSize = 32;
  let listenersInstalled = false;

  const easing = (name, value) => {
    const t = Math.max(0, Math.min(1, value));
    if (name === "linear") return t;
    if (name === "in") return t ** 3;
    if (name === "out") return 1 - (1 - t) ** 3;
    return t < 0.5 ? 4 * t ** 3 : 1 - ((-2 * t + 2) ** 3) / 2;
  };

  function ensureOverlay() {
    if (overlay?.isConnected) return overlay;
    if (!document.body) return null;
    overlay = document.getElementById("__demo-video-overlay") || document.createElement("div");
    overlay.id = "__demo-video-overlay";
    Object.assign(overlay.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "2147483647", overflow: "hidden" });
    if (!overlay.isConnected) document.body.append(overlay);
    cursor = overlay.querySelector("[data-demo-video-cursor]") || document.createElement("div");
    cursor.dataset.demoVideoCursor = "";
    cursor.innerHTML = '<svg viewBox="0 0 32 40" height="100%" xmlns="http://www.w3.org/2000/svg"><path d="M2 2v30l8-8 6 14 6-3-6-14h12z" fill="black" stroke="white" stroke-width="2" stroke-linejoin="round"/></svg>';
    Object.assign(cursor.style, { position: "absolute", left: "0", top: "0", width: `${cursorSize * 0.8}px`, height: `${cursorSize}px`, display: "none", transform: "translate3d(0,0,0)" });
    if (!cursor.isConnected) overlay.append(cursor);
    if (!document.getElementById("__demo-video-style")) {
      const style = document.createElement("style");
      style.id = "__demo-video-style";
      style.textContent = "@keyframes __demo-video-ripple{from{width:12px;height:12px;opacity:1}to{width:56px;height:56px;opacity:0}}";
      document.head?.append(style);
    }
    return overlay;
  }

  function move(event) {
    if (!ensureOverlay() || !cursor) return;
    cursor.style.transform = `translate3d(${event.clientX}px,${event.clientY}px,0)`;
    cursor.style.display = cursorVisible ? "block" : "none";
  }

  function ripple(event) {
    if (!ensureOverlay()) return;
    const circle = document.createElement("div");
    Object.assign(circle.style, {
      position: "absolute", left: `${event.clientX}px`, top: `${event.clientY}px`, border: "3px solid rgba(0,0,0,.35)",
      borderRadius: "50%", transform: "translate(-50%,-50%)", boxSizing: "border-box",
      animation: "__demo-video-ripple 450ms ease-out forwards",
    });
    circle.addEventListener("animationend", () => circle.remove(), { once: true });
    overlay.append(circle);
  }

  function installListeners() {
    if (listenersInstalled) return;
    listenersInstalled = true;
    window.addEventListener("mousemove", move, true);
    window.addEventListener("mousedown", ripple, true);
  }

  window.__demoVideo = {
    init({ visible = true, size = 32 } = {}) {
      cursorVisible = visible;
      cursorSize = size;
      ensureOverlay();
      installListeners();
      if (!document.body) window.addEventListener("DOMContentLoaded", ensureOverlay, { once: true });
    },
    point(selector, anchor = [0.5, 0.5]) {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const x = rect.left + rect.width * anchor[0];
      const y = rect.top + rect.height * anchor[1];
      return { x, y, offscreen: x < 0 || y < 0 || x > innerWidth || y > innerHeight };
    },
    scroll(options = {}) {
      const container = options.in ? document.querySelector(options.in) : window;
      if (!container) return Promise.reject(new Error(`Scroll container not found: ${options.in}`));
      const target = options.to ? document.querySelector(options.to) : null;
      if (options.to && !target) return Promise.reject(new Error(`Scroll target not found: ${options.to}`));
      const isPage = container === window;
      const startX = isPage ? window.scrollX : container.scrollLeft;
      const startY = isPage ? window.scrollY : container.scrollTop;
      let endX = Number.isFinite(options.x) ? options.x : startX;
      let endY = Number.isFinite(options.y) ? options.y : startY;
      if (target) {
        const rect = target.getBoundingClientRect();
        if (isPage) {
          endX = Number.isFinite(options.x) ? options.x : rect.left + startX;
          endY = Number.isFinite(options.y) ? options.y : rect.top + startY;
        } else {
          const containerRect = container.getBoundingClientRect();
          endX = Number.isFinite(options.x) ? options.x : rect.left - containerRect.left + startX;
          endY = Number.isFinite(options.y) ? options.y : rect.top - containerRect.top + startY;
        }
      }
      endY += options.offset || 0;
      // Clamp to the scrollable range so the easing decelerates into the real end instead of
      // stopping abruptly where the browser clamps the position.
      const scroller = isPage ? (document.scrollingElement || document.documentElement) : container;
      const maxX = Math.max(0, scroller.scrollWidth - (isPage ? innerWidth : container.clientWidth));
      const maxY = Math.max(0, scroller.scrollHeight - (isPage ? innerHeight : container.clientHeight));
      endX = Math.min(Math.max(0, endX), maxX);
      endY = Math.min(Math.max(0, endY), maxY);
      const set = (x, y) => container.scrollTo({ left: x, top: y, behavior: "instant" });
      const duration = Math.max(0, (options.dur || 0) * 1000);
      const snapElements = [scroller];
      if (isPage && document.body && getComputedStyle(document.body).scrollSnapType !== "none" && document.body !== scroller) snapElements.push(document.body);
      const snapValues = snapElements.map((element) => element.style.scrollSnapType);
      const disableSnap = () => snapElements.forEach((element) => { element.style.scrollSnapType = "none"; });
      const restoreSnap = () => snapElements.forEach((element, index) => { element.style.scrollSnapType = snapValues[index]; });
      disableSnap();
      if (duration === 0) {
        try {
          set(endX, endY);
          return Promise.resolve();
        } catch (error) {
          return Promise.reject(error);
        } finally {
          restoreSnap();
        }
      }
      return new Promise((resolve, reject) => {
        const started = performance.now();
        const frame = (now) => {
          try {
            const progress = Math.min(1, (now - started) / duration);
            const value = easing(options.ease || "inOut", progress);
            set(startX + (endX - startX) * value, startY + (endY - startY) * value);
            if (progress < 1) requestAnimationFrame(frame);
            else resolve();
          } catch (error) {
            reject(error);
          }
        };
        try { requestAnimationFrame(frame); } catch (error) { reject(error); }
      }).finally(restoreSnap);
    },
    visible(selectors) {
      return selectors.map((selector) => {
        const element = document.querySelector(selector);
        if (!element) return false;
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) <= 0.1) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const visibleWidth = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
        const visibleHeight = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
        const visibleArea = visibleWidth * visibleHeight;
        const ownArea = rect.width * rect.height;
        const viewportArea = innerWidth * innerHeight;
        const denominator = ownArea > viewportArea ? viewportArea : ownArea;
        return visibleArea >= denominator * 0.5;
      });
    },
  };
})();
