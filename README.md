# Conversor JSON ↔ CSV — converta dados no navegador, sem enviar nada (HTML + JS)

Ferramenta para transformar JSON em CSV e CSV em JSON sem subir arquivo para site nenhum: tudo roda no seu navegador. Pensada para o dia a dia de quem lida com planilhas e APIs no Brasil: entende o ponto e vírgula e a vírgula decimal do Excel em português, objetos aninhados, JSON Lines e arquivos antigos salvos em Windows-1252.

**Acesse online:** https://micdog22.github.io/conversor-json-csv/

## Recursos

**JSON → CSV**
- Aceita lista de objetos, objeto de objetos (a chave vira a coluna `chave`), lista de listas e JSON Lines.
- Objetos aninhados viram colunas com ponto (`endereco.cidade`); listas vão como texto JSON ou em colunas indexadas (`itens.0`, `itens.1`).
- Colunas na ordem em que aparecem pela primeira vez.
- Delimitador vírgula, ponto e vírgula ou tabulação; aspas no padrão RFC 4180; fim de linha CRLF ou LF; BOM UTF-8 opcional no download.
- Números saem exatamente como estavam no JSON (`10.50`, inteiros enormes), com opção de vírgula decimal (`12,50`).
- Proteção opcional contra fórmulas (prefixa `'` em textos que começam com `=`, `+`, `-` ou `@`).

**CSV → JSON**
- Leitor RFC 4180: aspas, aspas duplicadas, quebras de linha dentro do campo, CRLF/LF.
- Detecta o delimitador (`,`, `;`, tabulação ou `|`).
- Cabeçalho opcional; nomes repetidos ou vazios são ajustados (`nome_2`, `coluna3`).
- Detecção de tipos opcional: números, `true`/`false`, vazio → `null`, listas e objetos JSON dentro de células. Zeros à esquerda, CEP, CPF e números com mais de 15 dígitos continuam como texto.
- Números no formato brasileiro opcional: `1.234,56` → `1234.56`.
- Colunas com ponto viram objetos e índices viram listas (`itens.0.sku` → `itens[0].sku`).
- Saída como lista JSON (com ou sem recuo) ou JSON Lines.

**Interface**
- Dois painéis editáveis com conversão automática enquanto você digita.
- Abrir arquivo ou arrastar e soltar; copiar; baixar.
- Prévia em tabela das primeiras 100 linhas.
- Erros de JSON com linha, coluna e explicação em português (vírgula sobrando, aspas simples, comentário…), com botão para ir até o erro.
- Arquivos em UTF-8, UTF-16 ou Windows-1252 (Excel antigo) são lidos com os acentos certos.

## Como usar

1. Cole o JSON no painel da esquerda (ou o CSV no da direita), abra um arquivo ou arraste-o para a página.
2. Ajuste as opções; a conversão é refeita na hora.
3. Copie ou baixe o resultado.

Para abrir no **Excel em português**, clique em “Ajustar para o Excel em português”: ponto e vírgula, vírgula decimal, CRLF e BOM UTF-8.

Exemplo:

```json
[{ "nome": "Maria Exemplo", "endereco": { "cidade": "Campinas", "uf": "SP" }, "saldo": 1234.50 }]
```

vira

```csv
nome;endereco.cidade;endereco.uf;saldo
Maria Exemplo;Campinas;SP;1234,50
```

## Como rodar localmente

Os módulos ES não carregam via `file://`, então sirva a pasta:

```bash
python3 -m http.server 8000
```

e abra http://localhost:8000.

## Testes

```bash
npm test
```

(ou `node --test`; não há dependências para instalar)

## Como funciona

- `null` vira um campo vazio e o texto vazio `""` vira `""` entre aspas; na volta, a diferença é mantida.
- Um objeto ou lista vazia (`{}`, `[]`) não cria coluna quando outros registros têm subcolunas com o mesmo nome, para que a volta reconstrua os objetos.
- Quando existem as colunas `a` e `a.b` ao mesmo tempo, `a.b` fica como chave plana na volta, para não perder dados.
- Chaves que já contêm ponto no JSON original viram objetos aninhados na volta.

## Contribuindo

Issues e pull requests são bem-vindos.

## Licença

MIT — veja [LICENSE](LICENSE).
