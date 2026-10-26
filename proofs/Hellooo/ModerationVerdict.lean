import Hellooo.IntakeDecision

/-!
Model of `src/core/moderation-verdict.ts`.
Probabilities are integers in basis points, so `REJECT_AT = 0.5` is `5000`; the implementation compares doubles, and the conformance vectors carry the same decimal values.
-/

namespace Hellooo

inductive Question where
  | sells
  | harasses
  | sexual
  | exposes
  | illegal
  | spam
  | targetsPerson
  deriving DecidableEq, Repr

def Question.all : List Question :=
  [.sells, .harasses, .sexual, .exposes, .illegal, .spam, .targetsPerson]

abbrev Probabilities := Question → Int

def REJECT_AT : Int := 5000

/-- A yes at least this likely, to any question, refuses the letter; otherwise it goes out. -/
def verdictFromProbabilities (p : Probabilities) : ModerationVerdict :=
  if Question.all.any (fun question => p question ≥ REJECT_AT) then .reject else .deliver

theorem mem_all (question : Question) : question ∈ Question.all := by
  cases question <;> simp [Question.all]

theorem reject_iff (p : Probabilities) :
    verdictFromProbabilities p = .reject ↔ ∃ question, REJECT_AT ≤ p question := by
  unfold verdictFromProbabilities
  split
  · rename_i h
    simp only [List.any_eq_true, decide_eq_true_eq] at h
    obtain ⟨question, _, hge⟩ := h
    simp only [true_iff]
    exact ⟨question, hge⟩
  · rename_i h
    simp only [List.any_eq_true, decide_eq_true_eq, not_exists, not_and, Int.not_le] at h
    constructor
    · intro habsurd
      simp at habsurd
    · rintro ⟨question, hge⟩
      exact absurd hge (Int.not_le.mpr (h question (mem_all question)))

theorem deliver_iff (p : Probabilities) :
    verdictFromProbabilities p = .deliver ↔ ∀ question, p question < REJECT_AT := by
  unfold verdictFromProbabilities
  split
  · rename_i h
    simp only [List.any_eq_true, decide_eq_true_eq] at h
    obtain ⟨question, _, hge⟩ := h
    constructor
    · intro habsurd
      simp at habsurd
    · intro hall
      exact absurd hge (Int.not_le.mpr (hall question))
  · rename_i h
    simp only [List.any_eq_true, decide_eq_true_eq, not_exists, not_and, Int.not_le] at h
    simp only [true_iff]
    exact fun question => h question (mem_all question)

/-- Raising any probability never turns a refusal into a delivery. -/
theorem reject_monotone (p q : Probabilities) (h : ∀ question, p question ≤ q question)
    (hp : verdictFromProbabilities p = .reject) : verdictFromProbabilities q = .reject := by
  obtain ⟨question, hge⟩ := (reject_iff p).mp hp
  exact (reject_iff q).mpr ⟨question, Int.le_trans hge (h question)⟩

end Hellooo
