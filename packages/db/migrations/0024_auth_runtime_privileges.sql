-- Authentication resolves identity before tenant context is available. These
-- tables intentionally do not use tenant RLS (see 0002). Grant only the CRUD
-- operations used by Better Auth, independent of which authorized migrator
-- owns the tables. Default privileges for axiom_migrator do not cover tables
-- created by the bootstrap/CI axiom role.
GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE auth_user, auth_session, auth_account, auth_verification
TO axiom_app;
