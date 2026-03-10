// deck.js

// Funzione per creare un mazzo napoletano completo (40 carte)
export function createDeck() {
  const semi = ["coppe", "denari", "bastoni", "spade"];
  const carte = [];

  semi.forEach(seme => {
    // carte numeriche 1–7
    for (let valore = 1; valore <= 7; valore++) {
      carte.push({ valore, seme });
    }
    // figure: Fante = 8, Cavallo = 9, Re = 10
    carte.push({ valore: 8, seme });  // Fante
    carte.push({ valore: 9, seme });  // Cavallo
    carte.push({ valore: 10, seme }); // Re
  });

  return shuffle(carte);
}

// Funzione per mescolare un array (Fisher-Yates Shuffle)
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}