# DevOps Agent Repository

This CLI manages software changes after coding. It must not implement changes,
deploy software, or let a language model decide the final release gate.

Keep domain validation, lifecycle, and release policy in core. Keep Git-specific
operations in adapters, vendor-specific AI calls in agent-runtime, and orchestration
in application. Test untrusted output, invalid states, command denial, revision
mismatch, and negative release decisions. Build, typecheck and tests are required.
