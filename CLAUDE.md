# CLAUDE.md — Coffe Mania

@AGENTS.md

AGENTS.md (importado acima) é a fonte das regras de trabalho, comandos, portas, referências de renderização e origem dos assets. Este arquivo acrescenta apenas a arquitetura de estado, o contrato das regras de jogo, o GDD resumido das expansões e o roteiro de sprints. Em caso de conflito, AGENTS.md prevalece. O README.md continua reservado ao responsável pelo projeto.

## Stack

| Camada | Tecnologia | Pasta |
| --- | --- | --- |
| Cliente | TypeScript 5.9 estrito, PixiJS 8, Vite 7 | `game/` |
| Simulação dos quartos | Go 1.27, WebSocket (`coder/websocket`), uma goroutine por quarto | `game-server/` |
| Persistência | PocketBase 0.40 (SQLite), migrações em Go, SSE; regras em `shared/cafe` | `database/` |
| Modo standalone | o mesmo Go compilado para WebAssembly num Web Worker, save em IndexedDB | `game-server/standalone/`, `game/src/standalone/` |
| Contratos | Go sem dependências: protocolo (`gamewire`), itens (`roomcatalog`), regras (`gamerules`) | `shared/` |
| Testes JS | Vitest 4.1.11 (raiz), lógica pura do cliente e das ferramentas | `tests/unit/`, `tests/tools/` |

## Autoridade do estado

| Estado | Dono | Chega ao cliente por |
| --- | --- | --- |
| Posição, caminho, ações, clientes NPC, emoções | game-server, em memória | eventos WebSocket ordenados (`epoch` + `seq`) |
| Moedas, Grana, XP, nível, popularidade, inventário, fogões, pratos | PocketBase, em transações | snapshot HTTP + SSE de `player_state` |
| Interpolação, câmera, HUD, efeitos visuais, áudio | cliente | — |
| Preferências (volumes, mudo, faixa, zoom bitter) | `localStorage`, por jogador | — |

- Estado de jogo não vai para `localStorage`: o cliente não é confiável e o café é compartilhado com visitantes em tempo real. Exceção deliberada: no modo standalone o café é só do jogador, e o motor (o mesmo Go) roda num Web Worker com o save no IndexedDB e uma cópia no `localStorage` ao sair (ver "Modo standalone").
- Progresso offline sai de instantes absolutos gravados no banco (`preparing_at`, `started_at`, `ready_at`, `spoils_at`, `room_dirt.created`); o snapshot calcula o estado a partir de `now`. Novos timers (contratar, turnos) seguem o mesmo padrão: gravar o instante, nunca decrementar por tick.
- Sem humanos, o quarto aguarda 30 s, salva os NPCs (`ActionRemaining`, `PatienceRemaining`), grava `player_rooms.slept_at` e dorme. Ao acordar, a persistência conta o expediente da ausência (ver "Expediente offline"); ausências curtas (< 2 min) só deslocam os relógios pela pausa.
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

Eventos do protocolo: `welcome` (ao dono, com `away` quando há resumo da ausência), `actors`, `world` (com `tilesX`/`tilesY` quando o café cresce e `street` quando a Fazenda ou a Discoteca mudam), `food` e `dirt` (sempre a lista completa; ausente = vazia), `payment` (`coins` é o total; `tip` e `freshCoins`/`freshXp` são partes dele), `ack`, `error`. Todo broadcast incrementa `seq`; o cliente reconecta ao detectar lacuna. Campos de dormência (`path`, `visits`) não são transmitidos.

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

- **Fogão** (`shared/cafe/cooking.go`, estado derivado de timestamps em `JobState`): vazio → `preparing` (2 s) → `cooking` → `ready` → `spoiled` em `spoils_at` (= pronto + `spoilSeconds` da receita; jobs antigos sem o campo usam essa mesma conta). Estragado não serve: só `cook_clean`, que dá `cleaningXp` e cobra `cleaningCoins` (hoje 0).
- **Temperar** (`cook_season`): uma vez por lote, durante `preparing`/`cooking`, soma `seasonBonusPercent` das porções (arredonda para cima, mínimo 1) e dá `seasonXp` a quem temperou. É a única ação permitida a visitantes, que precisam estar dentro do café; o `GET` da cozinha esconde deles a ajuda de emergência.
- **Ajuda de emergência:** a receita liberada mais barata sai com custo 0 só quando as moedas não pagam essa receita **e** não há preparo vivo (preparando, cozinhando ou pronto) nem comida no balcão. A condição é recalculada dentro da transação de `cook_start`; o cliente apenas exibe "Grátis (Ajuda de Emergência)".
- **Balcão** (`serving_counter`, id 3080000, `kind: counter`, placeholder sem PNG): servir escolhe no servidor um balcão com a mesma receita (soma porções) ou um vazio. Sem balcão livre, o servir falha com 409. Balcão com comida não pode ser movido nem guardado. A migração `202610140001` dá um balcão às salas antigas em (7,3), guardado no inventário se o tile estiver ocupado.
- **Clientes** (`game-server/gameruntime/customers.go`): entrar → reservar cadeira com mesa limpa → sentado aguardando (paciência `patienceSeconds` = 40 s, transmitida em `actor.patience`) → pegar porção do balcão → comer → pagar → sair. Sem garçom, pegar a porção leva `service.selfPickupMs` (3,5 s, ação `fetching`): a porção fica reservada, a paciência pausa e o balão do cliente enche em azul; só então `/consume` paga. Sem comida no prazo ou sem mesa limpa: emoção brava, `/feedback` e −0,3 de popularidade. A lotação acompanha as cadeiras com mesa (`diningChairs`, incluindo as de mesas sujas); com o balcão vazio e um prato no fogo, o intervalo de chegada é multiplicado por `cookingArrivalFactor` (1,5).
- **Cozinha parada** (`kitchenIdle`: nenhuma porção no balcão e nenhum preparo vivo, isto é, preparando, cozinhando ou pronto sem estragar): entra no máximo um cliente "olhando o cardápio", marcado `browsing` (persistido na dormência). Quem sai sem comer com a cozinha parada, ou marcado `browsing`, mostra a cara neutra, sem `/feedback` nem perda de popularidade. Quando o primeiro prato vai ao fogo (`watchKitchen`), quem está sentado com a marca ganha a paciência inteira de novo. O cliente pinta o balão desses clientes de cinza-azulado.
- **Cliente:** livro de receitas lido de `rules` (abas por faixa de nível, bloqueio por nível, custo em vermelho quando falta moeda; dois toques no mesmo cartão ou o botão cozinham, e o cartão pré-selecionado nunca cozinha com um toque), menu contextual do fogão (`StoveActionMenu`), fumaça e balão de pronto com urgência (`StoveEffects`), prato e contador ×N no balcão (`CounterDish`), balão de paciência (`PatienceMeter`) e prato da receita certa na mesa.
- **Arte provisória:** `placeholder-art.ts` desenha itens com `"placeholder": true` e `parts: []` no mesmo enquadramento do Asset Studio (origem do tile, 160×80). Ao exportar o PNG real, preencha `parts`, remova `placeholder` e rode `npm run assets:room`.

## Sujeira e limpeza (Sprint 5)

- Cada refeição paga deixa um prato na mesa: `ServeCustomer` grava um registro em `room_dirt` (`user`, `table_id`, `created`) na mesma transação do pagamento. O servidor do jogo espelha o prato (`addDirt`) e transmite `dirt`; o snapshot do mundo agrupa os pratos por mesa (`gamewire.Dirt`: `tableId`, `plates`, `since`).
- Mesa suja não recebe cliente; as cadeiras dela ainda contam na lotação, então os clientes entram, não acham mesa limpa e saem bravos (fora da cozinha parada). Sem nenhuma cadeira limpa livre, entra só um cliente por vez (`cleanSeatFree`); antes disso, no E2E, três mesas sujas derrubaram a popularidade de 80 para 73,7 em poucos minutos. Mesa suja não pode ser movida nem guardada (`errTableDirty`).
- Limpar: o dono toca na mesa, o avatar anda até o lado dela e chama `POST /api/coffe/room/tables/clean` (`tableId`). O servidor do jogo valida a adjacência (operação `table_clean`), a persistência apaga os pratos e concede `tables.cleaningXp` (hoje 0). O avatar faz o clipe original `CLIP.CLEAN` (balde e escova) por `tables.cleaningSeconds` (2 s); a pose sai antes do evento `dirt`, e o cliente mantém os pratos até o fim da escova, quando eles somem com brilho e som de vassoura.
- Visual: `TableDirt` desenha até três pratos sujos em canvas; depois de 20 s aparecem moscas. Os valores de `tables` são provisórios: o config só nomeia `dishPickupTime` (adulterado), indício de que os pratos eram recolhidos após cada refeição.

## Prédios da rua

- Interativos desde a Sprint 9 (ver "Fazenda e Discoteca"). O cartão de cada prédio mostra a contagem regressiva e um "!" amarelo pula sobre o telhado quando o dono tem algo a colher ou iniciar.
- `game/src/world/street-scenery.ts` é o manifesto (`STREET_BUILDINGS`: id, nome, status, pegada em tiles fora do quarto, altura e `image` opcional) e guarda as faixas de rua e calçada medidas nos PNGs `CityBackground*` (`STREET_BANDS`). Um teste garante que nenhum prédio fica sobre a rua ou o quarto.
- `StreetScenery.ts` cria cada prédio no mundo com profundidade pela pegada no chão (`setRoomDepth`), hit area na silhueta, cartão de nome no hover/toque, pulso de neon, holofotes e cata-vento. `street-art.ts` desenha a arte em canvas na projeção do quarto.
- Hoje: Fazenda de Ingredientes (tx −17…−14, ty −1…1, entre a árvore de trás e o pinheiro da frente) e Discoteca (tx 1…4, ty −17…−14). Para trocar pela arte do Asset Studio, preencha `image` com o arquivo e os offsets `left`/`top` relativos ao vértice superior do tile (tx, ty), como nas partes dos itens.
- A câmera sobe até `bg.top + SCENE_CAMERA_TOP_INSET` (150) para alcançar os prédios; as laterais continuam com 900.

## Fazenda e Discoteca (Sprint 9)

- Regras (`street` em `rules.json`, definidas pelo responsável): Fazenda com `cooldownSeconds` 1200, `bonusPercent` 20 e `maxCharges` 1; Discoteca com `durationSeconds` 300, `cooldownSeconds` 1800 (contado do fim da festa), `arrivalFactor` 1,5 e `tipMultiplier` 2.
- Persistência (`shared/cafe/street.go`, migração `202610180001`): `player_rooms.farm_harvested_at`, `fresh_charges` e `party_started_at` (instantes, nunca contadores por tick). `StreetState` deriva `gamewire.Street` (`farmReadyAt`, `freshCharges`, `partyStartedAt`/`EndsAt`/`ReadyAt`), que vai no `World`, no snapshot do quarto e em eventos `world`. Rotas do dono: `POST /api/coffe/street/farm/harvest` e `/disco/party` → servidor do jogo (`farm_harvest`, `party_start`).
- Ingredientes frescos: colher dá uma carga (até `maxCharges`; com a carga guardada a colheita espera). O próximo `cook_start` consome a carga e marca o preparo `fresh`; cancelar devolve a carga (sem passar de `maxCharges`); servir soma as porções em `room_food.fresh_servings`. Cada porção fresca paga `FreshBonus` (20% arredondado para cima: +1 a +3 moedas e +1 XP nas receitas atuais), em `payment.freshCoins/freshXp`. O livro mostra "Ingredientes frescos: +20%", o balcão ganha uma folha verde e a moeda sobe como "+N fresco".
- Festa do Bairro: durante a janela, o intervalo de chegada é dividido por `arrivalFactor`, a gorjeta do garçom é multiplicada por `tipMultiplier` e quem se serve sozinho também dá a gorjeta básica (`ServeServing` decide pela janela no instante do pagamento). O cliente acende luzes coloridas sobre o piso (`PartyLights`, recortadas pelo losango do café), mostra o selo "Festa do Bairro · m:ss", acelera os holofotes da Discoteca e troca a música pela faixa procedural "Festa do Bairro" (`FESTA_DO_BAIRRO`, disco-funk a 122 bpm, só na festa; `AudioEngine.setOverride` não altera a preferência). Visitantes veem e ouvem a festa. Nível da faixa ainda não medido em LUFS.
- `StreetModal`: janela do dono com descrição, contagem e o botão (Colher ingredientes / Começar a festa).

## Expediente offline (Sprint 9)

- Quando o quarto dorme, `SaveDormant` grava `player_rooms.slept_at`. No `load` seguinte (o quarto acorda), `WakeRoom` (`shared/cafe/offline.go`) roda numa transação: limpa `slept_at` (dois despertares simultâneos nunca contam duas vezes) e, se a ausência passou de `offline.minAwaySeconds` (120), chama `catchUp`.
- `catchUp` é determinístico e limitado a `maxAwaySeconds` (8 h); os valores de `offline` foram definidos pelo responsável. Ritmo de uma refeição = o mais lento entre chegadas pela popularidade (`CustomersPerMinute`), giro das cadeiras com mesa (`seatCycleSeconds` 30 por cadeira) e entregas do garçom (`deliverySeconds` 20 por garçom). Sem funcionários, cada cadeira de mesa limpa serve uma refeição e a mesa fica suja; com garçom ou faxineiro as mesas são limpas no fim e as cadeiras giram. Cada refeição passa por `ServeServing` no instante em que teria acontecido (gorjeta do garçom, festa e porções frescas valem). Só ganhos: sem comida ou sem porta o café fecha, e ninguém perde popularidade sem o dono presente. Pratos nos fogões não são servidos (é tarefa do dono) e estragam pelos próprios instantes. Os clientes salvos na dormência vão embora.
- O resumo (`gamewire.AwaySummary`: período, tempo contado e tempo cortado pelo limite (`cappedMs`), porções, moedas, gorjetas, frescos, XP, nível, popularidade, pratos sujos/recolhidos, equipe, porções restantes, pratos prontos/estragados no fogão) acumula em `player_rooms.away_summary` até o dono confirmar (`POST /api/coffe/room/away/ack`). Com o quarto dormindo, só o `welcome` do dono o traz, já somado à nova ausência; o snapshot o traz quando o quarto está acordado (um visitante acordou antes). Visitantes nunca o recebem. O `ack` lê e grava numa transação, para não restaurar o `slept_at` de um despertar concorrente.
- Cliente: `WelcomeBackModal` "Bem-vindo de volta!" (`awayLines` em `game/src/game/away.ts`) abre quando nenhuma outra janela está aberta. Um resumo com o mesmo `from` de um já mostrado é a versão somada: substitui a janela aberta ou, depois do Coletar, mostra só a diferença (`awayAddition`); "Coletar" confirma e faz as moedas e o XP subirem sobre o avatar (o crédito já aconteceu ao acordar).

## Funcionários (Sprint 6)

- Regras: `staff` em `rules.json` (perfis predefinidos e tempos, provisórios; `hireCoins` é a taxa única de cada vaga, definida pelo responsável: 0, 300, 800, 2.000, 5.000, 10.000 e 20.000) e `employeeLocks` do config (`EmployeeSlots(level)`: 1 vaga no nível 1, 2 no 7 … 7 no 47). O perfil "Amigo Vostu" referencia o `vostuFriend` do config.
- Persistência: `room_staff` (`user`, `profile`, `name`, `role` garçom/faxineiro, `appearance` sorteada uma vez na política dos clientes, `friend_user` opcional e reservado para contratar amigos). Rotas do dono: `GET /api/coffe/staff` e `POST /api/coffe/staff/{hire,role,dismiss}`, que passam pelo servidor do jogo (`staff_*`) e devolvem o mundo com `World.staff`.
- Simulação (`game-server/gameruntime/staff.go`): os funcionários vivem só na memória do quarto (`kind: staff`, `role`) e aparecem dentro da porta. Com garçom em serviço os clientes não se servem sozinhos: o garçom reserva uma porção (`reserved`), anda até o balcão (`picking`, clipe `WAITOR_WORKING`), leva o prato na bandeja (`carrying`, `WAITOR_WALK` com o prato desenhado na bandeja) e entrega; o pagamento e o prato sujo saem na entrega (`Consume`). Enquanto o garçom vem, a paciência do cliente fica pausada. Sem pedido, o garçom recolhe pratos (`busing`); o faxineiro só limpa mesas (`cleaning`, clipe `CLEAN`). As mesas ficam reservadas em `claimed`; a limpeza dos funcionários usa `/game-internal/{owner}/clean-table`, sem XP para o dono.
- Taxa por vaga: `player_rooms.staff_slots` conta as vagas já pagas (a migração `202610170001` conta a equipe existente). Contratar numa vaga nunca preenchida cobra `HireCost(vaga)` na mesma transação; dispensar e recontratar na mesma vaga é grátis; trocar de função é sempre grátis. `GET /api/coffe/staff` devolve `hireCoins` (custo da próxima contratação), `paidSlots` e `slotFees`.
- Garçom sempre melhor que autosserviço: além de recolher pratos, a entrega do garçom chama `/consume` com `waiter: true` e o cliente dá gorjeta (`WaiterTip`: 10% do preço, mínimo 1 moeda, valores provisórios), que sobe em verde ("+1 gorjeta") junto com o pagamento. A tabela `<tips>` do config (100 a 500 moedas por faixa de nível) não serve como gorjeta por prato (pratos valem 3 a 14); seu significado é desconhecido e ela segue sem uso.
- Quem pega o trabalho: o funcionário livre (sem tarefa, parado e sem caminho) mais próximo, em passos, do balcão para entregas ou da mesa suja para limpeza (`nearestIdle`; empate pelo id). Os outros deixam a tarefa para ele, que a assume no próximo segundo ocioso. Quem anda ou espera um passo bloqueado não conta: um funcionário preso seguraria a tarefa de todos.
- Trabalho interrompido (dispensa, troca de função, dormência) volta atrás: a porção retorna ao balcão e o cliente retoma a espera de onde parou (mínimo 5 s). Funcionário parado sai dos tiles vizinhos de móveis e da porta (o tile da porta e os vizinhos dele, por onde todo cliente passa): os funcionários nascem na porta, e sem essa regra um quarto que acordava sem trabalho deixava o garçom parado ali, travando quem entrava e quem saía (visto no E2E da Sprint 7). Última defesa (`clearDoorway`, decisão do responsável): funcionário parado ou esperando no tile da porta ou num vizinho dele por `doorwayGrace` (2 s), sem estar trabalhando, é posto no tile livre mais próximo dentro do salão, de preferência fora dos vizinhos de móveis; assim um cliente nunca fica preso na entrada ou na saída.
- Cliente: ícone de garçom da barra inferior abre a janela "Funcionários" (`StaffModal`: vagas por nível, equipe com trocar função e dispensar, perfis para contratar). Cada função assa só os seus clipes (`WAITER_CLIPS`, `CLEANER_CLIPS`); trocar a função assa de novo.

## Expansão do café (Sprint 7)

- Regras: `expansions` em `rules.json`. O café nasce 8×8 e cresce 2×2 por passo até 20×20, o limite do cliente (`tileIndex` empacota `ty * 20 + tx`; `gamerules.MaxRoomTiles`). Preços e níveis definidos pelo responsável: 10×10 (nível 5, 2.000 moedas ou 10 Grana), 12×12 (10; 6.000 ou 20), 14×14 (15; 15.000 ou 35), 16×16 (22; 35.000 ou 50), 18×18 (30; 75.000 ou 75), 20×20 (40; 150.000 ou 100). Moedas exigem o nível; Grana é o atalho sem nível. Cada passo devolve `rewardCoins` (250, do `<expansions><newsFeed><rewardCoins>` do config, que lá premiava cliques de amigos na publicação) e XP provisório (20 a 440).
- Persistência (`shared/cafe/expansion.go`): `POST /api/coffe/room/expand {tiles, pay}` → servidor do jogo (`room_expand`) → transação que confere o passo seguinte (`tiles` precisa ser ele, então repetir o pedido nunca cobra duas vezes), nível, moedas ou Grana, credita prêmio e XP (`Grant`, com subida de nível), cria piso e paredes dos tiles novos e incrementa a revisão. Piso novo = o piso mais usado; parede nova = segmento + o papel de parede mais usado daquele lado (o outro lado, se este estiver nu). As paredes ficam em tx=0 e ty=0, então o café cresce para a frente e nada sai do lugar.
- Servidor do jogo: `updateWorld` reconstrói a grade quando `TilesX`/`TilesY` mudam e manda `world` com o tamanho novo; atores e caminhos continuam válidos.
- Cliente: botão "Expandir café" no cabeçalho da Loja e atalho "Expandir" no modal de nível abrem `ExpansionModal` (planta atual/próxima, cartões Moedas e Grana com bloqueio por nível ou saldo, recompensa e trilha de passos). `RoomModel.resize` mantém o mesmo modelo (navegação, loja e NPCs já o referenciam), e `applyRoomSnapshot` redesenha piso, paredes e grade de toque sem recarregar a página. Os tiles novos brilham para todos que estão no café (`ExpansionGlow`); o dono ouve a fanfarra e vê "Café ampliado!" com moedas e XP subindo.

## Subida de nível (Sprint 8)

- `levelUnlocks(rules, de, até, lado)` e `nextUnlocks(rules, nível, lado)` (`game/src/game/game-rules.ts`) leem receitas por nível, `employeeLocks` e `expansions` das regras públicas (expansões que o café já tem ficam de fora); os itens da loja ainda não têm nível mínimo.
- `LevelUpModal`: "Nível N!", moedas do prêmio, cartões do que abriu (receitas com a arte, nova vaga de funcionário, expansão liberada para moedas), próximos objetivos e atalhos "Ver receitas", "Contratar" e "Expandir". Vários níveis de uma vez mostram tudo o que abriu no intervalo.
- `celebrateLevel` mostra uma vez por nível, a partir do primeiro sinal: o evento `payment` ou o estado do jogador por SSE (tempero e limpeza também dão XP). `knownLevel` nasce no construtor para o carregamento nunca repetir uma subida. Com outra janela aberta, cai no aviso curto (`LevelUpToast`).

## GDD resumido

**Loop central:** cozinhar → servir porções → clientes chegam conforme a popularidade → comem e pagam (moedas + XP) → o nível libera receitas, itens e funcionários → decorar e expandir aumenta a popularidade.

| Sistema | Situação | Sprint |
| --- | --- | --- |
| Economia: custo, porções, pagamento, níveis 1–260, popularidade | Implementado | 1 |
| Áudio Web Audio (amostras + síntese, trilha adaptativa, controle no HUD) | Implementado | 2 |
| Fogão completo (bônus, estragado, limpeza), balcão e livro de receitas por catálogo | Implementado (valores provisórios, arte placeholder) | 3 |
| Máquina de estados de clientes com paciência, lotação por cadeiras e reclamações | Implementado (autosserviço com atraso de 3,5 s; garçom entrega com gorjeta) | 4 |
| Sujeira e limpeza (pratos por refeição, mesa bloqueada, limpeza com animação) | Implementado (valores provisórios) | 5 |
| Funcionários (garçom com bandeja, faxineiro, vagas por nível, taxa única por vaga) | Implementado (perfis, tempos e gorjeta provisórios) | 6 |
| Expansão do café (8×8 → 20×20, moedas + nível ou Grana) | Implementado | 7 |
| Construção, loja por categoria, decoração com bônus de popularidade | Parcial: grade, arrastar, girar, guardar e comprar existem | 7 |
| Juice e modal de nível | Modal de nível com desbloqueios implementado; moedas/XP flutuantes | 8 |
| Fazenda (ingredientes frescos) e Discoteca (Festa do Bairro) | Implementado (valores definidos pelo responsável) | 9 |
| Expediente offline com "Bem-vindo de volta!" | Implementado (valores definidos pelo responsável, só ganhos) | 9 |
| Modo standalone (jogo inteiro no navegador, sem servidores) | Implementado (sem recursos sociais; exportar/importar o save pendente) | 10 |

- **Fogão e cliente:** ver "Cozinha e clientes". O config cita `stoveCleaningCoinCost`, `stoveCleaningXPGain`, `waitingChairTime`, `waitingFoodTime`, `eatingTime` e `dishPickupTime`, todos com valores adulterados.
- **Fluxo decidido:** sem garçom, o cliente pega a porção do balcão (autosserviço, 3,5 s); com garçom, o prato vai do balcão à mesa na bandeja e rende gorjeta. O `dishPickupTime` do config (adulterado, 0) sugere esse tempo de coleta, sem valor confiável.
- **Sujeira:** ver "Sujeira e limpeza (Sprint 5)". Comida estragada continua sendo limpa no fogão.
- **Funcionários:** decidido o meio-termo: personagens predefinidos agora, amigos depois (`friend_user`). O config só traz o limite por nível (`employees/amountLocks`) e o amigo padrão `vostuFriend` (`vostu-waiter.png`).
- **Prédios da rua:** ver "Fazenda e Discoteca (Sprint 9)".
- **Gorjetas:** a gorjeta por prato (10%, mínimo 1) fica como está. A tabela `<tips>` do config (100 a 500 por faixa de nível) fica reservada para o pote de gorjetas da Sprint 16.
- **Áudio:** ver a seção "Áudio (Sprint 2)".

## Roteiro de sprints

1. **Regras compartilhadas e ciclo econômico** (concluída): `gamerules`, custo e porções, pagamento, níveis, popularidade, spawn por popularidade, moedas/XP flutuantes e aviso de nível.
2. **AudioEngine** (concluída): mixer Web Audio, sons originais com síntese de reserva, duas trilhas procedurais adaptativas, controle no HUD, Recortador de SFX e primeira suíte Vitest. Pendente do responsável: ouvir e rotular os trechos de `compiled_sfx.mp3`.
3. **Fogão e balcão** (concluída): tempero, estragado e limpeza por timestamp, ajuda de emergência, balcão com mescla de porções, livro de receitas por catálogo, rota `GET /api/coffe/rules` e arte placeholder substituível.
4. **Clientes** (concluída): `customers.go`, paciência de 40 s persistida na dormência, lotação por cadeiras com mesa, chegada mais lenta com prato no fogo e balcão vazio, balão de paciência.
5. **Sujeira e limpeza** (concluída): pratos por refeição na transação do pagamento, mesa suja bloqueada, clientes bravos sem mesa limpa, limpeza validada pelo servidor com o clipe `CLEAN`. Junto: regra da cozinha parada e os dois prédios da rua.
6. **Funcionários** (concluída): `room_staff`, vagas por nível do config, garçom que leva o prato na bandeja e recolhe pratos, faxineiro, janela de gerenciamento. Junto: cliente `browsing` sem penalidade e com paciência renovada no primeiro prato.
7. **Expansão** (concluída): seis passos até 20×20 com moedas + nível ou Grana, piso e paredes no visual atual, grade e limites ao vivo, celebração e cartão no modal de nível. Junto: taxa única por vaga, atraso do autosserviço e gorjeta do garçom. Ajustes: Grana inicial 25, funcionário livre mais próximo assume a tarefa, `nextStep` contorna a quina bloqueada. A loja e a decoração passaram para a Sprint 13.
8. **Modal de nível** (concluída): desbloqueios e atalhos. As suites Playwright passaram para a Sprint 17.
9. **Rua viva e expediente offline** (concluída): Fazenda (ingredientes frescos, +20% por porção), Discoteca (Festa do Bairro: mais clientes, gorjeta em dobro, luzes e trilha própria) e resumo "Bem-vindo de volta!" contado ao acordar o quarto.

### Próximas sprints

Fruto da auditoria abaixo. Cada sprint fecha botões ou abas que hoje não fazem nada e acrescenta um motivo para voltar ao jogo. Os valores novos entram como provisórios em `rules.json` (marcados `"provisional": true`). Até a sprint de cada um, os ícones mortos devem pelo menos responder com "Em breve" (Sprint 11).

10. **Modo standalone** (concluída): domínio da persistência extraído para `shared/cafe`, motor Go/WASM num Web Worker, save em IndexedDB, pausa da aba com expediente ao voltar e builds estáticos. Ver "Modo standalone (Sprint 10)".
11. **Polimento e retenção diária** (próxima):
    - Nenhum ícone mudo: cartão "Em breve" com o nome do sistema e a sprint; `striped-chicken` passa a abrir a Fazenda (`StreetModal`); `house` e `waiter` somem para visitantes.
    - **Correio** (`mail`): caixa `player_mail` para resumos, prêmios e avisos; a primeira carta é a "Carta de Boas-Vindas" (+50 moedas, uma vez por conta), no lugar das 5.000 moedas do nível 1 do config. A fila de janelas de entrada (`<principal>`, uma vez por dia) mostra o "Bem-vindo de volta!" e o bônus diário.
    - **Bônus diário** de 6 dias (`<dailyBonus>` do config dá só a quantidade de dias; os prêmios são de design): `last_claim_at` e `streak` em `player_state`, resgate idempotente pela data em America/Sao_Paulo. O 6º dia é a primeira fonte de Grana.
    - **HUD**: a barra de XP mostra o progresso dentro do nível; botões "+" (Moedas abre a Loja, Grana abre fontes e usos); rosto de humor abre o painel de Popularidade; renomear o café (rota POST validada). Visitantes passam a ver o nome e a popularidade do café visitado.
    - **Correções da auditoria**:
      - Guarda-roupa: Confirmar desativado ao reabrir um rascunho; as 4 cores escondidas em cada paleta; aba de calçados vazia ("Em breve" ou escondida); aba "óculos" que abre marcas do rosto (renomear para "Rosto").
      - Configurações: retrato do avatar na moldura vazia; mudo, faixa, tela cheia e "Sair"; teclado no mudo partindo do volume guardado.
      - Livro: as abas 3 e 4 viram categorias de receita (campo `category`); filtro "Só posso cozinhar"; aviso quando não há fogão livre; o atalho "Ver receitas" escolhe um fogão.
      - Fogão: confirmação ao cancelar o preparo (hoje sem reembolso).
      - Carregamento: erro com "Tentar novamente".
      - Depuração: HUD só com `?debug`.
      - Textos: "ouro" → "moedas".
12. **Missões e conquistas**:
    - **Conquistas** (`trophy` e o item Painel de Conquistas): `served_dishes`, `unique_dishes` e `spent_coins` com os 5 degraus e prêmios do `<achievements>`. Os contadores ficam em `player_stats` e sobem nas transações que já existem (`/consume`, `cook_start`, débitos). O resgate passa por `playerstate.Grant`.
    - **Missões diárias**: 3 por dia, sorteadas de um pool próprio (servir N porções, temperar, limpar mesas, cozinhar a receita X), com progresso pelas mesmas transações. O config só cita os códigos das metas, sem as definições.
    - Conquistas e missões são a segunda fonte de Grana.
13. **Loja e decoração** (o resto da antiga Sprint 7; depende dos PNGs do Asset Studio):
    - Campo `level` no `item.json`, validado na compra.
    - Mesas e cadeiras compráveis: são a alavanca de lotação que falta.
    - Categoria `counter` corrigida (hoje mapeada para `stove`); `stove-fire` com fogões extras (`player_stoves` criado na compra).
    - Decoração com `popularityTenths` somado no servidor do jogo a partir das unidades colocadas, sem gravar por tick e respeitando o teto de 105.
    - Aba "Novidades" com os itens do nível.
    - Caixa registradora: "Caixa do dia" ou venda de volta, com taxa de design (o `sellBackRatio` do config está adulterado).
14. **Despensa e caixas**:
    - **Temperos** (`mortar`): os códigos 800001–800003 viram consumíveis que reforçam o `cook_season`. Os efeitos são de design; o config não traz nomes nem efeitos. Ligam-se ao banner "Condimentos instantâneos" da tela de carregamento.
    - **Caixas misteriosas** (`yellow-box`, `<misteryCrate>`): os preços do config ficam como referência; os pacotes passam a usar itens do nosso catálogo (os códigos do config não existem nele). O sorteio usa `crypto/rand` na transação do débito, com chave idempotente.
    - **Barra "Caixas"** (4/4, sem significado confirmado): caixas de ingredientes enchidas pela Fazenda.
15. **Vizinhança**:
    - **Vizinhos reais** nos 8 slots "beta" (hoje com níveis fixos e número aleatório), com as setas da barra paginando (hoje mortas).
    - **Vizinhos NPC** (`<special_neighbors>`: um sempre disponível e outro no nível 69) para temperar e ganhar o prêmio diário.
    - **Mapa** (`map`): rua e cafés vizinhos.
    - **Presentes diários** (`gift`, `<pushGift>`: 5 por dia, 250 moedas + 3 XP).
    - **Contratar amigo** (`room_staff.friend_user`).
    - **Clientes conhecidos**: `friendCustomerProbability` 0,3 do config como referência.
    - **Energia** (hoje 50/50 fixo) regenerada por instante gravado, gasta em ações sociais opcionais.
16. **Clientes especiais e pote de gorjetas**:
    - **Clientes VIP e críticos** (`<visitors>` como modelo; o responsável trocou os nomes de pessoas reais por paródias, por exemplo "Mick Jaca", "Freddie Mercúrio", "Chef Jacquinho" e "Ana Maria Broa"): marca persistida na dormência como o `browsing`, pagamento multiplicado e "resenha" com bônus temporário de popularidade.
    - **Pote de gorjetas** com o teto diário da tabela `<tips>` por faixa de nível.
    - **Perfis de funcionário com atributo** (hoje só mudam nome e frase).
    - **Motor de dicas** (`<suggestions>`, `<inactivity>`).
17. **Testes e distribuição**:
    - Suites Playwright conforme AGENTS.md, com os roteiros E2E dentro do repositório.
    - Limpeza dos assets órfãos (o download duplicado já foi resolvido).
    - `DevPanel` só em DEV ou removido.
    - Medição em LUFS da faixa "Festa do Bairro".

## Modo standalone (Sprint 10)

O jogo roda sem servidores (GitHub Pages ou arquivos estáticos), com o save no navegador; com PocketBase e o servidor Go no ar, nada muda. O navegador executa o mesmo núcleo em Go, compilado para WebAssembly, e não uma reescrita em TypeScript: não há regra duplicada nem teste de paridade de simulação a manter.

- **Domínio sem PocketBase** (`shared/cafe`): quarto, cozinha, pagamento, sujeira, rua, equipe, expansão, expediente offline e a ponte do servidor do jogo (`PublicWorld`, `Operate`, `SaveDormant`, `LoadSeed`) rodam sobre a interface `cafe.Store` (`First`, `Find`, `Get`, `New`, `Save`, `Delete`, `Transaction` aninhável, `NPCLooks`). O servidor usa `database/pbstore` (PocketBase); o navegador usa `cafe.MemoryStore` (cópia por coleção na transação, um erro desfaz tudo, `Export`/`LoadMemoryStore` em JSON). `database/` ficou com rotas, autenticação, migrações e wrappers finos; `database/parity_test.go` roda o mesmo roteiro nos dois stores e exige resultados idênticos. Os catálogos de aparência foram para `shared/appearance` e `shared/npcappearance`.
- **Motor** (`game-server/standalone`): `Engine` cria o `gameruntime.Manager` sobre um `Storage` local e responde às rotas `/api/coffe` que o cliente usa (`router.go`); mudanças no quarto passam por `Manager.Operate`, como no servidor. `Connection` fala o protocolo do WebSocket (`join`, comandos, eventos com `epoch`/`seq`) e sobrevive à pausa. `standalone/wasm` é a ponte `syscall/js` (`start`, `fetch`, `connect`, `send`, `suspend`, `resume`, `export`); `gameruntime/http.go` sai do build `js`. Binário: 6,8 MB (1,8 MB com gzip).
- **Cliente**: `game/src/game/backend.ts` é a fronteira (`apiFetch`, `openRoomSocket`, `openRealtime`); os módulos de rede não sabem qual backend atende. `game/src/standalone/local-backend.ts` devolve `Response` reais, um socket e um SSE locais e conversa com `engine.worker.ts`, que carrega `wasm_exec.js` e `coffe.wasm` de `game/src/standalone/generated/` (importados com `?url`: no build, o nome leva o hash do conteúdo, contra cache velho). Erro do worker, mensagem ilegível ou partida sem resposta em 90 s viram a falha visível do modo offline, nunca uma tela parada.
- **Save** (`save-store.ts`): IndexedDB (`coffe-mania`/`saves`/`main`) com perfil local (id de 15 caracteres, nome "Jogador"), `savedAt` e o `Export` do café; cópia síncrona no `localStorage` ao sair, e a carga escolhe a mais nova. O worker salva depois de cada transação de jogo (`OnCommit`, agrupado em 400 ms), nunca por tick; o HUD só é avisado quando `player_state` muda.
- **Pausa e ausência**: aba escondida → `Suspend` (o quarto dorme como um quarto sem jogadores no servidor e grava `slept_at`) e save imediato; aba visível → `Resume`, a conexão entra no quarto novo e recebe outro `welcome`. Uma aba fechada sem esse save deixa `slept_at` vazio: na próxima abertura, `restore` usa o último instante visto (`coffe-standalone-seen`, gravado a cada 15 s e ao esconder, ou o `savedAt`) e descarta os clientes salvos. O `WakeRoom` conta o expediente e o "Bem-vindo de volta!" é o mesmo do servidor.
- **Modo**: build `npm run build:standalone` (`--mode standalone` ou `VITE_STANDALONE=true`, base relativa, `game/dist-standalone`), `?offline=1`, ou queda automática quando `/api/coffe/session` não responde (o selo "Offline · salvo neste navegador" avisa). Uma aba por café (`navigator.locks`, com 3 s de espera para o recarregar). Ficam de fora visitas, vizinhos, presentes e todo recurso social (Sprint 15).
- **Verificado ao vivo no Chromium, sem PocketBase nem servidor Go** (Vite em modo standalone e os dois builds de produção servidos como arquivos estáticos, um deles numa subpasta como no GitHub Pages): conta local nova, cozinhar, pagamento, recarregar com o save (moedas e XP preservados), aba escondida grava `slept_at`, ausência de 1 h com expediente (3 porções, +12 moedas, popularidade 80,3 → 80,6), aba fechada sem salvar contada do último instante visto (com subida de nível), segunda aba recusada e nenhuma requisição a `/api` ou `/game`. O build normal sem servidores tenta a sessão uma vez e cai no modo offline. O modo servidor seguiu igual (login, cozinhar, pagamento, nenhum download do motor).
- **Pendente**: exportar e importar o save (trocar de aparelho); medir o tempo de carga do worker em celulares.

## Auditoria da interface e dos dados (Sprint 9)

Feita por leitura do código (sem execução) e conferida por amostragem. Estados: funcional, parcial, morto (aparece mas não faz nada) e ausente. A sprint de cada item está em "Próximas sprints".

| Área | Funcional | Parcial | Morto ou ausente |
| --- | --- | --- | --- |
| Barra inferior (10 ícones) | `shirt` (guarda-roupa), `house` (loja), `waiter` (funcionários) | `house` e `waiter` aparecem para visitantes sem efeito | `trophy`, `gift`, `yellow-box`, `map`, `mortar`, `striped-chicken` e `mail` (hover sem ação; o significado original de `mortar`, `map` e `striped-chicken` não está confirmado) |
| Botões da barra | engrenagem (Configurações) | — | as 4 setas (só feedback visual) |
| Vizinhos | — | — | 8 slots "beta" com níveis fixos (7…150), número aleatório e sem toque |
| HUD superior | Moedas, áudio (mudo, faixa, volumes, M), tela cheia | Grana (não há como ganhar), XP (barra = XP total ÷ requisito cumulativo), rosto de humor e nome do café (só leitura; o visitante vê os próprios dados) | Energia 50/50 e Caixas 4/4 (nenhum código altera), botões "+", HUD de depuração visível a todos, `DevPanel` nunca instanciado |
| Loja | abas Loja e Inventário, paginação, Expandir, compra validada no servidor | categorias com 0 a 2 itens (piso 2, parede 2, porta 1, `stove` 1 = o balcão); itens sem nível mínimo; mensagens com "ouro" | aba Novidades (lista vazia fixa), caixa registradora (handler vazio), categorias `counter` e `stove-fire` (nenhum item cai nelas), mesa, cadeira, flores e janelas (0 à venda), bônus de popularidade por decoração |
| Livro de receitas | abas 1–2, cartões, Cozinhar, fechar | Cozinhar volta em silêncio sem fogão livre (inclusive pelo atalho "Ver receitas") | abas 3–4 (molduras sem conteúdo), filtro e ordenação |
| Guarda-roupa | olhos, sobrancelhas, boca, cabelo, barba, chapéu, calças, camisas, paginação, girar | aba "óculos" abre marcas do rosto; paletas mostram 12 de 16 cores; Confirmar desativado ao reabrir um rascunho; `cost` e `noHat` ignorados | aba de calçados (grupo vazio; o modelo não tem malha de sapato), desfazer |
| Configurações | volumes, modo bitter, fechar e teclado | setas no mudo partem de 0 | moldura do retrato vazia; sem mudo, faixa, tela cheia e sair |
| Funcionários, nível, expansão, fogão | contratar, trocar função, atalhos do modal de nível, expandir, Ver tempo, Temperar, Limpar | dispensar e gastar Grana sem confirmação; perfis só mudam nome; Cancelar preparo sem confirmação nem reembolso; visitante sem retorno ao tocar fogão pronto | contratar amigo |
| Carregamento | progresso, frases, segunda tela | banners anunciam condimentos e ingredientes raros (os ingredientes frescos já existem) | erro de asset deixa a tela presa, sem "Tentar novamente" |

**`game-config.xml.txt` sem uso:**
- **Usados hoje:** popularidade, níveis 1–260, `clientFrequency`, `amountLocks`, os 250 de `expansions/newsFeed` e o nome `vostuFriend`.
- **Sem uso, com destino no roteiro:** `achievements` (5 conquistas ativas), `dailyBonus` (6 dias), metas (25 códigos, sem definições), `pushGift`, `misteryCrate` (9 caixas e 45 pacotes com códigos fora do nosso catálogo), temperos 800001–800003, `special_neighbors`, `visitors`, `tips`, `suggestions`/`inactivity`/`principal` e `friendCustomerProbability`.
- **Sem destino:** `<level low frequency>` (interpretação incerta), `characterShadow` e `emailCampaignItems` (sem coleta de e-mail).
- **Adulterados, não usar:** `speedMultiplier`, `sellBackRatio` e `creditsToCoinsFactor` (99); `dishPickupTime`, `gatherTime` e `eatingTime` (0); `waitingChairTime`, `waitingDiningSetTime` e `waitingFoodTime` (999); `stoveCleaningXPGain` (999).
- **Decisão do responsável:** o `rewardCoins` de 5.000 do nível 1 não é pago (destruiria a progressão inicial e a ajuda de emergência); contas novas nascem com 100 moedas e 25 de Grana, e a Sprint 11 entrega uma "Carta de Boas-Vindas" no Correio com um incentivo pequeno (+50 moedas).

**Assets:**
- 14 arquivos órfãos, sem leitor:
  - 4 PNGs em `indoor/` (`Door-1`, `Door-2`, `Stove01-1`, `Wall17-1`);
  - `icon_bundle_2`…`7`, `wardrobe-icons/clothes.png` e `store-icons/crops.json` em `ui/` (6,6 MB);
  - `loading/geometry.json`;
  - `items/catalog.json`, gerado pelo `assets:room` e não lido pelo cliente.
- Resolvido depois da auditoria: `data/interior-items.json` (do Restaurant City, confirmado pelo responsável) e o `item-catalog.ts` que o lia saíram do projeto; os 23 PNGs de `indoor/` idênticos aos de `items/` foram apagados e o `indoor-art.json` aponta para os de `items/` (`../items/<classe>/<arquivo>`), então cada imagem é baixada uma vez. `mafia_tile_floor.png` e `mafia_wall.png`, cópias sem uso, também saíram.
- `compiled_sfx.mp3` continua sem trechos rotulados.

## Débitos técnicos

- `RoomScreen.ts` (~3 mil linhas) e `runtime.go` (~1,2 mil linhas): extrair controladores (cozimento, mesas, atores ao vivo) ao alterar essas áreas, não em refatorações isoladas. A máquina de estados dos clientes já saiu para `customers.go`.
- Só `cake_1` tem PNG; as outras nove receitas e o balcão usam arte desenhada em canvas até o processamento no Asset Studio.
- Moedas creditadas ao entregar a porção: um quarto que dorme ou cai depois disso não perde pagamento. Para pagar só no fim da refeição, é preciso um recibo idempotente persistido com o NPC.
- Memória dos avatares: cada funcionário assa de 60 a 65 células de 256 px (cerca de 15 MB de textura); com 7 funcionários e 6 clientes o total passa de 150 MB. Se pesar em celulares, reduzir a célula dos NPCs.
- Garçom × autosserviço: o autosserviço leva 3,5 s fixos; o garçom anda até o balcão e até a mesa (agora sempre o garçom livre mais próximo). Num café 20×20 a caminhada ainda pode passar de 3,5 s; a gorjeta e a coleta de pratos mantêm o garçom vantajoso.
- Grana: contas novas nascem com `playerstate.StarterCash` = 25 (decisão do responsável: um atalho de expansão para experimentar). Contas existentes mantêm o saldo; ainda não existe forma de ganhar Grana no jogo.
- Passo bloqueado: `nextStep` contorna uma quina diagonal ocupada ou um tile ocupado recalculando a rota; sem alternativa, jogador e funcionário esperam até `blockedRetries` (3) segundos e desistem (o funcionário escolhe outro tile ou tarefa), e o cliente NPC espera o tile liberar. Uma ação pedida pelo jogador parado nessa espera (cozinhar, servir, limpar) substitui a caminhada (`standStill`). O caso do avatar parado em (3,2) no E2E da Sprint 7 é atribuído a essa regra antiga, sem confirmação naquela execução.
- Travamento intermitente na porta (visto uma vez, no E2E da Sprint 9, logo após contratar o garçom com clientes comendo): o garçom ficou parado no tile da porta, três clientes saindo esperavam esse tile e os pratos não foram recolhidos por mais de 2 min. A causa não foi reproduzida (duas E2E completas, três rodadas ao vivo e `door_test.go`); a regra `clearDoorway` (ver Funcionários) desfaz esse estado em 2 s, qualquer que seja a causa. Se o garçom voltar a parar longe da porta, registre o estado do quarto (posição, caminho, `waits`, tarefa e `claimed` de cada ator) antes de mudar regras de navegação.
- Limite de 20×20: `tileIndex` do cliente empacota `ty * MAX_NUM_TILES_X + tx` com `MAX_NUM_TILES_X = 20`. Salas maiores (o servidor aceita até 40) exigem trocar essa chave antes de criar novos passos.
- Falha intermitente não reproduzida: em uma execução, `cook_start` voltou sem chegar à persistência (sem `game-internal/operation` no log). As candidatas são as validações do servidor ("Aproxime seu personagem do fogão" e "Aguarde o preparo"), herdadas da versão inicial. Duas repetições passaram.
- Lockfile: o npm 10.9 falha com `edgesOut` ao adicionar dependências com peers opcionais, e o npm 11.6 remove os campos `libc` do lockfile. Para alterar dependências, use npm ≥ 11.20 (o projeto exige Node 24, que traz o npm 11).

## Verificação

- Go: `go vet ./...` e `go test ./shared/... ./database/ ./game-server/...` (use `-race` em `gameruntime` e `standalone`). Testes de persistência usam banco temporário e as migrações reais; `database/parity_test.go` compara PocketBase e `MemoryStore`. O motor compila com `npm run wasm` (`GOOS=js GOARCH=wasm`).
- Cliente: `npm run typecheck` e `npm test` (Vitest: música, preferências, manifesto de sprites, detecção do Recortador, disponibilidade e páginas do livro, estados do fogão, paciência e busca do prato, prédios da rua, vagas e taxas de funcionários, desbloqueios de nível, oferta de expansão, `RoomModel.resize` e o backend local do modo standalone).
- Standalone: Vite com `--mode standalone` numa porta própria (os ganchos `__coffeMania` só existem no dev) e os builds de produção servidos como arquivos estáticos. No Chromium com `--use-gl=swiftshader` a carga é lenta (2–3 fps; o Pixi limita cada quadro a 100 ms, então a animação "Abrindo seu café" demora dezenas de segundos): use `?screen=room`.
- E2E manual: binários compilados do código atual, banco novo em diretório temporário, portas próprias (ex.: 18090/18091/15173) e Chromium com `--use-gl=swiftshader`. Para testar a ajuda de emergência, crie um superusuário no banco temporário e ajuste `gold` em `player_state`. Encerre o servidor do jogo (SIGINT) antes do PocketBase para o salvamento final.
