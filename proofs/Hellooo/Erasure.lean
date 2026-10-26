import Hellooo.JourneySchedule

/-!
Model of `src/core/erasure.ts`.
When a letter's text goes: never while the letter is on its way or waiting for the model, never under an open report, and only once the retention period after it settled has passed.
-/

namespace Hellooo

inductive LetterStatus where
  | pendingVerification
  | pendingConfirmation
  | rejected
  | held
  | traveling
  | delivered
  | lost
  deriving DecidableEq, Repr

def BODY_RETENTION_MS : Int := 90 * DAY_MS

structure ErasureFacts where
  status : LetterStatus
  /-- When the journey ended or, for a letter that never went out, when it arrived. -/
  settledAt : Int
  openReports : Nat
  erased : Bool

/-- A letter on its way, or waiting for the model, keeps its text whatever its age. -/
def keepsText : LetterStatus → Bool
  | .held => true
  | .traveling => true
  | _ => false

def eraseBody (f : ErasureFacts) (now : Int) : Bool :=
  !f.erased && !keepsText f.status && f.openReports == 0 && decide (f.settledAt + BODY_RETENTION_MS ≤ now)

theorem keepsText_iff (status : LetterStatus) :
    keepsText status = true ↔ status = .held ∨ status = .traveling := by
  cases status <;> simp [keepsText]

/-- The text goes exactly when all four facts allow it. -/
theorem eraseBody_iff (f : ErasureFacts) (now : Int) :
    eraseBody f now = true ↔
      f.erased = false ∧ keepsText f.status = false ∧ f.openReports = 0 ∧
        f.settledAt + BODY_RETENTION_MS ≤ now := by
  simp [eraseBody, and_assoc]

/-- Once the text may go, it may go at every later instant. -/
theorem eraseBody_monotone {f : ErasureFacts} {now later : Int}
    (h : eraseBody f now = true) (hle : now ≤ later) : eraseBody f later = true := by
  rw [eraseBody_iff] at h ⊢
  exact ⟨h.1, h.2.1, h.2.2.1, by omega⟩

/-- A letter on its way or waiting for the model keeps its text at every instant. -/
theorem eraseBody_of_keepsText {f : ErasureFacts} (now : Int) (h : keepsText f.status = true) :
    eraseBody f now = false := by
  simp [eraseBody, h]

/-- An open report keeps the text at every instant. -/
theorem eraseBody_of_reported {f : ErasureFacts} (now : Int) (h : f.openReports ≠ 0) :
    eraseBody f now = false := by
  simp [eraseBody, h]

end Hellooo
