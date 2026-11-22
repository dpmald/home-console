# Stable kitchen entry to Beta

On the Cozyla, open the [family kitchen](https://home-console-pied.vercel.app/) and
tap **Beta** in the bottom dock. This production hostname links to the
[shared Beta](https://home-console-beta.vercel.app/beta) by default. Public Beta viewing opens directly. Grocery entry uses the separate Beta device key once per browser. Inside Beta, tap **Back to kitchen** to return.

A valid public HTTPS URL in `HOME_CONSOLE_BETA_URL` overrides the default.
Set the value to `off` to hide the link. Other hosted kitchens show the link
only when explicitly configured. The link opens the top window in the same tab
(`target="_top"`), so local preview wrappers do not nest when entering Beta and
returning to the kitchen. It does not prefetch the beta app or forward a device
key or referrer. An invalid override hides the link. No experimental components, API routes,
database migrations or dependencies are added to the stable kitchen by this
launcher change.

In explicitly isolated local development (`HOME_CONSOLE_LOCAL_DEVELOPMENT=1`,
with `NODE_ENV` other than production), the default destination is
`http://localhost:3005/beta`. Loopback HTTP overrides are permitted only in that
local mode. Production never uses this local fallback, even if the local flag
was mistakenly retained. URLs with credentials, queries or fragments are rejected.

The beta deployment owns its separate device authentication, data connection,
features and return link. Provision its device login independently; never put
the stable kiosk key in the Beta URL. Configure the beta build's return target
to the normal kitchen's public address. This launcher alone does not create,
deploy or authenticate the beta app.

For shared Instacart requests, tap **Shared grocery list** in **Dinner Hub** or
**Chores & Schedule**. This opens the grocery screen on the configured Beta
host. The family kitchen's **Kitchen-only pantry list** shows its previously saved
items. New shared requests use the hosted form. Both entry points use the same device-authorized requests and cart receipts. Enabling public viewing leaves grocery changes restricted. Family production voice can forward newly spoken requests to the same fixed Beta endpoint when the stable server has `HOME_CONSOLE_SHARED_GROCERY_DEVICE_KEY` set to the Beta device key. Without it, voice points to the shared form.

Check the destination rules with:

```sh
node --test tests/beta-navigation.test.mjs
```
