#!/usr/bin/env node
// validate-readme-catalog.mjs — parity checker between catalog/packs.json (the
// FIRST-PARTY pack catalog) and the two skill tables the README hand-maintains.
//
// Why this gate exists: the README's "What Aeon can do" section carries two
// tables and three headline counts that are really just catalog/packs.json data
// pasted in by hand — the 6-row summary table's Skills column, the <details>
// "Full catalog" table (every pack's full skill list), the "Six packs ship in
// the box" hero line, and the "all N skills by pack" caption. packs.json itself
// is already gated (ci-packs-json.yml regenerates it from SKILL.md frontmatter),
// but NOTHING checked that the README kept up. So a new skill lands, packs.json
// regenerates in the same PR, CI is green — and the README's full-catalog table
// silently omits it. That is not hypothetical: docs/CONFIGURATION.md drifted the
// exact same way (a featured MCP server was added to the catalog but never to the
// doc's list).
//
// This is the first-party sibling of validate-skill-packs.mjs, which does the
// same README-parity job for the COMMUNITY registry (catalog/skill-packs.json)
// and its "N community skill packs" counter. The two deliberately don't overlap:
// that one owns the "## Community Packs" 3-column table, this one owns the
// first-party summary (4-column) and full-catalog (2-column) tables. Together
// with ci-packs-json.yml / ci-skills-json.yml (which gate the JSON itself), every
// place the skill catalog is written down is now drift-checked.
//
// What it enforces (all hard failures):
//   1. SUMMARY TABLE  (| Pack | Key | Skills | Examples |) — every pack key in
//      packs.json appears once with the right Skills count, and each curated
//      example slug actually belongs to that pack.
//   2. FULL CATALOG   (<details> | Pack | Skills |) — every pack row's `(key, N)`
//      count matches, and its backtick-listed slug SET equals packs.json exactly
//      (a missing/added/renamed skill is the failure this is really here for).
//   3. HEADLINE COUNTS — "Six packs ship in the box" == total_packs and
//      "all N skills by pack" == total_skills. Both are only enforced when the
//      sentence is present and parseable, so a future reword can't false-fail
//      (same posture as the community counter in the sibling).
//
//   4. SKILL COUNTS  - every "N skills" / "N+ skills" claim and every
//      "all-N-skills-by-pack" link anchor, in the README and the docs/assets
//      that repeat the total (docs/skill-packs.md, docs/aeon-setup.md,
//      docs/examples/README.md, the hero SVG), must equal total_skills. A
//      rounded "60+ skills" always fails; that floor is how these drifted.
//
// Sections 1-3 run over every Markdown file in that list, so the full-catalog
// table that moved from the README to docs/skill-packs.md is checked there.
//
// Deliberately NOT enforced: the packs' prose descriptions and the "shown by
// default" annotations (editorial, not derivable from packs.json), and the exact
// slug ORDER in the full-catalog table (set equality is what matters).
//
// Usage:
//   node scripts/validate-readme-catalog.mjs
//   node scripts/validate-readme-catalog.mjs --packs <path> --readme <path>   # fixture overrides, for tests
//   node scripts/validate-readme-catalog.mjs ... --docs <path>,<path>         # extra files to check (fixtures)
//
// Exit 1 on any violation; exit 0 (with `validate-readme-catalog: OK`) otherwise.

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ---- args ----
const args = process.argv.slice(2)
const opt = (flag, fallback) => {
  const i = args.indexOf(flag)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}
const PACKS = opt('--packs', resolve(ROOT, 'catalog/packs.json'))
const README = opt('--readme', resolve(ROOT, '.github/README.md'))
// Other committed files that restate the catalog (tables, "N skills" counts,
// the "all-N-skills-by-pack" anchor). --docs a,b,c overrides the list; a
// fixture run that passes --readme without --docs checks the README alone.
const DEFAULT_DOCS = [
  'docs/skill-packs.md',
  'docs/aeon-setup.md',
  'docs/examples/README.md',
  'docs/assets/hero-animated.svg',
].map((p) => resolve(ROOT, p))
const docsArg = opt('--docs', null)
const DOCS = docsArg !== null
  ? docsArg.split(',').filter(Boolean).map((p) => resolve(p))
  : args.includes('--readme') ? [] : DEFAULT_DOCS
const FILES = [README, ...DOCS]

const errors = []
const warnings = []
const err = (m) => errors.push(m)
const warn = (m) => warnings.push(m)

const done = (summary) => {
  for (const w of warnings) console.warn(`validate-readme-catalog: WARN ${w}`)
  if (errors.length) {
    for (const e of errors) console.error(`::error::validate-readme-catalog: ${e}`)
    console.error('')
    console.error(`validate-readme-catalog: FAIL — ${errors.length} violation(s).`)
    console.error('The README/docs skill tables and counts mirror catalog/packs.json (regenerated by bin/generate-packs-json).')
    console.error('Update the flagged file(s) to match, then re-run: node scripts/validate-readme-catalog.mjs')
    process.exit(1)
  }
  console.log(`validate-readme-catalog: OK — ${summary}` + (warnings.length ? ` (${warnings.length} warning(s))` : ''))
  process.exit(0)
}

// number word -> value, enough to cover any plausible pack count.
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']

// ---- load the first-party catalog ----
if (!existsSync(PACKS)) {
  console.error(`::error::validate-readme-catalog: packs catalog not found at ${PACKS}`)
  process.exit(1)
}
let packs
try {
  packs = JSON.parse(readFileSync(PACKS, 'utf8'))
} catch (e) {
  console.error(`::error::validate-readme-catalog: ${PACKS} is not valid JSON: ${e.message}`)
  process.exit(1)
}
if (!Array.isArray(packs?.packs)) {
  console.error(`::error::validate-readme-catalog: ${PACKS} has no \`packs\` array`)
  process.exit(1)
}

// key -> { count, slugs:Set }, in catalog order for stable messages.
const catalog = new Map()
for (const p of packs.packs) {
  if (typeof p?.key !== 'string') continue
  const slugs = Array.isArray(p.skills) ? p.skills.map((s) => (typeof s === 'string' ? s : s?.slug)).filter(Boolean) : []
  catalog.set(p.key, { count: slugs.length, slugs: new Set(slugs) })
}
const totalPacks = typeof packs.total_packs === 'number' ? packs.total_packs : catalog.size
const totalSkills = typeof packs.total_skills === 'number'
  ? packs.total_skills
  : [...catalog.values()].reduce((n, p) => n + p.count, 0)

const cellsOf = (line) => line.split('|').slice(1, -1).map((c) => c.trim())
const isSeparator = (line) => /^\|[\s:|-]+\|$/.test(line)

// Which of the table/headline checks found their target in at least one file.
// A check that matched nowhere warns once instead of once per file.
const found = { summary: false, full: false, packsWord: false, allN: false }

// Sections 1-3 run over every Markdown file (the README plus the docs that took
// over its tables, e.g. docs/skill-packs.md's full catalog). Each file gets the
// same checks; a table/caption that isn't in a given file is simply skipped.
function checkMarkdown(file) {
  const where = rel(file)
  const text = readFileSync(file, 'utf8')
  const lines = text.split(/\r?\n/)

  // Find the data rows of the first table whose header matches `headerRe`, at or
  // after line index `from`. Returns [{cells, line}], or null if no such header.
  function tableRows(headerRe, from = 0) {
    const h = lines.slice(from).findIndex((l) => headerRe.test(l))
    if (h === -1) return null
    const header = from + h
    const rows = []
    for (let i = header + 1; i < lines.length; i++) {
      const line = lines[i]
      if (!line.startsWith('|')) break
      if (isSeparator(line)) continue
      rows.push({ cells: cellsOf(line), line: i + 1 })
    }
    return rows
  }

  // ---- 1. summary table: | Pack | Key | Skills | Examples | ----
  const summary = tableRows(/^\|\s*Pack\s*\|\s*Key\s*\|\s*Skills\s*\|\s*Examples\s*\|/i)
  if (summary) {
    found.summary = true
    const seen = new Set()
    for (const { cells, line } of summary) {
      if (cells.length < 4) continue
      const key = cells[1].replace(/`/g, '').trim()
      if (!catalog.has(key)) {
        err(`summary table lists pack \`${key}\` which is not in ${rel(PACKS)} (${where}:${line})`)
        continue
      }
      seen.add(key)
      const cat = catalog.get(key)
      const claimed = Number.parseInt(cells[2], 10)
      if (!Number.isInteger(claimed)) {
        err(`summary table Skills column for \`${key}\` is not a number ("${cells[2]}", ${where}:${line})`)
      } else if (claimed !== cat.count) {
        err(`summary table says \`${key}\` has ${claimed} skills but the catalog has ${cat.count} (${where}:${line})`)
      }
      // Each curated example must actually be in that pack.
      for (const ex of [...cells[3].matchAll(/`([^`]+)`/g)].map((m) => m[1])) {
        if (!cat.slugs.has(ex)) {
          err(`summary table lists \`${ex}\` as a \`${key}\` example, but it's not in that pack (${where}:${line})`)
        }
      }
    }
    for (const key of catalog.keys()) {
      if (!seen.has(key)) err(`summary table in ${where} is missing a row for pack \`${key}\``)
    }
  }

  // ---- 2. full-catalog table: | Pack | Skills | ----
  // Anchored after the "Full catalog" heading/summary so the 2-column header
  // can't be confused with the 4-column summary table above it.
  const detailsAt = lines.findIndex((l) => /Full catalog/i.test(l))
  const full = tableRows(/^\|\s*Pack\s*\|\s*Skills\s*\|\s*$/i, detailsAt === -1 ? 0 : detailsAt)
  if (full) {
    found.full = true
    const seen = new Set()
    for (const { cells, line } of full) {
      if (cells.length < 2) continue
      const m = cells[0].match(/\(`([a-z0-9-]+)`,\s*(\d+)\)/i)
      if (!m) {
        err(`full-catalog row has no \`(\`key\`, N)\` marker - "${cells[0]}" (${where}:${line})`)
        continue
      }
      const key = m[1]
      if (!catalog.has(key)) {
        err(`full-catalog table lists pack \`${key}\` which is not in ${rel(PACKS)} (${where}:${line})`)
        continue
      }
      seen.add(key)
      const cat = catalog.get(key)
      const claimed = Number.parseInt(m[2], 10)
      if (claimed !== cat.count) {
        err(`full-catalog table says \`${key}\` has ${claimed} skills but the catalog has ${cat.count} (${where}:${line})`)
      }
      const listed = new Set([...cells[1].matchAll(/`([^`]+)`/g)].map((mm) => mm[1]))
      const missing = [...cat.slugs].filter((s) => !listed.has(s))
      const extra = [...listed].filter((s) => !cat.slugs.has(s))
      if (missing.length) err(`full-catalog table for \`${key}\` is missing: ${missing.join(', ')} (${where}:${line})`)
      if (extra.length) err(`full-catalog table for \`${key}\` lists skills not in the pack: ${extra.join(', ')} (${where}:${line})`)
    }
    for (const key of catalog.keys()) {
      if (!seen.has(key)) err(`full-catalog table in ${where} is missing a row for pack \`${key}\``)
    }
  }

  // ---- 3. headline counts (enforced only when present + parseable) ----
  const packsWord = text.match(/\*\*(\w+)\s+packs ship in the box\*\*/i)
  if (packsWord) {
    found.packsWord = true
    const val = NUMBER_WORDS.indexOf(packsWord[1].toLowerCase())
    const expected = NUMBER_WORDS[totalPacks]
    if (val === -1) {
      warn(`${where} says "${packsWord[1]} packs ship in the box" - can't map that number word; expected "${expected ?? totalPacks}"`)
    } else if (val !== totalPacks) {
      err(`${where} says "${packsWord[1]} packs ship in the box" but the catalog has ${totalPacks} pack(s) - reword to "${expected ?? totalPacks}"`)
    }
  }

  for (const m of text.matchAll(/all\s+(\d+)\s+skills by pack/gi)) {
    found.allN = true
    if (Number(m[1]) !== totalSkills) {
      err(`caption says "all ${m[1]} skills by pack" but the catalog has ${totalSkills} - update it (${where}:${lineAt(text, m.index)})`)
    }
  }
}

// ---- 4. whole-catalog skill counts in prose, alt text and images ----
// "60+ skills across 9 harnesses", "Aeon ships **85 skills**", the hero SVG's
// "85 skills" bubble, and the "#full-catalog-all-N-skills-by-pack" anchor all
// restate catalog.total_skills by hand. Rules:
//   - "N+ skills" always fails: a rounded floor is exactly how these drifted
//     (it said 60+ while the catalog was 85). Write the exact count.
//   - "N skills" fails when N is bigger than the largest pack (so it can only be
//     a whole-catalog claim) and isn't the real total. Smaller numbers are
//     per-pack or example prose ("the 12 Core skills", "2 skills") and are left
//     alone. "all N skills by pack" is owned by section 3 above.
//   - Any "all-N-skills-by-pack" link anchor must use the real total, or the
//     link silently stops resolving when the heading is updated.
const maxPack = Math.max(0, ...[...catalog.values()].map((p) => p.count))
function checkCounts(file) {
  const where = rel(file)
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(/(?<!all\s)\b(\d+)(\+?)\s+skills\b/gi)) {
    const n = Number(m[1])
    const at = `${where}:${lineAt(text, m.index)}`
    if (m[2]) {
      err(`"${m[0]}" is a rounded count - write the exact catalog total "${totalSkills} skills" (${at})`)
    } else if (n > maxPack && n !== totalSkills) {
      err(`"${m[0]}" but the catalog has ${totalSkills} skills - update the count (${at})`)
    }
  }
  for (const m of text.matchAll(/all-(\d+)-skills-by-pack/gi)) {
    if (Number(m[1]) !== totalSkills) {
      err(`link anchor "${m[0]}" is stale - the heading is "all ${totalSkills} skills by pack" (${where}:${lineAt(text, m.index)})`)
    }
  }
}

function lineAt(text, index) {
  return text.slice(0, index).split('\n').length
}

function rel(p) {
  return p.startsWith(ROOT) ? p.slice(ROOT.length + 1) : p
}

for (const file of FILES) {
  if (!existsSync(file)) {
    err(`${rel(file)} not found - drop it from the checked files in scripts/validate-readme-catalog.mjs if it moved`)
    continue
  }
  if (file.endsWith('.md')) checkMarkdown(file)
  checkCounts(file)
}

if (!found.summary) warn('no "| Pack | Key | Skills | Examples |" summary table found - summary parity unchecked')
if (!found.full) warn('no "Full catalog" | Pack | Skills | table found - full-catalog parity unchecked')
if (!found.packsWord) warn('no "**N packs ship in the box**" hero line - pack-count parity unchecked')
if (!found.allN) warn('no "all N skills by pack" caption - skill-count parity unchecked')

done(`${totalPacks} pack(s) / ${totalSkills} skill(s) match the tables and skill counts in ${FILES.map(rel).join(', ')}`)
