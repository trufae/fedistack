declare var FEDISTACK_CONFIG: { defaultServer?: string; allowOtherServers?: boolean; sharePreviews?: boolean } | undefined;

namespace Fedi {
  export const loginConfig = { defaultServer: "", allowOtherServers: true, ...globalThis.FEDISTACK_CONFIG };

  export function loginServer(input: string): string {
    const server = serverURL(input.trim() || loginConfig.defaultServer);
    if (!loginConfig.allowOtherServers && server !== serverURL(loginConfig.defaultServer))
      throw new Error(`This site only supports signing in to ${loginConfig.defaultServer}.`);
    return server;
  }
}
