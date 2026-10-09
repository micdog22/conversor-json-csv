import { jsonToCsv, csvToJson, decodeBytes, JsonError, CsvError, BOM, DELIMITER_NAMES } from './convert.js';

const STORAGE_KEY = 'conversor-json-csv:opcoes';
const AUTO_LIMIT = 1500000; // acima disso (em caracteres), converte só pelo botão
const MAX_FILE = 30 * 1024 * 1024;

const SAMPLE = `[
  {
    "nome": "Maria Exemplo",
    "email": "maria@example.com",
    "idade": 34,
    "ativo": true,
    "endereco": { "cidade": "Campinas", "uf": "SP" },
    "tags": ["cliente", "vip"],
    "saldo": 1234.50
  },
  {
    "nome": "João Exemplo",
    "email": "joao@example.com",
    "idade": 28,
    "ativo": false,
    "endereco": { "cidade": "Recife", "uf": "PE" },
    "tags": [],
    "saldo": null
  },
  {
    "nome": "Lanchonete Exemplo",
    "email": "contato@example.com",
    "ativo": true,
    "endereco": { "cidade": "Porto Alegre", "uf": "RS" },
    "tags": ["fornecedor"],
    "saldo": 89.90,
    "observacao": "Entregas às terças; \\"urgente\\" só por telefone"
  }
]`;

const KIND_TEXT = {
  array: () => 'lista de objetos',
  jsonl: () => 'JSON Lines',
  single: () => 'objeto único',
  rows: () => 'lista de listas (sem cabeçalho)',
  object: (keyName) => `objeto de objetos (as chaves foram para a coluna “${keyName}”)`,
};

const $ = (id) => document.getElementById(id);
const els = {
  json: $('json'), csv: $('csv'), msgJson: $('msg-json'), msgCsv: $('msg-csv'),
  paneJson: $('pane-json'), paneCsv: $('pane-csv'), fileJson: $('file-json'), fileCsv: $('file-csv'),
  preview: $('preview'), previewInfo: $('preview-info'),
  oDelim: $('o-delim'), oArrays: $('o-arrays'), oEol: $('o-eol'), oBom: $('o-bom'), oDecimal: $('o-decimal'), oFormulas: $('o-formulas'),
  iDelim: $('i-delim'), iOutput: $('i-output'), iHeader: $('i-header'), iInfer: $('i-infer'), iBr: $('i-br'), iNested: $('i-nested'), iPretty: $('i-pretty'),
};
const OPTION_IDS = ['o-delim', 'o-arrays', 'o-eol', 'o-bom', 'o-decimal', 'o-formulas', 'i-delim', 'i-output', 'i-header', 'i-infer', 'i-br', 'i-nested', 'i-pretty'];

const state = { source: 'json', baseName: 'dados', jsonExt: 'json', timer: 0, notes: { json: '', csv: '' } };

// O <textarea> troca CRLF por LF; guardamos o texto exato para copiar e baixar sem perder o fim de linha.
const exact = { json: { text: '', shown: null }, csv: { text: '', shown: null } };
const areaOf = (pane) => (pane === 'json' ? els.json : els.csv);

function setPane(pane, text) {
  const area = areaOf(pane);
  area.value = text;
  exact[pane] = { text, shown: area.value };
}

function paneText(pane) {
  const area = areaOf(pane);
  return area.value === exact[pane].shown ? exact[pane].text : area.value;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

const fmt = (n) => n.toLocaleString('pt-BR');
const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many}`;
const delimValue = (v) => (v === 'tab' ? '\t' : v);

// ---------- opções ----------

function saveOptions() {
  const data = {};
  for (const id of OPTION_IDS) {
    const input = $(id);
    data[id] = input.type === 'checkbox' ? input.checked : input.value;
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* armazenamento indisponível */ }
}

function loadOptions() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { data = null; }
  if (!data) return;
  for (const id of OPTION_IDS) {
    const input = $(id);
    if (!(id in data)) continue;
    if (input.type === 'checkbox') input.checked = Boolean(data[id]);
    else if ([...input.options].some((o) => o.value === data[id])) input.value = data[id];
  }
}

function csvOptions() {
  return {
    delimiter: delimValue(els.oDelim.value),
    arrays: els.oArrays.value,
    eol: els.oEol.value === 'lf' ? '\n' : '\r\n',
    decimalComma: els.oDecimal.checked,
    protectFormulas: els.oFormulas.checked,
  };
}

function jsonOptions() {
  return {
    delimiter: delimValue(els.iDelim.value),
    output: els.iOutput.value,
    header: els.iHeader.checked,
    infer: els.iInfer.checked,
    brNumbers: els.iBr.checked,
    nested: els.iNested.checked,
    pretty: els.iPretty.checked,
  };
}

// ---------- mensagens e prévia ----------

function positionOf(text, line, column) {
  let pos = 0;
  for (let l = 1; l < line; l++) {
    const next = text.indexOf('\n', pos);
    if (next === -1) break;
    pos = next + 1;
  }
  return Math.min(pos + Math.max(column - 1, 0), text.length);
}

function goTo(textarea, pos) {
  textarea.focus();
  textarea.setSelectionRange(pos, Math.min(pos + 1, textarea.value.length));
}

function setMsg(pane, ...nodes) {
  const box = pane === 'json' ? els.msgJson : els.msgCsv;
  const note = state.notes[pane];
  box.replaceChildren(...nodes, ...(note ? [el('p', { class: 'note', text: note })] : []));
}

function showError(pane, title, message, pos) {
  const textarea = areaOf(pane);
  const box = el('div', { class: 'err' }, el('strong', { text: `${title} ` }), message);
  if (pos >= 0) {
    const button = el('button', { type: 'button', class: 'btn secondary small', text: 'Mostrar no texto' });
    button.addEventListener('click', () => goTo(textarea, pos));
    box.append(el('br'), button);
  }
  setMsg(pane, box);
}

function renderPreview(preview, total) {
  els.preview.replaceChildren();
  if (!preview || (!preview.rows.length && !preview.header.length)) {
    els.previewInfo.textContent = 'Sem dados para mostrar.';
    return;
  }
  const headRow = el('tr', {}, el('th', { scope: 'col', text: '#' }));
  for (const name of preview.header) headRow.append(el('th', { scope: 'col', text: name }));
  const tbody = el('tbody');
  preview.rows.forEach((row, idx) => {
    const tr = el('tr', {}, el('th', { scope: 'row', text: String(idx + 1) }));
    for (let c = 0; c < preview.header.length; c++) {
      const value = row[c] ?? '';
      tr.append(el('td', value === '' ? { class: 'empty' } : { text: value.length > 300 ? `${value.slice(0, 300)}…` : value }));
    }
    tbody.append(tr);
  });
  els.preview.append(el('thead', {}, headRow), tbody);
  els.previewInfo.textContent = total > preview.rows.length
    ? `Mostrando as primeiras ${fmt(preview.rows.length)} de ${plural(total, 'linha', 'linhas')}.`
    : `${plural(total, 'linha', 'linhas')} de dados.`;
}

// ---------- conversões ----------

function convertToCsv() {
  state.source = 'json';
  try {
    const r = jsonToCsv(paneText('json'), csvOptions());
    setPane('csv', r.csv);
    setMsg('json', el('p', { class: 'ok', text: `${plural(r.rowCount, 'registro', 'registros')} · ${plural(r.columnCount, 'coluna', 'colunas')} · ${KIND_TEXT[r.kind](r.keyName)}` }));
    state.notes.csv = '';
    setMsg('csv');
    renderPreview(r.preview, r.rowCount);
  } catch (err) {
    if (!(err instanceof JsonError)) throw err;
    if (err.code === 'empty') {
      setMsg('json', el('p', { class: 'muted', text: err.message }));
      return;
    }
    showError('json', 'JSON inválido.', err.message, positionOf(els.json.value, err.line, err.column));
  }
}

function convertToJson() {
  state.source = 'csv';
  const options = jsonOptions();
  try {
    const r = csvToJson(paneText('csv'), options);
    setPane('json', r.json);
    state.jsonExt = options.output === 'jsonl' ? 'jsonl' : 'json';
    const detected = options.delimiter === 'auto' ? ' (detectado)' : '';
    setMsg('csv', el('p', { class: 'ok', text: `Delimitador: ${DELIMITER_NAMES[r.delimiter]}${detected} · ${plural(r.rowCount, 'registro', 'registros')} · ${plural(r.columnCount, 'coluna', 'colunas')}` }));
    state.notes.json = '';
    setMsg('json');
    renderPreview(r.preview, r.rowCount);
  } catch (err) {
    if (!(err instanceof CsvError)) throw err;
    if (!err.line) {
      setMsg('csv', el('p', { class: 'muted', text: err.message }));
      return;
    }
    showError('csv', 'CSV inválido.', err.message, positionOf(els.csv.value, err.line, 1));
  }
}

function rerun() {
  if (state.source === 'json') convertToCsv();
  else convertToJson();
}

function schedule(source) {
  state.source = source;
  state.notes[source] = '';
  clearTimeout(state.timer);
  if (areaOf(source).value.length > AUTO_LIMIT) {
    const button = source === 'json' ? 'JSON → CSV' : 'CSV → JSON';
    setMsg(source, el('p', { class: 'muted', text: `Texto grande: clique em “${button}” para converter.` }));
    return;
  }
  state.timer = setTimeout(rerun, 250);
}

// ---------- arquivos, cópia e download ----------

function guessPane(name) {
  if (/\.(csv|tsv)$/i.test(name)) return 'csv';
  if (/\.(json|jsonl|ndjson)$/i.test(name)) return 'json';
  return null;
}

async function loadFile(file, fallbackPane) {
  const pane = guessPane(file.name) ?? fallbackPane;
  if (file.size > MAX_FILE) {
    setMsg(pane, el('div', { class: 'err' }, el('strong', { text: 'Arquivo grande demais. ' }), `O limite para converter no navegador é de ${MAX_FILE / 1024 / 1024} MB.`));
    return;
  }
  const { text, encoding } = decodeBytes(new Uint8Array(await file.arrayBuffer()));
  state.baseName = file.name.replace(/\.[^.]+$/, '') || 'dados';
  if (pane === 'json') state.jsonExt = /\.(jsonl|ndjson)$/i.test(file.name) ? 'jsonl' : 'json';
  state.notes = { json: '', csv: '' };
  state.notes[pane] = encoding === 'UTF-8' ? '' : `O arquivo “${file.name}” foi lido como ${encoding}.`;
  setPane(pane, text);
  if (pane === 'json') convertToCsv();
  else convertToJson();
}

function download(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = el('a', { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function csvForExport() {
  const text = paneText('csv');
  const edited = els.csv.value !== exact.csv.shown;
  return edited && els.oEol.value === 'crlf' ? text.replace(/\r?\n/g, '\r\n') : text;
}

async function copy(pane) {
  const text = pane === 'json' ? paneText('json') : csvForExport();
  try {
    await navigator.clipboard.writeText(text);
    setMsg(pane, el('p', { class: 'ok', text: 'Copiado para a área de transferência.' }));
  } catch {
    setMsg(pane, el('p', { class: 'muted', text: 'Não foi possível copiar automaticamente. Selecione o texto e copie manualmente.' }));
  }
}

function clearPane(pane) {
  const textarea = areaOf(pane);
  setPane(pane, '');
  state.notes[pane] = '';
  setMsg(pane);
  if (state.source === pane) renderPreview(null, 0);
  textarea.focus();
}

function bindDrop(section, pane) {
  const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files');
  section.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    section.classList.add('dragover');
  });
  section.addEventListener('dragleave', (event) => {
    if (!section.contains(event.relatedTarget)) section.classList.remove('dragover');
  });
  section.addEventListener('drop', (event) => {
    section.classList.remove('dragover');
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer.files[0];
    if (file) loadFile(file, pane);
  });
}

function init() {
  if (window.matchMedia('(max-width: 700px)').matches) $('options').open = false;
  loadOptions();
  setPane('json', SAMPLE);

  els.json.addEventListener('input', () => schedule('json'));
  els.csv.addEventListener('input', () => schedule('csv'));
  $('to-csv').addEventListener('click', convertToCsv);
  $('to-json').addEventListener('click', convertToJson);
  for (const id of OPTION_IDS) {
    $(id).addEventListener('change', () => {
      saveOptions();
      rerun();
    });
  }
  $('preset-excel').addEventListener('click', () => {
    els.oDelim.value = ';';
    els.oEol.value = 'crlf';
    els.oDecimal.checked = true;
    els.oBom.checked = true;
    saveOptions();
    convertToCsv();
  });
  $('sample-json').addEventListener('click', () => {
    setPane('json', SAMPLE);
    state.baseName = 'dados';
    state.jsonExt = 'json';
    state.notes = { json: '', csv: '' };
    convertToCsv();
  });
  for (const pane of ['json', 'csv']) {
    $(`copy-${pane}`).addEventListener('click', () => copy(pane));
    $(`clear-${pane}`).addEventListener('click', () => clearPane(pane));
    const input = pane === 'json' ? els.fileJson : els.fileCsv;
    input.addEventListener('change', () => {
      if (input.files[0]) loadFile(input.files[0], pane);
      input.value = '';
    });
  }
  $('down-json').addEventListener('click', () => {
    const ext = state.jsonExt;
    download(paneText('json'), `${state.baseName}.${ext}`, ext === 'jsonl' ? 'application/x-ndjson' : 'application/json');
  });
  $('down-csv').addEventListener('click', () => {
    const tab = state.source === 'json' && els.oDelim.value === 'tab';
    download((els.oBom.checked ? BOM : '') + csvForExport(), `${state.baseName}.${tab ? 'tsv' : 'csv'}`, 'text/csv;charset=utf-8');
  });
  bindDrop(els.paneJson, 'json');
  bindDrop(els.paneCsv, 'csv');
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) loadFile(file, 'json');
  });
  convertToCsv();
}

init();
