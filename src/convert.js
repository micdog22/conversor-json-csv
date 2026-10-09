// Núcleo do Conversor JSON ↔ CSV. Sem DOM: é este módulo que os testes importam.

export const BOM = '\uFEFF';

const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// Atribuição que não deixa a chave "__proto__" mexer no protótipo do objeto.
function setOwn(obj, key, value) {
  if (key === '__proto__') {
    Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
  } else {
    obj[key] = value;
  }
}

// ---------- JSON ----------

// Número JSON guardado exatamente como foi escrito (ex.: "10.50", inteiros enormes).
export class RawNumber {
  constructor(raw) { this.raw = raw; }
  toString() { return this.raw; }
}

export class JsonError extends Error {
  constructor(detail, line, column, position, code = '') {
    super(code === 'empty' ? detail : `Linha ${line}, coluna ${column}: ${detail}`);
    this.name = 'JsonError';
    this.detail = detail;
    this.line = line;
    this.column = column;
    this.position = position;
    this.code = code;
  }
}

function lineCol(text, pos) {
  let line = 1;
  let lastBreak = -1;
  for (let i = 0; i < pos; i++) {
    if (text.charCodeAt(i) === 10) { line++; lastBreak = i; }
  }
  return { line, column: pos - lastBreak };
}

const isDigit = (ch) => ch >= '0' && ch <= '9';
const LITERALS = [['true', true], ['false', false], ['null', null]];

export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof RawNumber);
}

export function parseJson(text) {
  let i = 0;
  const n = text.length;
  const fail = (detail, pos = i, code = '') => {
    const { line, column } = lineCol(text, pos);
    throw new JsonError(detail, line, column, pos, code);
  };
  const skip = () => {
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 32 || c === 10 || c === 13 || c === 9) i++;
      else break;
    }
  };
  const unexpected = (context) => {
    const ch = text[i];
    if (ch === undefined) fail(`o texto terminou antes do fim do JSON: ${context}.`);
    if (ch === "'") fail('use aspas duplas ("), não aspas simples.');
    if (ch === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) fail('o JSON não aceita comentários.');
    fail(`caractere inesperado “${ch}”: ${context}.`);
  };

  function parseString() {
    const start = i;
    i++;
    let out = '';
    let chunk = i;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 34) {
        out += text.slice(chunk, i);
        i++;
        return out;
      }
      if (c === 92) {
        out += text.slice(chunk, i);
        const e = text[i + 1];
        switch (e) {
          case '"': out += '"'; break;
          case '\\': out += '\\'; break;
          case '/': out += '/'; break;
          case 'b': out += '\b'; break;
          case 'f': out += '\f'; break;
          case 'n': out += '\n'; break;
          case 'r': out += '\r'; break;
          case 't': out += '\t'; break;
          case 'u': {
            const hex = text.slice(i + 2, i + 6);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('sequência \\u inválida: use 4 dígitos hexadecimais.');
            out += String.fromCharCode(parseInt(hex, 16));
            i += 4;
            break;
          }
          default:
            fail(`sequência de escape inválida “\\${e ?? ''}”.`);
        }
        i += 2;
        chunk = i;
        continue;
      }
      if (c < 32) fail(c === 10 ? 'quebra de linha dentro de um texto: feche as aspas ou use \\n.' : 'caractere de controle dentro de um texto.');
      i++;
    }
    return fail('texto sem as aspas de fechamento.', start);
  }

  function parseNumber() {
    const start = i;
    if (text[i] === '-') i++;
    if (text[i] === '0') {
      i++;
      if (isDigit(text[i])) fail('números não podem ter zeros à esquerda (use texto entre aspas, como "007").', start);
    } else if (isDigit(text[i])) {
      while (isDigit(text[i])) i++;
    } else {
      fail('número inválido.', start);
    }
    if (text[i] === '.') {
      i++;
      if (!isDigit(text[i])) fail('número inválido: faltam dígitos depois do ponto.', start);
      while (isDigit(text[i])) i++;
    }
    if (text[i] === 'e' || text[i] === 'E') {
      i++;
      if (text[i] === '+' || text[i] === '-') i++;
      if (!isDigit(text[i])) fail('número inválido: expoente sem dígitos.', start);
      while (isDigit(text[i])) i++;
    }
    const raw = text.slice(start, i);
    const num = Number(raw);
    return String(num) === raw ? num : new RawNumber(raw);
  }

  function parseObject() {
    const obj = {};
    let lastComma = -1;
    i++;
    skip();
    if (text[i] === '}') { i++; return obj; }
    for (;;) {
      skip();
      if (text[i] !== '"') {
        if (text[i] === '}' && lastComma >= 0) fail('vírgula sobrando antes de “}”.', lastComma);
        if (/[A-Za-z_$]/.test(text[i] ?? '')) fail('o nome da propriedade precisa estar entre aspas duplas.');
        unexpected('esperava o nome de uma propriedade entre aspas duplas');
      }
      const key = parseString();
      skip();
      if (text[i] !== ':') unexpected('esperava “:” depois do nome da propriedade');
      i++;
      setOwn(obj, key, parseValue());
      skip();
      if (text[i] === ',') { lastComma = i; i++; continue; }
      if (text[i] === '}') { i++; return obj; }
      if (text[i] === '"') fail('falta uma vírgula antes desta propriedade.');
      unexpected('esperava “,” ou “}”');
    }
  }

  function parseArray() {
    const arr = [];
    let lastComma = -1;
    i++;
    skip();
    if (text[i] === ']') { i++; return arr; }
    for (;;) {
      skip();
      if (text[i] === ']' && lastComma >= 0) fail('vírgula sobrando antes de “]”.', lastComma);
      arr.push(parseValue());
      skip();
      if (text[i] === ',') { lastComma = i; i++; continue; }
      if (text[i] === ']') { i++; return arr; }
      if (/["{[\-0-9tfn]/.test(text[i] ?? '')) fail('falta uma vírgula antes deste item.');
      unexpected('esperava “,” ou “]”');
    }
  }

  function parseValue() {
    skip();
    const ch = text[i];
    if (ch === '{') return parseObject();
    if (ch === '[') return parseArray();
    if (ch === '"') return parseString();
    if (ch === '-' || isDigit(ch)) return parseNumber();
    for (const [word, value] of LITERALS) {
      if (text.startsWith(word, i)) { i += word.length; return value; }
    }
    const word = /^[A-Za-z_]+/.exec(text.slice(i, i + 24));
    if (word) {
      const w = word[0];
      if (['NaN', 'Infinity', 'undefined'].includes(w)) fail(`“${w}” não é um valor JSON; use null.`);
      if (/^(true|false|null)$/i.test(w)) fail('escreva true, false e null em minúsculas.');
      fail(`“${w}” não é um valor JSON: textos precisam estar entre aspas duplas.`);
    }
    return unexpected('esperava um valor (texto, número, objeto, lista, true, false ou null)');
  }

  const value = parseValue();
  skip();
  if (i < n) fail('há conteúdo depois do fim do JSON. Se forem vários registros, um por linha, use o formato JSON Lines.', i, 'extra');
  return value;
}

export function stringifyJson(value) {
  if (value === null || value === undefined) return 'null';
  if (value instanceof RawNumber) return value.raw;
  if (Array.isArray(value)) return `[${value.map(stringifyJson).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value).map((k) => `${JSON.stringify(k)}:${stringifyJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// Lê JSON comum ou JSON Lines e devolve a lista de registros.
export function readJsonInput(text) {
  const src = stripBom(text);
  if (!src.trim()) throw new JsonError('Cole ou abra um JSON.', 1, 1, 0, 'empty');
  try {
    return classify(parseJson(src));
  } catch (err) {
    if (err instanceof RangeError) throw new JsonError('o JSON tem níveis demais de aninhamento.', 1, 1, 0);
    if (!(err instanceof JsonError) || err.code !== 'extra') throw err;
    const lines = src.split('\n');
    const records = [];
    let firstLine = true;
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li].replace(/\r$/, '');
      if (!line.trim()) continue;
      try {
        records.push(parseJson(line));
      } catch (lineErr) {
        if (!(lineErr instanceof JsonError) || firstLine) throw err;
        throw new JsonError(`(JSON Lines) ${lineErr.detail}`, li + 1, lineErr.column, -1);
      }
      firstLine = false;
    }
    return { kind: 'jsonl', records };
  }
}

function classify(value) {
  if (Array.isArray(value)) {
    if (value.length && value.every(Array.isArray)) return { kind: 'rows', records: value };
    return { kind: 'array', records: value };
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length && keys.every((k) => isPlainObject(value[k]))) {
      let keyName = 'chave';
      while (keys.some((k) => hasOwn(value[k], keyName))) keyName = `_${keyName}`;
      return { kind: 'object', keyName, records: keys.map((k) => ({ [keyName]: k, ...value[k] })) };
    }
  }
  return { kind: 'single', records: [value] };
}

// ---------- JSON → CSV ----------

export function flatten(value, arrays = 'json', prefix = '', out = []) {
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (!keys.length) {
      if (prefix) out.push([prefix, value]);
      return out;
    }
    for (const k of keys) flatten(value[k], arrays, prefix ? `${prefix}.${k}` : k, out);
  } else if (Array.isArray(value) && arrays === 'index' && value.length) {
    value.forEach((item, idx) => flatten(item, arrays, `${prefix}.${idx}`, out));
  } else {
    out.push([prefix, value]);
  }
  return out;
}

const isEmptyStructure = (v) => (Array.isArray(v) && !v.length) || (isPlainObject(v) && !Object.keys(v).length);

function formatCell(value, opts) {
  if (value === null || value === undefined) return { text: '', quote: false };
  if (value === '') return { text: '', quote: true }; // "" (texto vazio) é diferente de vazio (null)
  if (typeof value === 'boolean') return { text: String(value), quote: false };
  if (typeof value === 'number' || value instanceof RawNumber) {
    const text = String(value);
    return { text: opts.decimalComma ? text.replace('.', ',') : text, quote: false };
  }
  if (typeof value === 'string') {
    if (opts.protectFormulas && /^[=+\-@\t\r]/.test(value)) return { text: `'${value}`, quote: false };
    return { text: value, quote: false };
  }
  return { text: stringifyJson(value), quote: false };
}

export function quoteCsv(text, delimiter, force = false) {
  if (force || text.includes(delimiter) || /["\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export const DEFAULT_TO_CSV = {
  delimiter: ',', arrays: 'json', eol: '\r\n', bom: false, decimalComma: false, protectFormulas: false,
};

export function jsonToCsv(text, options = {}) {
  const o = { ...DEFAULT_TO_CSV, ...options };
  const { kind, records, keyName } = readJsonInput(text);
  let header = null;
  let body;
  if (kind === 'rows') {
    body = records.map((row) => row.map((v) => formatCell(v, o)));
  } else {
    const maps = records.map((rec) => new Map(isPlainObject(rec) ? flatten(rec, o.arrays) : flatten(rec, o.arrays, 'valor')));
    // Um {} ou [] vazio não vira coluna se outros registros têm subcolunas com o mesmo prefixo.
    const parents = new Set();
    for (const m of maps) {
      for (const key of m.keys()) {
        for (let p = key.lastIndexOf('.'); p > 0; p = key.lastIndexOf('.', p - 1)) parents.add(key.slice(0, p));
      }
    }
    const columns = [];
    const seen = new Set();
    for (const m of maps) {
      for (const [key, value] of m) {
        if (parents.has(key) && isEmptyStructure(value)) { m.delete(key); continue; }
        if (!seen.has(key)) { seen.add(key); columns.push(key); }
      }
    }
    header = columns;
    body = maps.map((m) => columns.map((c) => (m.has(c) ? formatCell(m.get(c), o) : { text: '', quote: false })));
  }
  const d = o.delimiter;
  const lines = [];
  if (header) lines.push(header.map((h) => quoteCsv(formatCell(h, o).text, d)).join(d));
  for (const row of body) lines.push(row.map((c) => quoteCsv(c.text, d, c.quote)).join(d));
  const width = header ? header.length : body.reduce((w, r) => Math.max(w, r.length), 0);
  return {
    csv: (o.bom ? BOM : '') + lines.join(o.eol),
    kind,
    keyName,
    rowCount: body.length,
    columnCount: width,
    preview: {
      header: header ?? Array.from({ length: width }, (_, k) => `Coluna ${k + 1}`),
      rows: body.slice(0, 100).map((r) => r.map((c) => c.text)),
    },
  };
}

// ---------- CSV ----------

export class CsvError extends Error {
  constructor(message, line = 0) {
    super(message);
    this.name = 'CsvError';
    this.line = line;
  }
}

function countBreaks(s) {
  let count = 0;
  for (let k = s.indexOf('\n'); k !== -1; k = s.indexOf('\n', k + 1)) count++;
  return count;
}

// Leitor RFC 4180: aspas, aspas duplicadas, quebras de linha dentro de campos, CRLF/LF/CR.
// Devolve também quais campos vazios vieram entre aspas ("") para distinguir texto vazio de nulo.
export function parseCsv(input, delimiter = ',', { tolerant = false, maxRows = Infinity } = {}) {
  const text = stripBom(input);
  const n = text.length;
  const rows = [];
  const quotedEmpty = new Set();
  let row = [];
  let i = 0;
  let line = 1;
  const isEnd = (ch) => ch === delimiter || ch === '\n' || ch === '\r';
  const pushRow = () => {
    const blank = row.length === 1 && row[0] === '' && !quotedEmpty.has(`${rows.length}:0`);
    if (!blank) rows.push(row);
    row = [];
  };
  while (i < n && rows.length < maxRows) {
    let value;
    if (text[i] === '"') {
      const startLine = line;
      let j = i + 1;
      let out = '';
      let closed = false;
      while (!closed) {
        const q = text.indexOf('"', j);
        if (q === -1) {
          if (tolerant) return { rows, quotedEmpty };
          throw new CsvError(`As aspas abertas na linha ${startLine} não foram fechadas.`, startLine);
        }
        const chunk = text.slice(j, q);
        out += chunk;
        line += countBreaks(chunk);
        if (text[q + 1] === '"') {
          out += '"';
          j = q + 2;
        } else {
          j = q + 1;
          closed = true;
        }
      }
      let k = j;
      while (k < n && !isEnd(text[k])) k++;
      value = out + text.slice(j, k); // texto depois das aspas de fechamento é mantido (leitura tolerante)
      if (value === '') quotedEmpty.add(`${rows.length}:${row.length}`);
      i = k;
    } else {
      let k = i;
      while (k < n && !isEnd(text[k])) k++;
      value = text.slice(i, k);
      i = k;
    }
    row.push(value);
    if (i >= n) break;
    if (text[i] === delimiter) {
      i++;
      if (i >= n) row.push('');
      continue;
    }
    i += text[i] === '\r' && text[i + 1] === '\n' ? 2 : 1;
    line++;
    pushRow();
  }
  if (row.length) pushRow();
  return { rows, quotedEmpty };
}

export const DELIMITERS = [',', ';', '\t', '|'];

export function detectDelimiter(text) {
  const sample = stripBom(text).slice(0, 100000);
  const cut = sample.length < stripBom(text).length;
  let best = ',';
  let bestScore = 0;
  for (const d of DELIMITERS) {
    let { rows } = parseCsv(sample, d, { tolerant: true, maxRows: 50 });
    if (cut && rows.length > 1) rows = rows.slice(0, -1);
    if (!rows.length) continue;
    const freq = new Map();
    for (const r of rows) freq.set(r.length, (freq.get(r.length) || 0) + 1);
    let mode = 0;
    let modeFreq = 0;
    for (const [count, f] of freq) {
      if (f > modeFreq || (f === modeFreq && count > mode)) { mode = count; modeFreq = f; }
    }
    if (mode < 2) continue;
    const score = (modeFreq / rows.length) * 1000 + Math.min(mode, 100);
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

const STD_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const BR_NUMBER = /^-?(?:0|[1-9]\d{0,2}(?:\.\d{3})+|[1-9]\d*)(?:,\d+)?$/;

export function inferValue(raw, { brNumbers = false, quoted = false } = {}) {
  if (raw === '') return quoted ? '' : null;
  const t = raw.trim();
  if (/^(?:true|false)$/i.test(t)) return t.toLowerCase() === 'true';
  if (brNumbers ? BR_NUMBER.test(t) : STD_NUMBER.test(t)) {
    // Mais de 15 dígitos perderia precisão (ex.: códigos e identificadores): fica como texto.
    if (t.replace(/[eE].*$/, '').replace(/\D/g, '').length > 15) return raw;
    return Number(brNumbers ? t.replace(/\./g, '').replace(',', '.') : t);
  }
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try { return JSON.parse(t); } catch { /* não é JSON: fica como texto */ }
  }
  return raw;
}

export function makeHeader(cells) {
  const used = new Set();
  return cells.map((cell, idx) => {
    const base = (cell ?? '').trim() || `coluna${idx + 1}`;
    let name = base;
    for (let k = 2; used.has(name); k++) name = `${base}_${k}`;
    used.add(name);
    return name;
  });
}

// Decide, uma vez por cabeçalho, quais colunas viram caminhos aninhados.
export function planNesting(columns) {
  const names = new Set(columns);
  return columns.map((col) => {
    const parts = col.split('.');
    if (parts.length < 2 || parts.includes('')) return null;
    for (let k = 1; k < parts.length; k++) {
      if (names.has(parts.slice(0, k).join('.'))) return null; // "a" e "a.b" juntos: "a.b" fica plano
    }
    return parts;
  });
}

function arrayify(node, created) {
  for (const key of Object.keys(node)) {
    if (created.has(node[key])) setOwn(node, key, arrayify(node[key], created));
  }
  const keys = Object.keys(node);
  if (keys.length && keys.every((k, idx) => k === String(idx))) return keys.map((k) => node[k]);
  return node;
}

export function unflatten(entries, plan = planNesting(entries.map(([k]) => k))) {
  const root = {};
  const created = new Set();
  entries.forEach(([key, value], idx) => {
    const path = plan[idx];
    if (!path) { setOwn(root, key, value); return; }
    let node = root;
    for (let k = 0; k < path.length - 1; k++) {
      const part = path[k];
      if (!hasOwn(node, part)) {
        const child = {};
        created.add(child);
        setOwn(node, part, child);
      }
      node = node[part];
    }
    setOwn(node, path[path.length - 1], value);
  });
  for (const key of Object.keys(root)) {
    if (created.has(root[key])) setOwn(root, key, arrayify(root[key], created));
  }
  return root;
}

export const DEFAULT_TO_JSON = {
  delimiter: 'auto', header: true, infer: true, brNumbers: false, nested: true, output: 'array', pretty: true,
};

export function csvToJson(text, options = {}) {
  const o = { ...DEFAULT_TO_JSON, ...options };
  const clean = stripBom(text);
  if (!clean.trim()) throw new CsvError('Cole ou abra um CSV.');
  const delimiter = o.delimiter === 'auto' ? detectDelimiter(clean) : o.delimiter;
  const { rows, quotedEmpty } = parseCsv(clean, delimiter);
  let width = 0;
  for (const r of rows) width = Math.max(width, r.length);
  const cell = (r, c) => {
    const raw = rows[r][c] ?? '';
    if (!o.infer) return raw;
    return inferValue(raw, { brNumbers: o.brNumbers, quoted: quotedEmpty.has(`${r}:${c}`) });
  };

  let columns;
  let records;
  let dataStart;
  if (o.header && rows.length) {
    const headerCells = Array.from({ length: width }, (_, c) => rows[0][c] ?? '');
    columns = makeHeader(headerCells);
    const plan = o.nested ? planNesting(columns) : null;
    records = [];
    for (let r = 1; r < rows.length; r++) {
      const entries = columns.map((name, c) => [name, cell(r, c)]);
      records.push(plan ? unflatten(entries, plan) : Object.fromEntries(entries));
    }
    dataStart = 1;
  } else {
    columns = Array.from({ length: width }, (_, c) => `Coluna ${c + 1}`);
    records = rows.map((row, r) => row.map((_, c) => cell(r, c)));
    dataStart = 0;
  }
  const json = o.output === 'jsonl'
    ? records.map((rec) => JSON.stringify(rec)).join('\n')
    : JSON.stringify(records, null, o.pretty ? 2 : 0);
  return {
    json,
    records,
    delimiter,
    rowCount: records.length,
    columnCount: width,
    preview: { header: columns, rows: rows.slice(dataStart, dataStart + 100) },
  };
}

// ---------- arquivos ----------

// Decodifica bytes de arquivo: UTF-8 (com ou sem BOM), UTF-16 com BOM ou, se não for UTF-8 válido,
// Windows-1252 (comum em CSVs salvos por versões antigas do Excel).
export function decodeBytes(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0xff && b[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(b), encoding: 'UTF-16' };
  if (b[0] === 0xfe && b[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(b), encoding: 'UTF-16' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(b), encoding: 'UTF-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(b), encoding: 'Windows-1252' };
  }
}

export const DELIMITER_NAMES = { ',': 'vírgula', ';': 'ponto e vírgula', '\t': 'tabulação', '|': 'barra vertical' };
