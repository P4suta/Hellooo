/-!
Model of `src/core/weekly-cap.ts`.
Instants are unbounded integers here; the implementation keeps them inside JavaScript's safe integers, which the conformance vectors stay within.
-/

namespace Hellooo

abbrev Instant := Int

def WEEK_MS : Int := 7 * 24 * 60 * 60 * 1000
def LETTER_INTERVAL_MS : Int := WEEK_MS
def DAILY_REJECTION_LIMIT : Int := 3
def DAILY_CONFIRMATION_LIMIT : Int := 3

inductive CapCheck where
  | allowed
  | refused (nextAllowedAt : Instant)
  deriving DecidableEq, Repr

/-- `weeklyCap`: one accepted letter per rolling week, counted from the last acceptance. -/
def weeklyCap (lastAcceptedAt : Option Instant) (now : Instant) : CapCheck :=
  match lastAcceptedAt with
  | none => .allowed
  | some last =>
    if now ≥ last + LETTER_INTERVAL_MS then .allowed
    else .refused (last + LETTER_INTERVAL_MS)

/-- `rejectionsRemaining`, with `Math.max(0, x)` written as a conditional. -/
def rejectionsRemaining (rejectionsInLastDay : Int) : Int :=
  if DAILY_REJECTION_LIMIT - rejectionsInLastDay ≤ 0 then 0
  else DAILY_REJECTION_LIMIT - rejectionsInLastDay

/-- `confirmationsRemaining`, with `Math.max(0, x)` written as a conditional. -/
def confirmationsRemaining (confirmationsInLastDay : Int) : Int :=
  if DAILY_CONFIRMATION_LIMIT - confirmationsInLastDay ≤ 0 then 0
  else DAILY_CONFIRMATION_LIMIT - confirmationsInLastDay

theorem weeklyCap_none (now : Int) : weeklyCap none now = .allowed := rfl

theorem weeklyCap_some_allowed_iff (last now : Int) :
    weeklyCap (some last) now = .allowed ↔ last + LETTER_INTERVAL_MS ≤ now := by
  by_cases h : now ≥ last + LETTER_INTERVAL_MS
  · simp only [weeklyCap, h, ite_true]
  · simp only [weeklyCap, h, ite_false, reduceCtorEq]

theorem weeklyCap_some_refused_iff (last now next : Int) :
    weeklyCap (some last) now = .refused next ↔
      now < last + LETTER_INTERVAL_MS ∧ next = last + LETTER_INTERVAL_MS := by
  by_cases h : now ≥ last + LETTER_INTERVAL_MS
  · simp only [weeklyCap, h, ite_true, reduceCtorEq, false_iff]
    rintro ⟨hlt, _⟩
    omega
  · simp only [weeklyCap, h, ite_false, CapCheck.refused.injEq]
    constructor
    · intro heq
      exact ⟨by omega, heq.symm⟩
    · intro hnext
      exact hnext.2.symm

/-- A refusal always names the end of the week that started at the last acceptance. -/
theorem weeklyCap_refused_next {last now next : Int}
    (h : weeklyCap (some last) now = .refused next) : next = last + LETTER_INTERVAL_MS :=
  ((weeklyCap_some_refused_iff last now next).mp h).2

theorem rejectionsRemaining_nonneg (n : Int) : 0 ≤ rejectionsRemaining n := by
  unfold rejectionsRemaining
  split <;> omega

/-- The count of rejections is never negative, so the remaining attempts never exceed the limit. -/
theorem rejectionsRemaining_le_limit (n : Int) (hn : 0 ≤ n) :
    rejectionsRemaining n ≤ DAILY_REJECTION_LIMIT := by
  unfold rejectionsRemaining DAILY_REJECTION_LIMIT
  split <;> omega

theorem rejectionsRemaining_eq_zero_iff (n : Int) :
    rejectionsRemaining n = 0 ↔ DAILY_REJECTION_LIMIT ≤ n := by
  unfold rejectionsRemaining DAILY_REJECTION_LIMIT
  constructor
  · intro h
    split at h <;> omega
  · intro h
    split <;> omega

theorem confirmationsRemaining_nonneg (n : Int) : 0 ≤ confirmationsRemaining n := by
  unfold confirmationsRemaining
  split <;> omega

/-- The count of confirmation mails is never negative, so the remaining ones never exceed the limit. -/
theorem confirmationsRemaining_le_limit (n : Int) (hn : 0 ≤ n) :
    confirmationsRemaining n ≤ DAILY_CONFIRMATION_LIMIT := by
  unfold confirmationsRemaining DAILY_CONFIRMATION_LIMIT
  split <;> omega

/-- The day's confirmation mails are spent exactly when the count reached the limit. -/
theorem confirmationsRemaining_eq_zero_iff (n : Int) :
    confirmationsRemaining n = 0 ↔ DAILY_CONFIRMATION_LIMIT ≤ n := by
  unfold confirmationsRemaining DAILY_CONFIRMATION_LIMIT
  constructor
  · intro h
    split at h <;> omega
  · intro h
    split <;> omega

end Hellooo
