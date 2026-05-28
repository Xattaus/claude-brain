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
