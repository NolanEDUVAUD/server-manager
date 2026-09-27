import "@testing-library/jest-dom/vitest";
import { EULA_VERSION } from "../legal/eula";

// Accept EULA by default for tests so the modal doesn't block test execution
if (typeof localStorage !== 'undefined') {
  try {
    localStorage.setItem("eula.accepted.version", EULA_VERSION);
  } catch {
    // localStorage might not be available in all test environments
  }
}
