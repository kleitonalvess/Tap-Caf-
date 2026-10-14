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
- Progresso offline sai de instantes absolutos gravados no banco (`preparing_at`, `started_at`, `ready_at`, `spoils_at`, `room_dirt.created`); o snapshot calcula o estado a partir de `now`. Novos timers (contratar, turnos) seguem o mesmo padrão: gravar o instante, nunca decrementar por tick.
- Sem humanos, o quarto aguarda 30 s, salva os NPCs (`ActionRemaining`, `PatienceRemaining`) e dorme; ao acordar, desloca os relógios pela pausa.
- Grava-se no banco por transação de jogo (comprar, cozinhar, tirar porção, veredito de cliente), nunca por passo ou quadro.

## Loop de tempo

- Servidor: ticker de 333 ms (`Options.Tick`) e timer de passo (667 ms por tile, `Options.Step`). `room.tick` avança movimento, emoções, a máquina de estados dos NPCs e o spawn. Só a goroutine do quarto muta o estado (fila `tasks`).
- Cliente: ticker do Pixi → `ScreenManager.update(deltaMs)` → `RoomScreen.update`, que interpola com o relógio do servidor (`serverNowMs`) e não simula regras.
- `Consume` e `Operate` fazem HTTP síncrono dentro da goroutine do quarto (timeout de 5–8 s). Vereditos sem pagamento já são assíncronos (`reportUnsatisfied`).

## Regras de jogo — `shared/gamerules`

- Fonte única: `shared/gamerules/rules.json`, embutido no Go e validado no `init` (panic se inválido, como `roomcatalog`).
- Extraídos de `ripped/game-config.xml.txt` (arquivo modificado, valores a confirmar): níveis 1–260 (`requiredXp`, `rewardCoins`), popularidade (mín. 5, máx. 105, +0,1 por cliente satisfeito, −0,3 por insatisfeito), `clientFrequency`, gorjetas e limite de funcionários por nível.
- Interpretação não confirmada: `clientFrequency` é tratado como clientes por minuto. As entradas `<level low frequency>` do arquivo ainda não são usadas.
- Receitas têm valores de design provisórios (`"provisional": true`): o repositório não contém a lista original (o config só cita códigos de prato 900103–900105). Não apresentá-los como dados do jogo original. O mesmo vale para `stove` e `customers` (o `waitingFoodTime` do config é 999, adulterado).
- Unidades: popularidade em décimos (`satisfaction_current_tenths`, faixa 50–1050); XP total em `experience_current` e requisito do próximo nível em `experience_max`; moedas = `gold` (2ª barra do HUD); Grana = `cash` (1ª barra, moeda premium).
- Nova receita: entrada em `rules.json` e `go test ./shared/gamerules/`. O cliente lê o catálogo de `GET /api/coffe/rules`; o livro, os fogões, o balcão e as mesas se ajustam sozinhos. Sem PNG, `recipe-art.ts` desenha uma ilustração em canvas; para trocar pela arte real, coloque `stage_1.png`/`stage_2.png` em `game/public/assets/foods/<id>/` e registre as texturas no mapa `images` do `RoomScreen` (hoje só `cake_1`).

## Ciclo econômico (Sprint 1)

1. Cozinhar: `POST /api/coffe/cooking/start` → game-server (`cook_start`, exige o avatar ao lado do fogão) → persistência. Valida receita e nível e debita `costCoins` na mesma transação que cria o preparo.
2. Servir no fogão (`cook_serve`): cria `room_food` com `servings` porções.
3. Cliente sentado com mesa pega o primeiro prato: `/consume` tira uma porção e credita moedas, XP, level-up (com `rewardCoins`) e popularidade em uma transação. O quarto transmite `payment` nesse instante, junto com a atualização do HUD por SSE.
4. Cliente que sai sem veredito positivo (sem cadeira ou sem comida) chama `/feedback` uma única vez (flag persistida `emotionShown`) e reduz a popularidade.
5. A popularidade define o intervalo entre chegadas (`arrivalInterval`, ±25%); `MaxNPCs` limita quantos clientes ficam dentro.

Eventos do protocolo: `welcome`, `actors`, `world`, `food` e `dirt` (sempre a lista completa; ausente = vazia), `payment`, `ack`, `error`. Todo broadcast incrementa `seq`; o cliente reconecta ao detectar lacuna. Campos de dormência (`path`, `visits`) não são transmitidos.

## Áudio (Sprint 2)

- `game/src/audio/AudioEngine.ts`: Web Audio com master → (música, efeitos) → limitador. O `AudioContext` nasce no primeiro gesto (política de autoplay); música pedida antes começa nesse instante. O evento `statechange` também retoma tudo depois de interrupções.
- Prioridade de cada som (`SoundEvent` em `sound-events.ts`): trecho do manifesto `game/public/assets/sfx/sfx-sprites.json` → amostra individual original → síntese (`synth.ts`). O manifesto versionado está vazio; o MP3 só é baixado quando houver trechos rotulados.
- Recortar os ~60 efeitos de `ripped/compiled_sfx.mp3`: **Recortador de SFX** (`tools/asset-positioner/sfx-slicer.html`). Ninguém ouviu e rotulou os trechos ainda; não invente o mapeamento.
- Faixas: `Tema padrão` (`music_1.opus`), `Bossa do Balcão` e `Fim de Expediente` (procedurais, `music.ts`), `Tema alternativo` (`default_song.mp3`, de origem não documentada, compensado em −5,5 dB). Uma gravação que não decodifica cai para a síntese.
- Música adaptativa: `setIntensity(0–1)` vem de quantos clientes estão dentro (2 = início do pico, 3 = máximo). As faixas procedurais aceleram até 7% e ganham percussão; as gravações não mudam.
- Níveis calibrados em −20,5 LUFS para as músicas (referência: `music_1.opus`) e −22,5 a −25 LUFS para efeitos (referência: `book_1`, `start_cooking`). Mudanças na síntese devem ser remedidas renderizando com `OfflineAudioContext` no Chromium e `ffmpeg -af ebur128`.
- HUD (`ui/AudioHudControl.ts`, canto superior esquerdo): mudo, seletor de faixa e volumes; tecla **M**. O mudo preserva os volumes; mexer num volume desfaz o mudo sem zerar o outro canal (também nas Configurações).
- Ganchos no `RoomScreen`: sininho (cliente passa de fora para dentro), chiado (início do preparo), moeda (evento `payment`), fanfarra (level-up do dono), buzzer (emoção `dissatisfied`, prato estragado, receita indisponível), livro (modal de receitas), tempero (`season`) e vassoura (limpar fogão).

## Cozinha e clientes (Sprints 3–4)

- **Fogão** (`database/cooking.go`, estado derivado de timestamps em `jobState`): vazio → `preparing` (2 s) → `cooking` → `ready` → `spoiled` em `spoils_at` (= pronto + `spoilSeconds` da receita; jobs antigos sem o campo usam essa mesma conta). Estragado não serve: só `cook_clean`, que dá `cleaningXp` e cobra `cleaningCoins` (hoje 0).
- **Temperar** (`cook_season`): uma vez por lote, durante `preparing`/`cooking`, soma `seasonBonusPercent` das porções (arredonda para cima, mínimo 1) e dá `seasonXp` a quem temperou. É a única ação permitida a visitantes, que precisam estar dentro do café; o `GET` da cozinha esconde deles a ajuda de emergência.
- **Ajuda de emergência:** a receita liberada mais barata sai com custo 0 só quando as moedas não pagam essa receita **e** não há preparo vivo (preparando, cozinhando ou pronto) nem comida no balcão. A condição é recalculada dentro da transação de `cook_start`; o cliente apenas exibe "Grátis (Ajuda de Emergência)".
- **Balcão** (`serving_counter`, id 3080000, `kind: counter`, placeholder sem PNG): servir escolhe no servidor um balcão com a mesma receita (soma porções) ou um vazio. Sem balcão livre, o servir falha com 409. Balcão com comida não pode ser movido nem guardado. A migração `202610140001` dá um balcão às salas antigas em (7,3), guardado no inventário se o tile estiver ocupado.
- **Clientes** (`game-server/gameruntime/customers.go`): entrar → reservar cadeira com mesa limpa → sentado aguardando (paciência `patienceSeconds` = 40 s, transmitida em `actor.patience`) → pegar porção do balcão → comer → pagar → sair. Sem comida no prazo ou sem mesa limpa: emoção brava, `/feedback` e −0,3 de popularidade. A lotação acompanha as cadeiras com mesa (`diningChairs`, incluindo as de mesas sujas); com o balcão vazio e um prato no fogo, o intervalo de chegada é multiplicado por `cookingArrivalFactor` (1,5).
- **Cozinha parada** (`kitchenIdle`: nenhuma porção no balcão e nenhum preparo vivo, isto é, preparando, cozinhando ou pronto sem estragar): entra no máximo um cliente "olhando o cardápio", marcado `browsing` (persistido na dormência). Quem sai sem comer com a cozinha parada, ou marcado `browsing`, mostra a cara neutra, sem `/feedback` nem perda de popularidade. Quando o primeiro prato vai ao fogo (`watchKitchen`), quem está sentado com a marca ganha a paciência inteira de novo. O cliente pinta o balão desses clientes de cinza-azulado.
- **Cliente:** livro de receitas lido de `rules` (abas por faixa de nível, bloqueio por nível, custo em vermelho quando falta moeda; dois toques no mesmo cartão ou o botão cozinham, e o cartão pré-selecionado nunca cozinha com um toque), menu contextual do fogão (`StoveActionMenu`), fumaça e balão de pronto com urgência (`StoveEffects`), prato e contador ×N no balcão (`CounterDish`), balão de paciência (`PatienceMeter`) e prato da receita certa na mesa.
- **Arte provisória:** `placeholder-art.ts` desenha itens com `"placeholder": true` e `parts: []` no mesmo enquadramento do Asset Studio (origem do tile, 160×80). Ao exportar o PNG real, preencha `parts`, remova `placeholder` e rode `npm run assets:room`.

## Sujeira e limpeza (Sprint 5)

- Cada refeição paga deixa um prato na mesa: `serveCustomer` grava um registro em `room_dirt` (`user`, `table_id`, `created`) na mesma transação do pagamento. O servidor do jogo espelha o prato (`addDirt`) e transmite `dirt`; o snapshot do mundo agrupa os pratos por mesa (`gamewire.Dirt`: `tableId`, `plates`, `since`).
- Mesa suja não recebe cliente; as cadeiras dela ainda contam na lotação, então os clientes entram, não acham mesa limpa e saem bravos (fora da cozinha parada). Mesa suja não pode ser movida nem guardada (`errTableDirty`).
- Limpar: o dono toca na mesa, o avatar anda até o lado dela e chama `POST /api/coffe/room/tables/clean` (`tableId`). O servidor do jogo valida a adjacência (operação `table_clean`), a persistência apaga os pratos e concede `tables.cleaningXp` (hoje 0). O avatar faz o clipe original `CLIP.CLEAN` (balde e escova) por `tables.cleaningSeconds` (2 s); a pose sai antes do evento `dirt`, e o cliente mantém os pratos até o fim da escova, quando eles somem com brilho e som de vassoura.
- Visual: `TableDirt` desenha até três pratos sujos em canvas; depois de 20 s aparecem moscas. Os valores de `tables` são provisórios: o config só nomeia `dishPickupTime` (adulterado), indício de que os pratos eram recolhidos após cada refeição.

## Prédios da rua

- `game/src/world/street-scenery.ts` é o manifesto (`STREET_BUILDINGS`: id, nome, status, pegada em tiles fora do quarto, altura e `image` opcional) e guarda as faixas de rua e calçada medidas nos PNGs `CityBackground*` (`STREET_BANDS`). Um teste garante que nenhum prédio fica sobre a rua ou o quarto.
- `StreetScenery.ts` cria cada prédio no mundo com profundidade pela pegada no chão (`setRoomDepth`), hit area na silhueta, cartão de nome no hover/toque, pulso de neon, holofotes e cata-vento. `street-art.ts` desenha a arte em canvas na projeção do quarto.
- Hoje: Fazenda de Ingredientes (tx −17…−14, ty −1…1, entre a árvore de trás e o pinheiro da frente) e Discoteca (tx 1…4, ty −17…−14). Para trocar pela arte do Asset Studio, preencha `image` com o arquivo e os offsets `left`/`top` relativos ao vértice superior do tile (tx, ty), como nas partes dos itens.
- A câmera sobe até `bg.top + SCENE_CAMERA_TOP_INSET` (150) para alcançar os prédios; as laterais continuam com 900.

## Funcionários (Sprint 6)

- Regras: `staff` em `rules.json` (perfis predefinidos, custo de contratação e tempos, todos provisórios) e `employeeLocks` do config (`EmployeeSlots(level)`: 1 vaga no nível 1, 2 no 7 … 7 no 47). O perfil "Amigo Vostu" referencia o `vostuFriend` do config.
- Persistência: `room_staff` (`user`, `profile`, `name`, `role` garçom/faxineiro, `appearance` sorteada uma vez na política dos clientes, `friend_user` opcional e reservado para contratar amigos). Rotas do dono: `GET /api/coffe/staff` e `POST /api/coffe/staff/{hire,role,dismiss}`, que passam pelo servidor do jogo (`staff_*`) e devolvem o mundo com `World.staff`.
- Simulação (`game-server/gameruntime/staff.go`): os funcionários vivem só na memória do quarto (`kind: staff`, `role`) e aparecem dentro da porta. Com garçom em serviço os clientes não se servem sozinhos: o garçom reserva uma porção (`reserved`), anda até o balcão (`picking`, clipe `WAITOR_WORKING`), leva o prato na bandeja (`carrying`, `WAITOR_WALK` com o prato desenhado na bandeja) e entrega; o pagamento e o prato sujo saem na entrega (`Consume`). Enquanto o garçom vem, a paciência do cliente fica pausada. Sem pedido, o garçom recolhe pratos (`busing`); o faxineiro só limpa mesas (`cleaning`, clipe `CLEAN`). As mesas ficam reservadas em `claimed`; a limpeza dos funcionários usa `/game-internal/{owner}/clean-table`, sem XP para o dono.
- Trabalho interrompido (dispensa, troca de função, dormência) volta atrás: a porção retorna ao balcão e o cliente retoma a espera de onde parou (mínimo 5 s). Funcionário parado sai dos tiles vizinhos de móveis para não bloquear cadeiras.
- Cliente: ícone de garçom da barra inferior abre a janela "Funcionários" (`StaffModal`: vagas por nível, equipe com trocar função e dispensar, perfis para contratar). Cada função assa só os seus clipes (`WAITER_CLIPS`, `CLEANER_CLIPS`); trocar a função assa de novo.

## GDD resumido

**Loop central:** cozinhar → servir porções → clientes chegam conforme a popularidade → comem e pagam (moedas + XP) → o nível libera receitas, itens e funcionários → decorar e expandir aumenta a popularidade.

| Sistema | Situação | Sprint |
| --- | --- | --- |
| Economia: custo, porções, pagamento, níveis 1–260, popularidade | Implementado | 1 |
| Áudio Web Audio (amostras + síntese, trilha adaptativa, controle no HUD) | Implementado | 2 |
| Fogão completo (bônus, estragado, limpeza), balcão e livro de receitas por catálogo | Implementado (valores provisórios, arte placeholder) | 3 |
| Máquina de estados de clientes com paciência, lotação por cadeiras e reclamações | Implementado (fluxo de autosserviço no balcão) | 4 |
| Sujeira e limpeza (pratos por refeição, mesa bloqueada, limpeza com animação) | Implementado (valores provisórios) | 5 |
| Funcionários (garçom com bandeja, faxineiro, vagas por nível) | Implementado (perfis e tempos provisórios) | 6 |
| Construção, loja por categoria, expansão do café | Parcial: grade, arrastar, girar, guardar e comprar existem | 7 |
| Juice e modal de nível | Parcial: moedas/XP flutuantes e aviso de nível | 8 |

- **Fogão e cliente:** ver "Cozinha e clientes". O config cita `stoveCleaningCoinCost`, `stoveCleaningXPGain`, `waitingChairTime`, `waitingFoodTime`, `eatingTime` e `dishPickupTime`, todos com valores adulterados.
- **Fluxo decidido:** o cliente pega a porção do balcão sentado (autosserviço). Garçons (Sprint 6) levarão o prato do balcão à mesa; os campos `dishPickupTime` do config apontam para essa entrega.
- **Sujeira:** ver "Sujeira e limpeza (Sprint 5)". Comida estragada continua sendo limpa no fogão.
- **Funcionários:** decidido o meio-termo: personagens predefinidos agora, amigos depois (`friend_user`). O config só traz o limite por nível (`employees/amountLocks`) e o amigo padrão `vostuFriend` (`vostu-waiter.png`).
- **Prédios da rua (futuro):** a Fazenda vira colheita de ingredientes especiais com bônus nas receitas; a Discoteca, um evento "Festa VIP / Happy Hour".
- **Áudio:** ver a seção "Áudio (Sprint 2)".

## Roteiro de sprints

1. **Regras compartilhadas e ciclo econômico** (concluída): `gamerules`, custo e porções, pagamento, níveis, popularidade, spawn por popularidade, moedas/XP flutuantes e aviso de nível.
2. **AudioEngine** (concluída): mixer Web Audio, sons originais com síntese de reserva, duas trilhas procedurais adaptativas, controle no HUD, Recortador de SFX e primeira suíte Vitest. Pendente do responsável: ouvir e rotular os trechos de `compiled_sfx.mp3`. A urgência de "comida prestes a queimar" entra com o estado estragado (Sprint 3).
3. **Fogão e balcão** (concluída): tempero, estragado e limpeza por timestamp, ajuda de emergência, balcão com mescla de porções, livro de receitas por catálogo, rota `GET /api/coffe/rules` e arte placeholder substituível.
4. **Clientes** (concluída): `customers.go`, paciência de 40 s persistida na dormência, lotação por cadeiras com mesa, chegada mais lenta com prato no fogo e balcão vazio, balão de paciência.
5. **Sujeira e limpeza** (concluída): pratos por refeição na transação do pagamento, mesa suja bloqueada, clientes bravos sem mesa limpa, limpeza validada pelo servidor com o clipe `CLEAN`. Junto: regra da cozinha parada e os dois prédios da rua.
6. **Funcionários** (concluída): `room_staff`, vagas por nível do config, garçom que leva o prato na bandeja e recolhe pratos, faxineiro, janela de gerenciamento. Junto: cliente `browsing` sem penalidade e com paciência renovada no primeiro prato.
7. **Construção e expansão:** categorias da loja, decoração com bônus de popularidade e compra de área (`tiles_x`/`tiles_y`, até 40). O conteúdo depende dos PNGs processados no Asset Studio.
8. **Juice e testes:** modal de nível com desbloqueios, barras sobre clientes e suites Vitest/Playwright conforme AGENTS.md.

## Débitos técnicos

- `RoomScreen.ts` (~2,8 mil linhas) e `runtime.go` (~1,2 mil linhas): extrair controladores (cozimento, mesas, atores ao vivo) ao alterar essas áreas, não em refatorações isoladas. A máquina de estados dos clientes já saiu para `customers.go`.
- Só `cake_1` tem PNG; as outras nove receitas e o balcão usam arte desenhada em canvas até o processamento no Asset Studio.
- Moedas creditadas ao entregar a porção: um quarto que dorme ou cai depois disso não perde pagamento. Para pagar só no fim da refeição, é preciso um recibo idempotente persistido com o NPC.
- Memória dos avatares: cada funcionário assa de 60 a 65 células de 256 px (cerca de 15 MB de textura); com 7 funcionários e 6 clientes o total passa de 150 MB. Se pesar em celulares, reduzir a célula dos NPCs.
- Com garçom em serviço o atendimento leva alguns segundos (andar até o balcão e até a mesa), mais lento que o autosserviço instantâneo; o ganho é a coleta automática dos pratos. Se dispensar o garçom virar vantagem, criar um custo para o autosserviço.
- Falha intermitente não reproduzida: em uma execução, `cook_start` voltou sem chegar à persistência (sem `game-internal/operation` no log). As candidatas são as validações do servidor ("Aproxime seu personagem do fogão" e "Aguarde o preparo"), herdadas da versão inicial. Duas repetições passaram.
- Lockfile: o npm 10.9 falha com `edgesOut` ao adicionar dependências com peers opcionais, e o npm 11.6 remove os campos `libc` do lockfile. Para alterar dependências, use npm ≥ 11.20 (o projeto exige Node 24, que traz o npm 11).

## Verificação

- Go: `go vet ./...` e `go test ./shared/... ./database/ ./game-server/...` (use `-race` em `gameruntime`). Testes de persistência usam banco temporário e as migrações reais.
- Cliente: `npm run typecheck` e `npm test` (Vitest: música, preferências, manifesto de sprites, detecção do Recortador, disponibilidade e páginas do livro, estados do fogão e paciência).
- E2E manual: binários compilados do código atual, banco novo em diretório temporário, portas próprias (ex.: 18090/18091/15173) e Chromium com `--use-gl=swiftshader`. Para testar a ajuda de emergência, crie um superusuário no banco temporário e ajuste `gold` em `player_state`. Encerre o servidor do jogo (SIGINT) antes do PocketBase para o salvamento final.
