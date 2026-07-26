# R2 media lifecycle

New public images use Cloudflare R2 and are tracked by `media_assets` plus
`media_asset_links`. Public URLs are persisted by the finalize function and are
the only URLs accepted by the atomic post, story, product, and avatar RPCs.

Photo stories are deleted through the regular media cleanup lifecycle after
they expire. Video stories remain on the legacy Supabase Storage path until the
Cloudflare Stream phase. Their database rows and views expire normally, but
safe deletion of the legacy video object remains pending because the current
story row does not store an authoritative bucket/object identity. The cleanup
must not guess an object key from a public URL.

Cloudflare Stream is intentionally not started by this foundation.
