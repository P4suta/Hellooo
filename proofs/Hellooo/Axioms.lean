import Hellooo.WeeklyCap
import Hellooo.CreditLedger
import Hellooo.RecipientSelection
import Hellooo.JourneySchedule
import Hellooo.IntakeDecision
import Hellooo.ModerationVerdict
import Hellooo.MailOrigin
import Hellooo.YouPage
import Hellooo.Erasure

/-!
The axioms behind the promised theorems.
`#guard_msgs` fails the build when a theorem comes to depend on `sorryAx` or on anything beyond Lean's standard axioms.
-/

/-- info: 'Hellooo.Ledger.conserved_of_reachable' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms Hellooo.Ledger.conserved_of_reachable

/-- info: 'Hellooo.Ledger.creditsOf_nonneg_of_reachable' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms Hellooo.Ledger.creditsOf_nonneg_of_reachable

/-- info: 'Hellooo.weeklyCap_some_allowed_iff' depends on axioms: [propext] -/
#guard_msgs in #print axioms Hellooo.weeklyCap_some_allowed_iff

/-- info: 'Hellooo.selectRecipient_eq_none_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms Hellooo.selectRecipient_eq_none_iff

/-- info: 'Hellooo.selectRecipient_eligible' depends on axioms: [propext] -/
#guard_msgs in #print axioms Hellooo.selectRecipient_eligible

/-- info: 'Hellooo.clampJourney_ge' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms Hellooo.clampJourney_ge

/-- info: 'Hellooo.no_reply_without_pass' depends on axioms: [propext] -/
#guard_msgs in #print axioms Hellooo.no_reply_without_pass

/-- info: 'Hellooo.moderate_iff' depends on axioms: [propext] -/
#guard_msgs in #print axioms Hellooo.moderate_iff

/-- info: 'Hellooo.reject_iff' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms Hellooo.reject_iff

/-- info: 'Hellooo.deliver_iff' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms Hellooo.deliver_iff

/-- info: 'Hellooo.reject_monotone' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms Hellooo.reject_monotone

/-- info: 'Hellooo.accept_iff' depends on axioms: [propext] -/
#guard_msgs in #print axioms Hellooo.accept_iff

/-- info: 'Hellooo.originProblem_eq_none_iff' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms Hellooo.originProblem_eq_none_iff

/-- info: 'Hellooo.youControls_iff' depends on axioms: [propext] -/
#guard_msgs in #print axioms Hellooo.youControls_iff

/-- info: 'Hellooo.youView_stopped_iff' depends on axioms: [propext] -/
#guard_msgs in #print axioms Hellooo.youView_stopped_iff

/-- info: 'Hellooo.eraseBody_iff' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms Hellooo.eraseBody_iff

/-- info: 'Hellooo.eraseBody_monotone' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms Hellooo.eraseBody_monotone

/-- info: 'Hellooo.eraseBody_of_keepsText' depends on axioms: [propext] -/
#guard_msgs in #print axioms Hellooo.eraseBody_of_keepsText

/-- info: 'Hellooo.eraseBody_of_reported' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms Hellooo.eraseBody_of_reported
