# Claude Brain CLI -käyttöohje

Tämä dokumentti neuvoo, kuinka käytät projektin "Brain"-kontekstijärjestelmää komentoriviltä. Järjestelmä on alun perin rakennettu Claudelle (MCP:n kautta), mutta tämä CLI-työkalu mahdollistaa sen käytön myös ilman Claudea.

## Perusperiaatteet

1.  **Lue ensin**: Tarkista aina `overview` ja tee `search` ennen töiden aloittamista, jotta ymmärrät olemassa olevan kontekstin.
2.  **Kirjaa tehdessäsi**: Älä vain muuta koodia; kirjaa ylös *miksi* teit sen (Päätökset/Decisions, Toteutukset/Implementations).
3.  **Kunnioita ristiriitoja**: Aja `check` ennen isompia muutoksia nähdäksesi, oletko ristiriidassa aiempien päätösten kanssa.

## Komentorivityökalut (`cli.js`)

Voit ajaa nämä komennot käyttämällä `node cli.js <komento> ...` tai `npm run brain -- <komento>`.

### 1. Kontekstin haku

**Istunnon alussa:**
```bash
node cli.js overview
```

**Tiedon haku:**
```bash
node cli.js search "tietokantakaavio"
node cli.js search --type=decision "autentikaatio"
```

**Yksittäisen merkinnän lukeminen:**
```bash
node cli.js read DEC-001
```

### 2. Muutosten validointi

**Ennen muutosten tekemistä**, tarkista ristiriidat:
```bash
node cli.js check "Aion vaihtaa JWT:n sessioevästeisiin"
```
_Jos tämä palauttaa konflikteja, PYSÄHDY ja mieti uudelleen._

### 3. Työn kirjaaminen

**Arkkitehtuuripäätös (Decision):**
```bash
node cli.js decide "Käytetään PostgreSQL:ää" "Tarvitsemme relaatiotietokantaa" "Otetaan käyttöön Postgres 14"
```

**Bugikorjaus:**
```bash
node cli.js log-bug "Kirjautumiskaatuminen tyhjällä salasanalla" "Palvelin antaa 500-virheen" "Lisätty validointitarkistus"
```

**Toteutuksen yksityiskohta (Implementation):**
```bash
node cli.js implement "Käyttäjäprofiili API" "Lisätty GET /api/me ja PUT /api/me rajapinnat"
```

**Merkintöjen linkitys:**
```bash
node cli.js link IMPL-005 DEC-002 implements
```

## Hakemistorakenne
- `.brain/overview.md`: Projektin yleiskuvaus.
- `.brain/decisions/`: ADR:t (Arkkitehtuuripäätökset).
- `.brain/bugs/`: Korjattujen bugien loki.
- `.brain/implementations/`: Toteutettujen ominaisuuksien yksityiskohdat.

## Vinkkejä
- Jos CLI-tuloste on liian pitkä, voit käyttää normaaleja shellin putkitus/uudelleenohjauskomentoja.
- Käytä selkeitä lainausmerkkejä monisanaisissa argumenteissa (esim. "Oma otsikko").
