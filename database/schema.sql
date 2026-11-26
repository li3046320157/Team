-- 应用自持账户、会话、审计与使用统计。账本明细不进入云端。
-- function_backend 数据库：迁移中不写入业务数据，管理员账户通过受控插入创建。

CREATE TABLE app.users (
  id uuid PRIMARY KEY,
  username text NOT NULL,
  username_lower text NOT NULL UNIQUE,
  phone text UNIQUE,
  role text NOT NULL,
  status text NOT NULL,
  must_change_password boolean NOT NULL,
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  password_iterations integer NOT NULL,
  recovery_question text,
  recovery_answer_salt text,
  recovery_answer_hash text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  last_login_at timestamptz,
  last_active_at timestamptz,
  login_count integer NOT NULL
);

CREATE TABLE app.sessions (
  token_digest text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app.users (id),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE TABLE app.auth_limiter (
  key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  attempt_count integer NOT NULL
);

CREATE TABLE app.auth_events (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app.users (id),
  actor_id uuid,
  kind text NOT NULL,
  at timestamptz NOT NULL,
  user_agent text
);

CREATE TABLE app.usage_daily (
  user_id uuid NOT NULL REFERENCES app.users (id),
  day text NOT NULL,
  views integer NOT NULL,
  last_seen_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, day)
);

CREATE INDEX users_role_created_idx ON app.users (role, created_at);
CREATE INDEX users_status_idx ON app.users (status);
CREATE INDEX sessions_user_idx ON app.sessions (user_id, expires_at);
CREATE INDEX auth_events_user_at_idx ON app.auth_events (user_id, at);
CREATE INDEX auth_events_kind_at_idx ON app.auth_events (kind, at);
CREATE INDEX usage_daily_day_idx ON app.usage_daily (day);