/-!
Model of `src/core/mail-origin.ts`.
Header keys arrive lowercased from the mail parser, and values are trimmed and lowercased before comparison, as `normalized` does here with Lean's ASCII `toLower`.
-/

namespace Hellooo

inductive OriginProblem where
  | ownAddress
  | misalignedFrom
  | autoSubmitted
  | mailingList
  | bulk
  deriving DecidableEq, Repr

structure Header where
  key : String
  value : String
  deriving Repr

structure Origin (α : Type) where
  envelopeFrom : α
  headerFrom : Option α
  ownAddresses : List α
  headers : List Header

def normalized (value : String) : String := value.trimAscii.toString.toLower

def listHeaders : List String := ["list-id", "list-post", "list-unsubscribe"]
def bulkPrecedence : List String := ["bulk", "junk", "list"]

/-- What one header reveals about automatic origin, if anything. -/
def headerProblem (header : Header) : Option OriginProblem :=
  if header.key = "auto-submitted" ∧ normalized header.value ≠ "no" then some .autoSubmitted
  else if header.key ∈ listHeaders then some .mailingList
  else if header.key = "precedence" ∧ normalized header.value ∈ bulkPrecedence then some .bulk
  else none

def firstHeaderProblem : List Header → Option OriginProblem
  | [] => none
  | header :: rest =>
    match headerProblem header with
    | some problem => some problem
    | none => firstHeaderProblem rest

variable {α : Type} [DecidableEq α]

/-- `originProblem`: why a mail is not one person's letter, or `none` when it may be one. -/
def originProblem (origin : Origin α) : Option OriginProblem :=
  if origin.envelopeFrom ∈ origin.ownAddresses then some .ownAddress
  else if origin.headerFrom ≠ some origin.envelopeFrom then some .misalignedFrom
  else firstHeaderProblem origin.headers

theorem firstHeaderProblem_eq_none_iff (headers : List Header) :
    firstHeaderProblem headers = none ↔ ∀ header ∈ headers, headerProblem header = none := by
  induction headers with
  | nil => simp [firstHeaderProblem]
  | cons header rest ih =>
    unfold firstHeaderProblem
    split
    · rename_i problem hsome
      constructor
      · intro habsurd
        cases habsurd
      · intro hall
        have := hall header (by simp)
        rw [hsome] at this
        cases this
    · rename_i hnone
      rw [ih]
      constructor
      · intro hall other hmem
        rcases List.mem_cons.mp hmem with heq | hmem'
        · rw [heq]
          exact hnone
        · exact hall other hmem'
      · intro hall other hmem
        exact hall other (List.mem_cons_of_mem _ hmem)

/-- A mail is handled only when the service did not send it, the `From` header confirms the envelope, and no header marks it automatic. -/
theorem originProblem_eq_none_iff (origin : Origin α) :
    originProblem origin = none ↔
      origin.envelopeFrom ∉ origin.ownAddresses ∧
        origin.headerFrom = some origin.envelopeFrom ∧
        ∀ header ∈ origin.headers, headerProblem header = none := by
  unfold originProblem
  split
  · rename_i hown
    simp [hown]
  · rename_i hown
    split
    · rename_i hmis
      simp [hown, hmis]
    · rename_i hmis
      simp only [ne_eq, Decidable.not_not] at hmis
      rw [firstHeaderProblem_eq_none_iff]
      simp [hown, hmis]

/-- Whoever gets a reply is named by both the envelope and the authenticated `From` header. -/
theorem handled_implies_aligned {origin : Origin α} (h : originProblem origin = none) :
    origin.headerFrom = some origin.envelopeFrom :=
  ((originProblem_eq_none_iff origin).mp h).2.1

/-- The service never handles its own mail. -/
theorem handled_implies_not_own {origin : Origin α} (h : originProblem origin = none) :
    origin.envelopeFrom ∉ origin.ownAddresses :=
  ((originProblem_eq_none_iff origin).mp h).1

theorem autoSubmitted_no (value : String) (h : normalized value = "no") :
    headerProblem ⟨"auto-submitted", value⟩ = none := by
  simp [headerProblem, listHeaders, h]

theorem autoSubmitted_other (value : String) (h : normalized value ≠ "no") :
    headerProblem ⟨"auto-submitted", value⟩ = some .autoSubmitted := by
  simp [headerProblem, h]

theorem precedence_bulk (value : String) (h : normalized value ∈ bulkPrecedence) :
    headerProblem ⟨"precedence", value⟩ = some .bulk := by
  simp [headerProblem, listHeaders, h]

theorem listHeader_problem (key : String) (value : String) (h : key ∈ listHeaders) :
    headerProblem ⟨key, value⟩ = some .mailingList := by
  have hne : key ≠ "auto-submitted" := by
    intro heq
    subst heq
    simp [listHeaders] at h
  simp [headerProblem, hne, h]

end Hellooo
