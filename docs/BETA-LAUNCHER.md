# Stable kitchen entry to Beta

The stable kitchen renders a Beta link only when `HOME_CONSOLE_BETA_URL` contains
a valid public HTTPS destination. The link opens in the same tab, does not
prefetch the beta app, and does not forward a device key or referrer. An absent
or invalid destination hides the link. No experimental components, API routes,
database migrations or dependencies are added to the stable kitchen by this
launcher change.

In explicitly isolated local development (`HOME_CONSOLE_LOCAL_DEVELOPMENT=1`,
with `NODE_ENV` other than production), the default destination is
`http://localhost:3004/beta`. Loopback HTTP overrides are permitted only in that
local mode. Production never uses this local fallback, even if the local flag
was mistakenly retained. URLs with credentials, queries or fragments are rejected.

The beta deployment owns its separate device authentication, data connection,
features and return link. Provision its device login independently; never put
the stable kiosk key in the Beta URL. Configure the beta build's return target
to the normal kitchen's public address. This launcher alone does not create,
deploy or authenticate the beta app.

Check the destination rules with:

```sh
node --test tests/beta-navigation.test.mjs
```
