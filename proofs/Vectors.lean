import Lean.Data.Json
import Hellooo

/-!
Conformance vectors: the verified models evaluated over their whole abstract input domains, written as JSON for `test/core/conformance.test.ts` to replay against the TypeScript implementation.
-/

open Lean (Json JsonNumber)
open Hellooo

/-- The instant every vector uses as "now"; a safe integer far from the epoch. -/
def NOW : Int := 1800000000000

def jsonInt (n : Int) : Json := Json.num (JsonNumber.fromInt n)

def jsonOptInt : Option Int → Json
  | none => Json.null
  | some n => jsonInt n

def statusName : UserStatus → String
  | .pending => "pending"
  | .active => "active"
  | .unsubscribed => "unsubscribed"
  | .suppressed => "suppressed"
  | .banned => "banned"

def dmarcName : DmarcResult → String
  | .pass => "pass"
  | .fail => "fail"
  | .none => "none"

def problemName : LetterTextProblem → String
  | .empty => "empty"
  | .url => "url"
  | .emailAddress => "email-address"
  | .phoneNumber => "phone-number"

def textJson : LetterText → Json
  | .ok => Json.str "ok"
  | .problem p => Json.mkObj [("problem", Json.str (problemName p))]

def reasonName : IgnoreReason → String
  | .unauthenticatedUnknownSender => "unauthenticated-unknown-sender"
  | .unauthenticatedSenderBlocked => "unauthenticated-sender-blocked"
  | .senderInactive => "sender-inactive"

def decisionJson : IntakeDecision → Json
  | .ignore reason =>
    Json.mkObj [("kind", Json.str "ignore"), ("reason", Json.str (reasonName reason))]
  | .register store => Json.mkObj [("kind", Json.str "register"), ("storeLetter", Json.bool store)]
  | .confirm => Json.mkObj [("kind", Json.str "confirm")]
  | .overCap next => Json.mkObj [("kind", Json.str "over-cap"), ("nextAllowedAt", jsonInt next)]
  | .rejectionsExhausted => Json.mkObj [("kind", Json.str "rejections-exhausted")]
  | .rejectText p =>
    Json.mkObj [("kind", Json.str "reject-text"), ("problem", Json.str (problemName p))]
  | .moderate => Json.mkObj [("kind", Json.str "moderate")]

def statuses : List UserStatus := [.pending, .active, .unsubscribed, .suppressed, .banned]
def dmarcResults : List DmarcResult := [.pass, .fail, .none]
def texts : List LetterText :=
  [.ok, .problem .empty, .problem .url, .problem .emailAddress, .problem .phoneNumber]
def lastAcceptances : List (Option Int) :=
  [none, some (NOW - WEEK_MS + 1), some (NOW - WEEK_MS), some (NOW - 2 * WEEK_MS), some (NOW + 1)]
def rejectionCounts : List Int := [0, 1, 2, 3, 4]

def senders : List (Option KnownSender) :=
  Option.none :: (statuses.flatMap fun status =>
    lastAcceptances.flatMap fun last =>
      rejectionCounts.map fun rejections =>
        some { status := status, lastAcceptedAt := last, rejectionsInLastDay := rejections })

def senderJson : Option KnownSender → Json
  | none => Json.null
  | some s =>
    Json.mkObj
      [ ("status", Json.str (statusName s.status))
      , ("lastAcceptedAt", jsonOptInt s.lastAcceptedAt)
      , ("rejectionsInLastDay", jsonInt s.rejectionsInLastDay) ]

def intakeVectors : Json :=
  Json.arr <| (senders.flatMap fun sender =>
    dmarcResults.flatMap fun dmarc =>
      texts.map fun text =>
        Json.mkObj
          [ ("sender", senderJson sender)
          , ("dmarc", Json.str (dmarcName dmarc))
          , ("now", jsonInt NOW)
          , ("text", textJson text)
          , ("decision", decisionJson (decideIntake sender dmarc NOW text)) ]).toArray

def capJson (check : CapCheck) : Json :=
  match check with
  | .allowed => Json.null
  | .refused next => jsonInt next

def capVectors : Json :=
  let offsets : List Int := [-2 * WEEK_MS, -WEEK_MS - 1, -WEEK_MS, -WEEK_MS + 1, -1, 0, 1, WEEK_MS]
  let checks := (Option.none :: offsets.map fun offset => some (NOW + offset)).map fun last =>
    let check := weeklyCap last NOW
    Json.mkObj
      [ ("lastAcceptedAt", jsonOptInt last)
      , ("now", jsonInt NOW)
      , ("allowed", Json.bool (check = .allowed))
      , ("nextAllowedAt", capJson check) ]
  let remaining := ([0, 1, 2, 3, 4, 5, 6] : List Int).map fun n =>
    Json.mkObj [("rejectionsInLastDay", jsonInt n), ("remaining", jsonInt (rejectionsRemaining n))]
  Json.mkObj
    [ ("weeklyCap", Json.arr checks.toArray)
    , ("rejectionsRemaining", Json.arr remaining.toArray) ]

def questionName : Question → String
  | .sells => "sells"
  | .harasses => "harasses"
  | .sexual => "sexual"
  | .exposes => "exposes"
  | .illegal => "illegal"
  | .spam => "spam"
  | .targetsPerson => "targetsPerson"

def verdictName : ModerationVerdict → String
  | .deliver => "deliver"
  | .reject => "reject"

/-- Basis points as a decimal JSON number, so `5000` is written `0.5000`. -/
def basisPoints (bp : Int) : Json := Json.num ⟨bp, 4⟩

def levels : List Int := [0, 4999, 5000, 10000]

def probabilitiesJson (p : Probabilities) : Json :=
  Json.mkObj (Question.all.map fun q => (questionName q, basisPoints (p q)))

def moderationVector (p : Probabilities) : Json :=
  Json.mkObj
    [ ("probabilities", probabilitiesJson p)
    , ("verdict", Json.str (verdictName (verdictFromProbabilities p))) ]

def singleLevel (q : Question) (bp : Int) : Probabilities := fun other => if other = q then bp else 0

def pairLevel (q1 : Question) (bp1 : Int) (q2 : Question) (bp2 : Int) : Probabilities :=
  fun other => if other = q1 then bp1 else if other = q2 then bp2 else 0

def pairs : List (Question × Question) :=
  Question.all.flatMap fun q1 => Question.all.filterMap fun q2 =>
    if questionName q1 < questionName q2 then some (q1, q2) else none

def moderationVectors : Json :=
  let singles := Question.all.flatMap fun q => levels.map fun bp => moderationVector (singleLevel q bp)
  let doubles := pairs.flatMap fun pair =>
    levels.flatMap fun bp1 => levels.map fun bp2 => moderationVector (pairLevel pair.1 bp1 pair.2 bp2)
  Json.arr (singles ++ doubles).toArray

def WRITER : String := "writer@example.com"
def OTHER : String := "other@example.org"
/-- Sample service addresses; the model never depends on the real ones. -/
def OWN : List String := ["letters@service.example", "post@service.example"]

def headerChoices : List Header :=
  [ ⟨"auto-submitted", "no"⟩
  , ⟨"auto-submitted", "auto-replied"⟩
  , ⟨"list-id", "<letters.example.com>"⟩
  , ⟨"list-unsubscribe", "<mailto:leave@example.com>"⟩
  , ⟨"precedence", " Bulk "⟩
  , ⟨"precedence", "first-class"⟩
  , ⟨"subject", "bulk"⟩ ]

def subsets {α : Type} : List α → List (List α)
  | [] => [[]]
  | x :: rest => (subsets rest).flatMap fun subset => [subset, x :: subset]

def originProblemName : OriginProblem → String
  | .ownAddress => "own-address"
  | .misalignedFrom => "misaligned-from"
  | .autoSubmitted => "auto-submitted"
  | .mailingList => "mailing-list"
  | .bulk => "bulk"

def headerJson (h : Header) : Json :=
  Json.mkObj [("key", Json.str h.key), ("value", Json.str h.value)]

def optStr : Option String → Json
  | none => Json.null
  | some s => Json.str s

def originVectors : Json :=
  let envelopes : List String := [WRITER, "anybody@hellooo.email"]
  let headerFroms : List (String → Option String) :=
    [fun envelope => some envelope, fun _ => some OTHER, fun _ => none]
  Json.arr <| (envelopes.flatMap fun envelope =>
    headerFroms.flatMap fun headerFrom =>
      (subsets headerChoices).map fun headers =>
        let origin : Origin String :=
          { envelopeFrom := envelope, headerFrom := headerFrom envelope,
            ownAddresses := OWN, headers := headers }
        Json.mkObj
          [ ("envelopeFrom", Json.str envelope)
          , ("headerFrom", optStr (headerFrom envelope))
          , ("ownAddresses", Json.arr (OWN.map Json.str).toArray)
          , ("headers", Json.arr (headers.map headerJson).toArray)
          , ("problem", optStr ((originProblem origin).map originProblemName)) ]).toArray

def candidateJson (c : Candidate String) : Json :=
  Json.mkObj
    [ ("id", Json.str c.id)
    , ("status", Json.str (statusName c.status))
    , ("credits", jsonInt c.credits)
    , ("receivedFromSender", Json.bool c.receivedFromSender) ]

def roster : List (Candidate String) :=
  [ ⟨"sender", .active, 2, false⟩
  , ⟨"broke", .active, 0, false⟩
  , ⟨"quiet", .unsubscribed, 1, false⟩
  , ⟨"waiting", .pending, 1, false⟩
  , ⟨"repeat", .active, 1, true⟩
  , ⟨"fresh", .active, 1, false⟩
  , ⟨"rich", .active, 3, false⟩ ]

def recipientVectors : Json :=
  let fractions : List Nat := [0, 1, 2, 3, 4, 5, 6, 7]
  Json.arr <| ((subsets roster).flatMap fun candidates =>
    fractions.map fun (num : Nat) =>
      Json.mkObj
        [ ("candidates", Json.arr (candidates.map candidateJson).toArray)
        , ("senderId", Json.str "sender")
        , ("numerator", jsonInt num)
        , ("denominator", jsonInt 8)
        , ("eligible", Json.arr ((eligibleRecipients candidates "sender").map fun c => Json.str c.id).toArray)
        , ("chosen", optStr ((selectRecipient candidates "sender" num 8).map fun c => c.id)) ]).toArray

def journeyVectors : Json :=
  let durations : List Int :=
    [0, 1, JOURNEY_MIN_MS - 1, JOURNEY_MIN_MS, JOURNEY_MIN_MS + 1, 3 * DAY_MS,
      JOURNEY_MAX_MS - 1, JOURNEY_MAX_MS, JOURNEY_MAX_MS + 1, 1000 * DAY_MS]
  Json.arr <| (durations.map fun d =>
    Json.mkObj [("duration", jsonInt d), ("clamped", jsonInt (clampJourney d))]).toArray

/-- A linear congruential generator, so the ledger histories are the same on every run. -/
def lcg (seed : Nat) : Nat := (seed * 1103515245 + 12345) % 2147483648

def users : List String := ["user-1", "user-2", "user-3", "user-4"]

/-- Operation kinds drawn from the generator: 0 accepts, 1 delivers, 2 undoes. -/
def ledgerHistory : Nat → Nat → List (Nat × String)
  | _, 0 => []
  | seed, n + 1 =>
    let next := lcg seed
    (next % 3, users.getD ((next / 3) % 4) "user-1") :: ledgerHistory next n

structure LedgerStep where
  kind : String
  who : String
  refused : Bool

def attempt (state : Ledger String) (kind : String) (who : String) (result : Option (Ledger String)) :
    Ledger String × LedgerStep :=
  match result with
  | none => (state, ⟨kind, who, true⟩)
  | some next => (next, ⟨kind, who, false⟩)

def step (acc : Ledger String × List LedgerStep) (op : Nat × String) :
    Ledger String × List LedgerStep :=
  let (state, steps) := acc
  let (kind, who) := op
  let (next, recorded) :=
    if kind = 0 then (state.recordAccepted who, (⟨"accepted", who, false⟩ : LedgerStep))
    else if kind = 1 then attempt state "delivered" who (state.recordDelivered who)
    else attempt state "undone" who (state.recordUndone who)
  (next, steps ++ [recorded])

def replay (history : List (Nat × String)) : Ledger String × List LedgerStep :=
  history.foldl step ((Ledger.empty : Ledger String), [])

def stepJson (s : LedgerStep) : Json :=
  Json.mkObj
    [ ("kind", Json.str s.kind)
    , ("who", Json.str s.who)
    , ("refused", Json.bool s.refused) ]

def ledgerVectors : Json :=
  Json.arr <| ((List.range 60).map fun index =>
    let history := ledgerHistory (index + 7) (10 + index % 21)
    let (final, steps) := replay history
    Json.mkObj
      [ ("steps", Json.arr (steps.map stepJson).toArray)
      , ("credits", Json.mkObj (users.map fun u => (u, jsonInt (final.creditsOf u))))
      , ("accepted", jsonInt final.accepted)
      , ("delivered", jsonInt final.delivered) ]).toArray

def viewName : YouView → String
  | .waiting => "waiting"
  | .receiving => "receiving"
  | .stopped => "stopped"

/-- The page about an address, over every user status. -/
def youPageVectors : Json :=
  Json.arr <| (statuses.map fun status =>
    Json.mkObj
      [ ("status", Json.str (statusName status))
      , ("view", Json.str (viewName (youView status)))
      , ("controls", Json.bool (youControls status)) ]).toArray

def letterStatusName : LetterStatus → String
  | .pendingVerification => "pending_verification"
  | .pendingConfirmation => "pending_confirmation"
  | .rejected => "rejected"
  | .held => "held"
  | .traveling => "traveling"
  | .delivered => "delivered"
  | .lost => "lost"

def letterStatuses : List LetterStatus :=
  [.pendingVerification, .pendingConfirmation, .rejected, .held, .traveling, .delivered, .lost]

/-- Erasure over every status, both erased states, zero or one open report, and the instants around the end of the retention period. -/
def erasureVectors : Json :=
  let offsets : List Int := [-BODY_RETENTION_MS - 1, -BODY_RETENTION_MS, -BODY_RETENTION_MS + 1, 0]
  let reports : List Nat := [0, 1]
  Json.arr <| (letterStatuses.flatMap fun status =>
    [false, true].flatMap fun erased =>
      reports.flatMap fun openReports =>
        offsets.map fun offset =>
          let facts : ErasureFacts :=
            { status := status, settledAt := NOW + offset, openReports := openReports, erased := erased }
          Json.mkObj
            [ ("status", Json.str (letterStatusName status))
            , ("settledAt", jsonInt (NOW + offset))
            , ("openReports", jsonInt (Int.ofNat openReports))
            , ("erased", Json.bool erased)
            , ("now", jsonInt NOW)
            , ("erase", Json.bool (eraseBody facts NOW)) ]).toArray

def write (dir : System.FilePath) (name : String) (json : Json) : IO Unit := do
  IO.FS.writeFile (dir / name) (json.pretty ++ "\n")
  IO.println s!"wrote {dir / name}"

def main (args : List String) : IO UInt32 := do
  let dir : System.FilePath := args.headD "vectors"
  IO.FS.createDirAll dir
  write dir "intake-decision.json" intakeVectors
  write dir "weekly-cap.json" capVectors
  write dir "moderation-verdict.json" moderationVectors
  write dir "mail-origin.json" originVectors
  write dir "recipient-selection.json" recipientVectors
  write dir "journey-schedule.json" journeyVectors
  write dir "credit-ledger.json" ledgerVectors
  write dir "you-page.json" youPageVectors
  write dir "erasure.json" erasureVectors
  return 0
