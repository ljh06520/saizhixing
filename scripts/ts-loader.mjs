import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
const nativeRequire = createRequire(import.meta.url);
export function makeLoader(overrides = {}) {
  const cache = new Map();
  function load(file) {
    const absolute = path.resolve(file); if (cache.has(absolute)) return cache.get(absolute).exports;
    const source = fs.readFileSync(absolute, 'utf8');
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    const record = { exports: {} }; cache.set(absolute, record);
    new Function('exports', 'module', 'require', outputText)(record.exports, record, name => {
      if (name in overrides) return overrides[name];
      if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
      if (name.startsWith('.')) return load(path.resolve(path.dirname(absolute), name + (name.endsWith('.ts') ? '' : '.ts')));
      return nativeRequire(name);
    }); return record.exports;
  } return load;
}
