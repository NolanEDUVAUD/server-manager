import type { Dict } from "..";

export const retention: Dict["retention"] = {
  title: "History",
  intro:
    "Pings, service checks, resource readings and events are stored in a local database. They survive application restarts and contain no password or token.",
  database: "History database",
  refreshLabel: "Refresh database status",
  reading: "Reading database…",
  readError: "Unable to read the database status: {message}",
  size: "Size",
  inMemory: "in memory",
  events: "Events",
  rawSamples: "Detailed samples",
  hourlyRows: "Hourly aggregates",
  since: "Since",
  noData: "no data yet",
  fields: {
    raw: { label: "Detailed samples (days)", help: "Every ping, service check and CPU / RAM reading" },
    hourly: { label: "Hourly aggregates (days)", help: "Availability, latency and resources summarized hour by hour" },
    events: { label: "Events (days)", help: "Outages, back online, shutdowns, failures…" },
  },
  errors: {
    raw: "Detailed samples: between 1 and 31 days",
    hourly: "Hourly aggregates: between 7 and 730 days",
    hourlyShorter: "Hourly aggregates must be kept at least as long as detailed samples",
    events: "Events: between 7 and 3,650 days",
  },
  saved: "Retention saved: it applies at the next cleanup (every hour)",
  pruned: "Cleanup done: {raw} sample(s), {hourly} aggregate(s), {events} event(s) deleted",
  applyNow: "Apply now",
  saveFirst: "Save the new retention first",
  confirmTitle: "Apply retention now",
  confirmMessage:
    "The following will be permanently deleted: detailed samples older than {raw} day(s), hourly aggregates older than {hourly} days and events older than {events} days. Continue?",
};
