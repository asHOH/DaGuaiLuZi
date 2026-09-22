CREATE TABLE `room_controls` (
  `room_id` text PRIMARY KEY NOT NULL,
  `schema_version` integer NOT NULL,
  `payload` text NOT NULL
);
