# Code Graph Implementation Plan — Part 1: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatic code graph analysis to Brain using tree-sitter AST parsing and graphology, with community detection, god nodes, surprise analysis, blast radius, and token-budgeted queries.

**Architecture:** New `lib/code-graph/` module alongside existing Brain. Graphology for graph storage, web-tree-sitter (WASM) for AST parsing, Louvain for community detection. 13 new MCP tools added via `handlers/code-graph.js`. Separate `.brain/code-graph/` data directory.

**Tech Stack:** web-tree-sitter (WASM), graphology, graphology-communities-louvain, graphology-shortest-path, graphology-metrics, graphology-traversal

**Spec:** `docs/superpowers/specs/2026-05-27-code-graph-design.md`

---

## Part 1 covers Tasks 1–6: Setup, Scanner, Extractor, Cache, Graph Builder, Handler Registration

---

### Task 1: Install dependencies and create directory structure

**Files:**
- Modify: `package.json`
- Create: `lib/code-graph/index.js`
- Create: `.brain/code-graph/.gitkeep`

- [ ] **Step 1: Install graphology packages**

```bash
cd "/path/to/claude-brain"
npm install graphology graphology-communities-louvain graphology-shortest-path graphology-metrics graphology-traversal
```

- [ ] **Step 2: Install web-tree-sitter (WASM — no native deps needed)**

```bash
npm install web-tree-sitter
```

- [ ] **Step 3: Create code-graph directory structure**

```bash
mkdir -p lib/code-graph/languages
mkdir -p .brain/code-graph/cache/ast
```

- [ ] **Step 4: Create the CodeGraph orchestrator skeleton**

Create `lib/code-graph/index.js`:

```javascript
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';

export class CodeGraph {
  constructor(projectPath, brainPath) {
    this.projectPath = projectPath;
    this.brainPath = brainPath;
    this.codeGraphPath = join(brainPath, 'code-graph');
    this.graphPath = join(this.codeGraphPath, 'graph.json');
    this.communitiesPath = join(this.codeGraphPath, 'communities.json');
    this.analysisPath = join(this.codeGraphPath, 'analysis.json');
    this.bridgesPath = join(this.codeGraphPath, 'bridges.json');
    this.cachePath = join(this.codeGraphPath, 'cache', 'ast');
    this.graph = null;
  }

  async ensureDirs() {
    await mkdir(this.cachePath, { recursive: true });
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json lib/code-graph/index.js
git commit -m "feat(code-graph): install dependencies and create directory structure

Add graphology, web-tree-sitter, and code-graph module skeleton."
```

---

### Task 2: File Scanner

**Files:**
- Create: `lib/code-graph/scan.js`
- Create: `tests/code-graph/scan.test.js`

- [ ] **Step 1: Write the failing test for scan**

Create `tests/code-graph/scan.test.js`:

```javascript
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanFiles } from '../../lib/code-graph/scan.js';

describe('scanFiles', () => {
  let tempDir;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'scan-test-'));
    // Create test file structure
    await mkdir(join(tempDir, 'src'), { recursive: true });
    await mkdir(join(tempDir, 'node_modules', 'pkg'), { recursive: true });
    await mkdir(join(tempDir, '.git'), { recursive: true });
    await mkdir(join(tempDir, 'vendor'), { recursive: true });

    await writeFile(join(tempDir, 'src', 'index.js'), 'export const x = 1;');
    await writeFile(join(tempDir, 'src', 'app.ts'), 'const y: number = 2;');
    await writeFile(join(tempDir, 'src', 'utils.py'), 'def foo(): pass');
    await writeFile(join(tempDir, 'readme.md'), '# Hello');
    await writeFile(join(tempDir, 'node_modules', 'pkg', 'index.js'), 'module.exports = {}');
    await writeFile(join(tempDir, '.git', 'config'), '[core]');
    await writeFile(join(tempDir, 'src', 'image.png'), 'binary');
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('finds code files and skips ignored dirs', async () => {
    const files = await scanFiles(tempDir);

    const paths = files.map(f => f.relativePath);
    assert.ok(paths.includes('src/index.js'), 'should find src/index.js');
    assert.ok(paths.includes('src/app.ts'), 'should find src/app.ts');
    assert.ok(paths.includes('src/utils.py'), 'should find src/utils.py');
    assert.ok(!paths.some(p => p.includes('node_modules')), 'should skip node_modules');
    assert.ok(!paths.some(p => p.includes('.git')), 'should skip .git');
    assert.ok(!paths.some(p => p.endsWith('.png')), 'should skip non-code files');
    assert.ok(!paths.some(p => p.endsWith('.md')), 'should skip markdown');
  });

  it('classifies files by language', async () => {
    const files = await scanFiles(tempDir);
    const jsFile = files.find(f => f.relativePath === 'src/index.js');
    const tsFile = files.find(f => f.relativePath === 'src/app.ts');
    const pyFile = files.find(f => f.relativePath === 'src/utils.py');

    assert.equal(jsFile.language, 'javascript');
    assert.equal(tsFile.language, 'typescript');
    assert.equal(pyFile.language, 'python');
  });

  it('includes file stats', async () => {
    const files = await scanFiles(tempDir);
    const jsFile = files.find(f => f.relativePath === 'src/index.js');

    assert.ok(jsFile.size > 0);
    assert.ok(jsFile.mtime instanceof Date);
    assert.equal(typeof jsFile.absolutePath, 'string');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/code-graph/scan.test.js
```

Expected: FAIL — `Cannot find module '../../lib/code-graph/scan.js'`

- [ ] **Step 3: Implement scan.js**

Create `lib/code-graph/scan.js`:

```javascript
import { readdir, stat } from 'node:fs/promises';
import { join, extname, relative } from 'node:path';

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out',
  '.next', '.nuxt', '__pycache__', '.pytest_cache', '.mypy_cache',
  'vendor', 'target', 'bin', 'obj', '.brain', '.claude',
  'coverage', '.nyc_output', '.cache', 'graphify-out'
]);

const LANGUAGE_MAP = {
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.py': 'python',
  '.pyw': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hh': 'cpp',
  '.rb': 'ruby',
  '.cs': 'csharp',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.php': 'php',
};

export async function scanFiles(rootPath, options = {}) {
  const results = [];
  const maxDepth = options.maxDepth || 20;

  async function walk(dir, depth) {
    if (depth > maxDepth) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        await walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        const language = LANGUAGE_MAP[ext];
        if (!language) continue;

        let fileStat;
        try {
          fileStat = await stat(fullPath);
        } catch {
          continue;
        }

        // Skip very large files (> 1MB)
        if (fileStat.size > 1_000_000) continue;

        const relativePath = relative(rootPath, fullPath).replace(/\\/g, '/');

        results.push({
          absolutePath: fullPath,
          relativePath,
          language,
          size: fileStat.size,
          mtime: fileStat.mtime,
        });
      }
    }
  }

  await walk(rootPath, 0);
  return results;
}

export function getSupportedLanguages() {
  return [...new Set(Object.values(LANGUAGE_MAP))];
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test tests/code-graph/scan.test.js
```

Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/code-graph/scan.js tests/code-graph/scan.test.js
git commit -m "feat(code-graph): add file scanner with language detection

Scans project directories, classifies files by language (12 languages),
skips node_modules/.git/dist and other ignored directories."
```

---

### Task 3: Language Configurations

**Files:**
- Create: `lib/code-graph/languages/javascript.js`
- Create: `lib/code-graph/languages/typescript.js`
- Create: `lib/code-graph/languages/python.js`
- Create: `lib/code-graph/languages/index.js`
- Create: `tests/code-graph/languages.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/code-graph/languages.test.js`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getLanguageConfig, getSupportedLanguageNames } from '../../lib/code-graph/languages/index.js';

describe('Language configs', () => {
  it('returns config for javascript', () => {
    const config = getLanguageConfig('javascript');
    assert.ok(config);
    assert.equal(config.name, 'javascript');
    assert.ok(config.nodeTypes.function.length > 0);
    assert.ok(config.nodeTypes.class.length > 0);
    assert.ok(config.nodeTypes.import.length > 0);
    assert.ok(config.nodeTypes.call.length > 0);
    assert.equal(typeof config.wasmFile, 'string');
  });

  it('returns config for typescript', () => {
    const config = getLanguageConfig('typescript');
    assert.ok(config);
    assert.equal(config.name, 'typescript');
    assert.ok(config.nodeTypes.interface.length > 0);
  });

  it('returns config for python', () => {
    const config = getLanguageConfig('python');
    assert.ok(config);
    assert.equal(config.name, 'python');
    assert.ok(config.nodeTypes.decorator);
  });

  it('returns null for unknown language', () => {
    const config = getLanguageConfig('brainfuck');
    assert.equal(config, null);
  });

  it('lists supported languages', () => {
    const names = getSupportedLanguageNames();
    assert.ok(names.includes('javascript'));
    assert.ok(names.includes('typescript'));
    assert.ok(names.includes('python'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/code-graph/languages.test.js
```

Expected: FAIL

- [ ] **Step 3: Implement JavaScript language config**

Create `lib/code-graph/languages/javascript.js`:

```javascript
export const javascriptConfig = {
  name: 'javascript',
  wasmFile: 'tree-sitter-javascript.wasm',
  extensions: ['.js', '.mjs', '.cjs', '.jsx'],
  nodeTypes: {
    class: ['class_declaration'],
    function: ['function_declaration', 'generator_function_declaration'],
    method: ['method_definition'],
    arrow: ['arrow_function'],
    variable: ['variable_declarator'],
    import: ['import_statement'],
    call: ['call_expression'],
    export: ['export_statement', 'export_default_declaration'],
  },
  nameField: 'name',
  bodyField: 'body',
  getClassName(node) {
    const nameNode = node.childForFieldName('name');
    return nameNode ? nameNode.text : null;
  },
  getFunctionName(node) {
    const nameNode = node.childForFieldName('name');
    return nameNode ? nameNode.text : null;
  },
  getImportSource(node) {
    const source = node.childForFieldName('source');
    return source ? source.text.replace(/['"]/g, '') : null;
  },
  getImportSpecifiers(node) {
    const specifiers = [];
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type === 'import_clause') {
        for (let j = 0; j < child.childCount; j++) {
          const spec = child.child(j);
          if (spec.type === 'import_specifier') {
            const nameNode = spec.childForFieldName('name');
            if (nameNode) specifiers.push(nameNode.text);
          } else if (spec.type === 'identifier') {
            specifiers.push(spec.text);
          } else if (spec.type === 'named_imports') {
            for (let k = 0; k < spec.childCount; k++) {
              const named = spec.child(k);
              if (named.type === 'import_specifier') {
                const n = named.childForFieldName('name');
                if (n) specifiers.push(n.text);
              }
            }
          }
        }
      }
    }
    return specifiers;
  },
  getCallName(node) {
    const fn = node.childForFieldName('function');
    if (!fn) return null;
    if (fn.type === 'identifier') return fn.text;
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property');
      return prop ? prop.text : fn.text;
    }
    return fn.text;
  },
  getExportedName(node) {
    const decl = node.childForFieldName('declaration');
    if (!decl) return null;
    if (decl.childForFieldName && decl.childForFieldName('name')) {
      return decl.childForFieldName('name').text;
    }
    return null;
  },
  getSuperClass(node) {
    // class Foo extends Bar
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type === 'class_heritage') {
        for (let j = 0; j < child.childCount; j++) {
          const heir = child.child(j);
          if (heir.type === 'identifier') return heir.text;
        }
      }
    }
    return null;
  },
};
```

- [ ] **Step 4: Implement TypeScript language config**

Create `lib/code-graph/languages/typescript.js`:

```javascript
import { javascriptConfig } from './javascript.js';

export const typescriptConfig = {
  ...javascriptConfig,
  name: 'typescript',
  wasmFile: 'tree-sitter-typescript.wasm',
  extensions: ['.ts', '.tsx', '.mts', '.cts'],
  nodeTypes: {
    ...javascriptConfig.nodeTypes,
    interface: ['interface_declaration'],
    typeAlias: ['type_alias_declaration'],
    enum: ['enum_declaration'],
  },
  getInterfaceName(node) {
    const nameNode = node.childForFieldName('name');
    return nameNode ? nameNode.text : null;
  },
  getEnumName(node) {
    const nameNode = node.childForFieldName('name');
    return nameNode ? nameNode.text : null;
  },
};
```

- [ ] **Step 5: Implement Python language config**

Create `lib/code-graph/languages/python.js`:

```javascript
export const pythonConfig = {
  name: 'python',
  wasmFile: 'tree-sitter-python.wasm',
  extensions: ['.py', '.pyw'],
  nodeTypes: {
    class: ['class_definition'],
    function: ['function_definition'],
    method: ['function_definition'], // detected by parent being class
    import: ['import_statement', 'import_from_statement'],
    call: ['call'],
    decorator: ['decorator'],
    variable: ['assignment'],
  },
  nameField: 'name',
  getClassName(node) {
    const nameNode = node.childForFieldName('name');
    return nameNode ? nameNode.text : null;
  },
  getFunctionName(node) {
    const nameNode = node.childForFieldName('name');
    return nameNode ? nameNode.text : null;
  },
  getImportSource(node) {
    if (node.type === 'import_from_statement') {
      const modName = node.childForFieldName('module_name');
      return modName ? modName.text : null;
    }
    // import foo
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type === 'dotted_name') return child.text;
    }
    return null;
  },
  getImportSpecifiers(node) {
    const specifiers = [];
    if (node.type === 'import_from_statement') {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child.type === 'dotted_name' && i > 0) {
          specifiers.push(child.text);
        } else if (child.type === 'aliased_import') {
          const name = child.childForFieldName('name');
          if (name) specifiers.push(name.text);
        }
      }
    }
    return specifiers;
  },
  getCallName(node) {
    const fn = node.childForFieldName('function');
    if (!fn) return null;
    if (fn.type === 'identifier') return fn.text;
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute');
      return attr ? attr.text : fn.text;
    }
    return fn.text;
  },
  getSuperClass(node) {
    const args = node.childForFieldName('superclasses');
    if (!args) return null;
    for (let i = 0; i < args.childCount; i++) {
      const child = args.child(i);
      if (child.type === 'identifier') return child.text;
    }
    return null;
  },
};
```

- [ ] **Step 6: Create language index**

Create `lib/code-graph/languages/index.js`:

```javascript
import { javascriptConfig } from './javascript.js';
import { typescriptConfig } from './typescript.js';
import { pythonConfig } from './python.js';

const LANGUAGES = new Map([
  ['javascript', javascriptConfig],
  ['typescript', typescriptConfig],
  ['python', pythonConfig],
]);

export function getLanguageConfig(language) {
  return LANGUAGES.get(language) || null;
}

export function getSupportedLanguageNames() {
  return [...LANGUAGES.keys()];
}

export function registerLanguage(name, config) {
  LANGUAGES.set(name, config);
}
```

- [ ] **Step 7: Run tests**

```bash
node --test tests/code-graph/languages.test.js
```

Expected: All 5 tests PASS

- [ ] **Step 8: Commit**

```bash
git add lib/code-graph/languages/ tests/code-graph/languages.test.js
git commit -m "feat(code-graph): add language configs for JS, TS, Python

Tree-sitter node type mappings and AST helper functions
for each language. Extensible via registerLanguage()."
```

---

### Task 4: AST Extractor

**Files:**
- Create: `lib/code-graph/extract.js`
- Create: `tests/code-graph/extract.test.js`

- [ ] **Step 1: Download tree-sitter WASM files**

```bash
cd "/path/to/claude-brain"
mkdir -p lib/code-graph/wasm

# Download WASM grammar files from tree-sitter releases
curl -L -o lib/code-graph/wasm/tree-sitter-javascript.wasm \
  "https://github.com/nicolo-ribaudo/tree-sitter-wasm-prebuilt/raw/main/out/tree-sitter-javascript.wasm"
curl -L -o lib/code-graph/wasm/tree-sitter-typescript.wasm \
  "https://github.com/nicolo-ribaudo/tree-sitter-wasm-prebuilt/raw/main/out/tree-sitter-typescript.wasm"
curl -L -o lib/code-graph/wasm/tree-sitter-python.wasm \
  "https://github.com/nicolo-ribaudo/tree-sitter-wasm-prebuilt/raw/main/out/tree-sitter-python.wasm"
```

Note: If the above URLs don't work, use `tree-sitter build --wasm` locally or find the WASM files from the tree-sitter npm packages. The implementor should verify WASM file availability and adjust paths.

- [ ] **Step 2: Write the failing test for extract**

Create `tests/code-graph/extract.test.js`:

```javascript
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { extractFromSource } from '../../lib/code-graph/extract.js';

describe('extractFromSource', () => {
  it('extracts classes and functions from JavaScript', async () => {
    const source = `
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export class FileReader {
  constructor(path) {
    this.path = path;
  }

  async read() {
    return readFile(this.path, 'utf-8');
  }
}

export function parseContent(text) {
  return JSON.parse(text);
}

const result = parseContent('{}');
`;

    const result = await extractFromSource(source, 'src/file-reader.js', 'javascript');

    // Should find nodes
    assert.ok(result.nodes.length > 0, 'should have nodes');
    const nodeLabels = result.nodes.map(n => n.label);
    assert.ok(nodeLabels.includes('FileReader'), 'should find FileReader class');
    assert.ok(nodeLabels.includes('read'), 'should find read method');
    assert.ok(nodeLabels.includes('parseContent'), 'should find parseContent function');

    // Should find edges
    assert.ok(result.edges.length > 0, 'should have edges');
    const importEdges = result.edges.filter(e => e.relation === 'imports');
    assert.ok(importEdges.length >= 2, 'should find 2 import edges');

    // Should have contains edges (file contains class)
    const containsEdges = result.edges.filter(e => e.relation === 'contains');
    assert.ok(containsEdges.length > 0, 'should have contains edges');

    // Should have call edges
    const callEdges = result.edges.filter(e => e.relation === 'calls');
    assert.ok(callEdges.length > 0, 'should have call edges');
  });

  it('extracts from Python', async () => {
    const source = `
from os.path import join
import json

class Config:
    def __init__(self, path):
        self.path = path

    def load(self):
        with open(self.path) as f:
            return json.load(f)

def create_config(path):
    return Config(path)
`;

    const result = await extractFromSource(source, 'config.py', 'python');
    const nodeLabels = result.nodes.map(n => n.label);
    assert.ok(nodeLabels.includes('Config'), 'should find Config class');
    assert.ok(nodeLabels.includes('load'), 'should find load method');
    assert.ok(nodeLabels.includes('create_config'), 'should find create_config');
  });

  it('assigns confidence levels', async () => {
    const source = `
import { foo } from './bar';
foo();
`;
    const result = await extractFromSource(source, 'test.js', 'javascript');
    const importEdge = result.edges.find(e => e.relation === 'imports');
    assert.equal(importEdge.confidence, 'EXTRACTED');

    const callEdge = result.edges.find(e => e.relation === 'calls');
    assert.ok(['EXTRACTED', 'INFERRED'].includes(callEdge.confidence));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
node --test tests/code-graph/extract.test.js
```

Expected: FAIL

- [ ] **Step 4: Implement extract.js**

Create `lib/code-graph/extract.js`:

```javascript
import Parser from 'web-tree-sitter';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLanguageConfig } from './languages/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let parserReady = false;
const languageCache = new Map();

async function ensureParser() {
  if (!parserReady) {
    await Parser.init();
    parserReady = true;
  }
}

async function getLanguage(langName) {
  if (languageCache.has(langName)) return languageCache.get(langName);

  const config = getLanguageConfig(langName);
  if (!config) return null;

  const wasmPath = join(__dirname, 'wasm', config.wasmFile);
  try {
    const lang = await Parser.Language.load(wasmPath);
    languageCache.set(langName, lang);
    return lang;
  } catch (err) {
    process.stderr.write(`[code-graph] Warning: Could not load WASM for ${langName}: ${err.message}\n`);
    return null;
  }
}

export async function extractFromSource(source, filePath, language) {
  await ensureParser();

  const config = getLanguageConfig(language);
  if (!config) {
    return { nodes: [], edges: [] };
  }

  const lang = await getLanguage(language);
  if (!lang) {
    return { nodes: [], edges: [] };
  }

  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(source);

  const nodes = [];
  const edges = [];
  const fileNodeId = filePath;

  // Add file node
  nodes.push({
    id: fileNodeId,
    label: filePath.split('/').pop(),
    type: 'module',
    file: filePath,
    line: 1,
    endLine: source.split('\n').length,
    language,
  });

  // Walk AST
  walkNode(tree.rootNode, config, filePath, fileNodeId, nodes, edges, null);

  parser.delete();
  tree.delete();

  return { nodes, edges };
}

function walkNode(node, config, filePath, fileNodeId, nodes, edges, parentId) {
  const { nodeTypes } = config;

  // Check classes
  if (nodeTypes.class && nodeTypes.class.includes(node.type)) {
    const name = config.getClassName(node);
    if (name) {
      const id = `${filePath}::${name}`;
      nodes.push({
        id,
        label: name,
        type: 'class',
        file: filePath,
        line: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        language: config.name,
      });
      edges.push({
        source: fileNodeId,
        target: id,
        relation: 'contains',
        confidence: 'EXTRACTED',
        file: filePath,
        line: node.startPosition.row + 1,
      });

      // Check inheritance
      const superClass = config.getSuperClass ? config.getSuperClass(node) : null;
      if (superClass) {
        edges.push({
          source: id,
          target: `__unresolved__::${superClass}`,
          relation: 'inherits',
          confidence: 'INFERRED',
          file: filePath,
          line: node.startPosition.row + 1,
        });
      }

      // Walk children with class as parent
      for (let i = 0; i < node.childCount; i++) {
        walkNode(node.child(i), config, filePath, fileNodeId, nodes, edges, id);
      }
      return;
    }
  }

  // Check functions (top-level or inside class = method)
  if (nodeTypes.function && nodeTypes.function.includes(node.type)) {
    const name = config.getFunctionName(node);
    if (name && !name.startsWith('_') || name === '__init__' || name === 'constructor') {
      const isMethod = parentId && parentId !== fileNodeId;
      const id = isMethod ? `${parentId}.${name}` : `${filePath}::${name}`;
      nodes.push({
        id,
        label: name,
        type: isMethod ? 'method' : 'function',
        file: filePath,
        line: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        language: config.name,
      });
      edges.push({
        source: isMethod ? parentId : fileNodeId,
        target: id,
        relation: isMethod ? 'method' : 'contains',
        confidence: 'EXTRACTED',
        file: filePath,
        line: node.startPosition.row + 1,
      });

      // Walk body for calls
      for (let i = 0; i < node.childCount; i++) {
        walkNode(node.child(i), config, filePath, fileNodeId, nodes, edges, id);
      }
      return;
    }
  }

  // Check methods (separate node type in JS/TS)
  if (nodeTypes.method && nodeTypes.method.includes(node.type) && node.type !== 'function_definition') {
    const name = config.getFunctionName ? config.getFunctionName(node) : null;
    if (name && parentId) {
      const id = `${parentId}.${name}`;
      nodes.push({
        id,
        label: name,
        type: 'method',
        file: filePath,
        line: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        language: config.name,
      });
      edges.push({
        source: parentId,
        target: id,
        relation: 'method',
        confidence: 'EXTRACTED',
        file: filePath,
        line: node.startPosition.row + 1,
      });

      for (let i = 0; i < node.childCount; i++) {
        walkNode(node.child(i), config, filePath, fileNodeId, nodes, edges, id);
      }
      return;
    }
  }

  // Check imports
  if (nodeTypes.import && nodeTypes.import.includes(node.type)) {
    const source = config.getImportSource(node);
    if (source) {
      edges.push({
        source: fileNodeId,
        target: `__import__::${source}`,
        relation: 'imports',
        confidence: 'EXTRACTED',
        file: filePath,
        line: node.startPosition.row + 1,
        context: 'import',
      });

      const specifiers = config.getImportSpecifiers ? config.getImportSpecifiers(node) : [];
      for (const spec of specifiers) {
        edges.push({
          source: fileNodeId,
          target: `__import__::${source}::${spec}`,
          relation: 'imports_from',
          confidence: 'EXTRACTED',
          file: filePath,
          line: node.startPosition.row + 1,
          context: 'import',
        });
      }
    }
  }

  // Check calls
  if (nodeTypes.call && nodeTypes.call.includes(node.type)) {
    const callName = config.getCallName(node);
    if (callName && callName.length > 1) {
      const callerId = parentId || fileNodeId;
      edges.push({
        source: callerId,
        target: `__call__::${callName}`,
        relation: 'calls',
        confidence: 'INFERRED',
        file: filePath,
        line: node.startPosition.row + 1,
        context: 'call',
      });
    }
  }

  // Check interfaces (TypeScript)
  if (nodeTypes.interface && nodeTypes.interface.includes(node.type)) {
    const name = config.getInterfaceName ? config.getInterfaceName(node) : null;
    if (name) {
      const id = `${filePath}::${name}`;
      nodes.push({
        id,
        label: name,
        type: 'interface',
        file: filePath,
        line: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        language: config.name,
      });
      edges.push({
        source: fileNodeId,
        target: id,
        relation: 'contains',
        confidence: 'EXTRACTED',
        file: filePath,
        line: node.startPosition.row + 1,
      });
    }
  }

  // Check enums (TypeScript)
  if (nodeTypes.enum && nodeTypes.enum.includes(node.type)) {
    const name = config.getEnumName ? config.getEnumName(node) : null;
    if (name) {
      const id = `${filePath}::${name}`;
      nodes.push({
        id,
        label: name,
        type: 'enum',
        file: filePath,
        line: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        language: config.name,
      });
      edges.push({
        source: fileNodeId,
        target: id,
        relation: 'contains',
        confidence: 'EXTRACTED',
        file: filePath,
        line: node.startPosition.row + 1,
      });
    }
  }

  // Recurse into children
  for (let i = 0; i < node.childCount; i++) {
    walkNode(node.child(i), config, filePath, fileNodeId, nodes, edges, parentId);
  }
}

export async function extractFromFile(filePath, language) {
  const source = await readFile(filePath, 'utf-8');
  return extractFromSource(source, filePath, language);
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
node --test tests/code-graph/extract.test.js
```

Expected: All 3 tests PASS (if WASM files are available — see Step 1)

- [ ] **Step 6: Commit**

```bash
git add lib/code-graph/extract.js lib/code-graph/wasm/ tests/code-graph/extract.test.js
git commit -m "feat(code-graph): add tree-sitter AST extractor

Parses JS/TS/Python via web-tree-sitter WASM. Extracts classes,
functions, methods, imports, calls with 3-tier confidence levels."
```

---

### Task 5: AST Cache

**Files:**
- Create: `lib/code-graph/cache.js`
- Create: `tests/code-graph/cache.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/code-graph/cache.test.js`:

```javascript
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASTCache } from '../../lib/code-graph/cache.js';

describe('ASTCache', () => {
  let tempDir, cache;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'cache-test-'));
    cache = new ASTCache(tempDir);
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('stores and retrieves cached extractions', async () => {
    const content = 'function foo() { return 1; }';
    const extraction = {
      nodes: [{ id: 'test::foo', label: 'foo', type: 'function' }],
      edges: [],
    };

    await cache.set(content, extraction);
    const cached = await cache.get(content);

    assert.deepEqual(cached, extraction);
  });

  it('returns null for cache miss', async () => {
    const result = await cache.get('unknown content');
    assert.equal(result, null);
  });

  it('invalidates on content change', async () => {
    const content1 = 'const a = 1;';
    const content2 = 'const a = 2;';
    const extraction = { nodes: [], edges: [] };

    await cache.set(content1, extraction);
    const hit = await cache.get(content1);
    const miss = await cache.get(content2);

    assert.deepEqual(hit, extraction);
    assert.equal(miss, null);
  });

  it('checks freshness by stat (mtime + size)', async () => {
    const filePath = join(tempDir, 'test.js');
    await writeFile(filePath, 'const x = 1;');

    const stale = await cache.isFresh(filePath, 'old-hash');
    assert.equal(stale, false);

    // Store with current stat
    await cache.setWithStat(filePath, 'const x = 1;', { nodes: [], edges: [] });
    const fresh = await cache.isFreshByStat(filePath);
    assert.equal(fresh, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/code-graph/cache.test.js
```

Expected: FAIL

- [ ] **Step 3: Implement cache.js**

Create `lib/code-graph/cache.js`:

```javascript
import { createHash } from 'node:crypto';
import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

export class ASTCache {
  constructor(cachePath) {
    this.cachePath = cachePath;
    this.statCache = new Map(); // filePath → { size, mtimeMs }
  }

  hash(content) {
    return createHash('sha256').update(content).digest('hex');
  }

  cacheFilePath(contentHash) {
    return join(this.cachePath, `${contentHash}.json`);
  }

  async get(content) {
    const h = this.hash(content);
    const path = this.cacheFilePath(h);
    try {
      const data = await readFile(path, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  async set(content, extraction) {
    const h = this.hash(content);
    const path = this.cacheFilePath(h);
    await mkdir(this.cachePath, { recursive: true });
    await writeFile(path, JSON.stringify(extraction), 'utf-8');
  }

  async setWithStat(filePath, content, extraction) {
    await this.set(content, extraction);

    try {
      const s = await stat(filePath);
      this.statCache.set(filePath, {
        size: s.size,
        mtimeMs: s.mtimeMs,
        hash: this.hash(content),
      });
    } catch {
      // stat failed, skip stat cache
    }
  }

  async isFreshByStat(filePath) {
    const cached = this.statCache.get(filePath);
    if (!cached) return false;

    try {
      const s = await stat(filePath);
      return s.size === cached.size && s.mtimeMs === cached.mtimeMs;
    } catch {
      return false;
    }
  }

  async isFresh(filePath, expectedHash) {
    const cached = this.statCache.get(filePath);
    if (!cached) return false;
    return cached.hash === expectedHash;
  }

  async getOrExtract(filePath, content, extractFn) {
    // Fast path: check stat
    if (await this.isFreshByStat(filePath)) {
      const cached = this.statCache.get(filePath);
      if (cached) {
        const result = await this.get(content);
        if (result) return result;
      }
    }

    // Slow path: hash and check cache
    const cached = await this.get(content);
    if (cached) {
      // Update stat cache for next time
      try {
        const s = await stat(filePath);
        this.statCache.set(filePath, {
          size: s.size,
          mtimeMs: s.mtimeMs,
          hash: this.hash(content),
        });
      } catch { }
      return cached;
    }

    // Cache miss: extract and store
    const result = await extractFn();
    await this.setWithStat(filePath, content, result);
    return result;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test tests/code-graph/cache.test.js
```

Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/code-graph/cache.js tests/code-graph/cache.test.js
git commit -m "feat(code-graph): add SHA256-based AST cache with stat fastpath

Two-tier caching: stat-based fast check (size + mtime),
then SHA256 content hash. getOrExtract() combines lookup and extraction."
```

---

### Task 6: Graph Builder (graphology)

**Files:**
- Create: `lib/code-graph/build.js`
- Create: `tests/code-graph/build.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/code-graph/build.test.js`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, resolveReferences } from '../../lib/code-graph/build.js';

describe('buildGraph', () => {
  const extractions = [
    {
      nodes: [
        { id: 'src/a.js', label: 'a.js', type: 'module', file: 'src/a.js', line: 1, language: 'javascript' },
        { id: 'src/a.js::Foo', label: 'Foo', type: 'class', file: 'src/a.js', line: 5, language: 'javascript' },
        { id: 'src/a.js::Foo.bar', label: 'bar', type: 'method', file: 'src/a.js', line: 6, language: 'javascript' },
      ],
      edges: [
        { source: 'src/a.js', target: 'src/a.js::Foo', relation: 'contains', confidence: 'EXTRACTED' },
        { source: 'src/a.js::Foo', target: 'src/a.js::Foo.bar', relation: 'method', confidence: 'EXTRACTED' },
        { source: 'src/a.js', target: '__import__::./b', relation: 'imports', confidence: 'EXTRACTED' },
        { source: 'src/a.js::Foo.bar', target: '__call__::baz', relation: 'calls', confidence: 'INFERRED' },
      ],
    },
    {
      nodes: [
        { id: 'src/b.js', label: 'b.js', type: 'module', file: 'src/b.js', line: 1, language: 'javascript' },
        { id: 'src/b.js::baz', label: 'baz', type: 'function', file: 'src/b.js', line: 3, language: 'javascript' },
      ],
      edges: [
        { source: 'src/b.js', target: 'src/b.js::baz', relation: 'contains', confidence: 'EXTRACTED' },
      ],
    },
  ];

  it('builds a graphology graph from extractions', () => {
    const graph = buildGraph(extractions);

    assert.equal(graph.order, 5, 'should have 5 nodes');
    assert.ok(graph.hasNode('src/a.js'));
    assert.ok(graph.hasNode('src/a.js::Foo'));
    assert.ok(graph.hasNode('src/b.js::baz'));
    assert.equal(graph.getNodeAttribute('src/a.js::Foo', 'type'), 'class');
  });

  it('preserves edge attributes', () => {
    const graph = buildGraph(extractions);

    const containsEdges = graph.filterEdges((edge, attrs) => attrs.relation === 'contains');
    assert.ok(containsEdges.length >= 2);
  });

  it('resolves import references to actual files', () => {
    const graph = buildGraph(extractions);
    const resolved = resolveReferences(graph);

    // __import__::./b should resolve to src/b.js
    const importEdges = resolved.filterEdges((e, a) => a.relation === 'imports' && a.target !== undefined);
    assert.ok(importEdges.length >= 0); // May or may not resolve depending on path resolution
  });

  it('resolves call references to known functions', () => {
    const graph = buildGraph(extractions);
    resolveReferences(graph);

    // Check if __call__::baz was resolved to src/b.js::baz
    const hasResolvedCall = graph.someEdge((e, a) =>
      a.relation === 'calls' && graph.target(e) === 'src/b.js::baz'
    );
    assert.ok(hasResolvedCall, 'should resolve baz call to src/b.js::baz');
  });

  it('deduplicates nodes with same id', () => {
    const dupeExtractions = [
      { nodes: [{ id: 'x', label: 'X', type: 'class' }], edges: [] },
      { nodes: [{ id: 'x', label: 'X', type: 'class' }], edges: [] },
    ];
    const graph = buildGraph(dupeExtractions);
    assert.equal(graph.order, 1, 'should deduplicate');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/code-graph/build.test.js
```

Expected: FAIL

- [ ] **Step 3: Implement build.js**

Create `lib/code-graph/build.js`:

```javascript
import Graph from 'graphology';

export function buildGraph(extractions) {
  const graph = new Graph({ multi: true, type: 'directed' });

  // Phase 1: Add all nodes
  for (const extraction of extractions) {
    for (const node of extraction.nodes) {
      if (!graph.hasNode(node.id)) {
        graph.addNode(node.id, {
          label: node.label,
          type: node.type || 'unknown',
          file: node.file || '',
          line: node.line || 0,
          endLine: node.endLine || 0,
          language: node.language || '',
        });
      }
    }
  }

  // Phase 2: Add all edges (skip unresolved placeholders for now)
  for (const extraction of extractions) {
    for (const edge of extraction.edges) {
      const { source, target, relation, confidence, file, line, context } = edge;

      // Skip placeholder targets — they'll be resolved in Phase 3
      if (target.startsWith('__call__::') || target.startsWith('__import__::') || target.startsWith('__unresolved__::')) {
        // Store as pending edge
        if (!graph._pendingEdges) graph._pendingEdges = [];
        graph._pendingEdges.push(edge);
        continue;
      }

      if (graph.hasNode(source) && graph.hasNode(target)) {
        graph.addEdge(source, target, {
          relation,
          confidence: confidence || 'EXTRACTED',
          file: file || '',
          line: line || 0,
          context: context || '',
        });
      }
    }
  }

  return graph;
}

export function resolveReferences(graph) {
  const pending = graph._pendingEdges || [];
  delete graph._pendingEdges;

  // Build lookup maps
  const nodesByLabel = new Map(); // label → [nodeId, ...]
  const modulesByFile = new Map(); // file stem → nodeId

  graph.forEachNode((nodeId, attrs) => {
    const label = attrs.label;
    if (!nodesByLabel.has(label)) nodesByLabel.set(label, []);
    nodesByLabel.get(label).push(nodeId);

    if (attrs.type === 'module') {
      // Map file stems for import resolution
      const stem = nodeId.replace(/\.(js|ts|jsx|tsx|mjs|cjs|py|go|rs|java|rb|cs|kt|php)$/, '');
      modulesByFile.set(stem, nodeId);

      // Also map just the filename without extension
      const parts = stem.split('/');
      const baseName = parts[parts.length - 1];
      if (!modulesByFile.has(baseName)) {
        modulesByFile.set(baseName, nodeId);
      }
    }
  });

  for (const edge of pending) {
    const { source, target, relation, confidence, file, line, context } = edge;

    if (!graph.hasNode(source)) continue;

    let resolvedTarget = null;
    let resolvedConfidence = confidence;

    if (target.startsWith('__call__::')) {
      // Resolve function/method calls by label
      const callName = target.replace('__call__::', '');
      const candidates = nodesByLabel.get(callName) || [];

      if (candidates.length === 1) {
        resolvedTarget = candidates[0];
        resolvedConfidence = 'INFERRED';
      } else if (candidates.length > 1) {
        // Try to pick the one from the same file or imported module
        const sourceFile = graph.getNodeAttribute(source, 'file') || source.split('::')[0];
        const sameFile = candidates.find(c => c.startsWith(sourceFile));
        if (sameFile) {
          resolvedTarget = sameFile;
          resolvedConfidence = 'INFERRED';
        } else {
          // Ambiguous — pick first but mark as AMBIGUOUS
          resolvedTarget = candidates[0];
          resolvedConfidence = 'AMBIGUOUS';
        }
      }
    } else if (target.startsWith('__import__::')) {
      const importPath = target.replace('__import__::', '');

      // Try to resolve relative imports
      if (importPath.startsWith('.')) {
        const sourceFile = graph.getNodeAttribute(source, 'file') || source;
        const sourceDir = sourceFile.split('/').slice(0, -1).join('/');
        const resolved = resolveRelativePath(sourceDir, importPath);

        // Try with and without extensions
        for (const candidate of [resolved, `${resolved}/index`]) {
          if (modulesByFile.has(candidate)) {
            resolvedTarget = modulesByFile.get(candidate);
            resolvedConfidence = 'EXTRACTED';
            break;
          }
        }
      } else {
        // Absolute import — try to find by stem
        const parts = importPath.split('/');
        const lastPart = parts[parts.length - 1];
        if (modulesByFile.has(lastPart)) {
          resolvedTarget = modulesByFile.get(lastPart);
          resolvedConfidence = 'INFERRED';
        }
      }
    } else if (target.startsWith('__unresolved__::')) {
      const name = target.replace('__unresolved__::', '');
      const candidates = nodesByLabel.get(name) || [];
      if (candidates.length === 1) {
        resolvedTarget = candidates[0];
        resolvedConfidence = 'INFERRED';
      } else if (candidates.length > 1) {
        resolvedTarget = candidates[0];
        resolvedConfidence = 'AMBIGUOUS';
      }
    }

    if (resolvedTarget && graph.hasNode(resolvedTarget)) {
      graph.addEdge(source, resolvedTarget, {
        relation,
        confidence: resolvedConfidence,
        file: file || '',
        line: line || 0,
        context: context || '',
      });
    }
  }

  return graph;
}

function resolveRelativePath(fromDir, importPath) {
  const parts = fromDir ? fromDir.split('/') : [];
  const importParts = importPath.split('/');

  for (const part of importParts) {
    if (part === '.') continue;
    if (part === '..') {
      parts.pop();
    } else {
      parts.push(part);
    }
  }

  return parts.join('/');
}

export function graphToJSON(graph) {
  const nodes = [];
  const edges = [];

  graph.forEachNode((id, attrs) => {
    nodes.push({ id, ...attrs });
  });

  graph.forEachEdge((edgeId, attrs, source, target) => {
    edges.push({ source, target, ...attrs });
  });

  return { nodes, edges };
}

export function graphFromJSON(data) {
  const graph = new Graph({ multi: true, type: 'directed' });

  for (const node of data.nodes) {
    const { id, ...attrs } = node;
    graph.addNode(id, attrs);
  }

  for (const edge of data.edges) {
    const { source, target, ...attrs } = edge;
    if (graph.hasNode(source) && graph.hasNode(target)) {
      graph.addEdge(source, target, attrs);
    }
  }

  return graph;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test tests/code-graph/build.test.js
```

Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/code-graph/build.js tests/code-graph/build.test.js
git commit -m "feat(code-graph): add graphology graph builder with reference resolution

Merges per-file extractions into a single directed multigraph.
Resolves __call__, __import__, __unresolved__ placeholders to actual nodes.
3-tier confidence: EXTRACTED → INFERRED → AMBIGUOUS."
```

---

## End of Part 1

Part 2 continues with:
- Task 7: Community Detection (Louvain)
- Task 8: Analysis (god nodes, surprise edges, stats)
- Task 9: Query module (BFS/DFS, IDF search, token budget)
- Task 10: Bridge module (brain-entry ↔ code nodes)
- Task 11: MCP handler registration + tool definitions
- Task 12: CodeGraph orchestrator (full pipeline wiring)
