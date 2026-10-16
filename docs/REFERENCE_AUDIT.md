# Auditoria de referências visuais e de regras

Registro do que foi consultado (e do que não foi possível consultar) para orientar a arte e as regras inspiradas no Café Mania. Regra do projeto: nenhuma informação "histórica" entra no jogo ou na documentação sem uma fonte que tenha sido de fato lida.

## Tentativa de 16/10/2026 (Sprint 15a)

Fontes indicadas pelo responsável pelo projeto:

| # | Fonte | Assunto esperado | Resultado |
| --- | --- | --- | --- |
| 1 | https://www.behance.net/gallery/4432119/CafeMania | portfólio de arte | **não acessada** |
| 2 | https://www.behance.net/gallery/12918119/Cafe-Mania | portfólio de arte | **não acessada** |
| 3 | https://jogandocafemania.blogspot.com/2010/07/chegaram-os-itens-do-japao.html | itens do tema Japão | **não acessada** |
| 4 | https://jogandocafemania.blogspot.com/2010/08/mamma-mia.html | itens do tema Itália | **não acessada** |
| 5 | https://cafemaniaevolution.blogspot.com/2012/03/faq-basico-da-cozinha.html | FAQ da cozinha | **não acessada** |
| 6 | https://cafemaniaevolution.blogspot.com/2012/03/faq-comprando-vendendo-e-decorando.html | FAQ de compra, venda e decoração | **não acessada** |
| 7 | https://cafemaniaevolution.blogspot.com/2012/03/faq-temperos-e-prateleira.html | FAQ de temperos e prateleira | **não acessada** |
| 8 | https://cafemaniaevolution.blogspot.com/2012/03/faq-sucos-cafes-e-maquinas.html | FAQ de sucos, cafés e máquinas | **não acessada** |

**Motivo:** a política de rede do ambiente de desenvolvimento em nuvem recusou os três domínios (`www.behance.net`, `jogandocafemania.blogspot.com`, `cafemaniaevolution.blogspot.com`). A ferramenta de leitura de páginas falhou na resolução de nomes, e o proxy do ambiente respondeu `403` ao `CONNECT` (negação de política). A cópia do Wayback Machine (`web.archive.org`) também foi recusada. Nenhuma página, imagem ou texto dessas fontes foi lido.

**Consequências para o projeto:**

- Nenhum nome de item, preço, regra de venda, limite de fogões, efeito de tempero, sabor de bebida, regra de energia ou mecânica de montagem foi tirado dessas fontes. Tudo o que as Sprints 15a/15b implementam com esses temas é **design próprio**, marcado `project_original` em `docs/ASSET_CATALOG.md`.
- Os únicos dados históricos usados continuam sendo os do repositório: `ripped/game-config.xml.txt` (adulterado, ver CLAUDE.md) e os PNGs do jogo original fornecidos pelo responsável (marcados `historical_confirmed` quando o manifesto guarda o `legacyClassName`).
- Os nomes dos temas (Japão, "Mamma Mia"/Itália, Nobreza Clássica) vêm apenas da descrição do pedido e dos títulos das URLs; os itens de cada tema foram criados para o projeto.
- A arte nova é original: desenhada em canvas, em perspectiva isométrica 160×80, sem copiar sprites do jogo.

## Como completar esta auditoria

1. Salve capturas (PNG ou PDF) e o texto das páginas em `docs/referencias/`, um arquivo por fonte, com o nome `AAAA-MM-DD_<site>_<assunto>.<ext>` (por exemplo `2026-10-20_cafemaniaevolution_faq-sucos.pdf`) e a URL de origem na primeira linha do texto ou no nome do PDF.
2. Ou libere os domínios acima na configuração de rede do ambiente (Network access → Allowed domains) e peça uma nova rodada desta auditoria.
3. Ao comparar, registre aqui, por fonte: o que foi lido, os itens e regras confirmados e o que mudou no projeto. Só então um item pode passar a `historical_confirmed` por nome ou função; a arte continua original.

## Rodada de 16/10/2026 (Sprint 16)

### 1. Dois PDFs do Behance enviados pelo responsável (lidos página por página pelo agente)

Os PDFs são impressões das páginas do Behance pelo navegador. Não foram copiados para o repositório.

| PDF | Autoria e licença indicadas na página | Conteúdo observado |
| --- | --- | --- |
| *CafeMania · Behance* (15 páginas) | Marcela Rodriguez, publicado em 04/07/2012. Diz ter trabalhado como designer gráfica e diretora de arte do jogo. O rodapé mostra os ícones Creative Commons **BY-NC-ND** (atribuição, uso não comercial, sem derivações). | Ícones do jogo. Folha de assets: caixas misteriosas, árvore de cerejeira, cristaleira, fogões, quadros e portas. Máquina de sucos com 12 sucos. Janela "Sucos!" com abas Simples, Elaborados, Poderosos e Exóticos, custo em energia e "Dominado". Barra inferior com "Adicionar Vizinhos!", vizinhos com nível e o vizinho especial "Papa dos Pudins". Livro de Receitas com abas Básico, Avançado (nível 30) e Especial. Loja com a caixa registradora no canto, legenda "buy and sell assets". Personalização do avatar. Janela "Brinquedos": máquina montada com três peças (furadeira, spray, madeira), cada uma pedida aos vizinhos ou comprada por 10 Granas, estágios em estrelas e consumo de energia. Salões temáticos: romântico, pirata, fundo do mar, anos 80 e cinema. |
| *Cafe Mania · Behance* (11 páginas) | Kiaris Cosentino (Nat Sanfelice), publicado em 09/12/2013, com logos Café Mania e Vostu. Nenhuma licença indicada, o que no Behance equivale a "todos os direitos reservados". | Máquinas evolutivas em estágios ("Spin & Win" e cesta de basquete). Fogão evolutivo: caixa de peças, montagem e multifogão laranja. Árvore de Natal com presente em estágios. Mesa de cartas. Personagens, entre eles "Robot Mixer", "Funk Singer" e "Sales Man". Caixas com atendente ("new grid"). Pratos, inclusive o "Train Cake" em estágios: inteiro, mordido, prato vazio e estragado. |

**Decisão: a arte dos PDFs não foi extraída para o jogo.**

- **Licenças:**
  - O primeiro PDF é BY-NC-ND. A cláusula ND proíbe material adaptado, e recortar um sprite de um painel, redimensioná-lo e posicioná-lo no jogo é adaptação.
  - O segundo PDF não traz licença alguma.
  - Nos dois casos, os direitos da arte provavelmente pertencem à Vostu, e a regra do projeto é "não extrair nem reutilizar sprites protegidos sem autorização".
- **Qualidade:** são colagens JPEG em baixa resolução (um item tem de 60 a 150 px, sobre fundo branco ou preto), longe da grade nativa de 160×80 com transparência.

Os PDFs serviram de **referência de fatos e de interface**, que não são protegidos:

- a caixa registradora da loja vende itens (adotado na Sprint 16);
- vizinhos na barra inferior com um vizinho especial NPC, "Papa dos Pudins" (nome adotado para o vizinho especial `-1` do config na Sprint 16);
- máquinas montadas com peças pedidas aos vizinhos, que confirmam o desenho da jukebox e do fliperama da Sprint 15b;
- estágios visuais de pratos e máquinas.

A arte do projeto continua desenhada em canvas, sem copiar sprites. Se o responsável obtiver autorização dos titulares, os recortes podem passar pelo Asset Studio (`tools/asset-positioner`) como os PNGs do Discord.

### 2. Dados do blog *Jogando Café Mania* (julho e agosto de 2010) transcritos pelo responsável

O responsável transcreveu os dados abaixo dos posts originais. O agente **não** abriu o blog, que a rede continua bloqueando. No jogo, esses nomes ficam marcados como `historical_reported` (nome informado pelo responsável a partir da fonte histórica). A arte continua `project_original`.

| Post | Dados | Uso no projeto |
| --- | --- | --- |
| 22/07/2010, Set "Banzai" | Nome do conjunto oriental; pratos Pudim de Banana (42), Carne Assada (43), Misto Quente (44), Milho Cozido (45), Salgados de Festa (46), Sushi (47), Peixe Frito (48) e Yakisoba (49) | O tema `japan` passa a se chamar "Banzai (Japão)". Os pratos entram com esses nomes e níveis (`historical: true` em `rules.json`). |
| Tabela de níveis de julho de 2010 | Mousse de Maracujá (3), Pamonha (3), Vatapá (4), Bolo de Cenoura (5), Bobó de Camarão (6), Empadão de Frango (7), Feijoada (8), Pudim de Leite (9), Churrasco (12), Fondue (15), Brigadeiro (17), Picanha (19) e Pastel (29) | Entram com esses nomes e níveis. Brigadeiro, Misto-Quente, Feijoada e Pudim de Leite já existiam e foram movidos para o nível histórico. Custos, tempos, porções, preços e XP são de design (`provisional: true`). |
| 28/07/2010, os 6 temperos da Prateleira | Sal Turbinado, Pimenta Poderosa, Tomilho Acelerador, Tomilho Ultrarrápido, Condimento Instantâneo e Sálvia Salvadora, com seus efeitos | Os temperos da despensa trocam de nome e de efeito. Os códigos 800001 a 800003 são do config; 800004 a 800006 são nossos. Percentuais e preços são de design. |
| 26/08/2010, Set "Mamma Mia" | Mesas (Italiana Vermelha, Xadrez Verde, Xadrez Vermelho), cadeiras (Banco Verde, Estofada), Porta Cantina, janelas com neon e Toldo Vermelho, Piso Terracota, paredes Tijolo à Vista e Cantina, Balcão Pequena Itália, decorações (Quadro Menu, Vespa, Poste Espiral, Pizzaiolo, Vinoteca, Carrinho de Serviço, Lanterna de Parede, Sanfoneiro, O Poderoso Chefão) | Nomes dados a cinco itens italianos existentes: Mesa Xadrez Vermelho, Cadeira Estofada, Porta Cantina, Piso Terracota e Tijolo à Vista. Quatro itens novos: Vespa, Vinoteca, Poste Espiral e Balcão Pequena Itália. "O Poderoso Chefão" (título de filme) e os personagens (Pizzaiolo, Sanfoneiro) ficaram de fora. |
| 19/08/2010, "Semana do Crítico de Restaurante" | Evento do crítico | Base do crítico e dos visitantes VIP da Sprint 16, junto com os `<visitors>` do config. |
