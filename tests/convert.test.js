import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCsv, detectDelimiter, inferValue, jsonToCsv, csvToJson, readJsonInput, parseJson, flatten, unflatten,
  planNesting, makeHeader, decodeBytes, JsonError, CsvError, RawNumber, BOM,
} from '../src/convert.js';

const rows = (text, d = ',') => parseCsv(text, d).rows;

test('CSV: campos simples, CRLF, LF e CR', () => {
  assert.deepEqual(rows('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(rows('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(rows('x\ry\rz'), [['x'], ['y'], ['z']]);
});

test('CSV: aspas, aspas escapadas e quebras de linha dentro do campo', () => {
  assert.deepEqual(rows('nome,obs\n"Silva, Maria","disse ""oi""\r\ne saiu"'), [
    ['nome', 'obs'], ['Silva, Maria', 'disse "oi"\r\ne saiu'],
  ]);
  assert.deepEqual(rows('"a""b"'), [['a"b']]);
});

test('CSV: campos vazios, delimitador no fim e linhas em branco', () => {
  assert.deepEqual(rows('a,b,\n\n,\n'), [['a', 'b', ''], ['', '']]);
  assert.deepEqual(rows('a,b\n1'), [['a', 'b'], ['1']]);
  assert.deepEqual(rows(''), []);
});

test('CSV: distingue "" (texto vazio) de campo vazio', () => {
  const { rows: r, quotedEmpty } = parseCsv('a,b,c\n"",,x');
  assert.deepEqual(r[1], ['', '', 'x']);
  assert.ok(quotedEmpty.has('1:0'));
  assert.ok(!quotedEmpty.has('1:1'));
});

test('CSV: leitura tolerante de aspas fora do lugar', () => {
  assert.deepEqual(rows('ab"c,d'), [['ab"c', 'd']]);
  assert.deepEqual(rows('"abc"def,g'), [['abcdef', 'g']]);
});

test('CSV: aspas não fechadas geram erro com a linha', () => {
  assert.throws(() => parseCsv('a,b\n1,"aberto\n2,3'), (err) => err instanceof CsvError && err.line === 2 && /linha 2/.test(err.message));
});

test('CSV: remove o BOM do início', () => {
  assert.deepEqual(rows(`${BOM}a;b\r\n3;4`, ';'), [['a', 'b'], ['3', '4']]);
  const r = csvToJson(`${BOM}nome,idade\nAna,30`);
  assert.deepEqual(r.records, [{ nome: 'Ana', idade: 30 }]);
});

test('detecta o delimitador', () => {
  assert.equal(detectDelimiter('a,b,c\n1,2,3'), ',');
  assert.equal(detectDelimiter('nome;valor\nMaria;1.234,56\nJoão;10,00'), ';');
  assert.equal(detectDelimiter('a\tb\n1\t2'), '\t');
  assert.equal(detectDelimiter('a|b|c\n1|2|3'), '|');
  assert.equal(detectDelimiter('"Silva, Maria";SP\n"Souza, João";RJ'), ';');
  assert.equal(detectDelimiter('uma coluna\nvalor'), ',');
});

test('inferência de tipos', () => {
  assert.equal(inferValue('42'), 42);
  assert.equal(inferValue('-0.25'), -0.25);
  assert.equal(inferValue('1e3'), 1000);
  assert.equal(inferValue(' 42 '), 42);
  assert.equal(inferValue('007'), '007');
  assert.equal(inferValue('13480-000'), '13480-000');
  assert.equal(inferValue('12345678901234567890'), '12345678901234567890');
  assert.equal(inferValue('true'), true);
  assert.equal(inferValue('FALSE'), false);
  assert.equal(inferValue(''), null);
  assert.equal(inferValue('', { quoted: true }), '');
  assert.deepEqual(inferValue('[1,"a"]'), [1, 'a']);
  assert.deepEqual(inferValue('{"x":1}'), { x: 1 });
  assert.equal(inferValue('{não é json}'), '{não é json}');
  assert.equal(inferValue('1,5'), '1,5');
});

test('números no formato brasileiro', () => {
  const br = (v) => inferValue(v, { brNumbers: true });
  assert.equal(br('1.234,56'), 1234.56);
  assert.equal(br('1234,56'), 1234.56);
  assert.equal(br('1.234'), 1234);
  assert.equal(br('-1.234.567,8'), -1234567.8);
  assert.equal(br('0,5'), 0.5);
  assert.equal(br('1.000.000'), 1000000);
  assert.equal(br('12.34'), '12.34');
  assert.equal(br('01,5'), '01,5');
  assert.equal(br('123.456.789-09'), '123.456.789-09');
  const r = csvToJson('produto;preço\nCafé;1.234,56\nPão;0,75', { brNumbers: true });
  assert.deepEqual(r.records, [{ produto: 'Café', preço: 1234.56 }, { produto: 'Pão', preço: 0.75 }]);
});

test('JSON → CSV: achata objetos com ponto e mantém a ordem da primeira aparição', () => {
  const json = '[{"nome":"Ana","endereco":{"cidade":"Recife","uf":"PE"}},{"idade":30,"nome":"Bia","endereco":{"cep":"50000-000"}}]';
  const r = jsonToCsv(json, { eol: '\n' });
  assert.equal(r.csv, 'nome,endereco.cidade,endereco.uf,idade,endereco.cep\nAna,Recife,PE,,\nBia,,,30,50000-000');
  assert.equal(r.rowCount, 2);
  assert.equal(r.columnCount, 5);
});

test('JSON → CSV: listas como texto JSON ou em colunas indexadas', () => {
  const json = '[{"id":1,"itens":[{"sku":"A","qtd":2},{"sku":"B","qtd":1}],"tags":["x","y"]}]';
  assert.equal(jsonToCsv(json, { eol: '\n' }).csv,
    'id,itens,tags\n1,"[{""sku"":""A"",""qtd"":2},{""sku"":""B"",""qtd"":1}]","[""x"",""y""]"');
  assert.equal(jsonToCsv(json, { eol: '\n', arrays: 'index' }).csv,
    'id,itens.0.sku,itens.0.qtd,itens.1.sku,itens.1.qtd,tags.0,tags.1\n1,A,2,B,1,x,y');
});

test('JSON → CSV: aspas para delimitador, aspas e quebras de linha', () => {
  const json = JSON.stringify([{ a: 'x,y', b: 'diz "oi"', c: 'linha 1\nlinha 2', d: 'a;b' }]);
  assert.equal(jsonToCsv(json, { eol: '\n' }).csv, 'a,b,c,d\n"x,y","diz ""oi""","linha 1\nlinha 2",a;b');
  assert.equal(jsonToCsv(json, { eol: '\n', delimiter: ';' }).csv, 'a;b;c;d\nx,y;"diz ""oi""";"linha 1\nlinha 2";"a;b"');
  assert.equal(jsonToCsv('[{"a":"1\\t2","b":3}]', { delimiter: '\t' }).csv, 'a\tb\r\n"1\t2"\t3');
});

test('JSON → CSV: fim de linha, BOM, vírgula decimal e proteção contra fórmulas', () => {
  const json = '[{"produto":"Café","preco":12.50},{"produto":"=1+1","preco":-3}]';
  assert.equal(jsonToCsv(json).csv, 'produto,preco\r\nCafé,12.50\r\n=1+1,-3');
  assert.equal(jsonToCsv(json, { eol: '\n' }).csv, 'produto,preco\nCafé,12.50\n=1+1,-3');
  assert.ok(jsonToCsv(json, { bom: true }).csv.startsWith(`${BOM}produto`));
  assert.equal(jsonToCsv(json, { delimiter: ';', decimalComma: true, eol: '\n' }).csv, 'produto;preco\nCafé;12,50\n=1+1;-3');
  assert.equal(jsonToCsv(json, { decimalComma: true, eol: '\n' }).csv, 'produto,preco\nCafé,"12,50"\n=1+1,-3');
  assert.equal(jsonToCsv(json, { protectFormulas: true, eol: '\n' }).csv, "produto,preco\nCafé,12.50\n'=1+1,-3");
});

test('JSON → CSV: números exatamente como no JSON', () => {
  const r = jsonToCsv('[{"a":10.50,"b":12345678901234567890,"c":1E5,"d":-0,"e":0.1}]', { eol: '\n' });
  assert.equal(r.csv, 'a,b,c,d,e\n10.50,12345678901234567890,1E5,-0,0.1');
  assert.ok(parseJson('10.50') instanceof RawNumber);
  assert.equal(parseJson('42'), 42);
});

test('JSON → CSV: null vira campo vazio e "" vira ""', () => {
  assert.equal(jsonToCsv('[{"a":null,"b":"","c":false}]', { eol: '\n' }).csv, 'a,b,c\n,"",false');
});

test('JSON → CSV: objeto de objetos, lista de listas, valores simples e objeto único', () => {
  const objs = jsonToCsv('{"u1":{"nome":"Ana"},"u2":{"nome":"Bia","idade":20}}', { eol: '\n' });
  assert.equal(objs.kind, 'object');
  assert.equal(objs.csv, 'chave,nome,idade\nu1,Ana,\nu2,Bia,20');
  assert.equal(jsonToCsv('{"a":{"chave":1},"b":{"chave":2}}', { eol: '\n' }).csv, '_chave,chave\na,1\nb,2');
  const grid = jsonToCsv('[["nome","idade"],["Ana",30],["Bia",null]]', { eol: '\n' });
  assert.equal(grid.kind, 'rows');
  assert.equal(grid.csv, 'nome,idade\nAna,30\nBia,');
  assert.equal(jsonToCsv('[1,"dois",true]', { eol: '\n' }).csv, 'valor\n1\ndois\ntrue');
  assert.equal(jsonToCsv('{"nome":"Ana","idade":30}', { eol: '\n' }).csv, 'nome,idade\nAna,30');
});

test('JSON → CSV: um {} vazio não cria coluna em conflito com subcolunas', () => {
  const r = jsonToCsv('[{"end":{"cidade":"Natal"}},{"end":{}}]', { eol: '\n' });
  assert.equal(r.csv, 'end.cidade\nNatal\n');
  assert.equal(jsonToCsv('[{"meta":{}}]', { eol: '\n' }).csv, 'meta\n{}');
});

test('JSON Lines nas duas direções', () => {
  const jsonl = '{"nome":"Ana","idade":30}\n\n{"nome":"Bia","cidade":"Natal"}\r\n';
  const r = jsonToCsv(jsonl, { eol: '\n' });
  assert.equal(r.kind, 'jsonl');
  assert.equal(r.csv, 'nome,idade,cidade\nAna,30,\nBia,,Natal');
  const back = csvToJson(r.csv, { output: 'jsonl' });
  assert.equal(back.json, '{"nome":"Ana","idade":30,"cidade":null}\n{"nome":"Bia","idade":null,"cidade":"Natal"}');
  assert.throws(() => readJsonInput('{"a":1}\n{"b":2}\n{"c":'), (err) => err instanceof JsonError && err.line === 3 && /JSON Lines/.test(err.message));
});

test('CSV → JSON: cabeçalho, sem cabeçalho, nomes repetidos e vazios', () => {
  assert.deepEqual(csvToJson('a,b\n1,2', { header: false }).records, [['a', 'b'], [1, 2]]);
  assert.deepEqual(csvToJson('a,b\n1,2', { header: false, infer: false }).records, [['a', 'b'], ['1', '2']]);
  assert.deepEqual(makeHeader(['nome', 'nome', '', ' idade ', 'nome']), ['nome', 'nome_2', 'coluna3', 'idade', 'nome_3']);
  assert.deepEqual(csvToJson('x,y\n1,2,3').records, [{ x: 1, y: 2, coluna3: 3 }]);
  assert.deepEqual(csvToJson('x,y,z\n1').records, [{ x: 1, y: null, z: null }]);
  assert.deepEqual(csvToJson('x,y\n1,', { infer: false }).records, [{ x: '1', y: '' }]);
});

test('CSV → JSON: chaves com ponto viram objetos e índices viram listas', () => {
  const csv = 'id,endereco.cidade,endereco.uf,itens.0.sku,itens.1.sku,tags.0,tags.1\n7,Natal,RN,A,B,x,y';
  assert.deepEqual(csvToJson(csv).records, [{
    id: 7, endereco: { cidade: 'Natal', uf: 'RN' }, itens: [{ sku: 'A' }, { sku: 'B' }], tags: ['x', 'y'],
  }]);
  assert.deepEqual(csvToJson(csv, { nested: false }).records[0]['endereco.cidade'], 'Natal');
  assert.deepEqual(csvToJson('a,a.b,c.0,c.2\n1,2,3,4').records, [{ a: 1, 'a.b': 2, c: { 0: 3, 2: 4 } }]);
  assert.deepEqual(planNesting(['a', 'a.b', 'x.y', 'x..z', '.w']), [null, null, ['x', 'y'], null, null]);
});

test('CSV → JSON: saída em array (com ou sem recuo) e JSON Lines', () => {
  assert.equal(csvToJson('a\n1\n2', { pretty: false }).json, '[{"a":1},{"a":2}]');
  assert.equal(csvToJson('a\n1', { pretty: true }).json, '[\n  {\n    "a": 1\n  }\n]');
  assert.equal(csvToJson('a\n1\n2', { output: 'jsonl' }).json, '{"a":1}\n{"a":2}');
});

test('ida e volta: JSON → CSV → JSON preserva os dados', () => {
  const data = [
    { nome: 'Maria Exemplo', idade: 34, ativo: true, endereco: { cidade: 'Campinas', uf: 'SP' }, tags: ['cliente', 'vip'], saldo: 1234.5, obs: 'linha 1\nlinha 2, com "aspas"', vazio: '' },
    { nome: 'João Exemplo', idade: 28, ativo: false, endereco: { cidade: 'Recife', uf: 'PE' }, tags: [], saldo: null, obs: 'a;b', vazio: '' },
  ];
  const json = JSON.stringify(data);
  for (const delimiter of [',', ';', '\t']) {
    const csv = jsonToCsv(json, { delimiter }).csv;
    assert.deepEqual(csvToJson(csv, { delimiter: 'auto' }).records, data, `delimitador ${JSON.stringify(delimiter)}`);
  }
  const br = jsonToCsv(json, { delimiter: ';', decimalComma: true }).csv;
  assert.deepEqual(csvToJson(br, { brNumbers: true }).records, data);

  const uniform = [{ id: 1, itens: [{ sku: 'A', qtd: 2 }, { sku: 'B', qtd: 1 }] }, { id: 2, itens: [{ sku: 'C', qtd: 5 }, { sku: 'D', qtd: 3 }] }];
  const indexed = jsonToCsv(JSON.stringify(uniform), { arrays: 'index' }).csv;
  assert.deepEqual(csvToJson(indexed).records, uniform);
});

test('achatar e desachatar são inversos', () => {
  const obj = { a: 1, b: { c: 'x', d: { e: true } }, f: [10, 20] };
  const entries = flatten(obj, 'index');
  assert.deepEqual(entries, [['a', 1], ['b.c', 'x'], ['b.d.e', true], ['f.0', 10], ['f.1', 20]]);
  assert.deepEqual(unflatten(entries), obj);
});

function jsonError(text) {
  try {
    readJsonInput(text);
  } catch (err) {
    assert.ok(err instanceof JsonError);
    return err;
  }
  return assert.fail(`deveria falhar: ${text}`);
}

test('erros de JSON com linha, coluna e explicação', () => {
  let e = jsonError('[\n  {"a": 1,}\n]');
  assert.equal(e.line, 2); assert.equal(e.column, 10); assert.match(e.message, /^Linha 2, coluna 10: vírgula sobrando antes de “}”/);
  e = jsonError('[1, 2,]'); assert.match(e.message, /coluna 6: vírgula sobrando antes de “]”/);
  assert.match(jsonError("{'a': 1}").message, /aspas duplas/);
  assert.match(jsonError('{a: 1}').message, /nome da propriedade precisa estar entre aspas/);
  assert.match(jsonError('{"a": 1 "b": 2}').message, /falta uma vírgula/);
  assert.match(jsonError('[1 2]').message, /falta uma vírgula/);
  assert.match(jsonError('{"a": "sem fim}').message, /sem as aspas de fechamento/);
  assert.match(jsonError('{"a": "x\ny"}').message, /quebra de linha dentro de um texto/);
  assert.match(jsonError('// comentário\n{}').message, /não aceita comentários/);
  assert.match(jsonError('{"a": NaN}').message, /use null/);
  assert.match(jsonError('{"a": True}').message, /minúsculas/);
  assert.match(jsonError('{"a": 01}').message, /zeros à esquerda/);
  assert.match(jsonError('{"a": "\\x"}').message, /escape inválida/);
  assert.match(jsonError('{"a": 1').message, /terminou antes do fim/);
  assert.match(jsonError('{"a":1} lixo').message, /conteúdo depois do fim/);
  assert.equal(jsonError('   ').message, 'Cole ou abra um JSON.');
});

test('não permite poluição de protótipo', () => {
  const r = csvToJson('__proto__.poluido,constructor.prototype.x\nsim,1');
  assert.equal({}.poluido, undefined);
  assert.equal({}.x, undefined);
  assert.equal(Object.getPrototypeOf(r.records[0]), Object.prototype);
  assert.equal(r.records[0].__proto__.poluido, 'sim');
  const csv = jsonToCsv('[{"__proto__":{"a":1},"b":2}]', { eol: '\n' }).csv;
  assert.equal(csv, '__proto__.a,b\n1,2');
});

test('decodifica arquivos em UTF-8, Windows-1252 e UTF-16', () => {
  const utf8Bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('ação')]);
  assert.deepEqual(decodeBytes(utf8Bom), { text: 'ação', encoding: 'UTF-8' });
  assert.deepEqual(decodeBytes(new Uint8Array([0x61, 0xe7, 0xe3, 0x6f])), { text: 'ação', encoding: 'Windows-1252' });
  assert.deepEqual(decodeBytes(new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0xe7, 0x00])), { text: 'aç', encoding: 'UTF-16' });
});
