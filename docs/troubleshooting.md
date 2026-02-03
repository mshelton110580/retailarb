# Troubleshooting

## npm install returns 403 for @prisma/client

If `npm install` fails with:

```
npm error 403 403 Forbidden - GET https://registry.npmjs.org/@prisma%2fclient
npm error 403 In most cases, you or one of your dependencies are requesting
npm error 403 a package version that is forbidden by your security policy, or
npm error 403 on a server you do not have access to.
```

Then the environment running npm does not have access to the public npm registry (or is
behind a proxy/security policy that blocks scoped packages).

**Fixes:**

1. Ensure the host can reach the public npm registry:
   ```bash
   npm config set registry https://registry.npmjs.org/
   npm config get registry
   ```
2. If your environment requires an authenticated proxy or private registry mirror, set the
   correct auth token and proxy variables (for example, `NPM_TOKEN`, `HTTP_PROXY`, or your
   organization’s npm registry URL).
3. If a CI security policy blocks the registry, allowlist `registry.npmjs.org` and scoped
   packages such as `@prisma/client`.

Once registry access is restored, rerun `npm install`, then `npm run build` or `docker compose up --build`.
