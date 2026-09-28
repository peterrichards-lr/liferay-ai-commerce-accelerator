---
name: quality-guardrails
description: Activate this skill when adding new service endpoints, editing database layers, or preparing to commit changes.
---

# Quality Guardrails & Parity Testing

To prevent regression and ensure 100% architectural integrity, the following automated checks are mandatory:

## 1. Service Parity Testing

- **Rule**: Every public wrapper method in `LiferayService` (index.cjs) MUST have a corresponding implementation in either `LiferayRestService` or `LiferayGraphqlService`.
- **Enforcement**: Verified via `tests/serviceParity.test.cjs`. This prevents `TypeError: ... is not a function` errors when invoking headless wrappers.

## 2. Startup Step Verification

- **Rule**: Every workflow step registered in a Generator (e.g., `[S.CREATE_PRODUCTS]`) MUST be mapped to a valid class method.
- **Enforcement**: The `BaseGenerator.verifySteps()` method is called at boot time in `bootstrap.cjs`. The microservice will fail to start if any mapping is broken.

## 3. Pre-Commit & Pre-Push Verification

- **Rule**: All code and documentation must be free of syntax errors, undefined references, and lint violations before they reach the repository.
- **Enforcement**: This is split across two Husky hooks with different scope, so that fast, iterative commits aren't blocked on the full test suite:
  - **`.husky/pre-commit`**: Runs `lint-staged` (`eslint --fix`, `prettier`, `markdownlint` on staged files only) plus `scripts/detect-secrets.mjs`. This catches `ReferenceError`, `SyntaxError`, and documentation drift on every commit.
  - **`.husky/pre-push`**: Runs the full project lint (`yarn lint`) and the full unit test suite (`yarn test`, i.e. `vitest run`) before code leaves the machine.

## 4. Guards That Cannot Fail

Sections 1-3 are the mechanisms. This is the class of defect they are meant to
catch and repeatedly have not, because the guard itself was broken.

**The tell**: there is no line you could change that would turn the guard red.

**The test**, before adding or amending any guard: **name the line that would
have to change for this to fail, then change that line and watch it fail.** If
you cannot name one, the guard is decorative. Testing against the perturbation
you already expect is not this test - that is the anchoring that produced the
defect, applied to its own check.

### 4.1 The shape it keeps taking

**Every instance so far ran in a context where its subject had already gone.**

- a signals grep against a log format the source never writes
- `echo "clean: $?"` after a pipeline, which reports the echo's status
- HTTP probes that ran after cleanup closed the tunnel
- a guard matching a string the code had stopped emitting, still present in the
  comment beside it

So the question to ask of a new check is: **at the moment this runs, does the
thing it reads still exist?**

### 4.2 Variants worth recognising

- **A guard a comment can satisfy.** Bitten five times, each fixed as an
  instance, before it was fixed as a class in #1172. Anything that scans source
  for a construct goes through the shared stripper in
  `client-extensions/ai-commerce-accelerator-microservice/tests/fixtures/sourceComments.cjs`
  (`withoutHashComments` for shell, YAML and Python; `withoutSlashComments` for
  JavaScript, JSX and Gradle) rather than carrying its own copy. Do not write a
  sixth copy: the copies are what let the defect keep recurring, because each
  fix reached one guard and not the class. The helper is for **source scans
  only** - a guard asserting a value is absent from captured output (a log, an
  artifact, a rendered prompt, an API response) must not strip, because a `#`
  there is data. Its own cases in `tests/sourceComments.test.cjs` assert what
  survives as well as what goes, since a stripper that returned `''` would
  satisfy every negative guard in the suite in silence.
- **A guard asserting a section is present rather than that it produced
  anything.** A diagnostic capture echoes its own header unconditionally, so
  `expect(artifact).toContain('=== what the proxy said ===')` can never fail -
  it passes on a header with a blank line under it, which is what shipped for
  two runs while the evidence another repository was waiting on went missing.
  Assert the **content**: a token that can only come from the command having
  run. Better, assert it for every section at once, so the next one to fall
  silent fails too rather than needing its own case (#1193).
- **A guard that stops running rather than failing.** A throw in `beforeAll` is
  reported as _skipped_, which reads as green. Five passing cases became six
  skipped and only the count gave it away.
- **A test asserting the implementation rather than the requirement.** Ten tests
  once guarded an env-var injection by asserting what the code wrote into a zip;
  none asserted the variable arrived, and it never did.

### 4.3 A negative result that could not have been positive

`grep -c "Invalid user|Failed password"` on a node's auth log returned **0**,
which reads as "no unwanted SSH traffic". The node was in fact shedding 159
connections in three hours - they never reached a password prompt, because
`MaxStartups` drops them upstream of authentication. A true fact supporting a
false conclusion.

**A negative result only means what you think if the thing you searched for
could have been produced at all.** Before believing a zero, establish that a
non-zero was reachable.

This is the same family as the guards above, one step out: those were checks
that could not fail, this is a search that could not hit. The question that
covers both:

> What is this actually reading, and could it produce this answer if nothing
> were wrong?

Four surfaces of it in the week to 2026-09-28: test data too simple to fail;
test data too broad to be meaningful; a measurement satisfied by prose
describing the symptom rather than the symptom (a drop count that matched a
code comment explaining the drop); and this.

### 4.4 Diagnosing, not just guarding

Three rules earned the same week, both by contradicting something confidently
held:

- **Put both sides of a boundary in one artifact, and include a control.** Five
  mechanisms proposed for one defect were wrong; the sixth held because the
  capture showed both sides at once with a case that worked beside the case that
  did not. Inference from one side has a poor record here.
- **A hypothesis that fits every occurrence so far is not evidence - it is the
  shape of the occurrences you have.** One fitted four and was retracted on the
  fifth, which changed signature.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-09-28_ | _Last Reviewed: 2026-09-28_
