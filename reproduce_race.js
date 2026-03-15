
import { BrainManager } from './lib/brain-manager.js';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const TEST_DIR = './race_test_env';

async function setup() {
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(TEST_DIR, { recursive: true });

    const manager = new BrainManager(TEST_DIR);
    await manager.initBrain({ projectName: 'RaceTest', overview: 'Test', paths: [] });
    return manager;
}

async function runRace() {
    const manager = await setup();
    console.log('Starting race condition test...');

    // Simulate 20 concurrent writes
    // Each write adds a UNIQUE entry.
    // If perfect, we should have 20 entries.
    // If race, we will have fewer.

    const promises = [];
    for (let i = 0; i < 20; i++) {
        promises.push(manager.createEntry({
            type: 'decision',
            prefix: 'DEC',
            dirName: 'decisions',
            title: `Decision ${i}`,
            frontmatter: { status: 'active' },
            body: `Content ${i}`
        }));
    }

    await Promise.allSettled(promises);

    const index = await manager.loadIndex();
    console.log(`Total entries in index: ${index.entries.length} / 20`);

    if (index.entries.length < 20) {
        console.log('🚨 RACE CONDITION CONFIRMED: Data loss occurred.');
    } else {
        console.log('✅ No race condition detected (lucky run?).');
    }

    // Cleanup
    await rm(TEST_DIR, { recursive: true, force: true });
}

runRace().catch(console.error);
