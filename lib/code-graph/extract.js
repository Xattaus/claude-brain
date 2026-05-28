import { Parser, Language } from 'web-tree-sitter';
import { getLanguageConfig } from './languages/index.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WASM_DIR = join(__dirname, 'wasm');

/** @type {boolean} */
let parserInitialized = false;

/** @type {Map<string, Language>} */
const languageCache = new Map();

/**
 * Ensure web-tree-sitter is initialized (idempotent).
 */
async function ensureInit() {
  if (!parserInitialized) {
    await Parser.init();
    parserInitialized = true;
  }
}

/**
 * Load and cache a tree-sitter Language from its WASM file.
 * @param {string} wasmFile - e.g. 'tree-sitter-javascript.wasm'
 * @returns {Promise<Language>}
 */
async function loadLanguage(wasmFile) {
  if (languageCache.has(wasmFile)) {
    return languageCache.get(wasmFile);
  }
  const wasmPath = join(WASM_DIR, wasmFile);
  const lang = await Language.load(wasmPath);
  languageCache.set(wasmFile, lang);
  return lang;
}

/**
 * Confidence levels for extracted relationships.
 * EXTRACTED = directly from AST (imports, class declarations, etc.)
 * INFERRED  = from call expressions, references
 * GUESSED   = heuristic / name-based resolution
 */
const Confidence = {
  EXTRACTED: 'EXTRACTED',
  INFERRED: 'INFERRED',
  GUESSED: 'GUESSED',
};

/**
 * Extract code-graph nodes and edges from a source string.
 *
 * @param {string} source     - Source code text
 * @param {string} filePath   - Logical file path (used as ID prefix)
 * @param {string} language   - Language name ('javascript' | 'typescript' | 'python')
 * @returns {Promise<{ nodes: Array, edges: Array }>}
 */
export async function extractFromSource(source, filePath, language) {
  await ensureInit();

  const config = getLanguageConfig(language);
  if (!config) {
    throw new Error(`Unsupported language: ${language}`);
  }

  const lang = await loadLanguage(config.wasmFile);
  const parser = new Parser();
  parser.setLanguage(lang);

  const tree = parser.parse(source);
  if (!tree) {
    throw new Error(`Failed to parse source for ${filePath}`);
  }

  const nodes = [];
  const edges = [];

  // File node
  nodes.push({
    id: filePath,
    label: filePath.split('/').pop(),
    type: 'file',
    filePath,
    startLine: 0,
    endLine: source.split('\n').length - 1,
  });

  // Track current class context for method containment
  walkNode(tree.rootNode, filePath, config, nodes, edges, null);

  parser.delete();

  return { nodes, edges };
}

/**
 * Recursively walk AST nodes and extract code graph elements.
 *
 * @param {object} node           - tree-sitter AST node
 * @param {string} filePath       - file path for ID generation
 * @param {object} config         - language configuration
 * @param {Array}  nodes          - accumulator for graph nodes
 * @param {Array}  edges          - accumulator for graph edges
 * @param {string|null} classCtx  - current enclosing class name (if inside a class)
 */
function walkNode(node, filePath, config, nodes, edges, classCtx) {
  const nodeType = node.type;
  const nt = config.nodeTypes;

  // --- CLASS ---
  if (nt.class && nt.class.includes(nodeType)) {
    const className = config.getClassName(node);
    if (className) {
      const classId = `${filePath}::${className}`;
      nodes.push({
        id: classId,
        label: className,
        type: 'class',
        filePath,
        startLine: node.startPosition.row,
        endLine: node.endPosition.row,
      });

      // File contains class
      edges.push({
        source: filePath,
        target: classId,
        relation: 'contains',
        confidence: Confidence.EXTRACTED,
      });

      // Superclass / inheritance
      if (config.getSuperClass) {
        const superClass = config.getSuperClass(node);
        if (superClass) {
          edges.push({
            source: classId,
            target: `__unresolved__::${superClass}`,
            relation: 'inherits',
            confidence: Confidence.EXTRACTED,
          });
        }
      }

      // Recurse into class body with class context
      for (let i = 0; i < node.childCount; i++) {
        walkNode(node.child(i), filePath, config, nodes, edges, className);
      }
      return; // already recursed
    }
  }

  // --- FUNCTION (top-level or nested) ---
  if (nt.function && nt.function.includes(nodeType) && !classCtx) {
    const fnName = config.getFunctionName(node);
    if (fnName) {
      const fnId = `${filePath}::${fnName}`;
      nodes.push({
        id: fnId,
        label: fnName,
        type: 'function',
        filePath,
        startLine: node.startPosition.row,
        endLine: node.endPosition.row,
      });

      // File contains function
      edges.push({
        source: filePath,
        target: fnId,
        relation: 'contains',
        confidence: Confidence.EXTRACTED,
      });

      // Walk function body for calls
      walkFunctionBody(node, filePath, fnId, config, edges);
      return; // don't recurse further
    }
  }

  // --- METHOD (inside a class) ---
  if (nt.method && nt.method.includes(nodeType) && classCtx) {
    const methodName = getMethodName(node, config);
    if (methodName) {
      const methodId = `${filePath}::${classCtx}.${methodName}`;
      const classId = `${filePath}::${classCtx}`;
      nodes.push({
        id: methodId,
        label: methodName,
        type: 'method',
        filePath,
        startLine: node.startPosition.row,
        endLine: node.endPosition.row,
        className: classCtx,
      });

      // Class contains method
      edges.push({
        source: classId,
        target: methodId,
        relation: 'contains',
        confidence: Confidence.EXTRACTED,
      });

      // Walk method body for calls
      walkFunctionBody(node, filePath, methodId, config, edges);
      return; // don't recurse further
    }
  }

  // --- IMPORT ---
  if (nt.import && nt.import.includes(nodeType)) {
    const importSource = config.getImportSource(node);
    if (importSource) {
      // Create an import edge from the file to the import source
      edges.push({
        source: filePath,
        target: `__import__::${importSource}`,
        relation: 'imports',
        confidence: Confidence.EXTRACTED,
      });

      // Also extract individual specifiers
      if (config.getImportSpecifiers) {
        const specifiers = config.getImportSpecifiers(node);
        for (const spec of specifiers) {
          edges.push({
            source: filePath,
            target: `__import__::${importSource}::${spec}`,
            relation: 'imports',
            confidence: Confidence.EXTRACTED,
          });
        }
      }
    }
    return; // imports don't need recursive walking
  }

  // --- EXPORT ---
  if (nt.export && nt.export.includes(nodeType)) {
    // For exports, walk children to find the declaration inside
    for (let i = 0; i < node.childCount; i++) {
      walkNode(node.child(i), filePath, config, nodes, edges, classCtx);
    }
    return;
  }

  // --- DEFAULT: recurse into children ---
  for (let i = 0; i < node.childCount; i++) {
    walkNode(node.child(i), filePath, config, nodes, edges, classCtx);
  }
}

/**
 * Walk a function/method body looking for call expressions.
 *
 * @param {object} node      - function/method AST node
 * @param {string} filePath  - file path
 * @param {string} callerId  - ID of the calling function/method
 * @param {object} config    - language config
 * @param {Array}  edges     - accumulator for edges
 */
function walkFunctionBody(node, filePath, callerId, config, edges) {
  const nt = config.nodeTypes;

  function walk(n) {
    if (nt.call && nt.call.includes(n.type)) {
      const callName = config.getCallName(n);
      if (callName) {
        edges.push({
          source: callerId,
          target: `__call__::${callName}`,
          relation: 'calls',
          confidence: Confidence.INFERRED,
        });
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      walk(n.child(i));
    }
  }

  walk(node);
}

/**
 * Get the name of a method node.
 * For JavaScript/TypeScript: property_identifier child
 * For Python: uses getFunctionName (both methods and functions use function_definition)
 */
function getMethodName(node, config) {
  // Python uses function_definition for both, so getFunctionName works
  if (config.name === 'python') {
    return config.getFunctionName(node);
  }

  // JS/TS method_definition has a property_identifier child as the name
  const nameNode = node.childForFieldName('name');
  if (nameNode) return nameNode.text;

  // Fallback: look for property_identifier child
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child.type === 'property_identifier') {
      return child.text;
    }
  }
  return null;
}
