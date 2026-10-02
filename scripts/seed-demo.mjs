// Demo data for previews: a fictional shop with 60 days of history, a demo
// admin, and a sample campaign of fictional businesses. Runs at build time
// as the database owner, and ONLY when DEMO_MODE=true on a preview (or
// locally). Never on production. All emails/domains use the reserved
// ".test" TLD, which can't receive mail or resolve on the internet.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";

const enabled =
  process.env.DEMO_MODE === "true" &&
  process.env.VERCEL_ENV !== "production" &&
  (process.env.VERCEL_ENV === "preview" || !process.env.VERCEL);
const url = process.env.DATABASE_URL_UNPOOLED;
if (!enabled || !url) {
  console.log("Demo data: skipped.");
  process.exit(0);
}

const DEMO_OWNER = "demo-owner@torquerank.test";
const DEMO_ADMIN = "demo-admin@torquerank.test";
const DEMO_AGENCY = "demo-agency@torquerank.test";
const DOMAIN = "acmecollision.test";
const sha = (s) => createHash("sha256").update(s).digest("hex");
const dayStr = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

// Deterministic wobble so the history looks real but is the same every deploy.
const wobble = (i, k) => Math.round(Math.sin(i * 1.7 + k) * 0.6);
/** Linear steps between [dayOffset, value] points; null = not found. */
function series(points, i, k = 0, noisy = true) {
  let v = points[0][1];
  for (let p = 0; p < points.length - 1; p++) {
    const [d0, v0] = points[p];
    const [d1, v1] = points[p + 1];
    if (i >= d0 && i <= d1) {
      if (v0 === null || v1 === null) v = i < d1 ? v0 : v1;
      else v = Math.round(v0 + ((v1 - v0) * (i - d0)) / (d1 - d0));
    } else if (i > d1) v = v1;
  }
  // Settle the last few days so the end value matches the story on /demo.
  return v === null || !noisy || i >= 56 ? v : Math.max(1, v + wobble(i, k));
}

/** Unrounded linear interpolation (for ratings like 4.3 → 4.6). */
function lerp(points, i) {
  for (let p = 0; p < points.length - 1; p++) {
    const [d0, v0] = points[p];
    const [d1, v1] = points[p + 1];
    if (i >= d0 && i <= d1) return v0 + ((v1 - v0) * (i - d0)) / (d1 - d0);
  }
  return points.at(-1)[1];
}

// Day 0 = 60 days ago, day 60 = today.
// ai: [shown, cited from day] (cited null = never)
const SEARCHES = [
  { ai: [true, 39], keyword: "collision repair ottawa", map: [[0, 9], [10, 9], [30, 6], [45, 5], [60, 4]], org: [[0, 14], [24, 14], [40, 9], [60, 6]] },
  { ai: [false, null], keyword: "auto body shop kanata", map: [[0, null], [22, null], [23, 11], [45, 5], [60, 3]], org: [[0, null], [24, null], [25, 19], [60, 8]] },
  { ai: [true, null], keyword: "bumper repair ottawa", map: [[0, 7], [39, 7], [60, 5]], org: [[0, 18], [26, 18], [60, 11]] },
];
const REVIEWS = [[0, 48], [8, 48], [60, 97]];
const RATING = [[0, 4.3], [8, 4.3], [60, 4.6]];
const CHANGES = [
  [8, "Started asking every customer for a Google review", "Text message with the review link the day the car is picked up."],
  [22, "Added a \"Collision repair in Kanata\" page", "Photos of real jobs, insurance companies we work with, and a quote form."],
  [39, "Completed the Google Business Profile", "Added all services, 40 photos, holiday hours and the booking link."],
  [51, "Replied to every review, old and new", null],
];
const LEADERS = [
  { rank: 1, name: "Riverside Collision (fictional)", domain: "riversidecollision.test", rating: 4.8, reviews: 612, category: "Auto body shop" },
  { rank: 2, name: "Bytown Auto Body (fictional)", domain: "bytownautobody.test", rating: 4.7, reviews: 388, category: "Auto body shop" },
  { rank: 3, name: "Glebe Collision Centre (fictional)", domain: "glebecollision.test", rating: 4.9, reviews: 254, category: "Auto body shop" },
];

const pool = new pg.Pool({ connectionString: url, max: 1 });
const c = await pool.connect();
try {
  await c.query("BEGIN");
  // Start clean every deploy. Cascades remove orgs' memberships, history etc.
  await c.query(
    `DELETE FROM organizations WHERE id IN (SELECT m.org_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email LIKE '%@torquerank.test')`,
  );
  // Demo agency locations nobody else belongs to, then the agency itself.
  await c.query(
    `DELETE FROM organizations WHERE id IN (SELECT l.org_id FROM agency_locations l JOIN agencies a ON a.id = l.agency_id WHERE a.name LIKE '%(Demo)')`,
  );
  await c.query(`DELETE FROM agencies WHERE name LIKE '%(Demo)'`);
  await c.query(`DELETE FROM users WHERE email LIKE '%@torquerank.test'`);
  await c.query(`DELETE FROM campaigns WHERE name LIKE '%(Demo)'`);

  const owner = randomUUID();
  const admin = randomUUID();
  await c.query(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, 'Dana (demo owner)', now()), ($3, $4, 'TorqueRank staff (demo)', now())`, [
    owner, DEMO_OWNER, admin, DEMO_ADMIN,
  ]);
  await c.query(`INSERT INTO platform_admins (user_id) VALUES ($1)`, [admin]);

  const org = randomUUID();
  await c.query(
    `INSERT INTO organizations (id, name, website_domain, service_area, category, primary_goal, goals, ad_spend_range, website_manager, country, countries, plan_status, trial_ends_at, created_at)
     VALUES ($1, 'Acme Collision (Demo)', $2, 'Ottawa, ON', 'Collision repair', 'calls', '{calls,walk_ins}', '500_2000', 'self', 'CA', '{CA}', 'trialing', now() + interval '5 days', now() - interval '60 days')`,
    [org, DOMAIN],
  );
  await c.query(`INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'owner')`, [org, owner]);

  // The assessment they saw on day 0.
  const assessment = {
    version: 1, domain: DOMAIN, country: "CA", serviceArea: "Ottawa, ON", reach: "local", category: "Collision repair",
    primaryKeyword: "collision repair ottawa", dataSource: "live", generatedAt: new Date(Date.now() - 60 * 86_400_000).toISOString(),
    metrics: { advertisers: 1, topCpcUsd: 9.8, monthlySearches: 2140, yourPosition: 14, rescueTargets: 3, rescueMonthlySearches: 2430 },
    insights: [
      { title: "You're #9 in Google Maps for \"collision repair ottawa\"", detail: "The top 3 map listings get most of the calls. Reviews, a complete Business Profile and a page on your site for this service and city are what move you up." },
      { title: "You have 48 reviews; the leaders average 418", detail: "The top 3 map listings average 4.8★ from 418 reviews; you have 4.3★ from 48. Asking for about 15 new reviews a week would close the gap in roughly 6 months." },
      { title: "You're not on page 1 for \"collision repair ottawa\"", detail: "You're #14. A dedicated page for this service and city, plus steady Google reviews, is the most reliable way to move up." },
      { title: "3 searches where you're on page 2 or 3", detail: "Your best opportunity: \"collision repair near me\" (position 14, about 1,900 searches a month). Moving to page 1 is usually faster than starting from scratch." },
      { title: "Your quickest next step", detail: "Put your phone number at the top of every page and in your Google Business Profile so searchers can call in one tap." },
    ],
    insightsSource: "rules",
    rescueTargets: [
      { keyword: "collision repair near me", position: 14, monthlySearches: 1900, cpcUsd: 11.4, score: 0 },
      { ai: [true, null], keyword: "bumper repair ottawa", position: 18, monthlySearches: 390, cpcUsd: 8.95, score: 0 },
      { ai: [false, null], keyword: "auto body shop kanata", position: 29, monthlySearches: 140, cpcUsd: 7.2, score: 0 },
    ],
    topKeywords: [
      { keyword: "collision repair ottawa", monthlySearches: 880, cpcUsd: 9.8 },
      { keyword: "auto body shop ottawa", monthlySearches: 720, cpcUsd: 8.1 },
      { keyword: "best collision repair ottawa", monthlySearches: 110, cpcUsd: 12.1 },
    ],
    competitors: [{ domain: "riversidecollision.test", ads: 2 }],
    local: { keyword: "collision repair ottawa", yourRank: 9, you: { name: "Acme Collision", rating: 4.3, reviews: 48 }, leaders: LEADERS, leaderAvgRating: 4.8, leaderAvgReviews: 418, directoriesInTop10: 2 },
  };
  await c.query(`INSERT INTO org_assessments (id, org_id, result_json, created_at) VALUES ($1, $2, $3, now() - interval '60 days')`, [randomUUID(), org, assessment]);

  // 60 days of daily checks per tracked search.
  for (const [k, s] of SEARCHES.entries()) {
    const sid = randomUUID();
    await c.query(`INSERT INTO tracked_searches (id, org_id, keyword, country, created_at) VALUES ($1, $2, $3, 'CA', now() - interval '60 days')`, [sid, org, s.keyword]);
    const rows = [];
    for (let i = 0; i <= 60; i++) {
      rows.push([
        randomUUID(), org, sid, dayStr(i - 60),
        series(s.map, i, k), series(s.org, i, k + 3),
        Math.round(lerp(RATING, i) * 10) / 10, series(REVIEWS, i, 0, false),
        4.8, 418 + Math.floor(i / 6),
        i === 0 ? "assessment" : "daily",
        s.ai[0], s.ai[0] ? s.ai[1] !== null && i >= s.ai[1] : false,
      ]);
    }
    for (const r of rows) {
      await c.query(
        `INSERT INTO rank_checks (id, org_id, tracked_search_id, day, map_rank, organic_rank, rating, reviews, leader_avg_rating, leader_avg_reviews, source, ai_overview, ai_cited, data_source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'live')`,
        r,
      );
    }
  }
  const changeIds = [];
  for (const [d, title, note] of CHANGES) {
    const id = randomUUID();
    changeIds.push(id);
    await c.query(`INSERT INTO site_changes (id, org_id, title, note, made_on, created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6)`, [
      id, org, title, note, dayStr(d - 60), owner,
    ]);
  }

  // Action plan: two items done (they became the first two changes), four open.
  const ACTIONS = [
    ["done", "review_request", CHANGES[0][1], "You had 48 Google reviews; the top 3 in Google Maps averaged 418.",
      "Hi [first name], thanks for choosing Acme Collision. If you're happy with the work, would you mind leaving us a quick Google review? It takes a minute and really helps a local business: [your Google review link]", null, null, 0],
    ["done", "new_page", CHANGES[1][1], "About 140 searches a month and you were #29.",
      "Main heading: Collision Repair in Kanata\n\nSections: what we do, 3 real jobs with photos, how it works, why us, reviews, FAQ, call button.", "auto body shop kanata", 101, 1],
    ["open", "page_title", "Rewrite the page title for \"collision repair near me\"",
      "You're #9 on Google for \"collision repair near me\" (about 1,900 searches a month). A clear title that matches the search wins more clicks and helps you move up.",
      "Page title (under 60 characters):\nCollision Repair Near Me | Acme Collision Ottawa\n\nMeta description (under 155 characters):\nNeed collision repair in Ottawa? Acme Collision offers free estimates, works with all insurers and gets you back on the road fast. Call today.",
      "collision repair near me", 2166, null],
    ["open", "new_page", "Add a dedicated page for \"bumper repair ottawa\"",
      "About 390 searches a month, and you're #11, just off page 1. A page built for exactly this search is the most reliable way onto page 1.",
      "Page address: /bumper-repair-ottawa\nMain heading: Bumper Repair in Ottawa\n\nSections:\n1. What we do: 2–3 sentences on bumper repair at Acme Collision.\n2. Photos of 3 real bumper jobs (before and after).\n3. Repair or replace? How we decide, and typical cost range [fill in].\n4. Insurance: we handle the claim.\n5. Reviews: 2–3 short quotes from real Google reviews.\n6. FAQ: \"How long does bumper repair take?\", \"Can you match my paint?\"\n7. Call button and quote form at the top and bottom.",
      "bumper repair ottawa", 349, null],
    ["open", "gbp_post", "Post an update to your Google Business Profile this week",
      "Weekly posts keep your profile active and give searchers a reason to call you over the next listing.",
      "Before/after of the week 🚗 This [car] came in after a [rear-end collision]. Acme Collision handled the insurance claim and had it back to the owner in [X] days. Need collision repair in Ottawa? Call us or book a free estimate.", null, null, null],
    ["open", "review_reply", "Reply to every new review within 2 days",
      "You've replied to all your old reviews. Keeping it up shows Google and customers you're active.",
      "Positive review:\nThank you, [name]! We're glad your [car] is back to looking like new. We appreciate you choosing Acme Collision.\n\nNegative review:\nHi [name], thank you for the feedback, and I'm sorry we fell short. Please call me directly at [phone] so I can make this right. – [owner's name], Acme Collision", null, null, null],
  ];
  for (const [status, kind, title, why, content, keyword, value, changeIdx] of ACTIONS) {
    await c.query(
      `INSERT INTO action_items (id, org_id, kind, title, why, content, keyword, value_usd_month, status, source, change_id, done_at, created_at)
       VALUES ($1,$2,$3::action_kind,$4,$5,$6,$7,$8,$9::action_status,'rules',$10,$11, now() - interval '55 days')`,
      [randomUUID(), org, kind, title, why, content.replaceAll("\\n", "\n"), keyword, value, status,
       changeIdx === null ? null : changeIds[changeIdx],
       changeIdx === null ? null : new Date(Date.now() + (CHANGES[changeIdx][0] - 60) * 86_400_000)],
    );
  }

  // 9 weekly whole-site snapshots for the SEO dashboard (week 0 = 56 days ago).
  const POOL = [
    ["collision repair ottawa", 880, 9.8, 14, 6], ["auto body shop ottawa", 720, 8.1, 9, 4], ["collision repair near me", 1900, 11.4, 14, 9],
    ["bumper repair ottawa", 390, 8.95, 18, 11], ["auto body shop kanata", 140, 7.2, 29, 8], ["acme collision", 90, 1.1, 1, 1],
    ["car scratch repair ottawa", 210, 5.4, 12, 7], ["dent repair ottawa", 320, 6.2, 16, 10], ["paintless dent repair ottawa", 170, 6.9, 22, 13],
    ["auto glass ottawa", 590, 7.7, 41, 33], ["frame straightening ottawa", 50, 9.1, 8, 3], ["insurance claim body shop ottawa", 70, 10.2, 11, 5],
    ["hail damage repair ottawa", 110, 8.4, 26, 15], ["car paint shop ottawa", 260, 6.6, 19, 12], ["rust repair ottawa", 140, 5.9, 15, 9],
    ["bumper replacement cost", 2400, 2.1, 58, 44], ["collision repair kanata", 90, 8.8, 35, 4], ["body shop orleans", 110, 7.4, 47, 28],
    ["headlight restoration ottawa", 90, 4.2, 9, 6], ["fender bender repair", 480, 5.1, 63, 39], ["auto body estimate", 720, 4.8, 71, 52],
    ["car door dent repair", 390, 4.4, 38, 21], ["windshield chip repair ottawa", 170, 6.1, 52, 41], ["best body shop ottawa", 140, 12.1, 21, 8],
  ];
  const lerpN = (a, b, w) => Math.round(a + (b - a) * w);
  for (let week = 0; week <= 8; week++) {
    const w = week / 8;
    // Some searches only start ranking partway through (they count as "new").
    const keywords = POOL.filter((k, idx) => !(idx >= 16 && week < 3) && !(idx === 22 && week < 6)).map(([keyword, searches, cpc, from, to]) => {
      const position = Math.max(1, lerpN(from, to, w) + (week % 2 && from > 3 ? 1 : 0));
      const share = position <= 10 ? [0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.03, 0.025, 0.02][position - 1] : position <= 20 ? 0.01 : 0.002;
      return { keyword, position, searches, cpcUsd: cpc, url: `https://${DOMAIN}/`, trafficEst: Math.round(searches * share * 10) / 10 };
    });
    const pages = [
      { url: `https://${DOMAIN}/`, failed: week < 4 ? ["no_image_alt", "high_loading_time", "no_description"] : ["no_image_alt", "high_loading_time"] },
      { url: `https://${DOMAIN}/collision-repair`, failed: week < 6 ? ["title_too_long", "no_image_alt", "no_h1_tag"] : ["title_too_long", "no_image_alt"] },
      { url: `https://${DOMAIN}/kanata`, failed: week < 3 ? ["no_description", "low_content_rate"] : ["no_description"] },
      { url: `https://${DOMAIN}/contact`, failed: ["no_image_alt"] },
      { url: `https://${DOMAIN}/about`, failed: [] },
    ].map((p) => ({ ...p, score: Math.round(100 - p.failed.length * 7 - (week < 4 ? 6 : 0)) }));
    const data = {
      overview: {
        trafficEst: lerpN(182, 418, w) + (week % 3 === 1 ? 9 : 0),
        keywords: lerpN(74, 121, w),
        trafficValueUsd: lerpN(1710, 4080, w),
        paidKeywords: 0,
        buckets: { top3: lerpN(4, 9, w), top10: lerpN(11, 24, w), top20: lerpN(22, 41, w), top100: lerpN(74, 121, w) },
      },
      keywords,
      audit: { score: Math.round(pages.reduce((a, p) => a + p.score, 0) / pages.length), pages },
    };
    await c.query(`INSERT INTO seo_snapshots (id, org_id, taken_on, data_source, data) VALUES ($1,$2,$3,'live',$4)`, [
      randomUUID(), org, dayStr(week * 7 - 56), data,
    ]);
  }

  // Keyword plan: topics with the searches people use, who pays for ads,
  // and how well the shop's pages match. The suggested changes are written
  // by the app's own templates when the page loads.
  const HOME = { url: `https://${DOMAIN}/`, title: "Acme Collision – Auto Body Shop Ottawa", h1: "Ottawa's Trusted Body Shop" };
  const TOP3 = ["riversidecollision.test", "glebecollision.test", "bytownautobody.test"];
  const k = (keyword, searches, cpcUsd, position, url, adsBy = null, top3 = null) => ({ keyword, searches, cpcUsd, position, url, adsBy, top3 });
  const TOPICS = [
    { name: "collision repair", status: "aligned", matched: true,
      page: { url: `https://${DOMAIN}/collision-repair`, title: "Collision Repair in Ottawa | Acme Collision", h1: "Collision Repair in Ottawa" },
      keywords: [
        k("collision repair near me", 1900, 11.4, 9, `https://${DOMAIN}/collision-repair`, ["riversidecollision.test", "bytownautobody.test"], TOP3),
        k("collision repair ottawa", 880, 9.8, 6, `https://${DOMAIN}/collision-repair`, [], TOP3),
        k("best collision repair ottawa", 110, 12.1, null, null, ["riversidecollision.test"], TOP3),
        k("collision repair kanata", 90, 8.8, 4, `https://${DOMAIN}/kanata`, [], null),
      ] },
    { name: "car painting", status: "missing", matched: null, page: null,
      keywords: [
        k("car painting near me", 720, 5.2, null, null, ["colourcraftpaint.test", "riversidecollision.test"], ["colourcraftpaint.test", "yelp.test", "kijiji.test"]),
        k("car painting ottawa", 390, 6.4, null, null, ["colourcraftpaint.test"], ["colourcraftpaint.test", "riversidecollision.test", "yelp.test"]),
        k("car painting cost", 260, 2.9, null, null, null, null),
      ] },
    { name: "bumper repair", status: "weak", matched: false, page: HOME,
      keywords: [
        k("bumper repair ottawa", 390, 8.95, 11, HOME.url, ["bytownautobody.test"], TOP3),
        k("bumper repair near me", 320, 7.5, null, null, ["bytownautobody.test", "riversidecollision.test"], TOP3),
        k("bumper repair cost", 210, 3.2, null, null, null, null),
      ] },
    { name: "auto glass", status: "weak", matched: false, page: HOME,
      keywords: [
        k("auto glass near me", 880, 8.6, null, null, ["speedyglass.test", "glassmasters.test"], ["speedyglass.test", "glassmasters.test", "yelp.test"]),
        k("auto glass ottawa", 590, 7.7, 33, HOME.url, ["speedyglass.test"], ["speedyglass.test", "glassmasters.test", "ottawaglass.test"]),
        k("best auto glass ottawa", 90, 9.0, null, null, null, null),
      ] },
    { name: "dent repair", status: "weak", matched: false, page: HOME,
      keywords: [
        k("dent repair ottawa", 320, 6.2, 10, HOME.url, [], TOP3),
        k("car door dent repair", 390, 4.4, 21, HOME.url, null, null),
        k("paintless dent repair ottawa", 170, 6.9, 13, HOME.url, ["dentwizard.test"], ["dentwizard.test", "topdent.test", "yelp.test"]),
      ] },
    { name: "rust repair", status: "aligned", matched: true,
      page: { url: `https://${DOMAIN}/rust-repair`, title: "Rust Repair Ottawa | Acme Collision", h1: "Rust Repair in Ottawa" },
      keywords: [k("rust repair ottawa", 140, 5.9, 9, `https://${DOMAIN}/rust-repair`, null, null)] },
  ].map((t) => {
    const searches = t.keywords.reduce((a, x) => a + x.searches, 0);
    const valueUsd = Math.round(t.keywords.reduce((a, x) => a + x.searches * x.cpcUsd * 0.1, 0));
    const ranked = t.keywords.filter((x) => x.position !== null).map((x) => x.position);
    return { ...t, searches, valueUsd, bestPosition: ranked.length ? Math.min(...ranked) : null };
  });
  await c.query(`INSERT INTO keyword_plans (id, org_id, built_on, data_source, data, created_at) VALUES ($1,$2,$3,'live',$4, now() - interval '1 day')`, [
    randomUUID(), org, dayStr(-1),
    { topics: TOPICS, totalSearches: TOPICS.reduce((a, t) => a + t.searches, 0), totalValueUsd: TOPICS.reduce((a, t) => a + t.valueUsd, 0) },
  ]);

  // A sample campaign of fictional shops (one already claimed: the demo shop).
  const camp = randomUUID();
  await c.query(
    `INSERT INTO campaigns (id, name, category, city, country, keyword, data_source, created_by_user_id, created_at)
     VALUES ($1, 'Collision repair · Ottawa (Demo)', 'Collision repair', 'Ottawa', 'CA', 'collision repair ottawa', 'live', $2, now() - interval '62 days')`,
    [camp, admin],
  );
  const PROSPECTS = [
    ["Riverside Collision (fictional)", "riversidecollision.test", 1, 4.8, 612, 3, "opened"],
    ["Bytown Auto Body (fictional)", "bytownautobody.test", 2, 4.7, 388, 5, "new"],
    ["Glebe Collision Centre (fictional)", "glebecollision.test", 3, 4.9, 254, null, "opened"],
    ["Lakeshore Auto Body (fictional)", "lakeshoreautobody.test", 5, 4.4, 131, 12, "new"],
    ["Merivale Paint & Collision (fictional)", "merivalecollision.test", 7, 4.1, 66, null, "new"],
    ["Acme Collision (Demo)", DOMAIN, 9, 4.3, 48, 14, "claimed"],
    ["Orleans Body Works (fictional)", "orleansbodyworks.test", 11, 4.6, 39, 21, "opened"],
    ["Carp Road Collision (fictional)", "carproadcollision.test", 14, 3.9, 17, null, "new"],
  ];
  for (const [name, domain, rank, rating, reviews, organic, status] of PROSPECTS) {
    const report = { mapRank: rank, rating, reviews, leaderAvgRating: 4.8, leaderAvgReviews: 418, organicRank: organic, directoriesInTop10: 2, listingsChecked: 20, checkedOn: dayStr(-62), dataSource: "live" };
    await c.query(
      `INSERT INTO prospects (id, campaign_id, business_name, domain, report, token_hash, status, opened_at, claimed_at, claimed_org_id, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::prospect_status,$8,$9,$10, now() + interval '60 days')`,
      [
        randomUUID(), camp, name, domain, report, sha(randomBytes(32).toString("base64url")), status,
        status === "new" ? null : new Date(Date.now() - 61 * 86_400_000),
        status === "claimed" ? new Date(Date.now() - 60 * 86_400_000) : null,
        status === "claimed" ? org : null,
      ],
    );
  }
  // A demo agency managing six fictional shops (PRD Module 11). Acme
  // Collision is left out on purpose: its owner can try "Give an agency
  // access" and the agency can connect it with the code.
  const agencyUser = randomUUID();
  await c.query(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, 'Sam (demo agency)', now())`, [agencyUser, DEMO_AGENCY]);
  const agency = randomUUID();
  await c.query(`INSERT INTO agencies (id, name, plan_status, trial_ends_at, created_at) VALUES ($1, 'Northside Marketing (Demo)', 'trialing', now() + interval '11 days', now() - interval '60 days')`, [agency]);
  await c.query(`INSERT INTO agency_members (agency_id, user_id, role) VALUES ($1, $2, 'owner')`, [agency, agencyUser]);

  // org: [[day, rank]...] for the main search; days run 0..60 like above.
  const SHOPS = [
    { name: "Kanata Auto Body", domain: "kanataautobody.test", city: "Kanata, ON", category: "Collision repair", ownerEmail: "owner-kanata@torquerank.test", start: 0,
      searches: [{ keyword: "collision repair kanata", org: [[0, 22], [20, 21], [45, 9], [60, 7]], map: [[0, 8], [30, 6], [60, 3]] },
                 { keyword: "auto body shop kanata", org: [[0, 31], [25, 30], [60, 12]], map: [[0, 11], [60, 6]] }],
      reviews: [[0, 61], [60, 104]], traffic: [140, 352], topics: [["collision repair", "aligned"], ["bumper repair", "aligned"], ["car painting", "weak"], ["dent repair", "missing"]] },
    { name: "Barrhaven Collision Centre", domain: "barrhavencollision.test", city: "Barrhaven, ON", category: "Collision repair", ownerEmail: null, start: 0,
      searches: [{ keyword: "collision repair barrhaven", org: [[0, 17], [30, 16], [60, 11]], map: [[0, 6], [60, 4]] }],
      reviews: [[0, 33], [60, 51]], traffic: [88, 141], topics: [["collision repair", "weak"], ["auto glass", "missing"], ["rust repair", "aligned"]] },
    { name: "Orleans Auto Glass", domain: "orleansautoglass.test", city: "Orleans, ON", category: "Auto glass", ownerEmail: null, start: 0,
      searches: [{ keyword: "auto glass orleans", org: [[0, 12], [60, 12]], map: [[0, 5], [60, 5]] }],
      reviews: [[0, 120], [60, 126]], traffic: [210, 214], topics: [["windshield replacement", "aligned"], ["windshield chip repair", "weak"], ["car window tinting", "missing"]] },
    { name: "Nepean Paint & Body", domain: "nepeanpaintbody.test", city: "Nepean, ON", category: "Car painting", ownerEmail: "owner-nepean@torquerank.test", start: 0,
      searches: [{ keyword: "car painting nepean", org: [[0, 8], [50, 8], [60, 13]], map: [[0, 4], [50, 4], [60, 7]] }],
      reviews: [[0, 88], [60, 92]], traffic: [260, 198], topics: [["car painting", "weak"], ["scratch repair", "missing"], ["collision repair", "aligned"]] },
    { name: "Stittsville Tire & Auto", domain: "stittsvilleauto.test", city: "Stittsville, ON", category: "Auto repair", ownerEmail: null, start: 25,
      searches: [{ keyword: "auto repair stittsville", org: [[25, 31], [40, 24], [60, 15]], map: [[25, 14], [60, 8]] }],
      reviews: [[25, 19], [60, 40]], traffic: [40, 96], topics: [["auto repair", "weak"], ["brake repair", "missing"], ["tire change", "aligned"], ["oil change", "missing"]] },
    { name: "Kingston Collision", domain: "kingstoncollision.test", city: "Kingston, ON", category: "Collision repair", ownerEmail: null, start: 60, searches: [], topics: [] },
  ];
  for (const [n, shop] of SHOPS.entries()) {
    const o = randomUUID();
    await c.query(
      `INSERT INTO organizations (id, name, website_domain, service_area, category, country, countries, plan_status, trial_ends_at, created_at)
       VALUES ($1, $2, $3, $4, $5, 'CA', '{CA}', 'trialing', now(), now() - make_interval(days => $6))`,
      [o, `${shop.name} (Demo)`, shop.domain, shop.city, shop.category, 60 - shop.start],
    );
    await c.query(
      `INSERT INTO agency_locations (id, agency_id, org_id, created_by_agency, started_at) VALUES ($1, $2, $3, $4, now() - make_interval(days => $5))`,
      [randomUUID(), agency, o, !shop.ownerEmail, 60 - shop.start],
    );
    if (shop.ownerEmail) {
      const u = randomUUID();
      await c.query(`INSERT INTO users (id, email, name, email_verified) VALUES ($1, $2, $3, now())`, [u, shop.ownerEmail, `${shop.name} owner (demo)`]);
      await c.query(`INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'owner')`, [o, u]);
    }
    if (shop.start === 60) {
      // Added yesterday: tracking starts tonight, nothing measured yet.
      await c.query(`INSERT INTO tracked_searches (id, org_id, keyword, country) VALUES ($1, $2, 'collision repair kingston', 'CA')`, [randomUUID(), o]);
      continue;
    }
    for (const [k, srch] of shop.searches.entries()) {
      const sid = randomUUID();
      await c.query(`INSERT INTO tracked_searches (id, org_id, keyword, country, created_at) VALUES ($1, $2, $3, 'CA', now() - make_interval(days => $4))`, [sid, o, srch.keyword, 60 - shop.start]);
      for (let i = shop.start; i <= 60; i++) {
        await c.query(
          `INSERT INTO rank_checks (id, org_id, tracked_search_id, day, map_rank, organic_rank, rating, reviews, leader_avg_rating, leader_avg_reviews, source, ai_overview, ai_cited, data_source)
           VALUES ($1,$2,$3,$4,$5,$6,4.5,$7,4.8,300,$8,$9,false,'live')`,
          [randomUUID(), o, sid, dayStr(i - 60), series(srch.map, i, n + k), series(srch.org, i, n + k + 3), series(shop.reviews, i, 0, false),
           i === shop.start ? "assessment" : "daily", k === 0],
        );
      }
    }
    // Weekly whole-site snapshots.
    const main = shop.searches[0].keyword;
    for (let week = Math.ceil(shop.start / 7); week <= 8; week++) {
      const w = week / 8;
      const kws = [main, ...shop.searches.slice(1).map((x) => x.keyword), `${shop.category.toLowerCase()} near me`, shop.name.toLowerCase()].map((keyword, j) => {
        const position = j === 0 ? series(shop.searches[0].org, week * 7 + 4, n, false) ?? 40 : j === 3 ? 1 : 10 + j * 6;
        return { keyword, position, searches: [480, 260, 1300, 70][j] ?? 100, cpcUsd: [8.4, 7.1, 9.9, 1.0][j] ?? 5, url: `https://${shop.domain}/`, trafficEst: position <= 10 ? 20 : 2 };
      });
      const traffic = Math.round(shop.traffic[0] + (shop.traffic[1] - shop.traffic[0]) * w);
      await c.query(`INSERT INTO seo_snapshots (id, org_id, taken_on, data_source, data) VALUES ($1,$2,$3,'live',$4)`, [
        randomUUID(), o, dayStr(week * 7 - 56),
        {
          overview: { trafficEst: traffic, keywords: Math.round(traffic / 3), trafficValueUsd: traffic * 9, paidKeywords: 0,
            buckets: { top3: Math.round(traffic / 60), top10: Math.round(traffic / 25), top20: Math.round(traffic / 14), top100: Math.round(traffic / 3) } },
          keywords: kws,
          audit: { score: 82, pages: [{ url: `https://${shop.domain}/`, failed: ["no_image_alt"], score: 93 }, { url: `https://${shop.domain}/contact`, failed: ["no_description", "no_image_alt"], score: 86 }] },
        },
      ]);
    }
    // Keyword plan.
    const city = shop.city.split(",")[0].toLowerCase();
    const topics = shop.topics.map(([name, status], j) => {
      const page = status === "aligned"
        ? { url: `https://${shop.domain}/${name.replaceAll(" ", "-")}`, title: `${name[0].toUpperCase()}${name.slice(1)} in ${shop.city.split(",")[0]} | ${shop.name}`, h1: `${name} in ${city}` }
        : status === "weak" ? { url: `https://${shop.domain}/`, title: `${shop.name} – ${shop.category}`, h1: shop.name } : null;
      const pos = status === "aligned" ? 4 + j : status === "weak" ? 14 + j : null;
      const keywords = [
        { keyword: `${name} ${city}`, searches: 320 - j * 40, cpcUsd: 7.5, position: pos, url: page?.url ?? null, adsBy: ["bigchainauto.test"], top3: ["bigchainauto.test", "yelp.test", "kijiji.test"] },
        { keyword: `${name} near me`, searches: 590 - j * 60, cpcUsd: 8.9, position: pos === null ? null : pos + 3, url: page?.url ?? null, adsBy: ["bigchainauto.test", "cityautogroup.test"], top3: null },
      ];
      const searches = keywords.reduce((a, x) => a + x.searches, 0);
      return { name, status, matched: status === "aligned" ? true : status === "weak" ? false : null, page, keywords, searches,
        valueUsd: Math.round(keywords.reduce((a, x) => a + x.searches * x.cpcUsd * 0.1, 0)), bestPosition: pos };
    });
    await c.query(`INSERT INTO keyword_plans (id, org_id, built_on, data_source, data, created_at) VALUES ($1,$2,$3,'live',$4, now() - interval '2 days')`, [
      randomUUID(), o, dayStr(-2),
      { topics, totalSearches: topics.reduce((a, t) => a + t.searches, 0), totalValueUsd: topics.reduce((a, t) => a + t.valueUsd, 0) },
    ]);
    // A short to-do list.
    const todo = [
      ["review_request", "Ask every customer this week for a Google review", "The top 3 in Google Maps have far more reviews.", "Hi [first name], thanks for choosing us! Would you leave a quick Google review? [your Google review link]"],
      ["gbp_post", "Post an update to your Google Business Profile this week", "Weekly posts keep the profile active.", "Before/after of the week: [photo + one line about the job]. Call us for a free estimate."],
      ...topics.filter((t) => t.status !== "aligned").slice(0, 2).map((t) => ["new_page", `Add a "${t.name}" page`, `About ${t.searches} searches a month and no page made for them.`, `Page address: /${t.name.replaceAll(" ", "-")}-${city}\nMain heading: ${t.name} in ${city}`]),
    ];
    for (const [kind, title, why, content] of todo) {
      await c.query(
        `INSERT INTO action_items (id, org_id, kind, title, why, content, status, source, created_at)
         VALUES ($1,$2,$3::action_kind,$4,$5,$6,'open','rules', now() - interval '5 days')`,
        [randomUUID(), o, kind, title, why, content.replaceAll("\\n", "\n")],
      );
    }
  }

  await c.query("COMMIT");
  console.log("Demo data: seeded.");
} catch (err) {
  await c.query("ROLLBACK");
  console.error("Demo data failed:", err instanceof Error ? err.message : "unknown error");
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
