import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractFromSource } from '../../lib/code-graph/extract.js';

describe('extractFromSource', () => {
  it('extracts classes and functions from JavaScript', async () => {
    const source = `
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export class FileReader {
  constructor(path) {
    this.path = path;
  }

  async read() {
    return readFile(this.path, 'utf-8');
  }
}

export function parseContent(text) {
  return JSON.parse(text);
}

const result = parseContent('{}');
`;

    const result = await extractFromSource(source, 'src/file-reader.js', 'javascript');

    assert.ok(result.nodes.length > 0, 'should have nodes');
    const nodeLabels = result.nodes.map(n => n.label);
    assert.ok(nodeLabels.includes('FileReader'), 'should find FileReader class');
    assert.ok(nodeLabels.includes('parseContent'), 'should find parseContent function');

    assert.ok(result.edges.length > 0, 'should have edges');
    const importEdges = result.edges.filter(e => e.relation === 'imports');
    assert.ok(importEdges.length >= 2, 'should find 2 import edges');

    const containsEdges = result.edges.filter(e => e.relation === 'contains');
    assert.ok(containsEdges.length > 0, 'should have contains edges');
  });

  it('extracts from Python', async () => {
    const source = `
from os.path import join
import json

class Config:
    def __init__(self, path):
        self.path = path

    def load(self):
        with open(self.path) as f:
            return json.load(f)

def create_config(path):
    return Config(path)
`;

    const result = await extractFromSource(source, 'config.py', 'python');
    const nodeLabels = result.nodes.map(n => n.label);
    assert.ok(nodeLabels.includes('Config'), 'should find Config class');
    assert.ok(nodeLabels.includes('create_config'), 'should find create_config');
  });

  it('extracts from Rust', async () => {
    const source = `
use std::collections::HashMap;
use crate::config::Settings;

pub struct AppState {
    data: HashMap<String, String>,
}

impl AppState {
    pub fn new() -> Self {
        AppState { data: HashMap::new() }
    }

    pub fn get(&self, key: &str) -> Option<&String> {
        self.data.get(key)
    }
}

pub fn create_app() -> AppState {
    AppState::new()
}
`;
    const result = await extractFromSource(source, 'src/app.rs', 'rust');
    const nodeLabels = result.nodes.map(n => n.label);
    assert.ok(nodeLabels.includes('AppState'), 'should find AppState struct');
    assert.ok(nodeLabels.includes('create_app'), 'should find create_app function');
  });

  it('assigns confidence levels', async () => {
    const source = `
import { foo } from './bar';
foo();
`;
    const result = await extractFromSource(source, 'test.js', 'javascript');
    const importEdge = result.edges.find(e => e.relation === 'imports');
    assert.equal(importEdge.confidence, 'EXTRACTED');
  });
});
