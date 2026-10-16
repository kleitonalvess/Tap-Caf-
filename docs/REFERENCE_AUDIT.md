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
