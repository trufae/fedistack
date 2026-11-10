declare const FEDISTACK_CONFIG: unknown;

namespace Fedi {
  function readLoginConfig(): { defaultServer: string; allowOtherServers: boolean; error: string } {
    try {
      const config = typeof FEDISTACK_CONFIG === "undefined" ? null : FEDISTACK_CONFIG;
      if (!config || typeof config !== "object") throw new Error();
      const { defaultServer = "", allowOtherServers = true } = config as Record<string, unknown>;
      if (typeof defaultServer !== "string" || typeof allowOtherServers !== "boolean") throw new Error();
      const server = defaultServer.trim() ? serverURL(defaultServer) : "";
      if (!allowOtherServers && !server) throw new Error();
      return { defaultServer: server, allowOtherServers, error: "" };
    } catch {
      return {
        defaultServer: "", allowOtherServers: false,
        error: "Sign-in is unavailable because this site's configuration could not be loaded or is invalid. Please contact the site administrator.",
      };
    }
  }

  export const loginConfig = Object.freeze(readLoginConfig());

  export function loginServer(input: string): string {
    if (loginConfig.error) throw new Error(loginConfig.error);
    const server = serverURL(input.trim() || loginConfig.defaultServer);
    if (!loginConfig.allowOtherServers && server !== loginConfig.defaultServer)
      throw new Error(`This site only supports signing in to ${new URL(loginConfig.defaultServer).host}.`);
    return server;
  }
}
