// Which searches would a customer of *this* business type into Google?
//
// Search-data providers return anything that shares a word with the seed:
// "shop" brings back "pawn shop", "repair" brings back "appliance repair",
// "collision" brings back the dictionary and the police. Every list we show
// (free check, keyword plan, competitor gaps) goes through this filter.
//
// For trades we know well, a search must name one of the trade's services
// and nothing else we can't account for (another city, a brand, a different
// trade). For anything else we fall back to the business's own words.

export type ServiceTopic = { topic: string; pattern: RegExp };
export type Industry = { id: string; label: string; services: ServiceTopic[]; allowed: string[] };

const COLLISION: Industry = {
  id: "collision",
  label: "auto body / collision repair shop",
  services: [
    { topic: "collision repair", pattern: /\bcollision (repair|repairs|center|centre|shop|shops|services?|specialists?)\b|\b(auto|car|vehicle) collision\b|\bcollision\b.*\b(repair|shop)\b/ },
    { topic: "auto body", pattern: /\bauto ?body\b|\bbody ?shops?\b|\bcar body\b|\bbody ?work\b|\bbody repair\b/ },
    { topic: "bumper repair", pattern: /\bbumper (repair|replacement|fix|scratch|dent|paint)|\b(repair|fix|replace)\w* .*\bbumper\b/ },
    { topic: "dent repair", pattern: /\bdents? (repair|removal|fix)|\bpaintless\b|\bpdr\b|\bhail (damage|repair)\b/ },
    { topic: "car paint", pattern: /\b(car|auto|automotive|vehicle) (paint|painting|respray|refinish)|\bpaint (shop|job|repair)\b|\bscratch (repair|removal)\b/ },
    { topic: "frame repair", pattern: /\bframe (repair|straightening|damage)\b/ },
    { topic: "windshield and auto glass", pattern: /\bwind(shield|screen)\b|\b(auto|car) glass\b/ },
    { topic: "rust repair", pattern: /\brust (repair|removal|proofing)\b/ },
  ],
  allowed:
    "collision collisions repair repairs auto autobody body bodyshop bodyshops shop shops car cars vehicle vehicles work bumper bumpers dent dents removal fix paintless pdr hail damage paint painting respray refinish automotive scratch scratches job frame straightening windshield windscreen glass rust proofing replacement replace cracked crack chip chips broken damaged center centre centres centers service services specialist specialists truck trucks suv front rear back side door panel small minor mobile insurance estimate estimates".split(
      " ",
    ),
};

const MECHANIC: Industry = {
  id: "mechanic",
  label: "auto repair / mechanic shop",
  services: [
    { topic: "auto repair", pattern: /\b(auto|car|vehicle|automotive|truck) (repair|repairs|service|services|mechanics?|maintenance)\b|\bmechanics?\b|\bgarage\b/ },
    { topic: "brake repair", pattern: /\bbrakes?\b/ },
    { topic: "oil change", pattern: /\boil change\b/ },
    { topic: "tires", pattern: /\b(tire|tires|tyre|tyres)\b/ },
    { topic: "transmission repair", pattern: /\btransmission\b/ },
    { topic: "engine repair", pattern: /\bengine (repair|rebuild|diagnostics?|light)\b|\bcheck engine\b/ },
    { topic: "car ac repair", pattern: /\b(car|auto|vehicle) (ac|a c|air conditioning)\b/ },
    { topic: "wheel alignment", pattern: /\b(wheel )?alignment\b/ },
    { topic: "exhaust and muffler", pattern: /\b(muffler|exhaust)\b/ },
    { topic: "car battery", pattern: /\b(car|auto|vehicle) batter(y|ies)\b/ },
    { topic: "diagnostics", pattern: /\b(car|auto|vehicle) diagnostics?\b/ },
  ],
  allowed:
    "auto car cars vehicle vehicles automotive truck trucks repair repairs service services mechanic mechanics maintenance garage brake brakes pad pads rotor rotors oil change tire tires tyre tyres winter summer all season transmission engine rebuild diagnostic diagnostics light check ac air conditioning wheel wheels alignment muffler exhaust battery batteries replacement replace shop shops center centre fix inspection safety tune up".split(
      " ",
    ),
};

// Phrases that mean a business sells *to* shops, not to drivers.
const B2B = /\bbuying group|\bgroup purchasing|\brebates?\b|\bsuppliers?\b|\bdistribut|\bwholesale|\bsoftware\b|\bmarketing\b|\bconsult|\bfranchis|\bnetwork\b|\bassociation\b|\btraining\b/;

/** Which known trades a business is in, from its own description ("Collision Repair, Mechanic Repair" -> both). */
export function industriesFor(category: string): Industry[] {
  const c = ` ${category.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ")} `;
  if (B2B.test(c)) return [];
  const out: Industry[] = [];
  if (/\b(collision|auto ?body|body ?shop|body work|bodywork|dent|paintless|car paint)\b/.test(c)) out.push(COLLISION);
  if (/\b(mechanic|mechanical|auto repair|car repair|garage|brake|oil change|tire|tyre|transmission|automotive repair|auto service)\b/.test(c)) out.push(MECHANIC);
  return out;
}

/** "Collision Repair, Mechanic Repair" -> ["collision repair", "mechanic repair"]: each service the owner listed. */
export function servicesFrom(category: string): string[] {
  return [
    ...new Set(
      category
        .toLowerCase()
        .split(/[,;/&|.]|\band\b/)
        .map((s) => s.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim())
        .filter((s) => s.length >= 3),
    ),
  ].slice(0, 4);
}

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);

// How people search, not what for.
const MODIFIERS = new Set(
  "near me best top cheap affordable cost costs price prices how much in near my the a an for and to of local open now 24 hour hours same day emergency free estimate estimates quote quotes reviews good reliable certified recommended nearby closest east west north south downtown central area region".split(" "),
);

// Searches by people who aren't buying (students, job seekers, DIY, the curious, legal cases).
const OFF_INTENT = new Set(
  "job jobs hiring career careers salary salaries wage wages course courses school schools training certification diy kit kits game games simulator meaning definition define defined wiki lawyer lawyers attorney attorneys law report reports reporting police statistics stats accident accidents death killed fatal youtube video videos reddit used sale sell selling buy parts part sticker stickers toy toys".split(" "),
);
const OFF_PHRASES = /\bwhat (is|are|does)\b|\bhow (to|do|does|can)\b|\bwhy (is|do|does)\b|\bvs\b|\bfor sale\b|\bnear miss\b|\brear end(ed)? collision\b|\bhead on collision\b|\bcollision (course|detection|avoidance|warning|insurance|coverage|deductible)\b/;

// Words that look like a different trade: never a search for these businesses.
const OTHER_TRADES = /\b(appliance|hvac|furnace|heating|plumb\w*|electric(ian|al)|roof\w*|garage door|phone|iphone|laptop|computer|washer|dryer|fridge|refrigerator|dishwasher|pawn|dental|dentist|bike|bicycle|boat|watch|jewel\w*|shoe|house|home|tv|television)\b/;

const GENERIC = new Set(
  "shop shops store stores group groups service services company companies business businesses independent repair repairs center centre the and of for local best professional quality".split(" "),
);

export type Relevance = {
  /** Topic the search belongs to ("bumper repair"), or null when it isn't one this business can win. */
  topic: string | null;
  reason?: "off-intent" | "other-trade" | "not-a-service" | "other-place-or-brand" | "brand";
};

export type BusinessProfile = { category: string; city: string; brand: string };

/**
 * Judge one search for one business. `city` is the business's own city
 * (other place names make a search about somewhere else).
 */
export function judgeSearch(
  keyword: string,
  p: BusinessProfile,
  // Searches the business already ranks for: Google has judged the place
  // (often a nearby suburb, like "kanata" for Ottawa) relevant, so unknown
  // extra words are allowed. Off-topic and other-trade searches still aren't.
  opts: { alreadyRanks?: boolean } = {},
): Relevance {
  const k = ` ${words(keyword).join(" ")} `;
  const ws = words(keyword);
  if (OFF_PHRASES.test(k) || ws.some((w) => OFF_INTENT.has(w))) return { topic: null, reason: "off-intent" };
  if (OTHER_TRADES.test(k)) return { topic: null, reason: "other-trade" };
  const brand = words(p.brand).filter((w) => !GENERIC.has(w) && !MODIFIERS.has(w) && w.length >= 3);
  if (brand.length && brand.every((b) => ws.includes(b))) return { topic: null, reason: "brand" };

  const cityWords = words(p.city);
  const inds = industriesFor(p.category);
  if (inds.length) {
    for (const ind of inds) {
      const hit = ind.services.find((s) => s.pattern.test(k));
      if (!hit) continue;
      const leftover = ws.filter((w) => !MODIFIERS.has(w) && !cityWords.includes(w) && !ind.allowed.includes(w) && !/^\d+$/.test(w));
      if (leftover.length && !opts.alreadyRanks) return { topic: null, reason: "other-place-or-brand" };
      return { topic: hit.topic };
    }
    return { topic: null, reason: "not-a-service" };
  }

  // Unknown trade: the search must contain one of the business's own distinctive words.
  const own = words(p.category).filter((w) => !GENERIC.has(w) && !MODIFIERS.has(w) && w.length >= 3);
  const stem = (w: string) => w.replace(/(ies|es|s)$/, "");
  const ownStems = new Set(own.map(stem));
  if (!ws.some((w) => ownStems.has(stem(w)))) return { topic: null, reason: "not-a-service" };
  const core = ws.filter((w) => !MODIFIERS.has(w) && !cityWords.includes(w)).join(" ");
  return { topic: core || null };
}

/**
 * The one service to track and lead with: the trade's main service when we
 * know the trade ("Collision Repai" -> "collision repair"), otherwise the
 * first service the owner listed.
 */
export function mainService(category: string): string {
  const inds = industriesFor(category);
  if (inds.length) return inds[0].services[0].topic;
  return servicesFrom(category)[0] ?? category.trim().toLowerCase().slice(0, 60);
}

/** The searches to research for this business: each listed service, with and without the city. */
export function seedsFor(category: string, city: string): string[] {
  const inds = industriesFor(category);
  const base = inds.length
    ? inds.flatMap((i) => i.services.slice(0, 3).map((s) => s.topic))
    : servicesFrom(category);
  const out = base.flatMap((s) => (city ? [s, `${s} ${city.toLowerCase()}`, `${s} near me`] : [s, `${s} near me`]));
  return [...new Set(out)].slice(0, 20);
}

/** Plain-language trade label for prompts ("auto body / collision repair shop"). */
export function tradeLabel(category: string): string {
  const inds = industriesFor(category);
  return inds.length ? inds.map((i) => i.label).join(" and ") : category.slice(0, 100);
}
