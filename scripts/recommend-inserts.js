#!/usr/bin/env node
/**
 * scripts/recommend-inserts.js — PROTOTYPE
 *
 * Given a keyword or type name (e.g. "publication", "donor browse page"),
 * recommend a set of item types worth pulling together as representative
 * test data — built entirely from the schemas already checked into your
 * local smaht-portal checkout, no portal API calls required.
 *
 * This does NOT pull anything. It only reads schema JSON files and prints a
 * plan for a human to review. Wiring this into `im pull` / imc is a
 * follow-on step, deliberately not done yet — see design.md.
 *
 * How it works (see README section this ships with for the full writeup):
 *   1. Parse every schema in {SMAHT_REPO_ROOT}/src/encoded/schemas/*.json,
 *      resolving `mixinProperties` $refs so mixin-only fields (like
 *      Publication's `static_content`, which lives in mixins.json, not in
 *      publication.json's own "properties") are not missed.
 *   2. Record every `linkTo` found anywhere in a schema's effective
 *      properties as a graph edge between two types. Schema-declared
 *      linkTo is bidirectional for traversal purposes (A links to B is
 *      also "B is referenced by A") even though only the forward direction
 *      is written down anywhere — this is what makes reverse relationships
 *      (e.g. finding Donor starting from ProtectedDonor) discoverable
 *      without needing to parse the Python `rev = {...}` calculated
 *      properties in types/*.py at all.
 *   3. Match the input keyword against type titles/descriptions/filenames
 *      to pick seed type(s), then walk 1 hop out from each seed along the
 *      edge graph (skipping a small admin/noise exclude list).
 *   4. For each recommended type, surface its schema `facets` block
 *      (including any declared numeric range buckets) and `columns` block
 *      — these are the portal's own curated "what matters for browsing
 *      this type" and "what's shown on its browse page" definitions, and
 *      double as a ready-made stratification scheme for a representative
 *      sample instead of guessing at which fields are demographically
 *      interesting.
 *
 * Usage:
 *   node scripts/recommend-inserts.js <keyword or type name>
 *   node scripts/recommend-inserts.js "donor browse page"
 *   node scripts/recommend-inserts.js publication
 *   node scripts/recommend-inserts.js --depth=2 tissue
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const REPO_ROOT = process.env.SMAHT_REPO_ROOT ?? path.join(os.homedir(), 'dbmi', 'smaht-portal');
const SCHEMAS_DIR = path.join(REPO_ROOT, 'src', 'encoded', 'schemas');

// Types that are structurally connected to almost everything (attribution,
// auth, admin bookkeeping) and would otherwise flood every recommendation.
// Heuristic and editable — see design.md "Open questions".
const NOISE_TYPES = new Set([
  'SubmissionCenter', 'Consortium', 'User', 'AccessKey', 'IngestionSubmission',
  'TrackingItem', 'FilterSet', 'HiglassViewConfig', 'GenericConfig',
  'GenericQcConfig', 'Software', 'Workflow', 'WorkflowRun', 'MetaWorkflow',
  'MetaWorkflowRun', 'QualityMetric', 'ExternalQualityMetric', 'FileFormat',
]);

// ── schema loading + $ref resolution ────────────────────────────────────────

const schemaCache = new Map();
function loadSchemaFile(filename) {
  if (schemaCache.has(filename)) return schemaCache.get(filename);
  const p = path.join(SCHEMAS_DIR, filename);
  let data = null;
  try { data = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { data = null; }
  schemaCache.set(filename, data);
  return data;
}

function resolvePointer(root, pointer) {
  if (!pointer || pointer === '/') return root;
  const parts = pointer.replace(/^\//, '').split('/').filter(Boolean);
  let cur = root;
  for (const part of parts) {
    if (cur == null) return null;
    cur = cur[part];
  }
  return cur;
}

/** Resolve a "$ref": "file.json#/pointer" into the referenced value, or null. */
function resolveRef(ref) {
  if (!ref || typeof ref !== 'string' || !ref.includes('.json')) return null;
  const [file, pointer] = ref.split('#');
  const data = loadSchemaFile(file);
  if (!data) return null;
  return resolvePointer(data, pointer ?? '');
}

/** filename (snake_case, no .json) -> PascalCase type name, e.g. protected_donor -> ProtectedDonor */
function toPascal(snake) {
  return snake.split(/[_-]/).filter(Boolean).map(s => s[0].toUpperCase() + s.slice(1)).join('');
}
/** PascalCase type name -> snake_case filename, e.g. ProtectedDonor -> protected_donor */
function toSnake(pascal) {
  return pascal.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2').toLowerCase();
}

/** Effective properties = own "properties" merged over resolved mixinProperties. */
function effectiveProperties(schema) {
  let merged = {};
  for (const entry of schema.mixinProperties ?? []) {
    const resolved = resolveRef(entry.$ref);
    if (resolved && typeof resolved === 'object') merged = { ...merged, ...resolved };
  }
  return { ...merged, ...(schema.properties ?? {}) };
}

/** Recursively find every {"linkTo": "SomeType"} anywhere under a properties tree. */
function findLinkTos(node, into, pathPrefix = '') {
  if (!node || typeof node !== 'object') return;
  if (typeof node.linkTo === 'string') into.push({ field: pathPrefix, target: node.linkTo });
  if (node.properties) {
    for (const [k, v] of Object.entries(node.properties)) findLinkTos(v, into, pathPrefix ? `${pathPrefix}.${k}` : k);
  }
  if (node.items) findLinkTos(node.items, into, pathPrefix);
}

// ── build the type registry + edge graph ────────────────────────────────────

function buildRegistry() {
  const files = fs.readdirSync(SCHEMAS_DIR).filter(f => f.endsWith('.json') && f !== 'mixins.json');
  const types = new Map(); // PascalName -> { file, title, description, facets, columns, schema }
  const edges = new Map(); // PascalName -> [{ field, target, via }]  (via: 'own-field' | 'referenced-by')
  const mixinSubtypes = new Map(); // PascalName (abstract) -> Set(PascalName concrete subtypes)

  for (const file of files) {
    const schema = loadSchemaFile(file);
    if (!schema) continue;
    const name = toPascal(file.replace(/\.json$/, ''));
    types.set(name, {
      file, name,
      title: schema.title ?? name,
      description: schema.description ?? '',
      facets: schema.facets ?? {},
      columns: schema.columns ?? {},
    });
    edges.set(name, []);

    // Track abstract-mixin relationships: if this schema's mixinProperties
    // pulls in another type's own "#/properties" wholesale, treat that as
    // "this type is a concrete form of that (possibly abstract) type".
    for (const entry of schema.mixinProperties ?? []) {
      const ref = entry.$ref ?? '';
      const m = ref.match(/^([a-z0-9_]+)\.json#\/properties$/);
      if (m && m[1] !== file.replace(/\.json$/, '')) {
        const parentName = toPascal(m[1]);
        if (!mixinSubtypes.has(parentName)) mixinSubtypes.set(parentName, new Set());
        mixinSubtypes.get(parentName).add(name);
      }
    }
  }

  // Second pass: now that every type is registered, walk effective
  // properties and record linkTo edges both forward and reverse.
  for (const [name, info] of types) {
    const schema = loadSchemaFile(info.file);
    const props = effectiveProperties(schema);
    const found = [];
    findLinkTos({ properties: props }, found);
    for (const { field, target } of found) {
      edges.get(name).push({ field, target, via: 'own-field' });
      if (!edges.has(target)) edges.set(target, []); // target may be abstract/unregistered
      edges.get(target).push({ field, target: name, via: 'referenced-by' });
    }
  }

  return { types, edges, mixinSubtypes };
}

// ── keyword matching ─────────────────────────────────────────────────────────

function tokenize(str) {
  return str.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function scoreType(info, queryTokens, queryRaw) {
  const nameSnake = toSnake(info.name).replace(/_/g, ' ');
  let score = 0;
  if (nameSnake === queryRaw.toLowerCase()) score += 20;
  if (info.title.toLowerCase() === queryRaw.toLowerCase()) score += 15;
  const titleTokens = new Set(tokenize(info.title));
  const nameTokens = new Set(tokenize(nameSnake));
  const descTokens = new Set(tokenize(info.description));
  for (const t of queryTokens) {
    if (nameTokens.has(t)) score += 6;
    if (titleTokens.has(t)) score += 5;
    if (descTokens.has(t)) score += 2;
  }
  return score;
}

function matchSeeds(types, query) {
  const queryTokens = tokenize(query);
  const scored = [...types.values()]
    .map(info => ({ info, score: scoreType(info, queryTokens, query) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return [];
  const top = scored[0].score;
  // Keep everything within a reasonable margin of the top score, capped.
  return scored.filter(s => s.score >= top * 0.5).slice(0, 5);
}

// ── recommendation ───────────────────────────────────────────────────────────

function recommend(query, depth = 1) {
  const { types, edges, mixinSubtypes } = buildRegistry();
  const seeds = matchSeeds(types, query);

  if (seeds.length === 0) {
    console.log(`No type matched "${query}". Known types include:\n  ${[...types.keys()].sort().join(', ')}`);
    return;
  }

  console.log(`\nQuery: "${query}"\n`);
  console.log('Matched seed type(s):');
  for (const { info, score } of seeds) {
    console.log(`  ${info.name}  (score ${score}) — ${info.description || info.title}`);
  }

  const included = new Map(); // name -> { hop, reasons: [...] }
  for (const { info } of seeds) included.set(info.name, { hop: 0, reasons: ['seed match'] });

  let frontier = seeds.map(s => s.info.name);
  for (let hop = 1; hop <= depth; hop++) {
    const next = [];
    for (const name of frontier) {
      for (const edge of edges.get(name) ?? []) {
        if (NOISE_TYPES.has(edge.target)) continue;
        if (edge.target === name) continue;
        const reason = edge.via === 'own-field'
          ? `${name}.${edge.field} -> ${edge.target}`
          : `${edge.target}.${edge.field} -> ${name} (reverse)`;
        if (!included.has(edge.target)) {
          included.set(edge.target, { hop, reasons: [reason] });
          next.push(edge.target);
        } else if (!included.get(edge.target).reasons.includes(reason)) {
          included.get(edge.target).reasons.push(reason);
        }
      }
    }
    frontier = next;
  }

  console.log(`\nRecommended pull set (depth=${depth}, admin/noise types excluded):\n`);
  for (const [name, meta] of included) {
    const info = types.get(name);
    console.log(`── ${name}${info ? ` (${info.title})` : ' [abstract/unregistered — see concrete forms below]'} ${meta.hop > 0 ? `— hop ${meta.hop}` : '— seed'}`);
    for (const r of meta.reasons) console.log(`     via ${r}`);

    const subtypes = mixinSubtypes.get(name);
    if (subtypes && subtypes.size > 0 && (!info || meta.hop > 0)) {
      console.log(`     concrete forms: ${[...subtypes].join(', ')}`);
    }

    if (info) {
      const facetEntries = Object.entries(info.facets);
      if (facetEntries.length) {
        console.log('     facets (candidate stratification axes for a representative sample):');
        for (const [field, f] of facetEntries) {
          const extra = f.aggregation_type === 'range' && f.ranges
            ? `  ranges: ${f.ranges.map(r => `${r.from ?? '-inf'}-${r.to ?? 'inf'}`).join(', ')}`
            : f.aggregation_type ? `  (${f.aggregation_type})` : '';
          console.log(`       ${field}${extra}`);
        }
      }
      const columns = Object.keys(info.columns);
      if (columns.length) console.log(`     browse-page columns: ${columns.join(', ')}`);
    }
    console.log('');
  }

  console.log('This is a plan, not a pull — nothing was fetched. Review the set above,');
  console.log('drop anything irrelevant, then compose `im pull --type X --type Y ...`');
  console.log('(optionally stratified using the facet fields listed) yourself.\n');
}

// ── main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  let depth = 1;
  const rest = [];
  for (const a of args) {
    if (a.startsWith('--depth=')) depth = Number(a.slice('--depth='.length)) || 1;
    else rest.push(a);
  }
  const query = rest.join(' ').trim();
  if (!query) {
    console.error('Usage: node scripts/recommend-inserts.js [--depth=N] <keyword or type name>');
    process.exit(1);
  }
  if (!fs.existsSync(SCHEMAS_DIR)) {
    console.error(`Schemas directory not found: ${SCHEMAS_DIR}\nSet SMAHT_REPO_ROOT to your smaht-portal checkout.`);
    process.exit(1);
  }
  recommend(query, depth);
}

main();
