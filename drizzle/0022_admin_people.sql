-- Everyone who has signed up, including people with no business or agency
-- yet, and every agency. Admins only; no Google data, no session tokens.
-- "Last active" comes from the session expiry (sessions last 30 days and are
-- refreshed at most daily), so it's accurate to about a day.
CREATE FUNCTION admin_people(p_limit int)
  RETURNS TABLE (id uuid, email text, name text, created_at timestamptz, last_active timestamptz,
                 is_admin boolean, businesses jsonb, agencies jsonb)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
BEGIN
  IF NOT app_is_platform_admin() THEN RAISE EXCEPTION 'not a platform admin' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT u.id, u.email, u.name, u.created_at,
      (SELECT max(s.expires) - interval '30 days' FROM sessions s WHERE s.user_id = u.id),
      EXISTS (SELECT 1 FROM platform_admins p WHERE p.user_id = u.id),
      (SELECT coalesce(jsonb_agg(jsonb_build_object('name', o.name, 'role', m.role) ORDER BY m.created_at), '[]'::jsonb)
         FROM memberships m JOIN organizations o ON o.id = m.org_id WHERE m.user_id = u.id),
      (SELECT coalesce(jsonb_agg(jsonb_build_object('name', a.name, 'role', am.role) ORDER BY a.created_at), '[]'::jsonb)
         FROM agency_members am JOIN agencies a ON a.id = am.agency_id WHERE am.user_id = u.id)
    FROM users u
    ORDER BY u.created_at DESC
    LIMIT least(greatest(p_limit, 1), 1000);
END $$;
--> statement-breakpoint
CREATE FUNCTION admin_agencies(p_limit int)
  RETURNS TABLE (id uuid, name text, plan_status text, trial_ends_at timestamptz, created_at timestamptz,
                 owner_email text, members int, locations int)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
BEGIN
  IF NOT app_is_platform_admin() THEN RAISE EXCEPTION 'not a platform admin' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT a.id, a.name, a.plan_status::text, a.trial_ends_at, a.created_at,
      (SELECT u.email FROM agency_members am JOIN users u ON u.id = am.user_id
        WHERE am.agency_id = a.id AND am.role = 'owner' ORDER BY am.created_at LIMIT 1),
      (SELECT count(*)::int FROM agency_members am WHERE am.agency_id = a.id),
      (SELECT count(*)::int FROM agency_locations l WHERE l.agency_id = a.id AND l.ended_at IS NULL)
    FROM agencies a
    ORDER BY a.created_at DESC
    LIMIT least(greatest(p_limit, 1), 500);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin_people(int), admin_agencies(int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION admin_people(int), admin_agencies(int) TO app_user;
