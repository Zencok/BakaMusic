# Plugin storage design

Each stable host ID hashes to a separate SQLite database under a host-selected
application-support directory. Script keys never become paths. SQL parameters
bind keys/values; immediate transactions serialize quota checks and writes.
Acknowledged writes survive host recreation. I/O runs on blocking workers rather
than the JavaScript executor. Quota failures roll back the transaction.

The trusted application supplies the root; untrusted plugins receive only string
operations, not filesystem access. Values are local app data, not encrypted secrets
or server-synchronized user state. Runtime without configured storage rejects calls.
Tests cover persistence, separate users/hosts, deletion and oversize rejection.

Production host identity must equal the validated package manifest ID. Storage
binding is deferred until validation succeeds, including when the application
configures its root before loading. Disposable inspection never binds storage.
