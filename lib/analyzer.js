import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Codebase Analyzer — Detects project type, technologies, structure, key files
 * Used during brain initialization to generate overview.md
 */

const PROJECT_MARKERS = [
  { file: 'package.json', type: 'Node.js', parser: parsePackageJson },
  { file: 'pom.xml', type: 'Java (Maven)' },
  { file: 'build.gradle', type: 'Java (Gradle)' },
  { file: 'build.gradle.kts', type: 'Kotlin (Gradle)' },
  { file: 'requirements.txt', type: 'Python' },
  { file: 'pyproject.toml', type: 'Python' },
  { file: 'setup.py', type: 'Python' },
  { file: 'Cargo.toml', type: 'Rust' },
  { file: 'go.mod', type: 'Go' },
  { file: 'Gemfile', type: 'Ruby' },
  { file: 'composer.json', type: 'PHP' },
  { file: 'pubspec.yaml', type: 'Dart/Flutter' },
  { file: '*.csproj', type: 'C# (.NET)' },
  { file: '*.sln', type: 'C# (.NET)' },
  { file: 'Makefile', type: 'C/C++' },
  { file: 'CMakeLists.txt', type: 'C/C++ (CMake)' },
];

const FRAMEWORK_MARKERS = {
  'react': ['react', 'react-dom', 'next', 'gatsby'],
  'vue': ['vue', 'nuxt'],
  'angular': ['@angular/core'],
  'svelte': ['svelte'],
  'express': ['express'],
  'fastify': ['fastify'],
  'nestjs': ['@nestjs/core'],
  'electron': ['electron'],
  'mineflayer': ['mineflayer', 'mineflayer-bedrock'],
};

const CONFIG_FILES = [
  'tsconfig.json', '.eslintrc.js', '.eslintrc.json', 'eslint.config.js',
  '.prettierrc', 'jest.config.js', 'vitest.config.ts', 'webpack.config.js',
  'vite.config.ts', 'vite.config.js', 'rollup.config.js',
  'docker-compose.yml', 'Dockerfile', '.env.example',
  'CLAUDE.md', 'README.md',
];

/**
 * Analyze a project directory and return structured info
 */
export async function analyzeProject(projectPath) {
  const result = {
    name: '',
    types: [],
    frameworks: [],
    technologies: [],
    configFiles: [],
    structure: [],
    entryPoints: [],
    testDirs: [],
    keyFiles: [],
    description: '',
  };

  // 1. Detect project name from directory
  result.name = projectPath.split(/[/\\]/).filter(Boolean).pop();

  // 2. Check project markers
  for (const marker of PROJECT_MARKERS) {
    if (marker.file.startsWith('*')) {
      // Glob pattern — check for any matching file
      const ext = marker.file.substring(1);
      try {
        const files = await readdir(projectPath);
        if (files.some(f => f.endsWith(ext))) {
          result.types.push(marker.type);
        }
      } catch { /* ignore */ }
    } else {
      const markerPath = join(projectPath, marker.file);
      if (existsSync(markerPath)) {
        result.types.push(marker.type);
        if (marker.parser) {
          try {
            const parsed = await marker.parser(markerPath);
            Object.assign(result, parsed);
          } catch { /* ignore */ }
        }
      }
    }
  }

  // 3. Check config files
  for (const cf of CONFIG_FILES) {
    if (existsSync(join(projectPath, cf))) {
      result.configFiles.push(cf);
    }
  }

  // 4. Scan directory structure (max 3 levels)
  result.structure = await scanDirectory(projectPath, 3);

  // 5. Detect test directories
  const testDirNames = ['test', 'tests', '__tests__', 'spec', 'specs'];
  for (const dir of testDirNames) {
    if (existsSync(join(projectPath, dir))) {
      result.testDirs.push(dir);
    }
  }

  // 6. Check for existing CLAUDE.md
  const claudeMdPath = join(projectPath, 'CLAUDE.md');
  if (existsSync(claudeMdPath)) {
    try {
      result.existingClaudeMd = await readFile(claudeMdPath, 'utf-8');
    } catch { /* ignore */ }
  }

  // 7. Generate description
  result.description = generateDescription(result);

  return result;
}

async function parsePackageJson(filePath) {
  const content = await readFile(filePath, 'utf-8');
  const pkg = JSON.parse(content);
  const result = { technologies: [], frameworks: [] };

  if (pkg.name) result.name = pkg.name;

  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };

  // Detect frameworks
  for (const [framework, packages] of Object.entries(FRAMEWORK_MARKERS)) {
    if (packages.some(p => p in allDeps)) {
      result.frameworks.push(framework);
    }
  }

  // Detect TypeScript
  if ('typescript' in allDeps || existsSync(join(filePath, '..', 'tsconfig.json'))) {
    result.technologies.push('TypeScript');
  }

  // Detect testing frameworks
  if ('jest' in allDeps) result.technologies.push('Jest');
  if ('vitest' in allDeps) result.technologies.push('Vitest');
  if ('mocha' in allDeps) result.technologies.push('Mocha');

  return result;
}

async function scanDirectory(dirPath, maxDepth, currentDepth = 0, prefix = '') {
  if (currentDepth >= maxDepth) return [];

  const SKIP_DIRS = new Set([
    'node_modules', '.git', '.brain', '.claude', 'dist', 'build',
    '.next', '.nuxt', '__pycache__', '.venv', 'venv', 'target',
    '.idea', '.vscode', 'coverage', '.cache',
  ]);

  const results = [];
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const sorted = entries.sort((a, b) => {
      // Directories first
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of sorted) {
      if (entry.name.startsWith('.') && entry.isDirectory() && entry.name !== '.brain') continue;
      if (SKIP_DIRS.has(entry.name)) continue;

      const displayName = entry.isDirectory() ? `${entry.name}/` : entry.name;
      results.push(`${prefix}${displayName}`);

      if (entry.isDirectory()) {
        const subEntries = await scanDirectory(
          join(dirPath, entry.name),
          maxDepth,
          currentDepth + 1,
          prefix + '  '
        );
        results.push(...subEntries);
      }
    }
  } catch { /* ignore permission errors */ }

  return results;
}

function generateDescription(analysis) {
  const parts = [];

  if (analysis.types.length > 0) {
    parts.push(`${analysis.types.join(' / ')} -projekti`);
  } else {
    parts.push('Projekti');
  }

  if (analysis.frameworks.length > 0) {
    parts.push(`(${analysis.frameworks.join(', ')})`);
  }

  if (analysis.technologies.length > 0) {
    parts.push(`| Teknologiat: ${analysis.technologies.join(', ')}`);
  }

  return parts.join(' ');
}

/**
 * Analyze multiple project directories and merge results
 * @param {Array<{path: string, label: string}>} pathEntries
 * @returns {Object} Merged analysis with per-path structures
 */
export async function analyzeMultiplePaths(pathEntries) {
  const merged = {
    name: '',
    types: [],
    frameworks: [],
    technologies: [],
    configFiles: [],
    structure: [],
    entryPoints: [],
    testDirs: [],
    keyFiles: [],
    description: '',
    pathAnalyses: [],  // per-path breakdown
  };

  for (const { path: p, label } of pathEntries) {
    const analysis = await analyzeProject(p);
    merged.pathAnalyses.push({ path: p, label, analysis });

    // Merge deduplicated
    for (const t of analysis.types) {
      if (!merged.types.includes(t)) merged.types.push(t);
    }
    for (const f of analysis.frameworks) {
      if (!merged.frameworks.includes(f)) merged.frameworks.push(f);
    }
    for (const t of analysis.technologies) {
      if (!merged.technologies.includes(t)) merged.technologies.push(t);
    }
    for (const d of analysis.testDirs) {
      if (!merged.testDirs.includes(d)) merged.testDirs.push(d);
    }
  }

  merged.description = generateDescription(merged);
  return merged;
}

/**
 * Generate overview.md content from analysis results (single or multi-path)
 */
export function generateOverview(analysis) {
  let md = `# ${analysis.name}\n\n`;
  md += `> ${analysis.description}\n\n`;

  // Multi-path: show paths table
  if (analysis.pathAnalyses && analysis.pathAnalyses.length > 0) {
    md += `## Projektisijainnit\n\n`;
    md += `| Sijainti | Kuvaus | Tyyppi |\n`;
    md += `|----------|--------|--------|\n`;
    for (const { path: p, label, analysis: a } of analysis.pathAnalyses) {
      md += `| \`${p}\` | ${label} | ${a.types.join(', ') || '-'} |\n`;
    }
    md += '\n';
  }

  if (analysis.types.length > 0) {
    md += `## Projektityyppi\n${analysis.types.join(', ')}\n\n`;
  }

  if (analysis.frameworks.length > 0) {
    md += `## Frameworkit\n${analysis.frameworks.join(', ')}\n\n`;
  }

  if (analysis.technologies.length > 0) {
    md += `## Teknologiat\n${analysis.technologies.join(', ')}\n\n`;
  }

  // Multi-path: show structure per path
  if (analysis.pathAnalyses && analysis.pathAnalyses.length > 0) {
    for (const { path: p, label, analysis: a } of analysis.pathAnalyses) {
      if (a.structure.length > 0) {
        md += `## Kansiorakenne: ${label}\n`;
        md += `\`${p}\`\n\`\`\`\n`;
        md += a.structure.join('\n');
        md += '\n```\n\n';
      }
    }
  } else {
    // Single path fallback
    if (analysis.configFiles.length > 0) {
      md += `## Konfiguraatiotiedostot\n`;
      for (const cf of analysis.configFiles) {
        md += `- ${cf}\n`;
      }
      md += '\n';
    }
    if (analysis.structure.length > 0) {
      md += `## Kansiorakenne\n\`\`\`\n`;
      md += analysis.structure.join('\n');
      md += '\n```\n\n';
    }
  }

  if (analysis.testDirs.length > 0) {
    md += `## Testit\nTestikansiot: ${analysis.testDirs.join(', ')}\n\n`;
  }

  md += `---\n*Generoitu automaattisesti ${new Date().toISOString().substring(0, 10)}*\n`;

  return md;
}
