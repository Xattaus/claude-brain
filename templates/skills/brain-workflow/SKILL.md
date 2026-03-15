---
name: brain-workflow
description: Autonominen kontekstinhallinta. Aktivoidu kun Claude työskentelee koodin kanssa ja tarvitaan kontekstinhallintaa — päätösten, bugien, toteutusten, mallien ja suunnitelmien tallentamista .brain/-tietokantaan MCP-työkaluilla.
---

# Brain Workflow — Autonominen kontekstinhallinta

Tässä projektissa on käytössä **MCP-pohjainen kontekstinhallintajärjestelmä** (`.brain/`-kansio).
Käytä **vain MCP-työkaluja** — ÄLÄ lue .brain/-tiedostoja suoraan.

## Istunnon alussa

1. `brain_get_overview` → projektin tila + terveysvaroitukset
2. `brain_get_backlog` → keskeneräiset suunnitelmat ja lykätyt tehtävät
3. Arvioi onko lykätty tehtävä nyt ajankohtainen

## Ennen muutoksia

1. `brain_check_conflicts` → tarkista ristiriidat olemassa olevien päätösten kanssa
2. `brain_get_context_for_files` → hae tiedostoihin liittyvä konteksti

**Jos brain_check_conflicts palauttaa CONFLICT:**
- PYSÄHDY ja ilmoita käyttäjälle
- Kerro mikä päätös on ristiriidassa
- Kysy haluaako käyttäjä ohittaa, päivittää vai perua

## Muutosten jälkeen — tallenna AINA

| Muutostyyppi | Työkalu |
|---|---|
| Arkkitehtuuripäätös | `brain_record_decision` (MIKSI näin tehtiin) |
| Bugikorjaus | `brain_record_bug` (oireet, juurisyy, korjaus) |
| Merkittävä toteutus | `brain_record_implementation` |
| Uudelleenkäytettävä malli | `brain_record_pattern` |
| Suunnitelma | `brain_record_plan` (toteutettu, lykätty, seuraavat) |

Linkitä merkinnät: `brain_link_entries` (implements, fixes, supersedes, jne.)

## Yhteydet

- `supersedes` / `superseded_by` — uusi korvaa vanhan
- `implements` — toteutus toteuttaa päätöksen
- `fixes` — korjaus korjaa bugin
- `caused_by` / `used_in` / `relates_to`

## Session lopussa

Jos työ jäi kesken: `brain_record_plan` tallentaa mitä tehtiin, lykättiin ja seuraavat askeleet.

## Haku & tiedon käyttö

- `brain_search` — hakusanoilla
- `brain_list` — tyypeittäin/statuksittain
- `brain_get_entry` — yksittäinen merkintä
- `brain_health` — terveysraportti

## Agentit

Käytä brain-agentteja **automaattisesti** tilanteen edellyttäessä:
- `brain-curator` — terveysongelmissa
- `brain-documenter` — dokumentoimattomat muutokset
- `brain-reviewer` — konsistenssin tarkistus
- `brain-backlog` — backlogin hallinta
