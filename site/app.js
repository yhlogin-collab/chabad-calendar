(() => {
  'use strict';
  const PAGE = 12;                         // events per "page" in the list
  const $ = (s) => document.querySelector(s);
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const MON = MONTHS.map(m => m.slice(0, 3));
  const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  let DATA, TZ, byDate = {}, evById = {};
  const state = { view: 'month', y: 0, m: 0, sel: null, shown: PAGE };

  // ---------- helpers ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const parts = (iso) => {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
      .formatToParts(new Date(iso)).reduce((a, x) => (a[x.type] = x.value, a), {});
    return { y: +p.year, m: +p.month - 1, d: +p.day, h: +p.hour, mi: +p.minute };
  };
  const todayStr = () => { const p = parts(new Date().toISOString()); return ymd(p.y, p.m, p.d); };
  const dateObj = (s) => new Date(s + 'T12:00:00Z');
  const ord = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  const time = (iso) => { const p = parts(iso); const h = p.h % 12 || 12; return `${h}${p.mi ? ':' + pad(p.mi) : ''}${p.h < 12 ? 'am' : 'pm'}`; };
  const timeLong = (iso) => { const p = parts(iso); const h = p.h % 12 || 12; return `${h}:${pad(p.mi)} ${p.h < 12 ? 'am' : 'pm'}`; };
  const dayLabel = (s) => { const d = dateObj(s); return `${DOW[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${ord(d.getUTCDate())}`; };
  const heb = (s) => (DATA.days[s] || {}).heb || '';

  function whenText(e) {
    let t = dayLabel(e.date);
    if (e.allDay) {
      if (e.endDate && e.endDate !== e.date) t += ` – ${dayLabel(e.endDate)}`;
      return t;
    }
    t += ` ${time(e.start)}`;
    if (e.end && e.end !== e.start) t += (e.endDate !== e.date ? ` – ${dayLabel(e.endDate)} ` : ' - ') + time(e.end);
    return t;
  }

  // description: [[text|url]] links, bare urls, emails, Hebrew runs
  function richText(s) {
    const links = [];
    s = String(s || '').replace(/\[\[([^|\]]*)\|([^\]]+)\]\]/g, (_, t, u) => (links.push([t || u, u]), `\u0001${links.length - 1}\u0001`));
    s = esc(s)
      .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, u => `<a href="${u}" target="_blank" rel="noopener">${u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 45)}${u.length > 55 ? '…' : ''}</a>`)
      .replace(/([\w.+-]+@[\w-]+\.[\w.-]+\w)/g, m => `<a href="mailto:${m}">${m}</a>`)
      .replace(/([\u0590-\u05FF][\u0590-\u05FF\s״׳"'\-]*[\u0590-\u05FF׳״])/g, m => `<span dir="rtl">${m}</span>`);
    return s.replace(/\u0001(\d+)\u0001/g, (_, i) => {
      const [t, u] = links[i];
      return /^javascript:/i.test(u) ? esc(t) : `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>`;
    });
  }
  const plain = (s) => String(s || '').replace(/\[\[([^|\]]*)\|([^\]]+)\]\]/g, '$1');

  // ---------- add to calendar / share ----------
  const gstamp = (iso) => iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const dstamp = (s, add = 0) => { const d = dateObj(s); d.setUTCDate(d.getUTCDate() + add); return d.toISOString().slice(0, 10).replace(/-/g, ''); };
  function googleLink(e) {
    const dates = e.allDay ? `${dstamp(e.date)}/${dstamp(e.endDate || e.date, 1)}`
      : `${gstamp(e.start)}/${gstamp(e.end || new Date(new Date(e.start).getTime() + 36e5).toISOString())}`;
    const q = new URLSearchParams({ action: 'TEMPLATE', text: e.title, dates, details: plain(e.description), location: e.location || '', ctz: TZ });
    return 'https://calendar.google.com/calendar/render?' + q;
  }
  function icsFile(e) {
    const fold = (s) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => '\\' + m);
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Chabad of Carrollton-Lewisville//Events//EN', 'BEGIN:VEVENT',
      `UID:${e.id}@jewishcarrollton.org`, `DTSTAMP:${gstamp(new Date().toISOString())}`];
    if (e.allDay) lines.push(`DTSTART;VALUE=DATE:${dstamp(e.date)}`, `DTEND;VALUE=DATE:${dstamp(e.endDate || e.date, 1)}`);
    else lines.push(`DTSTART:${gstamp(e.start)}`, `DTEND:${gstamp(e.end || e.start)}`);
    lines.push(`SUMMARY:${fold(e.title)}`, `DESCRIPTION:${fold(plain(e.description))}`, `LOCATION:${fold(e.location || '')}`, 'END:VEVENT', 'END:VCALENDAR');
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = e.title.replace(/[^\w ]+/g, '').trim().replace(/\s+/g, '-') + '.ics';
    document.body.appendChild(a); a.click(); a.remove();
  }
  const shareUrl = (e) => {
    const base = (DATA.site && DATA.site.pageUrl) || location.href.split('#')[0];
    return base + '#e=' + encodeURIComponent(e.id);
  };
  const waLink = (e) => 'https://wa.me/?text=' + encodeURIComponent(`${e.title} – ${whenText(e)}\n${shareUrl(e)}`);

  // ---------- Shabbos / Yom Tov / Chanukah strips ----------
  function zmanItems(from, to) {
    const out = [];
    const keys = Object.keys(DATA.days).filter(d => d >= from && d <= to).sort();
    for (const d of keys) {
      const info = DATA.days[d];
      const next = DATA.days[nextDay(d)] || {};
      if (info.candles) {
        const chag = (next.holidays || []).find(h => h.major);
        const name = chag ? chag.en : (next.parshaEn ? 'Shabbos ' + next.parshaEn.replace(/^Parashat /, '') : 'Shabbos');
        const hname = chag ? chag.he : (next.parsha ? `שבת פרשת ${next.parsha}` : 'שבת');
        let html = `<b>${esc(name)}</b> <span class="heb" dir="rtl">${esc(hname)}</span><span>🕯️ Candle lighting ${dayLabel(d).slice(0, 3)} ${timeLong(info.candles)}</span>`;
        if (next.havdalah) html += `<span>Havdalah ${timeLong(next.havdalah)}</span>`;
        else if (next.candles && !chag) html += '';
        out.push({ kind: 'z', date: d, sort: d + 'T00:00', html });
      }
      for (const h of info.holidays || []) {
        if (h.chanukah === 1) out.push({ kind: 'z', date: d, sort: d + 'T00:01', html: `<b>🕎 Chanukah begins tonight – light the first candle</b> <span class="heb" dir="rtl">חנוכה שמח!</span>` });
      }
    }
    return out;
  }
  const localSort = (iso) => { const p = parts(iso); return `${ymd(p.y, p.m, p.d)}T${pad(p.h)}:${pad(p.mi)}`; };
  const nextDay = (s) => { const d = dateObj(s); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

  // ---------- render: grid ----------
  function renderGrid() {
    const { y, m } = state;
    $('#monthName').textContent = MONTHS[m];
    $('#yearName').textContent = y;
    // Hebrew months spanning this Gregorian month
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const hm = [];
    for (const d of [1, 15, last]) {
      const k = ymd(y, m, d), info = DATA.days[k];
      if (!info) continue;
      const label = [info.heb.split(' ').slice(1).join(' '), info.hy];
      if (!hm.some(x => x[0] === label[0])) hm.push(label);
    }
    $('#hebMonth').textContent = hm.every(x => x[1] === hm[0][1])
      ? hm.map(x => x[0]).join(' – ') + ' ' + (hm[0] ? hm[0][1] : '')
      : hm.map(x => x.join(' ')).join(' – ');

    const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
    const start = new Date(Date.UTC(y, m, 1 - first));
    const today = todayStr();
    let html = '';
    for (let i = 0; i < 42; i++) {
      const dt = new Date(start); dt.setUTCDate(start.getUTCDate() + i);
      if (i === 35 && dt.getUTCMonth() !== m) break;             // drop an empty 6th row
      const k = dt.toISOString().slice(0, 10);
      const info = DATA.days[k] || {};
      const evs = byDate[k] || [];
      const cls = ['cell', dt.getUTCMonth() !== m && 'out', evs.length && 'has', k === today && 'today', k === state.sel && 'sel'].filter(Boolean).join(' ');
      const hol = (info.holidays || []).filter(h => !/^(Fast begins|Fast ends|Finish eating|Biur)/.test(h.en));
      const holHtml = hol.length ? `<span class="hol${hol[0].major ? ' major' : ''}" title="${esc(hol.map(h => h.en).join(', '))}">${esc(hol[0].en.replace(/ – light.*/, ''))}</span>`
        : info.parshaEn ? `<span class="hol">${esc(info.parshaEn.replace(/^Parashat /, ''))}</span>` : '';
      const zm = info.candles ? `<span class="zm">🕯️ ${time(info.candles)}</span>` : info.havdalah ? `<span class="zm">✨ ${time(info.havdalah)}</span>` : '';
      const dots = evs.length ? `<span class="dots">${'<i></i>'.repeat(Math.min(evs.length, 3))}</span>` : '';
      html += `<div class="${cls}" data-date="${k}" ${evs.length ? `role="button" tabindex="0" aria-label="${esc(dayLabel(k))}: ${evs.length} event${evs.length > 1 ? 's' : ''}"` : ''}>
        <span class="num">${dt.getUTCDate()}</span><span class="hd">${esc(info.heb || '')}</span>${holHtml}${zm}${dots}</div>`;
    }
    $('#grid').innerHTML = html;
    $('.prev').disabled = ymd(y, m, 1) <= DATA.from;
    $('.next').disabled = ymd(y, m, last) >= DATA.to;
    $('.prev').style.visibility = $('.prev').disabled ? 'hidden' : '';
    $('.next').style.visibility = $('.next').disabled ? 'hidden' : '';
  }

  // ---------- render: list ----------
  function evHtml(e) {
    const d = dateObj(e.date);
    const media = e.image
      ? `<div class="thumb"><img loading="lazy" src="${esc(e.image)}" alt="" onerror="this.parentNode.outerHTML='${tileHtml(e).replace(/'/g, '&#39;').replace(/"/g, '&quot;')}'"></div>`
      : tileHtml(e);
    return `<article class="ev${state.sel === e.date ? ' hl' : ''}" data-id="${esc(e.id)}" tabindex="0">
      ${media}
      <div><h3>${esc(e.title)}</h3>
      <div class="when">${esc(whenText(e))}<span class="heb" dir="rtl">${esc(heb(e.date))}</span></div>
      ${e.location ? `<div class="where">📍 ${esc(e.location)}</div>` : ''}
      ${e.description ? `<div class="desc">${esc(plain(e.description))}</div>` : ''}
      ${e.rsvp ? `<div class="chips"><a class="chip solid" href="${esc(e.rsvp)}" target="_blank" rel="noopener">RSVP</a></div>` : ''}
      </div></article>`;
    void d;
  }
  function tileHtml(e) {
    const d = dateObj(e.date);
    return `<div class="dtile"><span class="m">${MON[d.getUTCMonth()]}</span><span class="d">${d.getUTCDate()}</span><span class="h">${esc(heb(e.date))}</span></div>`;
  }

  function renderList() {
    const today = todayStr();
    let from, to, items;
    const fb = $('#filterBar');
    if (state.sel) {
      from = to = state.sel;
      fb.hidden = false;
      $('#filterLabel').innerHTML = `<b>${esc(dayLabel(state.sel))}</b> &nbsp;<span class="heb" dir="rtl" style="font-family:var(--heb);color:var(--gold)">${esc(heb(state.sel))}</span>`;
    } else {
      fb.hidden = true;
      const mStart = ymd(state.y, state.m, 1);
      from = state.view === 'month' && mStart > today ? mStart : today;
      to = DATA.to;
    }
    const evs = DATA.events.filter(e => (e.endDate || e.date) >= from && e.date <= to);
    const shownEvs = evs.slice(0, state.shown);
    const limit = state.sel ? to : (shownEvs.length < evs.length ? shownEvs[shownEvs.length - 1].date : to);
    items = shownEvs.map(e => ({ kind: 'e', e, date: e.date, sort: e.start ? localSort(e.start) : e.date + 'T00:02' }))
      .concat(zmanItems(from, limit))
      .sort((a, b) => a.sort.localeCompare(b.sort));

    let html = '', curMonth = '';
    for (const it of items) {
      if (state.view === 'list' && !state.sel) {
        const mk = it.date.slice(0, 7);
        if (mk !== curMonth) { curMonth = mk; const d = dateObj(it.date); html += `<div class="monthhead">${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}</div>`; }
      }
      html += it.kind === 'e' ? evHtml(it.e) : `<div class="zrow">${it.html}</div>`;
    }
    if (!shownEvs.length) html += `<div class="empty">${state.sel ? 'No events this day.' : 'No upcoming events posted yet — check back soon!'}</div>`;
    $('#list').innerHTML = html;
    $('#moreBtn').hidden = state.sel || evs.length <= state.shown;
  }

  function render() {
    $('#gridWrap').hidden = state.view !== 'month';
    document.querySelectorAll('.views [data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === state.view));
    if (state.view === 'month') renderGrid();
    else {
      const t = todayStr();
      $('#monthName').textContent = 'Upcoming Events';
      $('#yearName').textContent = '';
      $('#hebMonth').textContent = `${heb(t)} ${(DATA.days[t] || {}).hy || ''}`;
      $('.prev').style.visibility = $('.next').style.visibility = 'hidden';
    }
    renderList();
  }

  // ---------- modal ----------
  function openEvent(id) {
    const e = evById[id];
    if (!e) return;
    const isAddress = e.location && /\d/.test(e.location) && !/rsvp/i.test(e.location);
    const where = e.location && !isAddress ? `<div class="where">📍 ${esc(e.location)}</div>` : e.location ? `<div class="where">📍 <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.location)}" target="_blank" rel="noopener">${esc(e.location)}</a></div>` : '';
    const files = (e.files || []).length ? `<div class="files">📎 ${e.files.map(f => `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)}</a>`).join(' · ')}</div>` : '';
    $('#mBody').innerHTML = `
      ${e.image ? `<img class="hero" src="${esc(e.image.replace(/sz=w\d+/, 'sz=w1200'))}" alt="" onerror="this.remove()">` : ''}
      <div class="bar"></div>
      <div class="in">
        <h2 id="mTitle">${esc(e.title)}</h2>
        <div class="when">${esc(whenText(e))}</div>
        <div class="heb" dir="rtl">${esc(heb(e.date))} ${esc((DATA.days[e.date] || {}).hy || '')}</div>
        ${where}
        ${e.description ? `<div class="body">${richText(e.description)}</div>` : '<div style="height:14px"></div>'}
        <div class="actions">
          ${e.rsvp ? `<a class="chip solid" href="${esc(e.rsvp)}" target="_blank" rel="noopener">RSVP</a>` : ''}
          <a class="chip" href="${esc(googleLink(e))}" target="_blank" rel="noopener">+ Google Calendar</a>
          <button type="button" class="chip" data-act="ics">+ Apple / Outlook</button>
          <a class="chip" href="${esc(waLink(e))}" target="_blank" rel="noopener">Share on WhatsApp</a>
          <button type="button" class="chip" data-act="copy">Copy link</button>
        </div>
        ${files}
      </div>`;
    $('#mBody').querySelector('[data-act=ics]').onclick = () => icsFile(e);
    $('#mBody').querySelector('[data-act=copy]').onclick = (ev) => {
      navigator.clipboard?.writeText(shareUrl(e)).then(() => { ev.target.textContent = 'Copied ✓'; }, () => prompt('Copy this link:', shareUrl(e)));
    };
    $('#modal').hidden = false;
    $('#modal .close').focus();
    history.replaceState(null, '', '#e=' + encodeURIComponent(id));
    postHeight();
  }
  function closeModal() { $('#modal').hidden = true; history.replaceState(null, '', location.pathname + location.search); }

  // ---------- events ----------
  function bind() {
    $('.prev').onclick = () => { state.m--; if (state.m < 0) { state.m = 11; state.y--; } state.sel = null; state.shown = PAGE; render(); };
    $('.next').onclick = () => { state.m++; if (state.m > 11) { state.m = 0; state.y++; } state.sel = null; state.shown = PAGE; render(); };
    $('.today-btn').onclick = () => { const p = parts(new Date().toISOString()); state.y = p.y; state.m = p.m; state.sel = null; state.shown = PAGE; render(); };
    document.querySelectorAll('.views [data-view]').forEach(b => b.onclick = () => { state.view = b.dataset.view; state.sel = null; state.shown = PAGE; render(); });
    $('#clearFilter').onclick = () => { state.sel = null; render(); };
    $('#moreBtn').onclick = () => { state.shown += PAGE; renderList(); };
    const pick = (cell) => {
      if (!cell || !cell.classList.contains('has')) return;
      const k = cell.dataset.date;
      state.sel = state.sel === k ? null : k;
      if (k.slice(5, 7) - 1 !== state.m) { state.y = +k.slice(0, 4); state.m = k.slice(5, 7) - 1; }
      render();
      if (state.sel) $('#filterBar').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    $('#grid').addEventListener('click', ev => pick(ev.target.closest('.cell')));
    $('#grid').addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(ev.target.closest('.cell')); } });
    $('#list').addEventListener('click', ev => {
      if (ev.target.closest('a')) return;
      const a = ev.target.closest('.ev'); if (a) openEvent(a.dataset.id);
    });
    $('#list').addEventListener('keydown', ev => { if (ev.key === 'Enter') { const a = ev.target.closest('.ev'); if (a) openEvent(a.dataset.id); } });
    $('#modal').addEventListener('click', ev => { if (ev.target.id === 'modal' || ev.target.closest('.close')) closeModal(); });
    document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !$('#modal').hidden) closeModal(); });
  }

  // Tell the parent page our height (used by the optional auto-resize snippet).
  function postHeight() {
    if (window.parent === window) return;
    const h = $('#modal').hidden ? document.documentElement.scrollHeight : Math.max(document.documentElement.scrollHeight, $('.sheet').offsetHeight + 60);
    window.parent.postMessage({ type: 'chabad-calendar-height', height: h }, '*');
  }

  // ---------- start ----------
  fetch('events.json?t=' + Date.now()).then(r => r.json()).then(data => {
    DATA = data; TZ = data.timezone;
    for (const e of DATA.events) {
      evById[e.id] = e;
      // multi-day events show on every day they cover
      for (let d = e.date; d <= (e.endDate || e.date); d = nextDay(d)) (byDate[d] ||= []).push(e);
    }
    const p = parts(new Date().toISOString());
    state.y = p.y; state.m = p.m;
    const qs = new URLSearchParams(location.search);
    if (qs.get('view') === 'list') state.view = 'list';
    const dm = location.hash.match(/^#d=(\d{4}-\d\d-\d\d)/);
    if (dm) { state.sel = dm[1]; state.y = +dm[1].slice(0, 4); state.m = dm[1].slice(5, 7) - 1; }
    bind(); render();
    const em = location.hash.match(/^#e=(.+)$/);
    if (em) openEvent(decodeURIComponent(em[1]));
    const g = new Date(DATA.generated);
    $('#updated').textContent = 'Updated ' + g.toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    if ('ResizeObserver' in window) new ResizeObserver(postHeight).observe(document.body);
    postHeight();
  }).catch(err => {
    $('#list').innerHTML = '<div class="empty">The calendar could not be loaded. Please refresh the page.</div>';
    console.error(err);
  });
})();
