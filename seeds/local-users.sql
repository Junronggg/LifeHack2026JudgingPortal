-- Local preview accounts only. Never use these credentials for the live event.
INSERT INTO users (id, name, email, password_hash, password_salt, password_iterations, role, judge_type, company_category_id, active) VALUES
('j-green', 'Maya Chen', 'company@lifehack.test', '1qf1mPrdK2dqJvfjLEaVvsA29i3J4MyOLgfB9Trb3jY=', 'VwI/1HstvuBlAUX8nS4+/A==', 210000, 'judge', 'company', 'sustainability', 1),
('j-general', 'Prof. Alex Tan', 'judge@lifehack.test', 'NRYzGpqsj4RbP8zTT5U3jw+IWi7cQIM7vQqWfllskUI=', 'h2mz+Q0+weE4FjLga2rGsw==', 210000, 'judge', 'general', NULL, 1),
('j-general-2', 'Dr. Sam Lee', 'sam@lifehack.test', 'Sh8+Qp9uj2B3LXuFhc+rGhDIpwmcJsItBoMu16Nwdqw=', 'TFkbI/y7mzRaLFGOYZf+Dg==', 210000, 'judge', 'general', NULL, 1),
('admin', 'Event Operations', 'admin@lifehack.test', 'nXpw0GFAcayeNv9glIH72UWJQdWxFAy0kruJg0hl2fI=', '9k9ODZV8X/BzgpBcfPJC+w==', 210000, 'admin', NULL, NULL, 1)
ON CONFLICT(id) DO UPDATE SET
  name=excluded.name,
  email=excluded.email,
  password_hash=excluded.password_hash,
  password_salt=excluded.password_salt,
  password_iterations=excluded.password_iterations,
  role=excluded.role,
  judge_type=excluded.judge_type,
  company_category_id=excluded.company_category_id,
  active=excluded.active;
