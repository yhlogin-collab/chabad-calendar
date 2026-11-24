// Builds site/events.json from the Google Calendar iCal feed plus Hebrew dates,
// holidays and candle-lighting times for Lewisville, TX.
//
// Feed source (first one set wins):
//   CAL_ICS_URL   – full URL (use the "secret address in iCal format" if the calendar is private)
//   CAL_ICS_FILE  – local .ics file (for testing)
//   otherwise the public feed of CALENDAR_ID in config.json

import ICAL from 'ical.js';
import { HDate, HebrewCalendar, Location, Locale, gematriya, flags } from '@hebcal/core';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await fs.readFile(path.join(root, 'config.json'), 'utf8'));
const TZ = config.timezone;

// ---------- 1. Load the feed ----------
async function loadIcs() {
  if (process.env.CAL_ICS_FILE) return fs.readFile(process.env.CAL_ICS_FILE, 'utf8');
  const url = process.env.CAL_ICS_URL ||
    `https://calendar.google.com/calendar/ical/${encodeURIComponent(config.calendarId)}/public/basic.ics`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Calendar feed returned HTTP ${res.status}`);
  return res.text();
}

// ---------- 2. Time helpers ----------
// Offset (minutes) of a time zone at a given instant.
function tzOffset(zone, date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce((a, p) => (a[p.type] = p.value, a), {});
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return (asUtc - date.getTime()) / 60000;
}
// Wall-clock time in `zone` → real instant.
function wallToDate(y, mo, d, h, mi, s, zone) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let off = tzOffset(zone, new Date(guess));
  let t = guess - off * 60000;
  const off2 = tzOffset(zone, new Date(t));
  if (off2 !== off) t = guess - off2 * 60000;
  return new Date(t);
}
const ymd = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// ICAL.Time → { allDay, date: 'YYYY-MM-DD', iso }
function convert(t) {
  if (t.isDate) return { allDay: true, date: ymd(t.year, t.month, t.day) };
  let dt;
  const zone = t.zone && t.zone.tzid;
  if (zone === 'UTC' || zone === 'Z') {
    dt = new Date(Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second));
  } else {
    // TZID or floating time: read it as wall-clock time in its own zone (default: site zone)
    const tzid = t.timezone || (zone && zone !== 'floating' ? zone : TZ);
    let z = TZ;
    try { new Intl.DateTimeFormat('en-US', { timeZone: tzid }); z = tzid; } catch { /* unknown → site zone */ }
    dt = wallToDate(t.year, t.month, t.day, t.hour, t.minute, t.second, z);
  }
  return { allDay: false, iso: dt.toISOString(), date: localDate(dt) };
}
function localDate(dt) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(dt);
  return p; // en-CA gives YYYY-MM-DD
}

// ---------- 3. Text helpers ----------
function cleanDescription(raw = '') {
  // Google sends descriptions as light HTML. Keep links and line breaks, drop everything else.
  let s = String(raw)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ');
  const links = [];
  s = s.replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, (_, href, text) => {
    links.push({ href, text: text.replace(/<[^>]+>/g, '') });
    return `\u0000${links.length - 1}\u0000`;
  });
  s = s.replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim();
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `[[${links[i].text}|${links[i].href}]]`);
  return s;
}

// Google Drive attachment → displayable image URL (file must be shared "anyone with the link").
function imageFromAttach(prop) {
  const url = prop.getFirstValue();
  const fmt = prop.getParameter('fmttype') || '';
  const name = prop.getParameter('filename') || '';
  const isImage = fmt.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(name) || /\.(png|jpe?g|gif|webp)(\?|$)/i.test(url);
  if (!isImage) return null;
  const m = url.match(/drive\.google\.com\/(?:open\?id=|file\/d\/|uc\?(?:[^&]*&)*id=)([\w-]+)/);
  return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w600` : url;
}
function attachments(comp) {
  const out = { image: null, files: [] };
  for (const p of comp.getAllProperties('attach')) {
    const img = imageFromAttach(p);
    if (img && !out.image) out.image = img;
    else out.files.push({ name: p.getParameter('filename') || 'Attachment', url: p.getFirstValue() });
  }
  return out;
}

// Default flyer per event series, from config.images: { "Torah Studies": "img/torah-studies.jpg" }
function seriesImage(title) {
  const t = title.toLowerCase();
  for (const [key, img] of Object.entries(config.images || {})) if (img && t.startsWith(key.toLowerCase())) return img;
  return null;
}

// The event series' own page on jewishcarrollton.org, from config.links (title prefix → URL)
function seriesPage(title) {
  const t = title.toLowerCase();
  for (const [key, url] of Object.entries(config.links || {})) if (url && t.startsWith(key.toLowerCase())) return url;
  return null;
}

// RSVP / registration link: first link whose text or URL looks like signup, else none.
function findRsvp(desc) {
  const re = /\[\[([^|\]]*)\|([^\]]+)\]\]/g;
  let m;
  while ((m = re.exec(desc))) {
    if (/rsvp|register|registration|sign ?up|tickets?|reserve/i.test(m[1] + ' ' + m[2])) return m[2];
  }
  const bare = desc.match(/https?:\/\/\S*(rsvp|register|registration|signup|events?\/)\S*/i);
  return bare ? bare[0].replace(/[).,]+$/, '') : null;
}

// ---------- 4. Expand events ----------
function buildEvents(icsText, from, to) {
  const vcal = new ICAL.Component(ICAL.parse(icsText));
  for (const tz of vcal.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz);

  const byUid = new Map();
  for (const ve of vcal.getAllSubcomponents('vevent')) {
    const uid = ve.getFirstPropertyValue('uid');
    if (!byUid.has(uid)) byUid.set(uid, { master: null, exceptions: [] });
    if (ve.hasProperty('recurrence-id')) byUid.get(uid).exceptions.push(ve);
    else byUid.get(uid).master = ve;
  }

  const out = [];
  const push = (comp, start, end, uid) => {
    if ((comp.getFirstPropertyValue('status') || '').toUpperCase() === 'CANCELLED') return;
    const title = (comp.getFirstPropertyValue('summary') || 'Event').trim();
    const desc = cleanDescription(comp.getFirstPropertyValue('description') || '');
    const s = convert(start), e = end ? convert(end) : null;
    const att = attachments(comp);
    out.push({
      id: `${uid}_${s.iso || s.date}`.replace(/[^\w-]/g, ''),
      title,
      allDay: s.allDay,
      date: s.date,
      start: s.iso || null,
      // all-day DTEND is exclusive in iCal; store the inclusive last day
      endDate: s.allDay && e ? prevDay(e.date) : (e ? e.date : s.date),
      end: e && e.iso ? e.iso : null,
      location: (comp.getFirstPropertyValue('location') || '').trim(),
      description: desc,
      image: att.image || seriesImage(title),
      files: att.files,
      rsvp: findRsvp(desc),
      page: seriesPage(title),
    });
  };

  for (const [uid, { master, exceptions }] of byUid) {
    if (!master) { exceptions.forEach(x => { const ev = new ICAL.Event(x); push(x, ev.startDate, ev.endDate, uid); }); continue; }
    const ev = new ICAL.Event(master);
    exceptions.forEach(x => ev.relateException(x));
    if (!ev.isRecurring()) {
      const s = convert(ev.startDate);
      if (s.date >= from && s.date <= to) push(master, ev.startDate, ev.endDate, uid);
      continue;
    }
    const it = ev.iterator();
    let next, guard = 0;
    while ((next = it.next()) && guard++ < 2000) {
      const occ = ev.getOccurrenceDetails(next);
      const s = convert(occ.startDate);
      if (s.date > to) break;
      if (s.date < from) continue;
      push(occ.item.component, occ.startDate, occ.endDate, uid);
    }
  }
  out.sort((a, b) => (a.start || a.date + 'T00').localeCompare(b.start || b.date + 'T00'));
  return out;
}
function prevDay(d) {
  const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

// ---------- 5. Jewish calendar: Hebrew dates, holidays, zmanim ----------
function jewishCalendar(from, to) {
  const loc = new Location(config.location.latitude, config.location.longitude, false, TZ,
    config.location.name, 'US', undefined, config.location.elevation || 0);
  const start = new Date(from + 'T12:00:00Z'), end = new Date(to + 'T12:00:00Z');
  const evs = HebrewCalendar.calendar({
    start, end, location: loc, candlelighting: true, sedrot: true, il: false,
    candleLightingMins: config.candleLightingMins, havdalahMins: config.havdalahMins || undefined,
    havdalahDeg: config.havdalahMins ? undefined : 8.5, noModern: false, locale: 'en',
  });
  const days = {};
  const day = (d) => (days[d] ||= { heb: '', holidays: [], candles: null, havdalah: null, parsha: null });

  // Hebrew date for every day in range
  for (let t = new Date(start); t <= end; t.setUTCDate(t.getUTCDate() + 1)) {
    const d = t.toISOString().slice(0, 10);
    const hd = new HDate(new Date(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
    day(d).heb = `${gematriya(hd.getDate())} ${Locale.gettext(hd.getMonthName(), 'he-x-NoNikud')}`;
    day(d).hy = gematriya(hd.getFullYear() % 1000);
  }
  for (const e of evs) {
    const g = e.getDate().greg();
    const d = ymd(g.getFullYear(), g.getMonth() + 1, g.getDate());
    const f = e.getFlags();
    if (e.getDesc() === 'Havdalah') {
      day(d).havdalah = e.eventTime ? e.eventTime.toISOString() : null;
    } else if (e.getDesc() === 'Candle lighting') {
      day(d).candles = e.eventTime ? e.eventTime.toISOString() : null;
    } else if (/^Chanukah: \d+ Candles?$/.test(e.getDesc())) {
      const n = parseInt(e.getDesc().match(/\d+/)[0], 10);
      day(d).holidays.push({ en: `Chanukah – light ${n} candle${n > 1 ? 's' : ''}`, he: `חנוכה – נר ${gematriya(n)}`, major: false, chanukah: n });
    } else if (f & flags.PARSHA_HASHAVUA) {
      day(d).parsha = e.render('he-x-NoNikud').replace(/^פרשת\s*/, '');
      day(d).parshaEn = e.render('en');
    } else if (!(f & (flags.DAF_YOMI | flags.OMER_COUNT | flags.MOLAD | flags.SHABBAT_MEVARCHIM | flags.USER_EVENT))) {
      if (f & flags.MODERN_HOLIDAY) continue;
      day(d).holidays.push({ en: e.render('en'), he: e.render('he-x-NoNikud'), major: !!(f & (flags.CHAG | flags.MAJOR_FAST)) });
    }
  }
  return days;
}

// ---------- 6. Run ----------
const now = new Date();
const from = localDate(new Date(now.getTime() - config.daysBack * 864e5)).slice(0, 8) + '01';
const to = localDate(new Date(now.getTime() + config.daysAhead * 864e5));

const ics = await loadIcs();
let events = buildEvents(ics, from, to);
const busyOnly = events.length > 0 && events.every(e => e.title === 'Busy');
if (busyOnly) {
  console.error('Every event in the feed is titled "Busy". The calendar is shared as free/busy only.\n' +
    'Set it to "See all event details", or put the secret iCal address in the CAL_ICS_URL secret.');
  process.exit(1);
}
// Readable, stable names for links: "torah-studies-nov-25" (year added only if needed)
const MON = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const used = new Set();
for (const e of events) {
  const base = e.title.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/, '') || 'event';
  const [y, m, d] = e.date.split('-');
  let slug = `${base}-${MON[+m - 1]}-${+d}`;
  if (used.has(slug)) slug += `-${y}`;
  if (used.has(slug)) slug += `-${(e.start || '').slice(11, 16).replace(':', '')}`;
  used.add(slug);
  e.slug = slug;
}

// Leave off the website: events set to "Private" in Google Calendar (the public feed shows
// them as "Busy"), and anything listed in config.hide by its link name, e.g. "challah-bake-dec-17".
const hidden = new Set(config.hide || []);
const before = events.length;
events = events.filter(e => !(e.title === 'Busy' && !e.description) && !hidden.has(e.slug));
if (before !== events.length) console.log(`Hid ${before - events.length} event(s).`);

const data = { generated: now.toISOString(), timezone: TZ, from, to, site: config.site, events, days: jewishCalendar(from, to) };
await fs.mkdir(path.join(root, 'site'), { recursive: true });
await fs.writeFile(path.join(root, 'site', 'events.json'), JSON.stringify(data));

// One tiny page per event at e/<slug>/ so links shared on WhatsApp/Facebook show the
// flyer, title and date as a preview, then forward to the calendar on the website.
const shareDir = path.join(root, 'site', 'e');
await fs.rm(shareDir, { recursive: true, force: true });
const he = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (opts, iso) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...opts }).format(new Date(iso));
const calUrl = config.site.calendarUrl;
for (const e of events) {
  const when = e.allDay
    ? fmt({ weekday: 'short', month: 'short', day: 'numeric' }, e.date + 'T12:00:00Z')
    : `${fmt({ weekday: 'short', month: 'short', day: 'numeric' }, e.start)} · ${fmt({ hour: 'numeric', minute: '2-digit' }, e.start).replace(':00', '').replace(' ', '').toLowerCase()}`;
  const heb = (data.days[e.date] || {}).heb || '';
  const desc = e.description.replace(/\[\[([^|\]]*)\|[^\]]+\]\]/g, '$1').replace(/\s+/g, ' ').trim();
  const shortDesc = desc.length > 160 ? desc.slice(0, 157).replace(/\s\S*$/, '') + '…' : desc;
  const img = e.image ? (/^https?:/.test(e.image) ? e.image : calUrl + e.image) : calUrl + 'img/og-default.jpg';
  const target = `${config.site.pageUrl || calUrl}#${e.slug}`;
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>${he(e.title)} – ${he(when)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${he(config.site.name)}">
<meta property="og:title" content="${he(e.title)} – ${he(when)}">
<meta property="og:description" content="${he(shortDesc || heb + ' · ' + config.site.name)}">
<meta property="og:image" content="${he(img)}">
<meta property="og:url" content="${he(calUrl + 'e/' + e.slug + '/')}">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="${he(target)}">
<meta http-equiv="refresh" content="0;url=${he(target)}">
<style>body{font:16px system-ui,sans-serif;text-align:center;padding:40px 16px;color:#333}a{color:#f04a26}</style>
</head><body><p>Opening <a href="${he(target)}">${he(e.title)}</a>…</p>
<script>location.replace(${JSON.stringify(target)});</script></body></html>`;
  await fs.mkdir(path.join(shareDir, e.slug), { recursive: true });
  await fs.writeFile(path.join(shareDir, e.slug, 'index.html'), html);
}
console.log(`Wrote ${events.length} share pages.`);

// ---------- Collection pages: one link for a group of events (e.g. /chanukah/) ----------
// Each gets a page listing the events with "+ Google Calendar" per event, plus one .ics file
// with all of them ("Add all" – iPhone/Outlook ask once to add every event).
function icsEsc(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => '\\' + m); }
function icsFold(line) { const out = []; while (line.length > 74) { out.push(line.slice(0, 74)); line = ' ' + line.slice(74); } out.push(line); return out.join('\r\n'); }
const stamp = (iso) => iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const dstamp = (d, add = 0) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + add); return t.toISOString().slice(0, 10).replace(/-/g, ''); };
const plainDesc = (s) => String(s || '').replace(/\[\[([^|\]]*)\|([^\]]+)\]\]/g, (_, t, u) => t ? `${t} (${u})` : u);
const rsvpFor = (e) => e.rsvp ? { href: e.rsvp, label: 'RSVP' }
  : /rsvp/i.test(e.location) ? { href: `mailto:${config.site.email}?subject=${encodeURIComponent('RSVP: ' + e.title)}&body=${encodeURIComponent(`Hi! I'd like to RSVP for ${e.title}. Please send me the location.\n\nName:\nNumber of people:\n`)}`, label: '✉️ RSVP for location' }
  : null;
function whenLong(e) {
  const day = fmt({ weekday: 'long', month: 'long', day: 'numeric' }, e.allDay ? e.date + 'T12:00:00Z' : e.start);
  if (e.allDay) return day;
  const t = (iso) => fmt({ hour: 'numeric', minute: '2-digit' }, iso).replace(':00', '').replace(' ', '').toLowerCase();
  return `${day} · ${t(e.start)}${e.end && e.end !== e.start ? '–' + t(e.end) : ''}`;
}
function googleUrl(e) {
  const dates = e.allDay ? `${dstamp(e.date)}/${dstamp(e.endDate || e.date, 1)}`
    : `${stamp(e.start)}/${stamp(e.end && e.end !== e.start ? e.end : new Date(new Date(e.start).getTime() + 36e5).toISOString())}`;
  return 'https://calendar.google.com/calendar/render?' + new URLSearchParams({ action: 'TEMPLATE', text: e.title, dates, details: plainDesc(e.description), location: /rsvp/i.test(e.location) ? '' : e.location, ctz: TZ });
}
for (const [key, col] of Object.entries(config.collections || {})) {
  const evs = col.events.map(slug => events.find(e => e.slug === slug)).filter(Boolean);
  const missing = col.events.filter(slug => !events.some(e => e.slug === slug));
  if (missing.length) console.warn(`Collection "${key}": not found (renamed or removed?): ${missing.join(', ')}`);
  if (!evs.length) continue;
  const dir = path.join(root, 'site', key);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  // all-in-one calendar file
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Chabad of Carrollton-Lewisville//Events//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsEsc(col.title)}`];
  for (const e of evs) {
    lines.push('BEGIN:VEVENT', `UID:${e.slug}@jewishcarrollton.org`, `DTSTAMP:${stamp(now.toISOString())}`);
    if (e.allDay) lines.push(`DTSTART;VALUE=DATE:${dstamp(e.date)}`, `DTEND;VALUE=DATE:${dstamp(e.endDate || e.date, 1)}`);
    else lines.push(`DTSTART:${stamp(e.start)}`, `DTEND:${stamp(e.end && e.end !== e.start ? e.end : new Date(new Date(e.start).getTime() + 36e5).toISOString())}`);
    lines.push(`SUMMARY:${icsEsc(e.title)}`, `DESCRIPTION:${icsEsc(plainDesc(e.description) + `\n\n${calUrl}e/${e.slug}/`)}`);
    if (e.location && !/rsvp/i.test(e.location)) lines.push(`LOCATION:${icsEsc(e.location)}`);
    if (!e.allDay) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(e.title)}`, 'TRIGGER:-PT2H', 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  await fs.writeFile(path.join(dir, `${key}.ics`), lines.map(icsFold).join('\r\n') + '\r\n');

  const img = calUrl + (col.image || 'img/og-default.jpg');
  const cards = evs.map(e => {
    const r = rsvpFor(e);
    const pic = e.image ? (/^https?:/.test(e.image) ? e.image : '../' + e.image) : '../img/og-default.jpg';
    const desc = plainDesc(e.description).replace(/\s+/g, ' ').trim();
    return `<article class="card">
  <img src="${he(pic)}" alt="">
  <div class="body">
    <h2>${he(e.title)}</h2>
    <div class="when">${he(whenLong(e))}</div>
    <div class="heb" dir="rtl">${he((data.days[e.date] || {}).heb || '')}</div>
    ${e.location && !/rsvp/i.test(e.location) ? `<div class="where">📍 ${he(e.location)}</div>` : ''}
    ${desc ? `<p>${he(desc.length > 220 ? desc.slice(0, 217).replace(/\s\S*$/, '') + '…' : desc)}</p>` : ''}
    <div class="btns">
      ${r ? `<a class="btn solid" href="${he(r.href)}">${he(r.label)}</a>` : ''}
      <a class="btn" href="${he(googleUrl(e))}" target="_blank" rel="noopener">+ Google Calendar</a>
      ${e.page ? `<a class="btn" href="${he(e.page)}">More info →</a>` : ''}
    </div>
  </div>
</article>`;
  }).join('\n');
  const page = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${he(col.title)} – ${he(config.site.name)}</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="${he(config.site.name)}">
<meta property="og:title" content="${he(col.title)}">
<meta property="og:description" content="${he(evs.map(e => `${e.title.replace(/ - .*/, '')} (${fmt({ weekday: 'short', month: 'short', day: 'numeric' }, e.allDay ? e.date + 'T12:00:00Z' : e.start)})`).join(' · '))}">
<meta property="og:image" content="${he(img)}">
<meta property="og:url" content="${he(calUrl + key + '/')}">
<meta name="twitter:card" content="summary_large_image">
<link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&family=Frank+Ruhl+Libre:wght@500&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}body{margin:0;background:#f7f3ec;color:#222;font:16px/1.45 Roboto,system-ui,sans-serif}
.wrap{max-width:640px;margin:0 auto;padding:0 14px 40px}.bar{height:6px;background:#f04a26}
header{text-align:center;padding:26px 6px 14px}h1{margin:0;color:#f04a26;font-size:30px}
header p{margin:6px 0 0;color:#444}
.all{display:block;text-align:center;margin:16px auto 6px;max-width:420px;background:#f04a26;color:#fff;text-decoration:none;font-weight:700;font-size:18px;padding:14px 18px;border-radius:30px;box-shadow:0 3px 10px rgba(240,74,38,.3)}
.note{text-align:center;font-size:13px;color:#777;margin:0 0 18px}
.card{background:#fff;border-radius:10px;overflow:hidden;margin:14px 0;box-shadow:0 2px 10px rgba(0,0,0,.08);display:grid;grid-template-columns:150px 1fr}
.card img{width:150px;height:150px;object-fit:cover;display:block}.body{padding:12px 14px}
h2{margin:0 0 4px;font-size:19px;color:#f04a26;font-weight:500}.when{font-weight:700}
.heb{font-family:'Frank Ruhl Libre',serif;color:#b7862b;text-align:left}.where{color:#666;font-size:14px}
.card p{margin:6px 0 0;font-size:14px;color:#444}
.btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.btn{font-size:14px;border:1px solid #f04a26;color:#f04a26;border-radius:16px;padding:5px 12px;text-decoration:none;background:#fff}
.btn.solid{background:#f04a26;color:#fff}
.more{display:block;text-align:center;margin-top:22px;color:#f04a26}
@media(max-width:520px){.card{grid-template-columns:1fr}.card img{width:100%;height:auto;aspect-ratio:1}}
</style></head><body><div class="bar"></div><div class="wrap">
<header><h1>${he(col.title)}</h1>${col.subtitle ? `<p>${he(col.subtitle)}</p>` : ''}</header>
<a class="all" href="${he(key)}.ics">📅 Add all ${evs.length} to my calendar</a>
<p class="note">iPhone &amp; Outlook: adds every event at once. Android: use “+ Google Calendar” on each event.</p>
${cards}
<a class="more" href="${he(config.site.pageUrl || calUrl)}">See the full calendar →</a>
</div></body></html>`;
  await fs.writeFile(path.join(dir, 'index.html'), page);
  console.log(`Collection "${key}": ${evs.length} events → ${calUrl}${key}/`);
}
console.log(`Wrote ${events.length} events (${from} → ${to}).`);
