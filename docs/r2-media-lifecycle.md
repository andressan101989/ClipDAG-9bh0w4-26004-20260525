# R2 media lifecycle

New public images use Cloudflare R2 and are tracked by `media_assets` plus
`media_asset_links`. Public URLs are persisted by the finalize function and are
the only URLs accepted by the atomic post, story, product, and avatar RPCs.

Photo and video stories created by the current app use the R2 media lifecycle.
The canonical Story RPC atomically links each READY asset, and regular cleanup
deletes the Story and schedules its R2 object after expiry. Historical legacy
video objects in Supabase Storage remain untouched because old Story rows do not
store an authoritative bucket/object identity; cleanup must never guess an
object key from a public URL.

Cloudflare Stream is intentionally not started by this foundation.
