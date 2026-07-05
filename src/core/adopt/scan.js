// owner: RStack developed by Richardson Gunde
//
// Brownfield repository scanner (#148): read-only detection of what an
// existing codebase already has — toolchain, docs, tests, CI/CD, deploy
// config, architecture signals. Everything it reports carries the file path
// it was detected from, because adoption artifacts must point at real
// evidence, never at inferences without a source.

import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', '.rstack', 'dist', 'build', 'coverage', 'vendor', '__pycache__', '.venv', 'venv', '.next', 'target']);

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function listDir(dirPath) {
  try {
    return await readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

// Manifest-file detectors: language/framework signals with their evidence path.
const TOOLCHAIN_DETECTORS = [
  { file: 'package.json', language: 'javascript' },
  { file: 'tsconfig.json', language: 'typescript' },
  { file: 'pyproject.toml', language: 'python' },
  { file: 'requirements.txt', language: 'python' },
  { file: 'go.mod', language: 'go' },
  { file: 'Cargo.toml', language: 'rust' },
  { file: 'pom.xml', language: 'java' },
  { file: 'build.gradle', language: 'java' },
  { file: 'Gemfile', language: 'ruby' },
  { file: 'composer.json', language: 'php' },
];

const FRAMEWORK_DEPS = Object.freeze({
  react: 'react', next: 'next', vue: 'vue', angular: '@angular/core', svelte: 'svelte',
  express: 'express', fastify: 'fastify', nestjs: '@nestjs/core',
  jest: 'jest', vitest: 'vitest', mocha: 'mocha', playwright: '@playwright/test', cypress: 'cypress',
});

async function detectToolchain(projectRoot) {
  const languages = [];
  const frameworks = [];
  for (const detector of TOOLCHAIN_DETECTORS) {
    const filePath = join(projectRoot, detector.file);
    if (!existsSync(filePath)) continue;
    if (!languages.some((entry) => entry.language === detector.language)) {
      languages.push({ language: detector.language, evidence: detector.file });
    }
    if (detector.file === 'package.json') {
      const pkg = await readJsonIfPresent(filePath);
      const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
      for (const [name, dep] of Object.entries(FRAMEWORK_DEPS)) {
        if (deps[dep]) frameworks.push({ framework: name, evidence: `package.json (${dep})` });
      }
    }
  }
  return { languages, frameworks };
}

async function detectDocs(projectRoot) {
  const docs = [];
  for (const name of ['README.md', 'README.rst', 'CONTRIBUTING.md', 'CHANGELOG.md', 'ARCHITECTURE.md']) {
    if (existsSync(join(projectRoot, name))) docs.push(name);
  }
  for (const dir of ['docs', 'doc', 'documentation']) {
    const entries = await listDir(join(projectRoot, dir));
    for (const entry of entries.slice(0, 50)) {
      if (entry.isFile() && /\.(md|mdx|rst|txt)$/i.test(entry.name)) docs.push(join(dir, entry.name));
    }
  }
  return docs;
}

async function detectTests(projectRoot) {
  const testDirs = [];
  const configs = [];
  for (const dir of ['test', 'tests', '__tests__', 'spec', 'e2e']) {
    const entries = await listDir(join(projectRoot, dir));
    const count = entries.filter((entry) => entry.isFile()).length;
    if (count > 0) testDirs.push({ dir, files: count });
  }
  for (const config of ['jest.config.js', 'jest.config.ts', 'vitest.config.ts', 'vitest.config.js', 'playwright.config.ts', 'pytest.ini', 'karma.conf.js', '.mocharc.yml']) {
    if (existsSync(join(projectRoot, config))) configs.push(config);
  }
  const pkg = await readJsonIfPresent(join(projectRoot, 'package.json'));
  const testCommand = pkg?.scripts?.test && !/no test specified/i.test(pkg.scripts.test) ? 'npm test' : null;
  return { testDirs, configs, testCommand };
}

async function detectCi(projectRoot) {
  const pipelines = [];
  const workflows = await listDir(join(projectRoot, '.github', 'workflows'));
  for (const entry of workflows) {
    if (entry.isFile() && /\.ya?ml$/.test(entry.name)) pipelines.push(join('.github', 'workflows', entry.name));
  }
  for (const file of ['.gitlab-ci.yml', 'Jenkinsfile', '.circleci/config.yml', 'azure-pipelines.yml', 'bitbucket-pipelines.yml']) {
    if (existsSync(join(projectRoot, file))) pipelines.push(file);
  }
  return pipelines;
}

async function detectDeploy(projectRoot) {
  const configs = [];
  for (const file of ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'Procfile', 'fly.toml', 'vercel.json', 'netlify.toml', 'serverless.yml', 'app.yaml']) {
    if (existsSync(join(projectRoot, file))) configs.push(file);
  }
  for (const dir of ['k8s', 'kubernetes', 'terraform', 'infra', 'deploy', 'helm', 'charts']) {
    const entries = await listDir(join(projectRoot, dir));
    if (entries.some((entry) => entry.isFile() || entry.isDirectory())) configs.push(`${dir}/`);
  }
  return configs;
}

async function detectStructure(projectRoot) {
  const entries = await listDir(projectRoot);
  return entries
    .filter((entry) => entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
}

// Specialist gap scan (#160): frameworks/languages detected in the repo with
// no matching specialist agent in the catalog.
export function detectSpecialistGaps({ languages = [], frameworks = [] }, agentNames = []) {
  const haystack = agentNames.map((name) => String(name).toLowerCase());
  const covered = (needle) => haystack.some((name) => name.includes(needle));
  const gaps = [];
  for (const { language } of languages) {
    if (!covered(language)) gaps.push({ kind: 'language', name: language });
  }
  for (const { framework } of frameworks) {
    if (!covered(framework)) gaps.push({ kind: 'framework', name: framework });
  }
  return gaps;
}

export async function scanRepository(projectRoot) {
  const [toolchain, docs, tests, ci, deploy, topLevelDirs] = await Promise.all([
    detectToolchain(projectRoot),
    detectDocs(projectRoot),
    detectTests(projectRoot),
    detectCi(projectRoot),
    detectDeploy(projectRoot),
    detectStructure(projectRoot),
  ]);
  return { projectRoot, toolchain, docs, tests, ci, deploy, topLevelDirs };
}
