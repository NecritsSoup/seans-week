// Typed map of the Hermes artwork, extracted from the legacy app by
// scripts/extract-hermes.mjs into src/assets/hermes/.

import vaseIcon from '../assets/hermes/vase-icon.jpg';
import vaseGreeting from '../assets/hermes/vase-greeting.jpg';
import vaseCheering from '../assets/hermes/vase-cheering.jpg';
import vaseReminder from '../assets/hermes/vase-reminder.jpg';
import vaseThinking from '../assets/hermes/vase-thinking.jpg';
import vaseResting from '../assets/hermes/vase-resting.jpg';
import vaseWalking from '../assets/hermes/vase-walking.jpg';

import frescoIcon from '../assets/hermes/fresco-icon.jpg';
import frescoGreeting from '../assets/hermes/fresco-greeting.jpg';
import frescoCheering from '../assets/hermes/fresco-cheering.jpg';
import frescoReminder from '../assets/hermes/fresco-reminder.jpg';
import frescoThinking from '../assets/hermes/fresco-thinking.jpg';
import frescoResting from '../assets/hermes/fresco-resting.jpg';
import frescoWalking from '../assets/hermes/fresco-walking.jpg';

import amphoraIcon from '../assets/hermes/amphora-icon.jpg';
import amphoraGreeting from '../assets/hermes/amphora-greeting.jpg';
import amphoraCheering from '../assets/hermes/amphora-cheering.jpg';
import amphoraReminder from '../assets/hermes/amphora-reminder.jpg';
import amphoraThinking from '../assets/hermes/amphora-thinking.jpg';
import amphoraResting from '../assets/hermes/amphora-resting.jpg';
import amphoraWalking from '../assets/hermes/amphora-walking.jpg';

export type HermesStyle = 'vase' | 'fresco' | 'amphora';

export type HermesPose =
  | 'greeting'
  | 'cheering'
  | 'reminder'
  | 'thinking'
  | 'resting'
  | 'walking';

export interface HermesArtSet {
  icon: string;
  poses: Record<HermesPose, string>;
}

export const HERMES_ART: Record<HermesStyle, HermesArtSet> = {
  vase: {
    icon: vaseIcon,
    poses: {
      greeting: vaseGreeting,
      cheering: vaseCheering,
      reminder: vaseReminder,
      thinking: vaseThinking,
      resting: vaseResting,
      walking: vaseWalking,
    },
  },
  fresco: {
    icon: frescoIcon,
    poses: {
      greeting: frescoGreeting,
      cheering: frescoCheering,
      reminder: frescoReminder,
      thinking: frescoThinking,
      resting: frescoResting,
      walking: frescoWalking,
    },
  },
  amphora: {
    icon: amphoraIcon,
    poses: {
      greeting: amphoraGreeting,
      cheering: amphoraCheering,
      reminder: amphoraReminder,
      thinking: amphoraThinking,
      resting: amphoraResting,
      walking: amphoraWalking,
    },
  },
};
