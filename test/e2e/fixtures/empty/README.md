# empty fixture

This folder deliberately contains **no API surface** — no HTTP calls, no route
declarations, no OpenAPI/Swagger spec. It models a workspace where a codebase
scan should conclude "nothing to mock" and surface that as an *informational*
outcome (never an error toast).

It exists as the real-world analog for the empty-scan E2E case; the test drives
the fast scan with an empty recon so the assertion is deterministic regardless
of what else lives in the shared fixture workspace.
