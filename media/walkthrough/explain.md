# Explain in plain language

Hover a card and click **✦ Explain** for a short plain-language summary. To
understand how you got somewhere, right-click a card and choose **Explain path
from start to here**.

- Uses GitHub Copilot through VS Code's language model API. The free plan
  works.
- Prophasis asks before sending any code and says how much it will send.
- Only the chosen code is sent, at most 12,000 characters by default
  (`prophasis.explain.maxCharacters`).
- Nothing is stored on disk. Explain is off in untrusted workspaces.
- Explanations can be wrong: they are based only on the code that was sent.
