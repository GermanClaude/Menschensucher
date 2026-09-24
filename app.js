"use strict";
/*
 * Personensuche – läuft komplett im Browser, ohne eigenen Server.
 * Quellen (alle öffentlich, legal, mit CORS-Freigabe):
 *   Wikidata + Wikipedia   Steckbrief, Ämter, Auszeichnungen, Werke, Lebenslauf
 *   lobid.org (DNB/GND)    Normdaten der Deutschen Nationalbibliothek
 *   OpenAlex + ORCID       wissenschaftliche Veröffentlichungen
 *   GDELT                  weltweite Nachrichten der letzten 3 Monate
 *   Internet Archive       Bücher, Filme, Audio, Dokumente
 *   Websuche               gesamtes öffentliches Internet (DuckDuckGo über Jina Reader, optional Google via Serper,
 *                          Tavily oder Jina mit eigenem Schlüssel) + Auslesen gefundener Seiten
 * Bewusst NICHT enthalten: Personensuchmaschinen/Datenhändler, Leak-Datenbanken, Gesichtserkennung.
 */

const $ = (s, root = document) => root.querySelector(s);

// ------------------------------------------------------------------ DOM-Helfer (kein innerHTML mit Fremddaten)
function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}
const fill = (node, ...children) => node.replaceChildren(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
const extLink = (href, text) => h("a", {href, target: "_blank", rel: "noopener noreferrer"}, text || href);

// ------------------------------------------------------------------ Netzwerk
async function getJSON(url, {timeout = 20000, headers, method, body} = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {signal: ctrl.signal, headers, method, body});
    const text = await res.text();
    if (res.status === 429) throw new Error("Zu viele Anfragen – bitte kurz warten und erneut suchen.");
    if (res.status === 401 || res.status === 403) throw new Error(`Zugriff verweigert (HTTP ${res.status}) – API-Schlüssel prüfen`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    try { return JSON.parse(text); } catch { throw new Error(text.slice(0, 160) || "Ungültige Antwort"); }
  } catch (err) {
    if (err.name === "AbortError") throw new Error("Zeitüberschreitung");
    if (err instanceof TypeError) throw new Error("Quelle nicht erreichbar");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
const qs = (params) => new URLSearchParams(params).toString();
const WD_API = "https://www.wikidata.org/w/api.php";
const wikiApi = (lang) => `https://${lang}.wikipedia.org/w/api.php`;

// ------------------------------------------------------------------ Karten/Abschnitte
function card(id, title) {
  const status = h("span", {class: "status"}, h("span", {class: "spinner"}), " lädt …");
  const body = h("div", {class: "sec-body"});
  const node = h("section", {class: "card", id: "sec-" + id}, h("div", {class: "sec-head"}, h("h2", {}, title), status), body);
  return {
    node, body,
    loading() { node.hidden = false; status.className = "status"; status.replaceChildren(h("span", {class: "spinner"}), " lädt …"); body.replaceChildren(); },
    done(text = "") { status.className = "status"; status.textContent = text; },
    fail(err) { status.className = "status err"; status.textContent = "Fehler"; body.replaceChildren(h("p", {class: "empty"}, `Quelle nicht verfügbar: ${err.message || err}`)); },
    empty(msg) { status.className = "status"; status.textContent = "keine Treffer"; body.replaceChildren(h("p", {class: "empty"}, msg)); },
    hide() { node.hidden = true; status.textContent = ""; },
  };
}

// ------------------------------------------------------------------ Wikidata
const labelCache = new Map();

async function getEntities(ids, props = "labels|descriptions|claims|sitelinks") {
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const data = await getJSON(`${WD_API}?${qs({action: "wbgetentities", ids: chunk.join("|"), props,
      languages: "de|en", format: "json", origin: "*"})}`);
    Object.assign(out, data.entities || {});
  }
  return out;
}

function labelOf(entity) {
  return entity?.labels?.de?.value || entity?.labels?.en?.value || Object.values(entity?.labels || {})[0]?.value || entity?.id || "";
}
function descOf(entity) {
  return entity?.descriptions?.de?.value || entity?.descriptions?.en?.value || "";
}

async function loadLabels(ids) {
  const missing = [...new Set(ids)].filter((id) => id && !labelCache.has(id));
  if (!missing.length) return;
  const ents = await getEntities(missing, "labels");
  for (const [id, e] of Object.entries(ents)) labelCache.set(id, labelOf(e));
}
const L = (id) => labelCache.get(id) || id;

function claims(entity, prop) {
  const all = (entity.claims?.[prop] || []).filter((c) => c.rank !== "deprecated" && c.mainsnak?.snaktype === "value");
  const preferred = all.filter((c) => c.rank === "preferred");
  return {all, best: preferred.length ? preferred : all};
}
const val = (c) => c.mainsnak.datavalue.value;
const itemIds = (entity, prop) => claims(entity, prop).all.map((c) => val(c).id).filter(Boolean);
const strings = (entity, prop) => claims(entity, prop).best.map(val).filter((v) => typeof v === "string");
const qual = (c, prop) => c.qualifiers?.[prop]?.find((q) => q.snaktype === "value")?.datavalue?.value;

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
function formatTime(t) {
  if (!t?.time) return "";
  const m = /^([+-])(\d+)-(\d\d)-(\d\d)/.exec(t.time);
  if (!m) return "";
  const year = parseInt(m[2], 10), month = parseInt(m[3], 10), day = parseInt(m[4], 10);
  const bc = m[1] === "-" ? " v. Chr." : "";
  const p = t.precision;
  if (p >= 11 && day) return `${day}. ${MONTHS[month - 1]} ${year}${bc}`;
  if (p === 10 && month) return `${MONTHS[month - 1]} ${year}${bc}`;
  if (p === 9) return `${year}${bc}`;
  if (p === 8) return `${Math.floor(year / 10) * 10}er${bc}`;
  if (p === 7) return `${Math.ceil(year / 100)}. Jh.${bc}`;
  return `${year}${bc}`;
}
const yearOf = (t) => (t?.time ? parseInt(t.time.slice(0, 5), 10) : NaN);

function ageOf(birth, death) {
  if (!birth || birth.precision < 11) return "";
  const [by, bm, bd] = birth.time.slice(1, 11).split("-").map(Number);
  let end;
  if (death) {
    if (death.precision < 11) return "";
    const [dy, dm, dd] = death.time.slice(1, 11).split("-").map(Number);
    end = {y: dy, m: dm, d: dd};
  } else {
    const now = new Date();
    end = {y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate()};
  }
  const age = end.y - by - ((end.m < bm || (end.m === bm && end.d < bd)) ? 1 : 0);
  return age >= 0 && age < 130 ? `${age} Jahre` : "";
}

// Offizielle Profile & Kennungen aus Wikidata: Eigenschaft → Link
const PROFILE_PROPS = [
  ["P856", "Website", (v) => v],
  ["P2002", "X (Twitter)", (v) => `https://x.com/${v}`],
  ["P2003", "Instagram", (v) => `https://www.instagram.com/${v}/`],
  ["P2013", "Facebook", (v) => `https://www.facebook.com/${v}`],
  ["P2397", "YouTube", (v) => `https://www.youtube.com/channel/${v}`],
  ["P7085", "TikTok", (v) => `https://www.tiktok.com/@${v}`],
  ["P6634", "LinkedIn", (v) => `https://www.linkedin.com/in/${v}`],
  ["P4033", "Mastodon", (v) => { const [u, host] = v.split("@"); return host ? `https://${host}/@${u}` : null; }],
  ["P2037", "GitHub", (v) => `https://github.com/${v}`],
  ["P345", "IMDb", (v) => `https://www.imdb.com/name/${v}/`],
  ["P434", "MusicBrainz", (v) => `https://musicbrainz.org/artist/${v}`],
  ["P1960", "Google Scholar", (v) => `https://scholar.google.com/citations?user=${v}`],
  ["P496", "ORCID", (v) => `https://orcid.org/${v}`],
  ["P227", "GND (DNB)", (v) => `https://d-nb.info/gnd/${v}`],
  ["P214", "VIAF", (v) => `https://viaf.org/viaf/${v}`],
  ["P373", "Wikimedia Commons", (v) => `https://commons.wikimedia.org/wiki/Category:${encodeURIComponent(v.replace(/ /g, "_"))}`],
];

// Stichwort-Eigenschaften für den Steckbrief
const FACT_PROPS = [
  ["P27", "Staatsangehörigkeit"], ["P106", "Tätigkeit"], ["P101", "Fachgebiet"], ["P69", "Ausbildung"],
  ["P108", "Arbeitgeber"], ["P102", "Partei"], ["P463", "Mitglied von"], ["P641", "Sportart"],
  ["P413", "Position"], ["P136", "Genre"], ["P1303", "Instrument"], ["P264", "Label"], ["P140", "Religion"],
];

// Für den Lebenslauf: Eigenschaft → Art des Eintrags
const TIMELINE_PROPS = [
  ["P39", "Amt"], ["P108", "Arbeitgeber"], ["P54", "Mannschaft"], ["P102", "Partei"],
  ["P463", "Mitgliedschaft"], ["P69", "Ausbildung"], ["P1416", "Zugehörigkeit"],
];

// ------------------------------------------------------------------ Kandidaten finden
async function findPeople(name, ctx) {
  const ids = new Set();
  const search = await getJSON(`${WD_API}?${qs({action: "wbsearchentities", search: name, language: "de", uselang: "de",
    type: "item", limit: 20, format: "json", origin: "*"})}`);
  (search.search || []).forEach((r) => ids.add(r.id));

  // Zusätzlich über die Wikipedia-Volltextsuche (findet auch Schreibvarianten und Kontext).
  try {
    const wp = await getJSON(`${wikiApi("de")}?${qs({action: "query", generator: "search", gsrsearch: `${name} ${ctx}`.trim(),
      gsrlimit: 8, prop: "pageprops", ppprop: "wikibase_item", format: "json", formatversion: 2, origin: "*"})}`);
    (wp.query?.pages || []).forEach((p) => p.pageprops?.wikibase_item && ids.add(p.pageprops.wikibase_item));
  } catch { /* optional */ }

  if (!ids.size) return [];
  const entities = await getEntities([...ids]);
  const words = ctx.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const nameWords = name.toLowerCase().split(/\s+/).filter(Boolean);
  const people = Object.values(entities).filter((e) => !e.missing && itemIds(e, "P31").includes("Q5"));

  const scored = people.map((e, order) => {
    const text = `${labelOf(e)} ${descOf(e)}`.toLowerCase();
    const label = labelOf(e).toLowerCase();
    const nameHit = nameWords.every((w) => label.includes(w)) ? 1 : 0;
    const ctxHits = words.filter((w) => text.includes(w)).length;
    const popularity = Object.keys(e.sitelinks || {}).length;
    return {e, score: ctxHits * 10000 + nameHit * 5000 + popularity, order};
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.map((s) => s.e);
}

// ------------------------------------------------------------------ Suche
let searchSeq = 0;
let personSeq = 0;
let S = null; // Karten der aktuellen Suche

async function runSearch(name, ctx = "") {
  name = name.trim(); ctx = ctx.trim();
  if (name.length < 3) return;
  const seq = ++searchSeq;
  setHash({name, ctx});
  document.title = `${name} – Personensuche`;

  const results = $("#results");
  const cands = $("#candidates");
  cands.hidden = true; cands.replaceChildren();

  S = {
    profile: card("profile", "Steckbrief"),
    web: card("web", "Im Internet gefunden"),
    wiki: card("wiki", "Leben & Wirken (Wikipedia)"),
    timeline: card("timeline", "Ämter, Funktionen & Stationen"),
    awards: card("awards", "Auszeichnungen & Ehrungen"),
    works: card("works", "Bekannte Werke & Leistungen"),
    news: card("news", "Aktuelle Nachrichten (letzte 3 Monate)"),
    gnd: card("gnd", "Deutsche Nationalbibliothek (GND)"),
    science: card("science", "Wissenschaftliche Veröffentlichungen"),
    archive: card("archive", "Internet Archive (Bücher, Medien, Dokumente)"),
    links: card("links", "Weiterführende Suchen in legalen Quellen"),
  };
  results.replaceChildren(
    h("div", {class: "warnbar"}, "Achtung Namensgleichheit: Treffer aus Nachrichten, Archiven und Datenbanken werden nur über den Namen gefunden und können andere Personen betreffen. Bitte jeden Treffer prüfen."),
    h("div", {class: "toolbar"},
      h("button", {class: "btn", type: "button", onclick: () => window.print()}, "Drucken / als PDF speichern"),
      h("button", {class: "btn", type: "button", onclick: copyShareLink}, "Link zu dieser Suche kopieren")),
    ...Object.values(S).map((c) => c.node));

  renderLinks(S.links, name, ctx);
  loadWeb(S.web, name, ctx, seq);
  loadNews(S.news, name, ctx, seq);
  loadArchive(S.archive, name, seq);

  let people = [];
  try {
    people = await findPeople(name, ctx);
  } catch (err) {
    if (seq !== searchSeq) return;
    S.profile.fail(err);
  }
  if (seq !== searchSeq) return;

  if (!people.length) {
    if (!S.profile.node.querySelector(".empty")) {
      S.profile.empty("Kein Eintrag in Wikipedia/Wikidata – die Person ist nicht als Person des öffentlichen Lebens erfasst. " +
        "Ihre Websites, Profile und Firmen findest du unten unter „Im Internet gefunden“. Bei Privatpersonen gilt: nur suchen, wenn du einen berechtigten Grund hast.");
    }
    S.wiki.hide(); S.timeline.hide(); S.awards.hide(); S.works.hide();
    loadGnd(S.gnd, {name}, seq);
    loadScience(S.science, {name}, seq);
    return;
  }

  if (people.length > 1) {
    cands.hidden = false;
    cands.append(h("span", {class: "label"}, `${people.length} Personen gefunden – wähle die richtige:`));
    people.slice(0, 12).forEach((p, i) => {
      const chip = h("button", {class: "chip" + (i === 0 ? " active" : ""), type: "button", onclick: () => {
        cands.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === chip));
        showPerson(p, name, seq);
      }}, labelOf(p), descOf(p) ? h("small", {}, " – " + descOf(p)) : null);
      cands.append(chip);
    });
  }
  showPerson(people[0], name, seq);
}

async function showPerson(entity, searchedName, seq) {
  const pseq = ++personSeq;
  const alive = () => seq === searchSeq && pseq === personSeq;
  for (const c of [S.profile, S.wiki, S.timeline, S.awards, S.works, S.gnd, S.science]) c.loading();

  // Alle referenzierten Einträge (Orte, Ämter, Parteien …) auf einmal beschriften.
  const refs = [];
  const collect = (prop) => claims(entity, prop).all.forEach((c) => {
    const v = val(c); if (v?.id) refs.push(v.id);
    for (const q of Object.values(c.qualifiers || {}).flat()) if (q.datavalue?.value?.id) refs.push(q.datavalue.value.id);
  });
  ["P19", "P20", "P166", "P800", ...FACT_PROPS.map((p) => p[0]), ...TIMELINE_PROPS.map((p) => p[0])].forEach(collect);
  try { await loadLabels(refs); } catch { /* Beschriftungen sind optional, IDs bleiben lesbar */ }
  if (!alive()) return;

  renderProfile(S.profile, entity);
  renderTimeline(S.timeline, entity);
  renderAwards(S.awards, entity);
  renderWorks(S.works, entity);
  loadWikipedia(S.wiki, entity, alive);

  const person = {
    name: labelOf(entity) || searchedName,
    gnd: strings(entity, "P227")[0],
    orcid: strings(entity, "P496")[0],
  };
  loadGnd(S.gnd, person, seq, alive);
  loadScience(S.science, person, seq, alive);
}

// ------------------------------------------------------------------ Steckbrief
function renderProfile(c, e) {
  const facts = h("dl", {class: "facts"});
  const add = (label, ...value) => { if (value.flat().some((v) => v !== "" && v != null)) facts.append(h("dt", {}, label), h("dd", {}, ...value)); };

  const birth = claims(e, "P569").best[0], death = claims(e, "P570").best[0];
  const birthT = birth && val(birth), deathT = death && val(death);
  const place = (prop) => itemIds(e, prop).map(L)[0];
  if (birthT) add("Geboren", formatTime(birthT), place("P19") ? ` in ${place("P19")}` : "", !deathT && ageOf(birthT) ? ` (${ageOf(birthT)})` : "");
  if (deathT) add("Gestorben", formatTime(deathT), place("P20") ? ` in ${place("P20")}` : "", ageOf(birthT, deathT) ? ` (${ageOf(birthT, deathT)})` : "");
  for (const [prop, label] of FACT_PROPS) {
    const vals = [...new Set(itemIds(e, prop).map(L))];
    if (vals.length) add(label, vals.slice(0, 12).join(", ") + (vals.length > 12 ? ` … (+${vals.length - 12})` : ""));
  }

  const profileLinks = [];
  for (const [prop, label, toUrl] of PROFILE_PROPS) {
    for (const v of strings(e, prop).slice(0, 2)) {
      const url = toUrl(v);
      if (url && /^https?:\/\//.test(url)) profileLinks.push(extLink(url, label));
    }
  }
  const wikiLinks = ["dewiki", "enwiki"].filter((k) => e.sitelinks?.[k]).map((k) =>
    extLink(`https://${k.slice(0, 2)}.wikipedia.org/wiki/${encodeURIComponent(e.sitelinks[k].title.replace(/ /g, "_"))}`, `Wikipedia (${k.slice(0, 2)})`));
  profileLinks.unshift(...wikiLinks, extLink(`https://www.wikidata.org/wiki/${e.id}`, "Wikidata"));
  add("Offizielle Profile & Quellen", ...profileLinks.flatMap((a, i) => (i ? [" · ", a] : [a])));

  const imgFile = strings(e, "P18")[0];
  const img = imgFile
    ? h("a", {href: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(imgFile.replace(/ /g, "_"))}`, target: "_blank", rel: "noopener noreferrer", title: "Bild, Urheber & Lizenz auf Wikimedia Commons"},
      h("img", {src: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(imgFile)}?width=320`, alt: `Foto: ${labelOf(e)}`, loading: "lazy"}))
    : null;

  fill(c.body, h("div", {class: "profile"}, img || h("div"),
    h("div", {}, h("h2", {}, labelOf(e)), h("p", {class: "desc"}, descOf(e)), facts)),
    h("p", {class: "source"}, "Quelle: Wikidata (CC0)", imgFile ? " · Foto: Wikimedia Commons (Lizenz siehe Bildseite)" : ""));
  if (!imgFile) c.body.querySelector(".profile").style.gridTemplateColumns = "1fr";
  c.done();
}

function renderTimeline(c, e) {
  const rows = [];
  for (const [prop, kind] of TIMELINE_PROPS) {
    for (const cl of claims(e, prop).all) {
      const v = val(cl);
      if (!v?.id) continue;
      const start = qual(cl, "P580"), end = qual(cl, "P582"), at = qual(cl, "P585");
      const of = qual(cl, "P642")?.id || qual(cl, "P2389")?.id; // „von“ / „Organisation“
      const district = qual(cl, "P768")?.id;
      const replaces = qual(cl, "P1365")?.id;
      const extra = [of && L(of), district && `Wahlkreis ${L(district)}`, replaces && `Vorgänger: ${L(replaces)}`].filter(Boolean).join(" · ");
      rows.push({kind, label: L(v.id), extra, start: start || at, end, sort: yearOf(start || at)});
    }
  }
  if (!rows.length) return c.hide();
  rows.sort((a, b) => (isNaN(a.sort) ? 1e9 : a.sort) - (isNaN(b.sort) ? 1e9 : b.sort));
  const when = (r) => r.start ? `${formatTime(r.start)}${r.end ? " – " + formatTime(r.end) : r.kind === "Amt" ? " – ?" : ""}` : (r.end ? `bis ${formatTime(r.end)}` : "");
  fill(c.body, h("ul", {class: "list timeline"}, rows.map((r) =>
    h("li", {}, h("span", {class: "when"}, when(r) || "—"),
      h("span", {}, h("strong", {}, r.label), " ", h("span", {class: "meta"}, `(${r.kind})`), r.extra ? h("div", {class: "meta"}, r.extra) : null)))),
  h("p", {class: "source"}, "Quelle: Wikidata"));
  c.done(`${rows.length} Einträge`);
}

function renderAwards(c, e) {
  const rows = claims(e, "P166").all.map((cl) => ({label: L(val(cl).id), t: qual(cl, "P585")})).filter((r) => r.label);
  if (!rows.length) return c.hide();
  rows.sort((a, b) => (yearOf(a.t) || 1e9) - (yearOf(b.t) || 1e9));
  fill(c.body, h("ul", {class: "list"}, rows.map((r) => h("li", {}, r.label, r.t ? h("span", {class: "meta"}, ` – ${formatTime(r.t)}`) : null))),
    h("p", {class: "source"}, "Quelle: Wikidata"));
  c.done(`${rows.length}`);
}

function renderWorks(c, e) {
  const works = [...new Set(itemIds(e, "P800").map(L))];
  if (!works.length) return c.hide();
  fill(c.body, h("ul", {class: "list"}, works.map((w) => h("li", {}, w))), h("p", {class: "source"}, "Quelle: Wikidata"));
  c.done(`${works.length}`);
}

// ------------------------------------------------------------------ Wikipedia
const SKIP_SECTIONS = /^(weblinks|einzelnachweise|anmerkungen|literatur|siehe auch|quellen|belege|references|external links|notes|see also|further reading|bibliography|sources)$/i;

async function loadWikipedia(c, e, alive) {
  const key = ["dewiki", "enwiki"].find((k) => e.sitelinks?.[k]);
  if (!key) return c.empty("Kein Wikipedia-Artikel vorhanden.");
  const lang = key.slice(0, 2), title = e.sitelinks[key].title;
  try {
    const data = await getJSON(`${wikiApi(lang)}?${qs({action: "query", prop: "extracts", explaintext: 1, exsectionformat: "wiki",
      redirects: 1, titles: title, format: "json", formatversion: 2, origin: "*"})}`);
    if (!alive()) return;
    const text = data.query?.pages?.[0]?.extract || "";
    if (!text) return c.empty("Artikel ist leer.");
    renderArticle(c, text, lang, title);
  } catch (err) { if (alive()) c.fail(err); }
}

function parseSections(text) {
  const parts = text.split(/^(={2,6})\s*(.+?)\s*\1\s*$/m);
  const lead = parts[0].trim();
  const sections = [];
  for (let i = 1; i < parts.length; i += 3) {
    const level = parts[i].length, title = parts[i + 1], body = (parts[i + 2] || "").trim();
    if (level === 2) sections.push({title, parts: [{sub: null, body}]});
    else if (sections.length) sections[sections.length - 1].parts.push({sub: title, body});
    else sections.push({title, parts: [{sub: null, body}]});
  }
  return {lead, sections: sections.filter((s) => !SKIP_SECTIONS.test(s.title) && s.parts.some((p) => p.body))};
}

function renderArticle(c, text, lang, title) {
  const {lead, sections} = parseSections(text);
  const url = `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  fill(c.body, 
    ...lead.split("\n").filter(Boolean).map((p) => h("p", {class: "lead"}, p)),
    ...sections.map((s, i) => h("details", {class: "wsec", open: i === 0 ? true : null},
      h("summary", {}, s.title),
      ...s.parts.flatMap((p) => [p.sub ? h("h3", {}, p.sub) : null, ...p.body.split("\n").filter(Boolean).map((t) => h("p", {}, t))]))),
    h("p", {class: "source"}, "Quelle: ", extLink(url, `Wikipedia – ${title}`), " (CC BY-SA 4.0)"));
  c.done(`${sections.length} Abschnitte`);
}

// ------------------------------------------------------------------ Nachrichten (GDELT)
function gdeltDate(s) {
  const m = /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)/.exec(s || "");
  return m ? `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]}` : "";
}
async function loadNews(c, name, ctx, seq) {
  c.loading();
  const query = `"${name.replace(/"/g, "")}"${ctx ? " " + ctx : ""}`;
  try {
    const data = await getJSON(`https://api.gdeltproject.org/api/v2/doc/doc?${qs({query, mode: "artlist", maxrecords: 40, format: "json", sort: "datedesc"})}`);
    if (seq !== searchSeq) return;
    const seen = new Set();
    const articles = (data.articles || []).filter((a) => { const k = a.title?.toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; });
    if (!articles.length) return c.empty("Keine Nachrichten der letzten 3 Monate. Ältere Berichte findest du über die Nachrichten-Links unten.");
    fill(c.body, h("ul", {class: "list"}, articles.slice(0, 25).map((a) => h("li", {},
      extLink(a.url, a.title), h("div", {class: "meta"}, [a.domain, gdeltDate(a.seendate), a.language].filter(Boolean).join(" · "))))),
    h("p", {class: "source"}, "Quelle: GDELT Project – weltweite Online-Nachrichten"));
    c.done(`${Math.min(articles.length, 25)} Artikel`);
  } catch (err) { if (seq === searchSeq) c.fail(err); }
}

// ------------------------------------------------------------------ GND (Deutsche Nationalbibliothek)
async function loadGnd(c, person, seq, alive = () => seq === searchSeq) {
  c.loading();
  try {
    let members;
    if (person.gnd) {
      members = [await getJSON(`https://lobid.org/gnd/${encodeURIComponent(person.gnd)}.json`)];
    } else {
      const data = await getJSON(`https://lobid.org/gnd/search?${qs({q: person.name, filter: "type:Person", format: "json", size: 6})}`);
      members = data.member || [];
    }
    if (!alive()) return;
    if (!members.length) return c.empty("Kein Eintrag in der Gemeinsamen Normdatei.");
    const labels = (arr) => (arr || []).map((x) => x.label || x).filter(Boolean).join(", ");
    fill(c.body, 
      person.gnd ? null : h("p", {class: "meta"}, "Treffer über den Namen – kann andere Personen gleichen Namens enthalten."),
      h("ul", {class: "list"}, members.map((m) => {
        const id = m.gndIdentifier || (m.id || "").split("/").pop();
        const facts = [
          m.dateOfBirth && `* ${m.dateOfBirth.join(", ")}`, m.placeOfBirth && `in ${labels(m.placeOfBirth)}`,
          m.dateOfDeath && `† ${m.dateOfDeath.join(", ")}`, m.placeOfDeath && `in ${labels(m.placeOfDeath)}`,
        ].filter(Boolean).join(" ");
        return h("li", {},
          h("strong", {}, m.preferredName || id), facts ? h("span", {class: "meta"}, ` (${facts})`) : null,
          m.professionOrOccupation ? h("div", {}, "Beruf: ", labels(m.professionOrOccupation)) : null,
          m.affiliation ? h("div", {}, "Zugehörigkeit: ", labels(m.affiliation)) : null,
          m.academicDegree ? h("div", {}, "Titel: ", m.academicDegree.join(", ")) : null,
          m.biographicalOrHistoricalInformation ? h("div", {class: "meta"}, m.biographicalOrHistoricalInformation.join(" ")) : null,
          h("div", {class: "meta"}, extLink(`https://d-nb.info/gnd/${id}`, "GND-Eintrag"), " · ",
            extLink(`https://portal.dnb.de/opac.htm?method=simpleSearch&cqlMode=true&query=${encodeURIComponent("nid=" + id)}`, "Bücher & Schriften von/über diese Person")));
      })),
      h("p", {class: "source"}, "Quelle: Deutsche Nationalbibliothek, Gemeinsame Normdatei (CC0) über lobid.org"));
    c.done(`${members.length}`);
  } catch (err) { if (alive()) c.fail(err); }
}

// ------------------------------------------------------------------ Wissenschaft (OpenAlex + ORCID)
async function loadScience(c, person, seq, alive = () => seq === searchSeq) {
  c.loading();
  const blocks = [];
  let failures = 0;

  try {
    let authors;
    if (person.orcid) {
      authors = [await getJSON(`https://api.openalex.org/authors/orcid:${encodeURIComponent(person.orcid)}`)];
    } else {
      const data = await getJSON(`https://api.openalex.org/authors?${qs({search: person.name, "per-page": 5})}`);
      const wanted = person.name.toLowerCase();
      authors = (data.results || []).filter((a) => a.works_count > 0)
        .sort((a, b) => (b.display_name.toLowerCase() === wanted) - (a.display_name.toLowerCase() === wanted) || b.works_count - a.works_count);
    }
    if (authors.length) {
      const top = authors[0];
      const works = await getJSON(`https://api.openalex.org/works?${qs({filter: `author.id:${top.id.split("/").pop()}`, sort: "cited_by_count:desc", "per-page": 8})}`);
      blocks.push(
        h("h3", {}, "Autor:innen-Profile (OpenAlex)"),
        person.orcid ? null : h("p", {class: "meta"}, "Treffer über den Namen – bitte Institution und Themen prüfen."),
        h("ul", {class: "list"}, authors.slice(0, 5).map((a) => h("li", {},
          extLink(a.id.replace("https://openalex.org/", "https://openalex.org/authors/"), a.display_name),
          h("div", {class: "meta"}, [
            (a.last_known_institutions || []).map((i) => i.display_name).join(", "),
            `${a.works_count} Werke`, `${a.cited_by_count} Zitationen`,
            (a.topics || []).slice(0, 3).map((t) => t.display_name).join(", "),
          ].filter(Boolean).join(" · "))))),
        (works.results || []).length ? h("h3", {}, `Meistzitierte Arbeiten von ${top.display_name}`) : null,
        h("ul", {class: "list"}, (works.results || []).map((w) => h("li", {},
          w.doi ? extLink(w.doi, w.title || w.display_name) : (w.title || w.display_name),
          h("div", {class: "meta"}, [w.publication_year, w.primary_location?.source?.display_name, `${w.cited_by_count} Zitationen`].filter(Boolean).join(" · "))))));
    }
  } catch { failures++; }

  try {
    const parts = person.name.trim().split(/\s+/);
    const family = parts.pop(), given = parts.join(" ");
    const q = given ? `given-names:${given} AND family-name:${family}` : `family-name:${family}`;
    const data = await getJSON(`https://pub.orcid.org/v3.0/expanded-search/?${qs({q, rows: 5})}`, {headers: {Accept: "application/json"}});
    const rows = data["expanded-result"] || [];
    if (rows.length) {
      blocks.push(h("h3", {}, "ORCID-Profile"), h("ul", {class: "list"}, rows.map((r) => h("li", {},
        extLink(`https://orcid.org/${r["orcid-id"]}`, `${r["given-names"] || ""} ${r["family-names"] || ""}`.trim()),
        r["institution-name"]?.length ? h("div", {class: "meta"}, r["institution-name"].slice(0, 3).join(" · ")) : null))));
    }
  } catch { failures++; }

  if (!alive()) return;
  if (blocks.length) {
    fill(c.body, ...blocks, h("p", {class: "source"}, "Quellen: OpenAlex (CC0), ORCID Public API"));
    c.done();
  } else if (failures === 2) {
    c.fail(new Error("OpenAlex und ORCID antworten gerade nicht."));
  } else {
    c.empty("Keine wissenschaftlichen Veröffentlichungen gefunden.");
  }
}

// ------------------------------------------------------------------ Internet Archive
async function loadArchive(c, name, seq) {
  c.loading();
  try {
    const params = new URLSearchParams({q: `"${name.replace(/"/g, "")}"`, rows: 15, output: "json"});
    ["identifier", "title", "mediatype", "year", "creator"].forEach((f) => params.append("fl[]", f));
    params.append("sort[]", "downloads desc");
    const data = await getJSON(`https://archive.org/advancedsearch.php?${params}`);
    if (seq !== searchSeq) return;
    const docs = data.response?.docs || [];
    if (!docs.length) return c.empty("Nichts im Internet Archive gefunden.");
    const TYPES = {texts: "Text/Buch", movies: "Video", audio: "Audio", image: "Bild", software: "Software", web: "Webseite", collection: "Sammlung", etree: "Konzert"};
    const flat = (v) => (Array.isArray(v) ? v.join(", ") : v);
    fill(c.body, h("ul", {class: "list"}, docs.map((d) => h("li", {},
      extLink(`https://archive.org/details/${encodeURIComponent(d.identifier)}`, flat(d.title) || d.identifier),
      h("div", {class: "meta"}, [TYPES[d.mediatype] || d.mediatype, d.year, flat(d.creator)].filter(Boolean).join(" · "))))),
    h("p", {class: "source"}, "Quelle: Internet Archive – ", extLink(`https://archive.org/search?query=${encodeURIComponent(`"${name}"`)}`, `alle ${data.response.numFound} Treffer`)));
    c.done(`${docs.length} von ${data.response.numFound}`);
  } catch (err) { if (seq === searchSeq) c.fail(err); }
}


// ------------------------------------------------------------------ Websuche (gesamtes öffentliches Internet)
// Seiten, die gezielt Privatleute ausforschen oder gestohlene Daten verbreiten, werden nie angezeigt.
const BLOCKED_DOMAINS = [
  "spokeo.com", "whitepages.com", "radaris.com", "radaris.de", "beenverified.com", "truepeoplesearch.com",
  "fastpeoplesearch.com", "peoplefinders.com", "intelius.com", "mylife.com", "instantcheckmate.com", "truthfinder.com",
  "peekyou.com", "thatsthem.com", "pimeyes.com", "facecheck.id", "dehashed.com", "snusbase.com", "leakcheck.io",
  "intelx.io", "leak-lookup.com", "doxbin.com", "doxbin.org", "kiwifarms.net", "kiwifarms.st",
];
const CATEGORIES = [
  ["own", "Mögliche eigene Website", null],
  ["profile", "Profile & Social Media", /(^|\.)(linkedin\.com|xing\.com|instagram\.com|facebook\.com|x\.com|twitter\.com|tiktok\.com|youtube\.com|github\.com|threads\.net|bsky\.app|pinterest\.[a-z.]+|about\.me|linktr\.ee|medium\.com|behance\.net|dribbble\.com|soundcloud\.com|twitch\.tv|reddit\.com|substack\.com|vimeo\.com|spotify\.com)$/],
  ["business", "Unternehmen, Register & Branchenbücher", /(northdata\.|companyhouse\.de|firmenwissen\.de|handelsregister|unternehmensregister\.de|bundesanzeiger\.de|opencorporates\.com|creditreform|crunchbase\.com|kununu\.com|gelbeseiten\.de|dasoertliche\.de|11880\.com|wlw\.de|moneyhouse\.|firmen|unternehmen|provenexpert\.com|trustpilot\.|jameda\.de|doctolib\.|anwalt\.de|golocal\.de|yelp\.)/],
  ["press", "Presse, Blogs & Medien", /(spiegel\.de|zeit\.de|faz\.net|sueddeutsche\.de|welt\.de|handelsblatt\.com|tagesschau\.de|n-tv\.de|focus\.de|stern\.de|bild\.de|t-online\.de|br\.de|ndr\.de|wdr\.de|swr\.de|mdr\.de|zdf\.de|ard\.de|deutschlandfunk|rnd\.de|merkur\.de|tz\.de|wiwo\.de|manager-magazin|businessinsider|gruenderszene|t3n\.de|forbes\.|bloomberg\.com|reuters\.com|nytimes\.com|theguardian\.com|bbc\.|cnn\.com|presseportal\.de|zeitung|news|nachrichten|kurier|anzeiger|rundschau|tagblatt|morgenpost|abendblatt|podcast)/],
  ["knowledge", "Nachschlagewerke & Wissenschaft", /(wikipedia\.org|wikidata\.org|researchgate\.net|scholar\.google|orcid\.org|academia\.edu|dnb\.de|deutsche-biographie\.de|\.edu$|uni-|universit|hochschule)/],
  ["other", "Weitere Websites", null],
];
const ENGINE_INFO = {
  free: "DuckDuckGo über Jina Reader (kostenlos, ohne Schlüssel)",
  serper: "Google über Serper.dev", tavily: "Tavily", jina: "Jina Search",
};

function webSettings() {
  const cfg = {engine: storage.get("engine") || "free"};
  for (const k of ["serperKey", "tavilyKey", "jinaKey"]) cfg[k] = storage.get(k) || "";
  if (cfg.engine !== "free" && !cfg[cfg.engine + "Key"]) cfg.engine = "free";
  return cfg;
}
function jinaHeaders(extra = {}) {
  const key = webSettings().jinaKey;
  return {Accept: "application/json", ...(key ? {Authorization: `Bearer ${key}`} : {}), ...extra};
}

const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
const fold = (t) => t.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
  .normalize("NFD").replace(/[̀-ͯ]/g, "");
const isBlocked = (host) => BLOCKED_DOMAINS.some((d) => host === d || host.endsWith("." + d));

// Ergebnisseiten der kostenlosen Suchmaschinen auslesen (Weiterleitungs-Links werden aufgelöst).
function ddgTarget(href) {
  try { const u = new URL(href, "https://duckduckgo.com"); return u.searchParams.get("uddg") || u.href; } catch { return ""; }
}
function bingTarget(href) {
  try {
    const u = new URL(href, "https://www.bing.com");
    const enc = u.searchParams.get("u");
    if (u.hostname.endsWith("bing.com") && enc?.startsWith("a1")) {
      const b64 = enc.slice(2).replace(/-/g, "+").replace(/_/g, "/");
      return decodeURIComponent(escape(atob(b64 + "===".slice((b64.length + 3) % 4))));
    }
    return u.href;
  } catch { return ""; }
}
const SERP_PARSERS = {
  ddg: (doc) => [...doc.querySelectorAll(".result:not(.result--ad)")].map((r) => {
    const a = r.querySelector("a.result__a");
    return a && {title: a.textContent, url: ddgTarget(a.getAttribute("href")), snippet: r.querySelector(".result__snippet")?.textContent};
  }),
  ddglite: (doc) => [...doc.querySelectorAll("a.result-link")].map((a) => ({
    title: a.textContent, url: ddgTarget(a.getAttribute("href")),
    snippet: a.closest("tr")?.nextElementSibling?.querySelector(".result-snippet")?.textContent,
  })),
  bing: (doc) => [...doc.querySelectorAll("li.b_algo")].map((li) => {
    const a = li.querySelector("h2 a");
    return a && {title: a.textContent, url: bingTarget(a.getAttribute("href")), snippet: li.querySelector(".b_caption p, .b_lineclamp2, .b_lineclamp3, .b_lineclamp4")?.textContent};
  }),
};
function parseSerp(kind, html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return SERP_PARSERS[kind](doc).filter(Boolean)
    .map((r) => ({title: (r.title || "").trim(), url: r.url, snippet: (r.snippet || "").replace(/\s+/g, " ").replace(/\s*Mehr lesen$/, "").trim()}))
    .filter((r) => /^https?:\/\//.test(r.url) && !/(duckduckgo\.com\/(y\.js|l\/)|bing\.com\/(ck|aclick))/.test(r.url));
}
const FREE_ENGINES = [
  ["ddg", (q) => `https://html.duckduckgo.com/html/?${qs({q, kl: "de-de"})}`],
  ["ddglite", (q) => `https://lite.duckduckgo.com/lite/?${qs({q, kl: "de-de"})}`],
  ["bing", (q) => `https://www.bing.com/search?${qs({q, setlang: "de", count: 30})}`],
];

// Jina Reader lädt beliebige öffentliche Seiten mit CORS-Freigabe; bei Überlastung einmal neu versuchen.
async function jinaRead(url, extraHeaders = {}) {
  const opts = {timeout: 60000, headers: jinaHeaders(extraHeaders)};
  try {
    return await getJSON(`https://r.jina.ai/${url}`, opts);
  } catch (err) {
    await new Promise((r) => setTimeout(r, 4000));
    try { return await getJSON(`https://r.jina.ai/${url}`, opts); } catch (err2) {
      if (/nicht erreichbar/.test(err2.message)) throw new Error("Jina Reader ist gerade überlastet (Anfragelimit) – bitte in einer Minute erneut versuchen");
      throw err2;
    }
  }
}

async function searchWeb(q, cfg) {
  if (cfg.engine === "serper") {
    const d = await getJSON("https://google.serper.dev/search", {method: "POST", timeout: 30000,
      headers: {"X-API-KEY": cfg.serperKey, "Content-Type": "application/json"}, body: JSON.stringify({q, gl: "de", hl: "de", num: 20})});
    return {results: (d.organic || []).map((r) => ({title: r.title, url: r.link, snippet: [r.date, r.snippet].filter(Boolean).join(" – ")})),
      kg: d.knowledgeGraph};
  }
  if (cfg.engine === "tavily") {
    const d = await getJSON("https://api.tavily.com/search", {method: "POST", timeout: 40000,
      headers: {Authorization: `Bearer ${cfg.tavilyKey}`, "Content-Type": "application/json"}, body: JSON.stringify({query: q, max_results: 20})});
    return {results: (d.results || []).map((r) => ({title: r.title, url: r.url, snippet: (r.content || "").slice(0, 300)}))};
  }
  if (cfg.engine === "jina") {
    const d = await getJSON(`https://s.jina.ai/?${qs({q})}`, {timeout: 45000, headers: jinaHeaders({"X-Respond-With": "no-content"})});
    return {results: (d.data || []).map((r) => ({title: r.title, url: r.url, snippet: r.description || ""}))};
  }
  // Kostenlos: nacheinander DuckDuckGo, DuckDuckGo Lite und Bing, bis eine Seite Treffer liefert
  // (Suchmaschinen zeigen gelegentlich eine Bot-Abfrage statt Ergebnissen).
  let lastErr = null;
  for (const [kind, build] of FREE_ENGINES) {
    try {
      const d = await jinaRead(build(q), {"X-Return-Format": "html"});
      const results = parseSerp(kind, d.data?.html || "");
      if (results.length) return {results};
    } catch (err) { lastErr = err; }
  }
  if (lastErr) throw lastErr;
  return {results: []};
}

function webQueries(name, ctx) {
  const p = `"${name.replace(/"/g, "")}"`, c = ctx ? " " + ctx : "";
  return [
    ["Allgemein", `${p}${c}`],
    ["Beruf & Unternehmen", `${p}${c} Geschäftsführer OR Inhaber OR Gründer OR CEO OR Unternehmer`],
    ["Profile", `${p}${c} LinkedIn OR XING OR Instagram OR Profil`],
    ["Eigene Website", `${p}${c} Impressum OR "über mich" OR about`],
    ["Auftritte", `${p}${c} Interview OR Vortrag OR Podcast OR Artikel`],
  ];
}

async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, async () => {
    while (next < items.length) { const i = next++; out[i] = await worker(items[i]).then((v) => ({ok: v}), (e) => ({err: e})); }
  }));
  return out;
}

function categorize(r, nameWords) {
  const host = hostOf(r.url);
  const flatHost = fold(host).replace(/[^a-z0-9]/g, "");
  const surname = nameWords[nameWords.length - 1];
  if (surname && surname.length > 2 && flatHost.includes(surname) && !CATEGORIES.slice(1, 5).some(([, , re]) => re.test(host))) return "own";
  for (const [key, , re] of CATEGORIES) if (re && re.test(host)) return key;
  return "other";
}

async function loadWeb(c, name, ctx, seq) {
  c.loading();
  const cfg = webSettings();
  // Ohne eigenen Schlüssel weniger Teilsuchen, damit das Gratis-Limit des Jina Readers reicht.
  const queries = webQueries(name, ctx).slice(0, cfg.engine === "free" && !cfg.jinaKey ? 4 : 5);
  const outcomes = await pool(queries, cfg.engine === "free" ? 2 : 3, ([, q]) => searchWeb(q, cfg));
  if (seq !== searchSeq) return;

  const nameWords = fold(name).split(/\s+/).map((w) => w.replace(/[^a-z0-9-]/g, "")).filter(Boolean);
  const surname = nameWords.length > 1 ? nameWords[nameWords.length - 1] : "";
  const byUrl = new Map();
  let kg = null, blocked = 0;
  const errors = [];
  outcomes.forEach((o, i) => {
    if (o.err) { errors.push(o.err.message || String(o.err)); return; }
    kg ||= o.ok.kg;
    for (const r of o.ok.results) {
      const host = hostOf(r.url);
      if (!host) continue;
      if (isBlocked(host)) { blocked++; continue; }
      const key = r.url.replace(/[#?].*$/, "").replace(/\/$/, "");
      if (byUrl.has(key)) { byUrl.get(key).via.add(queries[i][0]); continue; }
      const text = fold(`${r.title} ${r.snippet}`);
      byUrl.set(key, {...r, host, via: new Set([queries[i][0]]), match: nameWords.every((w) => text.includes(w)) ? 2 : surname && text.includes(surname) ? 1 : 0});
    }
  });

  const results = [...byUrl.values()];
  if (!results.length) {
    if (errors.length === queries.length) {
      return c.fail(new Error(`${errors[0]}${cfg.engine === "free" ? " – der kostenlose Dienst ist evtl. überlastet. In den Einstellungen (⚙) kannst du einen eigenen, kostenlosen API-Schlüssel eintragen." : ""}`));
    }
    return c.empty("Keine Treffer im Internet gefunden.");
  }
  for (const r of results) r.cat = categorize(r, nameWords);

  const blocks = [];
  if (kg?.title) {
    const attrs = Object.entries(kg.attributes || {});
    blocks.push(h("div", {class: "kg"}, h("strong", {}, kg.title), kg.type ? h("span", {class: "meta"}, ` – ${kg.type}`) : null,
      kg.description ? h("p", {}, kg.description) : null,
      attrs.length ? h("dl", {class: "facts"}, attrs.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])) : null,
      kg.website ? h("p", {}, extLink(kg.website)) : null));
  }
  const relevant = results.filter((r) => r.match > 0), weak = results.filter((r) => r.match === 0);
  for (const [key, title] of CATEGORIES) {
    const group = relevant.filter((r) => r.cat === key).sort((a, b) => b.match - a.match || b.via.size - a.via.size);
    if (!group.length) continue;
    blocks.push(h("h3", {class: "webcat"}, `${title} (${group.length})`), h("ul", {class: "list"}, group.map((r) => webItem(r, name))));
  }
  if (!relevant.length) blocks.push(h("p", {class: "empty"}, "Kein Treffer nennt den Namen im Auszug."));
  if (weak.length) {
    blocks.push(h("details", {class: "wsec"}, h("summary", {}, `Weitere Treffer ohne den Namen im Auszug (${weak.length})`),
      h("ul", {class: "list"}, weak.map((r) => webItem(r, name)))));
  }
  const notes = [`Suchmaschine: ${ENGINE_INFO[cfg.engine]} (ändern über ⚙).`];
  if (errors.length) notes.push(`${errors.length} von ${queries.length} Teilsuchen fehlgeschlagen (${errors[0]}).`);
  if (blocked) notes.push(`${blocked} Treffer von Personensuch-, Datenhändler- oder Leak-Seiten ausgeblendet.`);
  fill(c.body, h("p", {class: "meta"}, "Sortiert nach Art der Seite. Treffer mit dem vollständigen Namen im Auszug stehen oben; „Seite auslesen“ zeigt, was dort über die Person steht."),
    ...blocks, h("p", {class: "source"}, notes.join(" ")));
  c.done(`${relevant.length} Seiten`);
}

function webItem(r, name) {
  const reader = h("div", {class: "reader", hidden: true});
  const btn = h("button", {class: "btn small", type: "button", onclick: () => {
    if (!reader.hidden) { reader.hidden = true; btn.textContent = "Seite auslesen"; return; }
    reader.hidden = false; btn.textContent = "Auszug schließen";
    if (!reader.dataset.loaded) { reader.dataset.loaded = "1"; readPage(r.url, name, reader); }
  }}, "Seite auslesen");
  return h("li", {},
    extLink(r.url, r.title || r.url),
    h("div", {class: "meta"}, [r.host, `gefunden über: ${[...r.via].join(", ")}`, r.match === 0 ? "Name nicht im Auszug" : ""].filter(Boolean).join(" · ")),
    r.snippet ? h("div", {class: "snippet"}, r.snippet) : null,
    btn, reader);
}

function cleanMarkdown(md) {
  return md.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#+\s*/gm, "").replace(/[*_`>|]{1,3}/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

async function readPage(url, name, box) {
  fill(box, h("span", {class: "spinner"}), " Seite wird ausgelesen …");
  try {
    const d = await jinaRead(url);
    const text = cleanMarkdown(d.data?.content || "");
    const words = fold(name).split(/\s+/).filter((w) => w.length > 2);
    const needles = [fold(name), words[words.length - 1]].filter(Boolean);
    const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((t) => t.trim()).filter((t) => t.length > 15 && t.length < 500);
    const mentions = [...new Set(sentences.filter((t) => needles.some((n) => fold(t).includes(n))))].slice(0, 12);
    fill(box,
      d.data?.title ? h("strong", {}, d.data.title) : null,
      d.data?.description ? h("p", {class: "meta"}, d.data.description) : null,
      mentions.length
        ? [h("p", {}, `Stellen, an denen „${name}“ vorkommt:`), h("ul", {}, mentions.map((m) => h("li", {}, m)))]
        : h("p", {class: "empty"}, "Der Name kommt im Seitentext nicht vor – eventuell eine andere Person oder der Text wird erst nachgeladen."),
      text ? h("details", {}, h("summary", {}, "Ganzen Seitentext anzeigen"), h("pre", {class: "pagetext"}, text.slice(0, 8000) + (text.length > 8000 ? "\n…" : ""))) : null,
      h("p", {class: "source"}, "Ausgelesen über Jina Reader"));
  } catch (err) {
    fill(box, h("p", {class: "empty"}, `Seite konnte nicht ausgelesen werden: ${err.message}`));
  }
}

function openSettings() {
  const cfg = webSettings();
  const dlg = $("#settings");
  dlg.querySelectorAll("input[name=engine]").forEach((r) => (r.checked = r.value === (storage.get("engine") || "free")));
  for (const k of ["serperKey", "tavilyKey", "jinaKey"]) $("#" + k).value = cfg[k];
  $("#settingsMsg").textContent = "";
  dlg.showModal();
}
function saveSettings(ev) {
  ev.preventDefault();
  const engine = $("#settings input[name=engine]:checked")?.value || "free";
  const keys = Object.fromEntries(["serperKey", "tavilyKey", "jinaKey"].map((k) => [k, $("#" + k).value.trim()]));
  if (engine !== "free" && !keys[engine + "Key"]) { $("#settingsMsg").textContent = "Für diese Suchmaschine fehlt der API-Schlüssel."; return; }
  storage.set("engine", engine);
  for (const [k, v] of Object.entries(keys)) storage.set(k, v);
  $("#settings").close();
  const name = $("#nameInput").value.trim();
  if (S && name.length >= 3) loadWeb(S.web, name, $("#ctxInput").value.trim(), searchSeq);
}

// ------------------------------------------------------------------ Weiterführende Links
function renderLinks(c, name, ctx) {
  const phrase = `"${name.replace(/"/g, "")}"`;
  const full = ctx ? `${phrase} ${ctx}` : phrase;
  const e = encodeURIComponent;
  const g = (extra) => `https://www.google.com/search?q=${e(`${full} ${extra}`)}`;
  const groups = [
    ["Suchmaschinen", [
      ["Google", `https://www.google.com/search?q=${e(full)}`], ["Bing", `https://www.bing.com/search?q=${e(full)}`],
      ["DuckDuckGo", `https://duckduckgo.com/?q=${e(full)}`], ["Startpage", `https://www.startpage.com/do/search?query=${e(full)}`],
      ["Ecosia", `https://www.ecosia.org/search?q=${e(full)}`], ["Google Bilder", `https://www.google.com/search?tbm=isch&q=${e(full)}`],
    ]],
    ["Nachrichten & Presse", [
      ["Google News", `https://news.google.com/search?q=${e(full)}&hl=de&gl=DE&ceid=DE:de`], ["Bing News", `https://www.bing.com/news/search?q=${e(full)}`],
      ["tagesschau.de", g("site:tagesschau.de")], ["SPIEGEL", `https://www.spiegel.de/suche/?suchbegriff=${e(name)}`],
      ["ZEIT", `https://www.zeit.de/suche/index?q=${e(name)}`], ["Pressemitteilungen", g("Pressemitteilung")],
    ]],
    ["Beruf & Wirtschaft", [
      ["LinkedIn", g("site:linkedin.com/in")], ["XING", g("site:xing.com/profile")],
      ["North Data (Firmenbeteiligungen)", `https://www.northdata.de/${e(name)}`], ["OpenCorporates (Funktionen)", `https://opencorporates.com/officers?q=${e(name)}`],
      ["Handelsregister", "https://www.handelsregister.de/rp_web/normalesuche.xhtml"], ["Unternehmensregister", "https://www.unternehmensregister.de/"],
    ]],
    ["Datenbanken („Deep Web“, legal)", [
      ["DNB-Katalog", `https://portal.dnb.de/opac.htm?method=simpleSearch&query=${e(name)}`],
      ["Deutsche Digitale Bibliothek", `https://www.deutsche-digitale-bibliothek.de/searchresults?query=${e(name)}`],
      ["Europeana", `https://www.europeana.eu/de/search?query=${e(phrase)}`], ["WorldCat", `https://search.worldcat.org/search?q=${e(name)}`],
      ["Open Library", `https://openlibrary.org/search/authors?q=${e(name)}`], ["Wikipedia-Volltext", `https://de.wikipedia.org/w/index.php?search=${e(phrase)}&fulltext=1`],
      ["Deutsche Biographie", `https://www.deutsche-biographie.de/search?name=${e(name)}`],
    ]],
    ["Wissenschaft & Patente", [
      ["Google Scholar", `https://scholar.google.com/scholar?q=${e(`author:${phrase}`)}`], ["Semantic Scholar", `https://www.semanticscholar.org/search?q=${e(name)}`],
      ["ORCID", `https://orcid.org/orcid-search/search?searchQuery=${e(name)}`], ["dblp (Informatik)", `https://dblp.org/search?q=${e(name)}`],
      ["Google Patents", `https://patents.google.com/?inventor=${e(name)}`], ["Espacenet", `https://worldwide.espacenet.com/patent/search?q=${e(`in="${name}"`)}`],
    ]],
    ["Politik & öffentliche Ämter", [
      ["abgeordnetenwatch", g("site:abgeordnetenwatch.de")], ["Bundestag", g("site:bundestag.de")],
      ["Lobbyregister", g("site:lobbyregister.bundestag.de")], ["EU-Parlament", g("site:europarl.europa.eu")],
      ["Landtage", g("Landtag Abgeordnete")],
    ]],
    ["Öffentliche Social-Media-Profile", [
      ["X / Twitter", g("site:x.com")], ["Instagram", g("site:instagram.com")], ["Facebook", g("site:facebook.com")],
      ["YouTube", `https://www.youtube.com/results?search_query=${e(full)}`], ["TikTok", g("site:tiktok.com")],
      ["Mastodon/Bluesky", g("(site:bsky.app OR mastodon)")],
    ]],
    ["Videos, Audio & Archive", [
      ["ARD Mediathek", `https://www.ardmediathek.de/suche/${e(name)}`], ["ZDF", `https://www.zdf.de/suche?q=${e(name)}`],
      ["Podcasts", g("podcast")], ["Internet Archive", `https://archive.org/search?query=${e(phrase)}`], ["PDF-Dokumente", g("filetype:pdf")],
    ]],
  ];
  fill(c.body, 
    h("p", {class: "meta"}, "Öffnet vorbereitete Suchen in einem neuen Tab. Enthalten sind nur legale, öffentlich zugängliche Quellen – bewusst keine Personensuchmaschinen oder Adresshändler."),
    ...groups.map(([title, links]) => h("div", {class: "link-group"}, h("h3", {}, title),
      h("div", {class: "links"}, links.map(([label, url]) => extLink(url, label))))));
  c.done();
}

// ------------------------------------------------------------------ Bildsuche
let imageFile = null;

function postFile(action, field, file) {
  // Klassisches Formular mit Datei-Upload in neuem Tab (funktioniert auch über Domaingrenzen).
  const input = h("input", {type: "file", name: field});
  const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files;
  const form = h("form", {action, method: "post", enctype: "multipart/form-data", target: "_blank", hidden: true}, input);
  document.body.append(form); form.submit(); form.remove();
}

async function copyImage(file) {
  const bmp = await createImageBitmap(file);
  const canvas = h("canvas", {width: bmp.width, height: bmp.height});
  canvas.getContext("2d").drawImage(bmp, 0, 0);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
  await navigator.clipboard.write([new ClipboardItem({"image/png": blob})]);
}

const ENGINES = [
  {name: "Google Lens", note: "größter Index, findet Artikel & Seiten",
    url: (u) => `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(u)}`,
    file: (f) => postFile("https://lens.google.com/v3/upload", "encoded_image", f), manual: "https://lens.google.com/"},
  {name: "Bing Visuelle Suche", note: "gut für Nachrichtenfotos",
    url: (u) => `https://www.bing.com/images/search?view=detailv2&iss=sbi&q=${encodeURIComponent("imgurl:" + u)}`,
    file: null, manual: "https://www.bing.com/visualsearch"},
  {name: "TinEye", note: "findet exakte Kopien & Erstveröffentlichung",
    url: (u) => `https://tineye.com/search?url=${encodeURIComponent(u)}`,
    file: (f) => postFile("https://tineye.com/search", "image", f), manual: "https://tineye.com/"},
];

function renderImageActions() {
  const url = $("#urlInput").value.trim();
  const validUrl = /^https?:\/\/\S+$/i.test(url);
  const box = $("#imageActions");
  box.replaceChildren();
  const hint = $("#imageHint");

  if (!imageFile && !validUrl) {
    hint.textContent = "Wähle ein Bild aus oder gib die Adresse eines Bildes im Internet ein.";
    return;
  }
  for (const eng of ENGINES) {
    if (validUrl) {
      box.append(h("a", {class: "btn primary engine", href: eng.url(url), target: "_blank", rel: "noopener noreferrer"}, eng.name, h("small", {}, eng.note)));
    } else if (eng.file) {
      box.append(h("button", {class: "btn primary engine", type: "button", onclick: () => eng.file(imageFile)}, eng.name, h("small", {}, eng.note)));
    } else {
      box.append(h("a", {class: "btn engine", href: eng.manual, target: "_blank", rel: "noopener noreferrer"}, `${eng.name} öffnen`, h("small", {}, "Bild dort einfügen (Strg+V)")));
    }
  }
  if (imageFile && navigator.clipboard?.write && window.ClipboardItem) {
    box.append(h("button", {class: "btn engine", type: "button", onclick: async (ev) => {
      const b = ev.currentTarget;
      try { await copyImage(imageFile); b.firstChild.textContent = "✓ Kopiert"; }
      catch { b.firstChild.textContent = "Kopieren nicht erlaubt"; }
    }}, "Bild kopieren", h("small", {}, "zum Einfügen in jeder Bildersuche")));
  }
  hint.textContent = imageFile
    ? "Das Bild wird erst beim Klick und nur an die gewählte Suchmaschine gesendet. Öffnet sich dort nichts, nutze „Bild kopieren“ und füge es auf der Seite der Suchmaschine ein."
    : "Die Adresse wird an die gewählte Suchmaschine übergeben.";
}

function setImage(file) {
  if (!file || !file.type.startsWith("image/")) return;
  imageFile = file;
  $("#urlInput").value = "";
  const img = $("#preview");
  if (img.src) URL.revokeObjectURL(img.src);
  img.src = URL.createObjectURL(file); img.hidden = false; img.alt = "Ausgewähltes Bild";
  $("#dropText").textContent = `${file.name || "Bild"} – zum Ändern klicken`;
  renderImageActions();
}

// ------------------------------------------------------------------ URL-Hash, Tabs, Theme
function setHash({name, ctx}) {
  const p = new URLSearchParams({name}); if (ctx) p.set("ctx", ctx);
  history.replaceState(null, "", "#" + p.toString());
}
function copyShareLink(ev) {
  const b = ev.currentTarget;
  navigator.clipboard?.writeText(location.href).then(() => { b.textContent = "✓ Link kopiert"; }, () => prompt("Link:", location.href));
}
function showTab(name) {
  document.querySelectorAll(".tab").forEach((t) => { const on = t.dataset.tab === name; t.classList.toggle("active", on); t.setAttribute("aria-selected", on); });
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + name));
}
function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme;
}
const storage = {
  get(k) { try { return localStorage.getItem("personensuche." + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem("personensuche." + k, v); } catch { /* privat */ } },
};

// ------------------------------------------------------------------ Start
function init() {
  applyTheme(storage.get("theme"));
  $("#themeBtn").onclick = () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    applyTheme(next); storage.set("theme", next);
  };
  document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => showTab(t.dataset.tab)));
  $("#settingsBtn").onclick = openSettings;
  $("#settingsForm").onsubmit = saveSettings;
  $("#settingsCancel").onclick = () => $("#settings").close();

  $("#nameForm").onsubmit = (ev) => { ev.preventDefault(); runSearch($("#nameInput").value, $("#ctxInput").value); };
  $("#handoverForm").onsubmit = (ev) => {
    ev.preventDefault();
    $("#nameInput").value = $("#handoverInput").value; $("#ctxInput").value = "";
    showTab("name"); runSearch($("#nameInput").value);
  };

  const drop = $("#drop"), fileInput = $("#fileInput");
  drop.onclick = () => fileInput.click();
  drop.onkeydown = (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); fileInput.click(); } };
  fileInput.onchange = () => setImage(fileInput.files[0]);
  drop.ondragover = (ev) => { ev.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (ev) => { ev.preventDefault(); drop.classList.remove("over"); setImage(ev.dataTransfer.files[0]); };
  document.addEventListener("paste", (ev) => {
    const file = [...(ev.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"));
    if (file) { showTab("image"); setImage(file); }
  });
  $("#urlInput").oninput = () => {
    if ($("#urlInput").value.trim()) { imageFile = null; $("#preview").hidden = true; $("#dropText").textContent = "Bild hierher ziehen, einfügen (Strg+V) oder auswählen"; }
    renderImageActions();
  };
  renderImageActions();

  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get("name")) {
    $("#nameInput").value = p.get("name"); $("#ctxInput").value = p.get("ctx") || "";
    runSearch(p.get("name"), p.get("ctx") || "");
  }
}

if (typeof document !== "undefined") init();
if (typeof module !== "undefined") module.exports = {formatTime, ageOf, parseSections, gdeltDate, fold, cleanMarkdown, bingTarget};
