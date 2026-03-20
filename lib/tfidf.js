import { extractSignificantWords } from './word-processing.js';

export class TfIdf {
  constructor() {
    this.idfWeights = new Map();
    this.ready = false;
  }

  build(documents) {
    try {
      const docCount = documents.length;
      if (docCount === 0) return;

      // Count how many documents each term appears in
      const docFreq = new Map();
      for (const doc of documents) {
        const words = new Set(extractSignificantWords(doc));
        for (const word of words) {
          docFreq.set(word, (docFreq.get(word) || 0) + 1);
        }
      }

      // Calculate IDF: log(N / df)
      for (const [term, df] of docFreq) {
        this.idfWeights.set(term, Math.log(docCount / df));
      }

      this.ready = true;
    } catch {
      // Non-critical — graceful fallback
      this.ready = false;
    }
  }

  getWeights() {
    return this.ready ? this.idfWeights : null;
  }
}
