// Expanded stopword list (English ~80 + Finnish ~40)
const STOPWORDS = new Set([
  // English
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
  'under', 'again', 'further', 'then', 'once', 'and', 'but', 'or', 'nor',
  'not', 'so', 'if', 'that', 'this', 'it', 'its', 'my', 'your', 'his',
  'her', 'our', 'their', 'what', 'which', 'who', 'whom', 'where', 'when',
  'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
  'some', 'such', 'than', 'too', 'very', 'just', 'about', 'also', 'here',
  'there', 'these', 'those', 'only', 'own', 'same', 'while', 'because',
  'until', 'any', 'no', 'up', 'down',
  // Finnish
  'ja', 'tai', 'on', 'ei', 'se', 'kun', 'jos', 'niin', 'joka', 'tämä',
  'ole', 'olla', 'oli', 'sen', 'voi', 'myös', 'kuin', 'nyt', 'sitten',
  'joten', 'koska', 'mutta', 'sekä', 'eli', 'vai', 'ettei', 'mikä',
  'näiden', 'tästä', 'niiden', 'jossa', 'ovat', 'olla', 'hän', 'ovat',
  'nämä', 'meidän', 'teidän', 'niitä', 'itse', 'kaikki', 'vain', 'yli',
]);

// Synonym groups — maps each term to its canonical form
const SYNONYM_GROUPS = [
  ['jwt', 'token', 'bearer', 'auth_token'],
  ['db', 'database', 'sql', 'postgres', 'postgresql', 'mysql', 'sqlite'],
  ['api', 'endpoint', 'route', 'rest'],
  ['auth', 'authentication', 'login', 'signin', 'sso'],
  ['authz', 'authorization', 'permission', 'access', 'rbac'],
  ['cache', 'caching', 'memoize', 'memoization'],
  ['config', 'configuration', 'settings', 'options', 'preferences'],
  ['deploy', 'deployment', 'release', 'ship'],
  ['err', 'error', 'exception', 'fault', 'failure'],
  ['fn', 'func', 'function', 'method', 'handler'],
  ['log', 'logging', 'logger', 'trace'],
  ['msg', 'message', 'notification', 'alert'],
  ['perf', 'performance', 'speed', 'latency', 'throughput'],
  ['pkg', 'package', 'module', 'library', 'dependency'],
  ['repo', 'repository', 'codebase'],
  ['req', 'request', 'query'],
  ['res', 'response', 'reply', 'result'],
  ['sec', 'security', 'vulnerability', 'exploit'],
  ['test', 'testing', 'spec', 'assertion'],
  ['ui', 'frontend', 'interface', 'component', 'widget'],
];

// Build synonym lookup: word → canonical (first in group)
const SYNONYM_MAP = new Map();
for (const group of SYNONYM_GROUPS) {
  const canonical = group[0];
  for (const term of group) {
    SYNONYM_MAP.set(term, canonical);
  }
}

export function normalizeWord(word) {
  let w = word.toLowerCase().trim();
  if (w.length <= 2) return w;
  // Check synonyms on original word first
  if (SYNONYM_MAP.has(w)) return SYNONYM_MAP.get(w);
  // Simple suffix stripping
  if (w.endsWith('tion') || w.endsWith('ment')) w = w.slice(0, -4);
  else if (w.endsWith('ing') && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith('ed') && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('ly') && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('es') && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) w = w.slice(0, -1);
  // Check synonyms on stripped word
  return SYNONYM_MAP.get(w) || w;
}

export function extractSignificantWords(text) {
  return text
    .toLowerCase()
    .replace(/[^a-zäöå0-9\s\-_]/g, ' ')
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length > 2 && !STOPWORDS.has(w))
    .map(normalizeWord);
}

export function extractWordSet(text) {
  return new Set(extractSignificantWords(text));
}

export function weightedJaccard(setA, setB, idfWeights) {
  if (setA.size === 0 || setB.size === 0) return 0;

  if (!idfWeights) {
    // Plain Jaccard fallback
    const intersection = new Set([...setA].filter(w => setB.has(w)));
    const union = new Set([...setA, ...setB]);
    return intersection.size / union.size;
  }

  // Weighted Jaccard
  let intersectionWeight = 0;
  let unionWeight = 0;
  const allWords = new Set([...setA, ...setB]);

  for (const word of allWords) {
    const weight = idfWeights.get(word) || 1.0;
    const inA = setA.has(word);
    const inB = setB.has(word);
    if (inA && inB) intersectionWeight += weight;
    unionWeight += weight;
  }

  return unionWeight > 0 ? intersectionWeight / unionWeight : 0;
}

export { STOPWORDS, SYNONYM_MAP };
