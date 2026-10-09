# Alink teammate brief

Alink enrolls a session-owned demo voice with audio, extracted text, and speaker embeddings. Verification requires both similarity to the stored natural speaker reference and equality of the normalized baseline transcript. It reports success, failure or unavailable with separate evidence.

React/TypeScript provides Overview, Voice profile, Action approvals and Activity trail. The Python service uses SpeechBrain for embeddings and Vosk for local English transcription. MongoDB is optional; local storage is clearly labeled. Optional ElevenLabs transcription supports reviewed refund requests. Semgrep is a development/CI fixture check only.

Passkeys protect enrollment and exact-action mock refund approval. No real transactions occur. The Permission Doctor and bank voice-agent flows are removed; stored recordings and enrollment data are retained. Older samples without text must be re-enrolled.

Evaluate consenting genuine/impostor recordings, short/different phrases and recording-quality changes. No illness robustness, liveness/deepfake detection or bank-grade authentication is claimed.
