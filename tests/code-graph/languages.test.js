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
