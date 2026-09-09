# R2 media lifecycle

New public images use Cloudflare R2 and are tracked by `media_assets` plus
`media_asset_links`. Public URLs are persisted by the finalize function for
public post, product, and avatar contracts.

Photo and video stories created by the current app use the R2 media lifecycle.
Their canonical purposes are `story_image` and `story_video`, both private.
The canonical Story RPC stores no URL, atomically links one READY asset at
`story/media/0`, and playback obtains an up-to-five-minute signed URL only after the
authenticated Stories RLS authority confirms that the linked Story is active
and visible. `stories.media_url` remains a legacy public-photo fallback only.

Regular cleanup deletes expired Story links and rows, then schedules the now
unlinked private R2 asset through the existing deletion lifecycle.
Manual owner deletion uses `delete_story(uuid)`: it atomically locks the owned
Story and its canonical media, removes only the Story link and row, relies on
the existing `story_views` cascade, and delegates the unlinked asset to
`schedule_media_asset_deletion`. Physical R2 deletion remains exclusively in
the generic delete/cleanup functions. Legacy Stories without a canonical link
are removed without guessing an object key from `stories.media_url`.
Historical legacy video objects in Supabase Storage remain untouched because old Story
rows do not store an authoritative bucket/object identity; cleanup must never
guess an object key from a public URL.

Cloudflare Stream is intentionally not started by this foundation.
