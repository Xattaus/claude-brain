
import { BrainManager } from './lib/brain-manager.js';
import { BrainSearch } from './lib/search.js';
import { rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const TEST_DIR = './bench_test_env';
const FILE_COUNT = 1000;

async function setup() {
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(TEST_DIR, { recursive: true });

    const manager = new BrainManager(TEST_DIR);
    await manager.initBrain({ projectName: 'BenchTest', overview: 'Test', paths: [] });
    return { manager, search: new BrainSearch(manager) };
}

async function generateData(manager) {
    console.log(`Generating ${FILE_COUNT} entries...`);
    const index = await manager.loadIndex();

    // Directly manipulate files to speed up generation (bypassing BrainManager overhead for setup)
    for (let i = 0; i < FILE_COUNT; i++) {
        const id = `DEC-${String(i).padStart(4, '0')}`;
        const title = `Decision about efficient algorithms ${i}`;
        const content = `We decided to use optimization technique #${i} because it is very fast.`;

        // Create file
        await writeFile(join(TEST_DIR, '.brain', 'decisions', `${id}.md`),
            `---\nid: ${id}\ntitle: "${title}"\n---\n\n${content}`);

        // Add to index
        index.entries.push({
            id, type: 'decision', title, status: 'active',
            path: `decisions/${id}.md`, tags: []
        });
    }

    await manager.saveIndex(index);
    console.log('Data generation complete.');
}

async function runBenchmark() {
    const { manager, search } = await setup();
    await generateData(manager);

    console.log('Running search benchmark...');
    const start = process.hrtime.bigint();

    // Search for a common term that requires content scanning
    const results = await search.search('optimization');

    const end = process.hrtime.bigint();
    const duration = Number(end - start) / 1e6; // ms

    console.log(`Search took ${duration.toFixed(2)}ms`);
    console.log(`Results found: ${results.length}`);

    if (duration > 500) {
        console.log(`⚠️ Search is SLOW (>500ms). Scalability issue confirmed.`);
    } else {
        console.log(`✅ Search is fast enough.`);
    }

    // Cleanup
    await rm(TEST_DIR, { recursive: true, force: true });
}

runBenchmark().catch(console.error);
