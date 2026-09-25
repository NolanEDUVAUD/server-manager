import type { Dict } from "..";

export const format: Dict["format"] = {
  mb: "{value} MB",
  gb: "{value} GB",
  tb: "{value} TB",
  days: "{days} d {hours} h",
  hours: "{hours} h {minutes} min",
  minutes: "{minutes} min",
};
