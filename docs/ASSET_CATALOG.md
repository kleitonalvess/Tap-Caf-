# Catálogo de assets

Gerado por `npm run assets:room` (`scripts/asset-catalog-doc.mjs`) a partir de `game/public/assets/items/*/item.json`. Não edite à mão.

## Origem

- **historical_confirmed** (13): arte PNG do jogo original, fornecida pelo responsável pelo projeto, cujo manifesto guarda o nome de classe original (`legacyClassName`). Confirma a existência do objeto e da arte; o nome em português e os valores de loja são nossos.
- **unverified** (2): arte PNG sem essa evidência de origem.
- **project_original** (65): criados para este projeto, desenhados em canvas (`placeholder-art.ts`) ou tingidos de um PNG. Nomes, preços, níveis e funções são de design; os temas Japão, Itália e Nobreza seguem a ideia dos conjuntos temáticos do jogo, sem reproduzir itens históricos (ver `docs/REFERENCE_AUDIT.md`).

Grade nativa: tiles de 160×80 px, projeção 2:1. `pivot` é o deslocamento da imagem em relação ao vértice superior do tile de origem.

## Itens

| id | name | category | theme | origin | dimensions | pivot | rotatable | priceCoins | priceCash | minLevel | functionType | visualStates | spriteSource |
| --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |
| 3000011 | Janela Básica | flower-window | — | historical_confirmed | 1×1 tiles, 195.2 px | left -74, top -120.1 | sim | 120 | 0 | 1 | decoração de parede | estático | PNG (rotation-0.png, rotation-1.png) |
| 3000012 | Janela Azul | flower-window | — | project_original | 1×1 tiles, 195.2 px | left -74, top -120.1 | sim | 200 | 0 | 5 | decoração de parede | estático | variante tingida de `basic_window` (#5f97de, color) |
| 3000013 | Vitral Colorido (fora da loja) | flower-window | — | project_original | 1×1 tiles, 195.2 px | left -74, top -120.1 | sim | 0 | 0 | 1 | decoração de parede | estático | variante tingida de `basic_window` (#a05ad6, color) |
| 3010000 | Porta Máfia | door | — | historical_confirmed | 1×1 tiles, 176 px | left -87, top -179 | não | 1 | 0 | 1 | entrada dos clientes | estático | PNG (mafia_door.png) |
| 3010001 | Porta Vermelha | door | — | project_original | 1×1 tiles, 176 px | left -87, top -179 | não | 150 | 0 | 4 | entrada dos clientes | estático | variante tingida de `mafia_door` (#c23b2e, color) |
| 3010002 | Porta Verde | door | Itália (Mamma Mia) | project_original | 1×1 tiles, 176 px | left -87, top -179 | não | 250 | 0 | 10 | entrada dos clientes | estático | variante tingida de `mafia_door` (#2f8f5b, color) |
| 3010003 | Porta Real (fora da loja) | door | — | project_original | 1×1 tiles, 176 px | left -87, top -179 | não | 0 | 0 | 1 | entrada dos clientes | estático | variante tingida de `mafia_door` (#d4a017, color) |
| 3010004 | Porta Laqueada Oriental | door | Japão | project_original | 1×1 tiles, 176 px | left -87, top -179 | não | 300 | 0 | 8 | entrada dos clientes | estático | variante tingida de `mafia_door` (#8e2a1f, color) |
| 3020003 | Arbusto | flower | — | historical_confirmed | 1×1 tiles, 127.2 px | left -36.7, top -106.1 | não | 60 | 0 | 1 | decoração | estático | PNG (delicate_bush.png) |
| 3020004 | Arbusto Cerejeira | flower | — | project_original | 1×1 tiles, 127.2 px | left -36.7, top -106.1 | não | 120 | 0 | 4 | decoração | estático | variante tingida de `delicate_bush` (#f08cb4, color) |
| 3020005 | Arbusto Dourado (fora da loja) | flower | — | project_original | 1×1 tiles, 127.2 px | left -36.7, top -106.1 | não | 0 | 0 | 1 | decoração | estático | variante tingida de `delicate_bush` (#e6b422, color) |
| 3030010 | Mesa com Toalha Branca | table | — | historical_confirmed | 1×1 tiles, 51.4 px | left -90, top -49.2 | não | 80 | 0 | 1 | mesa de refeição (lotação, sujeira) | limpa, suja (pratos, moscas) | PNG (white_cloth_table.png) |
| 3030011 | Mesa com Toalha Vermelha | table | — | project_original | 1×1 tiles, 51.4 px | left -90, top -49.2 | não | 120 | 0 | 3 | mesa de refeição (lotação, sujeira) | limpa, suja (pratos, moscas) | variante tingida de `white_cloth_table` (#e04a4a, multiply) |
| 3030012 | Mesa com Toalha Azul | table | — | project_original | 1×1 tiles, 51.4 px | left -90, top -49.2 | não | 160 | 0 | 6 | mesa de refeição (lotação, sujeira) | limpa, suja (pratos, moscas) | variante tingida de `white_cloth_table` (#5b8fe2, multiply) |
| 3030013 | Mesa com Toalha Dourada | table | — | project_original | 1×1 tiles, 51.4 px | left -90, top -49.2 | não | 0 | 4 | 1 | mesa de refeição (lotação, sujeira) | limpa, suja (pratos, moscas) | variante tingida de `white_cloth_table` (#ecc55c, multiply) |
| 3030014 | Mesa de Madeira Rústica | table | — | project_original | 1×1 tiles, 52 px | vértice superior do tile (Asset Studio) | não | 220 | 0 | 8 | mesa de refeição (lotação, sujeira) | limpa, suja (pratos, moscas) | canvas procedural (`table-wood`) |
| 3030015 | Mesa Baixa Oriental | table | Japão | project_original | 1×1 tiles, 40 px | vértice superior do tile (Asset Studio) | não | 260 | 0 | 6 | mesa de refeição (lotação, sujeira) | limpa, suja (pratos, moscas) | canvas procedural (`table-low`) |
| 3030016 | Mesa de Cantina Xadrez | table | Itália (Mamma Mia) | project_original | 1×1 tiles, 52 px | vértice superior do tile (Asset Studio) | não | 200 | 0 | 5 | mesa de refeição (lotação, sujeira) | limpa, suja (pratos, moscas) | canvas procedural (`table-checker`) |
| 3030017 | Mesa Imperial Dourada | table | Nobreza Clássica | project_original | 1×1 tiles, 54 px | vértice superior do tile (Asset Studio) | não | 900 | 0 | 15 | mesa de refeição (lotação, sujeira) | limpa, suja (pratos, moscas) | canvas procedural (`table-imperial`) |
| 3040001 | Cadeira Clássica | chair | — | historical_confirmed | 1×1 tiles, 97.4 px | left -40, top -80.2 | sim | 50 | 0 | 1 | assento (clientes sentam) | vazia, ocupada | PNG (rotation-0.png, rotation-1.png, rotation-2.png, rotation-3.png) |
| 3040002 | Cadeira Vermelha | chair | — | project_original | 1×1 tiles, 97.4 px | left -40, top -80.2 | sim | 70 | 0 | 3 | assento (clientes sentam) | vazia, ocupada | variante tingida de `classic_chair` (#c0392b, color) |
| 3040003 | Cadeira Azul | chair | — | project_original | 1×1 tiles, 97.4 px | left -40, top -80.2 | sim | 90 | 0 | 6 | assento (clientes sentam) | vazia, ocupada | variante tingida de `classic_chair` (#2f6fd0, color) |
| 3040004 | Cadeira Verde | chair | — | project_original | 1×1 tiles, 97.4 px | left -40, top -80.2 | sim | 110 | 0 | 9 | assento (clientes sentam) | vazia, ocupada | variante tingida de `classic_chair` (#3a9d5d, color) |
| 3040005 | Cadeira Dourada | chair | Nobreza Clássica | project_original | 1×1 tiles, 97.4 px | left -40, top -80.2 | sim | 0 | 3 | 1 | assento (clientes sentam) | vazia, ocupada | variante tingida de `classic_chair` (#d4a017, color) |
| 3040006 | Trono do Chef (fora da loja) | chair | — | project_original | 1×1 tiles, 97.4 px | left -40, top -80.2 | sim | 0 | 0 | 1 | assento (clientes sentam) | vazia, ocupada | variante tingida de `classic_chair` (#7b2cbf, color) |
| 3040007 | Banqueta Laqueada | chair | Japão | project_original | 1×1 tiles, 97.4 px | left -40, top -80.2 | sim | 120 | 0 | 6 | assento (clientes sentam) | vazia, ocupada | variante tingida de `classic_chair` (#8e2a1f, multiply) |
| 3040008 | Cadeira de Cantina | chair | Itália (Mamma Mia) | project_original | 1×1 tiles, 97.4 px | left -40, top -80.2 | sim | 90 | 0 | 5 | assento (clientes sentam) | vazia, ocupada | variante tingida de `classic_chair` (#9a6235, multiply) |
| 3040009 | Poltrona de Veludo | chair | Nobreza Clássica | project_original | 1×1 tiles, 97.4 px | left -40, top -80.2 | sim | 420 | 0 | 15 | assento (clientes sentam) | vazia, ocupada | variante tingida de `classic_chair` (#6b2a86, multiply) |
| 3050000 | Piso Padrão | floor | — | historical_confirmed | 1×1 tiles, 0 px | left -82, top -2 | não | 1 | 0 | 1 | piso | estático | PNG (default_tile_name.png) |
| 3050001 | Piso Azul-Céu | floor | — | project_original | 1×1 tiles, 0 px | left -82, top -2 | não | 20 | 0 | 3 | piso | estático | variante tingida de `default_tile_name` (#7fb8f0, color) |
| 3050002 | Piso Terracota | floor | Itália (Mamma Mia) | project_original | 1×1 tiles, 0 px | left -82, top -2 | não | 30 | 0 | 6 | piso | estático | variante tingida de `default_tile_name` (#d4703c, color) |
| 3050003 | Piso Menta | floor | — | project_original | 1×1 tiles, 0 px | left -82, top -2 | não | 40 | 0 | 9 | piso | estático | variante tingida de `default_tile_name` (#7ed6a5, color) |
| 3050004 | Piso Real Dourado | floor | Nobreza Clássica | project_original | 1×1 tiles, 0 px | left -82, top -2 | não | 120 | 0 | 15 | piso | estático | variante tingida de `default_tile_name` (#e8b93c, color) |
| 3050005 | Piso de Tatame | floor | Japão | project_original | 1×1 tiles, 0 px | left -82, top -2 | não | 50 | 0 | 6 | piso | estático | variante tingida de `default_tile_name` (#cdbb7a, color) |
| 3050006 | Piso de Mármore | floor | Nobreza Clássica | project_original | 1×1 tiles, 0 px | left -82, top -2 | não | 150 | 0 | 15 | piso | estático | variante tingida de `default_tile_name` (#e9e3d6, color) |
| 3060016 | Parede Padrão | wallpaper | — | historical_confirmed | 1×1 tiles, 192.4 px | left -80, top -168 | não | 1 | 0 | 1 | parede | estático | PNG (default_wallpaper_name.png) |
| 3060017 | Parede Creme | wallpaper | — | project_original | 1×1 tiles, 192.4 px | left -80, top -168 | não | 15 | 0 | 2 | parede | estático | variante tingida de `default_wallpaper_name` (#f2d9a6, color) |
| 3060018 | Parede Rosa | wallpaper | — | project_original | 1×1 tiles, 192.4 px | left -80, top -168 | não | 25 | 0 | 5 | parede | estático | variante tingida de `default_wallpaper_name` (#f29ab8, color) |
| 3060019 | Parede Azul | wallpaper | — | project_original | 1×1 tiles, 192.4 px | left -80, top -168 | não | 35 | 0 | 8 | parede | estático | variante tingida de `default_wallpaper_name` (#6fa6e0, color) |
| 3060020 | Tijolinho Branco | wallpaper | Itália (Mamma Mia) | project_original | 1×1 tiles, 233 px | left -80, top -193 | não | 60 | 0 | 12 | parede | estático | variante tingida de `mafia_wall` (#ece6dc, color) |
| 3060021 | Papel de Parede Bambu | wallpaper | Japão | project_original | 1×1 tiles, 192.4 px | left -80, top -168 | não | 45 | 0 | 6 | parede | estático | variante tingida de `default_wallpaper_name` (#9cbf6e, color) |
| 3060022 | Papel de Parede Damasco | wallpaper | Nobreza Clássica | project_original | 1×1 tiles, 192.4 px | left -80, top -168 | não | 120 | 0 | 16 | parede | estático | variante tingida de `default_wallpaper_name` (#8a3344, color) |
| 3070000 | Fogão Básico | stove | — | historical_confirmed | 1×1 tiles, 47 px | left -80, top -47 | não | 400 | 0 | 2 | cozinhar receitas | vazio, preparando, cozinhando, pronto, estragado | PNG (starter_stove.png) |
| 3070001 | Fogão Inox Rápido | stove-fire | — | project_original | 1×1 tiles, 47 px | vértice superior do tile (Asset Studio) | não | 2500 | 0 | 8 | cozinhar receitas | vazio, preparando, cozinhando, pronto, estragado | canvas procedural (`stove-steel`) |
| 3070002 | Fogão Mestre | stove-fire | — | project_original | 1×1 tiles, 52 px | vértice superior do tile (Asset Studio) | não | 8000 | 0 | 18 | cozinhar receitas | vazio, preparando, cozinhando, pronto, estragado | canvas procedural (`stove-master`) |
| 3070003 | Chapa Teppanyaki | stove-fire | Japão | project_original | 1×1 tiles, 47 px | vértice superior do tile (Asset Studio) | não | 3500 | 0 | 10 | cozinhar receitas | vazio, preparando, cozinhando, pronto, estragado | canvas procedural (`stove-teppan`) |
| 3070004 | Forno a Lenha | stove-fire | Itália (Mamma Mia) | project_original | 1×1 tiles, 64 px | vértice superior do tile (Asset Studio) | não | 4200 | 0 | 12 | cozinhar receitas | vazio, preparando, cozinhando, pronto, estragado | canvas procedural (`stove-oven`) |
| 3070005 | Multifogão Profissional | stove-fire | — | project_original | 1×1 tiles, 56 px | vértice superior do tile (Asset Studio) | não | 15000 | 0 | 25 | cozinhar receitas | vazio, preparando, cozinhando, pronto, estragado | canvas procedural (`stove-multi`) |
| 3080000 | Balcão de Servir | counter | — | project_original | 1×1 tiles, 52 px | vértice superior do tile (Asset Studio) | não | 150 | 0 | 1 | balcão (porções servidas) | vazio, com prato ×N | canvas procedural (`counter`) |
| 3080001 | Balcão de Madeira | counter | — | project_original | 1×1 tiles, 52 px | vértice superior do tile (Asset Studio) | não | 400 | 0 | 5 | balcão (porções servidas) | vazio, com prato ×N | canvas procedural (`counter-wood`) |
| 3080002 | Balcão de Mármore | counter | — | project_original | 1×1 tiles, 52 px | vértice superior do tile (Asset Studio) | não | 1200 | 0 | 12 | balcão (porções servidas) | vazio, com prato ×N | canvas procedural (`counter-marble`) |
| 3080003 | Vitrine Refrigerada | counter | — | project_original | 1×1 tiles, 60 px | vértice superior do tile (Asset Studio) | não | 0 | 10 | 1 | balcão (porções servidas) | vazio, com prato ×N | canvas procedural (`counter-glass`) |
| 3080004 | Balcão de Sushi | counter | Japão | project_original | 1×1 tiles, 52 px | vértice superior do tile (Asset Studio) | não | 1600 | 0 | 10 | balcão (porções servidas) | vazio, com prato ×N | canvas procedural (`counter-sushi`) |
| 3090000 | Estrutura da Parede (fora da loja) | wallpaper | — | historical_confirmed | 1×1 tiles, 202 px | left -80, top -202 | sim | 0 | 0 | 1 | parede | estático | PNG (rotation-0.png, rotation-1.png) |
| 3090001 | Canto da Parede (fora da loja) | wallpaper | — | historical_confirmed | 1×1 tiles, 169 px | left -18, top -170 | não | 0 | 0 | 1 | parede | estático | PNG (room_wall_corner.png) |
| 3100000 | Suporte de Cardápio (fora da loja) | flower-window | — | historical_confirmed | 2×1 tiles, 153.2 px | left -153.3, top -120.1 | sim | 0 | 0 | 1 | decoração de parede | estático | PNG (rotation-0.png, rotation-1.png) |
| 3200000 | Painel de Conquistas (fora da loja) | flower-window | — | historical_confirmed | 2×1 tiles, 203.6 px | left -161.1, top -146.8 | sim | 0 | 0 | 1 | decoração de parede | estático | PNG (rotation-0.png, rotation-1.png) |
| 3300000 | Caixa de Correio (fora da loja) | flower | — | historical_confirmed | 1×1 tiles, 123.8 px | left -58.8, top -112.4 | sim | 0 | 0 | 1 | Correio | estático | PNG (rotation-0.png, rotation-1.png, rotation-2.png, rotation-3.png) |
| 3400000 | Caixa Registradora | counter | — | project_original | 1×1 tiles, 70 px | vértice superior do tile (Asset Studio) | não | 1500 | 0 | 6 | gorjeta no autosserviço + Caixa do dia | estático | canvas procedural (`register`) |
| 3500000 | Vaso de Flores | flower | — | project_original | 1×1 tiles, 64 px | vértice superior do tile (Asset Studio) | não | 90 | 0 | 2 | decoração | estático | canvas procedural (`vase-flowers`) |
| 3500001 | Samambaia | flower | — | project_original | 1×1 tiles, 86 px | vértice superior do tile (Asset Studio) | não | 150 | 0 | 5 | decoração | estático | canvas procedural (`fern`) |
| 3500002 | Luminária de Pé | flower | — | project_original | 1×1 tiles, 120 px | vértice superior do tile (Asset Studio) | não | 250 | 0 | 7 | decoração | estático | canvas procedural (`floor-lamp`) |
| 3500003 | Estátua do Chef | flower | Itália (Mamma Mia) | project_original | 1×1 tiles, 128 px | vértice superior do tile (Asset Studio) | não | 900 | 0 | 14 | decoração | estático | canvas procedural (`statue`) |
| 3500004 | Fonte Decorativa | flower | Nobreza Clássica | project_original | 1×1 tiles, 84 px | vértice superior do tile (Asset Studio) | não | 0 | 15 | 1 | decoração | estático | canvas procedural (`fountain`) |
| 3500005 | Biombo Shoji | flower | Japão | project_original | 1×1 tiles, 120 px | vértice superior do tile (Asset Studio) | não | 450 | 0 | 8 | decoração | estático | canvas procedural (`shoji`) |
| 3500006 | Bonsai | flower | Japão | project_original | 1×1 tiles, 78 px | vértice superior do tile (Asset Studio) | não | 300 | 0 | 7 | decoração | estático | canvas procedural (`bonsai`) |
| 3500007 | Lanterna de Papel | flower | Japão | project_original | 1×1 tiles, 132 px | vértice superior do tile (Asset Studio) | não | 350 | 0 | 9 | decoração | estático | canvas procedural (`paper-lantern`) |
| 3500008 | Ânfora Mediterrânea | flower | Itália (Mamma Mia) | project_original | 1×1 tiles, 82 px | vértice superior do tile (Asset Studio) | não | 220 | 0 | 6 | decoração | estático | canvas procedural (`amphora`) |
| 3500009 | Oliveira em Vaso | flower | Itália (Mamma Mia) | project_original | 1×1 tiles, 126 px | vértice superior do tile (Asset Studio) | não | 380 | 0 | 9 | decoração | estático | canvas procedural (`olive-tree`) |
| 3500010 | Candelabro Dourado | flower | Nobreza Clássica | project_original | 1×1 tiles, 112 px | vértice superior do tile (Asset Studio) | não | 800 | 0 | 16 | decoração | estático | canvas procedural (`candelabra`) |
| 3500011 | Piano Clássico | flower | Nobreza Clássica | project_original | 1×1 tiles, 96 px | vértice superior do tile (Asset Studio) | não | 3500 | 0 | 20 | decoração | estático | canvas procedural (`piano`) |
| 3600000 | Quadro de Paisagem | flower-window | — | project_original | 1×1 tiles, 195.2 px | vértice superior do tile (Asset Studio) | sim | 140 | 0 | 3 | decoração de parede | estático | canvas procedural (`painting-landscape`) |
| 3600001 | Relógio de Parede | flower-window | — | project_original | 1×1 tiles, 195.2 px | vértice superior do tile (Asset Studio) | sim | 220 | 0 | 6 | decoração de parede | estático | canvas procedural (`wall-clock`) |
| 3600002 | Quadro do Café | flower-window | — | project_original | 1×1 tiles, 195.2 px | vértice superior do tile (Asset Studio) | sim | 400 | 0 | 10 | decoração de parede | estático | canvas procedural (`painting-coffee`) |
| 3600003 | Pergaminho Oriental | flower-window | Japão | project_original | 1×1 tiles, 195.2 px | vértice superior do tile (Asset Studio) | sim | 240 | 0 | 8 | decoração de parede | estático | canvas procedural (`scroll`) |
| 3600004 | Quadro do Canal | flower-window | Itália (Mamma Mia) | project_original | 1×1 tiles, 195.2 px | vértice superior do tile (Asset Studio) | sim | 260 | 0 | 7 | decoração de parede | estático | canvas procedural (`painting-canal`) |
| 3600005 | Cortina de Veludo | flower-window | Nobreza Clássica | project_original | 1×1 tiles, 195.2 px | vértice superior do tile (Asset Studio) | sim | 520 | 0 | 15 | decoração de parede | estático | canvas procedural (`curtain-velvet`) |
| 3600006 | Letreiro Neon Café | flower-window | — | project_original | 1×1 tiles, 195.2 px | vértice superior do tile (Asset Studio) | sim | 700 | 0 | 12 | decoração de parede | estático | canvas procedural (`neon-sign`) |
| 9000001 | Piso Máfia | floor | — | unverified | 1×1 tiles, 0 px | left -82, top -2 | não | 1 | 0 | 1 | piso | estático | PNG (mafia_tile_floor.png) |
| 9000002 | Parede Máfia | wallpaper | — | unverified | 1×1 tiles, 233 px | left -80, top -193 | não | 1 | 0 | 1 | parede | estático | PNG (mafia_wall.png) |
