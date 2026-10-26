/-!
Model of the clamp in `src/core/journey-schedule.ts`.
The log-normal draw is a real number outside this model; the clamp that follows it is what bounds every journey, and `clampJourney` is exported by the implementation for the conformance vectors.
-/

namespace Hellooo

def HOUR_MS : Int := 60 * 60 * 1000
def DAY_MS : Int := 24 * HOUR_MS
def JOURNEY_MIN_MS : Int := 6 * HOUR_MS
def JOURNEY_MAX_MS : Int := 21 * DAY_MS

/-- `Math.max(JOURNEY_MIN_MS, duration)`. -/
def atLeastMin (duration : Int) : Int :=
  if duration ≤ JOURNEY_MIN_MS then JOURNEY_MIN_MS else duration

/-- `Math.min(JOURNEY_MAX_MS, Math.max(JOURNEY_MIN_MS, duration))`. -/
def clampJourney (duration : Int) : Int :=
  if JOURNEY_MAX_MS ≤ atLeastMin duration then JOURNEY_MAX_MS else atLeastMin duration

theorem min_le_max : JOURNEY_MIN_MS ≤ JOURNEY_MAX_MS := by
  unfold JOURNEY_MIN_MS JOURNEY_MAX_MS DAY_MS HOUR_MS
  omega

theorem clampJourney_ge (duration : Int) : JOURNEY_MIN_MS ≤ clampJourney duration := by
  have := min_le_max
  unfold clampJourney atLeastMin
  split <;> (try split) <;> omega

theorem clampJourney_le (duration : Int) : clampJourney duration ≤ JOURNEY_MAX_MS := by
  have := min_le_max
  unfold clampJourney atLeastMin
  split <;> (try split) <;> omega

theorem clampJourney_of_within {duration : Int} (hmin : JOURNEY_MIN_MS ≤ duration)
    (hmax : duration ≤ JOURNEY_MAX_MS) : clampJourney duration = duration := by
  unfold clampJourney atLeastMin
  split <;> (try split) <;> omega

theorem clampJourney_of_below {duration : Int} (h : duration ≤ JOURNEY_MIN_MS) :
    clampJourney duration = JOURNEY_MIN_MS := by
  have := min_le_max
  unfold clampJourney atLeastMin
  split <;> (try split) <;> omega

theorem clampJourney_of_above {duration : Int} (h : JOURNEY_MAX_MS ≤ duration) :
    clampJourney duration = JOURNEY_MAX_MS := by
  have := min_le_max
  unfold clampJourney atLeastMin
  split <;> (try split) <;> omega

end Hellooo
