/-!
Model of `src/core/credit-ledger.ts`.
The `Map` of credits is an association list whose keys never repeat, which `setCredit` preserves exactly as `Map.set` does.
The theorems cover every ledger reachable from the empty one through the two operations, which is the only way the database adapter is allowed to change credits.
-/

namespace Hellooo

structure Ledger (α : Type) where
  credits : List (α × Int)
  accepted : Int
  delivered : Int

namespace Ledger

variable {α : Type} [DecidableEq α]

def empty : Ledger α := ⟨[], 0, 0⟩

/-- `Map.get(who) ?? 0`. -/
def lookup (credits : List (α × Int)) (who : α) : Int :=
  match credits.find? (fun entry => entry.1 = who) with
  | some entry => entry.2
  | none => 0

def creditsOf (ledger : Ledger α) (who : α) : Int := lookup ledger.credits who

/-- `Map.set(who, value)`: the entry for `who` is replaced and every other entry stays. -/
def setCredit (credits : List (α × Int)) (who : α) (value : Int) : List (α × Int) :=
  (who, value) :: credits.filter (fun entry => entry.1 ≠ who)

def recordAccepted (ledger : Ledger α) (senderId : α) : Ledger α :=
  { credits := setCredit ledger.credits senderId (ledger.creditsOf senderId + 1)
    accepted := ledger.accepted + 1
    delivered := ledger.delivered }

/-- `null` when the recipient holds no credit, so a delivery never overdraws. -/
def recordDelivered (ledger : Ledger α) (recipientId : α) : Option (Ledger α) :=
  if ledger.creditsOf recipientId ≤ 0 then none
  else
    some
      { credits := setCredit ledger.credits recipientId (ledger.creditsOf recipientId - 1)
        accepted := ledger.accepted
        delivered := ledger.delivered + 1 }

/-- Reverses a reserved delivery whose mail could not be sent; `null` when nothing was delivered. -/
def recordUndone (ledger : Ledger α) (recipientId : α) : Option (Ledger α) :=
  if ledger.delivered ≤ 0 then none
  else
    some
      { credits := setCredit ledger.credits recipientId (ledger.creditsOf recipientId + 1)
        accepted := ledger.accepted
        delivered := ledger.delivered - 1 }

def sumValues : List (α × Int) → Int
  | [] => 0
  | entry :: rest => entry.2 + sumValues rest

def creditTotal (ledger : Ledger α) : Int := sumValues ledger.credits

def conserved (ledger : Ledger α) : Prop :=
  ledger.creditTotal = ledger.accepted - ledger.delivered

/-- No key appears twice, as in a `Map`. -/
def KeysDistinct : List (α × Int) → Prop
  | [] => True
  | entry :: rest => (∀ other ∈ rest, other.1 ≠ entry.1) ∧ KeysDistinct rest

def NonNegative (credits : List (α × Int)) : Prop := ∀ entry ∈ credits, 0 ≤ entry.2

/-- The ledgers the adapter may produce: the empty ledger and whatever the two operations make of one. -/
inductive Reachable : Ledger α → Prop where
  | empty : Reachable empty
  | accepted {ledger : Ledger α} (who : α) :
      Reachable ledger → Reachable (ledger.recordAccepted who)
  | delivered {ledger next : Ledger α} (who : α) :
      Reachable ledger → ledger.recordDelivered who = some next → Reachable next
  | undone {ledger next : Ledger α} (who : α) :
      Reachable ledger → ledger.recordUndone who = some next → Reachable next

theorem lookup_nil (who : α) : lookup ([] : List (α × Int)) who = 0 := rfl

theorem lookup_cons (entry : α × Int) (rest : List (α × Int)) (who : α) :
    lookup (entry :: rest) who = if entry.1 = who then entry.2 else lookup rest who := by
  unfold lookup
  by_cases h : entry.1 = who
  · rw [List.find?_cons_of_pos (by simp [h]), ite_eq_left h]
  · rw [List.find?_cons_of_neg (by simp [h]), ite_eq_right h]

theorem filter_ne_of_absent {credits : List (α × Int)} {who : α}
    (h : ∀ entry ∈ credits, entry.1 ≠ who) :
    credits.filter (fun entry => entry.1 ≠ who) = credits := by
  induction credits with
  | nil => rfl
  | cons entry rest ih =>
    have hne : entry.1 ≠ who := h entry (by simp)
    have hrest : ∀ other ∈ rest, other.1 ≠ who :=
      fun other hmem => h other (List.mem_cons_of_mem _ hmem)
    rw [List.filter_cons, ite_eq_left (by simpa using hne), ih hrest]

theorem lookup_filter_ne {credits : List (α × Int)} {who other : α} (hne : other ≠ who) :
    lookup (credits.filter (fun entry => entry.1 ≠ who)) other = lookup credits other := by
  induction credits with
  | nil => rfl
  | cons entry rest ih =>
    rw [List.filter_cons]
    by_cases hk : entry.1 = who
    · have hother : ¬ entry.1 = other := by
        rw [hk]
        exact fun heq => hne heq.symm
      rw [ite_eq_right (by simpa using hk), ih, lookup_cons, ite_eq_right hother]
    · rw [ite_eq_left (by simpa using hk), lookup_cons, lookup_cons, ih]

theorem sumValues_filter_ne {credits : List (α × Int)} (who : α) (h : KeysDistinct credits) :
    sumValues (credits.filter (fun entry => entry.1 ≠ who)) =
      sumValues credits - lookup credits who := by
  induction credits with
  | nil => simp [sumValues, lookup]
  | cons entry rest ih =>
    obtain ⟨habsent, hrest⟩ := h
    rw [List.filter_cons, lookup_cons]
    by_cases hk : entry.1 = who
    · have hrestfree : ∀ other ∈ rest, other.1 ≠ who :=
        fun other hmem heq => habsent other hmem (heq.trans hk.symm)
      rw [ite_eq_right (by simpa using hk), ite_eq_left hk, filter_ne_of_absent hrestfree]
      simp only [sumValues]
      omega
    · rw [ite_eq_left (by simpa using hk), ite_eq_right hk]
      simp only [sumValues]
      rw [ih hrest]
      omega

theorem sumValues_setCredit {credits : List (α × Int)} (who : α) (value : Int)
    (h : KeysDistinct credits) :
    sumValues (setCredit credits who value) = sumValues credits - lookup credits who + value := by
  simp only [setCredit, sumValues]
  rw [sumValues_filter_ne who h]
  omega

theorem lookup_setCredit_self (credits : List (α × Int)) (who : α) (value : Int) :
    lookup (setCredit credits who value) who = value := by
  simp only [setCredit]
  rw [lookup_cons, ite_eq_left rfl]

theorem lookup_setCredit_other (credits : List (α × Int)) {who other : α} (value : Int)
    (hne : other ≠ who) : lookup (setCredit credits who value) other = lookup credits other := by
  simp only [setCredit]
  rw [lookup_cons, ite_eq_right (Ne.symm hne), lookup_filter_ne hne]

omit [DecidableEq α] in
theorem keysDistinct_filter {credits : List (α × Int)} (p : α × Int → Bool)
    (h : KeysDistinct credits) : KeysDistinct (credits.filter p) := by
  induction credits with
  | nil => trivial
  | cons entry rest ih =>
    obtain ⟨habsent, hrest⟩ := h
    rw [List.filter_cons]
    split
    · exact ⟨fun other hmem => habsent other ((List.mem_filter.mp hmem).1), ih hrest⟩
    · exact ih hrest

theorem keysDistinct_setCredit {credits : List (α × Int)} (who : α) (value : Int)
    (h : KeysDistinct credits) : KeysDistinct (setCredit credits who value) :=
  ⟨fun other hmem => by simpa using (List.mem_filter.mp hmem).2, keysDistinct_filter _ h⟩

theorem nonNegative_setCredit {credits : List (α × Int)} {who : α} {value : Int}
    (h : NonNegative credits) (hv : 0 ≤ value) : NonNegative (setCredit credits who value) := by
  intro entry hmem
  rcases List.mem_cons.mp hmem with heq | hmem'
  · rw [heq]
    exact hv
  · exact h entry (List.mem_filter.mp hmem').1

theorem lookup_nonneg {credits : List (α × Int)} (h : NonNegative credits) (who : α) :
    0 ≤ lookup credits who := by
  unfold lookup
  split
  · rename_i entry hfind
    exact h entry (List.mem_of_find?_eq_some hfind)
  · exact Int.le_refl 0

/-- The invariant that both operations keep: distinct keys, no negative credit, and the conservation law. -/
def Inv (ledger : Ledger α) : Prop :=
  KeysDistinct ledger.credits ∧ NonNegative ledger.credits ∧ ledger.conserved

omit [DecidableEq α] in
theorem inv_empty : Inv (empty : Ledger α) := by
  refine ⟨trivial, ?_, ?_⟩
  · intro entry h
    simp [empty] at h
  · simp [conserved, creditTotal, sumValues, empty]

theorem inv_recordAccepted {ledger : Ledger α} (who : α) (h : Inv ledger) :
    Inv (ledger.recordAccepted who) := by
  obtain ⟨hkeys, hnonneg, hcons⟩ := h
  have hlook := lookup_nonneg hnonneg who
  refine ⟨keysDistinct_setCredit _ _ hkeys, nonNegative_setCredit hnonneg ?_, ?_⟩
  · simp only [creditsOf]
    omega
  · simp only [conserved, creditTotal, recordAccepted, creditsOf] at hcons ⊢
    rw [sumValues_setCredit who _ hkeys]
    omega

theorem inv_recordDelivered {ledger next : Ledger α} (who : α) (h : Inv ledger)
    (hstep : ledger.recordDelivered who = some next) : Inv next := by
  obtain ⟨hkeys, hnonneg, hcons⟩ := h
  unfold recordDelivered at hstep
  split at hstep
  · cases hstep
  · rename_i hheld
    simp only [Option.some.injEq] at hstep
    subst hstep
    refine ⟨keysDistinct_setCredit _ _ hkeys, nonNegative_setCredit hnonneg ?_, ?_⟩
    · simp only [creditsOf] at hheld ⊢
      omega
    · simp only [conserved, creditTotal, creditsOf] at hcons ⊢
      rw [sumValues_setCredit who _ hkeys]
      omega

theorem inv_recordUndone {ledger next : Ledger α} (who : α) (h : Inv ledger)
    (hstep : ledger.recordUndone who = some next) : Inv next := by
  obtain ⟨hkeys, hnonneg, hcons⟩ := h
  have hlook := lookup_nonneg hnonneg who
  unfold recordUndone at hstep
  split at hstep
  · cases hstep
  · simp only [Option.some.injEq] at hstep
    subst hstep
    refine ⟨keysDistinct_setCredit _ _ hkeys, nonNegative_setCredit hnonneg ?_, ?_⟩
    · simp only [creditsOf]
      omega
    · simp only [conserved, creditTotal, creditsOf] at hcons ⊢
      rw [sumValues_setCredit who _ hkeys]
      omega

theorem inv_of_reachable {ledger : Ledger α} (h : Reachable ledger) : Inv ledger := by
  induction h with
  | empty => exact inv_empty
  | accepted who _ ih => exact inv_recordAccepted who ih
  | delivered who _ hstep ih => exact inv_recordDelivered who ih hstep
  | undone who _ hstep ih => exact inv_recordUndone who ih hstep

/-- An undo is refused exactly when nothing has been delivered. -/
theorem recordUndone_eq_none_iff (ledger : Ledger α) (who : α) :
    ledger.recordUndone who = none ↔ ledger.delivered ≤ 0 := by
  unfold recordUndone
  split <;> simp_all

/-- The law the D1 adapter must preserve: credits in circulation equal accepted minus delivered letters. -/
theorem conserved_of_reachable {ledger : Ledger α} (h : Reachable ledger) : ledger.conserved :=
  (inv_of_reachable h).2.2

/-- No reachable ledger holds a negative credit. -/
theorem creditsOf_nonneg_of_reachable {ledger : Ledger α} (h : Reachable ledger) (who : α) :
    0 ≤ ledger.creditsOf who :=
  lookup_nonneg (inv_of_reachable h).2.1 who

/-- A delivery is refused exactly when the recipient holds nothing. -/
theorem recordDelivered_eq_none_iff (ledger : Ledger α) (who : α) :
    ledger.recordDelivered who = none ↔ ledger.creditsOf who ≤ 0 := by
  unfold recordDelivered
  split <;> simp_all

theorem recordAccepted_creditsOf_self (ledger : Ledger α) (who : α) :
    (ledger.recordAccepted who).creditsOf who = ledger.creditsOf who + 1 := by
  simp only [recordAccepted, creditsOf]
  exact lookup_setCredit_self _ _ _

theorem recordAccepted_creditsOf_other (ledger : Ledger α) {who other : α} (hne : other ≠ who) :
    (ledger.recordAccepted who).creditsOf other = ledger.creditsOf other := by
  simp only [recordAccepted, creditsOf]
  exact lookup_setCredit_other _ _ hne

theorem recordDelivered_creditsOf_self {ledger next : Ledger α} {who : α}
    (h : ledger.recordDelivered who = some next) :
    next.creditsOf who = ledger.creditsOf who - 1 := by
  unfold recordDelivered at h
  split at h
  · cases h
  · simp only [Option.some.injEq] at h
    subst h
    simp only [creditsOf]
    exact lookup_setCredit_self _ _ _

theorem recordDelivered_creditsOf_other {ledger next : Ledger α} {who other : α}
    (h : ledger.recordDelivered who = some next) (hne : other ≠ who) :
    next.creditsOf other = ledger.creditsOf other := by
  unfold recordDelivered at h
  split at h
  · cases h
  · simp only [Option.some.injEq] at h
    subst h
    simp only [creditsOf]
    exact lookup_setCredit_other _ _ hne

end Ledger

end Hellooo
