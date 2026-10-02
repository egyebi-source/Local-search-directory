import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

// Drizzle table definitions (PRD §7).
//
// Two kinds of table:
// - Global tables (users and Auth.js tables, rate_limits) have no org_id.
// - Tenant tables carry org_id and are protected by row-level security
//   (see the RLS migration in drizzle/). Every tenant table needs an isolation test.

const id = () => uuid("id").primaryKey().$defaultFn(() => uuidv7());
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// --- Global: people and login (Auth.js) -------------------------------------

export const users = pgTable(
  "users",
  {
    id: id(),
    name: text("name"),
    email: text("email").notNull(),
    emailVerified: timestamp("email_verified", { withTimezone: true, mode: "date" }),
    image: text("image"),
    // Weekly progress email (opt-out via the signed link in every email).
    weeklyDigest: boolean("weekly_digest").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`)],
);

// Login provider links. Token columns exist only because Auth.js expects
// them; our adapter wrapper always stores NULL there (see server/auth/adapter.ts).
export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<"oauth" | "oidc" | "email" | "webauthn">().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.providerAccountId] }),
    index("accounts_user_id_idx").on(t.userId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    sessionToken: text("session_token").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

// Auth.js stores a hash of the sign-in link token here, never the token itself.
export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

// Fixed-window counters for rate limiting (login emails, invites).
// Keys are SHA-256 hashes, so no email addresses or IPs are stored here.
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
});

// --- Tenant: organizations ----------------------------------------------------

export const membershipRole = pgEnum("membership_role", ["owner", "member"]);
export type MembershipRole = (typeof membershipRole.enumValues)[number];

// Gate questions (PRD §2.1) and trial/billing state (PRD Module 10).
export const primaryGoal = pgEnum("primary_goal", ["calls", "form_leads", "walk_ins", "lower_ad_spend"]);
export const adSpendRange = pgEnum("ad_spend_range", [
  "none",
  "under_500",
  "500_2000",
  "2000_5000",
  "over_5000",
]);
export const websiteManager = pgEnum("website_manager", ["self", "agency", "nobody"]);
export const country = pgEnum("country", ["CA", "US"]);
export type Country = (typeof country.enumValues)[number];
export const planStatus = pgEnum("plan_status", ["trialing", "active", "past_due", "locked"]);
export type PlanStatus = (typeof planStatus.enumValues)[number];

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  websiteDomain: text("website_domain"),
  serviceArea: text("service_area"),
  category: text("category"),
  primaryGoal: primaryGoal("primary_goal"),
  adSpendRange: adSpendRange("ad_spend_range"),
  websiteManager: websiteManager("website_manager"),
  country: country("country"),
  // All goals and countries chosen; primaryGoal/country hold the first of each.
  goals: primaryGoal("goals").array(),
  countries: country("countries").array(),
  planStatus: planStatus("plan_status").notNull().default("trialing"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true })
    .notNull()
    .default(sql`now() + interval '7 days'`),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  deleteAfter: timestamp("delete_after", { withTimezone: true }),
  // Card billing (Stripe). Written only by the billing_apply function from
  // verified Stripe webhooks; the app role can read but never change them.
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  billingInterval: text("billing_interval").$type<"month" | "year">(),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  billingEventAt: timestamp("billing_event_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.userId] }),
    index("memberships_user_id_idx").on(t.userId),
  ],
);

export const invites = pgTable(
  "invites",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: membershipRole("role").notNull().default("member"),
    // SHA-256 of the invite token. The token itself exists only in the email.
    tokenHash: text("token_hash").notNull(),
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("invites_token_hash_idx").on(t.tokenHash),
    index("invites_org_id_idx").on(t.orgId),
  ],
);

// Append-only: the app role may insert and read, never update or delete.
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_org_id_created_at_idx").on(t.orgId, t.createdAt)],
);

// --- Global: pre-sign-up answers ------------------------------------------------

// Answers a visitor gives before creating an account (PRD §2.1). Held for
// 24 hours, keyed by the SHA-256 of a random token kept in an httpOnly
// cookie, and deleted the moment they're turned into an organization.
// When the visitor asks for a sign-in link, the draft is also tagged with a
// hash of that email, so the link can finish sign-up in another browser
// (e.g. answers given in an in-app browser, email opened in Safari).
export const assessmentDrafts = pgTable(
  "assessment_drafts",
  {
    tokenHash: text("token_hash").primaryKey(),
    answers: jsonb("answers").$type<Record<string, unknown>>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    emailHash: text("email_hash"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("assessment_drafts_expires_at_idx").on(t.expiresAt),
    index("assessment_drafts_email_hash_idx").on(t.emailHash, t.claimedAt),
  ],
);

// --- Global: public assessments (PRD Module 1) ----------------------------------

// Results of the free assessment, reachable only by an unguessable id
// (32 random bytes). Shared by every visitor with the same cache key for
// 7 days to control API cost; the page itself expires after 30 days.
export const publicSnapshots = pgTable(
  "public_snapshots",
  {
    id: text("id").primaryKey(),
    cacheKey: text("cache_key").notNull(),
    domain: text("domain").notNull(),
    country: country("country").notNull(),
    resultJson: jsonb("result_json").$type<Record<string, unknown>>().notNull(),
    // SHA-256 of the requester's IP; never the IP itself.
    ipHash: text("ip_hash"),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("public_snapshots_cache_key_idx").on(t.cacheKey, t.createdAt)],
);

// Running total of third-party API spend per day, in millionths of a US
// dollar (DataForSEO bills in fractions of a cent). Enforces daily caps.
export const apiSpendDaily = pgTable(
  "api_spend_daily",
  {
    day: date("day").notNull(),
    provider: text("provider").$type<"dataforseo" | "gemini">().notNull(),
    micros: bigint("micros", { mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.provider] })],
);

// --- Tenant: the assessment attached to an organization at sign-up ----------------

export const orgAssessments = pgTable(
  "org_assessments",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    resultJson: jsonb("result_json").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("org_assessments_org_id_idx").on(t.orgId, t.createdAt)],
);

// --- Tenant: progress tracking (PRD Module 12) ------------------------------------

// Searches whose Google Maps and Google position we check daily. Up to
// TRACKED_SEARCH_LIMIT active per org (enforced in code; costs money).
export const trackedSearches = pgTable(
  "tracked_searches",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    keyword: text("keyword").notNull(),
    country: country("country").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("tracked_searches_org_keyword_idx").on(t.orgId, t.keyword, t.country)],
);

// One row per tracked search per day. Append-only for the app (no UPDATE or
// DELETE grant), so the first row is a tamper-proof "before".
export const rankChecks = pgTable(
  "rank_checks",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    trackedSearchId: uuid("tracked_search_id")
      .notNull()
      .references(() => trackedSearches.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    mapRank: integer("map_rank"),
    organicRank: integer("organic_rank"),
    rating: real("rating"),
    reviews: integer("reviews"),
    leaderAvgRating: real("leader_avg_rating"),
    leaderAvgReviews: integer("leader_avg_reviews"),
    // Google's AI answer: shown for this search? does it cite the site?
    aiOverview: boolean("ai_overview"),
    aiCited: boolean("ai_cited"),
    source: text("source").$type<"assessment" | "daily" | "manual">().notNull(),
    dataSource: text("data_source").$type<"sandbox" | "live">().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("rank_checks_search_day_idx").on(t.trackedSearchId, t.day),
    index("rank_checks_org_day_idx").on(t.orgId, t.day),
  ],
);

// Changes the owner says they made ("I did this"), pinned to the timeline.
export const siteChanges = pgTable(
  "site_changes",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    note: text("note"),
    madeOn: date("made_on").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("site_changes_org_idx").on(t.orgId, t.madeOn)],
);

// --- Global: TorqueRank staff (PRD Module 9) -----------------------------------

// Who may open /admin. The app can only read its own row (RLS); rows are
// added by the database owner, never through the app.
export const platformAdmins = pgTable("platform_admins", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
});

// Every admin action, with a reason. Written only by admin_* database
// functions; the app role has no direct access.
export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: id(),
    adminUserId: uuid("admin_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetOrgId: uuid("target_org_id"),
    reason: text("reason").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("admin_audit_log_created_idx").on(t.createdAt)],
);

// --- Staff: "claim your ranking" campaigns (PRD Module 14) ----------------------

// A campaign = one category in one city. Prospects are the businesses in
// Google Maps for that search. Only platform admins can read these tables
// (RLS); the public claim page goes through claim_* functions by token.
export const campaigns = pgTable("campaigns", {
  id: id(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  city: text("city").notNull(),
  country: country("country").notNull(),
  keyword: text("keyword").notNull(),
  dataSource: text("data_source").$type<"sandbox" | "live">().notNull(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const prospectStatus = pgEnum("prospect_status", ["new", "opened", "claimed"]);

export const prospects = pgTable(
  "prospects",
  {
    id: id(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    businessName: text("business_name").notNull(),
    domain: text("domain").notNull(),
    // Numbers only; never other businesses' names.
    report: jsonb("report").$type<Record<string, unknown>>().notNull(),
    // SHA-256 of the claim link's token. Re-issuing a link replaces it.
    tokenHash: text("token_hash").notNull(),
    status: prospectStatus("status").notNull().default("new"),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimedOrgId: uuid("claimed_org_id").references(() => organizations.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("prospects_token_hash_idx").on(t.tokenHash), index("prospects_campaign_idx").on(t.campaignId)],
);

// Businesses that said "not interested": never added to a campaign again.
// Stores a hash of the domain, not the domain.
export const prospectSuppressions = pgTable("prospect_suppressions", {
  domainHash: text("domain_hash").primaryKey(),
  createdAt: createdAt(),
});

// --- Tenant: action plan (PRD Module 7/12) -------------------------------------

export const actionKind = pgEnum("action_kind", [
  "review_request",
  "review_reply",
  "gbp_profile",
  "gbp_post",
  "page_title",
  "new_page",
]);
export type ActionKind = (typeof actionKind.enumValues)[number];
export const actionStatus = pgEnum("action_status", ["open", "done", "dismissed"]);

// Ready-to-use changes for the owner, ranked by estimated value. "I did
// this" marks it done and logs a site_changes row so its effect is tracked.
export const actionItems = pgTable(
  "action_items",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: actionKind("kind").notNull(),
    title: text("title").notNull(),
    why: text("why").notNull(),
    // Plain text to copy and paste. Rendered as text, never as HTML.
    content: text("content").notNull(),
    keyword: text("keyword"),
    valueUsdMonth: integer("value_usd_month"),
    status: actionStatus("status").notNull().default("open"),
    source: text("source").$type<"ai" | "rules">().notNull(),
    changeId: uuid("change_id").references(() => siteChanges.id, { onDelete: "set null" }),
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("action_items_org_status_idx").on(t.orgId, t.status)],
);

// One row per org per week once the weekly email is sent (prevents doubles).
export const digestSends = pgTable(
  "digest_sends",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    week: date("week").notNull(),
    recipients: integer("recipients").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.week] })],
);

// --- Global: prices shown on the site and used for billing ------------------------

// Exactly one row (id = 1). Public to read; changed only through the
// audited admin_set_pricing function.
export const pricing = pgTable("pricing", {
  id: integer("id").primaryKey().default(1),
  monthlyCents: integer("monthly_cents").notNull(),
  annualCents: integer("annual_cents").notNull(),
  agencyCents: integer("agency_cents").notNull(),
  agencyMinLocations: integer("agency_min_locations").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
});

// Weekly whole-site SEO snapshot (dashboard): estimated traffic, keywords
// by position band, the keyword list (for new/lost), and a site check.
// Append-only for the app, like rank_checks.
export const seoSnapshots = pgTable(
  "seo_snapshots",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    takenOn: date("taken_on").notNull(),
    dataSource: text("data_source").$type<"sandbox" | "live">().notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("seo_snapshots_org_day_idx").on(t.orgId, t.takenOn)],
);

// Stripe webhook events already processed (replays are ignored).
export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  createdAt: createdAt(),
});

// Keyword plan: the searches that matter for this business, grouped into
// topics, each checked against the business's pages, with the change to
// make. Rebuilt on demand; history kept (append-only for the app).
export const keywordPlans = pgTable(
  "keyword_plans",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    builtOn: date("built_on").notNull(),
    dataSource: text("data_source").$type<"sandbox" | "live">().notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("keyword_plans_org_idx").on(t.orgId, t.createdAt)],
);

// --- Agencies and networks (PRD Module 11) ----------------------------------
// One login over many businesses. Each location stays its own organization
// with its own data and RLS; an agency reaches a location only through an
// active agency_locations link, which the location's owner can end at any
// time. All writes go through the agency_* database functions.

export const agencyRole = pgEnum("agency_role", ["owner", "staff"]);
export type AgencyRole = (typeof agencyRole.enumValues)[number];

export const agencies = pgTable("agencies", {
  id: id(),
  name: text("name").notNull(),
  // The agency pays per location; until it does, a 14-day trial covers its locations.
  planStatus: planStatus("plan_status").notNull().default("trialing"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true })
    .notNull()
    .default(sql`now() + interval '14 days'`),
  createdAt: createdAt(),
});

export const agencyMembers = pgTable(
  "agency_members",
  {
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: agencyRole("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.agencyId, t.userId] }), index("agency_members_user_idx").on(t.userId)],
);

export const agencyLocations = pgTable(
  "agency_locations",
  {
    id: id(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // true: the agency set this location up; false: the owner connected an existing account.
    createdByAgency: boolean("created_by_agency").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedBy: text("ended_by").$type<"location" | "agency">(),
  },
  (t) => [
    index("agency_locations_agency_idx").on(t.agencyId),
    // A location belongs to at most one agency at a time.
    uniqueIndex("agency_locations_one_active_idx").on(t.orgId).where(sql`ended_at IS NULL`),
  ],
);

// Codes a location owner gives an agency to connect an existing account.
// Only the SHA-256 hash is stored; the code is shown once to the owner.
export const agencyConnectCodes = pgTable(
  "agency_connect_codes",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("agency_connect_codes_hash_idx").on(t.codeHash), index("agency_connect_codes_org_idx").on(t.orgId)],
);

// --- Google data: Search Console + GA4 (PRD Modules 3-5) --------------------
// One connection per organization. The refresh token is stored only as
// AES-256-GCM ciphertext (src/server/google/tokens.ts); access tokens are
// never stored. Metrics are the org's own, behind row-level security.

export const googleConnectionStatus = pgEnum("google_connection_status", ["active", "needs_reauth", "revoked"]);
export const googlePropertyType = pgEnum("google_property_type", ["gsc", "ga4"]);

export const googleConnections = pgTable(
  "google_connections",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    connectedByUserId: uuid("connected_by_user_id").references(() => users.id, { onDelete: "set null" }),
    grantedScopes: text("granted_scopes").array().notNull(),
    refreshTokenCiphertext: text("refresh_token_ciphertext").notNull(),
    tokenIv: text("token_iv").notNull(),
    tokenAuthTag: text("token_auth_tag").notNull(),
    keyVersion: integer("key_version").notNull(),
    status: googleConnectionStatus("status").notNull().default("active"),
    lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    // Lease so two sync runs never work on the same org at once.
    syncStartedAt: timestamp("sync_started_at", { withTimezone: true }),
    // A short code ("invalid_grant", "quota"), never a token or Google's raw message.
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("google_connections_org_idx").on(t.orgId)],
);

export const linkedProperties = pgTable(
  "linked_properties",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => googleConnections.id, { onDelete: "cascade" }),
    type: googlePropertyType("type").notNull(),
    // GSC: "sc-domain:example.com" or "https://example.com/"; GA4: "properties/123456".
    externalId: text("external_id").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("linked_properties_org_type_idx").on(t.orgId, t.type)],
);

export const gscDaily = pgTable(
  "gsc_daily",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    clicks: integer("clicks").notNull(),
    impressions: integer("impressions").notNull(),
    ctr: real("ctr").notNull(),
    position: real("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.date] })],
);

export const gscQueryDaily = pgTable(
  "gsc_query_daily",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    query: text("query").notNull(),
    clicks: integer("clicks").notNull(),
    impressions: integer("impressions").notNull(),
    position: real("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.date, t.query] })],
);

export const ga4Daily = pgTable(
  "ga4_daily",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    // GA4's default channel group: "Organic Search", "Direct", "Paid Search", ...
    channel: text("channel").notNull(),
    sessions: integer("sessions").notNull(),
    users: integer("users").notNull(),
    keyEvents: real("key_events").notNull(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.date, t.channel] })],
);

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    source: googlePropertyType("source").notNull(),
    status: text("status").$type<"ok" | "error">().notNull(),
    rowsUpserted: integer("rows_upserted").notNull().default(0),
    errorCode: text("error_code"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sync_runs_org_idx").on(t.orgId, t.startedAt)],
);
