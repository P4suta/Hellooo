import Hellooo.WeeklyCap
import Hellooo.RecipientSelection

/-!
Model of `src/core/intake-decision.ts`.
The decision over one incoming mail, before any moderation call, and the properties the service promises: silence toward unauthenticated strangers, and the fixed priority of cap, rejection limit, text check, and moderation.
-/

namespace Hellooo

inductive DmarcResult where
  | pass
  | fail
  | none
  deriving DecidableEq, Repr

inductive LetterTextProblem where
  | empty
  | url
  | emailAddress
  | phoneNumber
  deriving DecidableEq, Repr

inductive LetterText where
  | ok
  | problem (problem : LetterTextProblem)
  deriving DecidableEq, Repr

def LetterText.isOk : LetterText → Bool
  | .ok => true
  | .problem _ => false

structure KnownSender where
  status : UserStatus
  lastAcceptedAt : Option Instant
  rejectionsInLastDay : Int

inductive IgnoreReason where
  | unauthenticatedUnknownSender
  | unauthenticatedSenderBlocked
  | senderInactive
  deriving DecidableEq, Repr

inductive IntakeDecision where
  | ignore (reason : IgnoreReason)
  | register (storeLetter : Bool)
  | confirm
  | overCap (nextAllowedAt : Instant)
  | rejectionsExhausted
  | rejectText (problem : LetterTextProblem)
  | moderate
  deriving DecidableEq, Repr

/-- The branch for an active sender whose mail passed DMARC. -/
def decideAuthenticatedActive (cap : CapCheck) (rejectionsInLastDay : Int) (text : LetterText) :
    IntakeDecision :=
  match cap with
  | .refused next => .overCap next
  | .allowed =>
    if rejectionsRemaining rejectionsInLastDay = 0 then .rejectionsExhausted
    else
      match text with
      | .problem problem => .rejectText problem
      | .ok => .moderate

/-- `decideIntake`. -/
def decideIntake (sender : Option KnownSender) (dmarc : DmarcResult) (now : Instant)
    (text : LetterText) : IntakeDecision :=
  match sender with
  | Option.none =>
    if dmarc = .pass then .register text.isOk else .ignore .unauthenticatedUnknownSender
  | some sender =>
    if sender.status = .pending then
      if dmarc = .pass then .register text.isOk else .ignore .unauthenticatedUnknownSender
    else if sender.status ≠ .active then .ignore .senderInactive
    else
      let cap := weeklyCap sender.lastAcceptedAt now
      if dmarc ≠ .pass then
        if cap = .allowed ∧ text.isOk then .confirm else .ignore .unauthenticatedSenderBlocked
      else decideAuthenticatedActive cap sender.rejectionsInLastDay text

inductive ModerationVerdict where
  | deliver
  | reject
  deriving DecidableEq, Repr

/-- What becomes of a stored letter: it goes out, it is refused, or it waits for the model to answer again later. -/
inductive AcceptanceDecision where
  | accept
  | rejectContent
  | retryLater
  deriving DecidableEq, Repr

/-- The model's verdict decides; no verdict, because the model could not be asked, leaves the letter waiting. -/
def decideAfterModeration : Option ModerationVerdict → AcceptanceDecision
  | some .deliver => .accept
  | some .reject => .rejectContent
  | none => .retryLater

/-- A letter goes out only on the model's delivery verdict. -/
theorem accept_iff (verdict : Option ModerationVerdict) :
    decideAfterModeration verdict = .accept ↔ verdict = some .deliver := by
  cases verdict with
  | none => simp [decideAfterModeration]
  | some v => cases v <;> simp [decideAfterModeration]

/-- Whether a decision makes the service answer the mail at once. -/
def IntakeDecision.replies : IntakeDecision → Bool
  | .ignore _ => false
  | .confirm => false
  | _ => true

theorem decideIntake_none (dmarc : DmarcResult) (now : Int) (text : LetterText) :
    decideIntake Option.none dmarc now text =
      if dmarc = .pass then .register text.isOk else .ignore .unauthenticatedUnknownSender := rfl

theorem decideIntake_some (known : KnownSender) (dmarc : DmarcResult) (now : Int)
    (text : LetterText) :
    decideIntake (some known) dmarc now text =
      if known.status = .pending then
        if dmarc = .pass then .register text.isOk else .ignore .unauthenticatedUnknownSender
      else if known.status ≠ .active then .ignore .senderInactive
      else if dmarc ≠ .pass then
        if weeklyCap known.lastAcceptedAt now = .allowed ∧ text.isOk then .confirm
        else .ignore .unauthenticatedSenderBlocked
      else decideAuthenticatedActive (weeklyCap known.lastAcceptedAt now) known.rejectionsInLastDay text :=
  rfl

theorem authenticatedActive_never_register (cap : CapCheck) (r : Int) (text : LetterText)
    (store : Bool) : decideAuthenticatedActive cap r text ≠ .register store := by
  cases cap with
  | refused next => simp [decideAuthenticatedActive]
  | allowed =>
    simp only [decideAuthenticatedActive]
    split
    · simp
    · cases text <;> simp

theorem authenticatedActive_never_confirm (cap : CapCheck) (r : Int) (text : LetterText) :
    decideAuthenticatedActive cap r text ≠ .confirm := by
  cases cap with
  | refused next => simp [decideAuthenticatedActive]
  | allowed =>
    simp only [decideAuthenticatedActive]
    split
    · simp
    · cases text <;> simp

theorem authenticatedActive_never_ignore (cap : CapCheck) (r : Int) (text : LetterText)
    (reason : IgnoreReason) : decideAuthenticatedActive cap r text ≠ .ignore reason := by
  cases cap with
  | refused next => simp [decideAuthenticatedActive]
  | allowed =>
    simp only [decideAuthenticatedActive]
    split
    · simp
    · cases text <;> simp

theorem authenticatedActive_overCap_iff (cap : CapCheck) (r : Int) (text : LetterText)
    (next : Int) : decideAuthenticatedActive cap r text = .overCap next ↔ cap = .refused next := by
  cases cap with
  | refused next' => simp [decideAuthenticatedActive]
  | allowed =>
    simp only [decideAuthenticatedActive]
    split
    · simp
    · cases text <;> simp

theorem authenticatedActive_rejectionsExhausted_iff (cap : CapCheck) (r : Int)
    (text : LetterText) :
    decideAuthenticatedActive cap r text = .rejectionsExhausted ↔
      cap = .allowed ∧ rejectionsRemaining r = 0 := by
  cases cap with
  | refused next => simp [decideAuthenticatedActive]
  | allowed =>
    simp only [decideAuthenticatedActive]
    split
    · rename_i hzero
      simp [hzero]
    · rename_i hleft
      cases text <;> simp [hleft]

theorem authenticatedActive_rejectText_iff (cap : CapCheck) (r : Int) (text : LetterText)
    (problem : LetterTextProblem) :
    decideAuthenticatedActive cap r text = .rejectText problem ↔
      cap = .allowed ∧ rejectionsRemaining r ≠ 0 ∧ text = .problem problem := by
  cases cap with
  | refused next => simp [decideAuthenticatedActive]
  | allowed =>
    simp only [decideAuthenticatedActive]
    split
    · rename_i hzero
      simp [hzero]
    · rename_i hleft
      cases text <;> simp [hleft]

theorem authenticatedActive_moderate_iff (cap : CapCheck) (r : Int) (text : LetterText) :
    decideAuthenticatedActive cap r text = .moderate ↔
      cap = .allowed ∧ rejectionsRemaining r ≠ 0 ∧ text = .ok := by
  cases cap with
  | refused next => simp [decideAuthenticatedActive]
  | allowed =>
    simp only [decideAuthenticatedActive]
    split
    · rename_i hzero
      simp [hzero]
    · rename_i hleft
      cases text <;> simp [hleft]

/-- An unauthenticated mail never gets a reply: it is ignored or it asks for confirmation at the registered address. -/
theorem no_reply_without_pass (sender : Option KnownSender) (dmarc : DmarcResult) (now : Int)
    (text : LetterText) (h : dmarc ≠ .pass) :
    (decideIntake sender dmarc now text).replies = false := by
  cases sender with
  | none => simp [decideIntake_none, h, IntakeDecision.replies]
  | some known =>
    rw [decideIntake_some]
    by_cases hpending : known.status = .pending
    · simp [hpending, h, IntakeDecision.replies]
    · by_cases hactive : known.status = .active
      · by_cases hcap : weeklyCap known.lastAcceptedAt now = .allowed ∧ text.isOk = true <;>
          simp [hactive, h, hcap, IntakeDecision.replies]
      · simp [hpending, hactive, IntakeDecision.replies]

/-- An unknown address is registered exactly by an authenticated mail, and its letter is stored when the text is sound. -/
theorem register_none_iff (dmarc : DmarcResult) (now : Int) (text : LetterText) (store : Bool) :
    decideIntake Option.none dmarc now text = .register store ↔
      dmarc = .pass ∧ text.isOk = store := by
  rw [decideIntake_none]
  by_cases hpass : dmarc = .pass <;> simp [hpass]

/-- A known address is registered again only while pending, and only by an authenticated mail. -/
theorem register_some_iff (known : KnownSender) (dmarc : DmarcResult) (now : Int)
    (text : LetterText) (store : Bool) :
    decideIntake (some known) dmarc now text = .register store ↔
      dmarc = .pass ∧ known.status = .pending ∧ text.isOk = store := by
  rw [decideIntake_some]
  by_cases hpending : known.status = .pending
  · by_cases hpass : dmarc = .pass <;> simp [hpending, hpass]
  · by_cases hactive : known.status = .active
    · by_cases hpass : dmarc = .pass
      · simp [hactive, hpass, authenticatedActive_never_register]
      · by_cases hcap : weeklyCap known.lastAcceptedAt now = .allowed ∧ text.isOk = true <;>
          simp [hactive, hpass, hcap]
    · simp [hpending, hactive]

/-- A sender who left, was suppressed, or was banned is ignored whatever the mail says. -/
theorem inactive_ignored (known : KnownSender) (dmarc : DmarcResult) (now : Int)
    (text : LetterText) (hpending : known.status ≠ .pending) (hactive : known.status ≠ .active) :
    decideIntake (some known) dmarc now text = .ignore .senderInactive := by
  rw [decideIntake_some]
  simp [hpending, hactive]

/-- Confirmation is asked exactly from an active sender without DMARC whose cap allows a sound letter. -/
theorem confirm_iff (known : KnownSender) (dmarc : DmarcResult) (now : Int) (text : LetterText) :
    decideIntake (some known) dmarc now text = .confirm ↔
      dmarc ≠ .pass ∧ known.status = .active ∧
        weeklyCap known.lastAcceptedAt now = .allowed ∧ text.isOk = true := by
  rw [decideIntake_some]
  by_cases hpending : known.status = .pending
  · by_cases hpass : dmarc = .pass <;> simp [hpending, hpass]
  · by_cases hactive : known.status = .active
    · by_cases hpass : dmarc = .pass
      · simp [hactive, hpass, authenticatedActive_never_confirm]
      · by_cases hcap : weeklyCap known.lastAcceptedAt now = .allowed ∧ text.isOk = true <;>
          simp [hactive, hpass, hcap]
    · simp [hpending, hactive]

/-- The capped sender hears the pigeon story before anything else is checked, and the date is the end of the week. -/
theorem overCap_iff (known : KnownSender) (dmarc : DmarcResult) (now : Int) (text : LetterText)
    (next : Int) :
    decideIntake (some known) dmarc now text = .overCap next ↔
      dmarc = .pass ∧ known.status = .active ∧
        weeklyCap known.lastAcceptedAt now = .refused next := by
  rw [decideIntake_some]
  by_cases hpending : known.status = .pending
  · by_cases hpass : dmarc = .pass <;> simp [hpending, hpass]
  · by_cases hactive : known.status = .active
    · by_cases hpass : dmarc = .pass
      · simp [hactive, hpass, authenticatedActive_overCap_iff]
      · by_cases hcap : weeklyCap known.lastAcceptedAt now = .allowed ∧ text.isOk = true <;>
          simp [hactive, hpass, hcap]
    · simp [hpending, hactive]

/-- The daily rejection limit stops moderation before the text is even checked. -/
theorem rejectionsExhausted_iff (known : KnownSender) (dmarc : DmarcResult) (now : Int)
    (text : LetterText) :
    decideIntake (some known) dmarc now text = .rejectionsExhausted ↔
      dmarc = .pass ∧ known.status = .active ∧
        weeklyCap known.lastAcceptedAt now = .allowed ∧
        rejectionsRemaining known.rejectionsInLastDay = 0 := by
  rw [decideIntake_some]
  by_cases hpending : known.status = .pending
  · by_cases hpass : dmarc = .pass <;> simp [hpending, hpass]
  · by_cases hactive : known.status = .active
    · by_cases hpass : dmarc = .pass
      · simp [hactive, hpass, authenticatedActive_rejectionsExhausted_iff]
      · by_cases hcap : weeklyCap known.lastAcceptedAt now = .allowed ∧ text.isOk = true <;>
          simp [hactive, hpass, hcap]
    · simp [hpending, hactive]

/-- A text problem is reported only after the cap and the rejection limit let the letter through. -/
theorem rejectText_iff (known : KnownSender) (dmarc : DmarcResult) (now : Int)
    (text : LetterText) (problem : LetterTextProblem) :
    decideIntake (some known) dmarc now text = .rejectText problem ↔
      dmarc = .pass ∧ known.status = .active ∧
        weeklyCap known.lastAcceptedAt now = .allowed ∧
        rejectionsRemaining known.rejectionsInLastDay ≠ 0 ∧ text = .problem problem := by
  rw [decideIntake_some]
  by_cases hpending : known.status = .pending
  · by_cases hpass : dmarc = .pass <;> simp [hpending, hpass]
  · by_cases hactive : known.status = .active
    · by_cases hpass : dmarc = .pass
      · simp [hactive, hpass, authenticatedActive_rejectText_iff]
      · by_cases hcap : weeklyCap known.lastAcceptedAt now = .allowed ∧ text.isOk = true <;>
          simp [hactive, hpass, hcap]
    · simp [hpending, hactive]

/-- Moderation is reached exactly by an authenticated active sender inside the cap, with rejections left and sound text. -/
theorem moderate_iff (known : KnownSender) (dmarc : DmarcResult) (now : Int) (text : LetterText) :
    decideIntake (some known) dmarc now text = .moderate ↔
      dmarc = .pass ∧ known.status = .active ∧
        weeklyCap known.lastAcceptedAt now = .allowed ∧
        rejectionsRemaining known.rejectionsInLastDay ≠ 0 ∧ text = .ok := by
  rw [decideIntake_some]
  by_cases hpending : known.status = .pending
  · by_cases hpass : dmarc = .pass <;> simp [hpending, hpass]
  · by_cases hactive : known.status = .active
    · by_cases hpass : dmarc = .pass
      · simp [hactive, hpass, authenticatedActive_moderate_iff]
      · by_cases hcap : weeklyCap known.lastAcceptedAt now = .allowed ∧ text.isOk = true <;>
          simp [hactive, hpass, hcap]
    · simp [hpending, hactive]

theorem decideAfterModeration_accept_iff (verdict : ModerationVerdict) :
    decideAfterModeration verdict = .accept ↔ verdict = .deliver := by
  cases verdict <;> simp [decideAfterModeration]

end Hellooo
