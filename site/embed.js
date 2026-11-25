/* Chabad of Carrollton-Lewisville – calendar helper for jewishcarrollton.org
 * Loaded once from the ChabadOne footer code:
 *   <script src="https://yhlogin-collab.github.io/chabad-calendar/embed.js" async="async"></script>
 * 1) Home page: inserts the "Upcoming at Chabad" strip right under the banner slider.
 * 2) Every page: lets the calendar boxes (next-event boxes, home strip) size themselves to fit.
 */
(function () {
  'use strict';
  if (window.__chabadCalEmbed) return;
  window.__chabadCalEmbed = true;

  var BASE = 'https://yhlogin-collab.github.io/chabad-calendar/';

  // ---- auto-height for our boxes -------------------------------------------
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.type !== 'chabad-next-height') return;
    var frames = document.getElementsByTagName('iframe');
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === e.source) frames[i].style.height = (d.height + 10) + 'px';
    }
  });

  // ---- home page strip -----------------------------------------------------
  function addHomeStrip() {
    if (!document.body || !/(^|\s)home(\s|$)/.test(document.body.className)) return;
    if (document.getElementById('chabad-upcoming')) return;

    var section = document.createElement('div');
    section.id = 'chabad-upcoming';
    section.style.cssText = 'background:#fff;padding:36px 12px 30px;clear:both;width:100%;box-sizing:border-box';
    var frame = document.createElement('iframe');
    frame.src = BASE + 'upcoming/';
    frame.title = 'Upcoming events';
    frame.setAttribute('scrolling', 'no');
    frame.style.cssText = 'display:block;width:100%;max-width:1100px;height:600px;border:0;margin:0 auto';
    section.appendChild(frame);

    // Right after the banner slider's row; if the layout ever changes, before the "About" row; else top of content.
    var anchor = document.querySelector('.promo_slider');
    if (anchor) {
      while (anchor.parentElement && !anchor.nextElementSibling) anchor = anchor.parentElement;
      anchor.parentElement.insertBefore(section, anchor.nextElementSibling);
      return;
    }
    var rows = document.querySelectorAll('.hp-row');
    if (rows.length) { rows[0].parentElement.insertBefore(section, rows[0]); return; }
    var content = document.getElementById('content');
    if (content) content.insertBefore(section, content.firstChild);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addHomeStrip);
  else addHomeStrip();
})();
