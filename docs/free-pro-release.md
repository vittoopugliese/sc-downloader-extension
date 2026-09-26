# Free Pro release

`scripts/release-config.js` contains the single public switch:

```js
const FREE_PRO_ENABLED = true;
```

With this enabled, new and existing installations receive every Player Tools
and Likes Explorer capability without starting a trial, consuming loops, buying
a license, or contacting the commerce service. Access has no expiration. Existing
license/trial records are preserved and do not restrict access in this mode.
The commerce service adapter disables checkout and clears its renewal alarm.

The popup keeps its commercial markup and handlers, but hides the offer banners,
Pro purchase button, and commerce dialog. Turning the switch off restores the
existing licensing flow; it does not create paid licenses or reset old trials.

Download eligibility is independent and unchanged. Keep the server's
`all_downloads_activated` value at `0` for restricted downloads. Existing cached
unrestricted responses still follow the cache rules in `download-policy.md`.
This switch does not enable unrestricted downloads.

Verify with `node scripts/verify-free-pro.js`, `npm run test:player-tools`, and
`node scripts/verify-free-pro-browser.js [unpacked-extension-directory]`.
Package with the production API URL for download policy. The packager still
accepts the existing production public JWK; free Pro does not require a signing
service or an approved Lemon Squeezy store.
