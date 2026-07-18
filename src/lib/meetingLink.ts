// Meeting-link extraction: given the places a conference URL can hide —
// Google's structured conferenceData, the legacy hangoutLink, or free text
// in an event's location/description (or an email body) — find the one URL
// worth a Join button and name its provider. Pure functions, no DOM.
//
// Precedence mirrors what Google Calendar itself does:
//   1. conferenceData's video entry point (Google's canonical source)
//   2. hangoutLink (older events carry Meet here)
//   3. the first recognized provider URL in location, then description
// A generic https link only counts when it arrives via an explicit video
// entry point — free text never promotes an arbitrary URL to a meeting.

export type MeetingProvider = 'meet' | 'zoom' | 'teams' | 'webex' | 'other';

export interface MeetingLink {
  url: string;
  provider: MeetingProvider;
}

export interface ConferenceEntryPoint {
  entryPointType?: string;
  uri?: string;
}

export interface ConferenceData {
  entryPoints?: ConferenceEntryPoint[];
}

export interface MeetingLinkSource {
  hangoutLink?: string;
  conferenceData?: ConferenceData;
  location?: string;
  description?: string;
}

/** Longer than any real invite URL; anything beyond this is garbage. */
const MAX_URL_LENGTH = 1024;

/**
 * Provider fingerprints, matched against a URL's start. Zoom keeps its
 * subdomains (company.zoom.us) and ?pwd= token — the password is functional.
 */
const PROVIDER_PATTERNS: Array<{ provider: MeetingProvider; re: RegExp }> = [
  { provider: 'meet', re: /^https:\/\/meet\.google\.com\/[a-z0-9-]/i },
  { provider: 'zoom', re: /^https:\/\/(?:[\w-]+\.)?zoom\.us\/j\/\d/i },
  { provider: 'teams', re: /^https:\/\/teams\.microsoft\.com\/l\/meetup-join\//i },
  { provider: 'webex', re: /^https:\/\/(?:[\w-]+\.)?webex\.com\/(?:meet|join)\//i },
];

/** URL candidates in free text: https:// up to whitespace/markup/quotes. */
const URL_IN_TEXT = /https:\/\/[^\s<>"'`）)\]}]+/gi;

/** Trailing prose punctuation that regularly clings to pasted URLs. */
const TRAILING_PUNCTUATION = /[.,;:!?…]+$/;

/** Strip surrounding markup/angle brackets and trailing punctuation. */
function sanitizeUrl(raw: string): string | null {
  let url = raw.trim().replace(/^[<([{"'`]+/, '').replace(/[>)\]}"'`]+$/, '');
  url = url.replace(TRAILING_PUNCTUATION, '');
  if (!/^https:\/\//i.test(url)) return null;
  if (url.length > MAX_URL_LENGTH) return null;
  try {
    // Parseable or it does not ship — but the URL itself stays verbatim.
    new URL(url);
  } catch {
    return null;
  }
  return url;
}

/** The provider a URL belongs to, or null when it matches no fingerprint. */
export function matchProvider(url: string): MeetingProvider | null {
  for (const { provider, re } of PROVIDER_PATTERNS) {
    if (re.test(url)) return provider;
  }
  return null;
}

/**
 * The provider for a stored/user-entered meeting URL: a fingerprint match,
 * or 'other' for any sane https URL the user deliberately attached.
 */
export function detectProvider(url: string): MeetingProvider {
  return matchProvider(url) ?? 'other';
}

/** Valid enough to store as a meeting link: https, parseable, sane length. */
export function isValidMeetingUrl(raw: string): boolean {
  return sanitizeUrl(raw) !== null;
}

/** The first *recognized provider* URL in free text — no generic fallback. */
export function findMeetingLinkInText(text: string): MeetingLink | null {
  if (!text) return null;
  for (const match of text.matchAll(URL_IN_TEXT)) {
    const url = sanitizeUrl(match[0]);
    if (!url) continue;
    const provider = matchProvider(url);
    if (provider) return { url, provider };
  }
  return null;
}

/** Extract the meeting link from an event's fields, by precedence. */
export function extractMeetingLink(source: MeetingLinkSource): MeetingLink | null {
  // 1. conferenceData's video entry point — the canonical, explicit source.
  //    Here (and only here) an unrecognized https URL still counts ('other').
  const video = source.conferenceData?.entryPoints?.find(
    (ep) => ep.entryPointType === 'video' && ep.uri
  );
  if (video?.uri) {
    const url = sanitizeUrl(video.uri);
    if (url) return { url, provider: detectProvider(url) };
  }

  // 2. hangoutLink — Google Meet on events without full conferenceData.
  if (source.hangoutLink) {
    const url = sanitizeUrl(source.hangoutLink);
    if (url) return { url, provider: matchProvider(url) ?? 'meet' };
  }

  // 3. Free text: location first (the classic Zoom-in-location invite),
  //    then description — recognized providers only.
  return (
    findMeetingLinkInText(source.location ?? '') ??
    findMeetingLinkInText(source.description ?? '')
  );
}

/** "Join Google Meet" / "Join Zoom meeting" — the popover's Join label. */
export const MEETING_JOIN_LABELS: Record<MeetingProvider, string> = {
  meet: 'Join Google Meet',
  zoom: 'Join Zoom meeting',
  teams: 'Join Teams meeting',
  webex: 'Join Webex meeting',
  other: 'Join meeting',
};

/** The bare domain shown under the Join label (anti-deception). */
export function meetingDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
