import { describe, expect, it } from 'vitest';

import { giftText, helpText, neighborPage, visitUrl } from '../../game/src/game/neighbors';

describe('vizinhança', () => {
  it('pagina a barra de oito em oito e prende a página nos limites', () => {
    const list = Array.from({ length: 11 }, (_, index) => index);
    expect(neighborPage(list, 0, 8)).toEqual({ items: [0, 1, 2, 3, 4, 5, 6, 7], page: 0, pages: 2 });
    expect(neighborPage(list, 1, 8)).toEqual({ items: [8, 9, 10], page: 1, pages: 2 });
    expect(neighborPage(list, 9, 8).page).toBe(1);
    expect(neighborPage(list, -3, 8).page).toBe(0);
    expect(neighborPage([], 0, 8)).toEqual({ items: [], page: 0, pages: 1 });
  });

  it('monta o endereço do café visitado e o de volta para casa', () => {
    expect(visitUrl('http://localhost:5173/?screen=room&offline=1', 'npcneighbor0003'))
      .toBe('http://localhost:5173/?screen=room&offline=1&room=npcneighbor0003');
    expect(visitUrl('http://localhost:5173/?room=npcneighbor0003&offline=1', undefined)).toBe('http://localhost:5173/?offline=1');
  });

  it('descreve o prêmio da ajuda e quantas restam', () => {
    expect(helpText({ coins: 20, xp: 2, energy: 2, helpsLeft: 2 })).toBe('+20 moedas, +2 XP e +2 de energia · 2 ajudas restantes hoje');
    expect(helpText({ coins: 20, xp: 2, energy: 0, helpsLeft: 1 })).toBe('+20 moedas e +2 XP · 1 ajuda restante hoje');
    expect(helpText({ coins: 0, xp: 0, energy: 0, helpsLeft: 0 })).toBe('Obrigado! · sem mais ajudas hoje');
  });

  it('nomeia o presente com o XP de abrir', () => {
    expect(giftText({ id: 'coins', name: '250 moedas', coins: 250 }, 3)).toBe('250 moedas + 3 XP');
    expect(giftText({ id: 'part', name: 'Peça de Máquina', stock: 820001 }, 0)).toBe('Peça de Máquina');
  });
});
