# Read the graph

- **Numbered arrows** follow the order calls are written in the code. A call
  inside an `if` may never run, so this is not always the run order.
- **An arrow without a number** came from "Called by": the caller's other
  calls aren't loaded.
- **Dashed arrows** are uses and type relations (`extends`, `implements`).
- **↻ recursive** means the function calls itself, directly or through others.
- **+N more** cards hold what was left out to keep the graph readable; click
  **Show all** to add them.
- Colours show the kind (function, method, class, interface). The kind is
  also written on every card.

Prophasis shows what your language server knows. Calls through callbacks,
`eval`, reflection or framework wiring can be missing.
