import { sql } from "drizzle-orm";
import {
  bigint,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
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
  planStatus: planStatus("plan_status").notNull().default("trialing"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true })
    .notNull()
    .default(sql`now() + interval '7 days'`),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  deleteAfter: timestamp("delete_after", { withTimezone: true }),
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
export const assessmentDrafts = pgTable(
  "assessment_drafts",
  {
    tokenHash: text("token_hash").primaryKey(),
    answers: jsonb("answers").$type<Record<string, string>>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("assessment_drafts_expires_at_idx").on(t.expiresAt)],
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
