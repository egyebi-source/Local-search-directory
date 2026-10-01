-- Tenant isolation (PRD §8.3).
--
-- The runtime role app_user does not own these tables and has no BYPASSRLS.
-- The app sets two transaction-local settings before touching tenant data:
--   app.user_id  - the signed-in user (from the session)
--   app.org_id   - the organization, set only after membership is verified
-- With neither set, tenant tables return nothing.
--
-- Rule: every table with an org_id column must appear in this file (or a
-- later migration) with ENABLE + FORCE ROW LEVEL SECURITY and a policy.
-- tests/db/schema-guard.test.ts fails the build otherwise.

CREATE FUNCTION app_current_org_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.org_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION app_current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint

-- organizations: visible when it is the current org, or one the current
-- user belongs to (for the organization switcher).
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organizations_select ON organizations FOR SELECT
  USING (
    id = app_current_org_id()
    OR id IN (SELECT m.org_id FROM memberships m WHERE m.user_id = app_current_user_id())
  );
--> statement-breakpoint
CREATE POLICY organizations_write ON organizations FOR ALL
  USING (id = app_current_org_id())
  WITH CHECK (id = app_current_org_id());
--> statement-breakpoint

-- memberships: a user may read their own memberships across orgs (to know
-- which orgs they can open); everything else is scoped to the current org.
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY memberships_select ON memberships FOR SELECT
  USING (org_id = app_current_org_id() OR user_id = app_current_user_id());
--> statement-breakpoint
CREATE POLICY memberships_write ON memberships FOR ALL
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());
--> statement-breakpoint

ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invites FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY invites_tenant ON invites FOR ALL
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());
--> statement-breakpoint

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_log_tenant ON audit_log FOR ALL
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());
--> statement-breakpoint

-- Accepting an invite happens before the user is a member, so it cannot go
-- through the normal org-scoped path. This narrow function runs with the
-- owner's rights, checks everything itself, and does exactly one thing.
CREATE FUNCTION accept_invite(p_token_hash text, p_user_id uuid, p_user_email text)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
DECLARE
  inv invites%ROWTYPE;
BEGIN
  SELECT * INTO inv FROM invites WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND
     OR inv.accepted_at IS NOT NULL
     OR inv.revoked_at IS NOT NULL
     OR inv.expires_at <= now()
     OR lower(inv.email) <> lower(p_user_email) THEN
    RETURN NULL;
  END IF;

  INSERT INTO memberships (org_id, user_id, role)
    VALUES (inv.org_id, p_user_id, inv.role)
    ON CONFLICT (org_id, user_id) DO NOTHING;

  UPDATE invites SET accepted_at = now() WHERE id = inv.id;

  INSERT INTO audit_log (id, org_id, actor_user_id, action, metadata_json)
    VALUES (gen_random_uuid(), inv.org_id, p_user_id, 'invite.accepted',
            jsonb_build_object('invite_id', inv.id, 'role', inv.role));

  RETURN inv.org_id;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION accept_invite(text, uuid, text) FROM PUBLIC;
--> statement-breakpoint

-- Lets the invite page show "You've been invited to <org>" before the user
-- is a member. Returns only the org name, and only for a usable invite.
CREATE FUNCTION invite_org_name(p_token_hash text)
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT o.name FROM invites i JOIN organizations o ON o.id = i.org_id
    WHERE i.token_hash = p_token_hash
      AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION invite_org_name(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION invite_org_name(text) TO app_user;
--> statement-breakpoint

-- Grants for the runtime role. Nothing is granted by default.
GRANT EXECUTE ON FUNCTION app_current_org_id() TO app_user;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_current_user_id() TO app_user;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION accept_invite(text, uuid, text) TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON users, accounts, sessions, verification_tokens, rate_limits TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON organizations, memberships, invites TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON audit_log TO app_user;
