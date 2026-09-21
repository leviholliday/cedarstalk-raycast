/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** cedarengine URL - Where cedarengine is listening. Leave blank to disable the schedule fallback entirely. */
  "engineUrl": string,
  /** cedarengine Token - The BEARER_TOKEN from cedarengine's .env. Every route but /health requires it. */
  "engineToken"?: string,
  /** Your Directory Id - Your own id, for My Day, Course Fit and Textbooks. Find it in Search Cedarville Directory: open yourself and use Copy ID. */
  "myPersonId": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `search-directory` command */
  export type SearchDirectory = ExtensionPreferences & {
  /** Demo Mode - Redact personal information for screenshots and demos */
  "demoMode": boolean
}
  /** Preferences accessible in the `quiet-rooms` command */
  export type QuietRooms = ExtensionPreferences & {
  /** Start From - Building to measure walking distance from. A partial name is fine -- "McChesney" matches "McChesney Hall". Leave blank to rank by quiet alone. */
  "homeBuilding": string
}
  /** Preferences accessible in the `registration` command */
  export type Registration = ExtensionPreferences & {}
  /** Preferences accessible in the `class-roster` command */
  export type ClassRoster = ExtensionPreferences & {}
  /** Preferences accessible in the `campus-now` command */
  export type CampusNow = ExtensionPreferences & {}
  /** Preferences accessible in the `my-day` command */
  export type MyDay = ExtensionPreferences & {}
  /** Preferences accessible in the `course-fit` command */
  export type CourseFit = ExtensionPreferences & {}
  /** Preferences accessible in the `free-together` command */
  export type FreeTogether = ExtensionPreferences & {}
  /** Preferences accessible in the `textbooks` command */
  export type Textbooks = ExtensionPreferences & {}
  /** Preferences accessible in the `faculty` command */
  export type Faculty = ExtensionPreferences & {}
  /** Preferences accessible in the `dorms` command */
  export type Dorms = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `search-directory` command */
  export type SearchDirectory = {}
  /** Arguments passed to the `quiet-rooms` command */
  export type QuietRooms = {}
  /** Arguments passed to the `registration` command */
  export type Registration = {}
  /** Arguments passed to the `class-roster` command */
  export type ClassRoster = {}
  /** Arguments passed to the `campus-now` command */
  export type CampusNow = {}
  /** Arguments passed to the `my-day` command */
  export type MyDay = {}
  /** Arguments passed to the `course-fit` command */
  export type CourseFit = {}
  /** Arguments passed to the `free-together` command */
  export type FreeTogether = {}
  /** Arguments passed to the `textbooks` command */
  export type Textbooks = {}
  /** Arguments passed to the `faculty` command */
  export type Faculty = {}
  /** Arguments passed to the `dorms` command */
  export type Dorms = {}
}

