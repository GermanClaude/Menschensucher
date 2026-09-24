# Menschensucher – Personensuche

Eine Suchmaschine für Personen als reine HTML-Website – ohne Server, ohne Anmeldung, ohne API-Schlüssel.
Alles läuft im Browser und fragt **nur öffentliche, legale Quellen** ab.

## Was sie kann

**Suche nach Name** – gibt einen Namen (optional mit Zusatz wie Beruf, Ort oder Firma) ein und bekommt:

| Bereich | Quelle |
|---|---|
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

### Bewusst nicht enthalten

- **Gesichtserkennung** (PimEyes, FaceCheck.ID, Yandex-Gesichtssuche): Gesichter sind nach DSGVO Art. 9 besonders
  geschützte biometrische Daten, und solche Dienste werden oft zum Stalken von Privatpersonen missbraucht.
  Die Bildsuche findet deshalb *dasselbe Bild*, nicht *dasselbe Gesicht*.
- Personensuchmaschinen, Adresshändler, Leak- und Passwort-Datenbanken, Darknet.

## Starten

**Lokal:** `index.html` im Browser öffnen (Doppelklick). Fertig.

**Online über GitHub Pages (kostenlos):**

1. Auf GitHub: **Settings → Pages → Build and deployment → Source: „GitHub Actions“** wählen.
2. Unter **Actions → „Auf GitHub Pages veröffentlichen“ → Run workflow** einmal starten.
   Danach wird die Seite bei jedem Push auf `main` automatisch aktualisiert.
3. Die Adresse lautet dann `https://germanclaude.github.io/Menschensucher/`.

## Dateien

- `index.html` – Seitenaufbau
- `style.css` – Design (hell/dunkel, handytauglich)
- `app.js` – Suchlogik und Quellen

## Verantwortungsvoll nutzen

Die Seite zeigt nur, was ohnehin öffentlich ist. Trotzdem: Informationen über Privatpersonen zu sammeln, sie zu
belästigen oder bloßzustellen, kann strafbar sein (u. a. § 238 StGB Nachstellung) und gegen die DSGVO verstoßen.
Bei gleichen Namen immer prüfen, ob wirklich dieselbe Person gemeint ist.
