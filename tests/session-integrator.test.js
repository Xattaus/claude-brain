import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionIntegrator } from '../lib/integrations/session-integrator.js';
import { BrainManager } from '../lib/brain-manager.js';

describe('SessionIntegrator — record research', () => {
  let tempDir, manager, integrator;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'session-int-'));
    manager = new BrainManager(tempDir);
    await manager.initBrain({
      projectName: 'session-test',
      overview: '# Session Test',
      paths: [{ path: tempDir, label: 'root' }]
    });
    integrator = new SessionIntegrator(manager);
  });

  after(async () => { await rm(tempDir, { recursive: true, force: true }); });

  it('creates a research entry with alternatives and rejections', async () => {
    const result = await integrator.recordResearch({
      title: 'ELO vs TrueSkill evaluation',
      alternatives: [
        { name: 'ELO', description: 'Simple, proven for 1v1' },
        { name: 'TrueSkill', description: 'Better for teams, complex' },
        { name: 'Glicko-2', description: 'Confidence intervals' }
      ],
      rejected: [
        { name: 'TrueSkill', reason: 'Too complex for this context' },
        { name: 'Glicko-2', reason: 'Requires regular play for reliability' }
      ],
      conclusion: 'ELO selected — simplicity wins for Classic AP context',
      agent_data: 'Researcher agent compared 3 papers',
      tags: ['matchmaking', 'research']
    });

    assert.ok(result.id.startsWith('RES-'));
    assert.ok(result.path.includes('research/'));

    const index = await manager.loadIndex();
    const entry = index.entries.find(e => e.id === result.id);
    assert.equal(entry.type, 'research');
    assert.equal(entry.title, 'ELO vs TrueSkill evaluation');
  });

  it('creates research entry with minimal data', async () => {
    const result = await integrator.recordResearch({
      title: 'Quick investigation',
      alternatives: [{ name: 'Option A', description: 'First option' }],
      conclusion: 'Option A works fine'
    });

    assert.ok(result.id.startsWith('RES-'));
  });
});
