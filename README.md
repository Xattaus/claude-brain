# Claude Brain 🧠 (Autonominen Kontekstinhallinta)

**Claude Brain** on edistynyt kontekstinhallintajärjestelmä (MCP-palvelin), joka antaa tekoälyagenteille (kuten Claude Code ja Gemini) pitkäkestoisen, semanttisen muistin. Se ei ole vain passiivinen dokumenttivarasto, vaan aktiivinen työkalu, joka ymmärtää koodauksen käsitteitä kuten *arkkitehtuuripäätökset*, *bugikorjaukset* ja *toteutussuunnitelmat*.

## ✨ Ominaisuudet

*   **Aktiivinen muisti**: Tekoäly voi hakea itsenäisesti tietoa projektin historiasta ja päätöksistä.
*   **Strukturoitu tieto**: Tallentaa päätökset (ADR), bugit, toteutukset ja suunnitelmat linkitettynä toisiinsa.
*   **Konfliktintarkistus**: Varoittaa automaattisesti, jos uusi muutos on ristiriidassa aiemman päätöksen kanssa.
*   **Automaattiset Hookit**:
    *   **Session Start**: Muistuttaa tekoälyä lukemaan kontekstin istunnon alussa.
    *   **Stop**: Muistuttaa tallentamaan työnistunnon lopussa.
*   **CLI & MCP**: Toimii sekä komentoriviltä (`node cli.js`) että suoraan MCP-protokollan kautta.

## 🚀 Asennus

Voit asentaa "aivot" mihin tahansa olemassa olevaan projektiin:

```bash
# Asenna nykyiseen kansioon
node install.js .

# Asenna tiettyyn polkuun
node install.js C:/OmaProjekti
```

Asennus:
1.  Luo `.brain/` -kansion projektin juureen.
2.  Konfiguroi MCP-palvelimen (`.mcp.json`).
3.  Päivittää `CLAUDE.md`:n ohjeistuksilla.
4.  Asentaa tarvittavat tekoäly-agentit ja hookit.

## 📖 Käyttö

Tekoäly käyttää työkalua pääasiassa itsenäisesti MCP:n kautta, mutta voit käyttää sitä myös komentoriviltä CLI-työkalulla:

```bash
# Hae projektin yleiskuvaus
node gemini-brain.js overview

# Hae tietoa (esim. autentikaatioon liittyen)
node gemini-brain.js search "auth"

# Kirjaa uusi arkkitehtuuripäätös
node gemini-brain.js decide "Käytetään Zod-validointia" "Tarvitsemme tyyppiturvallisuutta runtime-tasolla" "Otetaan Zod käyttöön kaikissa API-rajapinnoissa"
```

## 🛠️ Rakenne

*   `.brain/overview.md`: Projektin korkean tason kuvaus.
*   `.brain/decisions/`: Arkkitehtuuripäätökset (ADR).
*   `.brain/bugs/`: Ratkaistut ja avoimet bugit.
*   `.brain/implementations/`: Toteutusten tekniset yksityiskohdat.
*   `.brain/plans/`: Tulevat ja keskeneräiset suunnitelmat.

## Lisenssi

MIT
