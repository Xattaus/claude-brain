#!/usr/bin/env node

/**
 * Brain Visualizer — Sci-fi 3D neural map of project knowledge
 *
 * Usage:
 *   node visualize.js [project-path]
 *
 * Opens a browser with an interactive 3D visualization of the .brain/ data.
 * No external dependencies — uses Node.js built-in http module.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Brain path discovery ──

function resolveBrainPath() {
  const candidates = [
    process.argv[2],
    process.env.BRAIN_PROJECT_PATH,
    process.cwd()
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(join(candidate, '.brain'))) {
      return candidate;
    }
  }
  return null;
}

// ── Data transformation: index.json → graph format ──

async function loadGraphData(projectPath) {
  const indexPath = join(projectPath, '.brain', 'index.json');
  const raw = await readFile(indexPath, 'utf-8');
  const index = JSON.parse(raw);

  const TYPE_GROUPS = { decision: 0, bug: 1, implementation: 2, pattern: 3, plan: 4 };
  const now = Date.now();
  const msPerDay = 86400000;

  // Build nodes
  const nodes = index.entries.map(entry => {
    const reviewDate = entry.last_reviewed || entry.date;
    const daysSinceReview = Math.round((now - new Date(reviewDate).getTime()) / msPerDay);
    return {
      id: entry.id,
      name: entry.title,
      type: entry.type,
      status: entry.status,
      date: entry.date,
      last_reviewed: reviewDate,
      tags: entry.tags || [],
      files: entry.files || [],
      path: entry.path,
      connectionCount: (entry.related || []).length,
      group: TYPE_GROUPS[entry.type] ?? 0,
      severity: entry.severity || null,
      priority: entry.priority || null,
      daysSinceReview,
      isStale: daysSinceReview > 30
    };
  });

  // Build links (deduplicated)
  const linkSet = new Set();
  const links = [];

  for (const entry of index.entries) {
    if (!entry.related) continue;
    for (const rel of entry.related) {
      const key = [entry.id, rel.id].sort().join('|') + ':' + rel.rel;
      if (linkSet.has(key)) continue;
      linkSet.add(key);
      links.push({ source: entry.id, target: rel.id, relType: rel.rel });
    }
  }

  // Add curvature for parallel links
  const pairCount = {};
  for (const link of links) {
    const pk = [link.source, link.target].sort().join('|');
    pairCount[pk] = (pairCount[pk] || 0) + 1;
  }
  for (const link of links) {
    const pk = [link.source, link.target].sort().join('|');
    link.curvature = pairCount[pk] > 1 ? 0.3 : 0;
  }

  return {
    nodes,
    links,
    counters: index.counters,
    project: index.project
  };
}

// ── HTTP server ──

async function startServer(projectPath) {
  const templatePath = join(__dirname, 'templates', 'visualizer', 'index.html');

  const server = createServer(async (req, res) => {
    try {
      const url = req.url.split('?')[0];

      if (url === '/' || url === '/index.html') {
        const html = await readFile(templatePath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end(html);
      } else if (url === '/api/graph') {
        const data = await loadGraphData(projectPath);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify(data));
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

// ── Browser opener ──

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? 'start'
    : process.platform === 'darwin' ? 'open'
    : 'xdg-open';
  exec(`${cmd} ${url}`);
}

// ── Main ──

async function main() {
  const projectPath = resolveBrainPath();
  if (!projectPath) {
    console.error('Error: No .brain/ folder found.');
    console.error('Usage: node visualize.js [project-path]');
    console.error('Or set BRAIN_PROJECT_PATH environment variable.');
    process.exit(1);
  }

  // Quick validation
  const data = await loadGraphData(projectPath);

  console.log();
  console.log('  \u2588\u2588\u2588 Brain Neural Map \u2588\u2588\u2588');
  console.log();
  console.log(`  Project: ${projectPath}`);
  console.log(`  Entries: ${data.nodes.length} nodes, ${data.links.length} links`);
  console.log();

  const { url } = await startServer(projectPath);
  console.log(`  \u2192 ${url}`);
  console.log();
  console.log('  Press Ctrl+C to stop.');
  console.log();

  openBrowser(url);
}

main().catch(err => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
