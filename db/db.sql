-- This file contains the commands to create a database from scratch
CREATE TABLE `jobs` (
  `id` integer not null primary key autoincrement,
  `requestId` char(36) not null,
  `username` varchar(255) not null,
  `status` text check (`status` in ('accepted', 'running', 'successful', 'failed', 'canceled')) not null,
  `message` varchar(255) not null,
  `progress` integer not null,
  `_json_links` json not null,
  `createdAt` datetime not null,
  `updatedAt` datetime not null,
  `request` varchar(4096) not null default 'unknown');
