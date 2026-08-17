// Loads the shared header and footer into any page that has
// <div id="header-placeholder"></div> and <div id="footer-placeholder"></div>
async function loadInclude(id, file) {
  const el = document.getElementById(id);
  if (!el) return;
  const res = await fetch(file);
  el.outerHTML = await res.text();
}

Promise.all([
  loadInclude('header-placeholder', 'header.html'),
  loadInclude('footer-placeholder', 'footer.html')
]).then(() => {
  // Highlight the current page's nav link
  const current = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.navlinks a').forEach(link => {
    const linkPage = link.getAttribute('href').split('#')[0];
    if (linkPage === current) link.classList.add('active');
  });
});
