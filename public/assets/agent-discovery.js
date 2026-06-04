(function () {
  const site = "https://account.js.gripe";
  const api = "https://gateway.js.gripe/api/v1/myaccount";

  const discoveryResources = [
    `${site}/robots.txt`,
    `${site}/llms.txt`,
    `${site}/sitemap.xml`,
    `${site}/auth.md`,
    `${site}/.well-known/api-catalog`,
    `${site}/.well-known/oauth-protected-resource`,
    `${site}/.well-known/oauth-authorization-server`,
    `${site}/.well-known/openid-configuration`,
    `${site}/.well-known/mcp/server-card.json`,
    `${site}/.well-known/agent-skills/index.json`
  ];

  const tools = [
    {
      name: "list_discovery_resources",
      description: "List public discovery resources for Account.js.gripe. This does not access protected account data.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false
      },
      execute: async () => ({
        site,
        crawlingPolicy: "not suitable for robot crawling, AI training, search indexing, or account-data extraction",
        resources: discoveryResources
      })
    },
    {
      name: "describe_account_api",
      description: "Describe Account.js.gripe API discovery and authentication requirements.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false
      },
      execute: async () => ({
        site,
        api,
        protected: true,
        documentation: `${site}/auth.md`,
        openapi: `${site}/openapi.json`,
        oauthProtectedResource: `${site}/.well-known/oauth-protected-resource`,
        authorizationServer: `${site}/.well-known/oauth-authorization-server`,
        note: "Agents must not crawl account pages or use account data as AI input without explicit authorization."
      })
    }
  ];

  const context = {
    name: "Account.js.gripe Discovery",
    description: "Read-only discovery context for the protected Account.js.gripe account service.",
    tools
  };

  try {
    if (navigator.modelContext?.provideContext) {
      navigator.modelContext.provideContext(context);
    }
    if (document.modelContext?.registerTool) {
      for (const tool of tools) {
        document.modelContext.registerTool(tool);
      }
    }
    window.accountAgentDiscovery = context;
  } catch (error) {
    window.accountAgentDiscoveryError = String(error?.message || error);
  }
})();
