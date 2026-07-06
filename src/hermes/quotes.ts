// Hermes's epigrams: the legacy QUOTES list, split into Latin + translation,
// plus a few new ones. Set small and letterspaced, like museum wall labels.

export interface Epigram {
  latin: string;
  english: string;
}

export const EPIGRAMS: Epigram[] = [
  { latin: 'Festina lente', english: 'make haste, slowly' },
  { latin: 'Carpe diem', english: 'seize the day' },
  { latin: 'Acta non verba', english: 'deeds, not words' },
  { latin: 'Audentes fortuna iuvat', english: 'fortune favors the bold' },
  { latin: 'Vincit qui se vincit', english: 'he conquers who conquers himself' },
  { latin: 'Per aspera ad astra', english: 'through hardships, to the stars' },
  { latin: 'Ordo ab chao', english: 'order out of chaos' },
  { latin: 'Amor fati', english: 'love your fate' },
  { latin: 'Sol omnibus lucet', english: 'the sun shines on everyone' },
];

/** One epigram per calendar day, rotating — same selection rule as legacy. */
export function epigramOfDay(date: Date = new Date()): Epigram {
  return EPIGRAMS[date.getDate() % EPIGRAMS.length];
}
