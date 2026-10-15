# Coffe Mania 0.0.4.19 — instruções para agentes de IA

Este documento reúne contexto técnico, referências, comandos e critérios de verificação para continuar o desenvolvimento. O README.md da raiz fica reservado aos textos do responsável pelo projeto; não o preencha automaticamente.

## Referências e regras de trabalho

- Use o [Nitro Renderer](https://github.com/billsonnn/nitro-renderer) como uma das principais referências de arquitetura e boas práticas para o jogo. Ao investigar bugs atuais ou futuros, consulte seu código e explique como a solução se aplica ao nosso runtime.
- Para renderização, examine RoomGeometry, RoomObjectLocationCacheItem, RoomSpriteCanvas, MovingObjectLogic, RoomPlane, FurnitureVisualization e AvatarVisualization. São referências para projeção, profundidade, camadas, cache, postura e interpolação. O Nitro é uma referência técnica, e nosso código possui adaptações próprias; não presuma que os algoritmos são idênticos.
- Investigue a causa na regra compartilhada antes de criar exceções para uma porta, parede, móvel ou tile específico. A profundidade deve usar a geometria no chão e as camadas do objeto; a altura ou as margens de um PNG não determinam sozinhas a ordem visual.
- Preserve o avanço atual da hitbox: a imagem continua interpolada, enquanto a referência lógica troca de tile na metade do passo. Só altere essa calibração se houver solicitação explícita.
- O servidor Go é responsável pela simulação compartilhada dos quartos. O cliente interpola e apresenta o estado recebido. PocketBase mantém os dados duráveis e as transações; não acrescente gravações de movimento por frame ou por passo ao banco.
- Faça verificações curtas e específicas para a alteração. Evite rodar suites completas, build, lint ou E2E sem necessidade ou solicitação. Informe o que foi verificado, quais testes realmente rodaram e os limites de uma confirmação visual.
- Mantenha comentários que expliquem contratos, invariantes, segurança e decisões técnicas. Evite narrativas de pedidos anteriores, referências a conversas com IA e comentários que apenas repetem a operação seguinte.
- Preserve arquivos, dados e alterações existentes. Para verificar inicialização, use portas isoladas e um banco temporário; não reutilize nem encerre os serviços de outra cópia do projeto.

## Referências do jogo e origem dos assets

A pasta ripped/ contém material de referência do jogo disponibilizado nesta edição:

- ripped/compiled_sfx.mp3: arquivo com os efeitos sonoros recuperados do jogo.
- ripped/game-config.xml.txt: o game-config.xml, salvo com extensão .txt. É um arquivo de origem oficial que foi adulterado/modificado. Use-o como referência histórica e compare seus valores com os catálogos e regras atuais; não presuma que represente a configuração oficial intacta.

No Discord do projeto existem imagens dos assets em PNG. Esses arquivos precisam ser obtidos e processados manualmente: selecionar a arte, recortar, preservar transparência, calibrar tamanho e offsets e cadastrar as partes no manifesto do item. O endereço do Discord deve ser fornecido pelo responsável pelo projeto; não invente um link.

**Até o momento, nenhum arquivo .swf desse jogo foi descoberto.** Essa informação se refere ao jogo e aos assets compartilhados no Discord; não a referências de outros jogos. Planeje o fluxo de assets a partir dos PNGs disponíveis, sem exigir um SWF para continuar o desenvolvimento.

Use o Asset Studio em tools/asset-positioner/ para esse processamento:

- Posicionador: apoio no chão, pegada, tamanho, offsets e exportação PNG/JSON.
- Image Cutter: seleção e recorte pela máscara isométrica, inclusive itens altos.
- Twister: conversão de paredes e pisos entre projeção isométrica e textura retangular.

O zoom de visualização do editor não altera a resolução exportada. A grade nativa usa tiles de 160×80 px e projeção 2:1. Ao cadastrar um PNG, transfira seus offsets para parts do item.json, sincronize o catálogo e preserve a origem do tile.

## Suites de testes recomendadas

O repositório de trabalho possui suites em tests/unit/, tests/unit/dom/, tests/tools/, tests/e2e/ e testes Go em backend/**/*_test.go. Elas servem de modelo para a cobertura abaixo. **As suites do projeto original ainda não foram copiadas para esta distribuição.** O pacote oferece npm run typecheck, validação de catálogo, inicialização dev, `npm test` (Vitest 4.1.11, com as suites novas em tests/unit/ e tests/tools/) e `npm run e2e` (roteiros ao vivo no Chromium em tests/e2e/, descritos abaixo). Os testes Go ficam em `*_test.go` de shared/, database/ e game-server/. Antes de portar ou criar as suites, ajuste imports, fixtures e caminhos à organização database/, game-server/, shared/ e game/. Não anuncie cobertura apenas porque go test terminou sem encontrar arquivos de teste.

| Suite | Ferramentas recomendadas | Cobertura e quando usar |
| --- | --- | --- |
| Lógica pura do cliente | Vitest em Node | Projeção/inverso isométrico, hitbox e caminhada, A*, geometria de paredes/portas, profundidade, câmera, limites de zoom, clipes e validação de catálogos. Rode os arquivos relacionados à regra alterada. |
| Interface e renderização isolada | Vitest com jsdom e fixtures Pixi | Loja, preview válido/inválido, arrasto e cancelamento, inventário apenas de unidades guardadas, Shift/Ctrl, HUD, configurações, placeholder, animações e estabilidade da ordem visual. Complemente mocks com uma conferência real do render quando a mudança for visual. |
| Persistência e segurança | Testes Go com banco temporário | Autenticação por cookie, same-origin, tickets e reutilização, posse das unidades, compras idempotentes, débito de ouro, revisões concorrentes, inventário, migrações, aparência e cozimento. Verifique transações e recarregamento dos dados. |
| Runtime e concorrência | Testes Go de gameruntime/gamewire | Fila por quarto, isolamento entre quartos, ordem dos eventos, reconexão, limites de filas, clientes lentos, encerramento e salvamento. Para mudanças de concorrência, use o detector de race quando suportado; testes de carga precisam de escopo e métricas explícitos. |
| Integração multiplayer | node:test com dois clientes/browser contexts | Humanos e NPCs com IDs, aparência, posição e ações iguais; cadeira, refeição, reações e cozimento; alterações de itens, reconexão e dormência após 30 segundos sem humanos. Ping não deve alterar a sequência dos eventos nem o relógio das animações. |
| Ferramentas de assets | node:test para geometria; Chromium/Playwright para exportação | Twister nos dois sentidos para ambas as faces de parede e pegadas de piso, dimensões ímpares, transparência, máscaras do Cutter, offsets, PNG/JSON, salvamento de projeto e funcionamento offline. Os testes twister, cutter-height, asset-context-menu e asset-desktop-ui do projeto original são exemplos. |
| Conferência visual e E2E | Playwright/Chromium com WebGL | Sobreposição entre paredes, portas, móveis, personagem sentado e emotes; travessia nos dois sentidos; preview de arrasto; zoom padrão 0,55–1 e modo bitter 0,40–2,40; loading, loja e controles. Use poucos quadros relevantes para bugs de animação. |
| Smoke da distribuição | Instalação e requisições HTTP/WebSocket em ambiente isolado | Banco novo, migrações, login, inventário inicial, entrada no quarto, confirmação de comando, arquivos do cliente e salvamento dos NPCs antes de encerrar o PocketBase. |

Ao portar suites do projeto original, as correspondências são src/ → game/src/, public/ → game/public/, backend/ → database/, backend/gameruntime/ → game-server/gameruntime/ e backend/gamewire/ ou backend/roomcatalog/ → shared/. Configure Vitest e Playwright para essas raízes e adicione suas dependências e scripts de forma explícita; mantenha banco, binários, screenshots e resultados de teste fora dos arquivos de entrega.

### Roteiros E2E (`tests/e2e/`)

Cada roteiro sobe a própria pilha isolada, joga no Chromium e reprova a execução quando uma verificação falha ou aparece um erro inesperado no console. Os servidores do jogo são compilados do código atual, o banco é novo numa pasta temporária (com a conta dev e um superusuário para ajustes entre os passos), e as portas saem de `COFFE_E2E_PORT` (padrão 18300, mais 1 e 2). Nada toca o `npm run dev` nem o banco de `database/pb_data`.

```sh
npm install --no-save playwright@1.56.1   # o Playwright não é dependência do projeto
npx playwright install chromium
npm run e2e                               # todos, em sequência
npm run e2e -- offline server             # só os nomeados
```

| Roteiro | Modo | Cobre |
| --- | --- | --- |
| `kitchen` | servidor | Sprints 1, 3 e 4: livro de receitas, ajuda de emergência, tempero, paciência, balcão, autosserviço, estragado e limpeza do fogão |
| `dirt` | servidor | Sprint 5: prato por refeição, mesa suja bloqueada, clientes bravos sem mesa limpa e limpeza com o clipe `CLEAN` |
| `staff` | servidor | Sprint 6: contratar, taxa por vaga, garçom com bandeja e gorjeta, recolher pratos, faxineiro, trocar função e dispensar |
| `expansion` | servidor | Sprint 7: expansão por moedas com nível e por Grana, recompensa, recontratar sem taxa e atraso do autosserviço |
| `level-up` | servidor | Sprint 8: subida de nível por pagamento, janela com desbloqueios e atalhos |
| `street` | servidor | Sprint 9: Fazenda, Festa do Bairro e expediente offline com "Bem-vindo de volta!" |
| `offline` | standalone | Sprint 10: café no navegador, save, aba escondida, ausência e uma aba por café |
| `retention` | standalone | Sprint 11: bônus diário, Correio, ícones, barra de XP, cancelar com reembolso, Configurações e guarda-roupa |
| `static-build` | build estático | build numa subpasta, recarga com o mesmo perfil e CSP sem eval ou sem WebAssembly |
| `server` | servidor | login, bônus e Carta gravados no banco, pagamento por WebSocket, HUD por SSE, reembolso e "Sair" |

- O Playwright é procurado em `COFFE_PLAYWRIGHT` (pasta do pacote ou `index.mjs`), no `node_modules` do projeto e no global. `COFFE_E2E_HEADED=1` mostra o navegador; `COFFE_E2E_OUT` muda a pasta das capturas (padrão: `coffe-e2e/<roteiro>` na pasta temporária do sistema); `COFFE_E2E_KEEP=1` mantém o banco e os logs da pilha; `COFFE_E2E_SKIP_BUILD=1` faz o `static-build` reaproveitar o `game/dist-standalone`.
- Com WebGL por software (máquina sem GPU, contêineres), o Pixi roda a 2–3 fps: um roteiro leva de 2 a 8 minutos, e as esperas usam tempos generosos.
- Os roteiros leem o estado pelos ganchos `window.__coffeMania`, que só existem no cliente de desenvolvimento do Vite; o `static-build` confere o build de produção pelo save no IndexedDB.
- Ao criar um roteiro novo, use `lib/stack.mjs` e `lib/browser.mjs`, tire os valores esperados das regras (`rules.json` ou `screens.active.rules`) e leia os atores pelo estado mesclado de `realtime.actors`: as atualizações de ator não repetem `kind`, nome e aparência.

Para alterações de renderização, registre posição, direção, tile lógico e instante da animação nos quadros comparados. Isso ajuda a distinguir erro de geometria, interpolação e camada. Screenshots isoladas não confirmam todas as condições de uma sala ao vivo.

Para tarefas somente de documentação, revise os caminhos e as informações; não rode build ou suites de jogo. Para correções de código, selecione primeiro o teste de regressão específico e só amplie a verificação se houver uma falha ou risco que justifique isso.

## Guia técnico e operação

Distribuição do código fonte para desenvolvimento local. Banco, servidor do jogo e cliente executam como processos separados.

| Pasta | Responsabilidade |
| --- | --- |
| `database/` | PocketBase, autenticação, migrações, inventário, compras e persistência dos quartos. |
| `game-server/` | Servidor Go/WebSocket, instâncias dos quartos, jogadores, NPCs, navegação e ações compartilhadas. Em `game-server/standalone/`, o mesmo núcleo para o navegador (Go → WebAssembly). |
| `game/` | Cliente TypeScript/PixiJS, renderização, interface, áudio e assets usados em execução. |
| `shared/` | Protocolo entre serviços, catálogo de itens, regras do jogo, domínio da persistência (`shared/cafe`, usado pelo PocketBase e pelo modo standalone) e versão do servidor. |
| `scripts/` | Inicialização do ambiente e sincronização do catálogo. |
| `tools/` | Asset Studio (Posicionador, Image Cutter e Twister) e gerador de gabaritos isométricos. |
| `ripped/` | Efeitos sonoros e game-config.xml modificado, como referências do jogo. |

## Iniciar em desenvolvimento

Requisitos: Node.js 24+, npm e Go 1.27+. As dependências estão fixadas em `package-lock.json` e `go.mod`/`go.sum`.

Na raiz desta pasta:

```sh
npm ci
npm run dev
```

O launcher compila os dois serviços Go, inicia o PocketBase, inicia o servidor WebSocket e abre o servidor Vite. A primeira compilação pode demorar enquanto o Go baixa suas dependências.

- Jogo: http://localhost:5173/
- PocketBase: http://127.0.0.1:8090/_/
- Saúde do servidor do jogo: http://127.0.0.1:8091/game/health
- Conta do banco novo em modo dev: `test@local.mail`, senha `123456`.

`Ctrl+C` salva o estado dos quartos antes de encerrar os serviços iniciados pelo launcher. Ele não reutiliza processos ou bancos de outra cópia do projeto. Para executar duas cópias simultaneamente, altere as portas.

O launcher também compila o modo offline (`game/src/standalone/generated/`). Se a página inicial não conseguir falar com os serviços, o jogo abre sozinho no modo offline; `?offline=1` força esse modo mesmo com os serviços no ar.

## Configuração e dados locais

Copie `.env.example` para `.env` se precisar alterar portas, diretório de dados ou caminho do Go. O `.env` é carregado pelo launcher e não deve ser publicado.

O banco é criado em `database/pb_data/`. Os executáveis e a chave compartilhada entre os serviços ficam em `.runtime/`. Esses arquivos são gerados localmente e estão no `.gitignore`; a distribuição não contém contas reais, banco preexistente, tokens ou senhas pessoais.

`COFFE_DEV_SEED=false` desativa a criação da conta de demonstração na primeira migração de um banco novo. Alterar essa opção depois não apaga contas já criadas. Para cadastrar outros usuários, crie um superusuário do PocketBase e use a coleção `users` no dashboard. As APIs públicas de cadastro e de edição direta do inventário permanecem fechadas.

Depois da primeira compilação, um superusuário pode ser criado com:

```sh
# Windows
.runtime/bin/coffe-database.exe superuser create EMAIL SENHA --dir=database/pb_data
# Linux/macOS
.runtime/bin/coffe-database superuser create EMAIL SENHA --dir=database/pb_data
```

## Executar os componentes separadamente

`npm run dev:servers` inicia apenas PocketBase e WebSocket. Em outro terminal, `npm run dev:game` inicia o cliente. Ambos leem as portas do `.env` da raiz.

Também é possível iniciar os serviços manualmente, na ordem abaixo:

```sh
cd database
go run . serve --http=127.0.0.1:8090 --dir=./pb_data
```

```sh
cd game-server
go run .
```

```sh
# Na raiz da distribuição
npm run dev:game
```

Na execução manual, configure as variáveis de ambiente no terminal. Sem `COFFE_DEV_SEED=true`, a migração não cria a conta de demonstração. Ambos os serviços usam por padrão `../.runtime/game-secret`, relativo às respectivas pastas; o PocketBase cria essa chave primeiro.

Para usar o ngrok instalado e autenticado na máquina:

```sh
npm run dev -- --ngrok
```

## Modificar o jogo

O estado rápido do quarto pertence ao servidor WebSocket. Cada quarto tem sua fila e goroutine; movimento e animação não gravam cada passo no SQLite. PocketBase cuida das transações duráveis e do estado privado do jogador via SSE. Sem humanos, o quarto aguarda 30 segundos, salva seu estado e fica dormente.

Cada item fica em `game/public/assets/items/<classname>/`, com imagens e `item.json`. Depois de editar ou adicionar itens, execute:

```sh
npm run assets:room
```

O comando valida os manifestos e sincroniza os catálogos do cliente e de `shared/roomcatalog/`. Reinicie os serviços para recompilar o catálogo incorporado ao Go. Aparência e texturas do avatar ficam em `game/public/assets/avatar/`; os catálogos de validação ficam em `shared/appearance/` e `shared/npcappearance/` (o servidor e o modo standalone usam os mesmos).

`npm run typecheck` verifica os tipos. `npm run build` gera o cliente em `game/dist/`, mas não é necessário para o modo dev. A versão do jogo é `0.0.4.19` em `VERSION`, nos campos `gameVersion`, em `shared/buildinfo/version.go` e em `game/src/core/version.ts`. O campo npm `version` usa `0.0.4-19` por compatibilidade com SemVer.

## Modo standalone (sem servidores)

O mesmo jogo roda inteiro no navegador: o servidor dos quartos (`gameruntime`) e as regras de persistência (`shared/cafe`) são compilados para WebAssembly e executados num Web Worker, e o café é salvo no IndexedDB do navegador. Visitas e recursos sociais não existem nesse modo.

```sh
npm run wasm                # só o motor: game/src/standalone/generated/coffe.wasm + wasm_exec.js
npm run build:standalone    # site estático em game/dist-standalone/
npm run preview:standalone  # serve o build estático em http://localhost:4173/
```

- `game/dist-standalone/` usa caminhos relativos: publique o conteúdo da pasta em qualquer hospedagem estática (GitHub Pages, Vercel), inclusive numa subpasta. O servidor precisa entregar `.wasm` como `application/wasm` (o jogo tem uma alternativa mais lenta quando não entrega). Uma Content-Security-Policy sem `'unsafe-eval'` funciona (o Pixi passa para `pixi.js/unsafe-eval` quando `new Function` é recusado), mas o WebAssembly exige ao menos `'wasm-unsafe-eval'` em `script-src`; sem ele, a página mostra o motivo.
- O modo também é escolhido por `VITE_STANDALONE=true` no build, por `?offline=1` no endereço ou automaticamente quando `/api/coffe/session` não responde.
- O save fica no navegador e no aparelho do jogador, separado das contas do servidor. Um café aberto em duas abas é recusado na segunda.
- Os arquivos de `game/src/standalone/generated/` são gerados e ficam fora do Git; `npm run build` e `npm run dev` também os geram. O Vite os importa com `?url`, então o build os publica com o hash do conteúdo no nome (um motor em cache nunca sobrevive à página que espera outro).

## Ferramentas de assets

O [Asset Studio](tools/asset-positioner/README.md) inclui **Asset Positioner**, **Image Cutter** e **Twister para paredes e pisos**, com importação, recorte, espelhamento, posicionamento, conversão isométrica, exportação PNG/JSON e salvamento de projetos.

Abra `tools/asset-positioner/index.html` diretamente no navegador, ou `abrir.cmd` no Windows. Funciona offline, sem instalar dependências. Para usar um endereço HTTP local:

```sh
npm run tools
```

Acesse http://127.0.0.1:5175/. A porta pode ser alterada com `COFFE_TOOLS_PORT` no `.env`. As ferramentas funcionam independentemente dos servidores do jogo e do banco; as imagens são processadas no navegador.

O script `tools/create-isometric-templates.ps1` gera gabaritos e overlays de tiles 160×80 no Windows, usando PowerShell e System.Drawing:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/create-isometric-templates.ps1
```

Os PNGs gerados ficam em `tools/gabaritos/isometrico/`. Para cadastrar a arte exportada pelo Studio, preencha `parts` no `item.json` do item e execute `npm run assets:room`.

## Conteúdo da distribuição

Estão incluídos código editável, migrações, configurações, ferramentas e os assets necessários para executar o jogo atual. O motor WebAssembly do modo standalone é gerado (`npm run wasm`) e não faz parte dos arquivos versionados. A pasta ripped/ contém os sons e a configuração de referência descritos acima. Caches, demos comparativas, builds, bancos locais e arquivos de referência de outros jogos não fazem parte da entrega.

O código desenvolvido para o projeto usa a licença MIT em `LICENSE`. Dependências e assets de terceiros conservam suas licenças e autoria; a licença do código não concede novos direitos sobre imagens, modelos ou áudio de outros jogos.
