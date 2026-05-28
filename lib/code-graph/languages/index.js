import { javascriptConfig } from './javascript.js';
import { typescriptConfig } from './typescript.js';
import { pythonConfig } from './python.js';
import { rustConfig } from './rust.js';

const LANGUAGES = new Map([
  ['javascript', javascriptConfig],
  ['typescript', typescriptConfig],
  ['python', pythonConfig],
  ['rust', rustConfig],
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
