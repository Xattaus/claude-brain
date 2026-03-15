# Projektin Aivot (Autonominen Kontekstinhallinta)

Tässä projektissa on käytössä autonominen kontekstinhallintajärjestelmä.
Aivot sijaitsevat `.brain/`-kansiossa ja niitä käytetään MCP-työkaluilla.

## COGNITIVE FIREWALL — Automaattinen suojaus

### ENNEN tiedostomuokkausta (PAKOLLINEN)
Kutsu `brain_preflight` ENNEN kuin muokkaat mitään tiedostoa:
```
brain_preflight({ files: ["polku/tiedosto.js"], intent: "mitä aiot tehdä" })
```

- RISK >= 70 (HIGH): **PYSÄHDY**, kerro käyttäjälle, pyydä lupa
- RISK >= 40 (MEDIUM): Lue kaikki säännöt huolellisesti
- RISK < 40 (LOW/SAFE): Jatka, mutta noudata sääntöjä

**ÄLÄ KOSKAAN** ohita DONT- tai GUARD-sääntöjä.

### MUOKKAUKSEN jälkeen (merkittävät muutokset)
```
brain_validate_change({ files: [...], change_description: "...", changes_summary: "..." })
```
Jos FAIL: **PERU** tai kysy käyttäjältä.

## Pakolliset toimintaohjeet

### Istunnon alussa
1. Kutsu `brain_get_overview` saadaksesi projektin yleiskuvan
2. Kutsu `brain_get_lessons` tarkistaaksesi opitut asiat — ÄLÄ toista samoja virheitä
3. ÄLÄ lue .brain/-tiedostoja suoraan — käytä MCP-työkaluja

### Kun työskentelet
1. **Ennen muutoksia**: Kutsu `brain_check_conflicts` tarkistaaksesi ristiriidat
2. **Tiedostokonteksti**: Kutsu `brain_get_context_for_files` saadaksesi kaikki tiedostoihin liittyvät päätökset, bugit, toteutukset ja mallit
3. **Tiedon hakuun**: Käytä `brain_search` tai `brain_list` — EI grep .brain/
4. **Kun tarvitset yksityiskohtia**: `brain_get_entry` yksittäiselle tietoyksikölle

### Muutosten jälkeen — tallenna AINA aivoihin
1. **Arkkitehtuuripäätös** → `brain_record_decision` (MIKSI näin tehtiin)
2. **Bugikorjaus** → `brain_record_bug` (oireet, juurisyy, korjaus)
3. **Uusi toteutus/merkittävä muutos** → `brain_record_implementation`
4. **Uudelleenkäytettävä malli** → `brain_record_pattern`
5. **Oppi virheestä/korjauksesta** → `brain_record_lesson` (mitä tapahtui, oppi, sääntö)
6. **Yhteyksien luominen** → `brain_link_entries` merkintöjen välille (implements, fixes, supersedes, jne.)

### Oppien tallentaminen (Self-Improvement Loop)
Kun käyttäjä korjaa sinua tai huomaat virheen:
1. **AINA** tallenna oppi `brain_record_lesson` -työkalulla
2. Kirjaa konkreettinen **sääntö** joka estää saman virheen toistumisen
3. Aseta severity: `high` = kriittinen virhe, `medium` = normaali, `low` = hyvä käytäntö
4. Aseta trigger: `correction` = käyttäjä korjasi, `discovery` = itse huomattiin, `bug` = bugin kautta, `review` = katselmuksessa

### Yhteydet (Relationships)

Merkintöjä voi linkittää toisiinsa tyypitetyin suhtein:
- `supersedes` / `superseded_by` — uusi päätös korvaa vanhan
- `implements` — toteutus toteuttaa päätöksen
- `fixes` — bugikorjaus korjaa bugin
- `caused_by` — aiheutui toisesta merkinnästä
- `used_in` — käytetään toisessa
- `relates_to` — yleinen yhteys

Käytä `brain_link_entries` suhteen luomiseen — se luo automaattisesti kaksisuuntaisen linkin.
Uutta päätöstä tallennettaessa voit käyttää `supersedes`-parametria vanhan päätöksen korvaamiseen.

### Ristiriitavaroitukset
Jos `brain_check_conflicts` palauttaa osumia:
- **PYSÄHDY** ja ilmoita käyttäjälle ennen jatkamista
- Kerro mikä aiempi päätös on ristiriidassa ja miksi
- Kysy haluaako käyttäjä ohittaa, päivittää vai perua muutoksen
- Kriittiset/korkean prioriteetin bugit nostetaan CONFLICT-tasolle (ei vain WARNING)

## .brain/-kansion rakenne
- `overview.md` — Projektin yleiskuvaus (kompakti)
- `decisions/` — Arkkitehtuuripäätökset (ADR-formaatti)
- `implementations/` — Toteutuskuvaukset
- `bugs/` — Bugikorjaukset ja workaroundit
- `patterns/` — Uudelleenkäytettävät mallit
- `lessons/` — Opitut asiat virheistä ja korjauksista
- `history/changelog.md` — Muutoshistoria
