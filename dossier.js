"use strict";
/*
 * Dossier: sammelt, was alle Quellen über die gesuchte Person liefern, und macht daraus
 *   1. den zusammengefassten Steckbrief (Rollen, Unternehmen, Orte, Websites, Profile …) und
 *   2. die Social-Media-Übersicht mit öffentlichen Beiträgen und Kommentaren, wo die Plattform
 *      sie ohne Anmeldung herausgibt (Bluesky, Mastodon, GitHub, Hacker News, Reddit).
 * Braucht app.js (h, fill, extLink, getJSON, qs, fold, card, readPage, labelOf, descOf …).
 */

let D = null;

const FACT_KINDS = {
  roles: "Tätigkeiten & Rollen",
  orgs: "Unternehmen & Organisationen",
  places: "Orte",
  education: "Ausbildung",
  websites: "Websites",
  bios: "Selbstbeschreibungen",
};
// Quellen, die eine Person eindeutig zuordnen (statt nur über den Namen)
const VERIFIED_SOURCES = new Set(["Wikidata", "DNB", "OpenAlex (ORCID)"]);

// ------------------------------------------------------------------ Plattformen
const BSKY = "https://api.bsky.app/xrpc";
const PLATFORMS = [
  {id: "linkedin", label: "LinkedIn", hosts: /(^|\.)linkedin\.com$/, profile: /^\/in\/([^/?#]+)/, url: (x) => `https://www.linkedin.com/in/${x}`},
  {id: "xing", label: "XING", hosts: /(^|\.)xing\.com$/, profile: /^\/profile\/([^/?#]+)/, url: (x) => `https://www.xing.com/profile/${x}`},
  {id: "instagram", label: "Instagram", hosts: /(^|\.)instagram\.com$/, profile: /^\/([A-Za-z0-9._]{2,30})\/?$/,
    reserved: ["p", "reel", "reels", "explore", "stories", "accounts", "about", "developer", "legal", "direct", "tv"], url: (x) => `https://www.instagram.com/${x}/`},
  {id: "facebook", label: "Facebook", hosts: /(^|\.)facebook\.com$/, profile: /^\/(?:people\/[^/]+\/)?([A-Za-z0-9.]{3,})\/?$/,
    reserved: ["pages", "groups", "events", "watch", "photo", "photo.php", "story.php", "permalink.php", "sharer", "login", "marketplace", "gaming", "help", "profile.php", "public", "reel"],
    url: (x) => `https://www.facebook.com/${x}`},
  {id: "x", label: "X (Twitter)", hosts: /(^|\.)(x|twitter)\.com$/, profile: /^\/([A-Za-z0-9_]{1,15})\/?$/,
    reserved: ["home", "search", "explore", "i", "intent", "hashtag", "share", "login", "signup", "settings", "notifications", "messages", "tos", "privacy"], url: (x) => `https://x.com/${x}`},
  {id: "tiktok", label: "TikTok", hosts: /(^|\.)tiktok\.com$/, profile: /^\/@([^/?#]+)\/?$/, url: (x) => `https://www.tiktok.com/@${x}`},
  {id: "youtube", label: "YouTube", hosts: /(^|\.)youtube\.com$/, profile: /^\/((?:@|channel\/|c\/|user\/)[^/?#]+)/, url: (x) => `https://www.youtube.com/${x}`},
  {id: "threads", label: "Threads", hosts: /(^|\.)threads\.(net|com)$/, profile: /^\/@([^/?#]+)\/?$/, url: (x) => `https://www.threads.net/@${x}`},
  {id: "bluesky", label: "Bluesky", hosts: /(^|\.)bsky\.app$/, profile: /^\/profile\/([^/?#]+)\/?$/, url: (x) => `https://bsky.app/profile/${x}`, feed: bskyFeed},
  {id: "mastodon", label: "Mastodon", hosts: /(mastodon|mstdn|social|toot|troet|masto|fedi|chaos)/, profile: /^\/@([A-Za-z0-9_]{1,30})\/?$/,
    url: (x) => { const [u, host] = x.split("@"); return `https://${host}/@${u}`; }, feed: mastoFeed},
  {id: "github", label: "GitHub", hosts: /^github\.com$/, profile: /^\/([A-Za-z0-9-]{1,39})\/?$/,
    reserved: ["features", "topics", "about", "pricing", "login", "join", "explore", "marketplace", "sponsors", "orgs", "collections", "trending", "settings", "enterprise", "security", "customer-stories", "readme", "site", "contact", "events", "search"],
    url: (x) => `https://github.com/${x}`, feed: githubFeed},
  {id: "reddit", label: "Reddit", hosts: /(^|\.)reddit\.com$/, profile: /^\/(?:user|u)\/([^/?#]+)/, url: (x) => `https://www.reddit.com/user/${x}`, feed: redditFeed},
  {id: "hackernews", label: "Hacker News", hosts: /^news\.ycombinator\.com$/, special: (u) => u.pathname === "/user" && u.searchParams.get("id"),
    url: (x) => `https://news.ycombinator.com/user?id=${x}`, feed: hnFeed},
  {id: "pinterest", label: "Pinterest", hosts: /(^|\.)pinterest\.[a-z.]+$/, profile: /^\/([A-Za-z0-9_]{3,30})\/?$/, reserved: ["pin", "search", "ideas", "today", "business"], url: (x) => `https://www.pinterest.com/${x}/`},
  {id: "twitch", label: "Twitch", hosts: /(^|\.)twitch\.tv$/, profile: /^\/([A-Za-z0-9_]{3,25})\/?$/, reserved: ["directory", "videos", "p", "search", "downloads", "jobs", "settings"], url: (x) => `https://www.twitch.tv/${x}`},
  {id: "medium", label: "Medium", hosts: /(^|\.)medium\.com$/, profile: /^\/@([^/?#]+)\/?$/, url: (x) => `https://medium.com/@${x}`},
  {id: "soundcloud", label: "SoundCloud", hosts: /(^|\.)soundcloud\.com$/, profile: /^\/([A-Za-z0-9_-]{3,})\/?$/, reserved: ["discover", "search", "upload", "stream", "charts", "pages", "you", "jobs", "terms-of-use"], url: (x) => `https://soundcloud.com/${x}`},
  {id: "linktree", label: "Linktree", hosts: /(^|\.)linktr\.ee$/, profile: /^\/([^/?#]+)\/?$/, url: (x) => `https://linktr.ee/${x}`},
  {id: "stackoverflow", label: "Stack Overflow", hosts: /(^|\.)stackoverflow\.com$/, profile: /^\/users\/(\d+(?:\/[^/?#]+)?)/, url: (x) => `https://stackoverflow.com/users/${x}`},
];
const PLATFORM = Object.fromEntries(PLATFORMS.map((p) => [p.id, p]));
const MAIN_PLATFORMS = ["linkedin", "xing", "instagram", "facebook", "x", "tiktok", "youtube", "bluesky", "mastodon", "threads", "github", "reddit"];
const PLATFORM_SEARCH = {
  linkedin: "linkedin.com/in", xing: "xing.com/profile", instagram: "instagram.com", facebook: "facebook.com", x: "x.com",
  tiktok: "tiktok.com", youtube: "youtube.com", bluesky: "bsky.app", threads: "threads.net", github: "github.com", reddit: "reddit.com/user",
};

function detectSocial(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
  for (const p of PLATFORMS) {
    if (!p.hosts.test(host)) continue;
    if (p.id === "mastodon" && !p.profile.test(u.pathname)) continue; // viele Hosts heißen „social“, nur /@name zählt
    let handle = p.special ? p.special(u) : (u.pathname.match(p.profile) || [])[1];
    if (p.id === "facebook" && u.pathname === "/profile.php" && /^\d+$/.test(u.searchParams.get("id") || "")) handle = `profile.php?id=${u.searchParams.get("id")}`;
    if (handle && p.reserved?.includes(handle.toLowerCase())) handle = null;
    if (handle) {
      try { handle = decodeURIComponent(handle); } catch { /* bleibt roh */ }
      if (p.id === "mastodon") handle = `${handle}@${u.hostname}`;
    }
    return {platform: p, handle: handle || null};
  }
  return null;
}

// ------------------------------------------------------------------ Dossier-Zustand
function dossierReset(name, ctx, seq, summaryCard, socialCard) {
  D = {
    name, ctx, seq, summary: summaryCard, social: socialCard, headline: null,
    facts: Object.fromEntries(Object.keys(FACT_KINDS).map((k) => [k, new Map()])),
    profiles: new Map(), mentions: new Map(), counts: {},
    pending: new Set(["wikidata", "web", "social"]),
  };
  summaryCard.loading();
  socialCard.loading();
}
const dossierAlive = (seq) => D && D.seq === seq;
// Passt ein Text zum Suchzusatz (Beruf, Ort, Firma …)?
function ctxMatch(text) {
  const words = fold(D?.ctx || "").split(/\s+/).filter((w) => w.length > 2);
  const t = fold(text || "");
  return words.length > 0 && words.some((w) => t.includes(w));
}
// 3 = offiziell verknüpft, 2 = passt zum Suchzusatz, 1 = Websuche mit vollem Namen, 0 = nur gleicher Name auf der Plattform
function confidence(p) {
  if ([...p.sources].some((s) => VERIFIED_SOURCES.has(s))) return 3;
  if (ctxMatch(`${p.bio || ""} ${p.title || ""} ${p.displayName || ""}`)) return 2;
  if (p.sources.has("Websuche") || p.sources.has("GitHub-Profil")) return 1;
  return 0;
}

function dossierDone(part, seq) {
  if (!dossierAlive(seq)) return;
  D.pending.delete(part);
  scheduleRender();
}

function cleanValue(v) {
  return String(v || "").replace(/\s+/g, " ").replace(/^[\s,;:·|–-]+|[\s,;:·|–-]+$/g, "").trim();
}
function addFact(kind, value, source, max = 160) {
  if (!D) return;
  value = cleanValue(value);
  if (value.length < 2 || value.length > max) return;
  const key = fold(value).replace(/[^a-z0-9]/g, "");
  if (!key) return;
  const map = D.facts[kind];
  const entry = map.get(key) || {value, sources: new Set()};
  entry.sources.add(source);
  map.set(key, entry);
  scheduleRender();
}
function addCount(key, n) {
  if (!D) return;
  D.counts[key] = n;
  scheduleRender();
}

function addProfile(platformId, handle, source, extra = {}) {
  if (!D || !handle) return;
  const p = PLATFORM[platformId];
  const key = `${platformId}:${handle.toLowerCase()}`;
  const prof = D.profiles.get(key) || {platform: p, handle, url: extra.url || p.url(handle), sources: new Set()};
  prof.sources.add(source);
  if (extra.displayName && !prof.displayName) prof.displayName = extra.displayName;
  if (extra.bio && !prof.bio) prof.bio = extra.bio;
  if (extra.title && !prof.title) prof.title = extra.title;
  D.profiles.set(key, prof);
  scheduleRender();
}
function addMention(platformId, r) {
  const list = D.mentions.get(platformId) || [];
  if (!list.some((m) => m.url === r.url)) list.push({url: r.url, title: r.title, snippet: r.snippet});
  D.mentions.set(platformId, list);
}

function clearSources(sources) {
  if (!D) return;
  const drop = (set) => sources.forEach((s) => set.delete(s));
  for (const map of Object.values(D.facts)) for (const [k, e] of map) { drop(e.sources); if (!e.sources.size) map.delete(k); }
  for (const [k, p] of D.profiles) { drop(p.sources); if (!p.sources.size) D.profiles.delete(k); }
  if (sources.includes("Wikidata")) D.headline = null;
  scheduleRender();
}

let renderTimer = null;
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => { if (D) { renderSummary(); renderSocial(); } }, 120);
}

// ------------------------------------------------------------------ Fakten aus den Quellen
function dossierFromWikidata(e, seq) {
  if (!dossierAlive(seq)) return;
  clearSources(["Wikidata", "DNB", "OpenAlex (ORCID)", "OpenAlex"]);
  D.headline = {name: labelOf(e), desc: descOf(e), image: strings(e, "P18")[0]};
  const src = "Wikidata";
  itemIds(e, "P106").forEach((id) => addFact("roles", L(id), src));
  for (const c of claims(e, "P39").all) {
    const v = val(c);
    if (v?.id) addFact("roles", L(v.id) + (qual(c, "P582") ? " (ehemals)" : ""), src);
  }
  for (const c of claims(e, "P108").all) if (val(c)?.id) addFact("orgs", L(val(c).id) + (qual(c, "P582") ? " (ehemals)" : ""), src);
  itemIds(e, "P102").forEach((id) => addFact("orgs", `${L(id)} (Partei)`, src));
  itemIds(e, "P463").slice(0, 8).forEach((id) => addFact("orgs", `${L(id)} (Mitglied)`, src));
  itemIds(e, "P54").slice(-3).forEach((id) => addFact("orgs", `${L(id)} (Mannschaft)`, src));
  itemIds(e, "P69").forEach((id) => addFact("education", L(id), src));
  itemIds(e, "P19").forEach((id) => addFact("places", `${L(id)} (Geburtsort)`, src));
  itemIds(e, "P551").forEach((id) => addFact("places", `${L(id)} (Wohnort)`, src));
  strings(e, "P856").forEach((u) => addFact("websites", u, src, 300));

  const map = {P2002: "x", P2003: "instagram", P2013: "facebook", P7085: "tiktok", P6634: "linkedin", P2037: "github", P4033: "mastodon"};
  for (const [prop, platform] of Object.entries(map)) strings(e, prop).forEach((v) => addProfile(platform, v, src));
  strings(e, "P2397").forEach((v) => addProfile("youtube", `channel/${v}`, src));
}

function dossierFromGnd(members, verified, seq) {
  if (!dossierAlive(seq)) return;
  clearSources(["DNB"]);
  if (!verified && members.length !== 1) return; // bei mehreren Namensgleichen nichts übernehmen
  const m = members[0];
  const labels = (arr) => (arr || []).map((x) => x.label || x).filter(Boolean);
  labels(m.professionOrOccupation).forEach((v) => addFact("roles", v, "DNB"));
  labels(m.affiliation).forEach((v) => addFact("orgs", v, "DNB"));
  labels(m.placeOfBirth).forEach((v) => addFact("places", `${v} (Geburtsort)`, "DNB"));
  labels(m.placeOfActivity).forEach((v) => addFact("places", `${v} (Wirkungsort)`, "DNB"));
}

function dossierFromScience(top, verified, seq) {
  if (!dossierAlive(seq) || !top) return;
  clearSources(["OpenAlex", "OpenAlex (ORCID)"]);
  const src = verified ? "OpenAlex (ORCID)" : "OpenAlex";
  (top.last_known_institutions || []).forEach((i) => addFact("orgs", i.display_name, src));
  addCount("publications", top.works_count);
}

const ROLE_WORDS = String.raw`Geschäftsführer(?:in)?|Geschäftsinhaber(?:in)?|Inhaber(?:in)?|Gründer(?:in)?|Mitgründer(?:in)?|Co-?Founder|Founder|CEO|CTO|CFO|COO|CMO|CPO|Vorstandsvorsitzende[rn]?|Vorstandsmitglied|Vorstand|Aufsichtsratsvorsitzende[rn]?|Aufsichtsrat|Gesellschafter(?:in)?|Prokurist(?:in)?|Managing Director|Managing Partner|Geschäftsleitung|Bereichsleiter(?:in)?|Abteilungsleiter(?:in)?|Teamleiter(?:in)?|Head of [A-Z][\w&-]+(?: [A-Z][\w&-]+)?|Professor(?:in)?|Rechtsanwalt|Rechtsanwältin|Notar(?:in)?|Steuerberater(?:in)?|Wirtschaftsprüfer(?:in)?|Zahnarzt|Zahnärztin|Arzt|Ärztin|Architekt(?:in)?|Unternehmensberater(?:in)?|Coach|Autor(?:in)?|Journalist(?:in)?|Fotograf(?:in)?|Designer(?:in)?|Softwareentwickler(?:in)?|Software[- ]Engineer|Ingenieur(?:in)?|Makler(?:in)?|Immobilienmakler(?:in)?|Bürgermeister(?:in)?|Abgeordnete[r]?|Influencer(?:in)?|Speaker|Trainer(?:in)?|Berater(?:in)?`;
const ROLE_RE = new RegExp(`(?<![\\wäöüÄÖÜß])(${ROLE_WORDS})(?![\\wäöüß])`, "g");
const LEGAL_FORMS = String.raw`GmbH & Co\. KG|gGmbH|GmbH|AG|SE|UG \(haftungsbeschränkt\)|UG|KGaA|KG|OHG|GbR|PartG mbB|PartG|mbH|e\. ?K\.|e\. ?V\.|Ltd\.?|Inc\.?|LLC|S\.A\.|B\.V\.|AB|Oy`;
const COMPANY_RE = new RegExp(String.raw`((?:[A-ZÄÖÜ0-9][\wÄÖÜäöüß&.+'’-]*\s){0,4}[A-ZÄÖÜ0-9][\wÄÖÜäöüß&.+'’-]*\s(?:${LEGAL_FORMS}))(?![\wäöü])`, "g");
const LEADING_NOISE = /^(die|der|das|den|dem|des|the|bei|von|vom|für|mit|als|und|zur|zum|at|of|for|and|ein|eine|einer|ist|war|seit|in|im)\s+/i;
const LABELLED = [
  [/(?:Standort|Ort|Location|Wohnort|Region|Sitz):\s*([A-ZÄÖÜ][^·|;:\n]{1,50})/g, "places"],
  [/(?:Berufserfahrung|Experience|Unternehmen|Company|Arbeitgeber):\s*([^·|;:\n]{2,70})/g, "orgs"],
  [/(?:Ausbildung|Education|Studium):\s*([^·|;:\n]{2,90})/g, "education"],
];

function sentencesWith(text, needle) {
  return text.split(/(?<=[.!?…])\s+|\s[·|]\s|\n+/).filter((s) => fold(s).includes(needle));
}

function dossierFromWeb(results, name, seq) {
  if (!dossierAlive(seq)) return;
  clearSources(["Websuche"]);
  D.mentions.clear();
  const words = fold(name).split(/\s+/).filter(Boolean);
  const surname = words[words.length - 1] || "";
  const src = "Websuche";

  for (const r of results) {
    if (r.match < 2) continue; // nur Treffer, die den vollständigen Namen nennen
    const social = detectSocial(r.url);
    if (social) {
      if (social.handle) addProfile(social.platform.id, social.handle, src, {title: r.title, url: r.url.split(/[?#]/)[0]});
      else addMention(social.platform.id, r);
    }
    if (r.cat === "own") {
      try { addFact("websites", new URL(r.url).origin, src, 300); } catch { /* ignorieren */ }
    }

    // „Name – Rolle – Firma | LinkedIn/XING“
    if (social && ["linkedin", "xing"].includes(social.platform.id)) {
      const parts = r.title.replace(/\s*[|–-]\s*(LinkedIn|XING)\s*$/i, "").split(/\s+[-–|]\s+/).map(cleanValue);
      if (parts.length > 1 && fold(parts[0]).includes(surname)) {
        const [, a, b] = parts;
        if (b) { addFact("roles", a, src, 80); addFact("orgs", b, src, 80); }
        else if (new RegExp(`^(${ROLE_WORDS})`, "i").test(a)) addFact("roles", a, src, 80);
        else addFact("orgs", a, src, 80);
      }
    }
    // „Name, Ort - North Data“ / „Firma, Ort - CompanyHouse“
    const place = r.title.match(/^(.+?),\s*([A-ZÄÖÜ][^,–-]{1,40}?)\s*[-–]\s*(North Data|CompanyHouse|Moneyhouse|Firmenwissen)/);
    if (place) {
      addFact("places", place[2], src, 60);
      if (!fold(place[1]).includes(surname)) addFact("orgs", place[1], src, 80);
    }

    const text = `${r.title}. ${r.snippet}`;
    for (const s of sentencesWith(text, surname)) {
      for (const m of s.matchAll(ROLE_RE)) addFact("roles", m[1], src, 80);
      for (const m of s.matchAll(COMPANY_RE)) addFact("orgs", m[1].replace(LEADING_NOISE, "").replace(LEADING_NOISE, ""), src, 80);
    }
    for (const [re, kind] of LABELLED) for (const m of text.matchAll(re)) addFact(kind, m[1], src, 90);

    // Selbstbeschreibungen: Ich-Form auf Profilen oder eigener Website
    if ((social || r.cat === "own") && /\b(ich|mein|meine|I am|I'm|my)\b/i.test(r.snippet) && r.snippet.length > 40) {
      addFact("bios", `„${r.snippet.slice(0, 260)}${r.snippet.length > 260 ? " …" : ""}“ – ${r.host}`, src, 320);
    }
  }
  scheduleRender();
}

// Direkte Namenssuche auf Plattformen mit offener Schnittstelle
async function loadSocial(name, seq) {
  const words = fold(name).split(/\s+/).filter(Boolean);
  const matches = (display) => display && words.every((w) => fold(display).includes(w));
  const jobs = [
    (async () => {
      const d = await getJSON(`${BSKY}/app.bsky.actor.searchActors?${qs({q: name, limit: 15})}`);
      if (!dossierAlive(seq)) return;
      for (const a of d.actors || []) {
        if (matches(a.displayName)) addProfile("bluesky", a.handle, "Suche auf Bluesky", {displayName: a.displayName, bio: a.description});
      }
    })(),
    (async () => {
      const d = await getJSON(`https://mastodon.social/api/v2/search?${qs({q: name, type: "accounts", limit: 15})}`);
      if (!dossierAlive(seq)) return;
      for (const a of d.accounts || []) {
        if (!matches(a.display_name)) continue;
        const handle = a.acct.includes("@") ? a.acct : `${a.acct}@mastodon.social`;
        addProfile("mastodon", handle, "Suche im Fediverse", {displayName: a.display_name, bio: htmlText(a.note), url: a.url});
      }
    })(),
    (async () => {
      const d = await getJSON(`https://api.github.com/search/users?${qs({q: `${name} in:name`, per_page: 5})}`);
      for (const u of (d.items || []).slice(0, 3)) {
        const user = await getJSON(`https://api.github.com/users/${encodeURIComponent(u.login)}`);
        if (!dossierAlive(seq) || !matches(user.name)) continue;
        addProfile("github", user.login, "Suche auf GitHub", {displayName: user.name, bio: [user.bio, user.company, user.location].filter(Boolean).join(" · ")});
        if (!ctxMatch(`${user.bio} ${user.company} ${user.location} ${user.blog}`)) continue; // Angaben nur übernehmen, wenn sie zum Suchzusatz passen
        if (user.company) addFact("orgs", user.company.replace(/^@/, ""), "GitHub-Profil", 80);
        if (user.location) addFact("places", user.location, "GitHub-Profil", 60);
        if (user.blog) addFact("websites", /^https?:/.test(user.blog) ? user.blog : `https://${user.blog}`, "GitHub-Profil", 300);
        if (user.twitter_username) addProfile("x", user.twitter_username, "GitHub-Profil");
      }
    })(),
  ];
  await Promise.allSettled(jobs);
}

// ------------------------------------------------------------------ Beiträge & Kommentare
function htmlText(html) {
  const doc = new DOMParser().parseFromString(String(html || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n"), "text/html");
  return (doc.body.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}
const fmtDate = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString("de-DE", {dateStyle: "medium", timeStyle: "short"}); };

async function bskyFeed(handle) {
  const d = await getJSON(`${BSKY}/app.bsky.feed.getAuthorFeed?${qs({actor: handle, limit: 25, filter: "posts_with_replies"})}`);
  return (d.feed || []).map((f) => {
    const p = f.post, rec = p.record || {};
    const repost = String(f.reason?.$type || "").includes("reasonRepost");
    return {
      kind: repost ? `Geteilt (von @${p.author.handle})` : rec.reply ? "Antwort / Kommentar" : "Beitrag",
      text: rec.text || (p.embed ? "(Bild, Video oder Link)" : ""), date: rec.createdAt,
      url: `https://bsky.app/profile/${p.author.handle}/post/${p.uri.split("/").pop()}`,
      meta: `${p.likeCount || 0} Likes`, comments: p.replyCount || 0,
      loadComments: p.replyCount ? async () => {
        const t = await getJSON(`${BSKY}/app.bsky.feed.getPostThread?${qs({uri: p.uri, depth: 1, parentHeight: 0})}`);
        return (t.thread?.replies || []).filter((r) => r.post).map((r) => ({
          author: r.post.author.displayName ? `${r.post.author.displayName} (@${r.post.author.handle})` : `@${r.post.author.handle}`,
          text: r.post.record?.text, date: r.post.record?.createdAt,
        }));
      } : null,
    };
  });
}

async function mastoFeed(handle) {
  const [user, host] = handle.split("@");
  const acc = await getJSON(`https://${host}/api/v1/accounts/lookup?${qs({acct: user})}`);
  const statuses = await getJSON(`https://${host}/api/v1/accounts/${acc.id}/statuses?${qs({limit: 25})}`);
  return statuses.map((s) => {
    const p = s.reblog || s;
    return {
      kind: s.reblog ? `Geteilt (von @${p.account.acct})` : s.in_reply_to_id ? "Antwort / Kommentar" : "Beitrag",
      text: htmlText(p.content) || (p.media_attachments?.length ? "(Bild oder Video)" : ""), date: p.created_at, url: p.url,
      meta: `${p.favourites_count || 0} Favoriten`, comments: p.replies_count || 0,
      loadComments: p.replies_count ? async () => {
        const ctx = await getJSON(`https://${host}/api/v1/statuses/${p.id}/context`);
        return (ctx.descendants || []).filter((x) => x.in_reply_to_id === p.id).map((x) => ({
          author: `${x.account.display_name || ""} (@${x.account.acct})`.trim(), text: htmlText(x.content), date: x.created_at,
        }));
      } : null,
    };
  });
}

async function githubFeed(user) {
  const events = await getJSON(`https://api.github.com/users/${encodeURIComponent(user)}/events/public?${qs({per_page: 40})}`);
  return events.map((e) => {
    const repo = e.repo?.name, pl = e.payload || {};
    if (pl.comment) return {kind: `Kommentar in ${repo}`, text: (pl.comment.body || "").slice(0, 1500), date: e.created_at, url: pl.comment.html_url};
    if (e.type === "IssuesEvent") return {kind: `Issue (${pl.action}) in ${repo}`, text: pl.issue?.title, date: e.created_at, url: pl.issue?.html_url};
    if (e.type === "PullRequestEvent") return {kind: `Pull Request (${pl.action}) in ${repo}`, text: pl.pull_request?.title, date: e.created_at, url: pl.pull_request?.html_url};
    if (e.type === "PushEvent") return {kind: `Commits in ${repo}`, text: (pl.commits || []).map((c) => "• " + c.message.split("\n")[0]).join("\n"), date: e.created_at, url: `https://github.com/${repo}`};
    if (e.type === "ReleaseEvent") return {kind: `Release in ${repo}`, text: pl.release?.name || pl.release?.tag_name, date: e.created_at, url: pl.release?.html_url};
    return null;
  }).filter((x) => x && x.text);
}

async function redditFeed(user) {
  try {
    const d = await getJSON(`https://www.reddit.com/user/${encodeURIComponent(user)}/comments.json?${qs({limit: 25, raw_json: 1})}`);
    return (d.data?.children || []).map(({data: c}) => ({
      kind: `Kommentar in r/${c.subreddit}`, text: c.body, date: new Date(c.created_utc * 1000).toISOString(),
      url: `https://www.reddit.com${c.permalink}`, meta: `${c.score} Punkte`,
    }));
  } catch {
    throw new Error("Reddit gibt Kommentare ohne Anmeldung gerade nicht heraus – bitte über den Profil-Link ansehen.");
  }
}

async function hnFeed(user) {
  const d = await getJSON(`https://hn.algolia.com/api/v1/search_by_date?${qs({tags: `comment,author_${user}`, hitsPerPage: 25})}`);
  return (d.hits || []).map((x) => ({
    kind: `Kommentar zu „${x.story_title || "Beitrag"}“`, text: htmlText(x.comment_text), date: x.created_at,
    url: `https://news.ycombinator.com/item?id=${x.objectID}`,
  }));
}

function feedItem(it) {
  const replies = h("div", {class: "replies", hidden: true});
  const btn = it.loadComments ? h("button", {class: "btn small", type: "button", onclick: async () => {
    replies.hidden = !replies.hidden;
    if (replies.hidden || replies.dataset.loaded) return;
    replies.dataset.loaded = "1";
    fill(replies, h("span", {class: "spinner"}), " Kommentare laden …");
    try {
      const list = await it.loadComments();
      fill(replies, list.length
        ? h("ul", {class: "list"}, list.map((c) => h("li", {}, h("div", {class: "meta"}, [c.author, fmtDate(c.date)].filter(Boolean).join(" · ")), h("div", {class: "posttext"}, c.text || ""))))
        : h("p", {class: "empty"}, "Keine öffentlich sichtbaren Kommentare."));
    } catch (err) { fill(replies, h("p", {class: "empty"}, `Kommentare nicht abrufbar: ${err.message}`)); }
  }}, `Kommentare anzeigen (${it.comments})`) : null;
  return h("li", {},
    h("div", {class: "meta"}, [it.kind, fmtDate(it.date), it.meta].filter(Boolean).join(" · "), it.url ? [" · ", extLink(it.url, "öffnen")] : null),
    h("div", {class: "posttext"}, it.text || ""), btn, replies);
}

// ------------------------------------------------------------------ Darstellung: Social Media
const SOURCE_LABEL = (s) => (s === "Wikidata" ? "offiziell verknüpft (Wikidata)" : s === "Websuche" ? "über Websuche gefunden" : s);

function profileNode(p) {
  if (p.node) return p.node;
  const box = h("div", {class: "feed-box", hidden: true});
  p.titleEl = h("span");
  p.badgeEl = h("div", {class: "badges"});
  p.bioEl = h("div", {class: "meta"});
  let action;
  if (p.platform.feed) {
    action = h("button", {class: "btn small", type: "button", onclick: async () => {
      box.hidden = !box.hidden;
      action.textContent = box.hidden ? "Beiträge & Kommentare anzeigen" : "Beiträge ausblenden";
      if (box.hidden || box.dataset.loaded) return;
      box.dataset.loaded = "1";
      fill(box, h("span", {class: "spinner"}), " Beiträge laden …");
      try {
        const items = await p.platform.feed(p.handle);
        fill(box, items.length ? h("ul", {class: "list feed"}, items.map(feedItem)) : h("p", {class: "empty"}, "Keine öffentlichen Beiträge gefunden."),
          h("p", {class: "source"}, `Quelle: öffentliche Schnittstelle von ${p.platform.label}`));
      } catch (err) { fill(box, h("p", {class: "empty"}, `Beiträge nicht abrufbar: ${err.message}`)); }
    }}, "Beiträge & Kommentare anzeigen");
  } else {
    action = h("span", {},
      h("span", {class: "meta"}, "Beiträge & Kommentare nur mit Anmeldung auf der Plattform sichtbar. "),
      h("button", {class: "btn small", type: "button", onclick: () => {
        box.hidden = !box.hidden;
        if (!box.hidden && !box.dataset.loaded) { box.dataset.loaded = "1"; box.classList.add("reader"); readPage(p.url, D.name, box); }
      }}, "Öffentliche Profilseite auslesen"));
  }
  p.node = h("li", {}, extLink(p.url, p.titleEl), p.badgeEl, p.bioEl, action, box);
  return p.node;
}

function updateProfileNode(p) {
  profileNode(p);
  p.titleEl.textContent = p.displayName ? `${p.displayName} · ${p.handle}` : p.handle;
  fill(p.badgeEl, [...p.sources].map((s) => h("span", {class: "badge" + (VERIFIED_SOURCES.has(s) ? " ok" : "")}, SOURCE_LABEL(s))));
  p.bioEl.textContent = p.bio || p.title || "";
}

function renderSocial() {
  const c = D.social;
  const byPlatform = new Map();
  for (const p of D.profiles.values()) {
    if (!byPlatform.has(p.platform.id)) byPlatform.set(p.platform.id, []);
    byPlatform.get(p.platform.id).push(p);
  }
  const found = PLATFORMS.filter((p) => byPlatform.has(p.id) || D.mentions.has(p.id));
  const busy = D.pending.has("web") || D.pending.has("social");

  const sections = found.map((plat) => {
    const profiles = (byPlatform.get(plat.id) || []).sort((a, b) => confidence(b) - confidence(a) || b.sources.size - a.sources.size);
    profiles.forEach(updateProfileNode);
    const strong = profiles.filter((p) => confidence(p) > 0), weak = profiles.filter((p) => confidence(p) === 0);
    const mentions = D.mentions.get(plat.id) || [];
    const count = strong.length ? `${strong.length} Profil${strong.length > 1 ? "e" : ""}` : profiles.length ? "nur Namensgleiche" : "nur Erwähnungen";
    return h("div", {class: "platform", id: `plat-${plat.id}`},
      h("h3", {}, plat.label, h("span", {class: "meta"}, ` – ${count}`)),
      strong.length ? h("ul", {class: "list"}, strong.map((p) => p.node)) : null,
      weak.length ? h("details", {class: "mentions", open: !strong.length && weak.length <= 3 ? true : null},
        h("summary", {}, `${strong.length ? "Weitere " : ""}Konten mit gleichem Namen (${weak.length}) – nicht sicher dieselbe Person`),
        h("ul", {class: "list"}, weak.map((p) => p.node))) : null,
      mentions.length ? h("details", {class: "mentions"}, h("summary", {}, `Gefundene Beiträge & Seiten (${mentions.length})`),
        h("ul", {class: "list"}, mentions.slice(0, 15).map((m) => h("li", {}, extLink(m.url, m.title || m.url), m.snippet ? h("div", {class: "meta"}, m.snippet) : null)))) : null);
  });

  const missing = MAIN_PLATFORMS.filter((id) => !byPlatform.has(id));
  const phrase = `"${D.name.replace(/"/g, "")}"`;
  const chips = found.map((p) => {
    const list = byPlatform.get(p.id) || [];
    const n = list.filter((x) => confidence(x) > 0).length;
    return h("a", {class: "pchip" + (list.some((x) => confidence(x) >= 2) ? " ok" : n ? "" : " weak"), href: `#plat-${p.id}`},
      `${p.label} ${n || (list.length ? `(${list.length} gleichnamig)` : "· erwähnt")}`);
  });

  if (!found.length && busy) return;
  fill(c.body,
    found.length ? h("div", {class: "pchips"}, chips) : h("p", {class: "empty"}, "Keine Social-Media-Profile mit diesem Namen gefunden."),
    found.length ? h("p", {class: "meta"}, "Grün = offiziell verknüpft oder passend zum Suchzusatz. Alle anderen Profile wurden über den Namen gefunden und können Namensvettern gehören. Tipp: Mit einem Zusatz (Firma, Ort, Beruf) werden die Treffer genauer.") : null,
    ...sections,
    missing.length ? h("p", {class: "meta missing"}, "Nicht gefunden auf: ",
      missing.flatMap((id, i) => [i ? ", " : "", PLATFORM_SEARCH[id]
        ? extLink(`https://www.google.com/search?q=${encodeURIComponent(`${phrase} site:${PLATFORM_SEARCH[id]}`)}`, PLATFORM[id].label)
        : PLATFORM[id].label]), " (Link = selbst nachsuchen)") : null);
  if (busy) c.busy(); else c.done(`${[...D.profiles.values()].filter((p) => confidence(p) > 0).length} Profile`);
}

// ------------------------------------------------------------------ Darstellung: Steckbrief
function factList(kind, render = (e) => e.value) {
  const entries = [...D.facts[kind].values()].sort((a, b) =>
    (Number([...b.sources].some((s) => VERIFIED_SOURCES.has(s))) - Number([...a.sources].some((s) => VERIFIED_SOURCES.has(s)))) || b.sources.size - a.sources.size);
  const item = (e) => h("li", {}, render(e), h("span", {class: "src"}, ` ${[...e.sources].join(", ")}`));
  if (entries.length <= 8) return h("ul", {class: "facts-list"}, entries.map(item));
  return h("div", {}, h("ul", {class: "facts-list"}, entries.slice(0, 8).map(item)),
    h("details", {}, h("summary", {}, `${entries.length - 8} weitere`), h("ul", {class: "facts-list"}, entries.slice(8).map(item))));
}

function renderSummary() {
  const c = D.summary;
  const hl = D.headline;
  const rows = [];
  for (const kind of ["roles", "orgs", "places", "education"]) {
    if (D.facts[kind].size) rows.push([FACT_KINDS[kind], factList(kind)]);
  }
  if (D.facts.websites.size) rows.push([FACT_KINDS.websites, factList("websites", (e) => extLink(e.value, e.value.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")))]);

  const platforms = new Map();
  let namesakes = 0;
  for (const p of D.profiles.values()) {
    if (confidence(p) === 0) { namesakes++; continue; }
    const cur = platforms.get(p.platform.id) || {label: p.platform.label, n: 0, verified: false};
    cur.n++; cur.verified ||= confidence(p) >= 2;
    platforms.set(p.platform.id, cur);
  }
  if (platforms.size || namesakes) {
    rows.push(["Soziale Medien", h("div", {}, h("div", {class: "pchips"}, [...platforms].map(([id, p]) =>
      h("a", {class: "pchip" + (p.verified ? " ok" : ""), href: `#plat-${id}`}, `${p.label}${p.n > 1 ? ` (${p.n})` : ""}`))),
      namesakes ? h("div", {class: "meta"}, `+ ${namesakes} Konten mit gleichem Namen (siehe „Soziale Medien“)`) : null)]);
  }
  const traces = [
    D.counts.news != null && `${D.counts.news} Nachrichtenartikel (3 Monate)`,
    D.counts.publications && `${D.counts.publications} wissenschaftliche Veröffentlichungen`,
    D.counts.archive && `${D.counts.archive} Einträge im Internet Archive`,
    D.counts.web != null && `${D.counts.web} Webseiten mit dem Namen`,
  ].filter(Boolean);
  if (traces.length) rows.push(["Öffentliche Spuren", traces.join(" · ")]);
  if (D.facts.bios.size) rows.push([FACT_KINDS.bios, factList("bios")]);

  const busy = D.pending.size > 0;
  if (!rows.length && busy) return;
  const img = hl?.image ? h("img", {src: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(hl.image)}?width=240`, alt: `Foto: ${hl.name}`, loading: "lazy"}) : null;
  fill(c.body,
    h("div", {class: "summary-head" + (img ? " with-img" : "")}, img,
      h("div", {}, h("h2", {class: "sum-name"}, hl?.name || D.name), hl?.desc ? h("p", {class: "desc"}, hl.desc) : null,
        D.ctx ? h("p", {class: "meta"}, `Suchzusatz: ${D.ctx}`) : null)),
    rows.length ? h("dl", {class: "facts summary"}, rows.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]))
      : h("p", {class: "empty"}, "Zu diesem Namen ließ sich nichts Eindeutiges zusammentragen."),
    h("p", {class: "meta"}, "Automatisch aus allen Quellen zusammengestellt; hinter jeder Angabe steht, woher sie kommt. ",
      "Angaben aus Wikidata, DNB oder ORCID sind der Person sicher zugeordnet – alles aus der Websuche kann auch von Namensvettern stammen."),
    h("div", {class: "toolbar"}, h("button", {class: "btn small", type: "button", onclick: copySummary}, "Steckbrief als Text kopieren")));
  if (busy) c.busy(); else c.done();
}

function summaryText() {
  const lines = [`Steckbrief: ${D.headline?.name || D.name}`];
  if (D.headline?.desc) lines.push(D.headline.desc);
  for (const [kind, label] of Object.entries(FACT_KINDS)) {
    if (!D.facts[kind].size) continue;
    lines.push("", `${label}:`, ...[...D.facts[kind].values()].map((e) => `- ${e.value} [${[...e.sources].join(", ")}]`));
  }
  if (D.profiles.size) {
    lines.push("", "Soziale Medien:", ...[...D.profiles.values()].filter((p) => confidence(p) > 0).map((p) => `- ${p.platform.label}: ${p.url} [${[...p.sources].join(", ")}]`));
  }
  lines.push("", `Erstellt mit der Personensuche am ${new Date().toLocaleString("de-DE")}`);
  return lines.join("\n");
}
function copySummary(ev) {
  const b = ev.currentTarget, text = summaryText();
  navigator.clipboard?.writeText(text).then(() => { b.textContent = "✓ Kopiert"; }, () => prompt("Steckbrief:", text));
}

if (typeof module !== "undefined") module.exports = {detectSocial, ROLE_RE, COMPANY_RE};
