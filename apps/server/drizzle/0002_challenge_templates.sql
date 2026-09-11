CREATE TABLE `challenge_templates` (
	`code` text PRIMARY KEY NOT NULL,
	`source_room_id` text NOT NULL,
	`source_hand_start_sequence` integer NOT NULL,
	`template_schema_version` integer NOT NULL,
	`template` text NOT NULL,
	CONSTRAINT `challenge_templates_source_room_id_source_hand_start_sequence_unique` UNIQUE(`source_room_id`,`source_hand_start_sequence`),
	FOREIGN KEY (`source_room_id`,`source_hand_start_sequence`) REFERENCES `room_events`(`room_id`,`sequence`) ON UPDATE no action ON DELETE no action
);
