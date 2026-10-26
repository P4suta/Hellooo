import Hellooo.RecipientSelection

/-!
Model of `src/core/you-page.ts`.
What the page about one address shows, and which states still offer the language switch and the stop.
-/

namespace Hellooo

inductive YouView where
  | waiting
  | receiving
  | stopped
  deriving DecidableEq, Repr

def youView : UserStatus → YouView
  | .pending => .waiting
  | .active => .receiving
  | .unsubscribed => .stopped
  | .suppressed => .stopped
  | .banned => .stopped

/-- The language switch and the stop exist only while letters can still arrive. -/
def youControls (status : UserStatus) : Bool :=
  youView status != .stopped

theorem youControls_iff (status : UserStatus) :
    youControls status = true ↔ status = .pending ∨ status = .active := by
  cases status <;> simp [youControls, youView]

/-- A stopped address offers no control, and every other address offers both. -/
theorem youView_stopped_iff (status : UserStatus) :
    youView status = .stopped ↔ youControls status = false := by
  cases status <;> simp [youControls, youView]

end Hellooo
