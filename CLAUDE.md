# CLAUDE.md — Coffe Mania

@AGENTS.md

AGENTS.md (importado acima) é a fonte das regras de trabalho, comandos, portas, referências de renderização e origem dos assets. Este arquivo acrescenta apenas a arquitetura de estado, o contrato das regras de jogo, o GDD resumido das expansões e o roteiro de sprints. Em caso de conflito, AGENTS.md prevalece. O README.md continua reservado ao responsável pelo projeto.

## Stack

| Camada | Tecnologia | Pasta |
| --- | --- | --- |
| Cliente | TypeScript 5.9 estrito, PixiJS 8, Vite 7 | `game/` |
| Simulação dos quartos | Go 1.27, WebSocket (`coder/websocket`), uma goroutine por quarto | `game-server/` |
| Persistência | PocketBase 0.40 (SQLite), migrações em Go, SSE | `database/` |
| Contratos | Go sem dependências: protocolo (`gamewire`), itens (`roomcatalog`), regras (`gamerules`) | `shared/` |
| Testes JS | Vitest 4.1.11 (raiz), lógica pura do cliente e das ferramentas | `tests/unit/`, `tests/tools/` |

## Autoridade do estado

| Estado | Dono | Chega ao cliente por |
| --- | --- | --- |
| Posição, caminho, ações, clientes NPC, emoções | game-server, em memória | eventos WebSocket ordenados (`epoch` + `seq`) |
| Moedas, Grana, XP, nível, popularidade, inventário, fogões, pratos | PocketBase, em transações | snapshot HTTP + SSE de `player_state` |
| Interpolação, câmera, HUD, efeitos visuais, áudio | cliente | — |
| Preferências (volumes, mudo, faixa, zoom bitter) | `localStorage`, por jogador | — |

- Estado de jogo não vai para `localStorage`: o cliente não é confiável e o café é compartilhado com visitantes em tempo real.
- Progresso offline sai de instantes absolutos gravados no banco (`preparing_at`, `started_at`, `ready_at`); o snapshot calcula o estado a partir de `now`. Novos timers (estragar, limpar, contratar) seguem o mesmo padrão: gravar o instante, nunca decrementar por tick.
- Sem humanos, o quarto aguarda 30 s, salva os NPCs (`ActionRemaining`) e dorme; ao acordar, desloca os relógios pela pausa.
- Grava-se no banco por transação de jogo (comprar, cozinhar, tirar porção, veredito de cliente), nunca por passo ou quadro.

## Loop de tempo

- Servidor: ticker de 333 ms (`Options.Tick`) e timer de passo (667 ms por tile, `Options.Step`). `room.tick` avança movimento, emoções, a máquina de estados dos NPCs e o spawn. Só a goroutine do quarto muta o estado (fila `tasks`).
- Cliente: ticker do Pixi → `ScreenManager.update(deltaMs)` → `RoomScreen.update`, que interpola com o relógio do servidor (`serverNowMs`) e não simula regras.
- `Consume` e `Operate` fazem HTTP síncrono dentro da goroutine do quarto (timeout de 5–8 s). Vereditos sem pagamento já são assíncronos (`reportUnsatisfied`).

## Regras de jogo — `shared/gamerules`

- Fonte única: `shared/gamerules/rules.json`, embutido no Go e validado no `init` (panic se inválido, como `roomcatalog`).
- Extraídos de `ripped/game-config.xml.txt` (arquivo modificado, valores a confirmar): níveis 1–260 (`requiredXp`, `rewardCoins`), popularidade (mín. 5, máx. 105, +0,1 por cliente satisfeito, −0,3 por insatisfeito), `clientFrequency`, gorjetas e limite de funcionários por nível.
- Interpretação não confirmada: `clientFrequency` é tratado como clientes por minuto. As entradas `<level low frequency>` do arquivo ainda não são usadas.
- Receitas têm valores de design provisórios (`"provisional": true`); não apresentá-los como dados do jogo original.
- Unidades: popularidade em décimos (`satisfaction_current_tenths`, faixa 50–1050); XP total em `experience_current` e requisito do próximo nível em `experience_max`; moedas = `gold` (2ª barra do HUD); Grana = `cash` (1ª barra, moeda premium).
- Nova receita: entrada em `rules.json`, arte em `game/public/assets/foods/<id>/` (`stage_1.png`, `stage_2.png`) e, até a Sprint 3, a carta no `CookScreenModal`. Rode `go test ./shared/gamerules/`.

## Ciclo econômico (Sprint 1)

1. Cozinhar: `POST /api/coffe/cooking/start` → game-server (`cook_start`, exige o avatar ao lado do fogão) → persistência. Valida receita e nível e debita `costCoins` na mesma transação que cria o preparo.
2. Servir no fogão (`cook_serve`): cria `room_food` com `servings` porções.
3. Cliente sentado com mesa pega o primeiro prato: `/consume` tira uma porção e credita moedas, XP, level-up (com `rewardCoins`) e popularidade em uma transação. O quarto transmite `payment` nesse instante, junto com a atualização do HUD por SSE.
4. Cliente que sai sem veredito positivo (sem cadeira ou sem comida) chama `/feedback` uma única vez (flag persistida `emotionShown`) e reduz a popularidade.
5. A popularidade define o intervalo entre chegadas (`arrivalInterval`, ±25%); `MaxNPCs` limita quantos clientes ficam dentro.

Eventos do protocolo: `welcome`, `actors`, `world`, `food`, `payment`, `ack`, `error`. Todo broadcast incrementa `seq`; o cliente reconecta ao detectar lacuna. Campos de dormência (`path`, `visits`) não são transmitidos.

## Áudio (Sprint 2)

- `game/src/audio/AudioEngine.ts`: Web Audio com master → (música, efeitos) → limitador. O `AudioContext` nasce no primeiro gesto (política de autoplay); música pedida antes começa nesse instante. O evento `statechange` também retoma tudo depois de interrupções.
- Prioridade de cada som (`SoundEvent` em `sound-events.ts`): trecho do manifesto `game/public/assets/sfx/sfx-sprites.json` → amostra individual original → síntese (`synth.ts`). O manifesto versionado está vazio; o MP3 só é baixado quando houver trechos rotulados.
- Recortar os ~60 efeitos de `ripped/compiled_sfx.mp3`: **Recortador de SFX** (`tools/asset-positioner/sfx-slicer.html`). Ninguém ouviu e rotulou os trechos ainda; não invente o mapeamento.
- Faixas: `Tema padrão` (`music_1.opus`), `Bossa do Balcão` e `Fim de Expediente` (procedurais, `music.ts`), `Tema alternativo` (`default_song.mp3`, de origem não documentada, compensado em −5,5 dB). Uma gravação que não decodifica cai para a síntese.
- Música adaptativa: `setIntensity(0–1)` vem de quantos clientes estão dentro (2 = início do pico, 3 = máximo). As faixas procedurais aceleram até 7% e ganham percussão; as gravações não mudam.
- Níveis calibrados em −20,5 LUFS para as músicas (referência: `music_1.opus`) e −22,5 a −25 LUFS para efeitos (referência: `book_1`, `start_cooking`). Mudanças na síntese devem ser remedidas renderizando com `OfflineAudioContext` no Chromium e `ffmpeg -af ebur128`.
- HUD (`ui/AudioHudControl.ts`, canto superior esquerdo): mudo, seletor de faixa e volumes; tecla **M**. O mudo preserva os volumes; mexer num volume desfaz o mudo sem zerar o outro canal (também nas Configurações).
- Ganchos no `RoomScreen`: sininho (cliente passa de fora para dentro), chiado (início do preparo), moeda (evento `payment`), fanfarra (level-up do dono), buzzer (emoção `dissatisfied`), livro (modal de receitas). A vassoura existe e será ligada na Sprint 5.

## GDD resumido

**Loop central:** cozinhar → servir porções → clientes chegam conforme a popularidade → comem e pagam (moedas + XP) → o nível libera receitas, itens e funcionários → decorar e expandir aumenta a popularidade.

| Sistema | Situação | Sprint |
| --- | --- | --- |
| Economia: custo, porções, pagamento, níveis 1–260, popularidade | Implementado | 1 |
| Áudio Web Audio (amostras + síntese, trilha adaptativa, controle no HUD) | Implementado | 2 |
| Fogão completo (bônus, estragado, limpeza) e balcão | Planejado; hoje preparando → cozinhando → pronto → servir | 3 |
| Máquina de estados de clientes com prazos e reclamações | Parcial: entrar, sentar, comer, sair e emoções existem | 4 |
| Sujeira e limpeza | Planejado | 5 |
| Funcionários | Planejado | 6 |
| Construção, loja por categoria, expansão do café | Parcial: grade, arrastar, girar, guardar e comprar existem | 7 |
| Juice e modal de nível | Parcial: moedas/XP flutuantes e aviso de nível | 8 |

- **Fogão (alvo):** vazio → preparando (2 s) → cozinhando (barra) → bônus opcional (temperar/mexer) → pronto → estragado após uma janela por timestamp → limpeza. O config cita `stoveCleaningCoinCost` e `stoveCleaningXPGain`, com valores adulterados.
- **Cliente (alvo):** entrando → procurando cadeira → sentado aguardando comida → comendo → pagando → saindo. Sem cadeira, sem comida no prazo ou com café sujo: balão bravo, sai sem pagar e reduz a popularidade. O config tem `waitingChairTime`, `waitingDiningSetTime`, `waitingFoodTime`, `eatingTime` e `dishPickupTime` (valores adulterados).
- **Decisão em aberto (Sprint 4):** autosserviço no balcão ou entrega na mesa por garçom. Os campos `waitingFoodTime` e `dishPickupTime` sugerem entrega na mesa, mas isso não está confirmado.
- **Sujeira:** surge após N refeições por mesa ou comida estragada; bloqueia a mesa ou reduz a popularidade até a limpeza.
- **Funcionários:** limite por nível segundo `employeeLocks` (1 no nível 1, 2 no 7 … 7 no 47); tarefas de servir e limpar; ficam no quarto como NPC `staff`.
- **Áudio:** ver a seção "Áudio (Sprint 2)".

## Roteiro de sprints

1. **Regras compartilhadas e ciclo econômico** (concluída): `gamerules`, custo e porções, pagamento, níveis, popularidade, spawn por popularidade, moedas/XP flutuantes e aviso de nível.
2. **AudioEngine** (concluída): mixer Web Audio, sons originais com síntese de reserva, duas trilhas procedurais adaptativas, controle no HUD, Recortador de SFX e primeira suíte Vitest. Pendente do responsável: ouvir e rotular os trechos de `compiled_sfx.mp3`. A urgência de "comida prestes a queimar" entra com o estado estragado (Sprint 3).
3. **Fogão e balcão:** estados bônus/estragado/limpeza com timestamps, `CookScreenModal` alimentado pelo catálogo (custo, porções, tempo, bloqueio por nível), rota pública das regras e balcão (`kind: counter`, que depende de arte; placeholder procedural até lá).
4. **Clientes:** extrair a máquina de estados de `runtime.go`, prazos de espera, balões de reclamação, limite por cadeiras e a decisão de fluxo.
5. **Sujeira e limpeza:** entidades persistidas por evento, ação de limpar e penalidade de popularidade.
6. **Funcionários:** contratação com limite por nível, agenda de tarefas e persistência.
7. **Construção e expansão:** categorias da loja, decoração com bônus de popularidade e compra de área (`tiles_x`/`tiles_y`, até 40). O conteúdo depende dos PNGs processados no Asset Studio.
8. **Juice e testes:** modal de nível com desbloqueios, barras sobre clientes e suites Vitest/Playwright conforme AGENTS.md.

## Débitos técnicos

- `RoomScreen.ts` (~2,4 mil linhas) e `runtime.go` (~1,4 mil linhas): extrair controladores (cozimento, atores ao vivo, clientes) ao alterar essas áreas, não em refatorações isoladas.
- `cake_1` ainda está fixo no cliente (`CookScreenModal`, `acceptCookingSnapshot`) até a Sprint 3.
- Moedas creditadas ao entregar a porção: um quarto que dorme ou cai depois disso não perde pagamento. Para pagar só no fim da refeição, é preciso um recibo idempotente persistido com o NPC.
- Paciência dos clientes: sentado sem comida, o cliente desiste em cerca de 6 s (3 checagens de 2 s). Em um preparo de 30 s, o teste ao vivo registrou 6 reclamações (−1,8 de popularidade) antes do primeiro prato. Ajustar com prazos de espera na Sprint 4.
- Lockfile: o npm 10.9 falha com `edgesOut` ao adicionar dependências com peers opcionais, e o npm 11.6 remove os campos `libc` do lockfile. Para alterar dependências, use npm ≥ 11.20 (o projeto exige Node 24, que traz o npm 11).
- Risco de travamento econômico: se o jogador gastar todas as moedas sem pratos prontos, não consegue cozinhar. Definir a mitigação na Sprint 3 (receita inicial gratuita ou piso de moedas).

## Verificação

- Go: `go vet ./...` e `go test ./shared/... ./database/ ./game-server/...` (use `-race` em `gameruntime`). Testes de persistência usam banco temporário e as migrações reais.
- Cliente: `npm run typecheck` e `npm test` (Vitest: música, preferências, manifesto de sprites e detecção do Recortador).
