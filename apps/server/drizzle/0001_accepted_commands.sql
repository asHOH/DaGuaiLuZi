CREATE TABLE `accepted_commands` (
	`command_id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`room_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`acknowledgement` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
