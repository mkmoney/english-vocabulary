#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const sources = [
  {
    file: "1 初中-乱序.txt",
    level: "junior",
    bookId: "junior",
    title: "初中核心词库",
    description: "初中英语词库。",
    tags: ["初中", "基础"],
  },
  {
    file: "2 高中-乱序.txt",
    level: "high_school",
    bookId: "high_school",
    title: "高中核心词库",
    description: "高中英语词库。",
    tags: ["高中", "高频"],
  },
  {
    file: "3 四级-乱序.txt",
    level: "cet4",
    bookId: "cet4",
    title: "四级词库",
    description: "大学英语四级词库。",
    tags: ["四级", "考试"],
  },
  {
    file: "4 六级-乱序.txt",
    level: "cet6",
    bookId: "cet6",
    title: "六级词库",
    description: "大学英语六级词库。",
    tags: ["六级", "考试"],
  },
  {
    file: "5 考研-乱序.txt",
    level: "kaoyan",
    bookId: "kaoyan",
    title: "考研强化词库",
    description: "考研英语词库。",
    tags: ["考研", "强化"],
  },
  {
    file: "6 托福-乱序.txt",
    level: "toefl",
    bookId: "toefl",
    title: "托福词库",
    description: "托福考试词库。",
    tags: ["托福", "考试"],
  },
  {
    file: "7 SAT-乱序.txt",
    level: "sat",
    bookId: "sat",
    title: "SAT 词库",
    description: "SAT 考试词库。",
    tags: ["SAT", "考试"],
  },
  {
    file: "8 雅思-乱序.txt",
    level: "ielts",
    bookId: "ielts",
    title: "雅思进阶词库",
    description: "雅思考试词库。",
    tags: ["雅思", "考试"],
  },
];

const badWords = new Set([
  "a.",
  "adj.",
  "adv.",
  "conj.",
  "int.",
  "n.",
  "num.",
  "prep.",
  "pron.",
  "v.",
  "vi.",
  "vt.",
]);
const invalidPhonetics = new Set(["unknown", "n/a", "na", "none", "-", "--"]);
const cjkPattern = /[\u3400-\u9fff]/;

function parseArgs(argv) {
  const args = {
    out: path.join(repoRoot, "redflix-vocab-import.sql"),
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") {
      args.out = path.resolve(process.cwd(), argv[index + 1]);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/generate-redflix-vocab-import-sql.mjs [--out ./redflix-vocab-import.sql]

Reads:
  1 初中-乱序.txt ... 8 雅思-乱序.txt
  vocab-phonetics.txt

Writes SQL for REDFLIX tables:
  vocab_entries
  vocab_entry_levels
  vocab_books`);
}

function normalizeWord(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeMeaning(value) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\t/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePhonetic(value) {
  const phonetic = String(value ?? "").trim();
  if (!phonetic) return "";
  if (cjkPattern.test(phonetic)) return "";
  if (invalidPhonetics.has(phonetic.toLowerCase())) return "";
  return phonetic;
}

function isValidWord(word) {
  if (!word) return false;
  if (word.length > 255) return false;
  if (!/[a-z]/i.test(word)) return false;
  if (cjkPattern.test(word)) return false;
  if (word.includes(":")) return false;
  if (badWords.has(word)) return false;
  return true;
}

function readPhonetics() {
  const filePath = path.join(repoRoot, "vocab-phonetics.txt");
  const map = new Map();
  if (!fs.existsSync(filePath)) return map;

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) continue;

    const word = normalizeWord(line.slice(0, separatorIndex));
    const phonetic = normalizePhonetic(line.slice(separatorIndex + 1));
    if (isValidWord(word) && phonetic && !map.has(word)) {
      map.set(word, phonetic);
    }
  }

  return map;
}

function parseSource(source) {
  const filePath = path.join(repoRoot, source.file);
  const rows = [];
  const skipped = [];

  for (const [lineIndex, line] of fs.readFileSync(filePath, "utf8").split(/\r?\n/).entries()) {
    if (!line.trim()) continue;

    const tabIndex = line.indexOf("\t");
    if (tabIndex <= 0) {
      skipped.push({ line: lineIndex + 1, reason: "missing-tab", content: line });
      continue;
    }

    const word = normalizeWord(line.slice(0, tabIndex));
    const meaning = normalizeMeaning(line.slice(tabIndex + 1));
    if (!isValidWord(word)) {
      skipped.push({ line: lineIndex + 1, reason: "invalid-word", content: line });
      continue;
    }
    if (!meaning) {
      skipped.push({ line: lineIndex + 1, reason: "missing-meaning", content: line });
      continue;
    }

    rows.push({ word, meaning, level: source.level });
  }

  return { rows, skipped };
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function dollarQuote(value) {
  const text = String(value);
  let tag = "$json$";
  let counter = 0;
  while (text.includes(tag)) {
    counter += 1;
    tag = `$json${counter}$`;
  }
  return `${tag}${text}${tag}`;
}

function sqlJson(value) {
  return `${dollarQuote(JSON.stringify(value))}::jsonb`;
}

function buildImportSql({ entries, levels, books, badWordsToDelete }) {
  const lines = [];

  lines.push("-- Generated by scripts/generate-redflix-vocab-import-sql.mjs");
  lines.push("-- Import target: REDFLIX vocab_entries / vocab_entry_levels / vocab_books");
  lines.push("BEGIN;");
  lines.push("");
  lines.push(`CREATE TABLE IF NOT EXISTS vocab_entries (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  word varchar(255) NOT NULL UNIQUE,
  phonetic varchar(255),
  meaning text NOT NULL
);`);
  lines.push("CREATE INDEX IF NOT EXISTS vocab_entries_word_idx ON vocab_entries USING btree (word);");
  lines.push("");
  lines.push(`CREATE TABLE IF NOT EXISTS vocab_entry_levels (
  entry_id integer NOT NULL,
  level varchar(50) NOT NULL,
  CONSTRAINT vocab_entry_levels_entry_id_level_pk PRIMARY KEY (entry_id, level)
);`);
  lines.push(
    "CREATE INDEX IF NOT EXISTS vocab_entry_levels_level_idx ON vocab_entry_levels USING btree (level);"
  );
  lines.push("");
  lines.push(`CREATE TABLE IF NOT EXISTS vocab_books (
  book_id varchar(50) PRIMARY KEY,
  title varchar(255) NOT NULL,
  description text,
  level varchar(50) NOT NULL,
  tags jsonb,
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);`);
  lines.push("");

  lines.push("-- Remove known malformed rows from source txt files.");
  lines.push(`DELETE FROM vocab_entry_levels
USING vocab_entries
WHERE vocab_entry_levels.entry_id = vocab_entries.id
  AND vocab_entries.word IN (${badWordsToDelete.map((word) => `'${word.replaceAll("'", "''")}'`).join(", ")});`);
  lines.push(
    `DELETE FROM vocab_entries WHERE word IN (${badWordsToDelete
      .map((word) => `'${word.replaceAll("'", "''")}'`)
      .join(", ")});`
  );
  lines.push("");

  lines.push("-- Remove stale rows that are no longer present in the current source txt files.");
  lines.push("CREATE TEMP TABLE redflix_vocab_import_words (word text PRIMARY KEY) ON COMMIT DROP;");
  for (const chunk of chunkArray(entries.map((entry) => ({ word: entry.word })), 1000)) {
    lines.push(`INSERT INTO redflix_vocab_import_words (word)
SELECT word
FROM jsonb_to_recordset(${sqlJson(chunk)}) AS mapped(word text)
ON CONFLICT (word) DO NOTHING;`);
  }
  lines.push(`DELETE FROM vocab_entry_levels
USING vocab_entries
WHERE vocab_entry_levels.entry_id = vocab_entries.id
  AND NOT EXISTS (
    SELECT 1 FROM redflix_vocab_import_words
    WHERE redflix_vocab_import_words.word = vocab_entries.word
  );`);
  lines.push(`DELETE FROM vocab_entries
WHERE NOT EXISTS (
  SELECT 1 FROM redflix_vocab_import_words
  WHERE redflix_vocab_import_words.word = vocab_entries.word
);`);
  lines.push("");

  lines.push("-- Remove stale level relations that are no longer present in the current source txt files.");
  lines.push("CREATE TEMP TABLE redflix_vocab_import_levels (word text NOT NULL, level text NOT NULL, PRIMARY KEY (word, level)) ON COMMIT DROP;");
  for (const chunk of chunkArray(levels, 1000)) {
    lines.push(`INSERT INTO redflix_vocab_import_levels (word, level)
SELECT word, level
FROM jsonb_to_recordset(${sqlJson(chunk)}) AS mapped(word text, level text)
ON CONFLICT (word, level) DO NOTHING;`);
  }
  lines.push(`DELETE FROM vocab_entry_levels
USING vocab_entries
WHERE vocab_entry_levels.entry_id = vocab_entries.id
  AND NOT EXISTS (
    SELECT 1 FROM redflix_vocab_import_levels
    WHERE redflix_vocab_import_levels.word = vocab_entries.word
      AND redflix_vocab_import_levels.level = vocab_entry_levels.level
  );`);
  lines.push("");

  lines.push("-- Upsert vocab entries. Meaning uses the first occurrence across the 8 source files.");
  for (const chunk of chunkArray(entries, 1000)) {
    lines.push(`INSERT INTO vocab_entries (word, phonetic, meaning)
SELECT word, NULLIF(phonetic, ''), meaning
FROM jsonb_to_recordset(${sqlJson(chunk)}) AS mapped(word text, phonetic text, meaning text)
ON CONFLICT (word) DO UPDATE SET
  phonetic = COALESCE(EXCLUDED.phonetic, vocab_entries.phonetic),
  meaning = EXCLUDED.meaning;`);
  }
  lines.push("");

  lines.push("-- Upsert level relations. One word can belong to multiple levels.");
  for (const chunk of chunkArray(levels, 1000)) {
    lines.push(`INSERT INTO vocab_entry_levels (entry_id, level)
SELECT vocab_entries.id, mapped.level
FROM jsonb_to_recordset(${sqlJson(chunk)}) AS mapped(word text, level text)
INNER JOIN vocab_entries ON vocab_entries.word = mapped.word
ON CONFLICT (entry_id, level) DO NOTHING;`);
  }
  lines.push("");

  lines.push("-- Upsert vocab books.");
  lines.push(`INSERT INTO vocab_books (book_id, title, description, level, tags, is_visible, updated_at)
SELECT book_id, title, description, level, tags, is_visible, updated_at
FROM jsonb_to_recordset(${sqlJson(books)}) AS mapped(
  book_id text,
  title text,
  description text,
  level text,
  tags jsonb,
  is_visible boolean,
  updated_at timestamptz
)
ON CONFLICT (book_id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  level = EXCLUDED.level,
  tags = EXCLUDED.tags,
  is_visible = EXCLUDED.is_visible,
  updated_at = EXCLUDED.updated_at;`);
  lines.push("");
  lines.push("COMMIT;");
  lines.push("");

  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv);
  const phonetics = readPhonetics();
  const entriesByWord = new Map();
  const levelKeys = new Set();
  const levels = [];
  const skippedByFile = [];
  const sourceCounts = [];

  for (const source of sources) {
    const { rows, skipped } = parseSource(source);
    sourceCounts.push({ file: source.file, level: source.level, rows: rows.length });
    skippedByFile.push({ file: source.file, skipped });

    for (const row of rows) {
      if (!entriesByWord.has(row.word)) {
        entriesByWord.set(row.word, {
          word: row.word,
          phonetic: phonetics.get(row.word) ?? null,
          meaning: row.meaning,
        });
      }

      const levelKey = `${row.word}\u0000${row.level}`;
      if (!levelKeys.has(levelKey)) {
        levelKeys.add(levelKey);
        levels.push({ word: row.word, level: row.level });
      }
    }
  }

  const now = new Date().toISOString();
  const books = sources.map((source) => ({
    book_id: source.bookId,
    title: source.title,
    description: source.description,
    level: source.level,
    tags: source.tags,
    is_visible: true,
    updated_at: now,
  }));
  const entries = Array.from(entriesByWord.values()).sort((a, b) => a.word.localeCompare(b.word));
  levels.sort((a, b) => a.level.localeCompare(b.level) || a.word.localeCompare(b.word));

  const sql = buildImportSql({
    entries,
    levels,
    books,
    badWordsToDelete: Array.from(badWords),
  });

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, sql, "utf8");

  const skipped = skippedByFile.flatMap((item) =>
    item.skipped.map((skippedItem) => ({ file: item.file, ...skippedItem }))
  );
  console.log(`Wrote ${args.out}`);
  console.log(`entries=${entries.length}`);
  console.log(`level_relations=${levels.length}`);
  console.log(`books=${books.length}`);
  console.log(`phonetics=${entries.filter((entry) => entry.phonetic).length}`);
  console.log(`skipped=${skipped.length}`);
  for (const item of sourceCounts) {
    console.log(`${item.level}: ${item.rows} source rows`);
  }
  if (skipped.length > 0) {
    console.log("Skipped malformed rows:");
    for (const item of skipped.slice(0, 20)) {
      console.log(`- ${item.file}:${item.line} ${item.reason}: ${item.content}`);
    }
    if (skipped.length > 20) {
      console.log(`... ${skipped.length - 20} more`);
    }
  }
}

main();
