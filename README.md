# Menschensucher – Personensuche

Eine Suchmaschine für Personen als reine HTML-Website – ohne Server, ohne Anmeldung, ohne API-Schlüssel.
Alles läuft im Browser und durchsucht **das gesamte öffentlich zugängliche Internet** – ideal, um Unternehmer:innen,
Selbstständige und alle zu finden, die sich online präsentieren.

## Was sie kann

**Suche nach Name** – gibt einen Namen (optional mit Zusatz wie Beruf, Ort oder Firma) ein und bekommt:

| Bereich | Quelle |
|---|---|
| **Im Internet gefunden:** eigene Websites, LinkedIn/XING/Instagram & Co., Firmen & Handelsregister-Auszüge (North Data, CompanyHouse …), Presse, Interviews, Podcasts – automatisch sortiert | Websuche im ganzen Internet (mehrere Suchen pro Person: allgemein, Beruf & Unternehmen, Profile, eigene Website, Auftritte) |
| **Seite auslesen:** zeigt bei jedem Treffer, was dort über die Person steht (Stellen mit dem Namen + ganzer Text) | Jina Reader |
| Steckbrief: Geburt, Tod, Beruf, Ausbildung, Arbeitgeber, Partei, Mitgliedschaften, offizielle Profile | Wikidata |
| Leben & Wirken (ganzer Artikel, nach Abschnitten) | Wikipedia (de, sonst en) |
| Ämter, Funktionen & Stationen als Zeitleiste | Wikidata |
| Auszeichnungen, bekannte Werke | Wikidata |
| Aktuelle Nachrichten weltweit (letzte 3 Monate) | GDELT Project |
| Normdaten, Bücher von/über die Person | Deutsche Nationalbibliothek (GND, über lobid.org) |
| Wissenschaftliche Veröffentlichungen | OpenAlex, ORCID |
| Bücher, Videos, Audio, Dokumente | Internet Archive |
| Über 50 vorbereitete Suchen: Suchmaschinen, Presse, Handels- & Unternehmensregister, Datenbanken („Deep Web“: DNB, Deutsche Digitale Bibliothek, Europeana, WorldCat …), Patente, Politik, öffentliche Social-Media-Profile, Mediatheken | Links |

Bei mehrdeutigen Namen zeigt die Seite alle passenden Personen zur Auswahl. Ergebnisse lassen sich drucken bzw.
als PDF speichern, und jede Suche hat einen teilbaren Link (`…/#name=Marie+Curie`).

**Suche mit Bild** – Rückwärts-Bildersuche über Google Lens, Bing und TinEye. Sie findet heraus, *wo dieses Bild*
im Netz veröffentlicht ist (Artikel, Wikipedia, Firmenseite) – dort steht meist der Name. Den gefundenen Namen
kann man direkt an die Namenssuche übergeben.

### Websuche einstellen (⚙ oben rechts)

| Einstellung | Kosten | Hinweis |
|---|---|---|
| Kostenlos, ohne Anmeldung (Standard) | gratis | DuckDuckGo, bei Bedarf automatisch DuckDuckGo Lite oder Bing, abgerufen über Jina Reader. Kann bei vielen gleichzeitigen Suchen kurz überlastet sein. |
| Google-Ergebnisse über [Serper.dev](https://serper.dev) | 2.500 Suchen gratis | beste Trefferqualität |
| [Tavily](https://tavily.com) | 1.000 Suchen/Monat gratis | |
| [Jina Search](https://jina.ai) | Gratis-Kontingent | ein Jina-Schlüssel erhöht auch die Limits für „Seite auslesen“ |

API-Schlüssel werden nur im eigenen Browser gespeichert (localStorage) und nur an den jeweiligen Anbieter geschickt.

### Bewusst nicht enthalten

- **Gesichtserkennung** (PimEyes, FaceCheck.ID, Yandex-Gesichtssuche): Gesichter sind nach DSGVO Art. 9 besonders
  geschützte biometrische Daten, und solche Dienste werden oft zum Stalken von Privatpersonen missbraucht.
  Die Bildsuche findet deshalb *dasselbe Bild*, nicht *dasselbe Gesicht*.
- Personensuchmaschinen, Adresshändler, Leak- und Passwort-Datenbanken, Doxing-Foren, Darknet – Treffer von solchen
  Seiten werden in der Websuche automatisch ausgeblendet.

## Starten

**Lokal:** `index.html` im Browser öffnen (Doppelklick). Fertig.

**Online über GitHub Pages (kostenlos):**

1. Auf GitHub: **Settings → Pages → Build and deployment**
2. **Source:** „Deploy from a branch“, **Branch:** `main`, Ordner **`/ (root)`** → **Save**
3. Nach 1–2 Minuten ist die Seite online unter `https://germanclaude.github.io/Menschensucher/`
   und aktualisiert sich bei jedem Push auf `main` von selbst.

## Dateien

- `index.html` – Seitenaufbau
- `style.css` – Design (hell/dunkel, handytauglich)
- `app.js` – Suchlogik und Quellen

## Verantwortungsvoll nutzen

Die Seite zeigt nur, was ohnehin öffentlich ist. Trotzdem: Informationen über Privatpersonen zu sammeln, sie zu
belästigen oder bloßzustellen, kann strafbar sein (u. a. § 238 StGB Nachstellung) und gegen die DSGVO verstoßen.
Bei gleichen Namen immer prüfen, ob wirklich dieselbe Person gemeint ist.
