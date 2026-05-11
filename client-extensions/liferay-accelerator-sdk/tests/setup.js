import { vi } from "vitest";

vi.mock("@rotty3000/config-node", () => {
  return {
    lxcConfig: {
      oauthApplication: vi.fn().mockReturnValue({}),
      userAgentApplication: vi.fn().mockReturnValue({}),
    },
    lookupConfig: vi.fn().mockReturnValue(null),
  };
});
