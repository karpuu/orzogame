// deck.js
export function createDeck() {
  const semi = ["coppe", "denari", "bastoni", "spade"];
  const carte = [];

  for (const seme of semi) {
    for (let valore = 1; valore <= 7; valore++) carte.push({ valore, seme });
    carte.push({ valore: 8, seme });  // Fante
    carte.push({ valore: 9, seme });  // Cavallo
    carte.push({ valore: 10, seme }); // Re
  }

  return shuffle(carte);
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
