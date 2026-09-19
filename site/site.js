/* Helpers for the protocol and review pages: the contents list starts closed on
 * small screens and marks the section being read, and a link to something inside
 * a closed <details> opens it. */
(function () {
  "use strict";
  const toc = document.getElementById("toc");
  if (toc && matchMedia("(max-width: 1023px)").matches) toc.open = false;
  const links = toc ? [...toc.querySelectorAll('a[href^="#"]')] : [];
  const byId = new Map(links.map((a) => [decodeURIComponent(a.hash.slice(1)), a]));
  if (byId.size && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        links.forEach((a) => a.classList.remove("current"));
        byId.get(entry.target.id)?.classList.add("current");
      }
    }, { rootMargin: "-72px 0px -70% 0px" });
    for (const id of byId.keys()) {
      const heading = document.getElementById(id);
      if (heading) observer.observe(heading);
    }
  }
  function reveal() {
    const target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (!target) return;
    let opened = false;
    for (let el = target; el; el = el.parentElement) {
      if (el.tagName === "DETAILS" && !el.open) { el.open = true; opened = true; }
    }
    if (opened) target.scrollIntoView();
  }
  addEventListener("hashchange", reveal);
  reveal();
})();
