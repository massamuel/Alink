# Alink teammate brief

Alink checks an enrolled speaker profile, provides passkey fallback when voice is uncertain, and limits what an agent can execute. Voice consistency, authenticated approval, and least privilege are different checks.

## Use case

A customer requests a mock retail refund. If their voice changes, registered-device verification preserves access. A recording or cloned voice cannot alone approve a refund. Each approval covers one amount, currency, order, destination, policy version, and expiration. Changes or reuse fail closed.

## Enrollment experiment

The phrase is “The rain in Spain falls mainly on the plain.” Capture natural voice (ideally twice), comfortable higher/lower pitch, and optional singing. Store clips separately. Test actual healthy/sick recordings when available; simulated roughness does not demonstrate illness tolerance. Matching currently uses natural references conservatively while reporting other styles separately.

## Sponsor roles

MongoDB persists profiles, binary audio, and action state. ElevenLabs transcribes explicit voice requests. Semgrep discovers two unsafe patterns in instructional connector code. All three have working adapters, but service setup is required before claiming live sponsor usage.

## Doctor workflow

Inspect sample policy → identify broad refund permissions → replay attacks and legitimate requests → review restrictions → passkey-approve repair → enforce and audit. Source patching is manual; a repaired fixture is supplied. Rollback invalidates approvals.

## Review questions

- Should voice consistency or agent authorization lead the pitch?
- Which genuine/impostor recordings can we collect with consent?
- Can we enable all sponsor services and speaker inference before demo time?
- Is the experimental threshold defensible from our small test set?
- Should the next integration be a phone agent or a real retail connector?

## Not claimed

Illness robustness, deepfake/liveness detection, bank-grade identity proofing, a real payment integration, or automatic source-code remediation.
