# Code Graph - Automaattinen koodigraafi Brainiin

**Päivämäärä:** 2026-05-27
**Status:** Draft
**Inspiraatio:** [Graphify](https://github.com/safishamsi/graphify)

## Yhteenveto

Lisätään Brain-järjestelmään automaattinen koodigraafi, joka parsii projektin koodin tree-sitterillä, rakentaa rakenteellisen graafin (funktiot, luokat, kutsut, importit, periytyminen), ja tarjoaa edistyneitä graafi-ominaisuuksia: community detection, surprise analysis, god nodes, blast radius, confidence tiers, ja token-budjetoidut kyselyt.

Koodigraafi elää omassa tietorakenteessa (`.brain/code-graph/`) rinnalla nykyisen Brain-järjestelmän, joka pysyy muuttumattomana. Siltalinkit yhdistävät brain-entryt (päätökset, bugit) koodinoodeihin.

## Arkkitehtuuri

### Tietorakenne

```
.brain/
├── index.json              (nykyinen - EI MUUTOKSIA)
├── code-graph/
│   ├── graph.json          (graphology-serialisoitu koodigraafi)
│   ├── cache/
│   │   └── ast/            (per-tiedosto AST-cache, SHA256-avaimilla)
│   ├── communities.json    (Louvain-klusterit + metadata)
│   ├── analysis.json       (god nodes, surprise edges, tilastot)
│   └── bridges.json        (brain-entry ↔ koodinoodi -linkit)
├── decisions/              (nykyinen)
├── implementations/        (nykyinen)
├── ...
```

### Pipeline (Graphifyn inspiroima)

```
scan() → extract() → build() → deduplicate() → cluster() → analyze()
```

| Vaihe | Moduuli | Tehtävä |
|-------|---------|---------|
| `scan` | `lib/code-graph/scan.js` | Skannaa projektihakemisto, luokittelee tiedostot, suodattaa (node_modules, .git jne.) |
| `extract` | `lib/code-graph/extract.js` | Tree-sitter AST-parsinta per tiedosto → noodit + kaaret |
| `build` | `lib/code-graph/build.js` | Yhdistää extraktiot yhdeksi graphology-graafiksi, deduplikaatio |
| `cluster` | `lib/code-graph/cluster.js` | Louvain community detection + laadunoptimointii |
| `analyze` | `lib/code-graph/analyze.js` | God nodes, surprise edges, tilastot |
| `query` | `lib/code-graph/query.js` | BFS/DFS, shortest path, naapurit, token-budjetointi |

### Moduulit

```
lib/code-graph/
├── index.js              (CodeGraph-pääluokka, orchestrator)
├── scan.js               (tiedostojen skannaus + luokittelu)
├── extract.js            (tree-sitter AST → noodit/kaaret)
├── languages/            (kielikohtaiset konfiguraatiot)
│   ├── javascript.js
│   ├── typescript.js
│   ├── python.js
│   ├── go.js
│   ├── rust.js
│   ├── java.js
│   ├── c.js
│   ├── cpp.js
│   ├── ruby.js
│   ├── csharp.js
│   ├── kotlin.js
│   └── php.js
├── build.js              (graafin rakentaminen + deduplikaatio)
├── cluster.js            (Louvain community detection)
├── analyze.js            (god nodes, surprise, tilastot)
├── query.js              (traversal, haku, token-budjetointi)
├── cache.js              (SHA256-pohjainen AST-cache)
├── bridge.js             (brain-entry ↔ koodinoodi -linkit)
└── confidence.js         (3-portainen luottamustaso)
```

## Tietomallit

### Koodinoodi (Node)

```json
{
  "id": "src/lib/search.js::TextIndex",
  "label": "TextIndex",
  "type": "class|function|method|module|variable|interface|enum|type",
  "file": "src/lib/search.js",
  "line": 42,
  "end_line": 128,
  "language": "javascript",
  "community": 3,
  "degree": 12,
  "metadata": {
    "exported": true,
    "async": false,
    "parameters": ["options"],
    "return_type": "TextIndex"
  }
}
```

### Kaari (Edge)

```json
{
  "source": "src/lib/search.js::search",
  "target": "src/lib/text-index.js::TextIndex",
  "relation": "calls|imports|inherits|implements|contains|references",
  "confidence": "EXTRACTED|INFERRED|AMBIGUOUS",
  "file": "src/lib/search.js",
  "line": 55,
  "weight": 1.0,
  "context": "parameter_type|return_type|field|import|call"
}
```

### Luottamustasot (Confidence Tiers)

| Taso | Kuvaus | Esimerkki |
|------|--------|-----------|
| `EXTRACTED` | Suoraan AST:stä → varma | `import { foo } from './bar'` |
| `INFERRED` | Pääteltävissä kontekstista | Funktion nimi vastaa exporttia toisessa tiedostossa |
| `AMBIGUOUS` | Epävarma, tarvitsee tarkistuksen | Samanniminen funktio useassa tiedostossa |

### Siltalinkki (Bridge)

```json
{
  "brain_entry": "DEC-003",
  "code_nodes": ["src/lib/graph.js::BrainGraph", "src/lib/graph.js::traverseBFS"],
  "relation": "documents|implements|affects",
  "auto_detected": true
}
```

Sillat luodaan automaattisesti matchaamalla brain-entryjen `files`-kenttä koodinoodien `file`-kenttään, ja manuaalisesti `brain_bridge`-työkalulla.

## Kielituki (tree-sitter)

Jokainen kieli määritellään LanguageConfig-objektina:

```javascript
{
  name: "javascript",
  extensions: [".js", ".mjs", ".cjs"],
  treeSitterModule: "tree-sitter-javascript",
  nodeTypes: {
    class: ["class_declaration"],
    function: ["function_declaration", "arrow_function", "function"],
    method: ["method_definition"],
    import: ["import_statement"],
    call: ["call_expression"],
    variable: ["variable_declarator"],
    export: ["export_statement"]
  },
  nameExtraction: {
    class: "name",
    function: "name",
    method: "name",
    import: "source",
    call: "function"
  }
}
```

### Tuettavat kielet (12)

| Kieli | NPM-paketti | Prioriteetti |
|-------|-------------|-------------|
| JavaScript | tree-sitter-javascript | P0 |
| TypeScript | tree-sitter-typescript | P0 |
| Python | tree-sitter-python | P0 |
| Go | tree-sitter-go | P1 |
| Rust | tree-sitter-rust | P1 |
| Java | tree-sitter-java | P1 |
| C | tree-sitter-c | P2 |
| C++ | tree-sitter-cpp | P2 |
| Ruby | tree-sitter-ruby | P2 |
| C# | tree-sitter-c-sharp | P2 |
| Kotlin | tree-sitter-kotlin | P2 |
| PHP | tree-sitter-php | P2 |

## Graafi-ominaisuudet

### 1. Community Detection (Louvain)

Käytetään `graphology-communities-louvain` -pakettia:

```javascript
import louvain from 'graphology-communities-louvain';

const communities = louvain(graph, { resolution: 1.0 });
// Tallentaa community-attribuutin jokaiselle noodille
louvain.assign(graph, { resolution: 1.0 });
```

**Laadunoptimointi:**
- Jos yhteisö > 50 noodia → rekursiivinen uudelleenjako
- Modulaarisuuspisteen laskenta
- Koheesio-metriikat per yhteisö

### 2. God Nodes (liian yhdistetyt)

```javascript
function findGodNodes(graph, percentile = 99) {
  const degrees = graph.nodes().map(n => graph.degree(n));
  const threshold = percentile(degrees, percentile);
  return graph.nodes().filter(n => graph.degree(n) >= threshold);
}
```

God node = noodi jonka yhteysmäärä ylittää P99-kynnyksen (min. 50). Nämä ovat potentiaalisia refaktorointikohteita.

### 3. Surprise Analysis (yllättävät yhteydet)

Pisteytetään kaaret yllättävyyskertoimin:

| Tekijä | Kerroin |
|--------|---------|
| AMBIGUOUS-luottamustaso | ×2.0 |
| Eri tiedostotyypit (koodi ↔ doc) | ×1.5 |
| Eri yhteisöt (community bridge) | ×1.8 |
| Periferia → hub | ×1.3 |
| Eri kielet | ×2.0 |

### 4. Blast Radius (muutoksen vaikutusalue)

```javascript
function blastRadius(graph, changedFiles) {
  // 1. Etsi kaikki noodit muutetuissa tiedostoissa
  // 2. BFS taaksepäin (incoming edges) → löydä riippuvat
  // 3. Laske montako yhteisöä vaikutetaan
  // 4. Palauta: { nodes: [...], communities: [...], risk_score: 0-100 }
}
```

### 5. Token-budjetoidut kyselyt

```javascript
function queryGraph(graph, query, { budget = 4000, mode = 'bfs' }) {
  // 1. IDF-painotettu haku → seed-noodit
  // 2. BFS/DFS seed-noodeista, hub-kynnys (P99, min 50)
  // 3. Renderöi subgraafi tekstiksi budjetin sisällä
  // 4. Seed-noodit ensin, sitten naapurit tärkeysjärjestyksessä
}
```

### 6. IDF-painotettu haku

```javascript
function idfSearch(graph, query) {
  const terms = tokenize(query);
  const idf = computeIDF(graph); // cached
  // Scored: exact > prefix > substring
  // Diacritic-insensitive
  return rankedNodes;
}
```

## MCP-työkalut (uudet, lisätään nykyisten 39 rinnalle)

### Koodigraafi-työkalut (8)

| Työkalu | Kuvaus |
|---------|--------|
| `brain_code_build` | Rakenna/päivitä koodigraafi (full tai incremental) |
| `brain_code_query` | Kysy koodista luonnollisella kielellä (BFS/DFS + IDF + token-budjetti) |
| `brain_code_node` | Hae yksittäisen noodin tiedot (metadata, naapurit, yhteisö) |
| `brain_code_neighbors` | Listaa noodin naapurit relaatiotyypeittäin |
| `brain_code_path` | Etsi lyhin polku kahden noodin välillä |
| `brain_code_community` | Listaa yhteisön noodit + metriikat |
| `brain_code_stats` | Koodigraafin tilastot (noodit, kaaret, yhteisöt, god nodes) |
| `brain_code_blast` | Laske muutoksen blast radius (tiedostolista → vaikutusalue) |

### Analyysityökalut (3)

| Työkalu | Kuvaus |
|---------|--------|
| `brain_code_gods` | Listaa god nodes (liian yhdistetyt, refaktorointikandidaatit) |
| `brain_code_surprises` | Listaa yllättävimmät yhteydet |
| `brain_code_health` | Graafin terveystarkistus (orpot noodit, syklit, puuttuvat importit) |

### Silttyökalut (2)

| Työkalu | Kuvaus |
|---------|--------|
| `brain_bridge` | Linkitä brain-entry koodinoodiin manuaalisesti |
| `brain_bridge_auto` | Automaattinen siltaus files-kentän perusteella |

**Yhteensä: 13 uutta työkalua → 52 työkalua kokonaisuudessaan**

## Cache-strategia

### AST-cache (per tiedosto)

```
.brain/code-graph/cache/ast/
├── a1b2c3d4...json    (SHA256 tiedoston sisällöstä)
├── e5f6g7h8...json
└── ...
```

**Fastpath:** Tarkista ensin `stat()` (koko + mtime). Jos muuttunut → laske SHA256. Jos hash löytyy cachesta → käytä cachea.

**Inkrementaalinen päivitys:**
1. `scan()` vertaa tiedostoja edelliseen ajoon
2. Vain muuttuneet/uudet tiedostot parsitaan uudelleen
3. Poistettujen tiedostojen noodit poistetaan graafista
4. Klusterointi ja analyysi ajetaan uudelleen

### Graafi-cache

`graph.json` sisältää koko graafin serialisoituna. MCP-serveri lataa sen muistiin ja tarkkailee mtime-muutoksia → hot reload.

## Riippuvuudet (uudet NPM-paketit)

| Paketti | Versio | Käyttö |
|---------|--------|--------|
| `tree-sitter` | ^0.22 | AST-parsinta (natiivi) |
| `tree-sitter-javascript` | ^0.23 | JS-kielioppi |
| `tree-sitter-typescript` | ^0.23 | TS-kielioppi |
| `tree-sitter-python` | ^0.23 | Python-kielioppi |
| `tree-sitter-go` | ^0.23 | Go-kielioppi |
| `tree-sitter-rust` | ^0.23 | Rust-kielioppi |
| `tree-sitter-java` | ^0.23 | Java-kielioppi |
| `tree-sitter-c` | ^0.23 | C-kielioppi |
| `tree-sitter-cpp` | ^0.23 | C++-kielioppi |
| `tree-sitter-ruby` | ^0.23 | Ruby-kielioppi |
| `tree-sitter-c-sharp` | ^0.23 | C#-kielioppi |
| `tree-sitter-kotlin` | ^0.23 | Kotlin-kielioppi |
| `tree-sitter-php` | ^0.23 | PHP-kielioppi |
| `graphology` | ^0.25 | Graafitietorakenne |
| `graphology-communities-louvain` | ^2.0 | Community detection |
| `graphology-shortest-path` | ^2.0 | Lyhin polku |
| `graphology-metrics` | ^2.0 | Graafimetriikat |
| `graphology-traversal` | ^0.3 | BFS/DFS |

**Huom:** tree-sitter on natiiviriippuvuus (C/C++ binding). Tarvitsee `node-gyp` ja C-kääntäjän. Vaihtoehtoisesti voidaan käyttää `web-tree-sitter` (WASM) joka ei tarvitse natiivikääntöä.

## Suorituskyky

### Tavoitteet

| Mittari | Tavoite |
|---------|---------|
| Täysi build (1000 tiedostoa) | < 30 sekuntia |
| Inkrementaalinen päivitys (10 tiedostoa) | < 2 sekuntia |
| Kysely (BFS, 4000 tokenia) | < 200 ms |
| Muistinkäyttö (5000 noodia) | < 100 MB |

### Optimoinnit

- **Rinnakkainen parsinta:** `Promise.all()` tiedostojen ekstraktiolle
- **Lazy-loading:** Kielioppimoduulit ladataan vain tarvittaessa
- **Streaming cache:** Cache kirjoitetaan tiedosto kerrallaan
- **Hot reload:** Graafi ladataan muistiin, uudelleenlataus vain mtime-muutoksessa

## Integraatio nykyiseen Brain-järjestelmään

### Ei muutoksia olemassa oleviin

- `index.json` — pysyy täysin ennallaan
- `brain-manager.js` — ei muutoksia
- Kaikki nykyiset 39 työkalua — pysyvät muuttumattomina
- Nykyiset handlerit — ei muutoksia

### Uudet tiedostot

```
lib/code-graph/          (kaikki uusi koodi tänne)
handlers/code-graph.js   (uusi handler MCP-serveriä varten)
```

### MCP-serverin muutokset

`mcp-server.js` saa uuden handlerin registröinnin:

```javascript
// Lisätään olemassa olevien rinnalle
import { codeGraphHandlers } from './handlers/code-graph.js';
// ... registeröinti tool-listaan
```

### Silta-integraatio

`bridges.json` linkittää brain-entryt koodinoodeihin:

```json
{
  "bridges": [
    {
      "brain_id": "DEC-003",
      "code_nodes": ["src/lib/graph.js::BrainGraph"],
      "relation": "documents",
      "auto": true,
      "created": "2026-05-27"
    }
  ]
}
```

**Automaattinen siltaus:** Kun `brain_code_build` ajetaan, se vertaa brain-entryjen `files`-kenttää koodinoodien `file`-kenttään ja luo automaattisesti sillat.

**Manuaalinen siltaus:** `brain_bridge`-työkalu antaa käyttäjän linkittää tietyn brain-entryn tiettyyn koodinoodiin.

### brain_preflight -integraatio

Nykyinen `brain_preflight` laajennetaan tarkistamaan myös koodigraafista:
- Onko tiedostossa god node → korkeampi riskipistemäärä
- Onko tiedosto community-raja → korkeampi riskipistemäärä
- Blast radius mukaan riskiarvioon

## Esimerkkejä käytöstä

### 1. Graafin rakentaminen
```
brain_code_build({ mode: "full" })
→ "Rakennettu koodigraafi: 847 noodia, 2134 kaarta, 12 yhteisöä. 3 god nodea löytyi."
```

### 2. Koodin kyseleminen
```
brain_code_query({ query: "miten haku toimii", budget: 4000 })
→ Palauttaa relevantin subgraafin: TextIndex, search(), buildIndex() + niiden suhteet
```

### 3. Blast radius
```
brain_code_blast({ files: ["src/lib/search.js"] })
→ "Vaikutusalue: 23 noodia, 4 yhteisöä, risk_score: 67/100"
```

### 4. Päätöksen linkitys koodiin
```
brain_bridge({ brain_id: "DEC-005", code_nodes: ["src/lib/search.js::TextIndex"], relation: "implements" })
→ "Linkitetty DEC-005 → TextIndex"
```

## Vaiheistus

### Vaihe 1: Perusta (P0)
- [ ] Scan + extract (JS/TS/Python tree-sitter)
- [ ] Build (graphology-graafi)
- [ ] Cache (SHA256 + stat fastpath)
- [ ] Perus MCP-työkalut: build, query, node, neighbors, stats

### Vaihe 2: Edistyneet ominaisuudet (P0)
- [ ] Community detection (Louvain)
- [ ] God nodes + surprise analysis
- [ ] Blast radius
- [ ] Shortest path
- [ ] Token-budjetoidut kyselyt
- [ ] IDF-painotettu haku
- [ ] Confidence tiers

### Vaihe 3: Integraatio (P1)
- [ ] Silta-järjestelmä (auto + manuaalinen)
- [ ] brain_preflight -laajennus
- [ ] Inkrementaalinen päivitys
- [ ] Hot reload

### Vaihe 4: Laaja kielituki (P1)
- [ ] Go, Rust, Java
- [ ] C, C++, Ruby
- [ ] C#, Kotlin, PHP

### Vaihe 5: Lisäominaisuudet (P2)
- [ ] Git-hookit (auto-rebuild post-commit)
- [ ] Visualisointi (D3.js / vis.js)
- [ ] Cross-file call resolution (import-guided)
- [ ] GRAPH_REPORT.md -generointi
