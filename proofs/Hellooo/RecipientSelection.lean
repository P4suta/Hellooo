/-!
Model of `src/core/recipient-selection.ts`.
The uniform is a fraction `num / den` with `num < den`; the implementation multiplies a double below one by the list length and floors, and the conformance vectors use dyadic fractions, which both arithmetics compute exactly.
-/

namespace Hellooo

inductive UserStatus where
  | pending
  | active
  | unsubscribed
  | suppressed
  | banned
  deriving DecidableEq, Repr

structure Candidate (α : Type) where
  id : α
  status : UserStatus
  credits : Int
  receivedFromSender : Bool
  deriving Repr

variable {α : Type} [DecidableEq α]

def eligible (candidate : Candidate α) (senderId : α) : Bool :=
  candidate.status = .active && candidate.credits > 0 && candidate.id ≠ senderId &&
    !candidate.receivedFromSender

/-- Active strangers who hold a credit and never received a letter from this sender. -/
def eligibleRecipients (candidates : List (Candidate α)) (senderId : α) : List (Candidate α) :=
  candidates.filter (fun candidate => eligible candidate senderId)

/-- `eligible[Math.floor(u * eligible.length)] ?? null`. -/
def selectRecipient (candidates : List (Candidate α)) (senderId : α) (num den : Nat) :
    Option (Candidate α) :=
  let chosen := eligibleRecipients candidates senderId
  chosen[num * chosen.length / den]?

theorem eligible_iff (candidate : Candidate α) (senderId : α) :
    eligible candidate senderId = true ↔
      candidate.status = .active ∧ 0 < candidate.credits ∧ candidate.id ≠ senderId ∧
        candidate.receivedFromSender = false := by
  simp [eligible, and_assoc]

theorem mem_eligibleRecipients {candidates : List (Candidate α)} {senderId : α}
    {candidate : Candidate α} (h : candidate ∈ eligibleRecipients candidates senderId) :
    candidate ∈ candidates ∧ candidate.status = .active ∧ 0 < candidate.credits ∧
      candidate.id ≠ senderId ∧ candidate.receivedFromSender = false := by
  have := List.mem_filter.mp h
  exact ⟨this.1, (eligible_iff _ _).mp this.2⟩

/-- Every eligible candidate stays in its original order. -/
theorem eligibleRecipients_sublist (candidates : List (Candidate α)) (senderId : α) :
    (eligibleRecipients candidates senderId).Sublist candidates :=
  List.filter_sublist

/-- The sender is never eligible. -/
theorem sender_not_eligible {candidates : List (Candidate α)} {senderId : α}
    {candidate : Candidate α} (h : candidate ∈ eligibleRecipients candidates senderId) :
    candidate.id ≠ senderId :=
  (mem_eligibleRecipients h).2.2.2.1

theorem index_lt_length {n num den : Nat} (hn : 0 < n) (hu : num < den) :
    num * n / den < n := by
  apply Nat.div_lt_of_lt_mul
  exact Nat.mul_lt_mul_of_pos_right hu hn

/-- Nobody is chosen exactly when nobody is eligible. -/
theorem selectRecipient_eq_none_iff {candidates : List (Candidate α)} {senderId : α}
    {num den : Nat} (hu : num < den) :
    selectRecipient candidates senderId num den = none ↔
      eligibleRecipients candidates senderId = [] := by
  unfold selectRecipient
  simp only [List.getElem?_eq_none_iff]
  constructor
  · intro h
    rcases Nat.eq_zero_or_pos (eligibleRecipients candidates senderId).length with hz | hpos
    · exact List.eq_nil_of_length_eq_zero hz
    · exact absurd h (Nat.not_le.mpr (index_lt_length hpos hu))
  · intro h
    simp [h]

theorem selectRecipient_mem {candidates : List (Candidate α)} {senderId : α} {num den : Nat}
    {chosen : Candidate α} (h : selectRecipient candidates senderId num den = some chosen) :
    chosen ∈ eligibleRecipients candidates senderId :=
  List.mem_of_getElem? h

/-- Whoever is chosen is an eligible stranger. -/
theorem selectRecipient_eligible {candidates : List (Candidate α)} {senderId : α} {num den : Nat}
    {chosen : Candidate α} (h : selectRecipient candidates senderId num den = some chosen) :
    chosen ∈ candidates ∧ chosen.status = .active ∧ 0 < chosen.credits ∧
      chosen.id ≠ senderId ∧ chosen.receivedFromSender = false :=
  mem_eligibleRecipients (selectRecipient_mem h)

end Hellooo
