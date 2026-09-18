const { WORKFLOW_STEPS } = require('../utils/constants.cjs');
const {
  RERUN_SAFETY,
  STEP_RERUN_SAFETY,
  isSafeToRerun,
  rerunReasonFor,
  rerunSafetyOf,
} = require('../utils/stepIdempotency.cjs');

/**
 * #895 reads the flows as "most steps are idempotent by ERC" and proposes a
 * resume on that basis. *Most* is what run 4 of its own table ran into: the
 * products already existed, so linking their options - the one step with no
 * existence check - failed earlier than the run before it.
 *
 * This file is what stops the word "most" coming back. The table is not
 * documentation of the audit; it is the audit, and resume reads it.
 */
describe('Step rerun safety', () => {
  const EVERY_STEP = [...new Set(Object.values(WORKFLOW_STEPS))];

  it('classifies every step the workflows can schedule', () => {
    const unclassified = EVERY_STEP.filter(
      (step) => !Object.prototype.hasOwnProperty.call(STEP_RERUN_SAFETY, step)
    );

    expect(
      unclassified,
      'A new workflow step is a new decision about whether a failed run can be resumed through it. Add it to STEP_RERUN_SAFETY with the call site that decides the answer.'
    ).toEqual([]);
  });

  it('classifies nothing that is not a step', () => {
    const strays = Object.keys(STEP_RERUN_SAFETY).filter(
      (step) => !EVERY_STEP.includes(step)
    );

    expect(strays).toEqual([]);
  });

  it.each(Object.entries(STEP_RERUN_SAFETY))(
    '%s carries a known classification and a reason',
    (_step, entry) => {
      expect(Object.values(RERUN_SAFETY)).toContain(entry.safety);
      // A reason has to say something. "idempotent" on its own is the claim
      // this file exists to stop being taken on trust.
      expect(entry.why.length).toBeGreaterThan(25);
    }
  );

  it('treats a step it has never heard of as unsafe', () => {
    // The direction of the default is the whole contract. A step nobody has
    // audited is a step resume must not run again, and defaulting the other
    // way would make every future step silently resumable.
    expect(rerunSafetyOf('some-step-invented-tomorrow')).toBe(
      RERUN_SAFETY.UNSAFE
    );
    expect(isSafeToRerun('some-step-invented-tomorrow')).toBe(false);
    expect(rerunReasonFor('some-step-invented-tomorrow')).toContain(
      'no idempotency classification'
    );
  });

  describe('the steps whose classification #895 turns on', () => {
    it('reports link-product-options as safe, because it now reads first', () => {
      // Run 4 of the table. Before the read-back it POSTed the definition's
      // options unconditionally, and a CPDefinitionOptionRel has no external
      // reference code for Liferay to upsert on.
      expect(isSafeToRerun(WORKFLOW_STEPS.LINK_PRODUCT_OPTIONS)).toBe(true);
      expect(rerunSafetyOf(WORKFLOW_STEPS.LINK_PRODUCT_OPTIONS)).toBe(
        RERUN_SAFETY.CONVERGES
      );
    });

    it('reports create-addresses as keyed, because its ERC is now derived', () => {
      expect(rerunSafetyOf(WORKFLOW_STEPS.CREATE_POSTAL_ADDRESSES)).toBe(
        RERUN_SAFETY.ERC_UPSERT
      );
    });

    it('still reports the media steps as unsafe', () => {
      // Deliberately not fixed here: both POST an attachment with no external
      // reference code, and neither can be a resume's entry point because a
      // media failure is recorded BYPASSED rather than FAILED. Leaving them
      // classified honestly is what makes the planner's refusal real rather
      // than decorative.
      expect(isSafeToRerun(WORKFLOW_STEPS.ATTACH_IMAGES)).toBe(false);
      expect(isSafeToRerun(WORKFLOW_STEPS.ATTACH_PDFS)).toBe(false);
    });
  });
});
