# Coffee identity preview

Synthetic-data preview for US team 2950, workspace `v47-clone-e67920`.

Source: [Coffee implementation branch](https://github.com/duet-labs/decagon-coffee/tree/feature/email-identity-preview).

This site uses the separate `coffee-identity-preview` Supabase function and private preview tables. Only generated `coffee-preview-…@example.invalid` addresses can register. It does not migrate existing customers or change production traffic. The barista page shows the test queue.
