ALTER TABLE `accounts` ADD `auth_version` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE `account_audit` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `action` text NOT NULL,
  `actor` text NOT NULL,
  `source` text NOT NULL,
  `account_id` text NOT NULL REFERENCES `accounts`(`id`),
  `recorded_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER `account_audit_no_update` BEFORE UPDATE ON `account_audit`
BEGIN SELECT RAISE(ABORT, 'account-audit-append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `account_audit_no_delete` BEFORE DELETE ON `account_audit`
BEGIN SELECT RAISE(ABORT, 'account-audit-append-only'); END;
