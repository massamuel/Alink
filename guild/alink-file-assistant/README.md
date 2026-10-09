# Alink Guild agent

Published as `spop234~alink-file-assistant`. This agent previews a simulated file after Alink supplies a verification result. It has no external tools and never receives biometric recordings, embeddings, or baseline phrases.

Input: `user_name`, `request_text`, and `verification_status` (`pending`, `verified`, or `failed`). Only the Alink backend should supply the verification status. Alink transcribes the request locally and holds it server-side for five minutes. The agent verification endpoint checks the selected baseline speaker embedding and full phrase before calling Guild. Only the request text and user name are sent; verification status is supplied by the backend. The UI displays the simulated file and Guild response on success.

The deployable Guild Git checkout is at `/Users/sampoplack/Documents/CODING_agent_projects/Alink-guild-agent`. Edit `agent.ts` there, commit, then run `guild agent save --message "v1" --publish`. This directory keeps a reviewable source copy; do not add the nested Guild Git repository to Alink.
