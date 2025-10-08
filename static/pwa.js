(function () {
  "use strict";
  // 서비스워커 등록
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      var swUrl =
        (document.currentScript && document.currentScript.src) ||
        "/static/pwa.js";
      try {
        var base = new URL(swUrl, window.location.href);
        var scope = base.pathname.replace(/[^/]+$/, "");
        navigator.serviceWorker
          .register(scope + "sw.js", { scope: scope })
          .catch(function () {});
      } catch (e) {}
    });
  }
})();
