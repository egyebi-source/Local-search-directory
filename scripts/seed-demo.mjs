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
  return v === null || !noisy ? v : Math.max(1, v + wobble(i, k));
}

// Day 0 = 60 days ago, day 60 = today.
const SEARCHES = [
  { keyword: "collision repair ottawa", map: [[0, 9], [10, 9], [30, 6], [45, 5], [60, 4]], org: [[0, 14], [24, 14], [40, 9], [60, 6]] },
  { keyword: "auto body shop kanata", map: [[0, null], [22, null], [23, 11], [45, 5], [60, 3]], org: [[0, null], [24, null], [25, 19], [60, 8]] },
  { keyword: "bumper repair ottawa", map: [[0, 7], [39, 7], [60, 5]], org: [[0, 18], [26, 18], [60, 11]] },
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
      { keyword: "bumper repair ottawa", position: 18, monthlySearches: 390, cpcUsd: 8.95, score: 0 },
      { keyword: "auto body shop kanata", position: 29, monthlySearches: 140, cpcUsd: 7.2, score: 0 },
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
        Math.round(series(RATING, i, 0, false) * 10) / 10, series(REVIEWS, i, 0, false),
        4.8, 418 + Math.floor(i / 6),
        i === 0 ? "assessment" : "daily",
      ]);
    }
    for (const r of rows) {
      await c.query(
        `INSERT INTO rank_checks (id, org_id, tracked_search_id, day, map_rank, organic_rank, rating, reviews, leader_avg_rating, leader_avg_reviews, source, data_source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'live')`,
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
